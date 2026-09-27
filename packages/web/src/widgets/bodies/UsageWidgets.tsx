import { useMemo, type CSSProperties } from 'react';
import { ProjectIdentity, projectSquircleKey } from '../../components/ProjectSquircle/ProjectSquircle.js';
import { navigateToDetail, navigateToCompare, setQueryParam } from '../../lib/router.js';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import type { DailyPoint, ProjectRollup } from '../../lib/apiSchemas.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { TrendSparkline, type TrendPoint } from './atoms/TrendSparkline.js';
import { ReadinessStatEmpty, StatWidget, readinessSectionText } from './shared.js';
import { formatCost } from '../utils.js';
import styles from './UsageWidgets.module.css';

function openUsage(tab: string) {
  return () => setQueryParam('usage', tab);
}

// Git-count tiles drill to the same-basis Codebase → Git panel (git ground truth,
// the SAME commitStats sum), never the edit-VOLUME Usage → Lines panel (DA-13).
const openGit = () => navigateToDetail('codebase', 'git', 'git-ground-truth');


// Edit-family tool names — what "edits" counts. A tool-call count from byTool,
// NOT individual line edits (Seorak never reads diffs).
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Sum a git-momentum field across the per-repo snapshots in usage.momentum. Each
// snapshot is the latest cumulative count over that repo's git window; summing
// across repos gives the period-wide aggregate. COUNTS only — never paths/diffs.
function sumMomentum(
  momentum: ReadonlyArray<{ filesTouched: number; linesAdded: number; linesDeleted: number }>,
  field: 'filesTouched' | 'linesAdded' | 'linesDeleted',
): number {
  return momentum.reduce((acc, m) => acc + (m[field] ?? 0), 0);
}

// Shared honest-empty for the git-count tiles: `--` with a "fills in from git"
// note until a git.momentum snapshot lands — never a fabricated 0. The populated
// face carries the value alone (face-caption law); what's counted and what's
// excluded rides `hover` (the stat's native title), never a subline.
function GitCountStat({
  widgetId,
  total,
  hover,
  detail,
  detailAriaLabel,
  overview,
  capture,
}: {
  widgetId: string;
  total: number;
  hover?: string;
  detail?: () => void;
  detailAriaLabel?: string;
  overview: WidgetBodyProps['overview'];
  capture?: WidgetBodyProps['capture'];
}) {
  if (total <= 0) {
    return (
      <ReadinessStatEmpty
        widgetId={widgetId}
        overview={overview}
        capture={capture}
        fallback="Fills in once Seorak sees a git commit in a repo."
      />
    );
  }
  return (
    <StatWidget
      value={total.toLocaleString()}
      onOpenDetail={detail}
      detailAriaLabel={detailAriaLabel}
      titleHint={hover}
    />
  );
}

// ── files touched / lines added / lines removed (git COUNTS) ──
//
// usage.momentum[] carries privacy-safe COUNTS from git.momentum (files changed,
// lines added/deleted, generated/lockfile lines excluded) — no paths, no diffs.
// These were previously locked as "not collected"; the git-momentum capture makes
// the aggregate counts honestly feedable (the founder's item-5 reclassification).
function FilesTouchedWidget({ overview, capture }: WidgetBodyProps) {
  const total = sumMomentum(overview.usage.momentum, 'filesTouched');
  // "counts only, no paths" moved off the face to hover (audit row 10): the
  // trust-boundary disclosure stays reachable on the tile, without a subline.
  return (
    <GitCountStat
      widgetId="files-touched"
      total={total}
      overview={overview}
      capture={capture}
      detail={openGit}
      detailAriaLabel={`Open git detail, ${total.toLocaleString()} files touched`}
      hover="Distinct files changed in git. Counts only; no paths leave your machine."
    />
  );
}

function LinesAddedWidget({ overview, capture }: WidgetBodyProps) {
  const total = sumMomentum(overview.usage.momentum, 'linesAdded');
  // Drills to Codebase → Git (DA-13 resolved): a git line COUNT reconciles with
  // the git-ground-truth panel (same commitStats sum), NOT the edit-VOLUME Usage
  // → Lines panel where reverts inflate a different, larger number.
  return (
    <GitCountStat
      widgetId="lines-added"
      total={total}
      overview={overview}
      capture={capture}
      detail={openGit}
      detailAriaLabel={`Open git detail, ${total.toLocaleString()} lines added`}
      hover="Lines added in git this window. Generated and lockfile lines are excluded."
    />
  );
}

function LinesRemovedWidget({ overview, capture }: WidgetBodyProps) {
  const total = sumMomentum(overview.usage.momentum, 'linesDeleted');
  // Drills to Codebase → Git, not the edit-VOLUME lines panel. See LinesAddedWidget.
  return (
    <GitCountStat
      widgetId="lines-removed"
      total={total}
      overview={overview}
      capture={capture}
      detail={openGit}
      detailAriaLabel={`Open git detail, ${total.toLocaleString()} lines removed`}
      hover="Lines removed in git this window. Generated and lockfile lines are excluded."
    />
  );
}

// ── commits / net lines (git ground-truth, split out from the former bundled
//    "commits, files & lines" tile) ──
//
// Both read overview.codebase.commitStats (the per-repo-latest git.momentum sum),
// honest-empty ("--") until Seorak sees a commit. Anti-vanity: NET change is the
// honest line headline, never raw lines-added.
function signedNet(n: number): string {
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString()}`; // proper minus sign
  return '0';
}

function CommitsWidget({ overview, capture }: WidgetBodyProps) {
  const stats = overview.codebase.commitStats;
  if (stats === null) {
    return (
      <ReadinessStatEmpty
        widgetId="commits"
        overview={overview}
        capture={capture}
        fallback="Fills in once Seorak sees a git commit in a repo."
      />
    );
  }
  // Clarity precedent P1: the count is the answer. The secondary "N during
  // sessions" attribution moves to the drill. The git window rides the hover so
  // the number isn't misread as the date-picker window (it's git's own trailing
  // snapshot window, not rangeDays — audit B1).
  return (
    <StatWidget
      value={stats.commits.toLocaleString()}
      onOpenDetail={openGit}
      detailAriaLabel={`Open git detail, ${stats.commits.toLocaleString()} commits`}
      titleHint={`Commits in git's trailing ${stats.windowDays}-day window, not the date-range picker.`}
    />
  );
}

function NetLinesWidget({ overview, capture }: WidgetBodyProps) {
  const stats = overview.codebase.commitStats;
  if (stats === null) {
    return (
      <ReadinessStatEmpty
        widgetId="net-lines"
        overview={overview}
        capture={capture}
        fallback="Fills in once Seorak sees a git commit in a repo."
      />
    );
  }
  const net = stats.linesAdded - stats.linesDeleted;
  // The "generated excluded" disclosure moved off the face to hover
  // (2026-07-03, same treatment as the repo-activity Net-lines cell): it is
  // derivation detail, not a misread-guard — the shown number is the correct
  // headline. Face captions are reserved for undercount warnings and
  // honest-empty accrual notes.
  const excluded =
    stats.generatedLinesExcluded > 0
      ? ` ${stats.generatedLinesExcluded.toLocaleString()} generated/lockfile lines excluded.`
      : ' Generated and lockfile lines are excluded.';
  return (
    <StatWidget
      value={signedNet(net)}
      onOpenDetail={openGit}
      detailAriaLabel={`Open git detail, ${signedNet(net)} net lines`}
      titleHint={`Lines added minus lines removed in git's trailing ${stats.windowDays}-day window, not the date-range picker.${excluded}`}
    />
  );
}

// ── edits (edit-family tool calls) ──
//
// Sum of tools.byTool calls for the edit-family tools. byTool needs the retained
// event log, so it is honest-empty until tool.call rows land — `--`, not 0.
function EditsWidget({ overview, capture }: WidgetBodyProps) {
  const total = overview.tools.byTool
    .filter((t) => EDIT_TOOLS.has(t.tool))
    .reduce((acc, t) => acc + t.calls, 0);
  if (overview.tools.byTool.length === 0 || total === 0) {
    return (
      <ReadinessStatEmpty
        widgetId="edits"
        overview={overview}
        capture={capture}
        fallback="Fills in as edit-family tool calls accrue in this window."
      />
    );
  }
  // "tool calls, not line edits" moved off the face to hover (P1): the
  // misread-guard stays reachable without a subline under the value.
  return (
    <StatWidget
      value={total.toLocaleString()}
      onOpenDetail={openUsage('edits')}
      detailAriaLabel={`Open usage detail, ${total} edit-family tool calls`}
      titleHint="Edit-family tool calls (Edit, Write, MultiEdit, NotebookEdit). Tool calls, not individual line edits."
    />
  );
}

// ── cost per edit ───────────────────────────────────
//
// usage.costPerEdit = window cost ÷ edit-family calls, computed worker-side
// from the event log. A deliberate 2026-06-09 reversal of the capture-principle
// "stays refused" call. null — `--`, never $0 — until both sides are measured.
function CostPerEditWidget({ overview, capture }: WidgetBodyProps) {
  const value = overview.usage.costPerEdit;
  if (value === null) {
    return (
      <ReadinessStatEmpty
        widgetId="cost-per-edit"
        overview={overview}
        capture={capture}
        fallback="Fills in once the window has measured cost and edit calls."
      />
    );
  }
  return (
    <StatWidget
      value={formatCost(value, 2)}
      titleHint="Window cost ÷ edit-family tool calls (Edit, Write, MultiEdit, NotebookEdit). A cost lever, not a grade."
    />
  );
}

// ── sessions ────────────────────────────────────────
//
// Immediate scalar from usage.totals.sessions, summed over the sessions
// currently held in KV. The delta pill reads usage.totals.sessionsDelta from the
// retained event log (same adjacent-window legs as cost.delta); previous null
// suppresses the pill. No zero-fill.
function SessionsWidget({ overview, capture }: WidgetBodyProps) {
  const n = overview.usage.totals.sessions;
  if (n === 0) {
    return (
      <ReadinessStatEmpty widgetId="sessions" overview={overview} capture={capture} />
    );
  }
  const display = n.toLocaleString();
  const delta = overview.usage.totals.sessionsDelta;
  const days = overview.rangeDays;
  const deltaComparison =
    delta && delta.previous != null && delta.previous > 0
      ? `${delta.current.toLocaleString()} sessions this ${days}-day window vs ${delta.previous.toLocaleString()} the ${days} days before.`
      : undefined;
  return (
    <StatWidget
      value={display}
      delta={delta}
      deltaComparison={deltaComparison}
      onOpenDetail={openUsage('sessions')}
      detailAriaLabel={`Open usage detail, ${display} sessions`}
    />
  );
}

// ── cost ────────────────────────────────────────────
//
// usage.cost.totalUsd, gated by sessionsWithCost: `--` (never `$0`) when no
// session reported cost. The delta pill is suppressed when delta.previous is
// null: KV holds latest-state only, so the prior window is summed from the
// retained event log instead — null only when that prior (or current) window
// had no measured cost.
//
// Partial-cost honesty lives on the DRILL, not the face: when a priceable session
// is dropped for want of a rate, or a byModel row carries tokens but no price, the
// total is an undercount. The usage → cost detail (CostPanel) states that floor as
// a structured question note, and Agents → Models shows the unpriced models by
// token share — so the tile stays stat-only instead of carrying "partial" filler.
function CostWidget({ overview, capture }: WidgetBodyProps) {
  const cost = overview.usage.cost;
  if (cost.sessionsWithCost === 0 || cost.totalUsd == null) {
    return (
      <ReadinessStatEmpty widgetId="cost" overview={overview} capture={capture} />
    );
  }
  const value = formatCost(cost.totalUsd, 2);
  // delta.previous stays null until a prior window has measured cost in the event
  // log; StatWidget suppresses the pill when previous is null, so a fabricated
  // movement never renders. The comparator is stated on the pill's hover — the
  // glyph alone never carries "vs what".
  const delta = cost.delta;
  const days = overview.rangeDays;
  const deltaComparison =
    delta && delta.previous != null && delta.previous > 0
      ? `${formatCost(delta.current, 2)} this ${days}-day window vs ${formatCost(delta.previous, 2)} the ${days} days before.`
      : undefined;
  return (
    <StatWidget
      value={value}
      delta={delta}
      deltaFormat="usd"
      deltaComparison={deltaComparison}
      onOpenDetail={openUsage('cost')}
      detailAriaLabel={`Open usage detail, ${value} cost`}
    />
  );
}

// ── cache reuse (a cost lever, not a grade) ─────────
//
// usage.cacheReuseRatio (0..1) = cacheRead / (cacheRead + input) across the
// sessions in KV. null (never 0 as a stand-in) until a session has measurable
// tokens. Framed as an efficiency/cost signal — how much context is reused vs
// re-read — NOT a score: a low ratio is "more context re-read", never "bad".
function CacheReuseWidget({ overview, capture }: WidgetBodyProps) {
  const ratio = overview.usage.cacheReuseRatio;
  if (ratio == null) {
    return (
      <ReadinessStatEmpty
        widgetId="cache-reuse"
        overview={overview}
        capture={capture}
        fallback="Fills in once a session reports measurable tokens."
      />
    );
  }
  const value = `${Math.round(ratio * 100)}%`;
  return (
    <StatWidget
      value={value}
      titleHint="Context reused from cache vs re-read across this window. A cost lever, not a grade: a low ratio just means more context was re-read."
    />
  );
}

// ── projects (per-repo leaderboard) ─────────────────
//
// usage.projects[] — rank repos by sessions / recency. Explicit A/B compare is
// a secondary mode in Compare, not an implicit pairing chosen by this table.
// Columns: Project | Sessions | Active | Recency | View. No per-day-per-project
// activity sparkline: no OverviewSnapshot field can feed that series without a
// retained event log. The recency read (lastEventAt as relative time) stands in
// for it.
function ProjectsWidget({ overview, capture }: WidgetBodyProps) {
  const projects = overview.usage.projects;
  if (projects.length === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText('projects', overview, capture, 'No projects yet')}
      </SectionEmpty>
    );
  }

  const sorted = [...projects].sort((a, b) => b.sessions - a.sessions);
  const canCompare = sorted.length >= 2;

  return (
    <div className={styles.projectsTable}>
      <div className={styles.projectsTableHeader}>
        <span>Project</span>
        <span className={styles.projectsHeaderNum}>Sessions</span>
        <span className={styles.projectsHeaderNum}>Active</span>
        <span>Last active</span>
        <span aria-hidden="true" />
      </div>
      <div className={styles.projectsTableBody}>
        {sorted.map((p: ProjectRollup, i: number) => {
          const recency = formatRelativeTime(p.lastEventAt);
          return (
            <button
              key={p.repoId}
              type="button"
              className={styles.projectsTableRow}
              style={{ '--row-index': i } as CSSProperties}
              onClick={() => navigateToDetail('usage', 'projects', 'overview')}
              aria-label={`Open projects detail for ${p.project}`}
            >
              <ProjectIdentity
                projectKey={projectSquircleKey(p.repoId, p.project)}
                label={p.project || '--'}
                title={p.project}
              />

              <span className={styles.projectsNumCell}>
                <span className={styles.projectsNumValue}>
                  {p.sessions.toLocaleString()}
                </span>
              </span>

              <span className={styles.projectsNumCell}>
                {p.activeSessions > 0 ? (
                  <span className={styles.projectsNumValue}>
                    {p.activeSessions.toLocaleString()}
                  </span>
                ) : (
                  // A measured zero: the board was read and nothing is running here.
                  <span className={styles.projectsEmptyNum}>none</span>
                )}
              </span>

              <span className={styles.projectsActivityCell}>
                {recency ?? (
                  // `lastEventAt` is a required timestamp on every rollup, so a null
                  // here is a row that carried nothing readable in it, not a project
                  // whose activity fell outside the window.
                  <span
                    className={styles.projectsEmptyNum}
                    title="This project's row carried no readable last-event time."
                  >
                    not reported
                  </span>
                )}
              </span>

              <span className={styles.projectsViewButton}>View</span>
            </button>
          );
        })}
      </div>
      {canCompare && (
        <button
          type="button"
          className={styles.projectsCompare}
          onClick={() => navigateToCompare({ mode: 'repos' })}
        >
          Choose two repos to compare
        </button>
      )}
    </div>
  );
}

// ── trend (per-day sessions sparkline) ───────
//
// usage.dailyTrends[] — a per-day series from the retained event log; honest-
// empty until in-window rows accrue (never a fabricated flat line). When
// present it draws the sessions cadence only. Cost has its own scalar tile and
// does not share this dashboard face.
function buildTrendPoints(trends: ReadonlyArray<DailyPoint>): TrendPoint[] {
  return trends.map((d) => ({
    day: d.day,
    value: d.sessions,
  }));
}

function TrendWidget({ overview, capture }: WidgetBodyProps) {
  const trends = overview.usage.dailyTrends;

  const points = useMemo(() => buildTrendPoints(trends), [trends]);
  const observed = useMemo(() => points.filter((p) => p.value != null).length, [points]);

  if (trends.length === 0 || observed < 2) {
    return (
      <SectionEmpty>
        {readinessSectionText(
          'trend',
          overview,
          capture,
          'Fills in as sessions accrue in this window.',
        )}
      </SectionEmpty>
    );
  }

  const total = points.reduce((s, p) => s + (p.value ?? 0), 0);
  const headValue = `${total.toLocaleString()} ${total === 1 ? 'session' : 'sessions'}`;
  const formatValue = (n: number) =>
    `${n.toLocaleString()} ${n === 1 ? 'session' : 'sessions'}`;

  return (
    <div className={styles.trendFrame}>
      <div className={styles.trendHead}>
        <span className={styles.trendValue}>{headValue}</span>
      </div>
      <div className={styles.trendChart}>
        <TrendSparkline
          points={points}
          ariaLabel={`Daily sessions trend over ${observed} ${observed === 1 ? 'day' : 'days'} with data`}
          formatValue={formatValue}
        />
      </div>
    </div>
  );
}

export const usageWidgets: WidgetRegistry = {
  sessions: SessionsWidget,
  cost: CostWidget,
  'cache-reuse': CacheReuseWidget,
  trend: TrendWidget,
  projects: ProjectsWidget,
  // Git-count tiles, fed from usage.momentum / tools.byTool (privacy-safe COUNTS,
  // no paths or diffs) — honest-empty until Seorak sees git/edit activity.
  edits: EditsWidget,
  'lines-added': LinesAddedWidget,
  'lines-removed': LinesRemovedWidget,
  'files-touched': FilesTouchedWidget,
  // Split out from the former bundled commit-stats tile; read codebase.commitStats.
  commits: CommitsWidget,
  'net-lines': NetLinesWidget,
  'cost-per-edit': CostPerEditWidget,
};

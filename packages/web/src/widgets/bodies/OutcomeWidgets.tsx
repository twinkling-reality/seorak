import { useMemo } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { navigateToDetail } from '../../lib/router.js';
import type { EndReasonCount } from '../../lib/apiSchemas.js';
import styles from './OutcomeWidgets.module.css';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import { ShareFaceFrame } from './atoms/ShareFaceFrame.js';
import { StripFaceHead } from './atoms/StripFaceHead.js';
import { TrendSparkline, type TrendPoint } from './atoms/TrendSparkline.js';
import { totalEnded, reasonMeta } from './atoms/endReasonStack.js';
import type { AnnotatedStripSegment } from './atoms/AnnotatedStrip.js';
import { STRIP_TAIL_FILL } from './atoms/shareStripRamp.js';
import { CoverageNote, ReadinessStatEmpty, StatWidget, readinessSectionText } from './shared.js';
import { readinessEmptyMessage } from '../../lib/widgetReadiness.js';
import { formatLineSurvivalRate } from './lineSurvival.js';

/* ─────────────────────────────────────────────────────
 * Outcomes category.
 *
 * Seorak has no completion classifier, so it cannot report a completion rate.
 * Its honest substitute is session.end.reason counts, rendered as
 * `session-end-reasons` (exit-type share strip) and `outcome-trend` (the same reasons
 * over a per-day series from the retained event log) — both labeled "how sessions
 * ended", NOT a completion rate. `one-shot-rate` is a cadence signal; stuckness is
 * the intervention wedge, an honest empty state until the worker computes stuck.
 * ──────────────────────────────────────────────────── */

// ── session-end-reasons (exit-type share strip) ─────
//
// outcomes.endReasons[] — Claude Code SessionEnd exit paths in this window.
// Share-face (same family as verification / top files): one dominant %, strip +
// legend with plain labels. Not a completion score.

const REASON_STRIP_TOP_N = 5;
const REASON_TAIL_KEY = '__tail__';

function foldReasonStrip(
  sorted: ReadonlyArray<EndReasonCount>,
): AnnotatedStripSegment[] {
  const visible = sorted.slice(0, REASON_STRIP_TOP_N);
  const tail = sorted.slice(REASON_STRIP_TOP_N);
  const tailTotal = tail.reduce((s, r) => s + r.count, 0);
  return [
    ...visible.map((r) => {
      const meta = reasonMeta(r.reason);
      return {
        key: r.reason,
        value: r.count,
        color: meta.color,
        label: meta.label,
      };
    }),
    ...(tail.length > 0
      ? [
          {
            key: REASON_TAIL_KEY,
            value: tailTotal,
            color: STRIP_TAIL_FILL,
            label: `+${tail.length} more`,
          },
        ]
      : []),
  ];
}

function SessionEndReasonsWidget({ overview, capture }: WidgetBodyProps) {
  const reasons = overview.outcomes.endReasons;
  const endedCount = overview.outcomes.endedCount;

  const total = reasons.reduce((s: number, r: EndReasonCount) => s + r.count, 0);
  if (reasons.length === 0 || total === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText(
          'session-end-reasons',
          overview,
          capture,
          'Counts how sessions stopped once you have ended a few',
        )}
      </SectionEmpty>
    );
  }

  const sorted = [...reasons]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const top = sorted[0];
  const topMeta = reasonMeta(top.reason);

  const unlabeledEnds = endedCount > total ? endedCount - total : 0;
  const headHint = [
    'When your Claude Code sessions stopped in this window: closed, continued from saved, signed out, and so on. Not whether the work was good.',
    unlabeledEnds > 0
      ? `${unlabeledEnds.toLocaleString()} ${unlabeledEnds === 1 ? 'session' : 'sessions'} had no stop reason recorded and are omitted.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const segments = foldReasonStrip(sorted);

  return (
    <ShareFaceFrame
      value={top.count.toLocaleString()}
      caption={`sessions ${topMeta.caption}`}
      headTitle={headHint}
      strip={{
        segments,
        ariaLabel: 'How sessions stopped',
        titleFor: (s) => {
          if (s.key === REASON_TAIL_KEY) {
            const rest = sorted.slice(REASON_STRIP_TOP_N);
            return `${rest.length} more exit ${rest.length === 1 ? 'type' : 'types'}`;
          }
          const row = sorted.find((r) => r.reason === s.key);
          const meta = reasonMeta(s.key);
          const pct = row ? Math.round((row.count / total) * 100) : 0;
          return `${meta.hint} ${row?.count ?? 0} ${row?.count === 1 ? 'session' : 'sessions'} (${pct}%).`;
        },
        legendValueFor: (s) =>
          s.key === REASON_TAIL_KEY
            ? null
            : `${s.value.toLocaleString()} ${s.value === 1 ? 'session' : 'sessions'}`,
      }}
    />
  );
}

// ── stuckness (the intervention wedge) ──────────────
//
// outcomes.stuckness.rate. Until the worker computes stuck (cron over
// lastEventAt), rate is null — render an honest empty state, never a
// fabricated stuck count.
function StucknessWidget({ overview, capture }: WidgetBodyProps) {
  const s = overview.outcomes.stuckness;
  if (s.rate == null) {
    return (
      <ReadinessStatEmpty
        widgetId="stuckness"
        overview={overview}
        capture={capture}
        fallback="Fills in when a live session goes quiet long enough to flag."
      />
    );
  }
  // stuckness.rate is a 0..1 fraction — scale to a percentage for display.
  const value = `${Math.round(s.rate * 100)}%`;
  return (
    <StatWidget
      value={value}
      onOpenDetail={() => navigateToDetail('outcomes', 'sessions', 'stuck')}
      detailAriaLabel={`Open outcomes detail, ${value} stuck rate`}
    />
  );
}

// ── ship-rate (git ground-truth "did the work land?") ──
//
// outcomes.shipRate (0..1) — share of finished sessions where a commit landed.
// null until a session.delta determines shipping (mirror the stuckness null-honest
// gate; same ×100). Never a fabricated 0%.
function ShipRateWidget({ overview, capture }: WidgetBodyProps) {
  const rate = overview.outcomes.shipRate;
  if (rate == null) {
    return (
      <ReadinessStatEmpty
        widgetId="ship-rate"
        overview={overview}
        capture={capture}
        fallback="Ship detection fills in once a finished session lands a commit."
      />
    );
  }
  const value = `${Math.round(rate * 100)}%`;
  return (
    <StatWidget
      value={value}
      onOpenDetail={() => navigateToDetail('outcomes', 'sessions', 'shipped')}
      detailAriaLabel={`Open outcomes detail, ${value} of sessions shipped a commit`}
    />
  );
}

// ── line-survival (the honest, revert-catching "did it last?") ──
//
// outcomes.lineSurvival.rate — LINE-level (surviving ÷ authored) over the RATED
// (retained+overwritten) fates, floored at >=3 commits. A later re-check reads the
// lines themselves, so a revert or a rewrite lands as overwritten rather than
// counting as survived. null below the floor / until checks accrue — render honest
// "--", NEVER a fabricated 0 or flat line. Anti-grade: a low rate is "more changed
// back", NEVER "bad work".
function LineSurvivalWidget({ overview, capture }: WidgetBodyProps) {
  const ls = overview.outcomes.lineSurvival;
  const value = formatLineSurvivalRate(ls.rate);
  if (ls.rate == null) {
    return (
      <>
        <StatWidget value={value} />
        <CoverageNote
          text={
            readinessEmptyMessage('line-survival', overview, capture) ??
            'Line survival fills in once the daemon re-checks matured sessions\' lines (needs 3+ commits).'
          }
        />
      </>
    );
  }
  // Face carries the value alone (P1 + face ornament ban); meaning + sample size
  // live on hover (a middot-joined subline is banned face copy).
  const across =
    ls.sessionsRated > 0
      ? `, across ${ls.sessionsRated.toLocaleString()} matured ${
          ls.sessionsRated === 1 ? 'session' : 'sessions'
        }`
      : '';
  return (
    <StatWidget
      value={value}
      onOpenDetail={() => navigateToDetail('outcomes', 'sessions', 'line-survival')}
      detailAriaLabel={`Open outcomes detail, ${value} of authored lines still in the code`}
      titleHint={`Share of authored lines still in the code${across}. Catches reverts and rewrites after a later re-check.`}
    />
  );
}

// ── one-shot rate (a cadence signal, not a success grade) ──
//
// outcomes.oneShotRate (0..1) — share of sessions that ran without looping back
// on a retry, from each ended session's ordered tool-call stream. null until
// ended sessions with tool calls accrue. Never 0 as a stand-in.
function OneShotRateWidget({ overview, capture }: WidgetBodyProps) {
  const rate = overview.outcomes.oneShotRate;
  if (rate == null) {
    return (
      <ReadinessStatEmpty
        widgetId="one-shot-rate"
        overview={overview}
        capture={capture}
        fallback="Fills in as ended sessions accrue."
      />
    );
  }
  const value = `${Math.round(rate * 100)}%`;
  return (
    <StatWidget
      value={value}
      titleHint="Share of sessions that ran without looping back on a retry. A cadence read, not a success score."
    />
  );
}

// ── outcome-trend ("how sessions ended, over time") ──
//
// outcomes.endReasonsByDay[] — per-day session-end counts from the retained event
// log. The cockpit face is a compact sparkline (same family as sessions-per-day),
// not the detail-view stacked area — that chart is 280px tall and clips inside
// h:3 widget cells. Honest-empty until ends accrue; no zero-filled day spine.
function OutcomeTrendWidget({ overview, capture }: WidgetBodyProps) {
  const byDay = overview.outcomes.endReasonsByDay;
  const points = useMemo<TrendPoint[]>(
    () =>
      byDay.map((d) => ({
        day: d.day,
        value: d.reasons.reduce((s, r) => s + r.count, 0),
      })),
    [byDay],
  );
  const observed = useMemo(() => points.filter((p) => (p.value ?? 0) > 0).length, [points]);

  if (byDay.length === 0 || totalEnded(byDay) === 0 || observed < 2) {
    return (
      <SectionEmpty>
        {readinessSectionText(
          'outcome-trend',
          overview,
          capture,
          'Fills in as sessions wrap up, day by day',
        )}
      </SectionEmpty>
    );
  }

  const total = totalEnded(byDay);
  const formatValue = (n: number) =>
    `${n.toLocaleString()} ${n === 1 ? 'session' : 'sessions'}`;

  return (
    <div className={styles.sparkFrame}>
      <StripFaceHead
        value={total.toLocaleString()}
        caption={total === 1 ? 'session wrapped up' : 'sessions wrapped up'}
      />
      <div className={styles.sparkChart}>
        <TrendSparkline
          points={points}
          ariaLabel={`Sessions wrapped up per day over ${observed} ${
            observed === 1 ? 'day' : 'days'
          } with data`}
          formatValue={formatValue}
        />
      </div>
    </div>
  );
}

export const outcomeWidgets: WidgetRegistry = {
  // The session-end-reasons strip serves the generic `outcomes` slot: session-end
  // reasons, not a completion rate, because Seorak cannot measure completion.
  // Registered under both the catalog id and its canonical name.
  outcomes: SessionEndReasonsWidget,
  'session-end-reasons': SessionEndReasonsWidget,
  stuckness: StucknessWidget,
  // Real git ground-truth + cadence signals (live, honest-empty until they land).
  'ship-rate': ShipRateWidget,
  // On-branch line-survival: the honest, revert-catching durability headline.
  'line-survival': LineSurvivalWidget,
  'one-shot-rate': OneShotRateWidget,
  'outcome-trend': OutcomeTrendWidget,
};

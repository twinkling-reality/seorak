// Repo-compare metric registry (docs/specs/multi-repo.md).
//
// Honesty gates: null/[] → `--`. No middot (`·`) joined facts (agent-standards.md).

import type {
  OverviewSnapshot,
  ProjectRollup,
  RepoMomentum,
  RepoTemperature,
} from '../../lib/apiSchemas.js';
import { fmtCount, formatCost, fmtPct } from '../../lib/voice/index.js';
import { endReasonLabel } from '../OverviewView/OutcomesDetailView/format.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { formatModel } from '../../lib/modelMeta.js';
import { getVisualMeta, type VisualKind } from '../../lib/visualMeta.js';

export type CompareSectionId =
  | 'context'
  | 'volume'
  | 'outcomes'
  | 'work-shape'
  | 'cadence'
  | 'attention';

/** One repo's resolved per-window data — everything a metric row can read. */
export interface RepoData {
  project: string;
  repoId: string;
  rollup: ProjectRollup;
  momentum: RepoMomentum | null;
  temperature: RepoTemperature | null;
}

export interface ResolvedRepo {
  requested: string;
  status: 'empty' | 'unknown' | 'ok';
  data: RepoData | null;
  ambiguous: boolean;
}

export interface CompareRepoOption {
  value: string;
  label: string;
  repoId: string;
}

export interface CompareCell {
  value: string;
  visual?: { kind: VisualKind; id: string };
  sub?: string;
  hint?: string;
  empty: boolean;
}

export interface CompareMetric {
  id: string;
  label: string;
  section: CompareSectionId;
  hint?: string;
  read: (repo: RepoData) => CompareCell;
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const SIZE_BAND_LABEL: Record<string, string> = {
  xs: 'Small',
  s: 'Small',
  m: 'Medium',
  l: 'Large',
  xl: 'Very large',
};

const AGE_BAND_LABEL: Record<string, string> = {
  new: 'New repo',
  recent: 'Recent',
  established: 'Established',
  mature: 'Mature',
};

const GIT_CONTEXT_LABEL: Record<string, string> = {
  'no-repo': 'No repo',
  clean: 'Clean tree',
  'dirty-at-start': 'Dirty at start',
  detached: 'Detached',
  'no-remote': 'No remote',
};

const TEMPERATURE_LABEL: Record<string, string> = {
  heating: 'Heating up',
  steady: 'Steady',
  cooling: 'Cooling',
  quiet: 'Quiet',
};

function emptyCell(hint?: string): CompareCell {
  return { value: '--', empty: true, hint };
}

function valueCell(value: string, extra?: Partial<CompareCell>): CompareCell {
  return { value, empty: false, ...extra };
}

function visualEnumCell(
  kind: VisualKind,
  rawId: string,
  extra?: Partial<CompareCell>,
): CompareCell {
  const meta = getVisualMeta(kind, rawId);
  return valueCell(meta.label, { visual: { kind, id: meta.id }, ...extra });
}

function rateCell(rate: number | null, emptyHint: string): CompareCell {
  if (rate == null) return emptyCell(emptyHint);
  return valueCell(fmtPct(rate));
}

const VERIFICATION_KIND_LABEL: Record<string, string> = {
  test: 'Tests',
  build: 'Build',
  typecheck: 'Typecheck',
  lint: 'Lint',
};

function fileDisplay(f: { label: string | null; fileId: string }): string {
  return f.label ?? `file ${f.fileId.slice(0, 6)}`;
}

function dirDisplay(d: { label: string | null; dirId: string }): string {
  return d.label ?? `dir ${d.dirId.slice(0, 6)}`;
}

function formatPeakHour(dow: number, hour: number): string {
  const day = DOW_SHORT[dow] ?? `Day ${dow}`;
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'am' : 'pm';
  return `${day} ${h}${ampm}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 120) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function topShare(count: number, total: number): string | undefined {
  if (total <= 0) return undefined;
  return `${Math.round((count / total) * 100)}% share`;
}

function costPerEdit(rollup: ProjectRollup): number | null {
  const winCost = rollup.costDelta?.current ?? rollup.costUsd;
  const editCalls = rollup.editCalls ?? 0;
  if (winCost == null || winCost <= 0 || editCalls <= 0) return null;
  return winCost / editCalls;
}

function costTrendCell(rollup: ProjectRollup): CompareCell {
  const delta = rollup.costDelta;
  if (!delta || delta.current <= 0) {
    return emptyCell('No priced session in this repo for the current window.');
  }
  if (delta.previous == null || delta.previous <= 0) {
    return valueCell(formatCost(delta.current, 2), {
      hint: 'No priced session in the prior window to compare.',
    });
  }
  const pct = Math.round(((delta.current - delta.previous) / delta.previous) * 100);
  const sign = pct > 0 ? '+' : '';
  return valueCell(`${sign}${pct}%`, {
    sub: `${formatCost(delta.current, 2)} vs ${formatCost(delta.previous, 2)} prior`,
    hint: 'Period-over-period cost in this repo.',
  });
}

export const COMPARE_METRICS: CompareMetric[] = [
  // ── Context ──
  {
    id: 'repo-size',
    section: 'context',
    label: 'Repo size',
    hint: 'Tracked-file count band from git (not the compare window).',
    read: (r) => {
      const shape = r.rollup.character?.repoShape;
      if (!shape) return emptyCell('Repo size has not been derived for this repo yet.');
      return valueCell(SIZE_BAND_LABEL[shape.sizeBand] ?? shape.sizeBand);
    },
  },
  {
    id: 'repo-age',
    section: 'context',
    label: 'Repo age',
    hint: 'How long the repo has existed, in coarse bands from git.',
    read: (r) => {
      const shape = r.rollup.character?.repoShape;
      if (!shape) return emptyCell('Repo age has not been derived for this repo yet.');
      return valueCell(AGE_BAND_LABEL[shape.ageBand] ?? shape.ageBand);
    },
  },
  {
    id: 'repo-layout',
    section: 'context',
    label: 'Layout',
    hint: 'Whether the repo is a monorepo or a single package.',
    read: (r) => {
      const shape = r.rollup.character?.repoShape;
      if (!shape) return emptyCell('Repo layout has not been derived for this repo yet.');
      return valueCell(shape.monorepo ? 'Monorepo' : 'Single package');
    },
  },
  {
    id: 'stack',
    section: 'context',
    label: 'Stack',
    hint: 'Language mix from edit calls with a mapped file language.',
    read: (r) => {
      const mix = r.rollup.workMix?.fileLanguageMix ?? [];
      if (mix.length === 0) {
        return emptyCell('No mapped file language in this window yet.');
      }
      const top = mix[0];
      const total = mix.reduce((s, x) => s + x.editCalls, 0);
      return visualEnumCell('language', top.language, {
        sub: topShare(top.editCalls, total),
        hint: `${fmtCount(top.editCalls)} of ${fmtCount(total)} edit calls had a mapped language.`,
      });
    },
  },
  {
    id: 'file-category',
    section: 'context',
    label: 'File category',
    hint: 'What kind of files saw the most edits (source, test, config, etc.).',
    read: (r) => {
      const mix = r.rollup.workMix?.fileCategoryMix ?? [];
      if (mix.length === 0) {
        return emptyCell('No file category was captured in this window yet.');
      }
      const top = mix[0];
      const total = mix.reduce((s, x) => s + x.editCalls, 0);
      return visualEnumCell('fileCategory', top.category, {
        sub: topShare(top.editCalls, total),
        hint: `${fmtCount(top.editCalls)} of ${fmtCount(total)} categorized edit calls.`,
      });
    },
  },
  {
    id: 'framework',
    section: 'context',
    label: 'Framework',
    hint: 'Latest detected primary framework.',
    read: (r) => {
      const fw = r.rollup.character?.framework;
      if (!fw) return emptyCell('No framework detected for this repo yet.');
      return visualEnumCell('framework', fw);
    },
  },
  {
    id: 'package-manager',
    section: 'context',
    label: 'Package manager',
    hint: 'Latest detected package manager from lockfiles.',
    read: (r) => {
      const pm = r.rollup.character?.packageManager;
      if (!pm) return emptyCell('No package manager detected for this repo yet.');
      return visualEnumCell('packageManager', pm);
    },
  },
  {
    id: 'git-context',
    section: 'context',
    label: 'Git context',
    hint: "Git state at the repo's latest activity snapshot.",
    read: (r) => {
      const ctx = r.momentum?.gitContext;
      if (!ctx) return emptyCell('No repo activity snapshot for this repo yet.');
      return valueCell(GIT_CONTEXT_LABEL[ctx] ?? ctx);
    },
  },
  {
    id: 'temperature',
    section: 'context',
    label: 'Heat',
    hint: 'Heating or cooling vs this repo own trailing baseline.',
    read: (r) => {
      const t = r.temperature;
      if (!t || t.temperature == null) {
        return emptyCell('Not enough git history to judge heat for this repo.');
      }
      const label = TEMPERATURE_LABEL[t.temperature] ?? t.temperature;
      const sub =
        t.temperature === 'quiet' && t.quietDays != null
          ? `Quiet ${fmtCount(t.quietDays)} days`
          : `${fmtCount(t.netLines)} net lines`;
      return valueCell(label, { sub });
    },
  },
  // ── Volume ──
  {
    id: 'sessions',
    section: 'volume',
    label: 'Sessions',
    hint: 'Tracked sessions in this repo over the window.',
    read: (r) => valueCell(fmtCount(r.rollup.sessions)),
  },
  {
    id: 'tool-calls',
    section: 'volume',
    label: 'Tool calls',
    hint: 'Total tool calls in this repo over the window.',
    read: (r) => valueCell(fmtCount(r.rollup.toolCalls)),
  },
  {
    id: 'cost',
    section: 'volume',
    label: 'Cost',
    hint: 'Total measured spend in this repo over the window.',
    read: (r) =>
      r.rollup.costUsd == null
        ? emptyCell('No session in this repo reported a cost yet.')
        : valueCell(formatCost(r.rollup.costUsd, 2)),
  },
  {
    id: 'cost-trend',
    section: 'volume',
    label: 'Cost trend',
    hint: 'Period-over-period cost change vs the prior window.',
    read: (r) => costTrendCell(r.rollup),
  },
  {
    id: 'cost-per-edit',
    section: 'volume',
    label: 'Cost per edit',
    hint: 'Window cost divided by edit-family tool calls.',
    read: (r) => {
      const cpe = costPerEdit(r.rollup);
      if (cpe == null) return emptyCell('No measured edit calls with cost in this window.');
      return valueCell(formatCost(cpe, 2), {
        sub: `${fmtCount(r.rollup.editCalls ?? 0)} edit calls`,
      });
    },
  },
  {
    id: 'cache-reuse',
    section: 'volume',
    label: 'Cache reuse',
    hint: 'Share of input tokens served from cache.',
    read: (r) =>
      rateCell(
        r.rollup.cacheReuseRatio,
        'No cache or input tokens recorded for this repo yet.',
      ),
  },
  {
    id: 'edit-volume',
    section: 'volume',
    label: 'Edit volume',
    hint: 'Lines added and removed by edit tools in this window.',
    read: (r) => {
      const lines = r.rollup.lines;
      if (!lines) return emptyCell('No measured line edits in this repo yet.');
      return valueCell(`+${fmtCount(lines.added)}`, {
        sub: `-${fmtCount(lines.removed)} removed`,
      });
    },
  },
  // ── Outcomes ──
  {
    id: 'ship-rate',
    section: 'outcomes',
    label: 'Ship rate',
    hint: 'Share of finished sessions that landed a commit.',
    read: (r) =>
      rateCell(r.rollup.shipRate, 'No finished session could be checked for a landed commit yet.'),
  },
  {
    id: 'line-survival',
    section: 'outcomes',
    label: 'Line survival',
    hint: 'Share of authored lines still on-branch after they matured.',
    read: (r) => {
      const ls = r.rollup.lineSurvival;
      if (!ls || ls.rate == null) {
        return emptyCell('Not enough matured commits in this repo to read line survival yet.');
      }
      return valueCell(fmtPct(ls.rate), {
        hint: `${fmtCount(ls.linesSurviving)} of ${fmtCount(ls.linesAuthored)} authored lines still on-branch, across ${fmtCount(ls.sessionsRated)} matured sessions.`,
      });
    },
  },
  {
    id: 'stuck-rate',
    section: 'outcomes',
    label: 'Stuck rate',
    hint: 'Share of in-flight sessions the watch flagged as looping.',
    read: (r) =>
      rateCell(
        r.rollup.stuckness?.rate ?? null,
        'No in-flight session in this repo to check for a loop.',
      ),
  },
  {
    id: 'one-shot-rate',
    section: 'outcomes',
    label: 'One-shot rate',
    hint: 'Share of sessions that finished without a retry loop.',
    read: (r) =>
      rateCell(r.rollup.oneShotRate, 'No finished session in this repo to read retry cadence yet.'),
  },
  {
    id: 'tool-error-rate',
    section: 'outcomes',
    label: 'Tool error rate',
    hint: 'Share of tool calls that came back with an error.',
    read: (r) =>
      rateCell(r.rollup.errorRate, 'No tool-call error rate is available for this repo yet.'),
  },
  {
    id: 'commits-from-sessions',
    section: 'outcomes',
    label: 'Commits from sessions',
    hint: 'Commits landed during tracked sessions (not git ground-truth).',
    read: (r) => {
      const n = r.rollup.commitsFromSessions;
      if (n == null) return emptyCell('No session delta measured commits in this window.');
      return valueCell(fmtCount(n), { hint: 'Summed from session.delta commitsLanded.' });
    },
  },
  // ── Work shape ──
  {
    id: 'branch-mix',
    section: 'work-shape',
    label: 'Branch work',
    hint: 'Most common branch work type at session start.',
    read: (r) => {
      const mix = r.rollup.workMix?.branchWorkTypeMix ?? [];
      if (mix.length === 0) return emptyCell('No branch work type recorded in this window.');
      const top = mix[0];
      const total = mix.reduce((s, x) => s + x.sessions, 0);
      return visualEnumCell('branchWork', top.workType, {
        sub: topShare(top.sessions, total),
      });
    },
  },
  {
    id: 'top-end-reason',
    section: 'work-shape',
    label: 'How sessions ended',
    hint: 'The most common way sessions wrapped up (not a completion grade).',
    read: (r) => {
      const reasons = r.rollup.endReasons ?? [];
      if (reasons.length === 0) {
        return emptyCell('No session in this repo has ended with a recorded reason.');
      }
      const top = reasons.reduce((best, x) => (x.count > best.count ? x : best), reasons[0]);
      const total = reasons.reduce((sum, x) => sum + x.count, 0);
      const share = total > 0 ? Math.round((top.count / total) * 100) : null;
      return valueCell(endReasonLabel(top.reason), {
        sub: share != null ? `${share}% of ended sessions` : undefined,
        hint: `${fmtCount(top.count)} of ${fmtCount(total)} ended sessions.`,
      });
    },
  },
  {
    id: 'top-verification',
    section: 'work-shape',
    label: 'Top failing check',
    hint: 'The verification kind that failed most in this repo.',
    read: (r) => {
      const withFailures = (r.rollup.verification ?? [])
        .map((v) => ({ kind: v.kind, failed: v.runs - v.passed }))
        .filter((v) => v.failed > 0);
      if (withFailures.length === 0) {
        return emptyCell('No verification check has failed in this repo.');
      }
      const top = withFailures.reduce((best, x) => (x.failed > best.failed ? x : best));
      return valueCell(VERIFICATION_KIND_LABEL[top.kind] ?? top.kind, {
        sub: `${fmtCount(top.failed)} failed`,
      });
    },
  },
  {
    id: 'top-tool',
    section: 'work-shape',
    label: 'Top tool',
    hint: 'Most-used tool in this repo over the window.',
    read: (r) => {
      const tools = r.rollup.byTool ?? [];
      if (tools.length === 0) return emptyCell('No tool calls in this repo yet.');
      const top = tools[0];
      const total = tools.reduce((s, t) => s + t.calls, 0);
      return valueCell(top.tool, { sub: topShare(top.calls, total) });
    },
  },
  {
    id: 'top-model',
    section: 'work-shape',
    label: 'Top model',
    hint: 'Highest-spend model in this repo when priced.',
    read: (r) => {
      const models = r.rollup.byModel ?? [];
      if (models.length === 0) return emptyCell('No model usage in this repo yet.');
      const top = models[0];
      const sub =
        top.costUsd != null ? formatCost(top.costUsd, 2) : `${fmtCount(top.calls)} calls`;
      return valueCell(formatModel(top.model), { sub });
    },
  },
  {
    id: 'top-file',
    section: 'work-shape',
    label: 'Busiest file',
    hint: 'The file with the most edits in this repo.',
    read: (r) => {
      const files = r.rollup.codebaseFiles ?? [];
      if (files.length === 0) return emptyCell('No file edits recorded in this repo yet.');
      const top = files[0];
      return valueCell(fileDisplay(top), { sub: `${fmtCount(top.edits)} edits` });
    },
  },
  {
    id: 'top-directory',
    section: 'work-shape',
    label: 'Busiest directory',
    hint: 'Directory with the most attributed edits.',
    read: (r) => {
      const dirs = r.rollup.codebaseDirectories ?? [];
      if (dirs.length === 0) return emptyCell('No directory edits recorded in this repo yet.');
      const top = dirs[0];
      return valueCell(dirDisplay(top), {
        sub: top.share > 0 ? `${Math.round(top.share * 100)}% of dir edits` : undefined,
      });
    },
  },
  {
    id: 'rework-file',
    section: 'work-shape',
    label: 'Most reworked file',
    hint: 'File touched across the most sessions.',
    read: (r) => {
      const rework = r.rollup.codebaseRework ?? [];
      if (rework.length === 0) return emptyCell('No rework pattern in this repo yet.');
      const top = rework[0];
      return valueCell(fileDisplay(top), {
        sub: `${fmtCount(top.sessions)} sessions, ${fmtCount(top.edits)} edits`,
      });
    },
  },
  // ── Cadence and git ──
  {
    id: 'peak-time',
    section: 'cadence',
    label: 'Peak time',
    hint: 'Hour bucket with the most session starts in this window.',
    read: (r) => {
      const peak = r.rollup.workMix?.peakHour;
      if (!peak) return emptyCell('No session-start rhythm in this window.');
      return valueCell(formatPeakHour(peak.dow, peak.hour), {
        sub: `${fmtCount(peak.sessions)} sessions`,
      });
    },
  },
  {
    id: 'typical-session',
    section: 'cadence',
    label: 'Typical session',
    hint: 'Median ended-session duration in this window.',
    read: (r) => {
      const secs = r.rollup.workMix?.sessionDurationMedianSeconds;
      if (secs == null) return emptyCell('No ended session in this window to measure duration.');
      return valueCell(formatDuration(secs));
    },
  },
  {
    id: 'git-commits',
    section: 'cadence',
    label: 'Git commits',
    hint: "Commits landed in git's own trailing window (independent of the range above).",
    read: (r) => {
      const m = r.momentum;
      if (!m) return emptyCell('No git commit seen in this repo yet.');
      return valueCell(fmtCount(m.commits), {
        sub: `${fmtCount(m.filesTouched)} files touched`,
        hint: `Git ground-truth over its trailing ${m.windowDays}-day window, not the range above.`,
      });
    },
  },
  {
    id: 'last-active',
    section: 'cadence',
    label: 'Last active',
    hint: 'When Seorak last saw activity in this repo.',
    read: (r) => {
      const rel = formatRelativeTime(r.rollup.lastEventAt);
      return rel == null ? emptyCell() : valueCell(rel);
    },
  },
  // ── Attention ──
  {
    id: 'interventions',
    section: 'attention',
    label: 'Interventions',
    hint: 'Watch-limit trips for this repo in the window (count only).',
    read: (r) => {
      const n = r.rollup.interventionFires;
      if (n === undefined) return valueCell('0');
      return valueCell(fmtCount(n));
    },
  },
];

export function resolveRepo(overview: OverviewSnapshot, requested: string): ResolvedRepo {
  const key = requested.trim();
  if (key.length === 0) {
    return { requested: '', status: 'empty', data: null, ambiguous: false };
  }
  const idMatch = overview.usage.projects.find((p) => p.repoId === key);
  // Read old basename deep links while all newly written links use stable ids.
  // A colliding legacy basename remains visibly ambiguous instead of silently
  // changing the URL to whichever rollup happened to sort first.
  const matches = idMatch
    ? [idMatch]
    : overview.usage.projects.filter((p) => p.project === key);
  if (matches.length === 0) {
    return { requested: key, status: 'unknown', data: null, ambiguous: false };
  }
  const rollup = matches[0];
  const momentum = overview.usage.momentum.find((m) => m.repoId === rollup.repoId) ?? null;
  const temperature =
    overview.usage.portfolio.repos.find((t) => t.repoId === rollup.repoId) ?? null;
  return {
    requested: key,
    status: 'ok',
    data: { project: rollup.project, repoId: rollup.repoId, rollup, momentum, temperature },
    ambiguous: matches.length > 1,
  };
}

export function compareRepoOptions(overview: OverviewSnapshot): CompareRepoOption[] {
  return [...overview.usage.projects]
    .sort((a, b) => b.sessions - a.sessions)
    .map((p) => ({
      value: p.repoId,
      label: p.project || 'Unlabeled repo',
      repoId: p.repoId,
    }));
}

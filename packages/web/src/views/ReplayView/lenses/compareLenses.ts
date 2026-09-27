// The two comparisons: session against session, range against previous range.
//
// Direction is deliberate and narrow. Only attention and uncommitted files
// carry one; cost, tokens, elapsed, tool calls, and messages are reported
// without a verdict, because more spend is not by itself worse and Seorak does
// not grade the developer.

import type { SessionSummary } from '../../../lib/apiSchemas.js';
import { formatDuration } from '../../../lib/utils.js';
import { formatCost, formatTokens } from '../../../widgets/utils.js';
import { buildReplayReviewBase, type ReplaySessionReviewRow } from '../replayReviewModel.js';
import { repoIdFor } from '../replaySessionHelpers.js';
import type {
  ReplayLensInput,
  ReplayLensResult,
  ReplayLensRow,
  ReplayLensTone,
} from './types.js';
import { coverageFor, countLabel, emptyResult } from './shared.js';

type CompareFormat = 'cost' | 'tokens' | 'count' | 'duration';
type CompareDirection = 'higher-worse' | 'higher-better' | null;

interface CompareMetric {
  key: string;
  label: string;
  aValue: number;
  bValue: number;
  format: CompareFormat;
  /** null when the baseline is zero — a share of nothing is not a number. */
  deltaPct: number | null;
  direction: CompareDirection;
}

function metric(
  key: string,
  label: string,
  aValue: number,
  bValue: number,
  format: CompareFormat,
  direction: CompareDirection = null,
): CompareMetric {
  return {
    key,
    label,
    aValue,
    bValue,
    format,
    deltaPct: aValue === 0 ? null : (bValue - aValue) / aValue,
    direction,
  };
}

function formatValue(value: number, format: CompareFormat): string {
  if (format === 'cost') return formatCost(value);
  if (format === 'tokens') return formatTokens(value);
  if (format === 'duration') return formatDuration(Math.round(value / 60_000));
  return value.toLocaleString();
}

function formatDelta(item: CompareMetric): string {
  // A null delta means the A side was zero. If B is zero too, neither period had
  // any of this, which is a fact and not a missing number.
  if (item.deltaPct == null) return item.bValue > 0 ? 'new' : 'neither';
  if (item.deltaPct === 0) return 'no change';
  const pct = Math.abs(item.deltaPct * 100);
  const sign = item.deltaPct > 0 ? '+' : '−';
  return `${sign}${pct >= 100 ? Math.round(pct) : pct.toFixed(pct < 10 ? 1 : 0)}%`;
}

/** Tone for a delta, given the metric's direction. Neutral when undirected. */
export function compareTone(item: CompareMetric): ReplayLensTone {
  if (!item.direction || item.deltaPct == null || item.deltaPct === 0) return 'neutral';
  const rose = item.deltaPct > 0;
  if (item.direction === 'higher-worse') return rose ? 'negative' : 'positive';
  return rose ? 'positive' : 'negative';
}

function metricRows(metrics: CompareMetric[]): ReplayLensRow[] {
  return metrics.map((item) => ({
    id: item.key,
    label: item.label,
    value: item.deltaPct ?? 0,
    display: formatDelta(item),
    cells: [
      formatValue(item.aValue, item.format),
      formatValue(item.bValue, item.format),
      formatDelta(item),
    ],
    cellTones: [undefined, undefined, compareTone(item)],
  }));
}

export function compareSessionMetrics(
  a: ReplaySessionReviewRow,
  b: ReplaySessionReviewRow,
): CompareMetric[] {
  return [
    metric('duration', 'Elapsed', a.durationMs, b.durationMs, 'duration'),
    metric('cost', 'Cost', a.costUsd, b.costUsd, 'cost'),
    metric('tokens', 'Tokens', a.tokensTotal, b.tokensTotal, 'tokens'),
    metric('toolCalls', 'Tool calls', a.toolCallCount, b.toolCallCount, 'count'),
    metric('prompts', 'Messages sent', a.promptCount, b.promptCount, 'count'),
    metric('attention', 'Needs attention', a.attentionCount, b.attentionCount, 'count', 'higher-worse'),
    metric('revisit', 'Worth revisiting', a.highlightCount, b.highlightCount, 'count'),
    metric(
      'uncommitted',
      'Uncommitted at end',
      a.filesTouchedUncommitted,
      b.filesTouchedUncommitted,
      'count',
      'higher-worse',
    ),
  ];
}

export function computeSessionCompare(input: ReplayLensInput): ReplayLensResult {
  const base = buildReplayReviewBase(input.lanes, input.timeline);
  const coverage = coverageFor(input, base.allItems.length, false);
  const picked = input.compareSessionIds
    .map((id) => base.sessionRows.find((row) => row.sessionId === id))
    .filter((row): row is ReplaySessionReviewRow => Boolean(row));

  if (picked.length < 2) {
    return emptyResult(
      'session-compare',
      'compare-rows',
      'Pick two sessions in the Sessions lens to compare them.',
      coverage,
    );
  }

  const [a, b] = picked as [ReplaySessionReviewRow, ReplaySessionReviewRow];
  const metrics = compareSessionMetrics(a, b);

  return {
    id: 'session-compare',
    viz: 'compare-rows',
    headline: `${b.label} against ${a.label}. Change reads from the first to the second.`,
    rows: metricRows(metrics),
    columns: ['Metric', a.label, b.label, 'Change'],
    empty: null,
    coverage,
  };
}

export interface ReplayPeriodTotals {
  sessionCount: number;
  projectCount: number;
  durationMs: number;
  costUsd: number;
  tokensTotal: number;
  toolCallCount: number;
}

export const EMPTY_PERIOD_TOTALS: ReplayPeriodTotals = {
  sessionCount: 0,
  projectCount: 0,
  durationMs: 0,
  costUsd: 0,
  tokensTotal: 0,
  toolCallCount: 0,
};

/**
 * Period totals from session summaries, so a range comparison does not need
 * every replay payload loaded. Membership uses the session's last event, the
 * same anchor the range filter uses.
 */
export function periodTotalsFor(
  sessions: SessionSummary[],
  startMs: number,
  endMs: number,
): ReplayPeriodTotals {
  const totals = { ...EMPTY_PERIOD_TOTALS };
  const projects = new Set<string>();

  for (const session of sessions) {
    const anchor = Date.parse(session.lastEventAt || session.startedAt);
    if (Number.isNaN(anchor) || anchor < startMs || anchor >= endMs) continue;
    totals.sessionCount += 1;
    totals.durationMs += Math.max(0, (session.elapsedSeconds ?? 0) * 1000);
    totals.costUsd += session.costUsd ?? 0;
    totals.tokensTotal += session.tokens?.total ?? 0;
    totals.toolCallCount += session.toolCallCount ?? 0;
    projects.add(repoIdFor(session, session.sessionId));
  }

  totals.projectCount = projects.size;
  return totals;
}

export function comparePeriodMetrics(
  previous: ReplayPeriodTotals,
  current: ReplayPeriodTotals,
): CompareMetric[] {
  return [
    metric('sessions', 'Sessions', previous.sessionCount, current.sessionCount, 'count'),
    metric('projects', 'Projects touched', previous.projectCount, current.projectCount, 'count'),
    metric('duration', 'Elapsed', previous.durationMs, current.durationMs, 'duration'),
    metric('cost', 'Cost', previous.costUsd, current.costUsd, 'cost'),
    metric('tokens', 'Tokens', previous.tokensTotal, current.tokensTotal, 'tokens'),
    metric('toolCalls', 'Tool calls', previous.toolCallCount, current.toolCallCount, 'count'),
  ];
}

export function computePeriodCompare(input: ReplayLensInput): ReplayLensResult {
  const coverage = coverageFor(input, 0, false);
  const windowMs = input.rangeDays * 86_400_000;
  const current = periodTotalsFor(input.sessions, input.nowMs - windowMs, input.nowMs + 1);
  const previous = periodTotalsFor(input.sessions, input.nowMs - windowMs * 2, input.nowMs - windowMs);

  if (previous.sessionCount === 0) {
    return emptyResult(
      'period-compare',
      'compare-rows',
      `Nothing was captured in the ${input.rangeDays} days before this window.`,
      coverage,
    );
  }

  const metrics = comparePeriodMetrics(previous, current);
  const costDelta = metrics.find((item) => item.key === 'cost');

  return {
    id: 'period-compare',
    viz: 'compare-rows',
    headline: `${countLabel(current.sessionCount, 'session')} this window against ${countLabel(previous.sessionCount, 'session')} before it${
      costDelta && costDelta.deltaPct != null ? `; cost ${formatDelta(costDelta)}` : ''
    }. Both columns fold session totals, not loaded replays.`,
    rows: metricRows(metrics),
    columns: ['Metric', `Previous ${input.rangeDays}d`, `Last ${input.rangeDays}d`, 'Change'],
    empty: null,
    coverage,
  };
}

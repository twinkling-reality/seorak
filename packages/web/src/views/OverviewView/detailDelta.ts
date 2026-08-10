import { formatCost } from '../../widgets/utils.js';

/**
 * Shared delta helpers for the OverviewView detail surfaces (Usage, Outcomes,
 * Activity, Tools). Each detail view's tab strip shows a scalar value with a
 * small arrow+magnitude caption underneath.
 *
 * ONE comparator everywhere: this window vs the adjacent prior window (the
 * worker's PeriodDelta, computed from the never-pruned event log). The old
 * `splitDelta` half-window comparison was deleted 2026-07-03: it hung a
 * second meaning on the same glyph, and its stated justification (a 30-day
 * retention emptying the prior window) was stale — no event row is ever
 * deleted. A tab without a prior-window aggregate renders MISSING_DELTA,
 * never a silently different comparison.
 *
 * Neutral ink on purpose: a delta reports direction (the arrow), never a
 * verdict — success/danger paint on movement is a grade Seorak refuses.
 */
export const MISSING_DELTA = { text: '-', color: 'var(--soft)' } as const;

/**
 * Format a prior-window count delta into an arrow + magnitude caption
 * matching the StatWidget convention (`↑26`, `↓4`, `→0`). Returns the
 * placeholder when the comparison can't be established (no previous data,
 * or `previous <= 0` which is divide-by-infinity territory).
 */
export function formatCountDelta(
  delta: { current: number; previous: number | null } | null,
): { text: string; color: string } {
  if (!delta || delta.previous == null || delta.previous <= 0) return MISSING_DELTA;
  const d = delta.current - delta.previous;
  const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
  const magnitude = String(Math.abs(Math.round(d * 10) / 10));
  return { text: `${arrow}${magnitude}`, color: 'var(--muted)' };
}

/** USD-flavored prior-window delta formatter. */
export function formatUsdDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  digits: number,
): { text: string; color: string } {
  if (current == null || previous == null || previous <= 0) return MISSING_DELTA;
  const d = current - previous;
  const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '→';
  return { text: `${arrow}${formatCost(Math.abs(d), digits)}`, color: 'var(--muted)' };
}

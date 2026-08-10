import { OVERVIEW_RANGE_DAYS, type OverviewRangeDays } from '@seorak/types';

// ── View-specific constants ───────────────────────
// Widget-shared utilities (work types, colors, formatters, heatmap helpers)
// live in packages/web/src/widgets/utils.ts. This file intentionally keeps
// only exports that the OverviewView shell itself consumes.

/** Derived from the shared contract, never re-listed: the picker must not offer
 *  a window the worker does not serve. See `@seorak/types` OVERVIEW_RANGE_DAYS. */
export const RANGES = OVERVIEW_RANGE_DAYS;
export type RangeDays = OverviewRangeDays;

/**
 * The windows this deployment's plan will actually build, given the ceiling the
 * worker advertised on its last snapshot (docs/specs/pricing.md).
 *
 * This is the "advertise" half of the entitlement, and it is what keeps the
 * ceiling honest rather than merely enforced. Every widget caption reads the
 * window off the RESPONSE ("in the last 30 days") while the pills hold their own
 * selection, so offering a pill the worker clamps would light "90" beside the
 * sentence "in the last 30 days" -- a card the reader cannot check, which
 * voice-and-scope forbids. Removing the pill removes the contradiction at its
 * source instead of explaining it afterward.
 *
 * Before the first snapshot lands there is no ceiling to know, so every supported
 * window is offered. That is safe because the worker clamps regardless, and it
 * avoids a picker that visibly shrinks a moment after load.
 */
export function allowedRanges(maxRangeDays: number | undefined): readonly RangeDays[] {
  if (maxRangeDays === undefined) return RANGES;
  return RANGES.filter((days) => days <= maxRangeDays);
}

// ── Shared scope subtitle formatter ────────────────
// Detail views share a subtitle format: the PRIMARY scope fact, count + labeled
// noun. One fact per element (Face ornament ban): the old middot-joined
// "5 sessions · 2 repos" put two facts in one caption, so the subtitle now
// carries only the leading part and the secondary count lives in the drill.
// Zero-count parts are dropped; plural fallback is `${singular}s`.
export interface ScopePart {
  count: number;
  singular: string;
  plural?: string;
}

export function formatScope(parts: ScopePart[]): string {
  const p = parts.find((part) => part.count > 0);
  if (!p) return '';
  return `${p.count} ${p.count === 1 ? p.singular : (p.plural ?? `${p.singular}s`)}`;
}

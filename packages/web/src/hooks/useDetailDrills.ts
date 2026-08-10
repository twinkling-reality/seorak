import { useCallback, useEffect, useMemo } from 'react';
import { useDetailDrill, type DetailDrill } from './useDetailDrill.js';
import { setQueryParam } from '../lib/router.js';
import { type DetailViewKey } from '../lib/router.js';

// One-stop access to every category-level detail drill. Both OverviewView
// and ProjectView mount the same six detail components (live / usage /
// outcomes / activity / tools / codebase — conversations and memory drilled
// surfaces are out of scope for the solo model), so the drill-tracking chain (one
// useDetailDrill per key, plus the Escape listener and the gating signal for
// keyboard shortcuts) is identical logic in two places. This helper
// centralizes that chain. Adding a new detail surface is one explicit
// useDetailDrill call here plus one mount call in the consumer.
//
// `drills` is keyed by DetailViewKey so callers index into it by name
// (`drills.usage.shifted`, `drills.live.close`). `anyOpen` is the OR of
// every drill's `shifted` flag, useful for gating keyboard shortcuts
// and for widening analytics fetch gates so opening a detail drill from
// a non-analytical surface does not paint an empty fixture. `closeAll`
// clears the active drill plus the live aux param.
//
// Hooks rule note: each useDetailDrill call below is a top-level hook
// call inside this hook, so the call order is stable across renders.
// Listing them explicitly (rather than mapping over DETAIL_DRILL_KEYS)
// keeps the eslint rules-of-hooks check happy and makes the dependency
// list of the per-key drill explicit at the call site.

export interface DetailDrills {
  /** Keyed access to each detail drill (param value, shifted flag, close fn). */
  drills: Record<DetailViewKey, DetailDrill>;
  /** True iff any detail drill is currently open. */
  anyOpen: boolean;
  /**
   * The single open drill's key (null when none), in a fixed precedence. Drives
   * the `dashboardDrillKey` route transition in both dashboards so the
   * open-which-detail derivation lives here, not duplicated per view.
   */
  activeKey: DetailViewKey | null;
  /** Close every drill plus the live-tab aux param in one go. */
  closeAll: () => void;
}

export function useDetailDrills(): DetailDrills {
  const live = useDetailDrill('live');
  const usage = useDetailDrill('usage');
  const outcomes = useDetailDrill('outcomes');
  const activity = useDetailDrill('activity');
  const tools = useDetailDrill('tools');
  const codebase = useDetailDrill('codebase');

  const drills = useMemo<Record<DetailViewKey, DetailDrill>>(
    () => ({ live, usage, outcomes, activity, tools, codebase }),
    [live, usage, outcomes, activity, tools, codebase],
  );

  const anyOpen =
    live.shifted ||
    usage.shifted ||
    outcomes.shifted ||
    activity.shifted ||
    tools.shifted ||
    codebase.shifted;

  const activeKey: DetailViewKey | null = live.shifted
    ? 'live'
    : usage.shifted
      ? 'usage'
      : outcomes.shifted
        ? 'outcomes'
        : activity.shifted
          ? 'activity'
          : tools.shifted
            ? 'tools'
            : codebase.shifted
              ? 'codebase'
              : null;

  const closeAll = useCallback(() => {
    // Clear the live-tab aux param (only meaningful while live is open)
    // and the shared `q` question param (carries sort/section intent
    // into the active detail view, so it would otherwise leak when the
    // next drill opens). Then close the active drill. Other drills are
    // already null in practice; calling close() on them is a no-op.
    setQueryParam('live-tab', null);
    setQueryParam('q', null);
    if (live.shifted) live.close();
    if (usage.shifted) usage.close();
    if (outcomes.shifted) outcomes.close();
    if (activity.shifted) activity.close();
    if (tools.shifted) tools.close();
    if (codebase.shifted) codebase.close();
  }, [live, usage, outcomes, activity, tools, codebase]);

  // Escape closes whichever detail view is open. One listener regardless
  // of how many drill-ins exist; adding a category is a one-line change
  // above rather than another Escape branch.
  useEffect(() => {
    if (!anyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyOpen, closeAll]);

  return { drills, anyOpen, activeKey, closeAll };
}

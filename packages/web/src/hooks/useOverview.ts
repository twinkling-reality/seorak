// The overview data hook: fetches and caches the OverviewSnapshot for the
// dashboard. Returns a single flat OverviewSnapshot:
//   - ?demo active  → getDemoData(scenario).overview (short-circuit, no network)
//   - else          → the polling store's /overview snapshot (30s poll), with
//                     the range driven into the store so the window matches.
// Returns { overview, isLoading, error }.

import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePollingStore, setOverviewRange } from '../lib/stores/polling.js';
import {
  type Intervention,
  type OverviewSnapshot,
} from '../lib/apiSchemas.js';
import type { DataStatus } from '../lib/stores/pollingTypes.js';
import { allowedRanges, type RangeDays } from '../views/OverviewView/overview-utils.js';
import { getDemoData } from '../lib/demo/index.js';
import { buildDemoInterventions } from '../lib/demo/interventions.js';
import { useDemoScenario } from './useDemoScenario.js';
import { deriveOverviewViewState, mergeLiveOverview } from './overviewViewState.js';

export interface UseOverviewResult {
  overview: OverviewSnapshot;
  isLoading: boolean;
  /** A HARD error: the worker is unreachable AND we have no prior snapshot to
   *  show, so the view has nothing to render but the failure. Null the moment we
   *  hold any snapshot — a transient 503 mid-poll must never blank a live board. */
  error: string | null;
  /** We are showing a PRIOR snapshot because the last refresh failed (worker slow /
   *  503 / offline). The dashboard keeps rendering; the view surfaces a "reconnecting"
   *  banner instead of dying. */
  isStale: boolean;
}

export function useOverview(rangeDays: number): UseOverviewResult {
  const demo = useDemoScenario();

  // Keep the poll window in sync with the picker. Demo also uses this so
  // store-backed surfaces see the same range-aware fixture as the view.
  useEffect(() => {
    setOverviewRange(rangeDays);
  }, [rangeDays]);

  const { overviewData, overviewStatus, pollError, liveSessions } = usePollingStore(
    useShallow((s) => ({
      overviewData: s.overviewData,
      overviewStatus: s.overviewStatus,
      pollError: s.pollError,
      liveSessions: s.liveSessions,
    })),
  );

  // Override overview.live with the fast /live loop's fresh board. The /live set
  // is the SAME genuinely-live sessions overview.live carries, just always fresh
  // (DATA-LAYER §ADR-002) — so every overview.live consumer (the hero board,
  // ProjectView) gets the live feel transparently. Memoized so the
  // merged identity is stable between renders (no downstream useMemo churn).
  // `liveSessions === null` (before the first /live, or in demo) keeps the
  // /overview board, so the hero is never empty on first paint.
  const liveOverview = useMemo<OverviewSnapshot>(
    () => mergeLiveOverview(overviewData, liveSessions, rangeDays),
    [overviewData, liveSessions, rangeDays],
  );

  if (demo.active) {
    return {
      overview: getDemoData(demo.scenarioId, rangeDays).overview,
      isLoading: false,
      error: null,
      isStale: false,
    };
  }

  return {
    overview: liveOverview,
    ...deriveOverviewViewState(overviewData, overviewStatus, pollError),
  };
}

/** One selectable project, for a scope picker. */
export interface ProjectOption {
  repoId: string;
  project: string;
  sessions: number;
}

const NO_PROJECTS: readonly ProjectOption[] = [];

/**
 * The tracked projects, for a surface that offers a scope picker.
 *
 * Reads the polling store directly and deliberately does NOT call
 * `setOverviewRange`, which is what `useOverview` does: a page with its own
 * window (Model) must not move the shared /overview poll window as a side effect
 * of listing the projects a reader can scope to. The list is the same either way
 * — a project is in the picker because it has sessions, and which window that was
 * measured over does not change what the picker is for.
 */
export function useProjectOptions(rangeDays: number): readonly ProjectOption[] {
  const demo = useDemoScenario();
  const stored = usePollingStore((s) => s.overviewData?.usage.projects);
  // `getDemoData` REBUILDS the whole scenario — every rollup, every series — on
  // each call, so it is memoized on the scenario rather than run per render just
  // to read a project list off the result.
  const demoProjects = useMemo(
    () =>
      demo.active
        ? getDemoData(demo.scenarioId, rangeDays).overview.usage.projects
        : undefined,
    [demo.active, demo.scenarioId, rangeDays],
  );
  const projects = demoProjects ?? stored;
  return useMemo(
    () =>
      projects
        ? // An archived project is out of every scope picker for the same
          // reason it is out of the sidebar: it is still measured and still
          // restorable, it just is not somewhere you are choosing to look.
          projects
            .filter((p) => !p.archived)
            .map((p) => ({ repoId: p.repoId, project: p.project, sessions: p.sessions }))
        : NO_PROJECTS,
    [projects],
  );
}

/**
 * The windows the range pickers may offer, narrowed to the plan ceiling the
 * worker advertised (docs/specs/pricing.md).
 *
 * A hook off the store rather than a prop so a nested detail view does not have
 * to thread the ceiling down through every parent that happens to sit above a
 * pill row. Reads `overviewData` directly (not the scaffolded snapshot) so the
 * pre-first-poll case is `undefined` and every supported window is offered,
 * rather than a picker that shrinks a moment after load.
 */
export function useAllowedRanges(): readonly RangeDays[] {
  const maxRangeDays = usePollingStore((s) => s.overviewData?.maxRangeDays);
  return useMemo(() => allowedRanges(maxRangeDays), [maxRangeDays]);
}

export interface LiveFreshness {
  /** Server compute time of the last /live response (ISO), or null in demo / before
   *  the first poll — the "updated N ago" source. */
  generatedAt: string | null;
  /** 'ready' fresh · 'stale' keeping a prior board after a failure · 'error' never
   *  reached the worker. Lets the cue degrade visibly instead of freezing silently. */
  status: DataStatus;
}

/** Freshness of the live board for the "updated N ago" cue. Null/ready in demo —
 *  a scenario board has no server freshness to report. */
export function useLiveFreshness(): LiveFreshness {
  const demo = useDemoScenario();
  const { generatedAt, status } = usePollingStore(
    useShallow((s) => ({ generatedAt: s.liveGeneratedAt, status: s.liveStatus })),
  );
  if (demo.active) return { generatedAt: null, status: 'ready' };
  return { generatedAt, status };
}

/**
 * Fired interventions for the watch panel. Mirrors useOverview's demo short-
 * circuit: in demo mode the list is derived from the demo overview (so the panel
 * demonstrates the live wedge); otherwise it reads the polling store's
 * /interventions snapshot plus its independent freshness state. An empty array
 * is evidence of "nothing fired" only when status is ready.
 */
export interface UseInterventionsResult {
  interventions: Intervention[];
  status: DataStatus;
}

export function useInterventions(): UseInterventionsResult {
  const demo = useDemoScenario();
  const { interventions, status, overviewData } = usePollingStore(
    useShallow((s) => ({
      interventions: s.interventions,
      status: s.interventionsStatus,
      overviewData: s.overviewData,
    })),
  );

  if (demo.active) {
    const rangeDays = overviewData?.rangeDays ?? 30;
    return {
      interventions: buildDemoInterventions(
        getDemoData(demo.scenarioId, rangeDays).overview,
      ),
      status: 'ready',
    };
  }
  return { interventions, status };
}

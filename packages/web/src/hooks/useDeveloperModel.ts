import { useEffect, useMemo } from 'react';

import { getDemoData } from '../lib/demo/index.js';
import { createEmptyDeveloperModel, validateDeveloperModel } from '../lib/schemas/developer-model.js';
import type { DeveloperModelSnapshot } from '@seorak/types';
import { fetchModel, useModelStore, type ModelRangeDays } from '../lib/stores/model.js';
import type { DataStatus } from '../lib/stores/pollingTypes.js';
import { compileSnapshotToPresentation } from '../views/ModelView/compileSnapshotToPresentation.js';
import type { ModelPresentation } from '../views/ModelView/modelPresentationTypes.js';
import { useDemoScenario } from './useDemoScenario.js';

export interface UseDeveloperModelResult {
  snapshot: DeveloperModelSnapshot;
  presentation: ModelPresentation;
  isLoading: boolean;
  /** A HARD error: the worker is unreachable AND we hold no prior snapshot, so the
   *  view has nothing to render but the failure. Null the moment we hold any
   *  snapshot — a transient 503 mid-refresh must never blank a loaded read. */
  error: string | null;
  /** Showing a PRIOR snapshot because the last refresh failed (worker slow / 503).
   *  The read keeps rendering; the view surfaces a reconnecting cue. */
  isStale: boolean;
}

function demoDeveloperModelSnapshot(
  scenarioId: string,
  rangeDays: 7 | 30 | 90,
): DeveloperModelSnapshot {
  const data = getDemoData(scenarioId, rangeDays);
  return validateDeveloperModel(data.developerModel ?? createEmptyDeveloperModel(rangeDays));
}

/**
 * How a model fetch result maps to the view's loading / hard-error / stale
 * contract — the same load-bearing rule as deriveOverviewViewState: once we hold
 * ANY snapshot, a failed fetch degrades to `isStale`, never a hard `error`.
 */
export function deriveModelViewState(
  snapshot: DeveloperModelSnapshot | null,
  status: DataStatus,
  error: string | null,
): { isLoading: boolean; error: string | null; isStale: boolean } {
  return {
    isLoading: !snapshot && (status === 'idle' || status === 'loading'),
    error: snapshot ? null : error,
    isStale: snapshot !== null && status === 'stale',
  };
}

export function useDeveloperModel(
  rangeDays: ModelRangeDays,
  options: { displayName: string; repoId?: string | null } = { displayName: 'You' },
): UseDeveloperModelResult {
  const { active: demoActive, scenarioId } = useDemoScenario();
  const repoId = options.repoId ?? null;
  const displayName = options.displayName;

  // Non-demo reads flow through the module-level model store: the snapshot + ETag
  // persist across navigations, so a revisit reuses the last portrait and
  // revalidates with a cheap conditional GET instead of a cold rebuild.
  const storeSnapshot = useModelStore((s) => s.snapshot);
  const storeStatus = useModelStore((s) => s.status);
  const storeError = useModelStore((s) => s.error);

  useEffect(() => {
    if (demoActive) return;
    void fetchModel(rangeDays, repoId);
  }, [rangeDays, repoId, demoActive]);

  // Demo derives locally from the scenario fixture (no network, no store) so the
  // switcher swaps every dashboard hook in lockstep.
  const demoSnapshot = useMemo(
    () => (demoActive ? demoDeveloperModelSnapshot(scenarioId, rangeDays) : null),
    [demoActive, scenarioId, rangeDays],
  );

  const snapshot = demoActive
    ? demoSnapshot!
    : (storeSnapshot ?? createEmptyDeveloperModel(rangeDays));

  const view = demoActive
    ? { isLoading: false, error: null, isStale: false }
    : deriveModelViewState(storeSnapshot, storeStatus, storeError);

  // The reader's clock is read ONCE and passed in, matching AgentsView. Every
  // rhythm claim in the portrait is a shift off the worker's UTC hour buckets, so
  // the offset is a real input to the compile and belongs in its dependency list
  // rather than being reached for ambiently inside a pure function.
  const offsetMinutes = useMemo(() => new Date().getTimezoneOffset(), []);

  const presentation = useMemo(
    () => compileSnapshotToPresentation(snapshot, { displayName, offsetMinutes }),
    [snapshot, displayName, offsetMinutes],
  );

  return { snapshot, presentation, ...view };
}

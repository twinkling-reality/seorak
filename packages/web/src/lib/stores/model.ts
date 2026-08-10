// The developer-model (introspection) client cache. The Model page is fetched
// on-demand, not polled with /overview — but it used to fetch cold on EVERY mount
// (no ETag persistence, no snapshot reuse), so each visit re-ran the worker's heavy
// aggregate even right after Overview had loaded. This module gives it the same
// client discipline the polling store gives /overview:
//   - the snapshot + ETag persist at module scope, so navigating away and back
//     reuses the last portrait and revalidates with a cheap conditional GET (304);
//   - a warm snapshot never re-enters the full loading state (mirror
//     deriveOverviewViewState) — a failed refresh degrades to `stale`, never a hard
//     error, so a transient 503 never blanks a loaded read;
//   - `prefetchModel` warms it once on idle after Overview lands, so the first click
//     into Model is instant instead of paying the cold build.
// Single-slot (one scope at a time), matching the Model page which shows one
// rangeDays + optional repoId scope. A scope change drops the ETag (a different
// window is a different body) but keeps the prior snapshot visible until the new one
// lands, exactly like setOverviewRange.

import { createStore, useStore } from 'zustand';
import { fetchDeveloperModel } from '../api.js';
import { validateDeveloperModel } from '../schemas/developer-model.js';
import {
  isAggregateCacheStale,
  type DeveloperModelSnapshot,
  type OverviewRangeDays,
} from '@seorak/types';
import { authActions } from './auth.js';
import { type DataStatus } from './pollingTypes.js';

/** Model aligns with Overview's default window (7d). A wider default made every
 *  first Model load pay the heavy 30d aggregate build; matching Overview keeps the
 *  cross-surface window consistent and the cold build cheap (same rationale as the
 *  Agents page 7d default). */
export const MODEL_DEFAULT_RANGE_DAYS = 7 as const;

export type ModelRangeDays = OverviewRangeDays;

interface ModelStoreState {
  snapshot: DeveloperModelSnapshot | null;
  status: DataStatus;
  /** HARD error string: set ONLY when there is no snapshot to show. Once we hold a
   *  snapshot a failed refresh degrades to `status: 'stale'` with `error: null`. */
  error: string | null;
}

interface InternalModelState {
  etag: string | null;
  scopeKey: string | null;
  rangeDays: ModelRangeDays;
  repoId: string | null;
  abort: AbortController | null;
  /** Scope of the request currently in flight, to dedupe a mount-revalidate against
   *  an idle prefetch already fetching the same body. */
  inFlightScope: string | null;
  /** One-shot guard so the idle prefetch fires at most once per session. */
  prefetched: boolean;
}

function createInternalModelState(): InternalModelState {
  return {
    etag: null,
    scopeKey: null,
    rangeDays: MODEL_DEFAULT_RANGE_DAYS,
    repoId: null,
    abort: null,
    inFlightScope: null,
    prefetched: false,
  };
}

const internal = createInternalModelState();

const modelStore = createStore<ModelStoreState>(() => ({
  snapshot: null,
  status: 'idle',
  error: null,
}));

function scopeKeyOf(rangeDays: ModelRangeDays, repoId: string | null): string {
  return `${rangeDays}:${repoId ?? 'all'}`;
}

function isAbortError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return 'name' in err && (err as { name?: unknown }).name === 'AbortError';
}

/** A read rejected by the owner-lock (armed worker, missing/stale token). The API
 *  client stamps `.status` on its thrown errors, so a 401 is detectable here. */
function isUnauthorized(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return 'status' in err && (err as { status?: unknown }).status === 401;
}

function formatError(err: unknown): string {
  if (typeof err === 'string') return err;
  const msg = err instanceof Error ? err.message : 'Something went wrong';
  if (msg.includes('Failed to fetch') || (err instanceof Error && err.name === 'TypeError')) {
    return 'Cannot reach the server. Check your connection.';
  }
  return msg || 'Failed to load developer model';
}

/**
 * Fetch (or revalidate) the developer model for a scope. Sends the stored ETag as
 * If-None-Match so an unchanged body comes back 304 and we keep the prior snapshot.
 * A warm snapshot revalidates in place (no loading flash); a failed refresh with a
 * snapshot in hand degrades to `stale`, never a hard error.
 */
export async function fetchModel(
  rangeDays: ModelRangeDays,
  repoId: string | null = null,
  opts: { force?: boolean } = {},
): Promise<void> {
  const scopeKey = scopeKeyOf(rangeDays, repoId);

  // Dedupe: a mount-revalidate that lands on the same scope an idle prefetch is
  // already fetching does nothing — the in-flight request will populate the store.
  if (!opts.force && internal.inFlightScope === scopeKey) return;

  const scopeChanged = internal.scopeKey !== scopeKey;
  // A different scope is a different body → the old ETag would 304 us into keeping
  // the previous scope's snapshot. Drop it so this fetch pulls the new body; the
  // prior snapshot stays visible (no flash to loading) until the new one lands.
  if (scopeChanged) internal.etag = null;

  internal.rangeDays = rangeDays;
  internal.repoId = repoId;

  if (internal.abort) internal.abort.abort();
  const controller = new AbortController();
  internal.abort = controller;
  internal.inFlightScope = scopeKey;

  // Only enter the full loading state when there is nothing to show yet.
  modelStore.setState((s) => ({ status: s.snapshot ? s.status : ('loading' as DataStatus) }));

  try {
    const result = await fetchDeveloperModel(rangeDays, {
      repoId,
      etag: internal.etag,
      signal: controller.signal,
    });
    if (result.notModified) {
      internal.scopeKey = scopeKey;
      modelStore.setState({
        status: isAggregateCacheStale(result.cacheStatus) ? 'stale' : 'ready',
        error: null,
      });
      return;
    }
    if (result.data === undefined) return;
    const snapshot = validateDeveloperModel(result.data);
    // A response does not own this cache slot until its body satisfies the
    // current contract. Saving its validators first could make a later 304 bless
    // malformed data while the UI kept showing an older portrait.
    internal.etag = result.etag;
    internal.scopeKey = scopeKey;
    modelStore.setState({
      snapshot,
      status: isAggregateCacheStale(result.cacheStatus) ? 'stale' : 'ready',
      error: null,
    });
  } catch (err) {
    if (isAbortError(err)) return;
    if (isUnauthorized(err)) {
      authActions.expireSession();
      return;
    }
    modelStore.setState((s) => ({
      status: (s.snapshot ? 'stale' : 'error') as DataStatus,
      error: s.snapshot ? null : formatError(err),
    }));
  } finally {
    if (internal.inFlightScope === scopeKey) internal.inFlightScope = null;
  }
}

/** Re-fetch the current scope, bypassing the dedupe/ETag (the Retry affordance). */
export function refreshModel(): void {
  internal.etag = null;
  void fetchModel(internal.rangeDays, internal.repoId, { force: true });
}

/**
 * Warm the model cache ONCE, on idle, after Overview has landed — so the first
 * navigation into Model is instant instead of paying the cold worker build. Never
 * blocks boot: it is scheduled on requestIdleCallback (setTimeout fallback) and
 * only for the default scope, so it adds at most one background aggregate build,
 * not a parallel cold build of every page.
 */
export function prefetchModel(rangeDays: ModelRangeDays = MODEL_DEFAULT_RANGE_DAYS): void {
  if (internal.prefetched) return;
  internal.prefetched = true;
  if (modelStore.getState().snapshot) return;
  const run = () => {
    if (!modelStore.getState().snapshot && internal.inFlightScope === null) {
      void fetchModel(rangeDays, null);
    }
  };
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 0);
  }
}

/** Clear the cache (logout / user switch) so a prior user's portrait never leaks. */
export function resetModelStore(): void {
  if (internal.abort) internal.abort.abort();
  Object.assign(internal, createInternalModelState());
  modelStore.setState({ snapshot: null, status: 'idle', error: null });
}

export function useModelStore<T>(selector: (state: ModelStoreState) => T): T {
  return useStore(modelStore, selector);
}

export const modelActions = {
  getState: (): ModelStoreState => modelStore.getState(),
};

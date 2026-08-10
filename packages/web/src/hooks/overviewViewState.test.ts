import { describe, it, expect } from 'vitest';
import { deriveOverviewViewState, mergeLiveOverview } from './overviewViewState.js';
import { createEmptyOverview } from '../lib/apiSchemas.js';

// The load-bearing contract behind the "screen randomly dies" fix: a transient
// /overview 503 must NEVER blank a view that already has a snapshot. Once data is
// held, a failed poll is `isStale` (kept board + reconnecting banner), not a hard
// `error` (full-death card).
describe('deriveOverviewViewState', () => {
  const snap = createEmptyOverview(7);

  it('is loading on the first fetch (no data yet)', () => {
    expect(deriveOverviewViewState(null, 'loading', null)).toEqual({
      isLoading: true,
      error: null,
      isStale: false,
    });
  });

  it('hard-errors only when there is NO snapshot to show', () => {
    expect(deriveOverviewViewState(null, 'error', 'GET /overview failed: 503')).toEqual({
      isLoading: false,
      error: 'GET /overview failed: 503',
      isStale: false,
    });
  });

  it('degrades a failed poll to stale (never a hard error) once a snapshot exists', () => {
    // The exact production case: we have a prior board, the latest poll 503'd.
    expect(deriveOverviewViewState(snap, 'stale', 'GET /overview failed: 503')).toEqual({
      isLoading: false,
      error: null,
      isStale: true,
    });
  });

  it('is clean (no error, not stale) on a healthy refresh', () => {
    expect(deriveOverviewViewState(snap, 'ready', null)).toEqual({
      isLoading: false,
      error: null,
      isStale: false,
    });
  });

  it('never re-enters loading once a snapshot is held', () => {
    expect(deriveOverviewViewState(snap, 'loading', null).isLoading).toBe(false);
  });
});

describe('mergeLiveOverview', () => {
  it('keeps aggregate live rows before the independent board answers', () => {
    const snap = createEmptyOverview(7);
    snap.live = [{ sessionId: 'aggregate-live' }] as never;

    expect(mergeLiveOverview(snap, null, 7)).toBe(snap);
  });

  it('treats an explicit empty live response as measured quiet', () => {
    const snap = createEmptyOverview(7);
    snap.live = [{ sessionId: 'ended' }] as never;

    const merged = mergeLiveOverview(snap, [], 7);
    expect(merged).not.toBe(snap);
    expect(merged.live).toEqual([]);
  });

  it('creates an honest empty aggregate only when neither read has data', () => {
    const merged = mergeLiveOverview(null, null, 30);
    expect(merged.rangeDays).toBe(30);
    expect(merged.live).toEqual([]);
  });
});

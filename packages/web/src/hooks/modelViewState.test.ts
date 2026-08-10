import { describe, it, expect } from 'vitest';
import { deriveModelViewState } from './useDeveloperModel.js';
import { createEmptyDeveloperModel } from '../lib/schemas/developer-model.js';

// Same load-bearing contract as deriveOverviewViewState: once a portrait is held, a
// failed refresh is `isStale` (kept read + reconnecting cue), never a hard `error`
// that blanks the whole Model page.
describe('deriveModelViewState', () => {
  const snap = createEmptyDeveloperModel(7);

  it('is loading on the first fetch (no snapshot yet)', () => {
    expect(deriveModelViewState(null, 'loading', null)).toEqual({
      isLoading: true,
      error: null,
      isStale: false,
    });
  });

  it('hard-errors only when there is NO snapshot to show', () => {
    expect(deriveModelViewState(null, 'error', 'GET /developer-model failed: 503')).toEqual({
      isLoading: false,
      error: 'GET /developer-model failed: 503',
      isStale: false,
    });
  });

  it('degrades a failed refresh to stale (never a hard error) once a snapshot exists', () => {
    expect(deriveModelViewState(snap, 'stale', 'GET /developer-model failed: 503')).toEqual({
      isLoading: false,
      error: null,
      isStale: true,
    });
  });

  it('is clean (no error, not stale) on a healthy refresh', () => {
    expect(deriveModelViewState(snap, 'ready', null)).toEqual({
      isLoading: false,
      error: null,
      isStale: false,
    });
  });

  it('never re-enters loading once a snapshot is held', () => {
    expect(deriveModelViewState(snap, 'loading', null).isLoading).toBe(false);
  });
});

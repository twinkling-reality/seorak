import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the network + auth so we drive fetchModel deterministically.
vi.mock('../../api.js', () => ({
  fetchDeveloperModel: vi.fn(),
}));
vi.mock('../auth.js', () => ({
  authActions: { expireSession: vi.fn() },
}));

import { fetchModel, refreshModel, resetModelStore, modelActions } from '../model.js';
import { fetchDeveloperModel } from '../../api.js';
import { authActions } from '../auth.js';
import { createEmptyDeveloperModel } from '../../schemas/developer-model.js';

const mockFetch = vi.mocked(fetchDeveloperModel);
const mockExpire = vi.mocked(authActions.expireSession);

function snap(rangeDays: 7 | 30 | 90 = 7) {
  return createEmptyDeveloperModel(rangeDays);
}

beforeEach(() => {
  resetModelStore();
  mockFetch.mockReset();
  mockExpire.mockReset();
});

describe('fetchModel — client cache discipline', () => {
  it('stores the snapshot and goes ready on a cold fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: snap(),
      etag: 'W/"v1.d7.mall"',
      cacheStatus: 'fresh',
    });
    await fetchModel(7, null);
    const s = modelActions.getState();
    expect(s.snapshot).not.toBeNull();
    expect(s.status).toBe('ready');
    expect(s.error).toBeNull();
  });

  it('persists the ETag and echoes it as If-None-Match on the next fetch (304 keeps the snapshot)', async () => {
    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: snap(),
      etag: 'W/"v1.d7.mall"',
      cacheStatus: 'fresh',
    });
    await fetchModel(7, null);

    mockFetch.mockResolvedValueOnce({
      notModified: true,
      etag: 'W/"v1.d7.mall"',
      cacheStatus: 'fresh',
    });
    await fetchModel(7, null, { force: true });

    // Second call carried the stored ETag.
    expect(mockFetch.mock.calls[1]?.[1]?.etag).toBe('W/"v1.d7.mall"');
    const s = modelActions.getState();
    expect(s.snapshot).not.toBeNull(); // kept across the 304
    expect(s.status).toBe('ready');
  });

  it('keeps the prior snapshot and marks it stale on a failed refresh', async () => {
    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: snap(),
      etag: 'e1',
      cacheStatus: 'fresh',
    });
    await fetchModel(7, null); // seed a real snapshot

    mockFetch.mockRejectedValueOnce(new Error('network down'));
    await fetchModel(7, null, { force: true });
    const s = modelActions.getState();
    expect(s.snapshot).not.toBeNull(); // NOT blanked
    expect(s.status).toBe('stale');
    expect(s.error).toBeNull(); // a held snapshot never hard-errors
  });

  it('marks a worker-supplied last-known-good portrait stale', async () => {
    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: snap(),
      etag: null,
      cacheStatus: 'revalidating',
    });
    await fetchModel(7, null);
    expect(modelActions.getState()).toMatchObject({
      status: 'stale',
      error: null,
    });
  });

  it('hard-errors (no snapshot to keep) when the first fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    await fetchModel(7, null);
    const s = modelActions.getState();
    expect(s.snapshot).toBeNull();
    expect(s.status).toBe('error');
    expect(s.error).toBeTruthy();
  });

  it('hard-errors without caching validators when a cold response is malformed', async () => {
    const malformed = snap() as unknown as { outcomes: Record<string, unknown> };
    delete malformed.outcomes.lineSurvival;
    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: malformed,
      etag: 'e-invalid',
      cacheStatus: 'fresh',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await fetchModel(7, null);

    warn.mockRestore();
    expect(modelActions.getState()).toEqual({
      snapshot: null,
      status: 'error',
      error: 'Invalid API response (developer-model)',
    });
  });

  it('keeps a warm portrait stale and rejects the malformed response ETag', async () => {
    const prior = snap();
    prior.focus.projectFocus = [{ repoId: 'r1', project: 'seorak', sessions: 4, share: 1 }];
    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: prior,
      etag: 'e-valid',
      cacheStatus: 'fresh',
    });
    await fetchModel(7, null);

    const malformed = snap() as unknown as { outcomes: Record<string, unknown> };
    delete malformed.outcomes.lineSurvival;
    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: malformed,
      etag: 'e-invalid',
      cacheStatus: 'fresh',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fetchModel(7, null, { force: true });
    warn.mockRestore();

    expect(modelActions.getState()).toEqual({
      snapshot: prior,
      status: 'stale',
      error: null,
    });

    mockFetch.mockRejectedValueOnce(new Error('network down'));
    await fetchModel(7, null, { force: true });
    expect(mockFetch.mock.calls[2]?.[1]?.etag).toBe('e-valid');
  });

  it('drops the ETag on a scope change so the new window fetches a full body', async () => {
    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: snap(7),
      etag: 'e7',
      cacheStatus: 'fresh',
    });
    await fetchModel(7, null);

    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: snap(30),
      etag: 'e30',
      cacheStatus: 'fresh',
    });
    await fetchModel(30, null); // different scope

    // The 30d fetch must NOT carry the 7d ETag (a different window is a different body).
    expect(mockFetch.mock.calls[1]?.[1]?.etag ?? null).toBeNull();
  });

  it('dedupes concurrent fetches for the same scope', async () => {
    mockFetch.mockResolvedValue({
      notModified: false,
      data: snap(),
      etag: 'e1',
      cacheStatus: 'fresh',
    });
    // Two calls in the same tick: the second sees the in-flight scope and no-ops.
    const a = fetchModel(7, null);
    const b = fetchModel(7, null);
    await Promise.all([a, b]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('expires the session (never blanks) on a 401', async () => {
    mockFetch.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }));
    await fetchModel(7, null);
    expect(mockExpire).toHaveBeenCalledTimes(1);
    // Status is left as loading (auth flow owns the transition), not a hard error.
    expect(modelActions.getState().error).toBeNull();
  });
});

describe('refreshModel / resetModelStore', () => {
  it('refreshModel re-fetches the current scope bypassing the dedupe', async () => {
    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: snap(),
      etag: 'e1',
      cacheStatus: 'fresh',
    });
    await fetchModel(30, null);

    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: snap(30),
      etag: 'e2',
      cacheStatus: 'fresh',
    });
    refreshModel();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1]?.[0]).toBe(30); // same scope
  });

  it('resetModelStore clears the snapshot', async () => {
    mockFetch.mockResolvedValueOnce({
      notModified: false,
      data: snap(),
      etag: 'e1',
      cacheStatus: 'fresh',
    });
    await fetchModel(7, null);
    resetModelStore();
    const s = modelActions.getState();
    expect(s.snapshot).toBeNull();
    expect(s.status).toBe('idle');
  });
});

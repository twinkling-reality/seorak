import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchOverview,
  fetchSessions,
  fetchWorkspaceContext,
  claimWorkspaceProject,
  checkAuth,
  resolveApiBase,
  updateCaptureSettings,
} from './api.js';

// Seorak's web API client is a thin wrapper over the worker's public HTTP API,
// reached through the Vite `/api` proxy in dev (see vite.config.ts). Reads carry
// the owner-lock access token as `Authorization: Bearer <token>` when one is
// stored (AUTH-OWNER-LOCK.md); an open worker ignores it. No profile/URL
// resolution (that was the chinmeister multi-tenant client and is intentionally
// gone). These tests pin the real surface.

function okJson(body, { status = 200, etag = null, cacheStatus = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    headers: {
      get: (k) => {
        if (k.toLowerCase() === 'etag') return etag;
        if (k.toLowerCase() === 'x-seorak-cache-status') return cacheStatus;
        return null;
      },
    },
  };
}

describe('resolveApiBase', () => {
  it('proxies through /api in dev, so the browser stays same-origin', () => {
    expect(resolveApiBase({ dev: true })).toBe('/api');
  });

  it('is same-origin root ("") in prod, because the plane serves the app', () => {
    expect(resolveApiBase({ dev: false })).toBe('');
  });

  it('has no cross-origin case at all, and no build-time origin can add one', () => {
    // `VITE_WORKER_URL` used to win over both cases above. It is gone because a
    // published bundle has one build: a baked host would ship to every install
    // that ran it and send that install's reads off its own machine.
    vi.stubEnv('VITE_WORKER_URL', 'https://w.example.workers.dev');
    expect(resolveApiBase({ dev: true })).toBe('/api');
    expect(resolveApiBase({ dev: false })).toBe('');
    expect(resolveApiBase({ workerUrl: 'https://w.example.workers.dev', dev: false })).toBe(
      '',
    );
    vi.unstubAllEnvs();
  });
});

describe('web API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetchOverview hits /api/overview with the day range and returns the body + etag', async () => {
    const body = { rangeDays: 30, live: [] };
    fetch.mockResolvedValue(okJson(body, { etag: 'W/"v3.d30"' }));

    const result = await fetchOverview(30);

    expect(fetch).toHaveBeenCalledWith('/api/overview?days=30', { headers: {}, cache: 'no-store' });
    expect(result).toEqual({
      notModified: false,
      data: body,
      etag: 'W/"v3.d30"',
      cacheStatus: 'fresh',
    });
  });

  it('fetchOverview carries the worker last-known-good status', async () => {
    const body = { rangeDays: 7, live: [] };
    fetch.mockResolvedValue(
      okJson(body, {
        cacheStatus: 'revalidating',
      }),
    );

    const result = await fetchOverview(7);

    expect(result.cacheStatus).toBe('revalidating');
    expect(result.etag).toBeNull();
  });

  it('fetchSessions follows bounded pages and returns the complete list', async () => {
    const sessions = [{ sessionId: 's-1' }, { sessionId: 's-2' }];
    fetch
      .mockResolvedValueOnce(
        okJson({ sessions: [sessions[0]], nextCursor: 'next-page' }),
      )
      .mockResolvedValueOnce(
        okJson({ sessions: [sessions[1]], nextCursor: null }),
      );

    const result = await fetchSessions();

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/sessions?limit=200', {
      headers: {},
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/sessions?cursor=next-page&limit=200',
      { headers: {} },
    );
    expect(result).toEqual(sessions);
  });

  it('fetchSessions discards a changed traversal and explicitly restarts at page one', async () => {
    fetch
      .mockResolvedValueOnce(
        okJson({ sessions: [{ sessionId: 'old-partial' }], nextCursor: 'old-next' }),
      )
      .mockResolvedValueOnce({ ok: false, status: 409 })
      .mockResolvedValueOnce(
        okJson({ sessions: [{ sessionId: 'new-first' }], nextCursor: 'new-next' }),
      )
      .mockResolvedValueOnce(
        okJson({ sessions: [{ sessionId: 'new-second' }], nextCursor: null }),
      );

    await expect(fetchSessions()).resolves.toEqual([
      { sessionId: 'new-first' },
      { sessionId: 'new-second' },
    ]);
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/sessions?limit=200', {
      headers: {},
    });
  });

  it('reads workspace context and explicitly joins same-repo project cards', async () => {
    const workspace = {
      mode: 'workspace',
      workspaceId: 'ws_cedar',
      workspaceName: 'Cedar',
      currentMember: { memberId: 'member_alex', displayName: 'Alex' },
      members: [
        { memberId: 'member_alex', displayName: 'Alex' },
        { memberId: 'member_sam', displayName: 'Sam' },
      ],
    };
    fetch
      .mockResolvedValueOnce(okJson(workspace))
      .mockResolvedValueOnce(okJson({ ok: true }));

    await expect(fetchWorkspaceContext()).resolves.toEqual(workspace);
    await claimWorkspaceProject({
      canonicalRepoId: 'alex-salt',
      joiningRepoId: 'sam-salt',
    });

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/workspace', {
      headers: {},
    });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/workspace/project-claims', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        canonicalRepoId: 'alex-salt',
        joiningRepoId: 'sam-salt',
      }),
    });
  });

  it('throws an error carrying the HTTP status on a non-ok response', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503, json: vi.fn() });

    await expect(fetchOverview(7)).rejects.toMatchObject({ status: 503 });
  });

  it('fetchSessions throws when the payload is not a page', async () => {
    fetch.mockResolvedValue(okJson({ sessions: 'not an array', nextCursor: null }));

    await expect(fetchSessions()).rejects.toThrow(/invalid page/);
  });

  it('fetchSessions rejects an oversized worker page', async () => {
    fetch.mockResolvedValue(
      okJson({ sessions: Array.from({ length: 201 }, () => ({})), nextCursor: null }),
    );

    await expect(fetchSessions()).rejects.toThrow(/invalid page/);
  });

  it('fetchSessions rejects a repeated cursor instead of returning a partial list', async () => {
    fetch
      .mockResolvedValueOnce(okJson({ sessions: [], nextCursor: 'repeat' }))
      .mockResolvedValueOnce(okJson({ sessions: [], nextCursor: 'repeat' }));

    await expect(fetchSessions()).rejects.toThrow(/repeated cursor/);
  });

  it('fetchSessions refuses an unbounded complete-list materialization', async () => {
    const sessions = Array.from({ length: 200 }, (_, index) => ({
      sessionId: `session-${index}`,
    }));
    for (let page = 1; page <= 50; page += 1) {
      fetch.mockResolvedValueOnce(
        okJson({ sessions, nextCursor: `page-${page + 1}` }),
      );
    }

    await expect(fetchSessions()).rejects.toThrow(/materialization limit/);
    expect(fetch).toHaveBeenCalledTimes(50);
  });

  describe('owner-lock access token (AUTH-OWNER-LOCK.md)', () => {
    // This file runs in the node env (no DOM), so `authHeader()` normally reads an
    // undefined localStorage and safely returns {}. Stub an in-memory one to drive
    // the token-attached paths.
    beforeEach(() => {
      const mem = new Map();
      vi.stubGlobal('localStorage', {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k),
      });
    });

    it('attaches Bearer <token> on reads when a token is stored', async () => {
      localStorage.setItem('seorak_token', 'r3ad');
      fetch.mockResolvedValue(okJson({ sessions: [], nextCursor: null }));

      await fetchSessions();

      expect(fetch).toHaveBeenCalledWith('/api/sessions?limit=200', {
        headers: { authorization: 'Bearer r3ad' },
      });
    });

    it('sends NO auth header for the `local` dev sentinel', async () => {
      localStorage.setItem('seorak_token', 'local');
      fetch.mockResolvedValue(okJson({ sessions: [], nextCursor: null }));

      await fetchSessions();

      expect(fetch).toHaveBeenCalledWith('/api/sessions?limit=200', { headers: {} });
    });

    it('reuses the authenticated runtime owner token for settings writes', async () => {
      localStorage.setItem('seorak_token', 'owner-token');
      fetch.mockResolvedValue(okJson({ capture: {} }));

      await updateCaptureSettings({ lineCounts: false });

      expect(fetch).toHaveBeenCalledWith('/api/settings', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer owner-token',
        },
        body: JSON.stringify({ capture: { lineCounts: false } }),
      });
    });

    it('never turns the local development sentinel into write authorization', async () => {
      localStorage.setItem('seorak_token', 'local');
      fetch.mockResolvedValue(okJson({ capture: {} }));

      await updateCaptureSettings({ lineCounts: false });

      expect(fetch).toHaveBeenCalledWith('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capture: { lineCounts: false } }),
      });
    });

    it('surfaces a 401 when the runtime read token lacks settings-write authority', async () => {
      localStorage.setItem('seorak_token', 'read-only-token');
      fetch.mockResolvedValue({ ok: false, status: 401, json: vi.fn() });

      await expect(updateCaptureSettings({ lineCounts: false })).rejects.toMatchObject({
        status: 401,
      });
    });

    it('checkAuth returns true on 200, false on 401, and throws otherwise', async () => {
      fetch.mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn() });
      await expect(checkAuth('r3ad')).resolves.toBe(true);

      fetch.mockResolvedValueOnce({ ok: false, status: 401, json: vi.fn() });
      await expect(checkAuth('nope')).resolves.toBe(false);

      fetch.mockResolvedValueOnce({ ok: false, status: 500, json: vi.fn() });
      await expect(checkAuth('r3ad')).rejects.toMatchObject({ status: 500 });
    });
  });

  it('passes an abort signal through when provided', async () => {
    const body = { rangeDays: 7, live: [] };
    fetch.mockResolvedValue(okJson(body));
    const controller = new AbortController();

    await fetchOverview(7, { signal: controller.signal });

    expect(fetch).toHaveBeenCalledWith('/api/overview?days=7', {
      headers: {},
      cache: 'no-store',
      signal: controller.signal,
    });
  });

  it('fetchOverview echoes the prior ETag as If-None-Match for the conditional GET', async () => {
    fetch.mockResolvedValue(okJson({ live: [] }, { etag: 'W/"v9.d7"' }));

    const result = await fetchOverview(7, { etag: 'W/"v8.d7"' });

    // Lowercase because the header is built by the shared `conditionalGetHeaders`
    // (@seorak/types api.ts) that terminal and mobile also use. HTTP header names
    // are case-insensitive, so this is spelling, not behavior.
    expect(fetch).toHaveBeenCalledWith('/api/overview?days=7', {
      headers: { 'if-none-match': 'W/"v8.d7"' },
      cache: 'no-store',
    });
    expect(result.etag).toBe('W/"v9.d7"');
  });

  it('fetchOverview reports notModified on a 304 and keeps the prior etag', async () => {
    fetch.mockResolvedValue({ ok: false, status: 304, json: vi.fn(), headers: { get: () => null } });

    const result = await fetchOverview(7, { etag: 'W/"v8.d7"' });

    expect(result).toEqual({
      notModified: true,
      etag: 'W/"v8.d7"',
      cacheStatus: 'fresh',
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authActions } from './auth.js';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('product browser auth state', () => {
  const local = new Map<string, string>();
  const session = new Map<string, string>();

  beforeEach(() => {
    local.clear();
    session.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, String(value)),
      removeItem: (key: string) => local.delete(key),
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => session.get(key) ?? null,
      setItem: (key: string, value: string) => session.set(key, String(value)),
      removeItem: (key: string) => session.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn());
    authActions.expireSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exchanges a pasted bearer and never persists it in browser-readable storage', async () => {
    vi.mocked(fetch).mockResolvedValue(
      response({ ok: true, mode: 'session', csrfToken: 'c'.repeat(64) }),
    );

    await expect(authActions.signInWithToken('read-bearer-secret')).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith('/api/auth/session', {
      method: 'POST',
      headers: { authorization: 'Bearer read-bearer-secret' },
      cache: 'no-store',
    });
    expect(local.has('seorak_token')).toBe(false);
    expect([...local.values()]).not.toContain('read-bearer-secret');
    expect([...session.values()]).not.toContain('read-bearer-secret');
    expect(session.get('seorak_session_csrf')).toBe('c'.repeat(64));
    expect(authActions.getState().token).toBe('session');
  });

  it('restores an HttpOnly session with no Authorization header', async () => {
    vi.mocked(fetch).mockResolvedValue(
      response({ ok: true, mode: 'session', csrfToken: 'd'.repeat(64) }),
    );

    await expect(authActions.restore()).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith('/api/auth/check', { cache: 'no-store' });
    expect(authActions.getState().token).toBe('session');
    expect(session.get('seorak_session_csrf')).toBe('d'.repeat(64));
  });

  it('exchanges an OAuth handoff without persisting it in browser-readable storage', async () => {
    vi.mocked(fetch).mockResolvedValue(
      response({ ok: true, mode: 'session', csrfToken: 'e'.repeat(64) }),
    );

    await expect(authActions.signInWithHandoff('handoff-secret')).resolves.toBe(true);

    expect(fetch).toHaveBeenCalledWith('/api/auth/handoff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handoffCode: 'handoff-secret' }),
      cache: 'no-store',
    });
    expect([...local.values()]).not.toContain('handoff-secret');
    expect([...session.values()]).not.toContain('handoff-secret');
    expect(authActions.getState().token).toBe('session');
  });

  it('removes an OAuth handoff without dropping the selected demo state', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: {
        hash: '#handoff=handoff-secret',
        pathname: '/dashboard',
        search: '?demo=healthy',
      },
      history: { replaceState },
    });

    expect(authActions.readHandoffFromHash()).toBe('handoff-secret');
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/dashboard?demo=healthy',
    );
  });

  it('removes an unknown auth fragment without dropping the selected demo state', () => {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: {
        hash: '#unexpected',
        pathname: '/dashboard',
        search: '?demo=healthy',
      },
      history: { replaceState },
    });

    authActions.discardAuthFragment();

    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/dashboard?demo=healthy',
    );
  });

  it('falls back to legacy dogfood validation when session exchange is unavailable', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ error: 'browser session auth unavailable' }, 409))
      .mockResolvedValueOnce(response({ ok: true, mode: 'legacy' }));

    await expect(authActions.signInWithToken('dogfood-secret')).resolves.toBe(true);

    expect(local.get('seorak_token')).toBe('dogfood-secret');
    expect(authActions.getState().token).toBe('dogfood-secret');
  });

  it('does not claim sign-out or discard local state when server revocation fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        response({ ok: true, mode: 'session', csrfToken: 'f'.repeat(64) }),
      )
      .mockResolvedValueOnce(response({ error: 'unavailable' }, 503));
    await authActions.signInWithHandoff('handoff-secret');

    await expect(authActions.logout()).rejects.toThrow('DELETE /auth/session failed: 503');

    expect(authActions.getState().token).toBe('session');
    expect(session.get('seorak_session_csrf')).toBe('f'.repeat(64));
  });

  it('revokes a product session before clearing browser-readable state', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        response({ ok: true, mode: 'session', csrfToken: 'g'.repeat(64) }),
      )
      .mockResolvedValueOnce(response({ ok: true }));
    await authActions.signInWithHandoff('handoff-secret');

    await expect(authActions.logout()).resolves.toBeUndefined();

    expect(fetch).toHaveBeenLastCalledWith('/api/auth/session', {
      method: 'DELETE',
      headers: { 'x-seorak-csrf': 'g'.repeat(64) },
      cache: 'no-store',
    });
    expect(authActions.getState().token).toBeNull();
    expect(session.has('seorak_session_csrf')).toBe(false);
  });
});

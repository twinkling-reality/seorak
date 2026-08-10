// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

// router.ts is a singleton with module-level state, so we reset modules for each test.

async function loadRouter(pathname = '/dashboard') {
  vi.resetModules();
  // Set the pathname before the module initializes
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, pathname },
  });
  return import('./router.js');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseLocation', () => {
  it('returns overview for /dashboard path', async () => {
    const { parseLocation } = await loadRouter('/dashboard');
    expect(parseLocation()).toEqual({ view: 'overview', projectId: null });
  });

  it('returns overview for bare root path', async () => {
    const { parseLocation } = await loadRouter('/');
    expect(parseLocation()).toEqual({ view: 'overview', projectId: null });
  });

  it('returns overview for dashboard.html root', async () => {
    const { parseLocation } = await loadRouter('/dashboard.html/');
    expect(parseLocation()).toEqual({ view: 'overview', projectId: null });
  });

  it('returns settings view for /dashboard/settings', async () => {
    const { parseLocation } = await loadRouter('/dashboard/settings');
    expect(parseLocation()).toEqual({ view: 'settings', projectId: null });
  });

  it('returns model view for /dashboard/model', async () => {
    const { parseLocation } = await loadRouter('/dashboard/model');
    expect(parseLocation()).toEqual({ view: 'model', projectId: null });
  });

  it('returns agents view for /dashboard/agents', async () => {
    const { parseLocation } = await loadRouter('/dashboard/agents');
    expect(parseLocation()).toEqual({ view: 'agents', projectId: null });
  });

  it('returns replay view for /dashboard/replay', async () => {
    const { parseLocation } = await loadRouter('/dashboard/replay');
    expect(parseLocation()).toEqual({ view: 'replay', projectId: null });
  });

  it('rejects the retired /dashboard/tools route', async () => {
    const { parseLocation } = await loadRouter('/dashboard/tools');
    expect(parseLocation()).toEqual({ view: 'not-found', projectId: null });
  });

  it('returns project view with projectId for /dashboard/project/:id', async () => {
    const { parseLocation } = await loadRouter('/dashboard/project/t_abc123');
    expect(parseLocation()).toEqual({ view: 'project', projectId: 't_abc123' });
  });

  it('accepts hyphens in projectId', async () => {
    const { parseLocation } = await loadRouter('/dashboard/project/my-team-id');
    expect(parseLocation()).toEqual({ view: 'project', projectId: 'my-team-id' });
  });

  it('accepts underscores in projectId', async () => {
    const { parseLocation } = await loadRouter('/dashboard/project/team_123');
    expect(parseLocation()).toEqual({ view: 'project', projectId: 'team_123' });
  });

  it('rejects /dashboard/project with no id', async () => {
    const { parseLocation } = await loadRouter('/dashboard/project');
    expect(parseLocation()).toEqual({ view: 'not-found', projectId: null });
  });

  it('rejects projectId with invalid chars', async () => {
    const { parseLocation } = await loadRouter('/dashboard/project/bad%20id');
    const result = parseLocation();
    expect(result).toEqual({ view: 'not-found', projectId: null });
  });

  it('returns not-found for unknown paths', async () => {
    const { parseLocation } = await loadRouter('/dashboard/unknown/path');
    expect(parseLocation()).toEqual({ view: 'not-found', projectId: null });
  });

  it('rejects extra segments after a current route', async () => {
    const { parseLocation } = await loadRouter('/dashboard/settings/extra');
    expect(parseLocation()).toEqual({ view: 'not-found', projectId: null });
  });

  it('strips dashboard.html prefix before parsing', async () => {
    const { parseLocation } = await loadRouter('/dashboard.html/settings');
    expect(parseLocation()).toEqual({ view: 'settings', projectId: null });
  });

  it('strips dashboard.html prefix for project routes', async () => {
    const { parseLocation } = await loadRouter('/dashboard.html/project/t_1');
    expect(parseLocation()).toEqual({ view: 'project', projectId: 't_1' });
  });

  it('rejects routes outside the dashboard namespace', async () => {
    const { parseLocation } = await loadRouter('/settings');
    expect(parseLocation()).toEqual({ view: 'not-found', projectId: null });
  });
});

describe('navigate', () => {
  it('pushes /dashboard for overview', async () => {
    const { navigate } = await loadRouter('/dashboard/settings');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('overview');

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard');
  });

  it('pushes /dashboard/project/:id for project', async () => {
    const { navigate } = await loadRouter('/dashboard');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('project', 't_abc');

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard/project/t_abc');
  });

  it('pushes /dashboard/settings for settings', async () => {
    const { navigate } = await loadRouter('/dashboard');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('settings');

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard/settings');
  });

  it('pushes /dashboard/model for model', async () => {
    const { navigate } = await loadRouter('/dashboard');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('model');

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard/model');
  });

  it('does not push if already at the same path', async () => {
    const { navigate } = await loadRouter('/dashboard/settings');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('settings');

    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('falls back to /dashboard for project view without projectId', async () => {
    const { navigate } = await loadRouter('/dashboard/settings');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigate('project', null);

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard');
  });
});

describe('navigateToAgents', () => {
  it('pushes a canonical section hash without compatibility query aliases', async () => {
    const { navigateToAgents } = await loadRouter('/dashboard');
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigateToAgents('matrix');

    expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard/agents#matrix');
  });
});

// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createEmptyOverview } from '../../lib/schemas/common.js';
import type { OverviewSnapshot, ProjectRollup } from '../../lib/apiSchemas.js';
import { resolveCapabilities, type WorkspaceContext } from '@seorak/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  overview: null as OverviewSnapshot | null,
  route: { view: 'overview' as const, projectId: null as string | null },
  navigate: vi.fn(),
  navigateToCompare: vi.fn(),
  workspace: null as WorkspaceContext | null,
}));

vi.mock('../../lib/stores/polling.js', () => ({
  usePollingStore: <T,>(selector: (state: { overviewData: OverviewSnapshot | null }) => T): T =>
    selector({ overviewData: h.overview }),
}));

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T): T => selector,
}));

vi.mock('../../lib/router.js', () => ({
  useRoute: () => h.route,
  navigate: h.navigate,
  navigateToCompare: h.navigateToCompare,
}));

vi.mock('../../lib/workspaceContext.js', () => ({
  useWorkspaceContext: () => h.workspace,
}));

vi.mock('../../lib/useTheme.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/useTheme.js')>();
  return {
    ...actual,
    useTheme: () => {
      const state = actual.themeActions.getState();
      const resolved =
        state.preference === 'system'
          ? state.systemTheme
          : state.preference;
      return {
        theme: state.preference,
        resolved,
        setTheme: actual.themeActions.setTheme,
      };
    },
  };
});

import { themeActions } from '../../lib/useTheme.js';
import Sidebar from './Sidebar.js';

function rollup(project: string, repoId: string): ProjectRollup {
  return {
    project,
    repoId,
    sessions: 1,
    sessionsDelta: null,
    activeSessions: 1,
    toolCalls: 1,
    tokensTotal: 1,
    costUsd: 1,
    lastEventAt: '2026-07-05T00:00:00.000Z',
    errorRate: null,
    cacheReuseRatio: null,
    shipRate: null,
    oneShotRate: null,
    costDelta: null,
    endReasons: [],
    stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    byTool: [],
    byModel: [],
    byAgent: [],
    hourlyDistribution: [],
    lineSurvival: null,
    endReasonsByHour: [],
    codebaseFiles: [],
    codebaseDirectories: [],
    codebaseRework: [],
    verification: [],
    agentOutcomes: [],
    agentOutcomesUnusable: 0,
    agentModels: [],
    agentDaily: [],
    dailyTrends: [],
    agentHourly: [],
    cacheReadTokens: 0,
    cacheInputTokens: 0,
  };
}

function renderSidebar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Sidebar activeView="overview" />);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  h.overview = null;
  h.route = { view: 'overview', projectId: null };
  h.navigate.mockClear();
  h.navigateToCompare.mockClear();
  h.workspace = null;
  themeActions.disposeForTests();
  themeActions.resetForTests('light', 'light');
  localStorage.clear();
});

describe('Sidebar primary navigation', () => {
  it('shows the active Shared workspace and links to workspace management', () => {
    h.workspace = {
      mode: 'workspace',
      workspaceId: 'ws_cedar',
      workspaceName: 'Cedar',
      controlPlaneUrl: 'https://control.example',
      currentMember: { memberId: 'member_alex', displayName: 'Alex' },
      members: [
        { memberId: 'member_alex', displayName: 'Alex' },
        { memberId: 'member_sam', displayName: 'Sam' },
      ],
    };

    const { container, unmount } = renderSidebar();
    const switcher = container.querySelector<HTMLAnchorElement>(
      '[aria-label^="Current workspace: Cedar"]',
    );
    expect(switcher?.href).toBe('https://control.example/homes');
    expect(switcher?.textContent).toContain('Shared workspace');
    expect(switcher?.querySelector('svg')).not.toBeNull();
    expect(switcher?.textContent).not.toMatch(/^[PS]Cedar/);
    unmount();
  });

  it('shows the workspace without a switch link when the plane sends no control plane', () => {
    h.workspace = {
      mode: 'personal',
      currentMember: { memberId: 'member_alex', displayName: 'Alex' },
      members: [{ memberId: 'member_alex', displayName: 'Alex' }],
    };

    const { container, unmount } = renderSidebar();
    const badge = container.querySelector<HTMLElement>(
      '[aria-label^="Current workspace: Personal"]',
    );
    // Identity without an affordance: no link at all, rather than a link to an
    // account page on infrastructure this deployment does not run.
    expect(badge).not.toBeNull();
    expect(badge?.tagName).toBe('DIV');
    expect(container.querySelector('a[href$="/homes"]')).toBeNull();
    // The name STANDS ALONE. This used to read "Personal / Private history",
    // but that second line was the default state restating the product's
    // premise in permanent chrome, and Settings already carries that claim.
    // The Shared case above still asserts its subtitle, which is the one that
    // changes what you would believe about whose sessions these are.
    expect(badge?.textContent?.trim()).toBe('Personal');
    unmount();
  });

  it('navigates to model view from sidebar', () => {
    const { container, unmount } = renderSidebar();
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Model"]');
    expect(button).not.toBeNull();

    act(() => {
      button!.click();
    });

    expect(h.navigate).toHaveBeenCalledWith('model');
    unmount();
  });

  it('keeps Agents and Compare in the rail when the window is thin', () => {
    h.overview = createEmptyOverview(30);

    const { container, unmount } = renderSidebar();
    const agents = container.querySelector<HTMLButtonElement>('[aria-label="Compare agents"]');
    const compare = container.querySelector<HTMLButtonElement>('[aria-label="Compare periods"]');
    expect(agents).not.toBeNull();
    expect(compare).not.toBeNull();

    act(() => {
      agents!.click();
    });
    expect(h.navigate).toHaveBeenCalledWith('agents');

    act(() => {
      compare!.click();
    });
    expect(h.navigateToCompare).toHaveBeenCalledWith();
    unmount();
  });

  it('opens the stable period question even when two repos are available', () => {
    const overview = createEmptyOverview(30);
    overview.usage.projects = [
      rollup('seorak', 'repo-seorak'),
      rollup('mobile-surfaces', 'repo-mobile-surfaces'),
    ];
    overview.tools.byAgent = [
      {
        agent: 'claude-code',
        sessions: 2,
        activeSessions: 0,
        toolCalls: 10,
        tokensTotal: 0,
        costUsd: null,
        lines: { added: 10, removed: 2 },
        lastEventAt: '2026-07-05T00:00:00.000Z',
        capabilities: resolveCapabilities('claude-code'),
        erroredPresent: false,
      },
      {
        agent: 'codex',
        sessions: 1,
        activeSessions: 0,
        toolCalls: 4,
        tokensTotal: 0,
        costUsd: null,
        lines: { added: 4, removed: 1 },
        lastEventAt: '2026-07-05T00:00:00.000Z',
        capabilities: resolveCapabilities('codex'),
        erroredPresent: false,
      },
    ];
    h.overview = overview;

    const { container, unmount } = renderSidebar();
    const compare = container.querySelector<HTMLButtonElement>('[aria-label="Compare periods"]');
    expect(compare).not.toBeNull();

    act(() => {
      compare!.click();
    });
    expect(h.navigateToCompare).toHaveBeenCalledWith();
    unmount();
  });
});

describe('Sidebar theme toggle', () => {
  it('writes explicit dark preference when flipping from light', () => {
    themeActions.resetForTests('light', 'light');
    const { container, unmount } = renderSidebar();

    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Switch to dark mode"]');
    expect(toggle).not.toBeNull();

    act(() => {
      toggle!.click();
    });

    expect(themeActions.getState().preference).toBe('dark');
    expect(localStorage.getItem('seorak:theme')).toBe('dark');
    unmount();
  });

  it('replaces system preference with explicit light when resolved is dark', () => {
    themeActions.resetForTests('system', 'dark');
    const { container, unmount } = renderSidebar();

    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Switch to light mode"]');
    expect(toggle).not.toBeNull();

    act(() => {
      toggle!.click();
    });

    expect(themeActions.getState().preference).toBe('light');
    unmount();
  });
});

describe('Sidebar project navigation', () => {
  it('opens project routes by stable repoId, not display basename', () => {
    const overview = createEmptyOverview(30);
    overview.usage.projects = [
      rollup('seorak', 'repo-seorak'),
      rollup('mobile-surfaces', 'repo-mobile-surfaces'),
    ];
    h.overview = overview;

    const { container, unmount } = renderSidebar();
    const button = container.querySelector<HTMLButtonElement>('[aria-label="seorak"]');
    expect(button).not.toBeNull();

    act(() => {
      button!.click();
    });

    expect(h.navigate).toHaveBeenCalledWith('project', 'repo-seorak');
    expect(h.navigate).not.toHaveBeenCalledWith('project', 'seorak');

    unmount();
  });
});

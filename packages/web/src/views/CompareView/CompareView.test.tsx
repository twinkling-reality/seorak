// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeveloperModelSnapshot } from '@seorak/types';

import { createEmptyOverview } from '../../lib/schemas/common.js';
import { createEmptyDeveloperModel } from '../../lib/schemas/developer-model.js';
import type {
  OverviewSnapshot,
  ProjectRollup,
  RepoMomentum,
} from '../../lib/apiSchemas.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Shared mutable refs the mocked hooks read (vi.hoisted so the mock factories,
// which are hoisted above imports, can close over them).
const h = vi.hoisted(() => ({
  overview: null as OverviewSnapshot | null,
  model: null as DeveloperModelSnapshot | null,
  params: {} as Record<string, string | null>,
  isStale: false,
  setQueryParams: vi.fn(),
}));

vi.mock('../../hooks/useOverview.js', () => ({
  useOverview: () => ({
    overview: h.overview,
    isLoading: false,
    error: null,
    isStale: h.isStale,
  }),
  // The plan ceiling reaches the pills through this hook. Mocked to the fixture's
  // own ceiling so these tests keep asserting compare behavior rather than
  // entitlements; the ceiling itself is covered in overview-utils.test.ts.
  useAllowedRanges: () => [7, 30, 90] as const,
}));

vi.mock('../../hooks/useDeveloperModel.js', async () => {
  const { createEmptyDeveloperModel } = await import('../../lib/schemas/developer-model.js');
  return {
    useDeveloperModel: (rangeDays: 7 | 30 | 90) => ({
      snapshot: h.model ?? createEmptyDeveloperModel(rangeDays),
      isLoading: false,
      error: null,
      isStale: false,
    }),
  };
});

vi.mock('../../lib/router.js', () => ({
  useQueryParam: (key: string) => h.params[key] ?? null,
  setQueryParams: h.setQueryParams,
  navigate: () => {},
  navigateToCompare: () => {},
}));

import CompareView from './CompareView.js';

function makeRollup(over: Partial<ProjectRollup>): ProjectRollup {
  return {
    project: 'repo',
    repoId: 'r',
    sessions: 0,
    sessionsDelta: null,
    activeSessions: 0,
    toolCalls: 0,
    tokensTotal: 0,
    costUsd: null,
    lastEventAt: '2026-06-14T00:00:00.000Z',
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
    ...over,
  } satisfies ProjectRollup;
}

function ensureBottomFloaters() {
  let zone = document.getElementById('bottom-floaters');
  if (!zone) {
    zone = document.createElement('div');
    zone.id = 'bottom-floaters';
    document.body.appendChild(zone);
  }
  return zone;
}

function render() {
  ensureBottomFloaters();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<CompareView />);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
      document.getElementById('bottom-floaters')?.replaceChildren();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  h.overview = null;
  h.model = null;
  h.params = {};
  h.isStale = false;
  h.setQueryParams.mockClear();
  window.history.replaceState(null, '', '/dashboard/compare');
  localStorage.clear();
  document.getElementById('bottom-floaters')?.replaceChildren();
});

describe('CompareView', () => {
  it('renders repo A and repo B columns only in explicit repo mode', async () => {
    const overview = createEmptyOverview(30);
    overview.usage.projects = [
      makeRollup({ project: 'seorak', repoId: 'r-seorak', sessions: 12, costUsd: 5, shipRate: 0.8 }),
      makeRollup({
        project: 'mobile-surfaces',
        repoId: 'r-mobile',
        sessions: 30,
        costUsd: null, // honest-empty cost
        shipRate: 0.2,
      }),
    ];
    overview.usage.momentum = [
      { repoId: 'r-seorak', commits: 7, filesTouched: 4, windowDays: 7 } as unknown as RepoMomentum,
    ];
    h.overview = overview;
    h.params = { mode: 'repos', a: 'r-seorak', b: 'r-mobile' };

    const { container, unmount } = render();
    const text = container.textContent ?? '';

    // Both repos surfaced (pickers) and all metric rows present.
    expect(text).toContain('Compare');
    expect(text).toContain('Shared window');
    expect(text).toContain('seorak');
    expect(text).toContain('mobile-surfaces');
    expect(text).toContain('Sessions');
    expect(text).toContain('Ship rate');
    expect(container.querySelector('[aria-label="Repo A: seorak"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Repo B: mobile-surfaces"]')).not.toBeNull();

    // Picker menus portal to the page field so the table's horizontal overflow
    // cannot clip them.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Repo B: mobile-surfaces"]')!.click();
      await import('../../components/ProjectDropdown/ProjectDropdownMenu.js');
    });
    const repoMenu = document.body.querySelector('[aria-label="Repo B: mobile-surfaces options"]');
    expect(repoMenu).not.toBeNull();
    expect(container.contains(repoMenu)).toBe(false);

    // A vs B read from their own rollups, in order: sessions 12 (A) then 30 (B).
    const rows = Array.from(container.querySelectorAll('[role="row"]'));
    const sessionsRow = rows.find((r) => (r.textContent ?? '').startsWith('Sessions'));
    expect(sessionsRow).toBeTruthy();
    const rowText = sessionsRow!.textContent ?? '';
    expect(rowText.indexOf('12')).toBeGreaterThanOrEqual(0);
    expect(rowText.indexOf('12')).toBeLessThan(rowText.indexOf('30'));

    // Ship rate reads each repo's own scalar.
    const shipRow = rows.find((r) => (r.textContent ?? '').startsWith('Ship rate'));
    expect(shipRow?.textContent).toContain('80%');
    expect(shipRow?.textContent).toContain('20%');

    unmount();
  });

  it('renders honest-empty "--" for a null cost, never a fabricated $0', () => {
    const overview = createEmptyOverview(30);
    overview.usage.projects = [
      makeRollup({ project: 'seorak', repoId: 'r-seorak', sessions: 12, costUsd: 5 }),
      makeRollup({ project: 'mobile-surfaces', repoId: 'r-mobile', sessions: 30, costUsd: null }),
    ];
    h.overview = overview;
    h.params = { mode: 'repos', a: 'r-seorak', b: 'r-mobile' };

    const { container, unmount } = render();
    const rows = Array.from(container.querySelectorAll('[role="row"]'));
    const costRow = rows.find((r) => (r.textContent ?? '').startsWith('Cost'));
    expect(costRow?.textContent).toContain('$5.00');
    expect(costRow?.textContent).toContain('--');
    expect(costRow?.textContent).not.toContain('$0.00');

    unmount();
  });

  it('refuses to render a duplicate same-repo comparison', () => {
    const overview = createEmptyOverview(30);
    overview.usage.projects = [
      makeRollup({ project: 'seorak', repoId: 'r-seorak', sessions: 12 }),
      makeRollup({ project: 'mobile-surfaces', repoId: 'r-mobile', sessions: 30 }),
    ];
    h.overview = overview;
    h.params = { mode: 'repos', a: 'r-seorak', b: 'r-seorak' };

    const { container, unmount } = render();
    const banner = container.querySelector('[role="status"]');
    expect(banner?.textContent).toContain('Same repo');
    expect(banner?.textContent).toContain('Both sides are seorak');
    expect(container.textContent).not.toContain('Ship rate');

    const clear = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Clear second repo',
    );
    act(() => clear!.click());
    expect(h.setQueryParams).toHaveBeenCalledWith({ b: null });

    unmount();
  });

  it('marks a retained compare snapshot stale after a failed refresh', () => {
    const overview = createEmptyOverview(30);
    overview.usage.projects = [
      makeRollup({ project: 'seorak', repoId: 'r-seorak', sessions: 12 }),
      makeRollup({ project: 'mobile-surfaces', repoId: 'r-mobile', sessions: 30 }),
    ];
    h.overview = overview;
    h.params = { mode: 'repos', a: 'r-seorak', b: 'r-mobile' };
    h.isStale = true;

    const { unmount } = render();
    const banner = document
      .getElementById('bottom-floaters')
      ?.querySelector('[role="status"]');
    expect(banner?.textContent).toContain('Reconnecting');
    expect(banner?.textContent).toContain('Showing the last loaded snapshot');
    unmount();
  });

  it('shows the demo badge when compare renders fixture data', () => {
    window.history.replaceState(null, '', '/dashboard/compare?demo=healthy');
    const overview = createEmptyOverview(30);
    overview.usage.projects = [
      makeRollup({ project: 'seorak', repoId: 'r-seorak', sessions: 12 }),
      makeRollup({ project: 'mobile-surfaces', repoId: 'r-mobile', sessions: 30 }),
    ];
    h.overview = overview;
    h.params = { mode: 'repos', a: 'r-seorak', b: 'r-mobile' };

    const { container, unmount } = render();
    expect(container.textContent).toContain('Demo data');
    unmount();
  });

  it('keeps the primary period surface honest-empty when prior history is absent', () => {
    h.overview = createEmptyOverview(30); // no projects
    h.params = {};
    const { container, unmount } = render();
    expect(container.textContent).toContain(
      'No prior 30-day window has been measured for all work yet.',
    );
    expect(container.querySelector('[role="table"]')).toBeNull();
    expect(container.textContent).not.toContain('steady');
    unmount();
  });

  it('leads with an annotated read whose terms reveal exact current and prior evidence', () => {
    const overview = createEmptyOverview(7);
    overview.usage.totals.sessionsDelta = { current: 12, previous: 8 };
    overview.usage.cost.delta = { current: 5, previous: 7 };
    overview.outcomes.shipRate = 0.75;
    h.overview = overview;
    h.params = {};

    const { container, unmount } = render();
    const text = container.textContent ?? '';
    expect(text).toContain('Change over time');
    expect(text).toContain(
      'Compared with the prior 7 days, session activity grew and measured cost fell.',
    );
    expect(text).not.toContain('Last 7 days vs prior 7 days');
    expect(text).not.toContain('See the numbers');
    expect(text).not.toContain('Current-only stats');
    expect(text).not.toContain('Ship rate');
    expect(container.querySelector('[role="table"]')).toBeNull();

    const buttons = Array.from(container.querySelectorAll('button'));
    const sessions = buttons.find((button) => button.textContent === 'session activity grew');
    expect(sessions?.getAttribute('aria-expanded')).toBe('false');

    act(() => sessions!.click());
    const evidence = container.querySelector('[role="region"][aria-label="Sessions"]');
    expect(evidence?.textContent).toContain('Last 7 days: 12');
    expect(evidence?.textContent).toContain('Prior 7 days: 8');
    expect(sessions?.getAttribute('aria-expanded')).toBe('true');
    unmount();
  });

  it('adds developer-model shifts and outcome memory when both period legs are measured', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(240);
    const overview = createEmptyOverview(30);
    overview.usage.totals.sessionsDelta = { current: 18, previous: 12 };
    h.overview = overview;
    h.params = { range: '30' };

    const model = createEmptyDeveloperModel(30);
    model.activity.hourlyDistribution = [{ dow: 2, hour: 23, sessions: 8 }];
    model.outcomes.lineSurvival = {
      rate: 0.82,
      linesAuthored: 200,
      linesSurviving: 164,
      commitsChecked: 4,
      sessionsRated: 4,
      retained: 3,
      overwritten: 1,
      unreachable: 0,
      unknown: 0,
    };
    model.accrual = {
      sessions: 6,
      hourlyDistribution: [{ dow: 2, hour: 13, sessions: 6 }],
      projectFocus: [],
      lineSurvival: {
        rate: 0.6,
        linesAuthored: 150,
        linesSurviving: 90,
        commitsChecked: 4,
        sessionsRated: 4,
        retained: 2,
        overwritten: 2,
        unreachable: 0,
        unknown: 0,
      },
    };
    h.model = model;

    const { container, unmount } = render();
    const text = container.textContent ?? '';
    expect(text).toContain('Your workday moved from morning into evening.');
    expect(text).toContain(
      'More of your landed work stayed in the code than in the period before.',
    );
    expect(
      container.querySelector('button[data-annotation-term="morning into evening"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('button[data-annotation-term="stayed in the code"]'),
    ).not.toBeNull();
    unmount();
  });

  it('uses a stable project scope and its own prior legs', () => {
    const overview = createEmptyOverview(30);
    overview.usage.projects = [
      makeRollup({
        project: 'seorak',
        repoId: 'r-seorak',
        sessions: 12,
        sessionsDelta: { current: 12, previous: 9 },
        costDelta: { current: 4, previous: 3 },
      }),
    ];
    h.overview = overview;
    h.params = { scope: 'r-seorak', range: '30' };

    const { container, unmount } = render();
    const text = container.textContent ?? '';
    expect(text).toContain(
      'Compared with the prior 30 days, session activity grew and measured cost rose.',
    );
    expect(container.querySelector('[aria-label="Comparison scope: seorak"]')).not.toBeNull();
    expect(text).not.toContain('+3');
    const sessions = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'session activity grew',
    );
    act(() => sessions!.click());
    expect(container.querySelector('[aria-label="Sessions"]')?.textContent).toContain('Change: +3');
    expect(text).not.toContain('Two repos are needed');
    unmount();
  });

  it('opens repo mode without inventing a pair and writes range changes to the URL state', () => {
    const overview = createEmptyOverview(7);
    overview.usage.projects = [
      makeRollup({ project: 'seorak', repoId: 'r-seorak', sessions: 12 }),
      makeRollup({ project: 'mobile-surfaces', repoId: 'r-mobile', sessions: 8 }),
    ];
    h.overview = overview;
    h.params = { scope: 'r-seorak' };

    const { container, unmount } = render();
    const buttons = Array.from(container.querySelectorAll('button'));
    const repos = buttons.find((button) => button.textContent === 'Repos');
    const thirtyDays = buttons.find((button) => button.textContent === '30d');

    act(() => repos!.click());
    expect(h.setQueryParams).toHaveBeenCalledWith({
      mode: 'repos',
      scope: null,
      a: null,
      b: null,
    });

    act(() => thirtyDays!.click());
    expect(h.setQueryParams).toHaveBeenCalledWith({ range: '30' });
    expect(h.setQueryParams).not.toHaveBeenCalledWith(
      expect.objectContaining({ a: 'r-seorak' }),
    );
    unmount();
  });
});

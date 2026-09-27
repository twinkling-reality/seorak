// @vitest-environment jsdom

/**
 * The three settings panels run ONE state machine (useSettingsSection). These
 * tests hold each panel to the shared contract from the outside, so a panel that
 * quietly grows its own copy of the load or the rollback again fails here rather
 * than drifting.
 *
 * Contract per panel: an unreachable worker renders one reason line and no
 * controls; a rejected write reverts the optimistic value; a 401 reverts AND
 * flips the panel read-only so a second click issues no write.
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITY_REGISTRY, deriveNotificationAvailability } from '@seorak/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(Component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Component {...props} />);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
}

function unauthorized() {
  return Object.assign(new Error('PUT /settings failed: 401'), { status: 401 });
}
function offline() {
  return Object.assign(new Error('PUT /settings failed: 500'), { status: 500 });
}

const CAPTURE = { lineCounts: true, gitMomentum: true, fileSignals: true, fileLabels: false };

const NOTIFY = {
  signals: {
    cost_spike: { enabled: true },
    high_burn_rate: { enabled: true },
    long_session: { enabled: true },
    stuck_loop: { enabled: true },
    went_cold: { enabled: true },
    session_ended: { enabled: false },
    daily_cost_cap: { enabled: false },
    first_error: { enabled: false },
  },
  quietHours: { enabled: false, start: '22:00', end: '08:00', tz: 'UTC' },
  perProject: {},
};

const PROJECTS = [
  { repoId: 'r_one', project: 'seorak', lastEventAt: '2026-01-02', sessions: 4, costUsd: 1 },
  { repoId: 'r_two', project: 'seorak', lastEventAt: '2026-01-01', sessions: 2, costUsd: 1 },
];

const OVERVIEW = {
  notificationAvailability: deriveNotificationAvailability([
    { agent: 'claude-code', capabilities: CAPABILITY_REGISTRY['claude-code'] },
  ]),
  usage: { projects: PROJECTS },
  tools: { byAgent: [] },
};

/**
 * Each panel reduced to the same four levers, so one table drives all three.
 * `load`/`write` are the api doubles; `activate` finds the control that starts a
 * write; `isOn` reads the optimistic value back off the DOM.
 */
const PANELS = [
  {
    name: 'CaptureSection',
    module: '../CaptureSection.js',
    loadName: 'fetchCaptureSettings',
    writeName: 'updateCaptureSettings',
    loaded: CAPTURE,
    unavailable: 'Worker unreachable. Capture controls need a running worker.',
    readOnlyNote: "it can't change capture settings",
    control: (c) => c.querySelector('[aria-label^="Show real file and folder names"]'),
    isOn: (c) =>
      c.querySelector('[aria-label^="Show real file and folder names"]').getAttribute('aria-checked'),
    onBefore: 'false',
  },
  {
    name: 'NotificationsSection',
    module: '../NotificationsSection.js',
    loadName: 'fetchNotificationSettings',
    writeName: 'updateNotificationSettings',
    loaded: NOTIFY,
    unavailable: 'Worker unreachable. Notification controls need a running worker.',
    readOnlyNote: "it can't change notification settings",
    control: (c) => c.querySelector('[aria-label="Session ended notifications"]'),
    isOn: (c) =>
      c.querySelector('[aria-label="Session ended notifications"]').getAttribute('aria-checked'),
    onBefore: 'false',
  },
  {
    name: 'ProjectsSection',
    module: '../ProjectsSection.js',
    loadName: 'fetchProjectMerges',
    writeName: 'updateProjectMerges',
    loaded: { byRepo: {} },
    unavailable: 'Worker unreachable. Project merging needs a running worker.',
    readOnlyNote: "it can't merge projects",
    control: (c) =>
      [...c.querySelectorAll('[data-testid="projects-dup-row"] button')].find((b) =>
        b.textContent.includes('Merge'),
      ),
    // A merge is confirmed by the "Active merges" row appearing.
    isOn: (c) => String(c.querySelector('[data-testid="projects-active-merges"]') !== null),
    onBefore: 'false',
  },
  {
    // Its own panel rather than a control inside ProjectsSection: one panel owns
    // one settings family and one state machine, which is the contract this file
    // exists to hold. Sharing merges' machine would let a failed merge roll back
    // an archive made in the same breath.
    name: 'ProjectArchiveSection',
    module: '../ProjectArchiveSection.js',
    loadName: 'fetchProjectArchive',
    writeName: 'updateProjectArchive',
    loaded: { byRepo: {} },
    unavailable: 'Worker unreachable. Archiving a project needs a running worker.',
    readOnlyNote: "it can't archive projects",
    control: (c) =>
      [...c.querySelectorAll('[data-testid="project-archive-active"] button')].find((b) =>
        b.textContent.includes('Archive'),
      ),
    // The optimistic archive shows up as the "archived" group appearing. It reads
    // off the SETTINGS state, not the overview, which is what makes it a real
    // read-back of the optimistic value rather than of the fixture.
    isOn: (c) => String(c.querySelector('[data-testid="project-archive-archived"]') !== null),
    onBefore: 'false',
  },
];

async function loadPanel(panel, { loadRejects = null, writeRejects = null } = {}) {
  vi.resetModules();
  const load = loadRejects
    ? vi.fn().mockRejectedValue(loadRejects)
    : vi.fn().mockResolvedValue(panel.loaded);
  const write = writeRejects
    ? vi.fn().mockRejectedValue(writeRejects)
    : vi.fn().mockResolvedValue(panel.loaded);

  vi.doMock('../../../lib/api.js', () => ({
    [panel.loadName]: (...a) => load(...a),
    [panel.writeName]: (...a) => write(...a),
  }));
  vi.doMock('../../../lib/demoMode.js', () => ({ isDemoActive: () => false }));
  vi.doMock('../../../lib/stores/polling.js', () => ({
    usePollingStore: (selector) => selector({ overviewData: OVERVIEW }),
  }));

  const mod = await import(panel.module);
  return { Section: mod.default, load, write };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe.each(PANELS)('$name shares the settings state machine', (panel) => {
  it('renders one reason line and no controls when the worker is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { Section } = await loadPanel(panel, { loadRejects: new Error('offline') });
    const { container, unmount } = render(Section, {});
    await flush();

    expect(container.textContent).toBe(panel.unavailable);
    expect(container.querySelector('button')).toBeNull();

    unmount();
  });

  it('reverts the optimistic value when the write fails', async () => {
    const { Section, write } = await loadPanel(panel, { writeRejects: offline() });
    const { container, unmount } = render(Section, {});
    await flush();

    await click(panel.control(container));

    expect(write).toHaveBeenCalledTimes(1);
    expect(panel.isOn(container)).toBe(panel.onBefore);
    expect(container.textContent).toContain('Save failed, worker unreachable. Try again.');

    unmount();
  });

  it('reverts and goes read-only on a 401, refusing a second write', async () => {
    const { Section, write } = await loadPanel(panel, { writeRejects: unauthorized() });
    const { container, unmount } = render(Section, {});
    await flush();

    await click(panel.control(container));

    expect(panel.isOn(container)).toBe(panel.onBefore);
    expect(container.textContent).toContain(panel.readOnlyNote);
    expect(container.textContent).toContain("Sign in with the worker's owner token");

    await click(panel.control(container));
    expect(write).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('does not apply a load that resolves after the reader navigated away', async () => {
    vi.resetModules();
    let land = () => {};
    const load = vi.fn().mockReturnValue(
      new Promise((r) => {
        land = r;
      }),
    );
    vi.doMock('../../../lib/api.js', () => ({
      [panel.loadName]: (...a) => load(...a),
      [panel.writeName]: vi.fn(),
    }));
    vi.doMock('../../../lib/demoMode.js', () => ({ isDemoActive: () => false }));
    vi.doMock('../../../lib/stores/polling.js', () => ({
      usePollingStore: (selector) => selector({ overviewData: OVERVIEW }),
    }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mod = await import(panel.module);
    const onSettingsChange = vi.fn();
    const { unmount } = render(mod.default, { onSettingsChange });
    unmount();

    await act(async () => {
      land(panel.loaded);
      await Promise.resolve();
    });
    await flush();

    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });
});

// The two panels that mirror their settings up to SettingsView (which counts
// them for the tab summary) must report the revert, not just render it. The two
// PROJECT panels are excluded because neither feeds the tab summary: the tab
// counts toggles that are on, and "3 merged" or "2 archived" is not that shape.
describe.each(
  PANELS.filter((p) => p.name !== 'ProjectsSection' && p.name !== 'ProjectArchiveSection'),
)(
  '$name reports the rollback to its parent',
  (panel) => {
    it('passes the reverted settings to onSettingsChange', async () => {
      const { Section } = await loadPanel(panel, { writeRejects: unauthorized() });
      const onSettingsChange = vi.fn();
      const { container, unmount } = render(Section, { onSettingsChange });
      await flush();

      await click(panel.control(container));

      const last = onSettingsChange.mock.calls.at(-1)[0];
      expect(last).toEqual(panel.loaded);

      unmount();
    });
  },
);

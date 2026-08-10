// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CAPABILITY_REGISTRY,
  NO_CAPABILITIES,
  deriveNotificationAvailability,
} from '@seorak/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderComponent(Component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Component {...props} />);
  });

  return {
    container,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flushEffects(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function selectSettingsSection(container, label) {
  const sectionByLabel = {
    Profile: 'profile',
    Manage: 'profile',
    Capture: 'capture',
    Control: 'capture',
    Alerts: 'alerts',
    Watch: 'alerts',
    // Legacy test helper labels
    Account: 'profile',
    You: 'profile',
    'Data capture': 'capture',
    Notifications: 'alerts',
    Session: 'profile',
  };
  const sectionId = sectionByLabel[label];
  const navBtn = container.querySelector(`[data-tab="${sectionId}"]`);
  expect(navBtn).not.toBeNull();
  await act(async () => {
    navBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

let mockAuthState;
let mockStopPolling;
let mockLogout;
let mockContinueControlPlaneLogout;
let mockContinueControlPlaneAccountDeletion;
let mockUpdateUser;
let mockTheme;
let mockSetTheme;
// Notifications-section deps. The catalog-defaulted settings the section loads,
// the projects it reads off the polling store, and the spies the round-trip
// tests assert on. Each test can override via loadSettingsView({ notify }).
let mockPollingState;
let mockFetchNotificationSettings;
let mockUpdateNotificationSettings;
let mockFetchPushDeliveryHealth;
let mockFetchInterventions;
let mockFetchCaptureSettings;
let mockUpdateCaptureSettings;
let mockFetchProjectMerges;
let mockUpdateProjectMerges;
let mockIsDemoActive;
/** Which surfaces the probed plane serves. The module is mocked once for the
 *  whole file, so the answer has to be reassignable per test. */
let mockCurrentPlaneServes;
let mockCurrentDataPlane;

const DEFAULT_NOTIFY = {
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

const availabilityFor = (...evidence) => deriveNotificationAvailability(evidence);
const CLAUDE_AVAILABILITY = availabilityFor({
  agent: 'claude-code',
  capabilities: CAPABILITY_REGISTRY['claude-code'],
});

const FILE_LABELS_ARIA =
  'Show real file and folder names on your repos, basename only?';

let settingsViewPromise;

async function loadSettingsView({
  user = { handle: 'alice', color: 'cyan' },
  token = 'tok_test',
  theme = 'system',
  notify = DEFAULT_NOTIFY,
  projects = [],
  interventions = [],
  notificationAvailability = CLAUDE_AVAILABILITY,
  demo = false,
  updateRejects = null, // an Error with a `.status` to simulate a 401 / failed PUT
} = {}) {
  mockAuthState = { token, user };
  mockStopPolling = vi.fn();
  mockLogout = vi.fn();
  mockContinueControlPlaneLogout = vi.fn();
  mockContinueControlPlaneAccountDeletion = vi.fn();
  mockUpdateUser = vi.fn();
  mockTheme = theme;
  mockSetTheme = vi.fn();

  mockPollingState = {
    overviewData: {
      notificationAvailability,
      usage: { projects },
      tools: { byAgent: [] },
    },
  };
  mockFetchNotificationSettings = vi.fn().mockResolvedValue(notify);
  mockFetchPushDeliveryHealth = vi.fn().mockResolvedValue({
    observedAt: '2026-07-30T12:00:00.000Z',
    windowDays: 30,
    environments: {
      development: {
        registeredDevices: 0,
        state: 'unobserved',
        completedAttempts: null,
        lastCompletedAt: null,
        lastAcceptedAt: null,
        terminalFailures: null,
        lastTerminalAt: null,
      },
      production: {
        registeredDevices: 0,
        state: 'unobserved',
        completedAttempts: null,
        lastCompletedAt: null,
        lastAcceptedAt: null,
        terminalFailures: null,
        lastTerminalAt: null,
      },
    },
  });
  mockUpdateNotificationSettings = updateRejects
    ? vi.fn().mockRejectedValue(updateRejects)
    : vi.fn((patch) => {
        // Echo a deep-merged settings so the optimistic reconcile has a real shape.
        const next = {
          ...notify,
          signals: { ...notify.signals, ...(patch.signals ?? {}) },
          quietHours: { ...notify.quietHours, ...(patch.quietHours ?? {}) },
          perProject: { ...notify.perProject, ...(patch.perProject ?? {}) },
        };
        return Promise.resolve(next);
      });
  mockFetchInterventions = vi.fn().mockResolvedValue(interventions);
  mockFetchCaptureSettings = vi
    .fn()
    .mockResolvedValue({ lineCounts: true, gitMomentum: true, fileSignals: true, fileLabels: false });
  mockUpdateCaptureSettings = vi.fn((patch) =>
    Promise.resolve({
      lineCounts: true,
      gitMomentum: true,
      fileSignals: true,
      fileLabels: false,
      ...patch,
    }),
  );
  mockFetchProjectMerges = vi.fn().mockResolvedValue({ byRepo: {} });
  // Echo a merged map so the optimistic reconcile has a real shape (drop null
  // entries, mirroring the worker coerce that un-merges on a null patch).
  mockUpdateProjectMerges = vi.fn((patch) => {
    const byRepo = { ...(patch?.byRepo ?? {}) };
    for (const [repoId, v] of Object.entries(byRepo)) if (v == null) delete byRepo[repoId];
    return Promise.resolve({ byRepo });
  });
  mockIsDemoActive = vi.fn().mockReturnValue(demo);
  mockCurrentPlaneServes = vi.fn().mockReturnValue(true);
  mockCurrentDataPlane = vi.fn().mockReturnValue(null);

  if (!settingsViewPromise) {
    vi.doMock('../../lib/stores/auth.js', () => ({
      useAuthStore: (selector) => selector(mockAuthState),
      authActions: {
        logout: (...a) => mockLogout(...a),
        updateUser: (...a) => mockUpdateUser(...a),
      },
    }));

    vi.doMock('../../lib/stores/polling.js', () => ({
      stopPolling: (...a) => mockStopPolling(...a),
      usePollingStore: (selector) => selector(mockPollingState),
    }));

    vi.doMock('../../lib/controlPlane.js', () => ({
      continueControlPlaneLogout: (...a) => mockContinueControlPlaneLogout(...a),
      continueControlPlaneAccountDeletion: (...a) =>
        mockContinueControlPlaneAccountDeletion(...a),
      hasConfiguredControlPlane: () => true,
    }));

    vi.doMock('../../lib/api.js', () => ({
      // Real export: other lib modules in the settings import graph read it at
      // module scope, so a mock that omits it fails the whole file to load.
      API_BASE: '/api',
      fetchNotificationSettings: (...a) => mockFetchNotificationSettings(...a),
      updateNotificationSettings: (...a) => mockUpdateNotificationSettings(...a),
      fetchPushDeliveryHealth: (...a) => mockFetchPushDeliveryHealth(...a),
      fetchInterventions: (...a) => mockFetchInterventions(...a),
      fetchCaptureSettings: (...a) => mockFetchCaptureSettings(...a),
      updateCaptureSettings: (...a) => mockUpdateCaptureSettings(...a),
      fetchProjectMerges: (...a) => mockFetchProjectMerges(...a),
      updateProjectMerges: (...a) => mockUpdateProjectMerges(...a),
    }));

    // The Plan panel reads the data-plane descriptor. Mock the module rather
    // than widening the api mock: this suite is about the settings shell, and a
    // plane that reports nothing is the honest default for it.
    vi.doMock('../../lib/dataPlane.js', () => ({
      probeDataPlane: async () => null,
      currentDataPlane: (...a) => mockCurrentDataPlane(...a),
      entersWithoutSignIn: () => false,
      currentPlaneServes: (...a) => mockCurrentPlaneServes(...a),
    }));

    vi.doMock('../../lib/demoMode.js', () => ({
      isDemoActive: (...a) => mockIsDemoActive(...a),
      getActiveScenarioId: () => null,
      setActiveScenarioId: vi.fn(),
      shouldShowDemoSwitcher: () => false,
    }));

    vi.doMock('../../lib/useTheme.js', () => ({
      useTheme: () => ({
        theme: mockTheme,
        resolved: mockTheme === 'system' ? 'dark' : mockTheme,
        setTheme: (...a) => mockSetTheme(...a),
      }),
    }));

    vi.doMock('../../components/ViewHeader/ViewHeader.js', () => ({
      default: function MockViewHeader({ title }) {
        return <div data-testid="view-header">{title}</div>;
      },
    }));

    settingsViewPromise = import('./SettingsView.js');
  }

  const mod = await settingsViewPromise;
  return mod.default;
}

beforeAll(async () => {
  await loadSettingsView();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('SettingsView', () => {
  it('renders the settings header', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.querySelector('[data-testid="view-header"]')?.textContent).toBe('Settings');

    unmount();
  });

  it('displays the user handle', async () => {
    const SettingsView = await loadSettingsView({ user: { handle: 'bob', color: 'red' } });
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.textContent).toContain('bob');

    unmount();
  });

  it('offers set username when handle is unset', async () => {
    const SettingsView = await loadSettingsView({
      user: { handle: null, color: 'white' },
      theme: 'dark',
    });
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.textContent).not.toContain('Not set');
    expect(container.textContent).not.toContain('Letters, numbers, and underscores. 3–20 characters.');
    expect(container.querySelector('[aria-label="Set username"]')).not.toBeNull();

    const profileTab = container.querySelector('[data-tab="profile"]');
    expect(profileTab?.textContent).toContain('Manage');
    expect(profileTab?.textContent).toContain('Profile');

    unmount();
  });

  it('shows Edit button that opens handle editor', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    const editBtn = container.querySelector('[aria-label="Edit username"]');
    expect(editBtn).not.toBeNull();
    expect(editBtn?.textContent).toContain('Edit');

    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Should now show input and Save/Cancel buttons
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input.value).toBe('alice');
    expect(container.textContent).toContain('Save');
    expect(container.textContent).toContain('Cancel');

    unmount();
  });

  it('keeps profile row structure when Edit opens', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.querySelector('[data-testid="profile-control-slot"]')).not.toBeNull();
    expect(container.textContent).toContain('Color');
    expect(container.textContent).toContain('Appearance');
    expect(container.querySelectorAll('[aria-label^="Select "]').length).toBe(12);

    const editBtn = container.querySelector('[aria-label="Edit username"]');
    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="profile-control-slot"]')).not.toBeNull();
    expect(container.textContent).toContain('Color');
    expect(container.textContent).toContain('Appearance');
    expect(container.querySelectorAll('[aria-label^="Select "]').length).toBe(12);

    unmount();
  });

  it('tints username with user accent color', async () => {
    const SettingsView = await loadSettingsView({ user: { handle: 'bob', color: 'red' } });
    const { container, unmount } = renderComponent(SettingsView, {});

    const profileValue = container.querySelector('[data-testid="profile-username-value"]');
    expect(profileValue).not.toBeNull();
    expect(profileValue.textContent).toBe('bob');
    expect(profileValue.style.getPropertyValue('color')).toBe('rgb(255, 59, 48)');

    unmount();
  });

  it('validates handle and shows error for invalid input', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    // Open editor
    const editBtn = container.querySelector('[aria-label="Edit username"]');
    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Change to invalid handle (too short)
    const input = container.querySelector('input');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    await act(async () => {
      nativeInputValueSetter.call(input, 'ab');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Click Save
    const saveBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Save'),
    );
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(container.textContent).toContain('3–20 characters');
    expect(mockUpdateUser).not.toHaveBeenCalled();

    unmount();
  });

  it('validates handle with special characters', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    const editBtn = container.querySelector('[aria-label="Edit username"]');
    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = container.querySelector('input');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    await act(async () => {
      nativeInputValueSetter.call(input, 'bad@handle');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Save'),
    );
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(container.textContent).toContain('letters, numbers, and underscores');

    unmount();
  });

  it('updates the local user on valid handle save', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    const editBtn = container.querySelector('[aria-label="Edit username"]');
    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = container.querySelector('input');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    await act(async () => {
      nativeInputValueSetter.call(input, 'new_handle');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Save'),
    );
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    // Handle edits write straight to the local auth store — there is no
    // /me endpoint to round-trip through (single local identity).
    expect(mockUpdateUser).toHaveBeenCalledWith({ handle: 'new_handle' });

    unmount();
  });

  it('closes editor on Cancel click', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    const editBtn = container.querySelector('[aria-label="Edit username"]');
    await act(async () => {
      editBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Scope to the handle input specifically — the Notifications section also
    // renders inputs (threshold/quiet-hours), so a bare `input` query is no
    // longer unambiguous.
    expect(container.querySelector('input[placeholder="3–20 characters"]')).not.toBeNull();

    const cancelBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Cancel'),
    );
    await act(async () => {
      cancelBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Should be back to view mode
    expect(container.querySelector('input[placeholder="3–20 characters"]')).toBeNull();
    expect(container.querySelector('[aria-label="Edit username"]')).not.toBeNull();

    unmount();
  });

  it('renders color palette buttons', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    // 12 color dots in the palette
    const colorButtons = container.querySelectorAll('[aria-label^="Select "]');
    expect(colorButtons.length).toBe(12);

    unmount();
  });

  it('updates the local user on color selection', async () => {
    const SettingsView = await loadSettingsView({ user: { handle: 'alice', color: 'cyan' } });
    const { container, unmount } = renderComponent(SettingsView, {});

    const redButton = container.querySelector('[aria-label="Select red"]');
    await act(async () => {
      redButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(mockUpdateUser).toHaveBeenCalledWith({ color: 'red' });

    unmount();
  });

  it('does not update the user when selecting the current color', async () => {
    const SettingsView = await loadSettingsView({ user: { handle: 'alice', color: 'cyan' } });
    const { container, unmount } = renderComponent(SettingsView, {});

    const cyanButton = container.querySelector('[aria-label="Select cyan"]');
    await act(async () => {
      cyanButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockUpdateUser).not.toHaveBeenCalled();

    unmount();
  });

  it('renders theme toggle with System, Light, Dark options', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.textContent).toContain('System');
    expect(container.textContent).toContain('Light');
    expect(container.textContent).toContain('Dark');

    unmount();
  });

  it('calls setTheme when a theme option is clicked', async () => {
    const SettingsView = await loadSettingsView({ theme: 'system' });
    const { container, unmount } = renderComponent(SettingsView, {});

    const darkOption = [...container.querySelectorAll('[aria-label="Theme"] button')].find(
      (b) => b.textContent?.trim() === 'Dark',
    );
    await act(async () => {
      darkOption.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockSetTheme).toHaveBeenCalledWith('dark');

    unmount();
  });

  it('switches sections through the stat tab strip', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    expect(container.querySelector('#settings-panel-profile')).not.toBeNull();
    expect(container.querySelector('#settings-panel-alerts')).toBeNull();

    await selectSettingsSection(container, 'Alerts');
    expect(container.querySelector('#settings-panel-alerts')).not.toBeNull();
    expect(container.querySelector('#settings-panel-profile')).toBeNull();

    unmount();
  });

  it('calls logout and stops polling when sign out is clicked', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    await selectSettingsSection(container, 'Profile');

    const signOutBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Sign out'),
    );
    await act(async () => {
      signOutBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockStopPolling).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
    expect(mockContinueControlPlaneLogout).toHaveBeenCalled();

    unmount();
  });

  it('starts reauthenticated account deletion from the managed profile', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});

    const deleteButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Delete Seorak account'),
    );
    expect(deleteButton).not.toBeUndefined();
    await act(async () => {
      deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockContinueControlPlaneAccountDeletion).toHaveBeenCalledTimes(1);
    expect(mockLogout).not.toHaveBeenCalled();

    unmount();
  });

  it('keeps polling and exposes recovery when server sign-out fails', async () => {
    const SettingsView = await loadSettingsView();
    mockLogout.mockRejectedValueOnce(new Error('offline'));
    const { container, unmount } = renderComponent(SettingsView, {});

    const signOutBtn = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.includes('Sign out'),
    );
    await act(async () => {
      signOutBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockStopPolling).not.toHaveBeenCalled();
    expect(mockContinueControlPlaneLogout).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not sign out',
    );
    expect(signOutBtn.disabled).toBe(false);

    unmount();
  });

  // ── Notifications section ─────────────────────────

  it('renders the Notifications section with the catalog watches', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Alerts');
    await flushEffects();

    expect(container.textContent).toContain('Alerts');
    expect(container.textContent).toContain('Notify when a session');
    expect(container.textContent).toContain('goes quiet');
    expect(container.textContent).toContain('Notify when today');
    expect(container.querySelectorAll('[data-testid="alerts-watch-row"]').length).toBe(8);

    unmount();
  });

  it.each([
    ['Claude-only', CLAUDE_AVAILABILITY, 8, 0],
    [
      'Codex-only',
      availabilityFor({ agent: 'codex', capabilities: CAPABILITY_REGISTRY.codex }),
      5,
      3,
    ],
    [
      'mixed',
      availabilityFor(
        { agent: 'codex', capabilities: CAPABILITY_REGISTRY.codex },
        { agent: 'claude-code', capabilities: CAPABILITY_REGISTRY['claude-code'] },
      ),
      8,
      0,
    ],
    [
      'unknown agent',
      availabilityFor({ agent: 'future-agent', capabilities: NO_CAPABILITIES }),
      2,
      6,
    ],
  ])('renders %s watch availability honestly', async (_name, notificationAvailability, available, unavailable) => {
    const SettingsView = await loadSettingsView({ notificationAvailability });
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Alerts');
    await flushEffects();

    expect(container.querySelectorAll('[data-availability="available"]')).toHaveLength(available);
    expect(container.querySelectorAll('[data-availability="unavailable"]')).toHaveLength(unavailable);
    expect(
      container.querySelectorAll('[data-availability="unavailable"] button:disabled'),
    ).toHaveLength(unavailable);
    if (unavailable > 0) expect(container.textContent).toContain('cannot fire');

    unmount();
  });

  it('fails closed while agent availability is still unknown', async () => {
    const SettingsView = await loadSettingsView({
      notificationAvailability: deriveNotificationAvailability([]),
    });
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Alerts');
    await flushEffects();

    expect(container.querySelectorAll('[data-availability="unknown"]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-availability="unknown"] button:disabled')).toHaveLength(8);
    expect(container.textContent).toContain(
      'Watch availability appears after Seorak captures an agent session.',
    );

    unmount();
  });

  it('round-trips a signal toggle through PUT /settings', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Alerts');
    await flushEffects();

    // The default-OFF session_ended watch — flip it ON.
    const toggle = container.querySelector('[aria-label="Session ended notifications"]');
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(mockUpdateNotificationSettings).toHaveBeenCalledTimes(1);
    const patch = mockUpdateNotificationSettings.mock.calls[0][0];
    expect(patch.signals.session_ended.enabled).toBe(true);
    // Optimistic + reconciled echo both leave it checked.
    expect(
      container
        .querySelector('[aria-label="Session ended notifications"]')
        .getAttribute('aria-checked'),
    ).toBe('true');

    unmount();
  });

  it('flips to read-only on a 401 write and reverts the optimistic toggle', async () => {
    const err = new Error('PUT /settings failed: 401');
    err.status = 401;
    const SettingsView = await loadSettingsView({ updateRejects: err });
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Alerts');
    await flushEffects();

    const toggle = container.querySelector('[aria-label="Session ended notifications"]');
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    // Reverted to the prior (OFF) state and the owner-token hint surfaced.
    expect(
      container
        .querySelector('[aria-label="Session ended notifications"]')
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(container.textContent).toContain(
      "This access token can read this worker, but it can't change notification settings.",
    );
    expect(container.textContent).toContain("Sign in with the worker's owner token");
    // Read-only: a second click no longer issues a write.
    const callsAfterFirst = mockUpdateNotificationSettings.mock.calls.length;
    await act(async () => {
      container
        .querySelector('[aria-label="Session ended notifications"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();
    expect(mockUpdateNotificationSettings.mock.calls.length).toBe(callsAfterFirst);

    unmount();
  });

  it('renders a per-project mute row from the dashboard projects', async () => {
    const SettingsView = await loadSettingsView({
      projects: [{ project: 'seorak', repoId: 'r_abc' }],
    });
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Alerts');
    await flushEffects();

    const muteToggle = container.querySelector('[aria-label="Mute seorak"]');
    expect(muteToggle).not.toBeNull();

    await act(async () => {
      muteToggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(mockUpdateNotificationSettings).toHaveBeenCalled();
    const patch = mockUpdateNotificationSettings.mock.calls.at(-1)[0];
    expect(patch.perProject.r_abc.muted).toBe(true);

    unmount();
  });

  it('omits per-project rows when no projects exist', async () => {
    const SettingsView = await loadSettingsView({ projects: [] });
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Alerts');
    await flushEffects();

    expect(container.querySelector('[data-testid="alerts-project-row"]')).toBeNull();
    expect(container.textContent).not.toContain('Mute pushes from');

    unmount();
  });

  it('renders alert controls in demo with local-only toggles', async () => {
    const SettingsView = await loadSettingsView({ demo: true });
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Alerts');
    await flushEffects();

    expect(container.textContent).not.toContain('not available in demo mode');
    expect(container.querySelector('[data-testid="alerts-controls"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Cost spike notifications"]')).not.toBeNull();
    expect(mockFetchNotificationSettings).not.toHaveBeenCalled();

    const toggle = container.querySelector('[aria-label="Session ended notifications"]');
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(mockUpdateNotificationSettings).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    unmount();
  });

  // ── Capture section ─────────────────────────────

  it('renders capture controls in demo with local-only toggles', async () => {
    const SettingsView = await loadSettingsView({ demo: true });
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Capture');
    await flushEffects();

    expect(container.textContent).not.toContain('not available in demo mode');
    expect(container.querySelector('[data-testid="capture-controls"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Count lines added and removed on each edit?"]')).not.toBeNull();
    expect(mockFetchCaptureSettings).not.toHaveBeenCalled();

    const toggle = container.querySelector(`[aria-label="${FILE_LABELS_ARIA}"]`);
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(mockUpdateCaptureSettings).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    unmount();
  });

  it('renders capture toggles in settingsRow layout when worker is reachable', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Capture');
    await flushEffects();

    expect(container.querySelector('[data-testid="capture-controls"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="capture-toggle-row"]').length).toBe(4);
    expect(container.textContent).not.toContain('Raw file names');

    unmount();
  });

  it('round-trips a capture toggle through PUT /settings', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});
    await selectSettingsSection(container, 'Capture');
    await flushEffects();

    const toggle = container.querySelector(`[aria-label="${FILE_LABELS_ARIA}"]`);
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(mockUpdateCaptureSettings).toHaveBeenCalledWith({ fileLabels: true });
    expect(
      container.querySelector(`[aria-label="${FILE_LABELS_ARIA}"]`).getAttribute('aria-checked'),
    ).toBe('true');

    unmount();
  });

  it('withholds the public tab on a plane that does not serve publication', async () => {
    // Every /public-presence/* route belongs to an operated directory, so a
    // local plane serves none of them. Rendering the tab anyway gives a control
    // whose every call fails; withholding it is the same "unavailable, never
    // empty" rule the read surfaces already follow.
    const SettingsView = await loadSettingsView();
    mockCurrentPlaneServes.mockImplementation((surface) => surface !== 'publication');
    const { container, unmount } = renderComponent(SettingsView, {});
    await flushEffects();

    expect(container.querySelector('[data-tab="public"]')).toBeNull();
    expect(container.querySelector('[data-tab="capture"]')).not.toBeNull();

    unmount();
  });

  it('keeps the public tab when the plane serves publication', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});
    await flushEffects();

    expect(container.querySelector('[data-tab="public"]')).not.toBeNull();

    unmount();
  });

  it('withholds private API access on a plane that does not serve integrations', async () => {
    // The panel shipped unconditional, and on a local install every call it
    // made 404'd behind a form that looked live. A loopback plane mints no
    // credential, so there is nothing to issue, list, or revoke; withholding
    // the control is the same "unavailable, never empty" rule the read surfaces
    // and the public tab already follow.
    const SettingsView = await loadSettingsView();
    mockCurrentPlaneServes.mockImplementation((surface) => surface !== 'integrations');
    const { container, unmount } = renderComponent(SettingsView, {});
    await flushEffects();
    // The panel lives on Profile, and an earlier test in this file may have left
    // `?section=` pointing elsewhere in the shared jsdom URL.
    await selectSettingsSection(container, 'Profile');

    expect(container.textContent).not.toContain('Private integration access');
    // The rest of Profile is untouched: this withholds one panel, not the tab.
    expect(container.querySelector('[data-tab="profile"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Edit username"]')).not.toBeNull();

    unmount();
  });

  it('renders private API access when the plane serves integrations', async () => {
    const SettingsView = await loadSettingsView();
    mockCurrentPlaneServes.mockImplementation((surface) => surface === 'integrations');
    const { container, unmount } = renderComponent(SettingsView, {});
    await flushEffects();
    await selectSettingsSection(container, 'Profile');

    expect(container.textContent).toContain('Private integration access');

    unmount();
  });

  it('renders private API access when no descriptor was probed at all', async () => {
    // `currentPlaneServes` answers true for an UNKNOWN plane, which is every
    // deployment predating the data-plane contract. Those must look exactly as
    // they did, so the panel's own error handling stands rather than the shell
    // guessing the surface away.
    const SettingsView = await loadSettingsView();
    mockCurrentPlaneServes.mockReturnValue(true);
    const { container, unmount } = renderComponent(SettingsView, {});
    await flushEffects();
    await selectSettingsSection(container, 'Profile');

    expect(container.textContent).toContain('Private integration access');

    unmount();
  });

  it('shows toggle counts on capture and alerts tabs', async () => {
    const SettingsView = await loadSettingsView();
    const { container, unmount } = renderComponent(SettingsView, {});
    await flushEffects();

    const captureTab = container.querySelector('[data-tab="capture"]');
    const alertsTab = container.querySelector('[data-tab="alerts"]');
    expect(captureTab?.textContent).toContain('3 of 4 on');
    expect(alertsTab?.textContent).toContain('5 of 8 on');

    unmount();
  });
});

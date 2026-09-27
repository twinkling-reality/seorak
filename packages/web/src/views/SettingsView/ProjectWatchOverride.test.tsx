// @vitest-environment jsdom

/*
 * The per-project override editor, and specifically the one thing that is easy
 * to get wrong and impossible to see: RETURNING A WATCH TO INHERITED.
 *
 * The worker deep-merges, so a patch that simply stops mentioning an override
 * merges back into the stored value and changes nothing. That is not a
 * hypothetical — it is what the phone shipped, and this suite asserts the shape
 * that actually reaches the wire rather than the shape of local state, because
 * local state was never the half that was broken.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  SIGNAL_CATALOG,
  type NotificationSettings,
} from '@seorak/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const updateNotificationSettings = vi.fn();
let stored: NotificationSettings;

vi.mock('../../lib/api.js', () => ({
  fetchNotificationSettings: () => Promise.resolve(stored),
  updateNotificationSettings: (patch: unknown) => {
    updateNotificationSettings(patch);
    return Promise.resolve(stored);
  },
}));

vi.mock('../../lib/stores/polling.js', () => ({
  usePollingStore: (select: (s: unknown) => unknown) =>
    select({
      overviewData: {
        usage: { projects: [{ repoId: 'r1', project: 'seorak' }] },
        tools: { byAgent: [] },
      },
    }),
}));

vi.mock('../../lib/workspaceContext.js', () => ({
  useWorkspaceContext: () => null,
}));

const { default: NotificationsSection } = await import('./NotificationsSection.js');

let host: HTMLDivElement;
let root: Root;

function settings(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return { ...structuredClone(DEFAULT_NOTIFICATION_SETTINGS), ...overrides };
}

async function mount(): Promise<void> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<NotificationsSection />);
  });
}

function watchRows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[data-testid="alerts-project-watch"]')];
}

/** The row for one signal, found by the catalog label it leads with. */
function rowFor(label: string): HTMLElement {
  const row = watchRows().find((r) => r.textContent?.startsWith(label));
  if (!row) throw new Error(`no per-project row for ${label}`);
  return row;
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

beforeEach(() => {
  updateNotificationSettings.mockClear();
  stored = settings();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('per-project watch overrides on the web', () => {
  it('offers a row per repo-scoped tunable watch, and none for the account-scoped one', async () => {
    await mount();
    const labels = watchRows().map((r) => r.textContent ?? '');
    // Every catalog signal carrying a threshold, except daily_cost_cap, which the
    // sweep reads globally — a per-project override of it would never be read.
    expect(labels.some((l) => l.startsWith(SIGNAL_CATALOG.cost_spike.label))).toBe(true);
    expect(labels.some((l) => l.startsWith(SIGNAL_CATALOG.stuck_loop.label))).toBe(true);
    expect(labels.some((l) => l.startsWith(SIGNAL_CATALOG.daily_cost_cap.label))).toBe(false);
    // The two threshold-free signals have nothing to tune per project.
    expect(labels.some((l) => l.startsWith(SIGNAL_CATALOG.session_ended.label))).toBe(false);
  });

  it('shows the inherited number as the placeholder, with the field empty', async () => {
    stored = settings({
      signals: {
        ...DEFAULT_NOTIFICATION_SETTINGS.signals,
        cost_spike: { enabled: true, thresholds: { costSpikeUsd: 12 } },
      },
    });
    await mount();
    const input = rowFor(SIGNAL_CATALOG.cost_spike.label).querySelector('input');
    // Empty means inherit; the global stored 12 is what it inherits, and the
    // reader can see the number without it looking like a per-project value.
    expect((input as HTMLInputElement).value).toBe('');
    expect((input as HTMLInputElement).placeholder).toBe('12');
  });

  it('setting a watch Off for one project patches only that signal', async () => {
    await mount();
    const off = [...rowFor(SIGNAL_CATALOG.cost_spike.label).querySelectorAll('button')].find(
      (b) => b.textContent === 'Off',
    );
    await click(off!);
    expect(updateNotificationSettings).toHaveBeenCalledWith({
      perProject: { r1: { muted: false, overrides: { cost_spike: { enabled: false } } } },
    });
  });

  it('returning to Inherit sends a null tombstone, not an omission', async () => {
    stored = settings({
      perProject: { r1: { muted: false, overrides: { cost_spike: { enabled: false } } } },
    });
    await mount();
    const inherit = [...rowFor(SIGNAL_CATALOG.cost_spike.label).querySelectorAll('button')].find(
      (b) => b.textContent?.startsWith('Inherit'),
    );
    await click(inherit!);
    // Nothing of the override survives, so the whole signal is tombstoned. An
    // omission here would merge back in and the control would do nothing.
    expect(updateNotificationSettings).toHaveBeenCalledWith({
      perProject: { r1: { muted: false, overrides: { cost_spike: null } } },
    });
  });

  it('a tombstone keeps the fields the edit did not touch', async () => {
    stored = settings({
      perProject: {
        r1: {
          muted: false,
          overrides: { cost_spike: { enabled: true, thresholds: { costSpikeUsd: 3 } } },
        },
      },
    });
    await mount();
    const inherit = [...rowFor(SIGNAL_CATALOG.cost_spike.label).querySelectorAll('button')].find(
      (b) => b.textContent?.startsWith('Inherit'),
    );
    await click(inherit!);
    // `enabled` goes, the threshold stays — so the patch names both, one as a
    // tombstone and one as a survivor.
    expect(updateNotificationSettings).toHaveBeenCalledWith({
      perProject: {
        r1: {
          muted: false,
          overrides: { cost_spike: { thresholds: { costSpikeUsd: 3 }, enabled: null } },
        },
      },
    });
  });

  it('a muted project renders no overrides at all', async () => {
    stored = settings({ perProject: { r1: { muted: true } } });
    await mount();
    // Mute is the master; a threshold under it is a control that does nothing.
    expect(watchRows()).toHaveLength(0);
  });

  it('a watch that is off globally hides its thresholds and says why', async () => {
    stored = settings({
      signals: { ...DEFAULT_NOTIFICATION_SETTINGS.signals, cost_spike: { enabled: false } },
    });
    await mount();
    const row = rowFor(SIGNAL_CATALOG.cost_spike.label);
    expect(row.textContent).toContain('off globally');
    expect(row.querySelector('input')).toBeNull();
  });
});

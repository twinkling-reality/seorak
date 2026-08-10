// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSlot } from '../../widgets/catalog/index.js';
import { PROJECT_DEFAULT_LAYOUT } from './projectTabDefaults.js';
import { useProjectDashboardLayout } from './useProjectTabLayout.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Layout = ReturnType<typeof useProjectDashboardLayout>;

let teardown: (() => void) | null = null;

function mountLayout() {
  const box: { api: Layout | null } = { api: null };

  function Probe() {
    box.api = useProjectDashboardLayout('bulk-test', PROJECT_DEFAULT_LAYOUT);
    return null;
  }

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Probe />);
  });
  teardown = () => {
    act(() => root.unmount());
    host.remove();
  };
  return {
    get api() {
      return box.api!;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  teardown?.();
  teardown = null;
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('project dashboard bulk add', () => {
  it('appends missing valid widgets in caller order as one persisted, undoable transaction', () => {
    const h = mountLayout();
    const beforeSlots = h.api.slots;
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    act(() => {
      expect(
        h.api.addWidgets([
          'model-mix',
          beforeSlots[0].id,
          'verification',
          'model-mix',
          'unknown',
        ]),
      ).toEqual(['model-mix', 'verification']);
    });

    expect(h.api.slots).toEqual([
      ...beforeSlots,
      defaultSlot('model-mix'),
      defaultSlot('verification'),
    ]);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('seorak:project-bulk-test-dashboard')!).widgets).toEqual(
      h.api.slots,
    );

    act(() => {
      expect(h.api.undo()).toBe(true);
    });
    expect(h.api.slots).toEqual(beforeSlots);
    act(() => {
      expect(h.api.undo()).toBe(false);
    });
  });

  it('does not persist or create undo history for no-op add and clear requests', () => {
    const h = mountLayout();
    const beforeSlots = h.api.slots;
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    act(() => {
      expect(h.api.addWidgets([beforeSlots[0].id, 'unknown', beforeSlots[0].id])).toEqual([]);
    });
    expect(h.api.slots).toEqual(beforeSlots);
    expect(setItem).not.toHaveBeenCalled();
    act(() => {
      expect(h.api.undo()).toBe(false);
    });

    act(() => expect(h.api.clearAll()).toBeGreaterThan(0));
    setItem.mockClear();
    act(() => expect(h.api.clearAll()).toBe(0));
    expect(setItem).not.toHaveBeenCalled();
    act(() => {
      expect(h.api.undo()).toBe(true);
    });
    expect(h.api.slots).toEqual(beforeSlots);
    act(() => {
      expect(h.api.undo()).toBe(false);
    });
  });
});

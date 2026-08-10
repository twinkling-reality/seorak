// @vitest-environment jsdom
//
// The other half of the picker's destructive actions. `Empty dashboard` and
// `Restore default` have no confirm dialog by design — the guard is the ⇧
// modifier on the way in and Cmd/Ctrl-Z on the way out. The catalog's own DOM
// test proves the modifier gate; this one proves the way out, because a wipe
// with no working undo is a wipe with no guard at all.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_WIDGET_IDS, defaultSlot } from '../../../widgets/catalog/index.js';
import { useUndoHotkey } from '../../../hooks/useDashboardChrome.js';
import { useOverviewLayout } from '../useOverviewLayout.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Layout = ReturnType<typeof useOverviewLayout>;

let teardown: (() => void) | null = null;

function mountLayout({ withUndoHotkey = false } = {}) {
  const box: { api: Layout | null } = { api: null };
  const announce = vi.fn();

  function Probe() {
    const api = useOverviewLayout();
    box.api = api;
    useUndoHotkey(withUndoHotkey ? api.undo : () => false, announce);
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
    announce,
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

describe('bulk add', () => {
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
    expect(JSON.parse(localStorage.getItem('seorak:overview-dashboard')!).widgets).toEqual(
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

  it('does not persist or create undo history when every requested id is active or invalid', () => {
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
  });
});

describe('empty dashboard', () => {
  it('removes every widget', () => {
    const h = mountLayout();
    expect(h.api.widgetIds.length).toBeGreaterThan(0);
    act(() => expect(h.api.clearAll()).toBeGreaterThan(0));
    expect(h.api.widgetIds).toEqual([]);
  });

  it('is undoable back to the exact previous board', () => {
    const h = mountLayout();
    const before = h.api.widgetIds;
    act(() => expect(h.api.clearAll()).toBeGreaterThan(0));
    expect(h.api.widgetIds).toEqual([]);
    act(() => {
      expect(h.api.undo()).toBe(true);
    });
    expect(h.api.widgetIds).toEqual(before);
  });

  it('persists the wipe, so a reload does not silently resurrect the board', () => {
    const h = mountLayout();
    act(() => expect(h.api.clearAll()).toBeGreaterThan(0));
    expect(JSON.parse(localStorage.getItem('seorak:overview-dashboard')!).widgets).toEqual([]);
  });

  it('is a true no-op when already empty, preserving the original undo snapshot', () => {
    const h = mountLayout();
    const before = h.api.widgetIds;
    act(() => expect(h.api.clearAll()).toBeGreaterThan(0));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    act(() => expect(h.api.clearAll()).toBe(0));

    expect(setItem).not.toHaveBeenCalled();
    act(() => {
      expect(h.api.undo()).toBe(true);
    });
    expect(h.api.widgetIds).toEqual(before);
    act(() => {
      expect(h.api.undo()).toBe(false);
    });
  });
});

describe('restore default', () => {
  it('replaces a customized board with the default layout', () => {
    const h = mountLayout();
    act(() => h.api.clearAll());
    act(() => h.api.resetToDefault());
    expect(h.api.widgetIds).toEqual(DEFAULT_WIDGET_IDS);
  });

  it('is undoable back to the customized board', () => {
    const h = mountLayout();
    act(() => h.api.toggleWidget(h.api.widgetIds[0]));
    const customized = h.api.widgetIds;
    act(() => h.api.resetToDefault());
    expect(h.api.widgetIds).toEqual(DEFAULT_WIDGET_IDS);
    act(() => {
      h.api.undo();
    });
    expect(h.api.widgetIds).toEqual(customized);
  });
});

describe('undo', () => {
  it('unwinds one step at a time', () => {
    const h = mountLayout();
    const start = h.api.widgetIds;
    act(() => h.api.toggleWidget(start[0]));
    const afterFirst = h.api.widgetIds;
    act(() => h.api.toggleWidget(afterFirst[0]));
    act(() => {
      h.api.undo();
    });
    expect(h.api.widgetIds).toEqual(afterFirst);
    act(() => {
      h.api.undo();
    });
    expect(h.api.widgetIds).toEqual(start);
  });

  it('reports that it did nothing when there is nothing to undo', () => {
    const h = mountLayout();
    act(() => {
      expect(h.api.undo()).toBe(false);
    });
  });

  it('fires on Cmd/Ctrl-Z and announces the change', () => {
    const h = mountLayout({ withUndoHotkey: true });
    const before = h.api.widgetIds;
    act(() => h.api.clearAll());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    });
    expect(h.api.widgetIds).toEqual(before);
    expect(h.announce).toHaveBeenCalledWith('Undid last layout change');
  });

  it('leaves Cmd/Shift-Z alone — redo is not undo', () => {
    const h = mountLayout({ withUndoHotkey: true });
    act(() => h.api.clearAll());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true }),
      );
    });
    expect(h.api.widgetIds).toEqual([]);
  });

  it('does not steal Cmd-Z from a focused text field', () => {
    const h = mountLayout({ withUndoHotkey: true });
    act(() => h.api.clearAll());
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    });
    expect(h.api.widgetIds).toEqual([]);
    input.remove();
  });
});

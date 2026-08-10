// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDashboardLayoutActions } from '../useDashboardChrome.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let teardown: (() => void) | null = null;

afterEach(() => {
  teardown?.();
  teardown = null;
});

describe('useDashboardLayoutActions', () => {
  it('announces and highlights the identities the layout store actually added', () => {
    const announce = vi.fn();
    const setRecentlyAddedId = vi.fn();
    const box: { actions?: ReturnType<typeof useDashboardLayoutActions> } = {};

    function Probe() {
      box.actions = useDashboardLayoutActions({
        widgetIds: ['sessions'],
        toggleWidget: vi.fn(),
        addWidgets: vi.fn(() => ['verification']),
        removeWidget: vi.fn(),
        clearAll: vi.fn(() => 0),
        announce,
        setRecentlyAddedId,
      });
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    teardown = () => {
      act(() => root.unmount());
      host.remove();
    };

    act(() => {
      expect(box.actions!.addWidgets(['sessions', 'verification'])).toEqual(['verification']);
    });
    expect(announce).toHaveBeenCalledWith('Added 1 widget');
    expect(setRecentlyAddedId).toHaveBeenCalledWith('verification');
  });

  it('announces clear only when the layout store reports a real change', () => {
    const announce = vi.fn();
    const clearAll = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(3);
    const box: { actions?: ReturnType<typeof useDashboardLayoutActions> } = {};

    function Probe() {
      box.actions = useDashboardLayoutActions({
        widgetIds: [],
        toggleWidget: vi.fn(),
        addWidgets: vi.fn(() => []),
        removeWidget: vi.fn(),
        clearAll,
        announce,
        setRecentlyAddedId: vi.fn(),
      });
      return null;
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    teardown = () => {
      act(() => root.unmount());
      host.remove();
    };

    act(() => box.actions!.clearAll());
    expect(announce).not.toHaveBeenCalled();
    act(() => box.actions!.clearAll());
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Cleared all widgets');
  });
});

import { useCallback, useEffect, useState } from 'react';
import { getWidget } from '../widgets/catalog/index.js';
import { count } from '../lib/voice/text.js';

/**
 * Transient dashboard-shell chrome shared by OverviewView and ProjectView. Each
 * concern below was a byte-identical copy in both views before the extraction
 * (audit D6); they are grouped here because they are all small, view-agnostic
 * pieces of the customize/layout experience.
 */

/**
 * A visually-hidden live-region announcer for layout changes. Returns the text
 * to render inside the `role="status"` region plus an `announce` that resets
 * then re-sets it on the next frame, so repeating the same message still fires a
 * screen-reader update.
 */
export function useAnnouncer(): { announcement: string; announce: (text: string) => void } {
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((text: string) => {
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(text));
  }, []);
  return { announcement, announce };
}

/**
 * Tracks the id of a just-added widget so the grid can scroll to and flash it,
 * auto-clearing after the flash window. Set it when a widget is added; the grid
 * reads it and it resets itself.
 */
export function useRecentlyAdded(): {
  recentlyAddedId: string | null;
  setRecentlyAddedId: (id: string | null) => void;
} {
  const [recentlyAddedId, setRecentlyAddedId] = useState<string | null>(null);
  useEffect(() => {
    if (!recentlyAddedId) return;
    const t = setTimeout(() => setRecentlyAddedId(null), 2500);
    return () => clearTimeout(t);
  }, [recentlyAddedId]);
  return { recentlyAddedId, setRecentlyAddedId };
}

interface DashboardLayoutActionOptions {
  widgetIds: string[];
  toggleWidget: (id: string) => void;
  addWidgets: (ids: readonly string[]) => readonly string[];
  removeWidget: (id: string) => void;
  clearAll: () => number;
  announce: (text: string) => void;
  setRecentlyAddedId: (id: string | null) => void;
}

/**
 * Shared catalog/grid controller for the two customizable dashboard hosts.
 * Eligibility stays in WidgetCatalog and persistence stays in each layout
 * store; this seam owns the user feedback that must remain identical across
 * Overview and Project.
 */
export function useDashboardLayoutActions({
  widgetIds,
  toggleWidget: toggleWidgetRaw,
  addWidgets: addWidgetsRaw,
  removeWidget: removeWidgetRaw,
  clearAll: clearAllRaw,
  announce,
  setRecentlyAddedId,
}: DashboardLayoutActionOptions) {
  const toggleWidget = useCallback(
    (id: string) => {
      const widget = getWidget(id);
      const removing = widgetIds.includes(id);
      toggleWidgetRaw(id);
      if (widget) announce(`${removing ? 'Removed' : 'Added'} ${widget.name}`);
      if (!removing) setRecentlyAddedId(id);
    },
    [widgetIds, toggleWidgetRaw, announce, setRecentlyAddedId],
  );

  const addWidgets = useCallback(
    (ids: string[]) => {
      const addedIds = addWidgetsRaw(ids);
      if (addedIds.length > 0) {
        announce(`Added ${count(addedIds.length, 'widget')}`);
        if (addedIds.length === 1) setRecentlyAddedId(addedIds[0] ?? null);
      }
      return addedIds;
    },
    [addWidgetsRaw, announce, setRecentlyAddedId],
  );

  const removeWidget = useCallback(
    (id: string) => {
      const widget = getWidget(id);
      removeWidgetRaw(id);
      if (widget) announce(`Removed ${widget.name}`);
    },
    [removeWidgetRaw, announce],
  );

  const clearAll = useCallback(() => {
    if (clearAllRaw() > 0) announce('Cleared all widgets');
  }, [clearAllRaw, announce]);

  return { toggleWidget, addWidgets, removeWidget, clearAll };
}

/**
 * Cmd/Ctrl-Z to undo the last layout change, ignoring the shortcut while a form
 * control or contentEditable is focused. `undo` returns whether anything was
 * undone; only then is the key swallowed and the change announced.
 */
export function useUndoHotkey(undo: () => boolean, announce: (text: string) => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'z' || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }
      const undone = undo();
      if (undone) {
        e.preventDefault();
        announce('Undid last layout change');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, announce]);
}

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  defaultSlot,
  getWidget,
  type WidgetSlot,
  type WidgetColSpan,
  type WidgetRowSpan,
} from '../../widgets/catalog/index.js';
import { appendMissingWidgetSlots } from '../../widgets/layoutMutations.js';

// Layout persistence for the project page's single customizable dashboard.
// Current shape: ordered WidgetSlots with colSpan/rowSpan only.

const STORAGE_VERSION = 3;
const UNDO_STACK_LIMIT = 25;

interface DashboardLayout {
  version: number;
  widgets: WidgetSlot[];
}

function storageKey(layoutId: string): string {
  return `seorak:project-${layoutId}-dashboard`;
}

function buildDefaultLayout(defaults: WidgetSlot[]): DashboardLayout {
  return {
    version: STORAGE_VERSION,
    widgets: normalizeCurrentLayout(defaults.map((s) => ({ ...s }))),
  };
}

function normalizeCurrentLayout(slots: WidgetSlot[]): WidgetSlot[] {
  const seen = new Set<string>();
  const out: WidgetSlot[] = [];
  for (const slot of slots) {
    const def = getWidget(slot.id);
    if (!def || seen.has(slot.id)) continue;
    const maxCol = (def.maxW ?? 12) as WidgetColSpan;
    const maxRow = (def.maxH ?? 6) as WidgetRowSpan;
    const minCol = (def.minW ?? 3) as WidgetColSpan;
    const minRow = (def.minH ?? 2) as WidgetRowSpan;
    const colSpan = Math.max(minCol, Math.min(maxCol, slot.colSpan)) as WidgetColSpan;
    const rowSpan = Math.max(minRow, Math.min(maxRow, slot.rowSpan)) as WidgetRowSpan;
    seen.add(slot.id);
    out.push({ ...slot, colSpan, rowSpan });
  }
  return out;
}

function loadDashboard(layoutId: string, defaults: WidgetSlot[]): DashboardLayout {
  try {
    const raw = localStorage.getItem(storageKey(layoutId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === STORAGE_VERSION && Array.isArray(parsed.widgets)) {
        const normalized = normalizeCurrentLayout(parsed.widgets as WidgetSlot[]);
        const stored = parsed.widgets as WidgetSlot[];
        const changed =
          normalized.length !== stored.length ||
          normalized.some(
            (s, i) =>
              s.id !== stored[i]?.id ||
              s.colSpan !== stored[i]?.colSpan ||
              s.rowSpan !== stored[i]?.rowSpan,
          );
        if (changed) {
          saveDashboard(layoutId, { version: STORAGE_VERSION, widgets: normalized });
        }
        return { version: STORAGE_VERSION, widgets: normalized };
      }
    }
  } catch {
    // Ignore corrupt storage
  }
  const def = buildDefaultLayout(defaults);
  saveDashboard(layoutId, def);
  return def;
}

function saveDashboard(layoutId: string, layout: DashboardLayout) {
  try {
    localStorage.setItem(storageKey(layoutId), JSON.stringify(layout));
  } catch {
    // Ignore storage quota
  }
}

export function useProjectDashboardLayout(layoutId: string, defaults: WidgetSlot[]) {
  const [dashboard, setDashboardInner] = useState<DashboardLayout>(() =>
    loadDashboard(layoutId, defaults),
  );

  const dashboardRef = useRef(dashboard);
  dashboardRef.current = dashboard;

  // Re-load when the layout id changes (different storage key).
  useEffect(() => {
    setDashboardInner(loadDashboard(layoutId, defaults));
    // Intentionally only re-run on layoutId change; defaults is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutId]);

  const undoStackRef = useRef<DashboardLayout[]>([]);

  const pushUndoSnapshot = useCallback(() => {
    const snap = dashboardRef.current;
    if (!snap) return;
    const stack = undoStackRef.current;
    stack.push(snap);
    if (stack.length > UNDO_STACK_LIMIT) stack.shift();
  }, []);

  const setAndSave = useCallback(
    (fn: (prev: DashboardLayout) => DashboardLayout) => {
      pushUndoSnapshot();
      setDashboardInner((prev) => {
        const next = fn(prev);
        saveDashboard(layoutId, next);
        return next;
      });
    },
    [pushUndoSnapshot, layoutId],
  );

  const widgetIds = dashboard.widgets.map((s) => s.id);

  const toggleWidget = useCallback(
    (id: string) => {
      setAndSave((prev) => {
        const exists = prev.widgets.some((s) => s.id === id);
        if (exists) {
          return { ...prev, widgets: prev.widgets.filter((s) => s.id !== id) };
        }
        const slot = defaultSlot(id);
        if (!slot) return prev;
        return { ...prev, widgets: [...prev.widgets, slot] };
      });
    },
    [setAndSave],
  );

  // Append a caller-ordered set of catalog widgets as one persisted layout
  // transaction. Scope, filters, and capture-off exclusions belong to the
  // catalog caller; this hook validates ids and preserves the saved layout.
  const addWidgets = useCallback(
    (ids: readonly string[]) => {
      const current = dashboardRef.current;
      const appended = appendMissingWidgetSlots(current.widgets, ids);
      if (!appended) return [];

      pushUndoSnapshot();
      const next: DashboardLayout = { ...current, widgets: appended.widgets };
      dashboardRef.current = next;
      saveDashboard(layoutId, next);
      setDashboardInner(next);
      return appended.addedIds;
    },
    [pushUndoSnapshot, layoutId],
  );

  // Insert a catalog widget at a specific index. Drag-from-catalog uses this
  // so the drop location becomes the insertion point in the source order.
  const addWidgetAt = useCallback(
    (id: string, index: number) => {
      setAndSave((prev) => {
        if (prev.widgets.some((s) => s.id === id)) return prev;
        const slot = defaultSlot(id);
        if (!slot) return prev;
        const widgets = [...prev.widgets];
        const clamped = Math.max(0, Math.min(index, widgets.length));
        widgets.splice(clamped, 0, slot);
        return { ...prev, widgets };
      });
    },
    [setAndSave],
  );

  const removeWidget = useCallback(
    (id: string) => {
      setAndSave((prev) => ({
        ...prev,
        widgets: prev.widgets.filter((s) => s.id !== id),
      }));
    },
    [setAndSave],
  );

  const reorderWidgets = useCallback(
    (ids: string[]) => {
      setAndSave((prev) => {
        const byId = new Map(prev.widgets.map((s) => [s.id, s]));
        const reordered = ids.map((id) => byId.get(id)).filter((s): s is WidgetSlot => !!s);
        for (const s of prev.widgets) {
          if (!ids.includes(s.id)) reordered.push(s);
        }
        return { ...prev, widgets: reordered };
      });
    },
    [setAndSave],
  );

  const setSlotSize = useCallback(
    (id: string, size: { colSpan?: WidgetColSpan; rowSpan?: WidgetRowSpan }) => {
      const def = getWidget(id);
      setAndSave((prev) => ({
        ...prev,
        widgets: prev.widgets.map((s) => {
          if (s.id !== id) return s;
          const requestedCol = size.colSpan ?? s.colSpan;
          const requestedRow = size.rowSpan ?? s.rowSpan;
          const maxCol = (def?.maxW ?? 12) as WidgetColSpan;
          const maxRow = (def?.maxH ?? 6) as WidgetRowSpan;
          const minCol = (def?.minW ?? 3) as WidgetColSpan;
          const minRow = (def?.minH ?? 2) as WidgetRowSpan;
          return {
            ...s,
            colSpan: Math.max(minCol, Math.min(maxCol, requestedCol)) as WidgetColSpan,
            rowSpan: Math.max(minRow, Math.min(maxRow, requestedRow)) as WidgetRowSpan,
          };
        }),
      }));
    },
    [setAndSave],
  );

  const resetToDefault = useCallback(() => {
    pushUndoSnapshot();
    const def = buildDefaultLayout(defaults);
    saveDashboard(layoutId, def);
    setDashboardInner(def);
  }, [pushUndoSnapshot, defaults, layoutId]);

  const clearAll = useCallback(() => {
    const current = dashboardRef.current;
    if (current.widgets.length === 0) return 0;

    pushUndoSnapshot();
    const empty: DashboardLayout = { version: STORAGE_VERSION, widgets: [] };
    dashboardRef.current = empty;
    saveDashboard(layoutId, empty);
    setDashboardInner(empty);
    return current.widgets.length;
  }, [pushUndoSnapshot, layoutId]);

  const undo = useCallback((): boolean => {
    const snap = undoStackRef.current.pop();
    if (!snap) return false;
    saveDashboard(layoutId, snap);
    setDashboardInner(snap);
    return true;
  }, [layoutId]);

  return {
    widgetIds,
    slots: dashboard.widgets,
    toggleWidget,
    addWidgets,
    addWidgetAt,
    removeWidget,
    reorderWidgets,
    setSlotSize,
    resetToDefault,
    clearAll,
    undo,
  };
}

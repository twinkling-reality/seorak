import { useState, useCallback, useRef, useEffect } from 'react';
import {
  DEFAULT_LAYOUT,
  FULL_DEFAULT_LAYOUT,
  STARTER_WIDGET_IDS,
  defaultSlot,
  getWidget,
  type WidgetSlot,
  type WidgetColSpan,
  type WidgetRowSpan,
} from '../../widgets/catalog/index.js';
import type { CaptureSettings, OverviewSnapshot } from '@seorak/types';
import { resolveDefaultLayout } from '../../lib/widgetReadiness.js';
import { appendMissingWidgetSlots } from '../../widgets/layoutMutations.js';

// ── Unified layout store ─────────────────────────
// v4 shape: ordered list of WidgetSlots. Each slot carries only the
// grid-axis sizes (colSpan, rowSpan) - no x/y. Rendering is CSS Grid with
// grid-auto-flow:row, so ordering is the only placement signal.

const STORAGE_KEY = 'seorak:overview-dashboard';
const STORAGE_VERSION = 5;
const PREVIOUS_STORAGE_VERSIONS = new Set([3, 4]);
const UNDO_STACK_LIMIT = 25;

interface DashboardLayout {
  version: number;
  widgets: WidgetSlot[];
}

function buildDefaultLayout(): DashboardLayout {
  return { version: STORAGE_VERSION, widgets: DEFAULT_LAYOUT.map((s) => ({ ...s })) };
}

function migratePreviousLayout(widgets: WidgetSlot[]): WidgetSlot[] {
  const normalized = normalizeCurrentLayout(widgets);
  if (normalized.some((s) => s.id === 'files-in-play')) return normalized;
  const liveIndex = normalized.findIndex((s) => s.id === 'live-sessions');
  const slot = defaultSlot('files-in-play');
  if (liveIndex < 0 || !slot) return normalized;
  const next = [...normalized];
  next.splice(liveIndex + 1, 0, slot);
  return normalizeCurrentLayout(next);
}

export function normalizeCurrentLayout(slots: WidgetSlot[]): WidgetSlot[] {
  const seen = new Set<string>();
  const out: WidgetSlot[] = [];
  for (const s of slots) {
    const def = getWidget(s.id);
    if (!def || seen.has(s.id)) continue;
    const maxCol = (def.maxW ?? 12) as WidgetColSpan;
    const maxRow = (def.maxH ?? 6) as WidgetRowSpan;
    const minCol = (def.minW ?? 3) as WidgetColSpan;
    const minRow = (def.minH ?? 2) as WidgetRowSpan;
    const colSpan = Math.max(minCol, Math.min(maxCol, s.colSpan)) as WidgetColSpan;
    const rowSpan = Math.max(minRow, Math.min(maxRow, s.rowSpan)) as WidgetRowSpan;
    seen.add(s.id);
    out.push({ ...s, colSpan, rowSpan });
  }
  return out;
}

function loadDashboard(): DashboardLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
          saveDashboard({ version: STORAGE_VERSION, widgets: normalized });
        }
        return { version: STORAGE_VERSION, widgets: normalized };
      }
      if (PREVIOUS_STORAGE_VERSIONS.has(parsed?.version) && Array.isArray(parsed.widgets)) {
        const migrated = {
          version: STORAGE_VERSION,
          widgets: migratePreviousLayout(parsed.widgets as WidgetSlot[]),
        };
        saveDashboard(migrated);
        return migrated;
      }
    }
  } catch {
    // Ignore corrupt storage
  }

  const def = buildDefaultLayout();
  saveDashboard(def);
  return def;
}

function saveDashboard(layout: DashboardLayout) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Ignore storage quota
  }
}

// ── Hook ─────────────────────────────────────────

export function useOverviewLayout() {
  const [dashboard, setDashboardInner] = useState<DashboardLayout>(loadDashboard);

  const dashboardRef = useRef(dashboard);
  useEffect(() => {
    dashboardRef.current = dashboard;
  }, [dashboard]);

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
        saveDashboard(next);
        return next;
      });
    },
    [pushUndoSnapshot],
  );

  const widgetIds = dashboard.widgets.map((s) => s.id);

  // Toggle on: append with catalog defaults. Toggle off: remove.
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
      saveDashboard(next);
      setDashboardInner(next);
      return appended.addedIds;
    },
    [pushUndoSnapshot],
  );

  // Insert a catalog widget at a specific index in the ordered list. Used by
  // drag-from-catalog: the drop location becomes the insertion point in the
  // CSS Grid source order (rather than an x/y coordinate). No-op if the
  // widget is already in the layout.
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

  // Reorder via @dnd-kit sortable. Accepts the full new ordered id list.
  const reorderWidgets = useCallback(
    (ids: string[]) => {
      setAndSave((prev) => {
        const byId = new Map(prev.widgets.map((s) => [s.id, s]));
        const reordered = ids.map((id) => byId.get(id)).filter((s): s is WidgetSlot => !!s);
        // Append any widgets not in `ids` to preserve data (shouldn't happen
        // but defensive).
        for (const s of prev.widgets) {
          if (!ids.includes(s.id)) reordered.push(s);
        }
        return { ...prev, widgets: reordered };
      });
    },
    [setAndSave],
  );

  // Set a widget's colSpan and/or rowSpan. Both fields optional; omitted
  // fields keep their current value. Clamps the requested size against the
  // catalog's min/max for that widget so resize gestures (or stale UI)
  // can't push a widget past the constraints declared on the WidgetDef.
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
          const maxRow = (def?.maxH ?? 4) as WidgetRowSpan;
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

  const resetToDefault = useCallback(
    (overview?: OverviewSnapshot | null, capture?: CaptureSettings | null) => {
      pushUndoSnapshot();
      const def = {
        version: STORAGE_VERSION,
        widgets: resolveDefaultLayout(overview, capture),
      };
      saveDashboard(def);
      setDashboardInner(def);
    },
    [pushUndoSnapshot],
  );

  /** Promote starter → full layout when git/outcome stats have matured. No-op
   *  if the user customized away from the starter set. */
  const promoteToFullLayout = useCallback(() => {
    const current = dashboardRef.current;
    if (!current) return false;
    const ids = current.widgets.map((s) => s.id);
    const isStarter =
      ids.length === STARTER_WIDGET_IDS.length &&
      STARTER_WIDGET_IDS.every((id, i) => ids[i] === id);
    if (!isStarter) return false;
    pushUndoSnapshot();
    const next = {
      version: STORAGE_VERSION,
      widgets: FULL_DEFAULT_LAYOUT.map((s) => ({ ...s })),
    };
    saveDashboard(next);
    setDashboardInner(next);
    return true;
  }, [pushUndoSnapshot]);

  const clearAll = useCallback(() => {
    const current = dashboardRef.current;
    if (current.widgets.length === 0) return 0;

    pushUndoSnapshot();
    const empty: DashboardLayout = { version: STORAGE_VERSION, widgets: [] };
    dashboardRef.current = empty;
    saveDashboard(empty);
    setDashboardInner(empty);
    return current.widgets.length;
  }, [pushUndoSnapshot]);

  const undo = useCallback((): boolean => {
    const snap = undoStackRef.current.pop();
    if (!snap) return false;
    saveDashboard(snap);
    setDashboardInner(snap);
    return true;
  }, []);

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
    promoteToFullLayout,
    clearAll,
    undo,
  };
}

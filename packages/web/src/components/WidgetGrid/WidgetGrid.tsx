import { createContext, memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  useDndMonitor,
  useDroppable,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type Modifier,
} from '@dnd-kit/core';
import { SortableContext, useSortable, type SortingStrategy } from '@dnd-kit/sortable';
import { CSS, getEventCoordinates } from '@dnd-kit/utilities';

import { clampRowSpan, getWidget, type WidgetSlot } from '../../widgets/catalog/index.js';

import styles from './WidgetGrid.module.css';

const GRID_COLS = 12;
const CELL_GUTTER_PX = 24;
const SEMANTIC_ROW_PX = 80;
const SEMANTIC_ROW_GAP_PX = 24;

/** Authored rowSpan (80px semantic units) → the cell's minimum pixel height,
 *  including the cell's own 24px gutter padding. Bands size each row to the
 *  tallest member, so this is a floor, not a fixed height. */
function rowSpanToMinHeight(rowSpan: number): number {
  return rowSpan * SEMANTIC_ROW_PX + (rowSpan - 1) * SEMANTIC_ROW_GAP_PX + CELL_GUTTER_PX;
}

export interface WidgetGridProps {
  slots: WidgetSlot[];
  renderWidget: (id: string) => ReactNode;
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
  recentlyAddedId?: string | null;
}

/** Droppable id the grid container registers for catalog drops. The ancestor
 *  DndContext's onDragEnd reads this to distinguish "dropped on empty grid
 *  space" (append) from "dropped on a specific widget" (insert before). */
export const GRID_DROPPABLE_ID = 'widget-grid-append';

/**
 * Cell-scoped signal from a widget body that it is rendering an empty
 * state. SectionEmpty pushes `true` on mount, `false` on unmount; the
 * enclosing cell drops its authored min-height while empty so an empty
 * widget collapses to title + helper text (band height permitting) instead
 * of reserving its authored row span. The context is null outside a grid
 * cell, so SectionEmpty just renders its text in that case.
 */
export const EmptyWidgetContext = createContext<((empty: boolean) => void) | null>(null);

/** Drag/remove chrome props scoped to one grid cell. WidgetRenderer reads this
 *  to park controls on the title row instead of the widget shell corner. */
export interface WidgetChromeValue {
  widgetName: string;
  onRemove: () => void;
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  dragListeners: DraggableSyntheticListeners;
  dragAttributes: DraggableAttributes;
}

export const WidgetChromeContext = createContext<WidgetChromeValue | null>(null);

/**
 * No-shift sorting strategy: items stay in their declared positions while
 * a drag is in flight; only the dragged item moves (in the parent view's
 * DragOverlay). The default `rectSortingStrategy` tries to live-preview
 * the swap by transforming sibling items toward where they'd land - but
 * with mixed-size items across band sub-grids the predicted positions
 * don't match what the grid actually computes, so hovered widgets visibly
 * distort/scale during the preview. Returning null for every item disables
 * that preview entirely. The actual reorder happens on drop and the grid
 * recomputes the final layout cleanly. The `cellOver` indicator (see CSS)
 * tells the user where the drop will land without simulating it. */
const noShiftStrategy: SortingStrategy = () => null;

/** Shape of catalog drag payloads that the grid reacts to. WidgetCatalog.tsx
 *  sets exactly these fields on useDraggable.data.current. */
export interface CatalogDragPayload {
  widgetId: string;
  w: number;
  h: number;
  name: string;
}

/**
 * DragOverlay modifier that centers the cursor-carried chip on the pointer.
 *
 * Default dnd-kit DragOverlay positioning uses the original draggable's
 * top-left as the anchor, so grabbing a ~460px-wide catalog row anywhere
 * other than its left edge leaves the chip offset far left of the cursor -
 * it reads as detached and floaty. Centering on the cursor makes the chip
 * feel attached to the pointer.
 *
 * Canonical `snapCenterToCursor` implementation from @dnd-kit/modifiers
 * (package not installed; inlined here to avoid adding a dependency for a
 * single helper). Safe to apply only on DragOverlay - sortable widget
 * reorders don't render through the overlay so they're unaffected.
 */
export const snapChipToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const coords = getEventCoordinates(activatorEvent);
  if (!coords) return transform;
  const offsetX = coords.x - draggingNodeRect.left;
  const offsetY = coords.y - draggingNodeRect.top;
  return {
    ...transform,
    x: transform.x + offsetX - draggingNodeRect.width / 2,
    y: transform.y + offsetY - draggingNodeRect.height / 2,
  };
};

/**
 * One render unit in the band layout: a real widget, or the sized ghost
 * placeholder a catalog drag injects at its drop location. Ghosts flow
 * through band partitioning like widgets so neighbors shift realistically.
 */
export type BandEntry =
  | { kind: 'widget'; slot: WidgetSlot }
  | { kind: 'ghost'; w: number; h: number };

function entryColSpan(entry: BandEntry): number {
  const span = entry.kind === 'widget' ? entry.slot.colSpan : entry.w;
  return Math.min(GRID_COLS, Math.max(1, span));
}

/** Height tier for band grouping. Widgets only share a band when their
 *  rowSpan matches — a rowSpan-2 KPI stat never stretches beside a
 *  rowSpan-3 chart just because columns still fit. */
function entryRowSpan(entry: BandEntry): WidgetSlot['rowSpan'] {
  if (entry.kind === 'widget') return entry.slot.rowSpan;
  return clampRowSpan(entry.h);
}

/**
 * Assign each entry, in order, to a visual row ("band"): accumulate column
 * spans until the next entry would overflow 12 columns OR its rowSpan tier
 * differs from the current band's, then start a new band. Returns the
 * 1-based grid row index for each entry, aligned by position. Every member
 * of a band shares one auto-sized grid row, so the row is as tall as its
 * tallest member and everyone else stretches to match - widget tops AND
 * bottoms align by construction. This is what makes staggered layouts
 * impossible: there is no shared fine-grained row axis for mixed heights to
 * drift on, and no `dense` backfill to reorder widgets behind the user's
 * back. Order in `entries` is exactly the order on screen.
 *
 * The DOM stays flat (one grid, cells as direct siblings) and only this
 * row index changes when bands re-partition. Cells must never remount on
 * a band change: a catalog drag re-partitions on every hover change, and
 * remounting cells mid-drag re-registers their droppables, which sends
 * dnd-kit's measurement cycle into an infinite setState loop.
 */
export function assignBandRows(entries: BandEntry[]): number[] {
  const rows: number[] = [];
  let row = 1;
  let used = 0;
  let bandRowSpan: WidgetSlot['rowSpan'] | null = null;
  for (const entry of entries) {
    const span = entryColSpan(entry);
    const tier = entryRowSpan(entry);
    const colOverflow = used > 0 && used + span > GRID_COLS;
    const tierMismatch = bandRowSpan != null && tier !== bandRowSpan;
    if (colOverflow || tierMismatch) {
      row += 1;
      used = 0;
      bandRowSpan = null;
    }
    rows.push(row);
    used += span;
    bandRowSpan = tier;
  }
  return rows;
}

interface SortableWidgetProps {
  slot: WidgetSlot;
  /** 1-based band row this cell is pinned to (see assignBandRows). */
  row: number;
  highlighted: boolean;
  isOver: boolean;
  children: ReactNode;
  onRemove: () => void;
}

function SortableWidget({ slot, row, highlighted, isOver, children, onRemove }: SortableWidgetProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useSortable({
      id: slot.id,
    });

  const def = getWidget(slot.id);
  const widgetName = def?.name ?? 'widget';
  const fit = def?.fitContent === true;
  // Bodies that render SectionEmpty push `true` here through
  // EmptyWidgetContext. While set, the cell behaves like a fitContent cell
  // (no authored min-height) so an empty widget collapses to its real
  // content height instead of reserving its authored row span for nothing.
  const [bodyEmpty, setBodyEmpty] = useState(false);

  // Content-sized cells (fitContent or empty bodies) carry no min-height:
  // their natural content height is their band-height contribution, which
  // is how a quiet live board collapses. Fixed cells floor at the authored
  // rowSpan height and `contain: size` zeroes their content contribution
  // (see .cellFixed in the CSS module), so overflowing content clips at the
  // authored height exactly as before instead of inflating the whole band.
  //
  // While the widget itself is being dragged, the cell holds a ghost with
  // no content - fall back to the catalog h so a content-sized cell doesn't
  // collapse its band to nothing mid-drag.
  const contentSized = (fit || bodyEmpty) && !isDragging;
  const minHeight = contentSized
    ? undefined
    : rowSpanToMinHeight(fit || bodyEmpty ? clampRowSpan(def?.h ?? slot.rowSpan) : slot.rowSpan);

  // No `transition` from useSortable - we don't want the sibling
  // shift-preview animation. With the no-shift strategy, transform stays
  // identity for non-dragged items so this is mostly belt-and-suspenders;
  // explicitly omitting the transition makes the intent obvious.
  // Span and row are passed via custom properties rather than raw
  // `gridColumn`/`gridRow` so the responsive media queries in the CSS
  // module can re-flow cells without needing `!important` to beat inline.
  const style: CSSProperties = {
    ['--cell-col-span' as string]: slot.colSpan,
    ['--cell-row' as string]: row,
    ['--cell-min-h' as string]: minHeight != null ? `${minHeight}px` : undefined,
    transform: CSS.Transform.toString(transform),
    zIndex: isDragging ? 2 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-widget-id={slot.id}
      data-widget-viz={def?.viz ?? undefined}
      className={clsx(
        styles.cell,
        !contentSized && styles.cellFixed,
        isOver && !isDragging && styles.cellOver,
      )}
    >
      {isDragging ? (
        // Original-slot placeholder while dragging. The actual widget
        // renders inside the parent view's DragOverlay so it stays sized
        // to its real cell dimensions and follows the cursor cleanly.
        // Sortable shifts this empty cell as siblings make room, so the
        // placeholder visibly tracks the drop target.
        <div className={styles.widgetGhost} aria-hidden="true" />
      ) : (
        <div className={styles.widget}>
          <WidgetChromeContext.Provider
            value={{
              widgetName,
              onRemove,
              setActivatorNodeRef,
              dragListeners: listeners,
              dragAttributes: attributes,
            }}
          >
            <EmptyWidgetContext.Provider value={setBodyEmpty}>{children}</EmptyWidgetContext.Provider>
          </WidgetChromeContext.Provider>
        </div>
      )}
      {highlighted && (
        <div className={styles.borderSweep} aria-hidden="true">
          <span className={styles.borderSide1} />
          <span className={styles.borderSide2} />
          <span className={styles.borderSide3} />
          <span className={styles.borderSide4} />
        </div>
      )}
    </div>
  );
}

interface WidgetControlsProps {
  widgetName: string;
  onRemove: () => void;
  setActivatorNodeRef: (node: HTMLElement | null) => void;
  dragListeners: DraggableSyntheticListeners;
  dragAttributes: DraggableAttributes;
}

/**
 * Hover-revealed control cluster on the widget title row (see WidgetRenderer).
 *
 *   • Grip (left)  - drag to reorder. Sortable's activator node is the grip
 *     button itself, so drag can only start from this element. The widget
 *     body stays fully interactive (charts, drill-ins, text selection)
 *     without competing for pointer events.
 *   • Trash (right) - click to remove. Undoable via Cmd/Ctrl-Z (layout undo
 *     is wired globally in the host view), so one-click delete is safe.
 *
 * The cluster is invisible by default and fades in on cell hover or
 * focus-within. Hidden on mobile via the breakpoint in the CSS module.
 */
export function WidgetControls({
  widgetName,
  onRemove,
  setActivatorNodeRef,
  dragListeners,
  dragAttributes,
}: WidgetControlsProps) {
  return (
    <div className={styles.controls}>
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={styles.gripButton}
        aria-label={`Move ${widgetName}`}
        title="Drag to move"
        {...dragListeners}
        {...dragAttributes}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
          <circle cx="2.5" cy="3" r="1" />
          <circle cx="2.5" cy="8" r="1" />
          <circle cx="2.5" cy="13" r="1" />
          <circle cx="7.5" cy="3" r="1" />
          <circle cx="7.5" cy="8" r="1" />
          <circle cx="7.5" cy="13" r="1" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.removeButton}
        aria-label={`Remove ${widgetName}`}
        title="Remove"
        onClick={onRemove}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          {/* lid */}
          <path
            d="M2.5 3.5 H11.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path
            d="M5.5 3.5 V2.5 a0.6 0.6 0 0 1 0.6 -0.6 H7.9 a0.6 0.6 0 0 1 0.6 0.6 V3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          {/* bin */}
          <path
            d="M3.6 3.5 L4.1 11.6 a0.9 0.9 0 0 0 0.9 0.9 H9 a0.9 0.9 0 0 0 0.9 -0.9 L10.4 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M6 6 V10 M8 6 V10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

/** Sized ghost placeholder rendered in the band flow at the drop target.
 *  Width/min-height match the dragged widget's colSpan × rowSpan so the user
 *  sees the actual footprint, not a generic marker. */
function GridPlaceholder({ w, h, row }: { w: number; h: number; row: number }) {
  return (
    <div
      className={styles.placeholder}
      style={
        {
          ['--cell-col-span' as string]: w,
          ['--cell-row' as string]: row,
          ['--cell-min-h' as string]: `${rowSpanToMinHeight(h)}px`,
        } as CSSProperties
      }
      aria-hidden="true"
    />
  );
}

function WidgetGridInner({ slots, renderWidget, onRemove, recentlyAddedId }: WidgetGridProps) {
  const { setNodeRef: setGridDroppableRef, isOver: gridIsOver } = useDroppable({
    id: GRID_DROPPABLE_ID,
  });

  // Track which widget the cursor is currently hovering when a CATALOG drag
  // is active. The insertion would land BEFORE this widget. Null means
  // either no catalog drag, or the cursor is over empty grid space (which
  // hits the GRID_DROPPABLE_ID sentinel and resolves to "append at end").
  const [catalogOverId, setCatalogOverId] = useState<string | null>(null);
  // Non-null while a catalog drag is in flight. Carries w/h so the in-grid
  // ghost placeholder can size itself to the widget's real footprint.
  const [catalogDrag, setCatalogDrag] = useState<{ w: number; h: number } | null>(null);
  // Sortable drag's hovered widget id. Pairs with `cellOver` styling on the
  // SortableWidget cell so the user sees a clear drop target without
  // sortable previewing a swap (which warps mixed-size grid items).
  const [sortableOverId, setSortableOverId] = useState<string | null>(null);
  const [sortableActiveId, setSortableActiveId] = useState<string | null>(null);

  useDndMonitor({
    onDragStart(event) {
      const activeId = String(event.active.id);
      if (activeId.startsWith('catalog:')) {
        const data = event.active.data.current as CatalogDragPayload | undefined;
        if (data) setCatalogDrag({ w: data.w, h: data.h });
        return;
      }
      setSortableActiveId(activeId);
    },
    onDragOver(event) {
      const overId = event.over ? String(event.over.id) : null;
      if (catalogDrag) {
        if (overId && overId !== GRID_DROPPABLE_ID) {
          // Cursor is hovering a specific widget - that widget is the insertion
          // anchor (we'll insert BEFORE it on drop).
          setCatalogOverId(overId);
        } else {
          setCatalogOverId(null);
        }
        return;
      }
      // Sortable drag - light up the hovered cell as drop target. Skip
      // when the cursor is over the dragged widget's own slot (no-op
      // drop) or over the empty-grid sentinel.
      if (overId && overId !== GRID_DROPPABLE_ID && overId !== sortableActiveId) {
        setSortableOverId(overId);
      } else {
        setSortableOverId(null);
      }
    },
    onDragEnd() {
      setCatalogDrag(null);
      setCatalogOverId(null);
      setSortableActiveId(null);
      setSortableOverId(null);
    },
    onDragCancel() {
      setCatalogDrag(null);
      setCatalogOverId(null);
      setSortableActiveId(null);
      setSortableOverId(null);
    },
  });

  // Border-sweep highlight when a widget is newly added. Both paths defer
  // setHighlightedId through a timer so the effect doesn't update state
  // synchronously in its body - otherwise react-hooks/set-state-in-effect
  // flags the cascading render.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  useEffect(() => {
    if (!recentlyAddedId) return;
    const el = document.querySelector<HTMLElement>(`[data-widget-id="${recentlyAddedId}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Floating surfaces (the catalog panel, command strip) mark themselves
    // with data-viewport-exclusion so a widget added into the region they
    // cover still counts as out-of-view and gets scrolled into the clear.
    const occluders = Array.from(
      document.querySelectorAll<HTMLElement>('[data-viewport-exclusion="true"]'),
    ).map((node) => node.getBoundingClientRect());
    const inViewport = rect.top >= 0 && rect.bottom <= window.innerHeight;
    const occluded = occluders.some(
      (occ) =>
        rect.right > occ.left &&
        rect.left < occ.right &&
        rect.bottom > occ.top &&
        rect.top < occ.bottom,
    );
    const inView = inViewport && !occluded;
    if (!inView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const delay = inView ? 0 : 450;
    const t = setTimeout(() => setHighlightedId(recentlyAddedId), delay);
    return () => clearTimeout(t);
  }, [recentlyAddedId]);

  useEffect(() => {
    if (!highlightedId) return;
    const t = setTimeout(() => setHighlightedId(null), 1800);
    return () => clearTimeout(t);
  }, [highlightedId]);

  const ids = slots.map((s) => s.id);

  // Where the ghost placeholder renders:
  //   - "insert": before a specific hovered widget (catalogOverId is its id)
  //   - "append": at the end of the grid when the cursor is over empty
  //     grid area (gridIsOver AND no specific widget under the cursor)
  //   - null: catalog drag is idle, or cursor hasn't entered the grid yet
  const showInsertGhost = catalogDrag && catalogOverId !== null;
  const showAppendGhost = catalogDrag && gridIsOver && catalogOverId === null;

  // Build the render list (widgets + at most one catalog ghost) and assign
  // each entry its band row. The ghost is a real band entry so it occupies
  // its true footprint and pushes neighbors exactly the way the dropped
  // widget will. Cells stay direct siblings of the one grid container and
  // keep their id keys, so a band re-partition only changes inline style
  // values - never DOM identity (see assignBandRows for why that matters).
  const entries: BandEntry[] = [];
  for (const slot of slots) {
    if (showInsertGhost && catalogOverId === slot.id) {
      entries.push({ kind: 'ghost', w: catalogDrag.w, h: catalogDrag.h });
    }
    entries.push({ kind: 'widget', slot });
  }
  if (showAppendGhost) entries.push({ kind: 'ghost', w: catalogDrag.w, h: catalogDrag.h });
  const rows = assignBandRows(entries);

  return (
    <SortableContext items={ids} strategy={noShiftStrategy}>
      <div ref={setGridDroppableRef} className={styles.grid}>
        {entries.map((entry, i) =>
          entry.kind === 'ghost' ? (
            <GridPlaceholder key="ghost" w={entry.w} h={entry.h} row={rows[i]} />
          ) : (
            <SortableWidget
              key={entry.slot.id}
              slot={entry.slot}
              row={rows[i]}
              highlighted={highlightedId === entry.slot.id}
              isOver={sortableOverId === entry.slot.id}
              onRemove={() => onRemove(entry.slot.id)}
            >
              {renderWidget(entry.slot.id)}
            </SortableWidget>
          ),
        )}
      </div>
    </SortableContext>
  );
}

export const WidgetGrid = memo(WidgetGridInner);

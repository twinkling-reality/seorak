// @vitest-environment jsdom
//
// The reorder / drop path, driven at the handler rather than through @dnd-kit's
// pointer sensor. Synthesising a real drag in jsdom means faking pointer capture,
// element rects, and the collision detection loop — a lot of scaffolding whose
// failures would be about the library, not about us. What is ours is the branch
// on the `catalog:` prefix and the index arithmetic, so that is what is pinned
// here, with the payload the picker actually produces.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GRID_DROPPABLE_ID } from '../../components/WidgetGrid/WidgetGrid.js';
import { WIDGET_CATALOG } from '../../widgets/catalog/index.js';
import { catalogDraggableId, catalogRowDragData } from '../../widgets/picker/catalogDrag.js';
import { useWidgetGridDrag } from '../useWidgetGridDrag.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Drag = ReturnType<typeof useWidgetGridDrag>;

const SLOTS = ['sessions', 'cost', 'ship-rate', 'trend'];

let teardown: (() => void) | null = null;

function mountDrag(slotIds: string[] = SLOTS) {
  const onCatalogInsert = vi.fn();
  const onReorder = vi.fn();
  const box: { api: Drag | null } = { api: null };

  function Probe() {
    box.api = useWidgetGridDrag({ slotIds, onCatalogInsert, onReorder });
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
    onCatalogInsert,
    onReorder,
    get api() {
      return box.api!;
    },
  };
}

afterEach(() => {
  teardown?.();
  teardown = null;
});

/** A drag-end event shaped the way dnd-kit hands one over. */
function dragEnd(activeId: string, overId: string | null, data?: unknown): DragEndEvent {
  return {
    active: { id: activeId, data: { current: data } },
    over: overId === null ? null : { id: overId },
  } as unknown as DragEndEvent;
}

function dragStart(activeId: string, data?: unknown, rect?: { width: number; height: number }) {
  return {
    active: {
      id: activeId,
      data: { current: data },
      rect: { current: { initial: rect ?? null } },
    },
  } as unknown as DragStartEvent;
}

describe('reordering widgets already on the board', () => {
  it('moves the dragged widget to the slot it was dropped on', () => {
    const h = mountDrag();
    act(() => h.api.handleDragEnd(dragEnd('ship-rate', 'sessions')));
    expect(h.onReorder).toHaveBeenCalledWith([
      'ship-rate',
      'sessions',
      'cost',
      'trend',
    ]);
  });

  it('moves forward as well as backward', () => {
    const h = mountDrag();
    act(() => h.api.handleDragEnd(dragEnd('sessions', 'trend')));
    expect(h.onReorder).toHaveBeenCalledWith([
      'cost',
      'ship-rate',
      'trend',
      'sessions',
    ]);
  });

  it('does nothing when a widget is dropped on itself', () => {
    const h = mountDrag();
    act(() => h.api.handleDragEnd(dragEnd('sessions', 'sessions')));
    expect(h.onReorder).not.toHaveBeenCalled();
  });

  it('does nothing when the drag is released over empty space', () => {
    const h = mountDrag();
    act(() => h.api.handleDragEnd(dragEnd('sessions', null)));
    expect(h.onReorder).not.toHaveBeenCalled();
  });

  it('does nothing when either end is not on the board', () => {
    const h = mountDrag();
    act(() => h.api.handleDragEnd(dragEnd('not-on-board', 'sessions')));
    act(() => h.api.handleDragEnd(dragEnd('sessions', 'not-on-board')));
    expect(h.onReorder).not.toHaveBeenCalled();
  });
});

describe('dropping a catalog row onto the board', () => {
  const widget = WIDGET_CATALOG[0];
  const payload = catalogRowDragData(widget);
  const dragId = catalogDraggableId(widget.id);

  it('inserts before the widget it was dropped on', () => {
    const h = mountDrag();
    act(() => h.api.handleDragEnd(dragEnd(dragId, 'ship-rate', payload)));
    expect(h.onCatalogInsert).toHaveBeenCalledWith(widget.id, 2);
    expect(h.onReorder).not.toHaveBeenCalled();
  });

  it('appends when dropped on empty grid space', () => {
    const h = mountDrag();
    act(() => h.api.handleDragEnd(dragEnd(dragId, GRID_DROPPABLE_ID, payload)));
    expect(h.onCatalogInsert).toHaveBeenCalledWith(widget.id, SLOTS.length);
  });

  it('appends at index 0 on an empty board', () => {
    const h = mountDrag([]);
    act(() => h.api.handleDragEnd(dragEnd(dragId, GRID_DROPPABLE_ID, payload)));
    expect(h.onCatalogInsert).toHaveBeenCalledWith(widget.id, 0);
  });

  it('drops nothing when the payload is missing', () => {
    const h = mountDrag();
    act(() => h.api.handleDragEnd(dragEnd(dragId, 'ship-rate', undefined)));
    expect(h.onCatalogInsert).not.toHaveBeenCalled();
    expect(h.onReorder).not.toHaveBeenCalled();
  });

  it('never routes a catalog drop through the reorder path', () => {
    const h = mountDrag();
    act(() => h.api.handleDragEnd(dragEnd(dragId, 'sessions', payload)));
    expect(h.onReorder).not.toHaveBeenCalled();
  });
});

describe('drag preview state', () => {
  const widget = WIDGET_CATALOG[0];

  it('exposes the catalog payload so the grid can size its ghost', () => {
    const h = mountDrag();
    act(() =>
      h.api.handleDragStart(
        dragStart(catalogDraggableId(widget.id), catalogRowDragData(widget)),
      ),
    );
    expect(h.api.catalogDragging).toEqual(catalogRowDragData(widget));
    expect(h.api.sortableDragging).toBeNull();
  });

  it('measures a board widget instead, and clears on drop', () => {
    const h = mountDrag();
    act(() =>
      h.api.handleDragStart(dragStart('sessions', undefined, { width: 320, height: 184 })),
    );
    expect(h.api.sortableDragging).toEqual({ id: 'sessions', w: 320, h: 184 });
    act(() => h.api.handleDragEnd(dragEnd('sessions', 'ship-rate')));
    expect(h.api.sortableDragging).toBeNull();
  });

  it('clears both on cancel', () => {
    const h = mountDrag();
    act(() =>
      h.api.handleDragStart(
        dragStart(catalogDraggableId(widget.id), catalogRowDragData(widget)),
      ),
    );
    act(() => h.api.handleDragCancel());
    expect(h.api.catalogDragging).toBeNull();
    expect(h.api.sortableDragging).toBeNull();
  });
});

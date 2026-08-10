/**
 * The picker's half of the drag contract with WidgetGrid. The grid reads these exact
 * fields off `active.data.current` and the `catalog:` prefix is how it tells a
 * catalog drag apart from a widget reorder, so the two sides are pinned here rather
 * than spelled out in a component.
 */
import type { WidgetDef } from '../catalog/index.js';

/** dnd-kit draggable id for a catalog row. Prefixed so other app draggables
 *  don't collide with catalog ids. */
export const catalogDraggableId = (widgetId: string) => `catalog:${widgetId}`;

export interface CatalogRowDragData {
  widgetId: string;
  w: number;
  h: number;
  name: string;
}

export function catalogRowDragData(widget: WidgetDef): CatalogRowDragData {
  return { widgetId: widget.id, w: widget.w, h: widget.h, name: widget.name };
}

/** A row already on the board has nothing to add, and a blocked row cannot be fed,
 *  so neither is draggable. */
export function catalogRowDraggable(active: boolean, blocked: boolean): boolean {
  return !active && !blocked;
}

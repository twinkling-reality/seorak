import { describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from '../../catalog/index.js';
import { catalogDraggableId, catalogRowDragData, catalogRowDraggable } from '../catalogDrag.js';

describe('catalogDraggableId', () => {
  it('prefixes so a catalog drag is distinguishable from a board reorder', () => {
    expect(catalogDraggableId('token-burn')).toBe('catalog:token-burn');
    // The grid's branch is a literal startsWith('catalog:'); this is that contract.
    expect(catalogDraggableId('token-burn').startsWith('catalog:')).toBe(true);
  });

  it('cannot collide with a board slot id, because no widget id carries the prefix', () => {
    for (const w of WIDGET_CATALOG) {
      expect(w.id.startsWith('catalog:')).toBe(false);
    }
  });
});

describe('catalogRowDragData', () => {
  it('hands the grid the four fields it reads off active.data.current', () => {
    const w = WIDGET_CATALOG[0];
    expect(catalogRowDragData(w)).toEqual({
      widgetId: w.id,
      w: w.w,
      h: w.h,
      name: w.name,
    });
  });
});

describe('catalogRowDraggable', () => {
  it('is draggable only when the row is neither on the board nor blocked', () => {
    expect(catalogRowDraggable(false, false)).toBe(true);
    expect(catalogRowDraggable(true, false)).toBe(false);
    expect(catalogRowDraggable(false, true)).toBe(false);
    expect(catalogRowDraggable(true, true)).toBe(false);
  });
});

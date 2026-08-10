import { defaultSlot, type WidgetSlot } from './catalog/index.js';

/**
 * Append catalog-backed slots that are not already present in a layout.
 *
 * Caller order is intentional: the catalog owns scope, filtering, capture
 * availability, and the order the user can currently see. This layout-layer
 * helper only enforces the persistence invariants shared by Overview and
 * Project: existing slots stay byte-for-byte in place, unknown ids are ignored,
 * and duplicate ids can never enter the saved board.
 *
 * Returns null when the request would not change the layout so callers can
 * avoid creating an undo snapshot or storage write for a no-op.
 */
export interface AppendWidgetSlotsResult {
  widgets: WidgetSlot[];
  addedIds: string[];
}

export function appendMissingWidgetSlots(
  current: readonly WidgetSlot[],
  requestedIds: readonly string[],
): AppendWidgetSlotsResult | null {
  const seen = new Set(current.map((slot) => slot.id));
  const additions: WidgetSlot[] = [];

  for (const id of requestedIds) {
    if (seen.has(id)) continue;
    const slot = defaultSlot(id);
    if (!slot) continue;
    seen.add(id);
    additions.push(slot);
  }

  return additions.length > 0
    ? {
        widgets: [...current, ...additions],
        addedIds: additions.map((slot) => slot.id),
      }
    : null;
}

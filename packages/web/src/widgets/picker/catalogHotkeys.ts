/**
 * The picker's keyboard map, as data.
 *
 * It is pure on purpose. Bulk layout keys require Shift, and that guard belongs
 * here instead of being split across callers. A plain `c` that quietly wiped the
 * layout would be the wrong shape of friction even with undo behind it, so the
 * modifier gate is the affordance, and a gate that cannot be tested without a
 * browser is a gate that can regress with green CI.
 */

export type CatalogHotkeyAction =
  | { type: 'close-search' }
  | { type: 'close' }
  | { type: 'reset-to-default' }
  | { type: 'clear-all' }
  | { type: 'add-widgets' }
  | { type: 'toggle-search' }
  | { type: 'cycle-show' }
  | { type: 'cycle-viz' }
  | { type: 'cycle-category'; dir: 1 | -1 };

export interface CatalogKeyEvent {
  key: string;
  shiftKey: boolean;
  /** True when the keystroke landed in the search field, which owns its own typing. */
  inTextInput: boolean;
}

export interface CatalogHotkeyAvailability {
  canClearAll: boolean;
  canAddWidgets: boolean;
}

const DEFAULT_AVAILABILITY: CatalogHotkeyAvailability = {
  canClearAll: true,
  canAddWidgets: true,
};

/**
 * The action a keystroke maps to, or null for "not ours" (which is also the signal
 * not to preventDefault, so an unmapped key still reaches the browser).
 */
export function catalogHotkeyAction(
  e: CatalogKeyEvent,
  availability: CatalogHotkeyAvailability = DEFAULT_AVAILABILITY,
): CatalogHotkeyAction | null {
  // Don't capture when typing in search.
  if (e.inTextInput) return e.key === 'Escape' ? { type: 'close-search' } : null;

  switch (e.key) {
    case 'Escape':
      return { type: 'close' };
    case 'V':
      // Shift+V — restore default. Unmodified `v` is intentionally
      // ignored; restoring the default wipes any custom layout, which
      // is too destructive to leave on a single keystroke. The explicit
      // shiftKey check is what stops caps lock standing in for shift.
      return e.shiftKey ? { type: 'reset-to-default' } : null;
    case 'C':
      // Shift+C — empty dashboard. Same reasoning as Shift+V.
      return e.shiftKey && availability.canClearAll ? { type: 'clear-all' } : null;
    case 'A':
      // Shift+A — add the inactive matches represented by the contextual
      // command-strip action. Ignore it when the current filters leave no
      // eligible widgets so a hidden command never retains an active hotkey.
      return e.shiftKey && availability.canAddWidgets ? { type: 'add-widgets' } : null;
    case '/':
      return { type: 'toggle-search' };
    case 'Tab':
      return { type: 'cycle-show' };
    case 't':
    case 'T':
      return { type: 'cycle-viz' };
    case 'ArrowLeft':
      return { type: 'cycle-category', dir: -1 };
    case 'ArrowRight':
      return { type: 'cycle-category', dir: 1 };
    default:
      return null;
  }
}

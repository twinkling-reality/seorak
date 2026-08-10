// @vitest-environment jsdom
//
// Behaviour coverage for the customize surface. Before this file no test
// mounted the picker at all, so every path a user actually takes — filtering,
// adding, removing, the two dashboard-wiping shortcuts — could break with CI
// green. The pure decisions (which rows match, what a keystroke means, where
// the hover card lands) are unit-tested in `picker/__tests__/`; this file
// covers the wiring: that the controller's state reaches the DOM and that a
// click or a keystroke reaches the host view's callbacks.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTURE_SETTINGS } from '@seorak/types';

import { WIDGET_CATALOG } from '../catalog/index.js';
import { isPickerAddBlocked } from '../../lib/widgetReadiness.js';
import { catalogDraggableId, catalogRowDragData } from '../picker/catalogDrag.js';
import { filterWidgets, scopeCatalog } from '../picker/catalogFilter.js';
import { sizeLabel, timeScopeNote, VIZ_LABELS } from '../picker/catalogMeta.js';
import { WidgetCatalog } from '../WidgetCatalog.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom implements neither the Web Animations API nor ResizeObserver, both of
// which the picker uses for presentation only (the add-reveal fade and the
// scroll-fade edges). Stub rather than making the component defensive: guards
// in product code for a test environment's gaps are a lie about the browser.
beforeAll(() => {
  if (!Element.prototype.animate) {
    Element.prototype.animate = (() => ({ cancel() {}, finish() {} })) as never;
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as never;
  }
});

// `@dnd-kit/utilities` hoists to the workspace root while react-dom resolves
// inside packages/web, so a real DndContext renders against a second React copy
// and its hook dispatcher is null. Rather than reshape the install, stand in for
// the one hook the row uses and record what it was handed: the arguments ARE the
// drag contract, and asserting them is stronger than mounting a provider whose
// pointer sensor jsdom cannot drive anyway. The drop side is covered in
// `hooks/__tests__/useWidgetGridDrag.test.tsx`.
const draggable = vi.hoisted(() => ({
  calls: [] as Array<{ id: string; data: unknown; disabled: boolean }>,
}));

vi.mock('@dnd-kit/core', () => ({
  useDraggable: (args: { id: string; data: unknown; disabled: boolean }) => {
    draggable.calls.push({ id: args.id, data: args.data, disabled: args.disabled });
    return { attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false };
  },
}));

const navigate = vi.hoisted(() => ({
  toAgents: vi.fn(),
  toDetail: vi.fn(),
}));

vi.mock('../../lib/router.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/router.js')>();
  return { ...actual, navigateToAgents: navigate.toAgents, navigateToDetail: navigate.toDetail };
});

interface Harness {
  root: Root;
  host: HTMLDivElement;
  props: Parameters<typeof WidgetCatalog>[0];
  rerender: (next: Partial<Parameters<typeof WidgetCatalog>[0]>) => void;
  unmount: () => void;
}

let current: Harness | null = null;

function render(over: Partial<Parameters<typeof WidgetCatalog>[0]> = {}): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const props: Parameters<typeof WidgetCatalog>[0] = {
    open: true,
    onClose: vi.fn(),
    widgetIds: [],
    toggleWidget: vi.fn(),
    onAddWidgets: vi.fn(() => []),
    resetToDefault: vi.fn(),
    clearAll: vi.fn(),
    viewScope: 'overview',
    overview: null,
    capture: null,
    ...over,
  };
  const draw = (p: Parameters<typeof WidgetCatalog>[0]) => {
    act(() => {
      root.render(<WidgetCatalog {...p} />);
    });
  };
  draw(props);
  const harness: Harness = {
    root,
    host,
    props,
    rerender(next) {
      Object.assign(props, next);
      draw({ ...props });
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
  current = harness;
  return harness;
}

/** Rows are `[data-widget-row]`; the attribute exists only so tests can name a
 *  row without depending on hashed CSS module class names. */
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-widget-row]'));
const rowIds = () => rows().map((el) => el.dataset.widgetRow);
const stripButton = (label: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent?.startsWith(label),
  );
const searchInput = () =>
  document.querySelector<HTMLInputElement>('input[placeholder="Search widgets..."]');

/** Type into a controlled input. React 19 tracks the previous value on the node,
 *  so assigning `.value` directly is swallowed; go through the native setter the
 *  way SettingsView's tests do. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  act(() => {
    (el as HTMLElement).click();
  });
}

beforeEach(() => {
  draggable.calls.length = 0;
});

afterEach(() => {
  current?.unmount();
  current = null;
  navigate.toAgents.mockClear();
  navigate.toDetail.mockClear();
});

describe('rendering', () => {
  it('renders nothing at all when closed', () => {
    render({ open: false });
    expect(rows()).toHaveLength(0);
    expect(stripButton('Done')).toBeUndefined();
  });

  it('renders one row per scoped widget, in catalog order', () => {
    render({ viewScope: 'overview' });
    const expected = scopeCatalog('overview').map((w) => w.id);
    expect(rowIds()).toEqual(expected);
  });

  it('honours the host view scope — the project picker is not the overview picker', () => {
    render({ viewScope: 'project' });
    const projectIds = rowIds();
    current!.unmount();
    current = null;
    render({ viewScope: 'overview' });
    const overviewIds = rowIds();
    expect(projectIds).not.toEqual(overviewIds);
    expect(projectIds).toEqual(scopeCatalog('project').map((w) => w.id));
  });

  it('labels each row toggle with what the click will do', () => {
    const onBoard = WIDGET_CATALOG[0];
    render({ widgetIds: [onBoard.id] });
    expect(document.querySelector(`[aria-label="Remove ${onBoard.name}"]`)).not.toBeNull();
    expect(document.querySelector(`[aria-label="Add ${onBoard.name}"]`)).toBeNull();
  });
});

describe('filtering', () => {
  it('narrows to Added, then Available, then back to All on the Show control', () => {
    const onBoard = scopeCatalog('overview').slice(0, 2).map((w) => w.id);
    render({ widgetIds: onBoard });
    const all = rowIds().length;

    click(stripButton('Show:'));
    expect(rowIds()).toEqual(onBoard);

    click(stripButton('Show:'));
    expect(rowIds()).not.toContain(onBoard[0]);
    expect(rowIds()).toHaveLength(all - onBoard.length);

    click(stripButton('Show:'));
    expect(rowIds()).toHaveLength(all);
  });

  it('narrows to a viz family on the Type control', () => {
    render();
    click(stripButton('Type:'));
    const expected = filterWidgets(scopeCatalog('overview'), {
      activeCategory: 'all',
      showFilter: 'all',
      vizFilter: 'stats',
      searchQuery: '',
      widgetIds: [],
    });
    expect(rowIds()).toEqual(expected.map((w) => w.id));
  });

  it('filters as the user types, and says so honestly when nothing matches', () => {
    render();
    press('/');
    const input = searchInput();
    expect(input).not.toBeNull();

    const target = scopeCatalog('overview')[0];
    type(input!, target.name);
    expect(rowIds()).toContain(target.id);
    expect(rowIds().length).toBeLessThan(scopeCatalog('overview').length);

    type(input!, 'zzzz-no-such-widget');
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain('No widgets match.');
  });

  it('walks categories with the arrow keys and never lands on an empty list', () => {
    render();
    const seen = new Set<number>();
    for (let i = 0; i < 8; i += 1) {
      press('ArrowRight');
      expect(rows().length).toBeGreaterThan(0);
      seen.add(rows().length);
    }
    // The walk visited more than one category, not just re-rendered `all`.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('resets every filter when the picker is reopened', () => {
    const h = render();
    click(stripButton('Show:'));
    click(stripButton('Type:'));
    const filtered = rowIds().length;
    expect(filtered).toBeLessThan(scopeCatalog('overview').length);

    h.rerender({ open: false });
    h.rerender({ open: true });
    expect(rowIds()).toHaveLength(scopeCatalog('overview').length);
    expect(stripButton('Show:')?.textContent).toContain('All');
  });
});

describe('adding and removing', () => {
  it('adds a widget the board does not have', () => {
    const target = scopeCatalog('overview')[0];
    const toggleWidget = vi.fn();
    render({ widgetIds: [], toggleWidget });
    click(document.querySelector(`[aria-label="Add ${target.name}"]`));
    expect(toggleWidget).toHaveBeenCalledTimes(1);
    expect(toggleWidget).toHaveBeenCalledWith(target.id);
  });

  it('removes a widget the board already has', () => {
    const target = scopeCatalog('overview')[0];
    const toggleWidget = vi.fn();
    render({ widgetIds: [target.id], toggleWidget });
    click(document.querySelector(`[aria-label="Remove ${target.name}"]`));
    expect(toggleWidget).toHaveBeenCalledWith(target.id);
  });

  it('toggles from a click anywhere on the row, not only the switch', () => {
    const target = scopeCatalog('overview')[0];
    const toggleWidget = vi.fn();
    render({ toggleWidget });
    click(document.querySelector(`[data-widget-row="${target.id}"]`));
    expect(toggleWidget).toHaveBeenCalledWith(target.id);
  });

  it('reflects the board it is given rather than tracking its own copy', () => {
    const target = scopeCatalog('overview')[0];
    const h = render({ widgetIds: [] });
    expect(document.querySelector(`[aria-label="Add ${target.name}"]`)).not.toBeNull();
    h.rerender({ widgetIds: [target.id] });
    expect(document.querySelector(`[aria-label="Remove ${target.name}"]`)).not.toBeNull();
  });

  it('adds every eligible inactive widget when the catalog is unfiltered', () => {
    const onAddWidgets = vi.fn((ids: string[]) => ids);
    const capture = { ...DEFAULT_CAPTURE_SETTINGS, gitMomentum: false };
    const expected = scopeCatalog('overview')
      .filter((widget) => !isPickerAddBlocked(widget.id, capture))
      .map((widget) => widget.id);

    render({ onAddWidgets, capture });
    expect(stripButton('Add matching')).toBeUndefined();
    click(stripButton('Add all'));

    expect(onAddWidgets).toHaveBeenCalledTimes(1);
    expect(onAddWidgets).toHaveBeenCalledWith(expected);
    expect(expected).not.toContain('ship-rate');
  });

  it('limits Add all to widgets valid for the host view scope', () => {
    const onAddWidgets = vi.fn((ids: string[]) => ids);
    const expected = scopeCatalog('project')
      .filter((widget) => !isPickerAddBlocked(widget.id, null))
      .map((widget) => widget.id);

    render({ viewScope: 'project', onAddWidgets });
    click(stripButton('Add all'));

    expect(onAddWidgets).toHaveBeenCalledWith(expected);
  });

  it('adds only eligible inactive matches when a catalog filter is narrowed', () => {
    const alreadyAdded = scopeCatalog('overview').find((widget) => widget.viz === 'stat')!;
    const onAddWidgets = vi.fn((ids: string[]) => ids);
    render({ widgetIds: [alreadyAdded.id], onAddWidgets });

    click(stripButton('Type:'));
    const expected = rowIds().filter(
      (id): id is string =>
        !!id && id !== alreadyAdded.id && !isPickerAddBlocked(id, null),
    );
    expect(stripButton('Add all')).toBeUndefined();
    click(stripButton('Add matching'));

    expect(onAddWidgets).toHaveBeenCalledWith(expected);
  });

  it('hides bulk add and gates Shift+A when no eligible inactive match remains', () => {
    const onAddWidgets = vi.fn((ids: string[]) => ids);
    const eligibleIds = scopeCatalog('overview')
      .filter((widget) => !isPickerAddBlocked(widget.id, null))
      .map((widget) => widget.id);
    render({ widgetIds: eligibleIds, onAddWidgets });

    expect(stripButton('Add all')).toBeUndefined();
    expect(stripButton('Add matching')).toBeUndefined();
    press('A', { shiftKey: true });
    expect(onAddWidgets).not.toHaveBeenCalled();
  });

  it('gates bulk add behind Shift+A and suppresses it while typing', () => {
    const onAddWidgets = vi.fn((ids: string[]) => ids);
    render({ onAddWidgets });

    press('a');
    press('A', { shiftKey: false });
    expect(onAddWidgets).not.toHaveBeenCalled();
    press('A', { shiftKey: true });
    expect(onAddWidgets).toHaveBeenCalledTimes(1);

    press('/');
    const input = searchInput()!;
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true }),
      );
    });
    expect(onAddWidgets).toHaveBeenCalledTimes(1);
  });
});

describe('destructive actions', () => {
  it('empties the dashboard from the strip', () => {
    const clearAll = vi.fn();
    render({ widgetIds: [scopeCatalog('overview')[0].id], clearAll });
    click(stripButton('Empty dashboard'));
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it('hides Empty dashboard and gates Shift+C when the global board is empty', () => {
    const clearAll = vi.fn();
    render({ widgetIds: [], clearAll });

    expect(stripButton('Empty dashboard')).toBeUndefined();
    press('C', { shiftKey: true });
    expect(clearAll).not.toHaveBeenCalled();
  });

  it('keeps Empty dashboard when visible rows are off but the global board is not empty', () => {
    const activeId = scopeCatalog('overview')[0].id;
    render({ widgetIds: [activeId] });

    click(stripButton('Show:'));
    click(stripButton('Show:'));
    expect(rowIds()).not.toContain(activeId);
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((row) => row.querySelector('[aria-label^="Add "]'))).toBe(true);
    expect(stripButton('Empty dashboard')).not.toBeUndefined();
  });

  it('restores the default layout from the strip', () => {
    const resetToDefault = vi.fn();
    render({ resetToDefault });
    click(stripButton('Restore default'));
    expect(resetToDefault).toHaveBeenCalledTimes(1);
  });

  it('gates the empty-dashboard shortcut behind shift', () => {
    const clearAll = vi.fn();
    render({ widgetIds: [scopeCatalog('overview')[0].id], clearAll });
    press('c');
    press('C', { shiftKey: false });
    expect(clearAll).not.toHaveBeenCalled();
    press('C', { shiftKey: true });
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it('gates the restore-default shortcut behind shift', () => {
    const resetToDefault = vi.fn();
    render({ resetToDefault });
    press('v');
    press('V', { shiftKey: false });
    expect(resetToDefault).not.toHaveBeenCalled();
    press('V', { shiftKey: true });
    expect(resetToDefault).toHaveBeenCalledTimes(1);
  });

  it('shows the shift modifier in the label, because the modifier is the guard', () => {
    render({ widgetIds: [scopeCatalog('overview')[0].id] });
    expect(stripButton('Add all')?.textContent).toContain('⇧');
    expect(stripButton('Empty dashboard')?.textContent).toContain('⇧');
    expect(stripButton('Restore default')?.textContent).toContain('⇧');
  });

  it('does not fire bulk dashboard actions from the search field', () => {
    const clearAll = vi.fn();
    const resetToDefault = vi.fn();
    const onAddWidgets = vi.fn((ids: string[]) => ids);
    render({
      widgetIds: [scopeCatalog('overview')[0].id],
      clearAll,
      resetToDefault,
      onAddWidgets,
    });
    press('/');
    const input = searchInput()!;
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'C', shiftKey: true, bubbles: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'V', shiftKey: true, bubbles: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true }),
      );
    });
    expect(clearAll).not.toHaveBeenCalled();
    expect(resetToDefault).not.toHaveBeenCalled();
    expect(onAddWidgets).not.toHaveBeenCalled();
  });
});

describe('keyboard shortcuts', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render({ onClose });
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens and closes search with / and Escape, without closing the picker', () => {
    const onClose = vi.fn();
    render({ onClose });
    press('/');
    expect(searchInput()).not.toBeNull();

    const input = searchInput()!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(searchInput()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears a stale query when search is reopened', () => {
    render();
    press('/');
    type(searchInput()!, 'zzzz-no-such-widget');
    expect(rows()).toHaveLength(0);

    press('/');
    press('/');
    expect(searchInput()!.value).toBe('');
    expect(rows().length).toBeGreaterThan(0);
  });

  it('cycles the show filter with Tab and the viz filter with T', () => {
    render();
    press('Tab');
    expect(stripButton('Show:')?.textContent).toContain('Added');
    press('t');
    expect(stripButton('Type:')?.textContent).toContain('Stats');
  });

  it('stops listening once closed', () => {
    const onClose = vi.fn();
    const h = render({ onClose });
    h.rerender({ open: false });
    press('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('hover card', () => {
  const hover = (widgetId: string) => {
    const row = document.querySelector<HTMLElement>(`[data-widget-row="${widgetId}"]`)!;
    act(() => {
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    });
    return row;
  };

  it('describes the hovered widget without stealing it from the reader', () => {
    const target = scopeCatalog('overview')[0];
    render();
    hover(target.id);
    const card = document.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain(target.name);
    expect(card!.textContent).toContain(VIZ_LABELS[target.viz]);
    expect(card!.textContent).toContain(sizeLabel(target.w));
  });

  it('says Added only for a widget already on the board', () => {
    const target = scopeCatalog('overview')[0];
    const h = render({ widgetIds: [] });
    hover(target.id);
    expect(document.querySelector('[aria-hidden="true"]')!.textContent).not.toContain('Added');

    h.rerender({ widgetIds: [target.id] });
    hover(target.id);
    expect(document.querySelector('[aria-hidden="true"]')!.textContent).toContain('Added');
  });

  it('carries the caption for a widget the date picker does not reach', () => {
    const scoped = scopeCatalog('overview');
    const live = scoped.find((w) => w.timeScope === 'live')!;
    const period = scoped.find((w) => !w.timeScope || w.timeScope === 'period')!;
    render();

    hover(live.id);
    expect(document.querySelector('[aria-hidden="true"]')!.textContent).toContain(
      timeScopeNote(live),
    );

    hover(period.id);
    expect(document.querySelector('[aria-hidden="true"]')!.textContent).not.toContain(
      "The date picker doesn't apply.",
    );
  });
});

describe('drag wiring', () => {
  const lastCallFor = (widgetId: string) =>
    [...draggable.calls].reverse().find((c) => c.id === catalogDraggableId(widgetId));

  it('registers every row under the prefixed catalog id', () => {
    render();
    for (const id of rowIds()) {
      expect(lastCallFor(id!)).toBeDefined();
    }
  });

  it('hands the grid the widget footprint it needs to size the drop ghost', () => {
    const target = scopeCatalog('overview')[0];
    render();
    expect(lastCallFor(target.id)!.data).toEqual(catalogRowDragData(target));
  });

  it('disables the drag for a widget already on the board', () => {
    const target = scopeCatalog('overview')[0];
    render({ widgetIds: [] });
    expect(lastCallFor(target.id)!.disabled).toBe(false);

    current!.unmount();
    current = null;
    draggable.calls.length = 0;
    render({ widgetIds: [target.id] });
    expect(lastCallFor(target.id)!.disabled).toBe(true);
  });
});

describe('drill-through', () => {
  it('closes the picker and opens the widget detail', () => {
    const drillable = scopeCatalog('overview').find(
      (w) => w.drillTarget && 'view' in w.drillTarget,
    )!;
    const onClose = vi.fn();
    render({ onClose });
    click(document.querySelector(`[aria-label="Open ${drillable.name} detail"]`));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigate.toDetail).toHaveBeenCalledTimes(1);
  });

  it('does not toggle the widget when the drill arrow is clicked', () => {
    const drillable = scopeCatalog('overview').find(
      (w) => w.drillTarget && 'view' in w.drillTarget,
    )!;
    const toggleWidget = vi.fn();
    render({ toggleWidget });
    click(document.querySelector(`[aria-label="Open ${drillable.name} detail"]`));
    expect(toggleWidget).not.toHaveBeenCalled();
  });
});

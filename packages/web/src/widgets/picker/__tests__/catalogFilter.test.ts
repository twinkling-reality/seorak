import { describe, expect, it } from 'vitest';

import { CATEGORIES, WIDGET_CATALOG, type WidgetDef } from '../../catalog/index.js';
import {
  CATEGORY_CYCLE,
  categoryCounts,
  cycle,
  filterWidgets,
  scopeCatalog,
  SHOW_CYCLE,
  VIZ_FAMILY_BY_TYPE,
  VIZ_FAMILY_CYCLE,
  type CatalogFilterState,
} from '../catalogFilter.js';

const base: CatalogFilterState = {
  activeCategory: 'all',
  showFilter: 'all',
  vizFilter: 'all',
  searchQuery: '',
  widgetIds: [],
};

const state = (over: Partial<CatalogFilterState>): CatalogFilterState => ({ ...base, ...over });

describe('scopeCatalog', () => {
  it('keeps everything when the host view is unknown', () => {
    expect(scopeCatalog(undefined)).toBe(WIDGET_CATALOG);
  });

  it('drops widgets scoped to the other surface', () => {
    const overview = scopeCatalog('overview');
    const project = scopeCatalog('project');
    expect(overview.every((w) => w.scope === 'both' || w.scope === 'overview')).toBe(true);
    expect(project.every((w) => w.scope === 'both' || w.scope === 'project')).toBe(true);
    // The gate does real work in at least one direction: the catalog ships
    // overview-only widgets today, and the project picker must not show them.
    expect(overview.some((w) => w.scope === 'overview')).toBe(true);
    expect(project.length).toBeLessThan(overview.length);
  });
});

describe('filterWidgets', () => {
  it('passes the whole scope through when no filter is set', () => {
    expect(filterWidgets(WIDGET_CATALOG, base)).toHaveLength(WIDGET_CATALOG.length);
  });

  it('restricts to one category', () => {
    const cat = CATEGORIES[0].id;
    const rows = filterWidgets(WIDGET_CATALOG, state({ activeCategory: cat }));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((w) => w.category === cat)).toBe(true);
  });

  it('splits Added from Available on board membership', () => {
    const onBoard = [WIDGET_CATALOG[0].id, WIDGET_CATALOG[1].id];
    const added = filterWidgets(WIDGET_CATALOG, state({ showFilter: 'active', widgetIds: onBoard }));
    const available = filterWidgets(
      WIDGET_CATALOG,
      state({ showFilter: 'inactive', widgetIds: onBoard }),
    );
    expect(added.map((w) => w.id)).toEqual(onBoard);
    expect(available.some((w) => onBoard.includes(w.id))).toBe(false);
    // The two halves partition the scope — no row can hide between them.
    expect(added.length + available.length).toBe(WIDGET_CATALOG.length);
  });

  it('restricts to a viz family, not a single viz type', () => {
    const rows = filterWidgets(WIDGET_CATALOG, state({ vizFilter: 'tables' }));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((w) => VIZ_FAMILY_BY_TYPE[w.viz] === 'tables')).toBe(true);
    // 'tables' folds data-list, project-list, and live-list together; a family
    // that only ever matched one of them would be an ordinary type filter
    // wearing a family's name.
    expect(new Set(rows.map((w) => w.viz)).size).toBeGreaterThan(1);
  });

  it('searches name, description, and the spoken type label', () => {
    const target = WIDGET_CATALOG.find((w) => w.viz === 'heatmap') as WidgetDef;
    const byName = filterWidgets(WIDGET_CATALOG, state({ searchQuery: target.name }));
    expect(byName.map((w) => w.id)).toContain(target.id);

    // 'grid heatmap' is the label the tooltip says out loud; it appears in no
    // widget's name or description, so a hit proves the label is in the haystack.
    const byLabel = filterWidgets(WIDGET_CATALOG, state({ searchQuery: 'grid heatmap' }));
    expect(byLabel.length).toBeGreaterThan(0);
    expect(byLabel.every((w) => w.viz === 'heatmap')).toBe(true);
  });

  it('ignores case and surrounding whitespace in the query', () => {
    const target = WIDGET_CATALOG[0];
    const rows = filterWidgets(
      WIDGET_CATALOG,
      state({ searchQuery: `   ${target.name.toUpperCase()}   ` }),
    );
    expect(rows.map((w) => w.id)).toContain(target.id);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(filterWidgets(WIDGET_CATALOG, state({ searchQuery: 'zzzz-no-such-widget' }))).toEqual(
      [],
    );
  });

  it('intersects category, show, viz, and search rather than picking one', () => {
    const seed = WIDGET_CATALOG.find((w) => VIZ_FAMILY_BY_TYPE[w.viz] === 'stats') as WidgetDef;
    const rows = filterWidgets(
      WIDGET_CATALOG,
      state({
        activeCategory: seed.category,
        vizFilter: 'stats',
        showFilter: 'inactive',
        widgetIds: [seed.id],
      }),
    );
    // Every constraint still binds, and the result is not empty — an
    // intersection that collapsed to nothing would pass a weaker assertion.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((w) => w.id)).not.toContain(seed.id);
    expect(rows.every((w) => w.category === seed.category)).toBe(true);
    expect(rows.every((w) => VIZ_FAMILY_BY_TYPE[w.viz] === 'stats')).toBe(true);
  });

  it('preserves catalog order', () => {
    const rows = filterWidgets(WIDGET_CATALOG, state({ vizFilter: 'stats' }));
    const expected = WIDGET_CATALOG.filter((w) => VIZ_FAMILY_BY_TYPE[w.viz] === 'stats');
    expect(rows.map((w) => w.id)).toEqual(expected.map((w) => w.id));
  });
});

describe('categoryCounts', () => {
  it('counts each category within the scope and totals them under all', () => {
    const scoped = scopeCatalog('project');
    const counts = categoryCounts(scoped);
    for (const cat of CATEGORIES) {
      expect(counts[cat.id]).toBe(scoped.filter((w) => w.category === cat.id).length);
    }
    expect(counts.all).toBe(scoped.length);
  });

  it('matches what actually renders, so a pill never opens onto an empty list', () => {
    const scoped = scopeCatalog('overview');
    const counts = categoryCounts(scoped);
    for (const cat of CATEGORIES) {
      const rendered = filterWidgets(scoped, state({ activeCategory: cat.id }));
      expect(rendered.length).toBe(counts[cat.id]);
    }
  });
});

describe('cycle', () => {
  it('advances and wraps the show filter', () => {
    expect(cycle(SHOW_CYCLE, 'all')).toBe('active');
    expect(cycle(SHOW_CYCLE, 'active')).toBe('inactive');
    expect(cycle(SHOW_CYCLE, 'inactive')).toBe('all');
  });

  it('advances and wraps the viz family filter', () => {
    expect(cycle(VIZ_FAMILY_CYCLE, 'all')).toBe('stats');
    expect(cycle(VIZ_FAMILY_CYCLE, 'heatmaps')).toBe('all');
  });

  it('walks categories in both directions, wrapping at both ends', () => {
    const last = CATEGORY_CYCLE[CATEGORY_CYCLE.length - 1];
    expect(cycle(CATEGORY_CYCLE, 'all', -1)).toBe(last);
    expect(cycle(CATEGORY_CYCLE, last, 1)).toBe('all');
  });

  it('starts the cycle from the head when the current value is off-list', () => {
    expect(cycle(SHOW_CYCLE, 'nonsense' as never)).toBe('all');
  });
});

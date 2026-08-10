/**
 * Which widgets the picker shows, and in what order. Pure functions over the static
 * catalog: no React, no DOM, no refs. The panel is the only place a user discovers a
 * widget exists, so a filter that silently drops a row is a feature the user never
 * finds — which is exactly the kind of bug a component-only test cannot see.
 */
import { CATEGORIES, WIDGET_CATALOG, type WidgetCategory, type WidgetDef, type WidgetViz } from '../catalog/index.js';

import { VIZ_LABELS } from './catalogMeta.js';

export type ShowFilter = 'all' | 'active' | 'inactive';
export type VizFamilyFilter = 'all' | 'stats' | 'tables' | 'bars' | 'trends' | 'heatmaps';
export type CategoryFilter = 'all' | WidgetCategory;

// Labels read as the answer to "Show:" - `Added` / `Available` map to
// the user's mental model (widgets I've put on my dashboard vs. ones I
// could add) far better than the engineering vocabulary `active` /
// `inactive`. The internal enum keeps `active` / `inactive` so the
// filter logic stays compact.
export const SHOW_LABELS: Record<ShowFilter, string> = {
  all: 'All',
  active: 'Added',
  inactive: 'Available',
};
export const SHOW_CYCLE: ShowFilter[] = ['all', 'active', 'inactive'];

export const VIZ_FAMILY_LABELS: Record<VizFamilyFilter, string> = {
  all: 'All',
  stats: 'Stats',
  tables: 'Tables',
  bars: 'Bars',
  trends: 'Trends',
  heatmaps: 'Heatmaps',
};
export const VIZ_FAMILY_CYCLE: VizFamilyFilter[] = [
  'all',
  'stats',
  'tables',
  'bars',
  'trends',
  'heatmaps',
];
export const VIZ_FAMILY_BY_TYPE: Record<WidgetViz, Exclude<VizFamilyFilter, 'all'>> = {
  stat: 'stats',
  sparkline: 'trends',
  heatmap: 'heatmaps',
  'bar-chart': 'bars',
  'proportional-bar': 'bars',
  'data-list': 'tables',
  ring: 'bars',
  'project-list': 'tables',
  'live-list': 'tables',
};

/** Next value in a cycle, wrapping. `dir` is -1 for the backwards arrow. */
export function cycle<T>(values: readonly T[], current: T, dir: 1 | -1 = 1): T {
  if (values.length === 0) return current;
  const idx = values.indexOf(current);
  return values[(idx + dir + values.length) % values.length];
}

/** Category pills in render order, with `all` first. */
export const CATEGORY_CYCLE: CategoryFilter[] = ['all', ...CATEGORIES.map((c) => c.id)];

/**
 * Scope-gated catalog: widgets with scope='both' always pass; scope-specific widgets
 * only pass when the host view matches. Without viewScope, show everything.
 */
export function scopeCatalog(
  viewScope: 'overview' | 'project' | undefined,
  catalog: WidgetDef[] = WIDGET_CATALOG,
): WidgetDef[] {
  return viewScope
    ? catalog.filter((w) => w.scope === 'both' || w.scope === viewScope)
    : catalog;
}

export interface CatalogFilterState {
  activeCategory: CategoryFilter;
  showFilter: ShowFilter;
  vizFilter: VizFamilyFilter;
  searchQuery: string;
  /** Widget ids currently on the board — what `Added` / `Available` means. */
  widgetIds: string[];
}

export function filterWidgets(scoped: WidgetDef[], state: CatalogFilterState): WidgetDef[] {
  const q = state.searchQuery.toLowerCase().trim();
  return scoped.filter((w) => {
    const family = VIZ_FAMILY_BY_TYPE[w.viz];
    if (state.activeCategory !== 'all' && w.category !== state.activeCategory) return false;
    if (state.showFilter === 'active' && !state.widgetIds.includes(w.id)) return false;
    if (state.showFilter === 'inactive' && state.widgetIds.includes(w.id)) return false;
    if (state.vizFilter !== 'all' && family !== state.vizFilter) return false;
    if (q) {
      const haystack = [
        w.name,
        w.description,
        VIZ_LABELS[w.viz],
        VIZ_FAMILY_LABELS[family],
        w.viz,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Category counts, scope-gated so the "usage (12)" count matches what renders. */
export function categoryCounts(scoped: WidgetDef[]): Record<string, number> {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const cat of CATEGORIES) {
    const n = scoped.filter((w) => w.category === cat.id).length;
    counts[cat.id] = n;
    total += n;
  }
  counts.all = total;
  return counts;
}

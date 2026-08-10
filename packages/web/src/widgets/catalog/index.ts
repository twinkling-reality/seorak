// Public entry for the widget catalog. Aggregates per-category widget arrays
// into the canonical WIDGET_CATALOG, builds the lookup map, and re-exports
// every other catalog primitive (types, categories, default layout)
// so consumers depend on this one module.

import {
  type WidgetDef,
  type WidgetSlot,
  type WidgetViz,
  widgetColSpan,
  widgetRowSpan,
} from './types.js';
import { LIVE_WIDGETS } from './live.js';
import { USAGE_WIDGETS } from './usage.js';
import { OUTCOMES_WIDGETS } from './outcomes.js';
import { ACTIVITY_WIDGETS } from './activity.js';
import { CODEBASE_WIDGETS } from './codebase.js';
import { TOOLS_WIDGETS } from './tools.js';

export * from './types.js';
export * from './categories.js';
export * from './default-layout.js';

// Per-viz default size constraints. Applied when a widget def doesn't supply
// its own maxW/maxH, so saved layouts can't drag a stat card past KPI width
// or stretch a sparkline past its readable height.
const VIZ_MAX_CONSTRAINTS: Record<WidgetViz, { maxW: number; maxH: number }> = {
  stat: { maxW: 4, maxH: 2 },
  sparkline: { maxW: 12, maxH: 4 },
  heatmap: { maxW: 12, maxH: 6 },
  'bar-chart': { maxW: 12, maxH: 6 },
  'proportional-bar': { maxW: 12, maxH: 8 },
  'data-list': { maxW: 12, maxH: 8 },
  ring: { maxW: 12, maxH: 6 },
  'project-list': { maxW: 12, maxH: 6 },
  'live-list': { maxW: 12, maxH: 4 },
};

export const WIDGET_CATALOG: WidgetDef[] = [
  ...LIVE_WIDGETS,
  ...USAGE_WIDGETS,
  ...OUTCOMES_WIDGETS,
  ...ACTIVITY_WIDGETS,
  ...CODEBASE_WIDGETS,
  ...TOOLS_WIDGETS,
];

export const WIDGET_MAP = new Map(
  WIDGET_CATALOG.map((w) => {
    const vizMax = VIZ_MAX_CONSTRAINTS[w.viz];
    return [
      w.id,
      {
        ...w,
        maxW: w.maxW ?? vizMax?.maxW,
        maxH: w.maxH ?? vizMax?.maxH,
      },
    ];
  }),
);

export function getWidget(id: string): WidgetDef | undefined {
  return WIDGET_MAP.get(id);
}

/**
 * Build a WidgetSlot for an id using catalog defaults. Returns null when the
 * id isn't in the catalog.
 */
export function defaultSlot(id: string): WidgetSlot | null {
  const def = getWidget(id);
  if (!def) return null;
  return { id, colSpan: widgetColSpan(def), rowSpan: widgetRowSpan(def) };
}

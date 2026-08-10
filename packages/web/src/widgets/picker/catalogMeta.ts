/**
 * The picker's label vocabulary: how a widget's type, size, data source, time scope,
 * and availability are said in plain words. Pure lookups, no React, so the tooltip
 * and the row can never disagree about what a widget is called.
 */
import type { CaptureSettings, OverviewSnapshot } from '@seorak/types';

import { getWidgetReadiness } from '../../lib/widgetReadiness.js';
import type { WidgetDef, WidgetTimeScope, WidgetViz } from '../catalog/index.js';

export const VIZ_LABELS: Record<WidgetViz, string> = {
  stat: 'single stat',
  sparkline: 'trend line',
  heatmap: 'grid heatmap',
  'bar-chart': 'bar chart',
  'proportional-bar': 'proportional bar',
  'data-list': 'data table',
  ring: 'donut ring',
  'project-list': 'project list',
  'live-list': 'live presence',
};

const SIZE_LABELS: Record<number, string> = {
  3: 'quarter width',
  4: 'third width',
  6: 'half width',
  8: 'two-thirds width',
  12: 'full width',
};

// Full-sentence caption for widgets that don't follow the global 7/30/90
// date picker, rendered as a bare muted line (no callout chrome). Period
// widgets render nothing — the RangePills already communicate the default.
const TIME_SCOPE_NOTES: Record<Exclude<WidgetTimeScope, 'period'>, string> = {
  live: "Real-time. The date picker doesn't apply.",
  'all-time': "Lifetime totals. The date picker doesn't apply.",
};

const DATA_KEY_LABELS: Record<string, string> = {
  daily_trends: 'daily trends',
  token_usage: 'token usage',
  completion_summary: 'outcomes',
  file_heatmap: 'file activity',
  commit_stats: 'git commit stats',
  hourly_distribution: 'hourly patterns',
  work_type_distribution: 'work types',
  directory_heatmap: 'directory activity',
  tool_comparison: 'tool comparison',
  model_outcomes: 'model outcomes',
  dashboard: 'dashboard data',
  stuckness: 'stuckness',
  edit_velocity: 'edits per hour',
  first_edit_stats: 'time to first edit',
  duration_distribution: 'session durations',
  scope_complexity: 'scope complexity',
  period_comparison: 'period comparison',
  prompt_efficiency: 'prompt efficiency',
  hourly_effectiveness: 'how sessions ended, by hour',
  work_type_outcomes: 'work type outcomes',
  file_churn: 'file churn',
  file_rework: 'file rework',
  audit_staleness: 'audit staleness',
  concurrent_edits: 'edit collisions',
  tool_outcomes: 'tool outcomes',
  tool_handoffs: 'tool handoffs',
  tool_call_stats: 'tool calls',
  retry_patterns: 'recurring failures',
  tool_daily: 'tool daily',
  tool_work_type: 'tool work mix',
  data_coverage: 'data coverage',
};

/** Column span in words, falling back to the raw count for an unnamed span. */
export function sizeLabel(colSpan: number): string {
  return SIZE_LABELS[colSpan] ?? `${colSpan} columns`;
}

/** The widget's primary data source in words, or null when it is the generic
 *  dashboard payload (naming that tells the reader nothing they can act on). */
export function dataKeyLabel(widget: WidgetDef): string | null {
  const key = widget.dataKeys[0];
  if (!key || key === 'dashboard') return null;
  return DATA_KEY_LABELS[key] ?? key;
}

/** The caption for a widget that ignores the global date picker; null for the
 *  period widgets, where the RangePills already say it. */
export function timeScopeNote(widget: WidgetDef): string | null {
  if (!widget.timeScope || widget.timeScope === 'period') return null;
  return TIME_SCOPE_NOTES[widget.timeScope];
}

/** Honest availability badge label for a locked widget. Returns null for
 *  widgets bound to data Seorak already captures (the default), so only tiles
 *  the user cannot feed get a marker. 'not-available' = data Seorak does not
 *  collect; 'coming-soon' = on the roadmap, fills in when it lands. */
export function availabilityLabel(widget: WidgetDef): string | null {
  switch (widget.availability) {
    case 'not-available':
      return 'Not available';
    case 'coming-soon':
      return 'Coming soon';
    default:
      return null;
  }
}

export function readinessBadge(
  widget: WidgetDef,
  overview: OverviewSnapshot | null | undefined,
  capture: CaptureSettings | null | undefined,
): string | null {
  if (!overview) return null;
  if (availabilityLabel(widget)) return null;
  return getWidgetReadiness(widget.id, overview, capture).pickerBadge;
}

import type { CompareMetric } from './compareMetrics.js';
import { COMPARE_METRICS } from './compareMetrics.js';

export type CompareSectionId =
  | 'context'
  | 'volume'
  | 'outcomes'
  | 'work-shape'
  | 'cadence'
  | 'attention';

export const COMPARE_SECTION_LABELS: Record<CompareSectionId, string> = {
  context: 'Context',
  volume: 'Volume and economics',
  outcomes: 'Outcomes',
  'work-shape': 'Work shape',
  cadence: 'Cadence and git',
  attention: 'Attention',
};

/** Metrics hidden until the user expands detail rows (default: context + outcomes + core volume). */
export const COMPARE_DETAIL_METRIC_IDS = new Set([
  'tool-calls',
  'cost-trend',
  'cost-per-edit',
  'cache-reuse',
  'edit-volume',
  'commits-from-sessions',
  'branch-mix',
  'top-tool',
  'top-model',
  'top-directory',
  'rework-file',
  'peak-time',
  'typical-session',
  'git-context',
  'temperature',
  'interventions',
]);

export type CompareRenderItem =
  | { kind: 'section'; id: CompareSectionId; label: string }
  | { kind: 'metric'; metric: CompareMetric; index: number };

export function buildCompareRenderItems(
  metrics: CompareMetric[],
  showDetail: boolean,
): CompareRenderItem[] {
  const items: CompareRenderItem[] = [];
  let section: CompareSectionId | null = null;
  let metricIndex = 0;
  for (const metric of metrics) {
    if (!showDetail && COMPARE_DETAIL_METRIC_IDS.has(metric.id)) continue;
    if (metric.section !== section) {
      section = metric.section;
      items.push({
        kind: 'section',
        id: section,
        label: COMPARE_SECTION_LABELS[section],
      });
    }
    items.push({ kind: 'metric', metric, index: metricIndex });
    metricIndex += 1;
  }
  return items;
}

export function countHiddenCompareMetrics(showDetail: boolean): number {
  if (showDetail) return 0;
  return COMPARE_METRICS.filter((m) => COMPARE_DETAIL_METRIC_IDS.has(m.id)).length;
}

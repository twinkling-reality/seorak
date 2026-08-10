import {
  DEFAULT_THRESHOLDS,
  SIGNAL_CATALOG,
  SIGNAL_IDS,
  type Intervention,
  type SignalId,
  type InterventionThresholds,
} from '@seorak/types';

import { formatCost } from '../../widgets/utils.js';

export interface ThresholdCard {
  kind: SignalId;
  label: string;
  value: string;
  hint: string;
}

/** Human label for a fired intervention row — prefers catalog metadata. */
export function interventionKindLabel(kind: SignalId): string {
  return SIGNAL_CATALOG[kind]?.label ?? kind;
}

function formatThresholdValue(
  key: keyof InterventionThresholds,
  unit: string,
  bound: number,
): string {
  if (key === 'highBurnRateUsdPerMinute') return `${formatCost(bound)}/min`;
  if (key === 'costSpikeUsd' || key === 'dailyCostCapUsd') return formatCost(bound);
  if (key === 'longSessionMinutes' || key === 'wentColdMinutes') return `${bound} min`;
  if (key === 'stuckLoopRepeatedToolCalls') return `${bound} repeats`;
  if (key === 'stuckLoopErroredToolCalls') return `${bound} failed retries`;
  return `${bound}${unit ? ` ${unit}` : ''}`;
}

/** All eight watch limits for the detail panel, in catalog display order. */
export function thresholdCards(thresholds: InterventionThresholds): ThresholdCard[] {
  return SIGNAL_IDS.map((kind) => {
    const meta = SIGNAL_CATALOG[kind];
    // A signal with two thresholds (stuck_loop: failed-retries OR repeats) trips
    // on EITHER, so join with "or" — never a middot (no `·` in dashboard copy).
    const value =
      meta.thresholds.length === 0
        ? 'Event-driven'
        : meta.thresholds
            .map((t) => {
              const bound = thresholds[t.key] ?? t.default;
              return formatThresholdValue(t.key, t.unit, bound);
            })
            .join(' or ');
    return {
      kind,
      label: meta.label,
      value,
      hint: meta.why,
    };
  });
}

export function effectiveThresholds(
  overviewThresholds: InterventionThresholds | undefined,
): InterventionThresholds {
  return overviewThresholds ?? DEFAULT_THRESHOLDS;
}

export interface FiredKindCount {
  kind: SignalId;
  label: string;
  count: number;
}

/** Group fired interventions by signal kind, highest count first. */
export function groupFiredByKind(fired: Intervention[]): FiredKindCount[] {
  const counts = new Map<SignalId, number>();
  for (const event of fired) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, label: interventionKindLabel(kind), count }))
    .sort((a, b) => b.count - a.count);
}

/** Newest-first copy for timeline displays. */
export function sortFiredNewestFirst(fired: Intervention[]): Intervention[] {
  return [...fired].sort((a, b) => Date.parse(b.triggeredAt) - Date.parse(a.triggeredAt));
}

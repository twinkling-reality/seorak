// The honest-empty demo OverviewSnapshot. Every array is empty and every
// nullable scalar is null — NEVER zero-filled — so every widget renders its
// real empty state. Shares the canonical empty shape with the schema layer's
// createEmptyOverview so "no data" stays in lockstep.

import type { OverviewSnapshot } from '../apiSchemas.js';
import { createEmptyOverview } from '../schemas/common.js';
import { DEFAULT_PERIOD_DAYS } from './baseline.js';

export function createEmptyOverviewDemo(rangeDays = DEFAULT_PERIOD_DAYS): OverviewSnapshot {
  return createEmptyOverview(rangeDays);
}

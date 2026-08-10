import type { PeriodDelta } from '../../lib/apiSchemas.js';

/** True when a prior-window leg exists and supports a period-over-period sentence. */
export function hasPriorPeriodDelta(delta: PeriodDelta | null | undefined): boolean {
  return delta != null && delta.previous != null && delta.previous > 0;
}

/** Signed percent change, rounded. Caller must gate on `hasPriorPeriodDelta`. */
export function periodChangePct(current: number, previous: number): number {
  return Math.round(((current - previous) / previous) * 100);
}

/** Average per session; null when sessions === 0. */
export function perSessionAverage(total: number, sessions: number): number | null {
  return sessions > 0 ? total / sessions : null;
}

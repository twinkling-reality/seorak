import type { HourBucket } from '../../lib/apiSchemas.js';

export interface DowAggregate {
  dow: number;
  sessions: number;
}

/** Sum session counts by day-of-week from the 7×24 hourly grid. */
export function aggregateSessionsByDow(buckets: HourBucket[]): DowAggregate[] {
  const byDow = new Map<number, number>();
  for (const b of buckets) {
    if (b.sessions <= 0) continue;
    byDow.set(b.dow, (byDow.get(b.dow) ?? 0) + b.sessions);
  }
  return [...byDow.entries()]
    .map(([dow, sessions]) => ({ dow, sessions }))
    .sort((a, b) => b.sessions - a.sessions);
}

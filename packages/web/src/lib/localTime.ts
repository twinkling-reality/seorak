// Viewer-local time helpers for the activity surfaces.
//
// The worker buckets session hours in UTC (eventlog.ts uses getUTCHours /
// getUTCDay), but the dashboard presents those buckets as the developer's coding
// time-of-day ("you peak around 9p", the rhythm heatmap). Rendering a UTC hour as
// a local clock time is a wrong, believable number for any developer not on UTC
// (a 2pm-Pacific peak would read as ~10p). The worker cannot localize (it does not
// know the viewer's timezone), so the shift happens here, on read.

import type { HourBucket, HourlyEndReasons, EndReasonCount } from '@seorak/types';

/** The viewer's UTC offset in HOURS, east-positive (US-Pacific = -8, Tokyo = +9). */
export function localOffsetHours(): number {
  // getTimezoneOffset() returns minutes WEST of UTC, so negate for east-positive.
  return -new Date().getTimezoneOffset() / 60;
}

// ── Dayparts ────────────────────────────────────────────────────────────────
//
// ONE definition of what "evening" means, for every surface that names a time of
// day. It lived in AgentsView/verdict/clock.ts, and the Model compiler grew a
// SECOND, different one inline (18-23 for evening) that it applied to UNSHIFTED
// UTC buckets — so the Agents verdict and the Model portrait could name different
// dayparts for the same sessions, and the Model one was wrong for anyone off UTC.
// A daypart is a claim about the developer's day; it can only be decided on the
// developer's clock.

/** Four dayparts over LOCAL clock hours. Night wraps midnight. */
const DAYPARTS = [
  { id: 'morning', label: 'morning', range: '05:00 to 11:59', from: 5, to: 11 },
  { id: 'afternoon', label: 'afternoon', range: '12:00 to 16:59', from: 12, to: 16 },
  { id: 'evening', label: 'evening', range: '17:00 to 21:59', from: 17, to: 21 },
  { id: 'night', label: 'night', range: '22:00 to 04:59', from: 22, to: 4 },
] as const;

export type DaypartId = (typeof DAYPARTS)[number]['id'];

export const DAYPART_IDS: readonly DaypartId[] = DAYPARTS.map((p) => p.id);

/** UTC hour bucket → the viewer's local hour. `offsetMinutes` follows
 *  Date.getTimezoneOffset() (minutes to ADD to local time to reach UTC), so
 *  local = utc − offset. Half-hour zones land between buckets; flooring keeps
 *  the error under the daypart granularity this feeds.
 *
 *  Note the convention differs from `localizeHourBuckets` below, which takes
 *  east-positive HOURS. Both are load-bearing and both are named for what they
 *  take; do not pass one to the other. */
export function localHourOf(utcHour: number, offsetMinutes: number): number {
  return ((Math.floor(utcHour - offsetMinutes / 60) % 24) + 24) % 24;
}

export function daypartOf(localHour: number): DaypartId {
  for (const p of DAYPARTS) {
    if (p.from <= p.to) {
      if (localHour >= p.from && localHour <= p.to) return p.id;
    } else if (localHour >= p.from || localHour <= p.to) {
      return p.id;
    }
  }
  return 'night';
}

export function daypartMeta(id: DaypartId): (typeof DAYPARTS)[number] {
  return DAYPARTS.find((p) => p.id === id) ?? DAYPARTS[0];
}

/**
 * Sessions per daypart from buckets that are ALREADY in the viewer's clock
 * (`localizeHourBuckets` first). It takes localized input rather than shifting
 * internally so a caller that has localized once — every caller that also reads
 * `dow`, since a shift can move a session's weekday — cannot double-shift.
 *
 * Honest-empty: a daypart with no sessions is ABSENT from the map, never a zero
 * entry, so a caller cannot read "0 morning sessions" as a measurement of a
 * window that simply holds no morning work.
 */
export function daypartSessions(localBuckets: HourBucket[]): Map<DaypartId, number> {
  const totals = new Map<DaypartId, number>();
  for (const b of localBuckets) {
    if (b.sessions <= 0) continue;
    const part = daypartOf(b.hour);
    totals.set(part, (totals.get(part) ?? 0) + b.sessions);
  }
  return totals;
}

/**
 * Shift a (dow, hour) pair by a whole-or-fractional hour offset, wrapping across
 * the day boundary. Hour is rounded for fractional offsets (e.g. UTC+5:30); the
 * honest alternative for those zones would be to label the axis UTC, but a rounded
 * local hour is far closer to the truth than an unconverted UTC one.
 */
function shift(dow: number, hour: number, offsetHours: number): { dow: number; hour: number } {
  let h = Math.round(hour + offsetHours);
  let d = dow;
  while (h < 0) {
    h += 24;
    d = (d + 6) % 7;
  }
  while (h >= 24) {
    h -= 24;
    d = (d + 1) % 7;
  }
  return { dow: d, hour: h };
}

/**
 * Re-bucket UTC (dow, hour) session-count buckets into the viewer's local
 * timezone. A 0 offset (or empty input) is returned unchanged. Buckets that
 * collide after a fractional-offset round are summed, so the total session count
 * is preserved. Honest-empty in stays honest-empty out (never zero-fills a spine).
 */
export function localizeHourBuckets(
  buckets: HourBucket[],
  offsetHours: number = localOffsetHours(),
): HourBucket[] {
  if (offsetHours === 0 || buckets.length === 0) return buckets;
  const agg = new Map<string, HourBucket>();
  for (const b of buckets) {
    const { dow, hour } = shift(b.dow, b.hour, offsetHours);
    const key = `${dow}:${hour}`;
    const existing = agg.get(key);
    if (existing) existing.sessions += b.sessions;
    else agg.set(key, { dow, hour, sessions: b.sessions });
  }
  return [...agg.values()];
}

/**
 * Re-bucket per-hour end-reason rows (aggregated across days, so hour-only) into
 * local time. Collisions merge reason counts. Same 0-offset / empty passthrough.
 */
export function localizeHourlyReasons(
  rows: HourlyEndReasons[],
  offsetHours: number = localOffsetHours(),
): HourlyEndReasons[] {
  if (offsetHours === 0 || rows.length === 0) return rows;
  const agg = new Map<number, Map<EndReasonCount['reason'], number>>();
  for (const row of rows) {
    const { hour } = shift(0, row.hour, offsetHours);
    let kinds = agg.get(hour);
    if (!kinds) {
      kinds = new Map();
      agg.set(hour, kinds);
    }
    for (const r of row.reasons) kinds.set(r.reason, (kinds.get(r.reason) ?? 0) + r.count);
  }
  return [...agg.entries()].map(([hour, kinds]) => ({
    hour,
    reasons: [...kinds.entries()].map(([reason, count]) => ({ reason, count })),
  }));
}

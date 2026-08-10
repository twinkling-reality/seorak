import { describe, expect, it } from 'vitest';
import {
  DAYPART_IDS,
  daypartMeta,
  daypartOf,
  daypartSessions,
  localHourOf,
  localizeHourBuckets,
  localizeHourlyReasons,
} from '../localTime.js';

// DA-04: the worker buckets session hours in UTC (getUTCHours/getUTCDay), but the
// dashboard presents them as the developer's local time-of-day. Without this shift,
// a 2pm-Pacific peak renders as "~10p" — a wrong, believable number.
describe('localizeHourBuckets (DA-04 UTC -> viewer-local)', () => {
  it('shifts a 21:00 UTC bucket to 13:00 local at UTC-8, same day (no wrap)', () => {
    const out = localizeHourBuckets([{ dow: 3, hour: 21, sessions: 5 }], -8);
    expect(out).toEqual([{ dow: 3, hour: 13, sessions: 5 }]);
  });

  it('wraps BACKWARD across the day boundary (02:00 UTC Mon -> 18:00 local Sun at UTC-8)', () => {
    const out = localizeHourBuckets([{ dow: 1, hour: 2, sessions: 3 }], -8);
    expect(out).toEqual([{ dow: 0, hour: 18, sessions: 3 }]);
  });

  it('wraps FORWARD across the day boundary (20:00 UTC Sat -> 05:00 local Sun at UTC+9)', () => {
    const out = localizeHourBuckets([{ dow: 6, hour: 20, sessions: 2 }], 9);
    expect(out).toEqual([{ dow: 0, hour: 5, sessions: 2 }]);
  });

  it('is a no-op at UTC (offset 0) and preserves the total session count', () => {
    const buckets = [{ dow: 1, hour: 9, sessions: 4 }];
    expect(localizeHourBuckets(buckets, 0)).toBe(buckets);
  });

  it('honest-empty in stays honest-empty out (no zero-filled spine)', () => {
    expect(localizeHourBuckets([], -5)).toEqual([]);
  });

  it('rounds a fractional offset to the nearest local hour (UTC+5:30)', () => {
    // 1:00 UTC at +5:30 = 6:30 local -> rounds to 7. The honest alternative for a
    // half-hour zone would be a UTC label; a rounded local hour is far closer.
    const out = localizeHourBuckets([{ dow: 2, hour: 1, sessions: 2 }], 5.5);
    expect(out).toEqual([{ dow: 2, hour: 7, sessions: 2 }]);
  });

  it('preserves the total session count across a multi-bucket shift', () => {
    const buckets = [
      { dow: 1, hour: 2, sessions: 3 },
      { dow: 3, hour: 21, sessions: 5 },
      { dow: 6, hour: 20, sessions: 2 },
    ];
    const before = buckets.reduce((s, b) => s + b.sessions, 0);
    const after = localizeHourBuckets(buckets, -8).reduce((s, b) => s + b.sessions, 0);
    expect(after).toBe(before);
  });
});

// The daypart table is the ONE place a surface learns what "evening" means. It moved
// here from AgentsView because the Model portrait had grown a second, different copy
// and applied it to unshifted UTC — so these pin the shared answer, not one view's.
describe('dayparts', () => {
  it('covers all 24 local hours with no gap and no overlap', () => {
    const seen = Array.from({ length: 24 }, (_, h) => daypartOf(h));
    expect(seen).toHaveLength(24);
    expect(new Set(seen)).toEqual(new Set(DAYPART_IDS));
  });

  it('places the boundary hours in the daypart their label claims', () => {
    expect(daypartOf(5)).toBe('morning');
    expect(daypartOf(11)).toBe('morning');
    expect(daypartOf(12)).toBe('afternoon');
    expect(daypartOf(16)).toBe('afternoon');
    expect(daypartOf(17)).toBe('evening');
    expect(daypartOf(21)).toBe('evening');
  });

  it('wraps night across midnight rather than splitting it in two', () => {
    expect(daypartOf(22)).toBe('night');
    expect(daypartOf(23)).toBe('night');
    expect(daypartOf(0)).toBe('night');
    expect(daypartOf(4)).toBe('night');
  });

  it('names a daypart with the range it actually covers', () => {
    expect(daypartMeta('evening').label).toBe('evening');
    expect(daypartMeta('evening').range).toBe('17:00 to 21:59');
  });
});

describe('localHourOf (getTimezoneOffset convention)', () => {
  it('shifts a UTC hour into the viewer clock', () => {
    expect(localHourOf(1, 240)).toBe(21);
    expect(localHourOf(23, -120)).toBe(1);
    expect(localHourOf(12, 0)).toBe(12);
  });
});

describe('daypartSessions', () => {
  it('folds localized buckets into dayparts', () => {
    const totals = daypartSessions([
      { dow: 2, hour: 19, sessions: 3 },
      { dow: 3, hour: 20, sessions: 2 },
      { dow: 4, hour: 9, sessions: 4 },
    ]);
    expect(totals.get('evening')).toBe(5);
    expect(totals.get('morning')).toBe(4);
  });

  it('leaves an unworked daypart ABSENT rather than reporting a measured zero', () => {
    const totals = daypartSessions([{ dow: 2, hour: 19, sessions: 3 }]);
    expect(totals.has('morning')).toBe(false);
    expect(totals.has('afternoon')).toBe(false);
    expect(totals.has('night')).toBe(false);
  });

  it('reads a night owl as night, which is what the UTC-blind Model read got wrong', () => {
    // 22:00 UTC Tuesday at UTC-8 is 14:00 Tuesday — afternoon, not evening.
    const local = localizeHourBuckets([{ dow: 2, hour: 22, sessions: 6 }], -8);
    expect(daypartSessions(local).get('afternoon')).toBe(6);
    // ...and 06:00 UTC Wednesday is 22:00 Tuesday local: night, not morning.
    const owl = localizeHourBuckets([{ dow: 3, hour: 6, sessions: 6 }], -8);
    expect(daypartSessions(owl).get('night')).toBe(6);
    expect(owl[0].dow).toBe(2);
  });
});

describe('localizeHourlyReasons (DA-04 hour-only)', () => {
  it('shifts the hour and preserves reason counts', () => {
    const out = localizeHourlyReasons(
      [{ hour: 23, reasons: [{ reason: 'clear', count: 4 }] }],
      -8,
    );
    expect(out).toEqual([{ hour: 15, reasons: [{ reason: 'clear', count: 4 }] }]);
  });

  it('preserves total reason counts across a multi-hour shift', () => {
    const out = localizeHourlyReasons(
      [
        { hour: 1, reasons: [{ reason: 'clear', count: 2 }] },
        { hour: 2, reasons: [{ reason: 'clear', count: 3 }] },
      ],
      -8,
    );
    const totalClear = out
      .flatMap((r) => r.reasons)
      .filter((r) => r.reason === 'clear')
      .reduce((s, r) => s + r.count, 0);
    expect(totalClear).toBe(5);
  });
});

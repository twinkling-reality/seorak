/**
 * allowedRanges — the "advertise" half of the plan ceiling (docs/specs/pricing.md).
 *
 * The property under test is an HONESTY property, not a layout one. Every widget
 * caption reads its window off the response ("in the last 30 days") while the
 * range pills hold their own selection, so a pill the worker would clamp lights
 * "90" beside the sentence "in the last 30 days" — a card the reader cannot
 * check. Removing the pill is what prevents that, so these assertions are about
 * which pills may exist at all.
 */
import { describe, expect, it } from 'vitest';
import { OVERVIEW_RANGE_DAYS, WIDEST_OVERVIEW_RANGE_DAYS } from '@seorak/types';
import { allowedRanges, RANGES } from '../overview-utils.js';

describe('allowedRanges', () => {
  it('offers every supported window on the widest plan', () => {
    expect(allowedRanges(WIDEST_OVERVIEW_RANGE_DAYS)).toEqual([...OVERVIEW_RANGE_DAYS]);
  });

  it('drops the windows a Free plan cannot serve', () => {
    expect(allowedRanges(30)).toEqual([7, 30]);
  });

  it('leaves a single window when the ceiling is the narrowest one', () => {
    expect(allowedRanges(7)).toEqual([7]);
  });

  // Before the first poll there is no ceiling to know. Offering everything is
  // right because the worker clamps regardless, and it avoids a picker that
  // visibly shrinks a moment after load.
  it('offers everything when no snapshot has advertised a ceiling yet', () => {
    expect(allowedRanges(undefined)).toEqual([...RANGES]);
  });

  // The list is derived, never re-listed, so dropping 90d stays a one-line edit
  // in @seorak/types rather than a sweep (audit finding F-06).
  it('never invents a window outside the shared contract', () => {
    for (const ceiling of [7, 30, 90, 1, 45, 365]) {
      for (const days of allowedRanges(ceiling)) {
        expect(OVERVIEW_RANGE_DAYS).toContain(days);
        expect(days).toBeLessThanOrEqual(ceiling);
      }
    }
  });
});

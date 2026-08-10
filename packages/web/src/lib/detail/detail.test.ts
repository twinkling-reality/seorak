import { describe, expect, it } from 'vitest';

import {
  hasPriorPeriodDelta,
  periodChangePct,
} from './periodDelta.js';
import { aggregateSessionsByDow } from './activityRollups.js';
import { groupFiredByKind } from './interventionDisplay.js';
import type { Intervention } from '@seorak/types';

describe('detail/periodDelta', () => {
  it('hasPriorPeriodDelta is false when previous is null', () => {
    expect(hasPriorPeriodDelta({ current: 10, previous: null })).toBe(false);
  });

  it('periodChangePct computes signed percent', () => {
    expect(periodChangePct(15, 10)).toBe(50);
    expect(periodChangePct(8, 10)).toBe(-20);
  });
});

describe('detail/activityRollups', () => {
  it('aggregateSessionsByDow sums hourly buckets', () => {
    const rows = aggregateSessionsByDow([
      { dow: 1, hour: 9, sessions: 3 },
      { dow: 1, hour: 14, sessions: 2 },
      { dow: 3, hour: 10, sessions: 5 },
    ]);
    expect(rows[0]).toEqual({ dow: 1, sessions: 5 });
    expect(rows[1]).toEqual({ dow: 3, sessions: 5 });
  });
});

describe('detail/interventionDisplay', () => {
  it('groupFiredByKind counts by signal', () => {
    const fired = [
      { kind: 'cost_spike' },
      { kind: 'went_cold' },
      { kind: 'cost_spike' },
    ] as Intervention[];
    const grouped = groupFiredByKind(fired);
    expect(grouped[0]).toMatchObject({ kind: 'cost_spike', count: 2 });
  });
});

import { describe, expect, it } from 'vitest';
import type { DeveloperModelSnapshot } from '@seorak/types';

import { shipByDaypart, standoutDaypart, survivalByDaypart } from '../conditional.js';

const BASE: DeveloperModelSnapshot = {
  scope: { rangeDays: 30, maxRangeDays: 90, repoId: null, generatedAt: '2026-07-01T12:00:00.000Z' },
  focus: { projectFocus: [] },
  outcomes: {
    shipRate: null,
    lineSurvival: {
      rate: null,
      linesAuthored: 0,
      linesSurviving: 0,
      commitsChecked: 0,
      sessionsRated: 0,
      retained: 0,
      overwritten: 0,
      unreachable: 0,
      unknown: 0,
    },
    shipped: 0,
    shipDeterminable: 0,
    stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    endReasons: [],
  },
  activity: { hourlyDistribution: [], endReasonsByHour: [] },
  tools: { byTool: [], byModel: [], callStats: { errorRate: null, erroredCalls: 0, callsWithResult: 0 }, verification: [] },
};

const UTC = 0;
const PACIFIC = 480; // Date.getTimezoneOffset() for UTC-8

function withSurvival(buckets: DeveloperModelSnapshot['conditional'] extends undefined ? never : NonNullable<DeveloperModelSnapshot['conditional']>['lineSurvivalByStartHour']): DeveloperModelSnapshot {
  return { ...BASE, conditional: { lineSurvivalByStartHour: buckets } };
}

describe('survivalByDaypart', () => {
  it('sums the hourly counts into a daypart BEFORE dividing', () => {
    // Three evening hours that each fail the three-commit floor on their own, and
    // clear it comfortably together. Flooring at hour grain would have suppressed
    // every slice a solo developer could ever measure.
    const snap = withSurvival([
      { hour: 19, linesAuthored: 100, linesSurviving: 80, commitsChecked: 1, sessionsRated: 1 },
      { hour: 20, linesAuthored: 100, linesSurviving: 80, commitsChecked: 1, sessionsRated: 1 },
      { hour: 21, linesAuthored: 100, linesSurviving: 80, commitsChecked: 1, sessionsRated: 1 },
    ]);
    const split = survivalByDaypart(snap, UTC);
    expect(split.rated).toEqual([
      { daypart: 'evening', label: 'evening', rate: 0.8, numerator: 240, denominator: 300 },
    ]);
  });

  it('re-buckets onto the reader clock, so the same counts answer differently', () => {
    const snap = withSurvival([
      { hour: 19, linesAuthored: 200, linesSurviving: 180, commitsChecked: 4, sessionsRated: 2 },
    ]);
    expect(survivalByDaypart(snap, UTC).rated[0].daypart).toBe('evening');
    // 19:00 UTC is 11:00 in US-Pacific — morning, not evening.
    expect(survivalByDaypart(snap, PACIFIC).rated[0].daypart).toBe('morning');
  });

  it('leaves a daypart below the commit floor unrated, and NAMES it', () => {
    const snap = withSurvival([
      { hour: 9, linesAuthored: 60, linesSurviving: 10, commitsChecked: 1, sessionsRated: 1 },
      { hour: 20, linesAuthored: 200, linesSurviving: 180, commitsChecked: 5, sessionsRated: 3 },
    ]);
    const split = survivalByDaypart(snap, UTC);
    expect(split.rated.map((r) => r.daypart)).toEqual(['evening']);
    // Named as the reader's label, not the internal id, and carried rather than
    // dropped so a card about the evening is visibly not a claim about mornings.
    expect(split.belowFloor).toEqual(['morning']);
  });

  it('never divides by a zero line count', () => {
    const snap = withSurvival([
      { hour: 20, linesAuthored: 0, linesSurviving: 0, commitsChecked: 9, sessionsRated: 3 },
    ]);
    expect(survivalByDaypart(snap, UTC).rated).toEqual([]);
  });

  it('is honest-empty when the worker projected no conditional cut', () => {
    expect(survivalByDaypart(BASE, UTC)).toEqual({ rated: [], belowFloor: [] });
  });
});

describe('shipByDaypart', () => {
  it('sums shipped over determinable within a daypart', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      conditional: {
        shipByStartHour: [
          { hour: 19, shipped: 3, determinable: 4 },
          { hour: 20, shipped: 2, determinable: 4 },
        ],
      },
    };
    expect(shipByDaypart(snap, UTC).rated).toEqual([
      { daypart: 'evening', label: 'evening', rate: 0.625, numerator: 5, denominator: 8 },
    ]);
  });

  it('leaves a daypart under the session floor unrated', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      conditional: { shipByStartHour: [{ hour: 9, shipped: 2, determinable: 3 }] },
    };
    const split = shipByDaypart(snap, UTC);
    expect(split.rated).toEqual([]);
    expect(split.belowFloor).toEqual(['morning']);
  });
});

describe('standoutDaypart', () => {
  const rate = (daypart: 'morning' | 'evening', r: number) => ({
    daypart,
    label: daypart,
    rate: r,
    numerator: Math.round(r * 100),
    denominator: 100,
  });

  it('names the best daypart when it clears the worst by the spread', () => {
    const best = standoutDaypart({
      rated: [rate('evening', 0.85), rate('morning', 0.6)],
      belowFloor: [],
    });
    expect(best?.daypart).toBe('evening');
  });

  it('stays silent when two dayparts are the same number twice', () => {
    // 4 points apart is not "your evenings are better", and a portrait that says
    // so teaches the reader to distrust the sentences beside it.
    expect(
      standoutDaypart({ rated: [rate('evening', 0.72), rate('morning', 0.68)], belowFloor: [] }),
    ).toBeNull();
  });

  it('stays silent with only one rated daypart, since there is nothing to compare', () => {
    expect(standoutDaypart({ rated: [rate('evening', 0.9)], belowFloor: ['morning'] })).toBeNull();
  });
});

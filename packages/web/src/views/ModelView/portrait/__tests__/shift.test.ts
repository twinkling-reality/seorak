/**
 * Accrual v2 — the change dimension. A snapshot answers "who are you"; only this
 * answers "who have you become", which is the half a portrait needs to carry a
 * why and a when.
 */
import { describe, expect, it } from 'vitest';
import type { DeveloperModelSnapshot } from '@seorak/types';

import { buildPortraitContext } from '../context.js';
import {
  craftShiftProducer,
  focusShiftProducer,
  rhythmShiftProducer,
  trendProducer,
} from '../shift.js';
import type { PortraitProducer } from '../types.js';

const SURVIVAL = {
  rate: null,
  linesAuthored: 0,
  linesSurviving: 0,
  commitsChecked: 0,
  sessionsRated: 0,
  retained: 0,
  overwritten: 0,
  unreachable: 0,
  unknown: 0,
};

const BASE: DeveloperModelSnapshot = {
  scope: { rangeDays: 30, maxRangeDays: 90, repoId: null, generatedAt: '2026-07-01T12:00:00.000Z' },
  focus: { projectFocus: [] },
  outcomes: {
    shipRate: null,
    lineSurvival: SURVIVAL,
    shipped: 0,
    shipDeterminable: 0,
    stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    endReasons: [],
  },
  activity: { hourlyDistribution: [], endReasonsByHour: [] },
  tools: { byTool: [], byModel: [], callStats: { errorRate: null, erroredCalls: 0, callsWithResult: 0 }, verification: [] },
};

/** Evening now; the prior window was mornings. Hours 20 and 21 rather than 19
 *  and 20 so the pair does not straddle a daypart boundary at UTC-8 — it landed
 *  as an exact morning/afternoon tie, which `dominantDaypart` now declines to
 *  name, and the Pacific case below needs a dominant daypart to exist. */
const EVENING_NOW: DeveloperModelSnapshot['activity'] = {
  hourlyDistribution: [
    { dow: 2, hour: 20, sessions: 6 },
    { dow: 3, hour: 21, sessions: 6 },
  ],
  endReasonsByHour: [],
};
const MORNING_BEFORE = [
  { dow: 2, hour: 9, sessions: 5 },
  { dow: 3, hour: 10, sessions: 5 },
];

const UTC = 0;
const PACIFIC = 480;

function textOf(
  producer: PortraitProducer,
  snapshot: DeveloperModelSnapshot,
  offsetMinutes = UTC,
  priorOffsetMinutes = offsetMinutes,
): string {
  const sentence = producer.produce(
    snapshot,
    buildPortraitContext(snapshot, offsetMinutes, priorOffsetMinutes),
  );
  if (!sentence) return '';
  return sentence.segments
    .map((s) => {
      if (s.type === 'text') return s.text;
      if (s.type === 'identityLead') return s.greeting;
      return sentence.insights.find((i) => i.id === s.insightId)?.linkedTerm ?? '??';
    })
    .join('');
}

describe('rhythm shift', () => {
  const shifted: DeveloperModelSnapshot = {
    ...BASE,
    activity: EVENING_NOW,
    accrual: {
      sessions: 10,
      hourlyDistribution: MORNING_BEFORE,
      projectFocus: [],
      lineSurvival: SURVIVAL,
    },
  };

  it('names what you were, next to what you are', () => {
    expect(textOf(rhythmShiftProducer, shifted)).toBe(
      'The month before, you were a morning developer. ',
    );
  });

  it('names the window in words, since no digit may enter the prose', () => {
    expect(textOf(rhythmShiftProducer, { ...shifted, scope: { ...BASE.scope, rangeDays: 7 } })).toContain(
      'The week before',
    );
    expect(textOf(rhythmShiftProducer, { ...shifted, scope: { ...BASE.scope, rangeDays: 90 } })).toContain(
      'The quarter before',
    );
  });

  it('derives BOTH dayparts on the reader clock, so a shift is a real shift', () => {
    // At UTC-8 the "evening" buckets are morning and the "morning" ones are the
    // night before. Both sides move together, so there is still no shift to claim
    // between two dayparts that only differ because one was localized.
    const text = textOf(rhythmShiftProducer, shifted, PACIFIC);
    expect(text).not.toBe('');
    expect(text).not.toContain('morning developer. ');
  });

  it('refuses a move the two windows are too close to support', () => {
    // Both windows led by a bare plurality one session apart is not a change of
    // identity, and the old gate was only "the two leaders are different values".
    const nearTie: DeveloperModelSnapshot = {
      ...shifted,
      activity: {
        hourlyDistribution: [
          { dow: 2, hour: 20, sessions: 4 },
          { dow: 3, hour: 14, sessions: 3 },
        ],
        endReasonsByHour: [],
      },
      accrual: {
        ...shifted.accrual!,
        hourlyDistribution: [
          { dow: 2, hour: 14, sessions: 4 },
          { dow: 3, hour: 20, sessions: 3 },
        ],
      },
    };
    expect(textOf(rhythmShiftProducer, nearTie)).toBe('');
  });

  it('says nothing when the daypart did not move', () => {
    const same: DeveloperModelSnapshot = {
      ...shifted,
      accrual: { ...shifted.accrual!, hourlyDistribution: EVENING_NOW.hourlyDistribution },
    };
    expect(textOf(rhythmShiftProducer, same)).toBe('');
  });

  it('declines when a clock change sits between the two windows', () => {
    // The wire carries (dow, hour) and no date, so both windows are shifted by one
    // offset. Across a daylight-saving transition that is wrong for the prior one:
    // a reader who starts every session at the same local time has their prior
    // buckets land an hour off, and the read announces a move they never made.
    // Unfixable without a date on the wire, so the sentence declines and the
    // ranking falls through to a facet that carries no clock.
    expect(textOf(rhythmShiftProducer, shifted, PACIFIC, PACIFIC - 60)).toBe('');
  });

  it('refuses a prior window too thin to be a baseline', () => {
    const thin: DeveloperModelSnapshot = {
      ...shifted,
      accrual: { ...shifted.accrual!, sessions: 2 },
    };
    expect(textOf(rhythmShiftProducer, thin)).toBe('');
  });

  it('says nothing at all when there is no prior window', () => {
    expect(textOf(rhythmShiftProducer, { ...BASE, activity: EVENING_NOW })).toBe('');
  });
});

describe('only one change is ever spoken', () => {
  it('yields to the rhythm shift when several dimensions moved', () => {
    // Rhythm, focus and work type all moved. A paragraph reporting all three is a
    // diff; the read picks the one that says most about the person.
    const everything: DeveloperModelSnapshot = {
      ...BASE,
      activity: EVENING_NOW,
      focus: { projectFocus: [{ repoId: 'r1', project: 'seorak', sessions: 10, share: 0.8 }] },
      identity: { branchWorkTypeMix: [{ workType: 'feature', sessions: 9 }] },
      accrual: {
        sessions: 10,
        hourlyDistribution: MORNING_BEFORE,
        projectFocus: [{ repoId: 'r2', project: 'feather', sessions: 9, share: 0.9 }],
        branchWorkTypeMix: [{ workType: 'fix', sessions: 8 }],
        lineSurvival: SURVIVAL,
      },
    };
    expect(textOf(rhythmShiftProducer, everything)).toContain('morning developer');
    expect(textOf(focusShiftProducer, everything)).toBe('');
    expect(textOf(craftShiftProducer, everything)).toBe('');
  });

  it('falls to the focus shift when the rhythm held', () => {
    const focusMoved: DeveloperModelSnapshot = {
      ...BASE,
      activity: EVENING_NOW,
      focus: { projectFocus: [{ repoId: 'r1', project: 'seorak', sessions: 10, share: 0.8 }] },
      accrual: {
        sessions: 10,
        hourlyDistribution: EVENING_NOW.hourlyDistribution,
        projectFocus: [{ repoId: 'r2', project: 'feather', sessions: 9, share: 0.9 }],
        lineSurvival: SURVIVAL,
      },
    };
    expect(textOf(rhythmShiftProducer, focusMoved)).toBe('');
    // A COMPLETE sentence. It read "The month before, it was feather", and the
    // shift outranks the focus sentence it leans on, so on a real compile "it" was
    // bound to the rhythm clause.
    expect(textOf(focusShiftProducer, focusMoved)).toBe(
      'The month before, most of your time went to feather. ',
    );
  });

  it('keeps the focus shift quiet on a repo-scoped read', () => {
    const scoped: DeveloperModelSnapshot = {
      ...BASE,
      scope: { ...BASE.scope, repoId: 'r1' },
      focus: { projectFocus: [{ repoId: 'r1', project: 'seorak', sessions: 10, share: 1 }] },
      accrual: {
        sessions: 10,
        hourlyDistribution: [],
        projectFocus: [{ repoId: 'r2', project: 'feather', sessions: 9, share: 1 }],
        lineSurvival: SURVIVAL,
      },
    };
    expect(textOf(focusShiftProducer, scoped)).toBe('');
  });

  it('falls through to the work-type shift last', () => {
    const craftMoved: DeveloperModelSnapshot = {
      ...BASE,
      activity: EVENING_NOW,
      identity: { branchWorkTypeMix: [{ workType: 'feature', sessions: 9 }] },
      accrual: {
        sessions: 10,
        hourlyDistribution: EVENING_NOW.hourlyDistribution,
        projectFocus: [],
        branchWorkTypeMix: [{ workType: 'fix', sessions: 8 }],
        lineSurvival: SURVIVAL,
      },
    };
    expect(textOf(craftShiftProducer, craftMoved)).toBe(
      'The month before, you were mostly fixing what was broken. ',
    );
  });
});

describe('payoff trend', () => {
  /** Real line counts on both legs. `SURVIVAL` authors zero lines, which the
   *  worker never emits alongside a non-null rate, and the trend gate now scales
   *  the required move to the smaller sample — so a zero-line baseline correctly
   *  says nothing at all. */
  const leg = (rate: number | null, linesAuthored: number) => ({
    ...SURVIVAL,
    rate,
    linesAuthored,
    linesSurviving: rate === null ? 0 : Math.round(rate * linesAuthored),
    commitsChecked: rate === null ? 0 : 12,
    sessionsRated: rate === null ? 0 : 10,
  });

  const withRates = (
    now: number | null,
    was: number | null,
    lines = 400,
  ): DeveloperModelSnapshot => ({
    ...BASE,
    outcomes: { ...BASE.outcomes, lineSurvival: leg(now, lines) },
    accrual: {
      sessions: 10,
      hourlyDistribution: [],
      projectFocus: [],
      lineSurvival: leg(was, lines),
    },
  });

  it('speaks a direction, never a delta', () => {
    const text = textOf(trendProducer, withRates(0.84, 0.61));
    expect(text).toBe('It is holding up better than it was. ');
    expect(text).not.toMatch(/\d/);
  });

  it('says the down direction as a fact about the work, not a mark', () => {
    expect(textOf(trendProducer, withRates(0.5, 0.78))).toBe(
      'It is getting changed back more than it was. ',
    );
  });

  it('refuses a baseline too small for the move to mean anything', () => {
    // Three rated commits can touch four lines, and the worker floors commits but
    // never lines — so a 100% four-line baseline used to be enough to tell a
    // reader with a 400-line window that their work was holding up worse.
    expect(textOf(trendProducer, withRates(0.86, 1, 4))).toBe('');
  });

  it('stays silent when the move is inside the noise', () => {
    expect(textOf(trendProducer, withRates(0.72, 0.68))).toBe('');
  });

  it('refuses to compare against a floored null', () => {
    // A null rate is "not enough to say", not zero. Treating it as a baseline
    // would announce an improvement over nothing.
    expect(textOf(trendProducer, withRates(0.84, null))).toBe('');
    expect(textOf(trendProducer, withRates(null, 0.61))).toBe('');
  });
});

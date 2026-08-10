import { describe, expect, it } from 'vitest';
import type { DeveloperModelSnapshot } from '@seorak/types';

import { compileSnapshotToPresentation } from '../compileSnapshotToPresentation.js';

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

// Every rhythm claim is a shift off the worker's UTC buckets, so the reader's
// clock is pinned here rather than inherited from whichever machine runs the
// suite. UTC-0 keeps these fixtures reading as they were written; the non-UTC
// cases below are what the ambient-timezone version could never have tested.
const UTC = 0;

function compile(
  snapshot: DeveloperModelSnapshot,
  displayName = 'Test',
  offsetMinutes = UTC,
) {
  return compileSnapshotToPresentation(snapshot, { displayName, offsetMinutes });
}

function allProse(
  snapshot: DeveloperModelSnapshot,
  displayName = 'Test',
  offsetMinutes = UTC,
): string {
  const p = compile(snapshot, displayName, offsetMinutes);
  return p.prose
    .map((s) => {
      if (s.type === 'text') return s.text;
      if (s.type === 'identityLead') return s.greeting;
      const insight = p.insights.find((i) => i.id === s.insightId);
      return insight?.linkedTerm ?? '';
    })
    .join('');
}

describe('compileSnapshotToPresentation', () => {
  it('honest-empty when thin window', () => {
    const p = compile(BASE);
    expect(p.forming).not.toBeNull();
    expect(p.prose[0]).toEqual({ type: 'identityLead', displayName: 'Test', greeting: 'Test, ' });
    expect(p.insights.length).toBe(5);
    expect(p.prose.length).toBeGreaterThan(0);
    expect(p.insights.every((i) => i.id.startsWith('forming-'))).toBe(true);
  });

  it('no digits in hero prose for rich snapshot', () => {
    const snapshot: DeveloperModelSnapshot = {
      ...BASE,
      focus: {
        projectFocus: [{ repoId: 'abc', project: 'cleanerchat', sessions: 18, share: 0.75 }],
      },
      activity: {
        hourlyDistribution: [
          { dow: 2, hour: 20, sessions: 5 },
          { dow: 3, hour: 21, sessions: 6 },
          { dow: 1, hour: 9, sessions: 1 },
        ],
        endReasonsByHour: [],
      },
      outcomes: {
        ...BASE.outcomes,
        endReasons: [{ reason: 'clear', count: 12 }],
        lineSurvival: { ...BASE.outcomes.lineSurvival, rate: 0.72, sessionsRated: 4 },
        stuckness: { rate: 0.1, stuckCount: 1, inFlight: 10, stuckSessionIds: ['s1'] },
      },
    };
    const text = allProse(snapshot);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/%/);
  });

  it('orders rhythm before payoff', () => {
    const snapshot: DeveloperModelSnapshot = {
      ...BASE,
      focus: {
        projectFocus: [{ repoId: 'abc', project: 'cleanerchat', sessions: 10, share: 1 }],
      },
      activity: {
        hourlyDistribution: [
          { dow: 2, hour: 20, sessions: 8 },
          { dow: 3, hour: 21, sessions: 7 },
        ],
        endReasonsByHour: [],
      },
      outcomes: {
        ...BASE.outcomes,
        endReasons: [{ reason: 'clear', count: 5 }],
        lineSurvival: { ...BASE.outcomes.lineSurvival, rate: 0.8, sessionsRated: 3 },
      },
    };
    const p = compile(snapshot);
    const joined = allProse(snapshot);
    const eveningIdx = joined.indexOf('evening');
    const stickIdx = joined.indexOf('stayed in the codebase');
    expect(eveningIdx).toBeGreaterThanOrEqual(0);
    expect(stickIdx).toBeGreaterThan(eveningIdx);
    expect(p.insights.some((i) => i.facet === 'rhythm')).toBe(true);
    expect(p.insights.some((i) => i.facet === 'payoff')).toBe(true);
  });

  it('every insight segment resolves', () => {
    const snapshot: DeveloperModelSnapshot = {
      ...BASE,
      focus: {
        projectFocus: [{ repoId: 'abc', project: 'seorak', sessions: 4, share: 1 }],
      },
      activity: {
        hourlyDistribution: [{ dow: 4, hour: 19, sessions: 4 }],
        endReasonsByHour: [],
      },
      outcomes: {
        ...BASE.outcomes,
        endReasons: [{ reason: 'clear', count: 3 }],
      },
    };
    const p = compile(snapshot);
    for (const segment of p.prose) {
      if (segment.type === 'insight') {
        expect(p.insights.find((i) => i.id === segment.insightId)).toBeDefined();
      }
    }
  });

  it('compiles without an injected clock, on the reader’s own', () => {
    // The offset defaults to the ambient timezone for the app; only tests pin it.
    // This is the one case that exercises that path, so it must not throw.
    const p = compileSnapshotToPresentation(
      { ...BASE, scope: { ...BASE.scope, rangeDays: 7 } },
      { displayName: 'Test' },
    );
    expect(p.forming).not.toBeNull();
  });

  it('prepends inline identity lead when handle is set', () => {
    const p = compile(BASE, 'Glendon');
    expect(p.prose[0]).toEqual({ type: 'identityLead', displayName: 'Glendon', greeting: 'Glendon, ' });
    expect(p.prose[1]).toEqual({
      type: 'text',
      text: 'run your first agent sessions and this read starts filling in: ',
    });
  });

  it('prepends squircle-only lead when handle is default', () => {
    const p = compile(BASE, 'You');
    expect(p.prose[0]).toEqual({ type: 'identityLead', displayName: null, greeting: 'Hey, ' });
    expect(p.prose[1]).toEqual({
      type: 'text',
      text: 'run your first agent sessions and this read starts filling in: ',
    });
  });

  it('lowercases live portrait opener after inline identity lead', () => {
    const snapshot: DeveloperModelSnapshot = {
      ...BASE,
      focus: {
        projectFocus: [{ repoId: 'abc', project: 'cleanerchat', sessions: 10, share: 1 }],
      },
      activity: {
        hourlyDistribution: [
          { dow: 2, hour: 20, sessions: 8 },
          { dow: 3, hour: 21, sessions: 7 },
        ],
        endReasonsByHour: [],
      },
      outcomes: {
        ...BASE.outcomes,
        endReasons: [{ reason: 'clear', count: 5 }],
      },
    };
    const joined = allProse(snapshot, 'Glendon');
    expect(joined.startsWith('Glendon, lately')).toBe(true);
  });
});

// The worker buckets session starts in UTC and cannot know where the reader is.
// The compiler used to read those buckets as if they were the reader's own clock,
// which made the page's opening sentence — the one the whole portrait is built
// around — wrong for every developer off UTC.
describe('rhythm reads the developer clock, not UTC', () => {
  /** Tue and Wed 05:00 UTC. On the US west coast that is Mon and Tue at 21:00. */
  const LATE_EVENING_PACIFIC: DeveloperModelSnapshot = {
    ...BASE,
    activity: {
      hourlyDistribution: [
        { dow: 2, hour: 5, sessions: 4 },
        { dow: 3, hour: 5, sessions: 4 },
      ],
      endReasonsByHour: [],
    },
  };
  const PACIFIC = 480; // Date.getTimezoneOffset() for UTC-8

  it('calls a UTC-0 reader working at 05:00 a morning developer', () => {
    const text = allProse(LATE_EVENING_PACIFIC, 'Test', UTC);
    expect(text).toContain('morning developer');
    expect(text).toContain('Tuesdays and Wednesdays');
  });

  it('calls the SAME buckets an evening developer for a UTC-8 reader', () => {
    const text = allProse(LATE_EVENING_PACIFIC, 'Test', PACIFIC);
    expect(text).toContain('evening developer');
    expect(text).not.toContain('morning developer');
  });

  it('moves the steadiest weekdays with the shift, because the day moves too', () => {
    // 05:00 UTC Tuesday is Monday evening in Pacific. Naming Tuesdays would be
    // naming a day the developer was asleep for.
    const text = allProse(LATE_EVENING_PACIFIC, 'Test', PACIFIC);
    expect(text).toContain('Mondays and Tuesdays');
    expect(text).not.toContain('Wednesdays');
  });

  it('can name an afternoon developer, which the two-band read could never say', () => {
    // Old bands were evening 18-23 and morning 5-11, so an afternoon or night
    // developer matched neither and the rhythm sentence simply vanished.
    const afternoon: DeveloperModelSnapshot = {
      ...BASE,
      activity: {
        hourlyDistribution: [
          { dow: 1, hour: 14, sessions: 5 },
          { dow: 2, hour: 15, sessions: 4 },
        ],
        endReasonsByHour: [],
      },
    };
    expect(allProse(afternoon, 'Test', UTC)).toContain('an afternoon developer');
  });

  it('picks the article from the daypart it is about to name', () => {
    const night: DeveloperModelSnapshot = {
      ...BASE,
      activity: {
        hourlyDistribution: [{ dow: 1, hour: 23, sessions: 5 }],
        endReasonsByHour: [],
      },
    };
    expect(allProse(night, 'Test', UTC)).toContain('a night developer');
  });

  it('closes the daypart sentence when there are no steady days to continue into', () => {
    // One weekday cannot be "steadiest", so this sentence used to end on the
    // insight itself and the focus sentence ran straight into it.
    const single: DeveloperModelSnapshot = {
      ...BASE,
      focus: { projectFocus: [{ repoId: 'abc', project: 'seorak', sessions: 4, share: 1 }] },
      activity: {
        hourlyDistribution: [{ dow: 4, hour: 19, sessions: 4 }],
        endReasonsByHour: [],
      },
    };
    const text = allProse(single, 'Test', UTC);
    expect(text).toContain('evening developer. ');
    expect(text).not.toContain('developerMost');
  });

  it('stays silent rather than naming a daypart no part of the week supports', () => {
    const scattered: DeveloperModelSnapshot = {
      ...BASE,
      focus: { projectFocus: [{ repoId: 'abc', project: 'seorak', sessions: 4, share: 1 }] },
      activity: {
        hourlyDistribution: [
          { dow: 1, hour: 8, sessions: 1 },
          { dow: 2, hour: 14, sessions: 1 },
          { dow: 3, hour: 19, sessions: 1 },
          { dow: 4, hour: 23, sessions: 1 },
        ],
        endReasonsByHour: [],
      },
    };
    const p = compile(scattered);
    // A live portrait (focus carries it), with no rhythm claim in it at all.
    expect(p.forming).toBeNull();
    expect(p.insights.some((i) => i.facet === 'rhythm')).toBe(false);
    expect(allProse(scattered, 'Test', UTC)).not.toContain('developer');
  });
});

import { describe, expect, it } from 'vitest';

import { createEmptyDeveloperModel } from '../../lib/schemas/developer-model.js';
import type { PeriodComparison } from './compilePeriodComparison.js';
import { compileCompareNarrative } from './compileCompareNarrative.js';

function period(): PeriodComparison {
  return {
    scope: { kind: 'all-work', label: 'All work', repoId: null },
    rangeDays: 30,
    currentWindowLabel: 'Last 30 days',
    previousWindowLabel: 'Prior 30 days',
    evidence: [
      {
        id: 'sessions',
        label: 'Sessions',
        current: { raw: 157, text: '157' },
        previous: { raw: 118, text: '118' },
        difference: { raw: 39, text: '+39' },
        note: 'Counts captured session starts in adjacent equal windows.',
      },
      {
        id: 'cost',
        label: 'Measured cost',
        current: { raw: 290.09, text: '$290.09' },
        previous: { raw: 237.87, text: '$237.87' },
        difference: { raw: 52.22, text: '+$52.22' },
        note: 'Compares priced captured cost in adjacent equal windows.',
      },
      {
        id: 'lines-added',
        label: 'Captured lines added',
        current: { raw: 8309, text: '8,309' },
        previous: { raw: 6481, text: '6,481' },
        difference: { raw: 1828, text: '+1,828' },
        note: 'Counts lines added by captured edit calls, not git net change.',
      },
    ],
    narrative: [],
  };
}

function plainText(presentation: ReturnType<typeof compileCompareNarrative>): string {
  const byId = Object.fromEntries(presentation.insights.map((item) => [item.id, item]));
  return presentation.prose
    .map((segment) =>
      segment.type === 'text'
        ? segment.text
        : segment.type === 'insight'
          ? byId[segment.insightId]?.linkedTerm ?? ''
          : segment.greeting,
    )
    .join('');
}

describe('compileCompareNarrative', () => {
  it('turns exact adjacent legs into annotated claims instead of a raw metric dump', () => {
    const presentation = compileCompareNarrative(period(), null, { offsetMinutes: 0 });

    expect(plainText(presentation)).toBe(
      'Compared with the prior 30 days, session activity grew, captured editing expanded and measured cost rose.',
    );
    expect(presentation.insights.map((item) => [item.id, item.facet])).toEqual([
      ['compare-sessions', 'volume'],
      ['compare-lines-added', 'shape'],
      ['compare-cost', 'cost'],
    ]);
    expect(presentation.insights[0]?.squircle.citations.map((item) => item.text)).toEqual([
      'Last 30 days: 157',
      'Prior 30 days: 118',
      'Change: +39',
    ]);
  });

  it('adds one identity shift and a real outcome trend from model accrual', () => {
    const model = createEmptyDeveloperModel(30);
    model.activity.hourlyDistribution = [{ dow: 2, hour: 20, sessions: 8 }];
    model.outcomes.lineSurvival = {
      rate: 0.82,
      linesAuthored: 200,
      linesSurviving: 164,
      commitsChecked: 4,
      sessionsRated: 4,
      retained: 3,
      overwritten: 1,
      unreachable: 0,
      unknown: 0,
    };
    model.accrual = {
      sessions: 6,
      hourlyDistribution: [{ dow: 2, hour: 9, sessions: 6 }],
      projectFocus: [],
      lineSurvival: {
        rate: 0.6,
        linesAuthored: 150,
        linesSurviving: 90,
        commitsChecked: 4,
        sessionsRated: 4,
        retained: 2,
        overwritten: 2,
        unreachable: 0,
        unknown: 0,
      },
    };

    const presentation = compileCompareNarrative(period(), model, { offsetMinutes: 0 });
    const copy = plainText(presentation);

    expect(copy).toContain('Your workday moved from morning into evening.');
    expect(copy).toContain(
      'More of your landed work stayed in the code than in the period before.',
    );
    expect(presentation.insights.map((item) => item.id)).toEqual([
      'compare-rhythm',
      'compare-sessions',
      'compare-lines-added',
      'compare-cost',
      'compare-survival',
    ]);
  });

  it('stays honestly empty when neither contract has a prior leg', () => {
    const empty = period();
    empty.evidence = [];
    empty.narrative = [
      {
        role: 'lead',
        text: 'No prior 30-day window has been measured for all work yet.',
      },
    ];

    const presentation = compileCompareNarrative(empty, createEmptyDeveloperModel(30), {
      offsetMinutes: 0,
    });

    expect(plainText(presentation)).toBe(
      'No prior 30-day window has been measured for all work yet.',
    );
    expect(presentation.insights).toEqual([]);
  });
});

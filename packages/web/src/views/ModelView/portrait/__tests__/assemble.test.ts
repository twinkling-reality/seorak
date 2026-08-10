import { describe, expect, it } from 'vitest';
import type { DeveloperModelSnapshot } from '@seorak/types';

import { assemblePortrait } from '../assemble.js';
import { buildPortraitContext } from '../context.js';
import type { PortraitProducer } from '../types.js';

const SNAPSHOT: DeveloperModelSnapshot = {
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

const CTX = buildPortraitContext(SNAPSHOT, 0);

function textOf(segments: ReturnType<typeof assemblePortrait>['prose']): string {
  return segments.map((s) => (s.type === 'text' ? s.text : `<${s.type}>`)).join('');
}

function stub(
  id: string,
  paragraph: 'identity' | 'payoff',
  text: string,
  leadText?: string,
  weight = 1,
  notability = 1,
): PortraitProducer {
  return {
    id,
    paragraph,
    weight,
    produce: () => ({
      notability,
      insights: [],
      segments: [{ type: 'text', text }],
      ...(leadText ? { leadSegments: [{ type: 'text', text: leadText }] } : {}),
    }),
  };
}

const silent: PortraitProducer = {
  id: 'silent',
  paragraph: 'identity',
  weight: 1,
  produce: () => null,
};

describe('assemblePortrait', () => {
  it('joins sentences in registry order', () => {
    const out = assemblePortrait(SNAPSHOT, CTX, [
      stub('a', 'identity', 'One. '),
      stub('b', 'identity', 'Two. '),
    ]);
    expect(textOf(out.prose)).toBe('One. Two. ');
  });

  it('uses the lead form only for the sentence that OPENS a paragraph', () => {
    const out = assemblePortrait(SNAPSHOT, CTX, [
      stub('a', 'identity', 'Follow A. ', 'Lead A. '),
      stub('b', 'identity', 'Follow B. ', 'Lead B. '),
    ]);
    expect(textOf(out.prose)).toBe('Lead A. Follow B. ');
  });

  it('promotes the next sentence to lead when the first producer stays silent', () => {
    // The whole reason the lead form is the assembler's call and not a producer's:
    // a producer cannot know whether the one before it had anything to say.
    const out = assemblePortrait(SNAPSHOT, CTX, [
      silent,
      stub('b', 'identity', 'Follow B. ', 'Lead B. '),
    ]);
    expect(textOf(out.prose)).toBe('Lead B. ');
  });

  it('leads each paragraph independently', () => {
    const out = assemblePortrait(SNAPSHOT, CTX, [
      stub('a', 'identity', 'Follow A. ', 'Lead A. '),
      stub('p', 'payoff', 'Follow P. ', 'Lead P. '),
    ]);
    expect(textOf(out.prose)).toBe('Lead A. \n\nLead P. ');
  });

  it('emits no paragraph break when only the payoff paragraph has sentences', () => {
    const out = assemblePortrait(SNAPSHOT, CTX, [silent, stub('p', 'payoff', 'Only payoff. ')]);
    expect(textOf(out.prose)).toBe('Only payoff. ');
  });

  it('returns nothing at all when every producer is silent (honest-empty)', () => {
    const out = assemblePortrait(SNAPSHOT, CTX, [silent]);
    expect(out.prose).toEqual([]);
    expect(out.insights).toEqual([]);
  });

  it('collects insights from every producer that spoke', () => {
    const withInsight: PortraitProducer = {
      id: 'i',
      paragraph: 'identity',
      weight: 1,
      produce: () => ({
        insights: [
          {
            id: 'x',
            facet: 'rhythm',
            linkedTerm: 'term',
            label: 'When you work',
            hoverLines: [],
            squircle: { citations: [] },
          },
        ],
        segments: [{ type: 'text', text: 'S. ' }],
      }),
    };
    const out = assemblePortrait(SNAPSHOT, CTX, [withInsight, silent]);
    expect(out.insights.map((i) => i.id)).toEqual(['x']);
  });
});

describe('ranking and the cut', () => {
  it('keeps only the strongest sentences a paragraph is allowed', () => {
    // Five identity candidates, three slots. The cut is by weight x notability.
    const out = assemblePortrait(SNAPSHOT, CTX, [
      stub('a', 'identity', 'A. ', undefined, 0.2, 0.2),
      stub('b', 'identity', 'B. ', undefined, 1, 1),
      stub('c', 'identity', 'C. ', undefined, 0.1, 0.1),
      stub('d', 'identity', 'D. ', undefined, 0.9, 0.9),
      stub('e', 'identity', 'E. ', undefined, 0.8, 0.8),
    ]);
    expect(textOf(out.prose)).toBe('B. D. E. ');
  });

  it('puts the survivors back into registry order rather than score order', () => {
    // Registry order is the editorial decision; ranking only picks who is in the
    // room. The weakest of the three kept still reads first if it comes first.
    const out = assemblePortrait(SNAPSHOT, CTX, [
      stub('first', 'identity', 'First. ', undefined, 0.6, 0.6),
      stub('loud', 'identity', 'Loud. ', undefined, 1, 1),
    ]);
    expect(textOf(out.prose)).toBe('First. Loud. ');
  });

  it('drops the insights of a sentence it cut, so no card is left unreachable', () => {
    const withInsight = (id: string, weight: number): PortraitProducer => ({
      id,
      paragraph: 'identity',
      weight,
      produce: () => ({
        notability: 1,
        insights: [
          {
            id: `insight-${id}`,
            facet: 'rhythm' as const,
            linkedTerm: id,
            label: id,
            hoverLines: [],
            squircle: { citations: [] },
          },
        ],
        segments: [{ type: 'text' as const, text: `${id}. ` }],
      }),
    });
    const out = assemblePortrait(SNAPSHOT, CTX, [
      withInsight('a', 1),
      withInsight('b', 0.9),
      withInsight('c', 0.8),
      withInsight('d', 0.1),
    ]);
    expect(out.insights.map((i) => i.id)).toEqual(['insight-a', 'insight-b', 'insight-c']);
  });
});

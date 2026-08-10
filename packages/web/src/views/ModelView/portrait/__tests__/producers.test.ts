/**
 * Every facet that ships in the snapshot has a producer, and every producer is
 * silent until the window supports it. These pin both halves — the render, and
 * the refusal to render.
 */
import { describe, expect, it } from 'vitest';
import type { DeveloperModelSnapshot } from '@seorak/types';

import { buildPortraitContext } from '../context.js';
import { craftProducer } from '../craft.js';
import { rhythmProducer } from '../rhythm.js';
import { focusProducer } from '../focus.js';
import { habitsProducer } from '../habits.js';
import { daypartPayoffProducer, frictionProducer } from '../payoff.js';
import { stackProducer } from '../stack.js';
import type { PortraitProducer } from '../types.js';

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

function run(producer: PortraitProducer, snapshot: DeveloperModelSnapshot) {
  return producer.produce(snapshot, buildPortraitContext(snapshot, UTC));
}

function textOf(producer: PortraitProducer, snapshot: DeveloperModelSnapshot): string {
  const sentence = run(producer, snapshot);
  if (!sentence) return '';
  return sentence.segments
    .map((s) => {
      if (s.type === 'text') return s.text;
      if (s.type === 'identityLead') return s.greeting;
      return sentence.insights.find((i) => i.id === s.insightId)?.linkedTerm ?? '??';
    })
    .join('');
}

describe('focus producer', () => {
  const focused: DeveloperModelSnapshot = {
    ...BASE,
    focus: { projectFocus: [{ repoId: 'r1', project: 'seorak', sessions: 12, share: 1 }] },
  };

  it('names the leading project on the merged portrait', () => {
    // Two tracked projects, so "most" is a real comparison rather than the only
    // option wearing a hedge.
    const twoProjects: DeveloperModelSnapshot = {
      ...BASE,
      focus: {
        projectFocus: [
          { repoId: 'r1', project: 'seorak', sessions: 12, share: 0.75 },
          { repoId: 'r2', project: 'feather', sessions: 4, share: 0.25 },
        ],
      },
    };
    expect(textOf(focusProducer, twoProjects)).toBe('Most of your time went to seorak. ');
  });

  it('says ALL of it when there is only one tracked project', () => {
    // With one project the share is 1 by construction, and "most of your time"
    // quietly implies some of it went somewhere else.
    expect(textOf(focusProducer, focused)).toBe('All of it went to seorak. ');
  });

  it('goes SILENT once the read is scoped to one repo', () => {
    // A scoped snapshot carries one project at 100% share, so this sentence would
    // report back the choice the reader just made as if the data had found it.
    const scoped: DeveloperModelSnapshot = {
      ...focused,
      scope: { ...BASE.scope, repoId: 'r1' },
    };
    expect(run(focusProducer, scoped)).toBeNull();
  });
});

describe('stack producer (language + model)', () => {
  it('names the model the work ran on beside the language', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      identity: { fileLanguageMix: [{ language: 'rust', calls: 90 }] },
      tools: {
        ...BASE.tools,
        byModel: [
          { model: 'claude-opus-4-8', calls: 60, tokensTotal: 1000, costUsd: 1 },
          { model: 'claude-haiku-4-5', calls: 20, tokensTotal: 200, costUsd: 0.1 },
        ],
      },
    };
    expect(textOf(stackProducer, snap)).toContain('Rust');
    expect(textOf(stackProducer, snap)).toMatch(/with Claude Opus/);
  });

  it('drops the model clause when no model leads by enough to name alone', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      identity: { fileLanguageMix: [{ language: 'rust', calls: 90 }] },
      tools: {
        ...BASE.tools,
        byModel: [
          { model: 'claude-opus-4-8', calls: 30, tokensTotal: 1, costUsd: null },
          { model: 'claude-sonnet-4-6', calls: 30, tokensTotal: 1, costUsd: null },
        ],
      },
    };
    expect(textOf(stackProducer, snap)).toBe('You worked mostly in Rust. ');
  });

  it('is silent when neither language nor model was measured', () => {
    expect(run(stackProducer, BASE)).toBeNull();
  });

  it('says "mostly" only when the leading language is an actual majority', () => {
    const majority: DeveloperModelSnapshot = {
      ...BASE,
      identity: {
        fileLanguageMix: [
          { language: 'typescript', calls: 70 },
          { language: 'css', calls: 30 },
        ],
      },
    };
    const plurality: DeveloperModelSnapshot = {
      ...BASE,
      identity: {
        fileLanguageMix: [
          { language: 'typescript', calls: 40 },
          { language: 'rust', calls: 35 },
          { language: 'css', calls: 25 },
        ],
      },
    };
    expect(textOf(stackProducer, majority)).toBe('You worked mostly in TypeScript. ');
    // 40% is what you reached for most often, and is not most of anything.
    expect(textOf(stackProducer, plurality)).toBe('You worked most often in TypeScript. ');
  });
});

describe('craft producer (work type + tools)', () => {
  // The demo fixture keeps `other` as a plurality so the sentence still renders
  // for a buyer, so the DOMINANT-`other` case — which is the normal shape for
  // anyone who commits on a trunk branch, this product's own buyer included —
  // lives here instead.
  it('goes silent rather than naming the unclassified bucket as a work type', () => {
    const trunk: DeveloperModelSnapshot = {
      ...BASE,
      identity: {
        branchWorkTypeMix: [
          { workType: 'other', sessions: 41 },
          { workType: 'feature', sessions: 6 },
        ],
      },
    };
    expect(run(craftProducer, trunk)).toBeNull();
  });

  it('excludes the unnamed-call bucket from the tools it names AND its denominator', () => {
    const withOther: DeveloperModelSnapshot = {
      ...BASE,
      tools: {
        ...BASE.tools,
        byTool: [
          { tool: 'other', calls: 300, sessions: 8 },
          { tool: 'Bash', calls: 200, sessions: 8 },
          { tool: 'Read', calls: 100, sessions: 8 },
        ],
      } as DeveloperModelSnapshot['tools'],
    };
    const sentence = run(craftProducer, withOther)!;
    const tools = sentence.insights.find((i) => i.id === 'tool-mix')!;
    // Named, not "Bash and Other" — and 300 of 300, not 300 of 600.
    expect(tools.linkedTerm).toBe('running commands and reading');
    expect(tools.squircle.citations[0].text).toContain('300 of 300 named tool calls');
  });

  const RICH: DeveloperModelSnapshot = {
    ...BASE,
    identity: {
      branchWorkTypeMix: [
        { workType: 'feature', sessions: 9 },
        { workType: 'fix', sessions: 3 },
      ],
    },
    tools: {
      ...BASE.tools,
      byTool: [
        { tool: 'Edit', calls: 40, sessions: 8 },
        { tool: 'Bash', calls: 30, sessions: 8 },
        { tool: 'Read', calls: 20, sessions: 8 },
      ],
      callStats: { errorRate: 0.05, erroredCalls: 25, callsWithResult: 500 },
    },
  };

  it('renders the branch work type and the tools it ran through', () => {
    // Neither "branches" nor "run through Edit and Bash" means anything outside
    // this codebase. The measurement is the same; the sentence is now readable.
    expect(textOf(craftProducer, RICH)).toBe(
      'You were mostly building new things, and spent more of it editing and running commands than anything else. ',
    );
  });

  it('keeps the error rate as a citation, not a term of its own', () => {
    const sentence = run(craftProducer, RICH)!;
    expect(sentence.insights.map((i) => i.id)).toEqual(['work-type', 'tool-mix']);
    const tools = sentence.insights.find((i) => i.id === 'tool-mix')!;
    expect(tools.squircle.citations.some((c) => c.text.includes('came back an error'))).toBe(true);
  });

  it('omits the error citation entirely when no call returned an honest flag', () => {
    const noFlag = { ...RICH, tools: { ...RICH.tools, callStats: { errorRate: null, erroredCalls: 0, callsWithResult: 0 } } };
    const tools = run(craftProducer, noFlag)!.insights.find((i) => i.id === 'tool-mix')!;
    expect(tools.squircle.citations.some((c) => c.text.includes('error'))).toBe(false);
  });

  it('names an unfamiliar work type as itself rather than dropping the sentence', () => {
    const odd: DeveloperModelSnapshot = {
      ...BASE,
      identity: { branchWorkTypeMix: [{ workType: 'spike', sessions: 8 }] },
    };
    expect(textOf(craftProducer, odd)).toContain('spike work');
  });

  it('leans rather than claims "mostly" when the top work type is a plurality', () => {
    const plurality: DeveloperModelSnapshot = {
      ...BASE,
      identity: {
        branchWorkTypeMix: [
          { workType: 'feature', sessions: 5 },
          { workType: 'fix', sessions: 4 },
          { workType: 'chore', sessions: 3 },
        ],
      },
    };
    expect(textOf(craftProducer, plurality)).toBe('You leaned toward building new things. ');
  });

  it('is silent when the branch mix is too thin to be a habit', () => {
    const thin: DeveloperModelSnapshot = {
      ...BASE,
      identity: { branchWorkTypeMix: [{ workType: 'feature', sessions: 2 }] },
    };
    expect(run(craftProducer, thin)).toBeNull();
  });
});

describe('habits producer (verification + how sessions end)', () => {
  it('joins the check and the ending into one sentence', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      outcomes: { ...BASE.outcomes, endReasons: [{ reason: 'clear', count: 9 }] },
      tools: { ...BASE.tools, verification: [{ kind: 'test', runs: 12, passed: 10 }] },
    };
    // "often", not "usually": this fixture carries no hour buckets, so there is no
    // session count to divide twelve runs by. The weaker adverb is what an
    // unmeasurable frequency gets.
    expect(textOf(habitsProducer, snap)).toBe(
      'You often run the tests, then close the chat when you’re done. ',
    );
  });

  it('cites runs and NEVER a pass count, because passing is not an identity', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      tools: { ...BASE.tools, verification: [{ kind: 'test', runs: 12, passed: 10 }] },
    };
    const verification = run(habitsProducer, snap)!.insights.find((i) => i.id === 'verification')!;
    expect(verification.squircle.citations[0].text).toBe('12 test runs in this window');
    const joined = verification.squircle.citations.map((c) => c.text).join(' ');
    expect(joined).not.toContain('passed');
    expect(joined).not.toContain('%');
  });

  it('falls back to the ending alone when verification is too thin', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      outcomes: { ...BASE.outcomes, endReasons: [{ reason: 'resume', count: 4 }] },
      tools: { ...BASE.tools, verification: [{ kind: 'test', runs: 2, passed: 2 }] },
    };
    expect(textOf(habitsProducer, snap)).toBe(
      'You usually pick a session back up when you’re done. ',
    );
  });
});

describe('daypart payoff producer', () => {
  const survivalEveningWins = [
    { hour: 19, linesAuthored: 300, linesSurviving: 270, commitsChecked: 6, sessionsRated: 4 },
    { hour: 9, linesAuthored: 300, linesSurviving: 150, commitsChecked: 6, sessionsRated: 4 },
  ];

  it('says it ONCE when both cuts point at the same daypart', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      conditional: {
        lineSurvivalByStartHour: survivalEveningWins,
        shipByStartHour: [
          { hour: 19, shipped: 8, determinable: 9 },
          { hour: 9, shipped: 2, determinable: 9 },
        ],
      },
    };
    // No rhythm daypart in this fixture (no hour buckets), so there is nothing to
    // contrast WITH and the sentence carries no contrast marker. "though" here
    // used to punctuate the sentence as a correction of a rhythm claim the reader
    // had never been given.
    expect(textOf(daypartPayoffProducer, snap)).toBe(
      'It was the evening that went best, lasting longest and shipping most often. ',
    );
  });

  it('marks the contrast only when the rhythm sentence named a DIFFERENT daypart', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      // Morning developer, but the evening is what lasted — the gap is the most
      // useful thing the page can say, and "though" is what marks it.
      activity: {
        hourlyDistribution: [
          { dow: 2, hour: 9, sessions: 6 },
          { dow: 3, hour: 10, sessions: 6 },
        ],
        endReasonsByHour: [],
      },
      conditional: {
        lineSurvivalByStartHour: survivalEveningWins,
        shipByStartHour: [
          { hour: 19, shipped: 8, determinable: 9 },
          { hour: 9, shipped: 2, determinable: 9 },
        ],
      },
    };
    expect(textOf(daypartPayoffProducer, snap)).toBe(
      'It was the evening that went best, though, lasting longest and shipping most often. ',
    );
  });

  it('keeps the shipping counts reachable when both cuts name one daypart', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      conditional: {
        lineSurvivalByStartHour: survivalEveningWins,
        shipByStartHour: [
          { hour: 19, shipped: 8, determinable: 9 },
          { hour: 9, shipped: 2, determinable: 9 },
        ],
      },
    };
    const sentence = run(daypartPayoffProducer, snap)!;
    // ONE insight, because the sentence names one term. A second insight with no
    // segment referencing it can never be opened, so its evidence was unreachable
    // while the prose still made the claim.
    expect(sentence.insights.map((i) => i.id)).toEqual(['survival-daypart']);
    expect(sentence.insights[0].squircle.citations.map((c) => c.text)).toContain(
      '89%, 8 of 9 evening sessions landed a commit',
    );
  });

  it('ties the payoff back to the rhythm when they agree', () => {
    // The read has just called this developer an evening developer. Saying "your
    // evening work went best" as if that were a separate discovery is what made
    // the portrait read as a list of unrelated facts.
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      activity: {
        hourlyDistribution: [
          { dow: 2, hour: 19, sessions: 6 },
          { dow: 3, hour: 20, sessions: 6 },
        ],
        endReasonsByHour: [],
      },
      conditional: {
        lineSurvivalByStartHour: survivalEveningWins,
        shipByStartHour: [
          { hour: 19, shipped: 8, determinable: 9 },
          { hour: 9, shipped: 2, determinable: 9 },
        ],
      },
    };
    expect(textOf(daypartPayoffProducer, snap)).toBe(
      'It went best in the evening too, where the work lasted longest and shipped most often. ',
    );
  });

  it('marks the tension when the best daypart is NOT the one you work in', () => {
    // The single most useful thing this page can say, and it was unsayable while
    // each producer only knew its own half.
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      activity: {
        hourlyDistribution: [
          { dow: 2, hour: 19, sessions: 6 },
          { dow: 3, hour: 20, sessions: 6 },
        ],
        endReasonsByHour: [],
      },
      conditional: {
        lineSurvivalByStartHour: [
          { hour: 9, linesAuthored: 300, linesSurviving: 270, commitsChecked: 6, sessionsRated: 4 },
          { hour: 19, linesAuthored: 300, linesSurviving: 150, commitsChecked: 6, sessionsRated: 4 },
        ],
        shipByStartHour: [
          { hour: 9, shipped: 8, determinable: 9 },
          { hour: 19, shipped: 2, determinable: 9 },
        ],
      },
    };
    const text = textOf(daypartPayoffProducer, snap);
    expect(text).toBe(
      'It was the morning that went best, though, lasting longest and shipping most often. ',
    );
    expect(text).toContain('though');
  });

  it('contrasts them when the two measurements disagree', () => {
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      conditional: {
        lineSurvivalByStartHour: survivalEveningWins,
        shipByStartHour: [
          { hour: 9, shipped: 8, determinable: 9 },
          { hour: 19, shipped: 2, determinable: 9 },
        ],
      },
    };
    // No rhythm claim in this fixture, so no contrast marker; the two cuts still
    // disagree with each other and the sentence still says both.
    expect(textOf(daypartPayoffProducer, snap)).toBe(
      'Your evening work lasted longest, and your morning sessions shipped most often. ',
    );
  });

  it('is silent when the worker projected no conditional cut at all', () => {
    expect(run(daypartPayoffProducer, BASE)).toBeNull();
  });
});

describe('friction producer', () => {
  it('is silent with nothing open, because the one-shot half is gone', () => {
    // The producer used to carry "most of your sessions ran without doubling
    // back" off `outcomes.oneShotRate`, gated above 50%. A session counts as
    // one-shot only when the run-length-encoded stream of its tool names visits
    // each tool at most once, so an agent that reads, edits and reads again has
    // already failed it — and on the owner's live log the rate is 1.8% at 7 days,
    // 2.3% at 30 and 1.7% at 90. The sentence was unreachable by a factor of
    // twenty-five, and the field is off the contract with the D1 read that fed it.
    expect(run(frictionProducer, BASE)).toBeNull();
  });

  it('makes NO claim about when a stuck session started', () => {
    // The old copy asserted "late sessions were more likely to loop" off a bare
    // count. Nothing in the snapshot measures when a stuck session began.
    const snap: DeveloperModelSnapshot = {
      ...BASE,
      outcomes: {
        ...BASE.outcomes,
        stuckness: { rate: 0.2, stuckCount: 2, inFlight: 10, stuckSessionIds: ['a', 'b'] },
      },
    };
    const text = textOf(frictionProducer, snap);
    // "loop" was the wrong word: `stuckCount` counts sessions that have not ended
    // and have sent nothing for five minutes, which is SILENCE — the session may
    // be waiting on one long tool call. The paragraph already spends "loop" on the
    // one thing it does measure as looping.
    expect(text).toBe('Some sessions have gone quiet right now. ');
    expect(text).not.toMatch(/late|evening|morning|night/i);
  });
});

/**
 * The steadiest-weekday gate, which is the one threshold in the portrait that has
 * now been wrong in BOTH directions: it named a pair on a flat week, and after
 * that was fixed it suppressed the owner's real month because the cliff was
 * pinned to the leader. Each case below is one of those two failures or one of
 * the shapes the rule exists to keep speaking.
 */
describe('rhythm producer (the steadiest weekdays)', () => {
  /** Every start at 20:00 UTC so the daypart half is constant and only the
   *  weekday distribution is under test. */
  const week = (perDow: number[]): DeveloperModelSnapshot => ({
    ...BASE,
    activity: {
      ...BASE.activity,
      hourlyDistribution: perDow
        .map((sessions, dow) => ({ dow, hour: 20, sessions }))
        .filter((b) => b.sessions > 0),
    },
  });

  const names = (snapshot: DeveloperModelSnapshot) =>
    run(rhythmProducer, snapshot)?.insights.find((i) => i.id === 'steady-days')?.linkedTerm ?? null;

  it("names the owner's real two-day spine, which the leader-pinned cliff swallowed", () => {
    // The owner's live 30-day window, localized: Sun 57, Mon 62, Tue 44, Wed 91,
    // Thu 96, Fri 72, Sat 63. The old band put its cliff at 0.75 x 96 = 72, so
    // Friday's 72 joined the top and the sentence went quiet. The pair steps down
    // 19 to Friday and only 5 within itself, which is what makes it a pair.
    expect(names(week([57, 62, 44, 91, 96, 72, 63]))).toBe('Thursdays and Wednesdays');
  });

  it('stays quiet on a flat week', () => {
    expect(names(week([3, 3, 3, 3, 3, 3, 3]))).toBeNull();
  });

  it('stays quiet on a flat week with a tilt', () => {
    expect(names(week([0, 5, 4, 4, 4, 4, 0]))).toBeNull();
  });

  it('stays quiet on a gentle slope, where no two days are the spine', () => {
    expect(names(week([0, 10, 9, 8, 7, 0, 0]))).toBeNull();
  });

  it('still names a real two-day rhythm', () => {
    expect(names(week([0, 5, 4, 1, 0, 0, 0]))).toBe('Mondays and Tuesdays');
  });

  it('still names a genuine lean', () => {
    expect(names(week([0, 6, 5, 2, 2, 0, 0]))).toBe('Mondays and Tuesdays');
  });

  it('stays quiet when the week has one busy day and a distant second', () => {
    expect(names(week([0, 30, 5, 1, 0, 0, 0]))).toBeNull();
  });

  it('breaks an exact tie by weekday rather than by payload order', () => {
    expect(names(week([0, 7, 7, 1, 0, 0, 0]))).toBe('Mondays and Tuesdays');
  });
});

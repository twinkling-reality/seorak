import type { DeveloperModelSnapshot } from '@seorak/types';

import type { ModelInsight } from '../modelPresentationTypes.js';
import { shipByDaypart, standoutDaypart, survivalByDaypart } from './conditional.js';
import type { DaypartRate, DaypartSplit } from './conditional.js';
import { daypartMeta } from '../../../lib/localTime.js';
import { boundary, count, rateOf, remainderText } from './evidence.js';
import { concentration, listPhrase } from './format.js';
import type { PortraitContext, PortraitProducer, PortraitSentence } from './types.js';

/** Below this the read does not claim work "stuck" — a rate can be measured and
 *  still be too weak to be a trait. The worker already floors the rate itself at
 *  three rated commits; this is the separate question of whether it is worth
 *  saying out loud.
 *
 *  Compared STRICTLY, like `format.isMajority`: half of the reader's lines being
 *  rewritten is not "mostly stayed in the codebase", and this producer is
 *  deliberately one-sided (silent below the bar rather than printing a low rate),
 *  so the boundary is the only place the claim can be wrong. */
const STICK_RATE = 0.5;

/** Citations naming the dayparts a slice could not rate, so a card that speaks
 *  about the evening is visibly not claiming the mornings were worse. */
function coverageCitations(split: DaypartSplit, field: string) {
  if (split.belowFloor.length === 0) return [];
  return [
    { text: `Not enough measured work to rate ${listPhrase(split.belowFloor)}`, field },
  ];
}

/** The runners-up, as evidence under the daypart the sentence named. */
function runnerUpCitations(
  split: DaypartSplit,
  standout: DaypartRate,
  unit: string,
  field: string,
) {
  return split.rated
    .filter((r) => r.daypart !== standout.daypart)
    .map((r) => ({
      text: `${r.label}: ${count(r.numerator)} of ${count(r.denominator)} ${unit}`,
      field,
    }));
}

/**
 * The window-wide shipping rate, as a citation.
 *
 * `outcomes.shipRate` and the two counts it is the quotient of rendered NOWHERE
 * after the focus card correctly stopped quoting a merged-read number under a
 * heading naming one project — three contract fields with no reader, which is the
 * "projection with no render" the spec forbids. It belongs in the payoff
 * paragraph, where shipping is the claim, and it rides both the survival card and
 * the daypart-shipping card so it still has a home when either is silent.
 */
/**
 * The WINDOW-WIDE survival rate, as a citation on the daypart card.
 *
 * The daypart cut is a conditional on a base rate, and the ranking can leave the
 * base rate unspoken: `daypartPayoffProducer` and `frictionProducer` together
 * outscore `survivalProducer` on any window with a quiet session and a rated
 * daypart, and the payoff paragraph speaks two sentences. The read then tells a
 * developer their afternoon work lasted longest without ever saying whether their
 * work lasted, which is the same defect as the focus card quoting a window-wide
 * ship rate under one repo's heading, in mirror image — a number whose meaning
 * depends on a comparison the reader was never given.
 *
 * Attaching it here rather than re-tuning a weight is the same move
 * `shipRateCitations` already makes, and it holds however the ranking falls.
 */
function windowSurvivalCitations(snapshot: DeveloperModelSnapshot) {
  const { rate, linesSurviving, linesAuthored } = snapshot.outcomes.lineSurvival;
  if (rate === null || linesAuthored === 0) return [];
  return [
    {
      text: `${rateOf(rate, linesSurviving, linesAuthored, 'lines you wrote')} were still there across the whole window, at every time of day`,
      field: 'outcomes.lineSurvival.rate',
    },
  ];
}

function shipRateCitations(snapshot: DeveloperModelSnapshot) {
  const { shipRate, shipped, shipDeterminable } = snapshot.outcomes;
  // The two counts are REQUIRED by the contract and the schema rejects a body
  // without them, so this guard is not compatibility code for an older sender —
  // it is the honest-empty fallback for the one path that reaches the compiler
  // unvalidated, a snapshot cached before the counts were added. Omitting a
  // citation is correct there; throwing inside a producer takes the whole page
  // down, and printing a rate with `undefined of undefined` under it would be
  // worse than saying nothing.
  if (shipRate === null || !Number.isFinite(shipped) || !Number.isFinite(shipDeterminable)) {
    return [];
  }
  return [
    {
      text: `${rateOf(shipRate, shipped, shipDeterminable, 'sessions whose starting commit was known')} landed at least one commit`,
      field: 'outcomes.shipRate',
    },
  ];
}

/**
 * Payoff — whether the work landed, from on-branch line survival.
 *
 * Anti-grade by construction: a low survival rate means more of the work was
 * changed back, not that the developer was bad, so the read only speaks the rate
 * when it is high enough to be encouraging and otherwise says nothing rather than
 * printing a number that reads as a mark.
 */
export const survivalProducer: PortraitProducer = {
  id: 'survival',
  paragraph: 'payoff',
  // Whether the work lasted is the one outcome a developer cannot observe for
  // themselves without going and looking.
  weight: 0.9,
  produce(snapshot: DeveloperModelSnapshot): PortraitSentence | null {
    const survival = snapshot.outcomes.lineSurvival;
    const rate = survival.rate;

    if (rate !== null && rate > STICK_RATE) {
      return {
        // How far the work landed from a coin flip. 84% surviving is worth
        // saying; 51% is technically "mostly" and tells the reader nothing.
        notability: Math.min(1, Math.abs(rate - 0.5) * 2),
        insights: [
          {
            id: 'stick',
            facet: 'payoff',
            // "stayed in the codebase", not "stick". The term is the only part of
            // this sentence a reader sees before deciding whether to open the
            // card, and "work tended to stick" does not say stuck WHERE.
            linkedTerm: 'stayed in the codebase',
            label: 'Whether it lasted',
            hoverLines: [
              `${count(survival.linesSurviving)} of ${count(survival.linesAuthored)} lines you wrote were still there days later.`,
            ],
            squircle: {
              // Was the sentence above it with the numbers removed. The remainder
              // is the half a survival rate never states and the reader always
              // wants: how much of the work came back out.
              detail: remainderText({
                numerator: survival.linesSurviving,
                denominator: survival.linesAuthored,
                unit: 'lines',
                rest: 'had been changed by the time the check ran',
                whole: 'Not one line you landed in this window had been changed.',
              }),
              citations: [
                {
                  // Counts, not a bare rate. "84% of landed lines were still there
                  // later" gave a reader nothing to check and never said what
                  // "later" or "there" meant.
                  // "when it was last checked" told the reader nothing about WHEN.
                  // The check runs on the daemon's own schedule, days after the
                  // work landed, which is the same precision the card body and the
                  // hover already carry — so say it here too rather than leave the
                  // one number a reader is most likely to question undated.
                  text: `${rateOf(rate, survival.linesSurviving, survival.linesAuthored, 'lines you wrote')} were still on the branch days later, when the check last ran`,
                  field: 'outcomes.lineSurvival.rate',
                },
                {
                  text: `Across ${count(survival.commitsChecked)} commits from ${count(survival.sessionsRated)} sessions the check could rate`,
                  field: 'outcomes.lineSurvival.commitsChecked',
                },
                ...shipRateCitations(snapshot),
                boundary(
                  'A blame check against the branch tip on your machine, so a line rewritten by anyone counts as gone',
                  'outcomes.lineSurvival',
                ),
                ...(survival.unreachable + survival.unknown > 0
                  ? [
                      {
                        text: `${count(survival.unreachable + survival.unknown)} sessions could not be rated at all and are outside both numbers`,
                        field: 'outcomes.lineSurvival.unreachable',
                      },
                    ]
                  : []),
              ],
            },
          },
        ],
        segments: [
          { type: 'text', text: 'What you wrote mostly ' },
          { type: 'insight', insightId: 'stick' },
          { type: 'text', text: '. ' },
        ],
      };
    }

    // Rated sessions exist but the rate is still floored: say the measurement is
    // forming rather than leaving the paragraph silent, so a reader who knows work
    // shipped is not left wondering whether the read simply cannot see it.
    //
    // "Line survival is still forming for this window" was two pieces of house
    // vocabulary in one sentence, and because it carries no insight there is no
    // term to pull and no card to explain either of them — the one sentence a
    // reader cannot parse was also the one they cannot click. The read already
    // calls this "stayed in the codebase" everywhere else; use its own words.
    if (rate === null && survival.sessionsRated > 0) {
      return {
        insights: [],
        segments: [
          {
            type: 'text',
            text: 'There is not yet enough finished work to say whether what you wrote stayed in the codebase. ',
          },
        ],
      };
    }

    return null;
  },
};

/**
 * When it went best — the sentence introspection.md leads its own spec with
 * ("mornings tended to stick, late nights looped") and the read could not say
 * before. The worker projected no conditional cut at all, so the closest the
 * compiler could get was a template asserting that late sessions looped more,
 * with nothing in the snapshot measuring when a session started. That claim is
 * gone; this one is a rate over the reader's own dayparts, floored, and silent
 * when the spread between best and worst is too small to be a difference.
 *
 * BOTH cuts live in one producer because they are one question — "when does it go
 * well" — and they frequently answer it with the same daypart. As two producers
 * they wrote two sentences that both said "evening", which reads as a stutter
 * rather than as corroboration. Owning the sentence lets the read say the two
 * agree when they do, and contrast them when they do not.
 *
 * Survival and shipping are still separate MEASUREMENTS and neither stands in for
 * the other: a session can ship work that is rewritten a week later, and one that
 * lands no commit can still leave a branch worth keeping.
 */
export const daypartPayoffProducer: PortraitProducer = {
  id: 'daypart-payoff',
  paragraph: 'payoff',
  // The spec leads with this sentence for a reason: "your mornings last longer
  // than your late nights" is genuinely unknowable from the inside.
  weight: 1,
  produce(snapshot: DeveloperModelSnapshot, ctx: PortraitContext): PortraitSentence | null {
    const survivalSplit = survivalByDaypart(snapshot, ctx.offsetMinutes);
    const shipSplit = shipByDaypart(snapshot, ctx.offsetMinutes);
    const survival = standoutDaypart(survivalSplit);
    const ship = standoutDaypart(shipSplit);
    if (!survival && !ship) return null;

    const survivalInsight = (s: DaypartRate, alsoShip?: DaypartRate): ModelInsight => ({
      id: 'survival-daypart',
      facet: 'payoff',
      linkedTerm: s.label,
      label: 'When it lasted',
      hoverLines: [
        `${count(s.numerator)} of ${count(s.denominator)} lines from ${s.label} sessions were still there.`,
      ],
      squircle: {
        // Was "Your evening work held up best", which is the sentence the term
        // hangs off. The remainder says what the rate leaves out, on the one slice
        // the reader has just been told is their strongest.
        detail: remainderText({
          numerator: s.numerator,
          denominator: s.denominator,
          unit: 'lines',
          rest: `from ${s.label} sessions had been changed by the last check`,
          whole: `Not one line from a ${s.label} session had been changed.`,
        }),
        citations: [
          {
            text: `${rateOf(s.rate, s.numerator, s.denominator, `lines from ${s.label} sessions`)} were still there at the last check`,
            field: 'conditional.lineSurvivalByStartHour',
          },
          // When both cuts point at the SAME daypart the sentence names it once,
          // so the shipping half has no term of its own and its card could never
          // be opened — a measured claim in the prose with unreachable evidence.
          // Its counts ride this card instead.
          ...(alsoShip
            ? [
                {
                  text: `${rateOf(alsoShip.rate, alsoShip.numerator, alsoShip.denominator, `${alsoShip.label} sessions`)} landed a commit`,
                  field: 'conditional.shipByStartHour',
                },
                boundary(
                  'Only sessions whose starting commit was known can be judged; the rest are outside both numbers',
                  'conditional.shipByStartHour',
                ),
              ]
            : []),
          ...runnerUpCitations(survivalSplit, s, 'lines', 'conditional.lineSurvivalByStartHour'),
          ...coverageCitations(survivalSplit, 'conditional.lineSurvivalByStartHour'),
          // The base rate this slice is a conditional on, so the comparison holds
          // even on the windows where the ranking cut the survival sentence.
          ...windowSurvivalCitations(snapshot),
          // The word the whole card turns on was never defined ON it, and these
          // cards can name a DIFFERENT daypart from the rhythm sentence, so the
          // reader may never have been given the hours anywhere.
          boundary(
            `The ${s.label} is ${daypartMeta(s.daypart).range} on your clock`,
            'conditional.lineSurvivalByStartHour',
          ),
          boundary(
            'Attributed to when the session STARTED, not when the check ran',
            'conditional.lineSurvivalByStartHour',
          ),
          boundary(
            'Sessions whose start falls outside the two windows this read scans are outside these numbers',
            'conditional.lineSurvivalByStartHour',
          ),
        ],
      },
    });

    const shipInsight = (s: DaypartRate): ModelInsight => ({
      id: 'ship-daypart',
      facet: 'payoff',
      linkedTerm: s.label,
      label: 'When it shipped',
      hoverLines: [
        `${count(s.numerator)} of ${count(s.denominator)} ${s.label} sessions landed a commit.`,
      ],
      squircle: {
        detail: remainderText({
          numerator: s.numerator,
          denominator: s.denominator,
          unit: 'sessions',
          rest: `that started in the ${s.label} landed nothing`,
          whole: `Not one ${s.label} session the log could judge came away empty.`,
        }),
        citations: [
          {
            text: `${rateOf(s.rate, s.numerator, s.denominator, `${s.label} sessions`)} landed a commit`,
            field: 'conditional.shipByStartHour',
          },
          ...runnerUpCitations(shipSplit, s, 'sessions', 'conditional.shipByStartHour'),
          ...coverageCitations(shipSplit, 'conditional.shipByStartHour'),
          ...shipRateCitations(snapshot),
          boundary(
            `The ${s.label} is ${daypartMeta(s.daypart).range} on your clock`,
            'conditional.shipByStartHour',
          ),
          boundary(
            'Only sessions whose starting commit was known can be judged; the rest are outside both numbers',
            'conditional.shipByStartHour',
          ),
        ],
      },
    });

    // The connective back to the rhythm sentence, in THREE states rather than two.
    //
    // When the best daypart is the one the reader was already told they work in,
    // the two facts are one insight and "too" says so; when the rhythm sentence
    // named a DIFFERENT daypart, that gap is the most useful thing on the page and
    // "though" is what marks it. The third state is the one that was missing: when
    // no daypart was dominant enough to name, `ctx.rhythmDaypart` is null and the
    // old two-way flag fell through to the contrast form — so a reader who had
    // been told nothing about when they work got a sentence punctuated as a
    // correction of it ("It lasted longest, though, in the evening.").
    const agrees = survival ? ctx.rhythmDaypart === survival.daypart : ctx.rhythmDaypart === ship!.daypart;
    const contrasts = ctx.rhythmDaypart !== null && !agrees;

    // Both cuts agree on the daypart: say it ONCE, on one card carrying both
    // measurements.
    // The whole point of this sentence is the GAP between dayparts, so the gap is
    // its notability. Both cuts agreeing raises it: two independent measurements
    // pointing at the same time of day is a stronger claim than either alone.
    const best = survival ?? ship!;
    const worstOf = (split: DaypartSplit) =>
      split.rated.length > 1 ? split.rated[split.rated.length - 1].rate : best.rate;
    const spread = best.rate - worstOf(survival ? survivalSplit : shipSplit);
    const notability = Math.min(1, Math.max(0, spread * 2) + (survival && ship ? 0.2 : 0));

    if (survival && ship && survival.daypart === ship.daypart) {
      const tailLead = agrees
        ? ' too, where it lasted longest and shipped most often. '
        : contrasts
          ? ', though, lasting longest and shipping most often. '
          : ', lasting longest and shipping most often. ';
      return {
        notability,
        insights: [survivalInsight(survival, ship)],
        segments: [
          { type: 'text', text: agrees ? 'It went best in the ' : 'It was the ' },
          { type: 'insight', insightId: 'survival-daypart' },
          {
            type: 'text',
            text: agrees
              ? ' too, where the work lasted longest and shipped most often. '
              : contrasts
                ? ' that went best, though, lasting longest and shipping most often. '
                : ' that went best, lasting longest and shipping most often. ',
          },
        ],
        leadSegments: [
          { type: 'text', text: 'What you wrote went best in the ' },
          { type: 'insight', insightId: 'survival-daypart' },
          { type: 'text', text: tailLead },
        ],
      };
    }

    if (survival && ship) {
      const join = contrasts
        ? ' work lasted longest, though, and your '
        : ' work lasted longest, and your ';
      // Already opens on a noun phrase, so the follow-on form reads as an opener
      // too and no lead variant is needed.
      return {
        notability,
        insights: [survivalInsight(survival), shipInsight(ship)],
        segments: [
          { type: 'text', text: 'Your ' },
          { type: 'insight', insightId: 'survival-daypart' },
          { type: 'text', text: join },
          { type: 'insight', insightId: 'ship-daypart' },
          { type: 'text', text: ' sessions shipped most often. ' },
        ],
      };
    }

    if (survival) {
      return {
        notability,
        insights: [survivalInsight(survival)],
        segments: [
          {
            type: 'text',
            text: contrasts ? 'It lasted longest, though, in the ' : 'It lasted longest in the ',
          },
          { type: 'insight', insightId: 'survival-daypart' },
          { type: 'text', text: '. ' },
        ],
        // "It" is the survival sentence's "What you wrote", which is exactly the
        // sentence that did not fire whenever this producer opens the paragraph —
        // and the nearest noun is then the project named a paragraph earlier, so
        // the read landed as a claim about the repo.
        leadSegments: [
          {
            type: 'text',
            text: contrasts
              ? 'What you wrote lasted longest, though, in the '
              : 'What you wrote lasted longest in the ',
          },
          { type: 'insight', insightId: 'survival-daypart' },
          { type: 'text', text: '. ' },
        ],
      };
    }

    return {
      notability,
      insights: [shipInsight(ship!)],
      segments: [
        {
          type: 'text',
          text: contrasts ? 'It shipped most often, though, in the ' : 'It shipped most often in the ',
        },
        { type: 'insight', insightId: 'ship-daypart' },
        { type: 'text', text: '. ' },
      ],
      leadSegments: [
        { type: 'text', text: 'Your ' },
        { type: 'insight', insightId: 'ship-daypart' },
        {
          type: 'text',
          text: contrasts
            ? ' sessions were the ones that shipped most often, though. '
            : ' sessions shipped most often. ',
        },
      ],
    };
  },
};

/**
 * Friction — whether any session is still spinning right now.
 *
 * It carried a second half, "most of your sessions ran without doubling back",
 * and that half is gone. `oneShotRate` marks a session one-shot when the
 * run-length-encoded stream of its tool names visits each tool at most once, so
 * an agent that reads, edits and reads again fails it — and the sentence only
 * spoke above 50%. Measured on the owner's own log the rate is 1.8% at 7 days,
 * 2.3% at 30 and 1.7% at 90: unreachable by a factor of twenty-five, and the term
 * promised a claim about retry loops that the measurement never made. Deleting it
 * took the contract field and its D1 read with it (see developer-model.ts).
 *
 * What is left is the one LIVE fact on a retrospective page, which is why the
 * producer stays at all.
 */
export const frictionProducer: PortraitProducer = {
  id: 'friction',
  paragraph: 'payoff',
  // A session that has gone quiet RIGHT NOW is the one thing on this page a
  // reader might act on, and the only sentence here that is not about the past.
  weight: 0.7,
  produce(snapshot: DeveloperModelSnapshot): PortraitSentence | null {
    const stuck = snapshot.outcomes.stuckness;
    const insights: ModelInsight[] = [];
    const segments: PortraitSentence['segments'] = [];

    if (stuck.stuckCount > 0) {
      const one = stuck.stuckCount === 1;
      const leadsSentence = insights.length === 0;
      // `inFlight` is REQUIRED by the contract and the schema rejects a body
      // without it, so this guard is not compatibility code for an older sender —
      // it is the honest-empty fallback for the one path that reaches the compiler
      // unvalidated, a snapshot cached before the field was added. The same
      // reasoning as `shipRateCitations` above: falling back to the count-only
      // form is right, and printing "2 of undefined" would be worse than saying
      // less. A denominator smaller than its own numerator is treated the same
      // way rather than printed.
      const openSessions =
        Number.isFinite(stuck.inFlight) && stuck.inFlight >= stuck.stuckCount ? stuck.inFlight : 0;
      insights.push({
        id: 'looping',
        facet: 'payoff',
        // NOT "loop". `stuckCount` counts sessions that have not ended and have
        // sent no event for five minutes — that is SILENCE, and the session may be
        // waiting on one long tool call or the collector may have stopped
        // shipping. The word "loop" is already spoken four lines above for the one
        // thing this paragraph does measure as looping, so one word was carrying
        // two different measurements and the unmeasured one sounded the more
        // confident.
        linkedTerm: 'gone quiet',
        // NOT "Whether it landed". This is the one card in the payoff paragraph
        // that is not retrospective at all — it is a fact about sessions that have
        // not ended yet, and heading it with the paragraph's outcome question put
        // a live count under a title about work that finished.
        label: 'Still open',
        hoverLines: [
          openSessions > 0
            ? `${count(stuck.stuckCount)} of ${count(openSessions)} sessions still open had sent nothing for five minutes.`
            : one
              ? 'One session was still open and had sent nothing for five minutes.'
              : `${count(stuck.stuckCount)} sessions were still open and had sent nothing for five minutes.`,
        ],
        squircle: {
          // The remainder, now that the contract carries the denominator this rate
          // was always divided by. Before `stuckness.inFlight` shipped, this card
          // stated a bare count with nothing to read it against — one quiet session
          // out of two open and one out of fifty are the same sentence — and the
          // only way to recover the denominator from the wire was `stuckCount /
          // rate`, which is a count nobody counted.
          detail:
            openSessions > 0
              ? remainderText({
                  numerator: stuck.stuckCount,
                  denominator: openSessions,
                  unit: 'open sessions',
                  rest: 'were still sending',
                  whole: 'Every session still open had gone quiet.',
                })
              : 'These sessions had not ended when this read was built.',
          citations: [
            {
              text:
                openSessions > 0 && stuck.rate !== null
                  ? `${rateOf(stuck.rate, stuck.stuckCount, openSessions, 'sessions that had not ended')} had gone quiet`
                  : one
                    ? 'One session had not ended and had sent nothing for five minutes'
                    : `${count(stuck.stuckCount)} sessions had not ended and had sent nothing for five minutes`,
              field: 'outcomes.stuckness',
            },
            boundary(
              'Counted at the moment this read was built, not across the window',
              'outcomes.stuckness',
            ),
            boundary(
              'Measured from silence on a session that has not ended, not from what the agent is doing, so a long single tool call looks the same as a stall',
              'outcomes.stuckness',
            ),
          ],
        },
      });
      segments.push(
        // No claim about WHEN those sessions started. The old copy said "late
        // sessions were more likely to loop" off nothing but a count, which is a
        // correlation the snapshot has never measured. The measured version of
        // that sentence is the daypart producer above.
        {
          type: 'text',
          text: one
            ? leadsSentence
              ? 'One session has '
              : 'One has '
            : leadsSentence
              ? 'Some sessions have '
              : 'Some have ',
        },
        { type: 'insight', insightId: 'looping' },
        { type: 'text', text: ' right now. ' },
      );
    }

    if (insights.length === 0) return null;
    // Notable by construction: the producer is silent unless a session is open and
    // quiet, and that is always worth the space.
    return { insights, segments, notability: 1 };
  },
};

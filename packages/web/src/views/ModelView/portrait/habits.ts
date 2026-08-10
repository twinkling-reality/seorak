import type { DeveloperModelSnapshot, EndReasonCount } from '@seorak/types';

import type { ModelInsight } from '../modelPresentationTypes.js';
import { boundary, count, otherThings, rateOf, remainderText, runnersUp } from './evidence.js';
import { bestConcentration, listPhrase } from './format.js';
import type { PortraitContext, PortraitProducer, PortraitSentence } from './types.js';

/**
 * A phrase for EVERY end reason. TOTAL `Record`, deliberately not `Partial`: this map was
 * Partial and silently missing `resume` and `bypass_permissions_disabled`, so a dominant
 * `resume` would have read as a bare `undefined` in the hero sentence. Total means adding
 * a reason to `@seorak/types` breaks THIS file at compile time, which is the only way a
 * copy map stays in step with a union it does not own.
 */
const END_REASON_COPY: Record<EndReasonCount['reason'], string> = {
  clear: 'close the chat',
  resume: 'pick a session back up',
  prompt_input_exit: 'leave at the input',
  logout: 'log out',
  bypass_permissions_disabled: 'stop when permissions tighten',
  other: 'end another way',
};

/** One session ending a given way is a coincidence; the read waits for a habit. */
const END_REASON_MIN = 2;

/** Verification runs behind the leading kind before "you run the tests" is a habit
 *  rather than a thing that happened once. */
const VERIFICATION_MIN_RUNS = 5;

const VERIFICATION_COPY: Record<'test' | 'build' | 'typecheck' | 'lint', string> = {
  test: 'run the tests',
  build: 'build what you changed',
  typecheck: 'typecheck as you go',
  lint: 'lint as you go',
};

function dominantEndReason(endReasons: EndReasonCount[]): EndReasonCount | null {
  if (endReasons.length === 0) return null;
  return [...endReasons].sort((a, b) => b.count - a.count)[0] ?? null;
}

function endReasonInsight(
  snapshot: DeveloperModelSnapshot,
): { insight: ModelInsight; majority: boolean } | null {
  const top = dominantEndReason(snapshot.outcomes.endReasons);
  if (!top || top.count < END_REASON_MIN) return null;
  const phrase = END_REASON_COPY[top.reason];
  if (!phrase) return null;
  const finished = snapshot.outcomes.endReasons.reduce((sum, r) => sum + r.count, 0);
  const others = snapshot.outcomes.endReasons
    .filter((r) => r.reason !== top.reason)
    .sort((a, b) => b.count - a.count);

  const insight: ModelInsight = {
    id: 'session-end',
    facet: 'shape',
    linkedTerm: phrase,
    label: 'How sessions end',
    hoverLines: [`${count(top.count)} of ${count(finished)} finished sessions ended this way.`],
    squircle: {
      // Was "You tend to finish sessions the same way", which is false on the
      // shape this partition actually takes: end reasons split five ways, so the
      // leader is routinely a quarter, and the card asserting a habit sat directly
      // above its own counts disproving one.
      detail: remainderText({
        numerator: top.count,
        denominator: finished,
        unit: 'finished sessions',
        rest: `ended ${otherThings(others.length, 'way')}`,
        whole: 'No session in this window finished any other way.',
      }),
      citations: [
        {
          // The denominator was missing: "38 finished sessions ended this way" is
          // a habit if 38 of 44, and noise if 38 of 300.
          text: `${rateOf(top.count / finished, top.count, finished, 'finished sessions')} ended this way`,
          field: `outcomes.endReasons.${top.reason}`,
        },
        ...runnersUp(
          others,
          (r) => END_REASON_COPY[r.reason] ?? r.reason,
          (r) => r.count,
          'outcomes.endReasons',
          'sessions',
        ),
        boundary(
          'Only sessions that actually ended are counted, so a session still running is not a missing vote',
          'outcomes.endReasons',
        ),
      ],
    },
  };

  // End reasons are a five-way partition of finished sessions, so a plurality
  // winner near a quarter is the NORMAL shape for anyone who mixes closing the
  // chat, walking away at the prompt, and resuming. "You usually close the chat"
  // off 5 of 20 put the sentence at odds with its own card, which printed the two
  // counts honestly one line below.
  return { insight, majority: finished > 0 && top.count > finished * 0.5 };
}

function verificationInsight(
  snapshot: DeveloperModelSnapshot,
  sessionTotal: number,
): { insight: ModelInsight; often: boolean } | null {
  const ranked = [...snapshot.tools.verification]
    .filter((v) => v.runs > 0)
    .sort((a, b) => b.runs - a.runs);
  const top = ranked[0];
  if (!top || top.runs < VERIFICATION_MIN_RUNS) return null;

  const others = ranked.slice(1);
  const runTotal = ranked.reduce((sum, v) => sum + v.runs, 0);
  const phrase = VERIFICATION_COPY[top.kind];
  // "Usually" is a frequency claim and the gate behind it measures existence: five
  // runs is under one session's worth of activity for an active developer, so a
  // developer who ran the tests in five of sixty sessions was told it was a habit.
  // The sentence still renders — every field renders — but the ADVERB is scaled to
  // the window, at roughly one run per two sessions.
  //
  // Bounded, not eliminated: `VerificationRollup` carries no per-session count, so
  // one session that ran the tests forty times still clears this. Removing that
  // needs a `sessions` field on the rollup, which is a contract change.
  // Weaker word when there is no denominator at all, not the stronger one. With
  // `sessionTotal === 0` the read printed "You usually run the tests" off a run
  // count it could not divide by anything — an unmeasured frequency claim, which
  // is the exact defect this scaling exists to remove.
  const often = sessionTotal === 0 || top.runs < sessionTotal * 0.5;

  const insight: ModelInsight = {
    id: 'verification',
    facet: 'shape',
    linkedTerm: phrase,
    label: 'Checks you run',
    // Was "Verification runs your sessions made in this window", which parses
    // first as subject-verb-object ("Verification runs your sessions"), has no
    // verb of its own, and opens on a category name the reader has never been
    // shown. Since the peek/pin split this line is the ONLY thing a hover renders.
    hoverLines: [`${count(top.runs)} ${top.kind} runs, more than any other check.`],
    squircle: {
      // RUNS only, never a pass count. That a developer checks their work is an
      // identity; how often the check went green is a grade, and the Model does
      // not grade the person (introspection.md hard rule 4). The pass rate is
      // stripped from this contract at the worker for the same reason.
      //
      // The body was "You check your work while you go" — the sentence the term
      // hangs off, with the measurement taken out. What it says now is the part
      // the sentence cannot: which OTHER checks ran, which is the difference
      // between someone who only runs tests and someone who runs four things.
      detail: remainderText({
        numerator: top.runs,
        denominator: runTotal,
        unit: 'runs',
        rest: `were ${listPhrase(others.map((v) => v.kind))}`,
        whole: 'No other kind of check ran in this window.',
      }),
      citations: [
        {
          // A numerator with no denominator is the defect the end-reason card
          // beside it was already fixed for. Absent rather than zero-filled when
          // the window carries no session buckets to divide by.
          text:
            sessionTotal > 0
              ? `${count(top.runs)} ${top.kind} runs across ${count(sessionTotal)} sessions in this window`
              : `${count(top.runs)} ${top.kind} runs in this window`,
          field: 'tools.verification',
        },
        ...runnersUp(others, (v) => v.kind, (v) => v.runs, 'tools.verification', 'runs'),
        boundary(
          'Runs only. Whether a check went green is deliberately not counted here: that you check your work is an identity, how often it succeeds would be a grade',
          'tools.verification',
        ),
      ],
    },
  };

  return { insight, often };
}

/**
 * Habits — the things you do the same way every time you finish.
 *
 * The adverb is measured, not decorative. Both halves of this sentence used to
 * open on "usually" regardless of how often the thing actually happened, so the
 * one sentence on the page making a FREQUENCY claim was the one making it without
 * a denominator. Each half now picks its own word from its own share, and the
 * cards carry the counts either way.
 */
export const habitsProducer: PortraitProducer = {
  id: 'habits',
  paragraph: 'identity',
  // Deliberately near the floor. How a session ENDS is a fact about a keystroke,
  // and no amount of concentration makes "you close the chat when you're done"
  // something a reader did not already know. Kept above zero rather than deleted
  // so a window with nothing else measured still has a sentence instead of an
  // empty paragraph; on any real window it loses the cut.
  weight: 0.2,
  produce(snapshot: DeveloperModelSnapshot, ctx: PortraitContext): PortraitSentence | null {
    const verification = verificationInsight(snapshot, ctx.sessionTotal);
    const ending = endReasonInsight(snapshot);
    if (!verification && !ending) return null;

    // Low by construction anyway (see `weight`), but a window where one check
    // dominates says a little more than one where they are even.
    const kinds = snapshot.tools.verification.filter((v) => v.runs > 0);
    const runTotal = kinds.reduce((sum, v) => sum + v.runs, 0);
    const topRuns = kinds.reduce((best, v) => Math.max(best, v.runs), 0);
    const notability = bestConcentration([
      { share: runTotal > 0 ? topRuns / runTotal : null, categories: kinds.length },
    ]);

    const verifyLead = verification?.often ? 'You often ' : 'You usually ';
    const endLead = ending?.majority ? 'You usually ' : 'You most often ';
    const endJoin = ending?.majority ? ', then ' : ', and most often ';

    if (verification && ending) {
      return {
        notability,
        insights: [verification.insight, ending.insight],
        segments: [
          { type: 'text', text: verifyLead },
          { type: 'insight', insightId: verification.insight.id },
          { type: 'text', text: endJoin },
          { type: 'insight', insightId: ending.insight.id },
          { type: 'text', text: ' when you’re done. ' },
        ],
      };
    }

    if (ending) {
      return {
        notability,
        insights: [ending.insight],
        segments: [
          { type: 'text', text: endLead },
          { type: 'insight', insightId: ending.insight.id },
          { type: 'text', text: ' when you’re done. ' },
        ],
      };
    }

    return {
      notability,
      insights: [verification!.insight],
      segments: [
        { type: 'text', text: verifyLead },
        { type: 'insight', insightId: verification!.insight.id },
        { type: 'text', text: '. ' },
      ],
    };
  },
};

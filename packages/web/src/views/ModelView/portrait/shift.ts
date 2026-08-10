import type { DeveloperModelSnapshot } from '@seorak/types';

import { daypartMeta, daypartSessions, localizeHourBuckets } from '../../../lib/localTime.js';
import type { DaypartId } from '../../../lib/localTime.js';
import type { ModelInsight } from '../modelPresentationTypes.js';
import { leadingWorkType, WORK_TYPE_COPY } from './craft.js';
import { dominantDaypart } from './daypart.js';
import { boundary, count, rateOf } from './evidence.js';
import { article, isMajority, pct, priorWindowNoun, priorWindowWord } from './format.js';
import type { PortraitContext, PortraitProducer, PortraitSentence } from './types.js';

/**
 * Shift — what changed since the window before this one (accrual v2).
 *
 * This is the dimension a snapshot cannot have. Everything else on the page
 * answers "who are you"; only this answers "who have you BECOME", which is the
 * half of a portrait that carries the why and the when. "You've been an afternoon
 * developer" is a fact. "You've moved later — a fortnight ago you were a morning
 * developer" is the same fact with a life in it.
 *
 * ── One change, not a changelog ─────────────────────────────────────────────
 * A window can move on every dimension at once, and a paragraph listing all of
 * them is a diff, not a read. This producer ranks the candidates and speaks the
 * single most notable one; the rest ride the card as citations, where a reader who
 * wants the full comparison can find it. Rank order is by how much the change
 * says about the person: when you work, then where, then what kind of work.
 *
 * ── The prior daypart is derived HERE ───────────────────────────────────────
 * The worker ships the prior window's raw hour buckets, not the prior daypart,
 * because a daypart is a fact about the reader's clock. Both sides go through the
 * same `dominantDaypart` on the same offset, so a shift is a real shift and not
 * two different definitions of evening disagreeing with each other.
 */

/** The prior window needs at least this many sessions before it is a baseline
 *  worth comparing against rather than a handful of runs. */
const PRIOR_MIN_SESSIONS = 4;

/** Line survival has to move by this much before the read calls it a change.
 *  Below it, two rates are the same number twice. FLOOR only — see trendProducer,
 *  which scales it up when the smaller sample is thin. */
const SURVIVAL_MOVE = 0.1;

/**
 * How far apart the two windows' leaders must be, in each window, before the read
 * will call it a change.
 *
 * This is the strongest claim on the page and its only gate was "the two leaders
 * are different values". Both windows can be led by a bare plurality, so a prior
 * window of 4 afternoon / 3 evening against a current 3 afternoon / 4 evening
 * printed "The week before, you were an afternoon developer" with a card
 * asserting the reader had MOVED — off one session that began at 17:10 instead of
 * 16:50. The same one-value gate ran the focus and work-type shifts.
 *
 * Fifteen points is more than any single session can move a ten-session window,
 * and it is checked in BOTH directions: the old leader has to have really led
 * then, and the new one has to really lead now. The cost is that a genuine slow
 * drift goes unspoken until it widens, which is the right trade for the one
 * sentence that claims the reader changed.
 */
const SHIFT_MARGIN = 0.15;

interface Candidate {
  insight: ModelInsight;
  segments: PortraitSentence['segments'];
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The prior window's dominant daypart, on the reader's clock, or null.
 *
 * ── Why this can refuse to answer ───────────────────────────────────────────
 * The wire carries (dow, hour) and no DATE, and the whole compile runs on ONE
 * offset: `new Date().getTimezoneOffset()` at the instant the page renders. That
 * is correct for the current window and WRONG for the prior one whenever a
 * daylight-saving transition falls between them, because the two windows' hours
 * were recorded under different offsets and are being shifted by the same amount.
 *
 * The arithmetic, for a US-Pacific reader who starts every session at 17:15: in
 * October that is PDT (UTC-7) and lands in UTC hour 00; in November it is PST
 * (UTC-8) and lands in UTC hour 01. Read in November with a -8 offset, the prior
 * bucket localizes to 16:15 (afternoon) and the current one to 17:15 (evening),
 * so the read announces "The week before, you were an afternoon developer" about
 * a person whose day did not change at all. It fires deterministically on the
 * first read after each transition for anyone whose usual start hour sits within
 * an hour above a daypart boundary.
 *
 * Localizing each bucket by the offset in force at its own timestamp is the real
 * fix and it is not available: it needs a date on the wire, which the contract
 * deliberately does not carry. So the honest move is to decline. Both window
 * midpoints are derivable from `scope.generatedAt` and `scope.rangeDays`, which
 * are already on the contract; when they sat under different offsets, this
 * returns null and the shift ranking falls through to focus or work type, which
 * carry no clock.
 */
function priorDaypart(
  snapshot: DeveloperModelSnapshot,
  ctx: PortraitContext,
): { id: DaypartId; sessions: number; total: number; byPart: Map<DaypartId, number> } | null {
  const accrual = snapshot.accrual;
  if (!accrual) return null;
  // Decline rather than shift by the wrong amount. Both offsets are injected, so
  // this is reproducible on any machine.
  if (ctx.priorOffsetMinutes !== ctx.offsetMinutes) return null;

  const local = localizeHourBuckets(accrual.hourlyDistribution, -ctx.offsetMinutes / 60);
  const total = local.reduce((sum, b) => sum + b.sessions, 0);
  const top = dominantDaypart(local, total);
  if (!top) return null;
  return { id: top.id, sessions: top.sessions, total, byPart: daypartSessions(local) };
}

function daypartShift(
  snapshot: DeveloperModelSnapshot,
  ctx: PortraitContext,
): Candidate | null {
  const prior = priorDaypart(snapshot, ctx);
  if (!prior || !ctx.rhythmDaypart || prior.id === ctx.rhythmDaypart) return null;

  // The separation test, in both windows. Without it the two leaders only had to
  // be different values, which one session can arrange.
  const now = daypartSessions(ctx.localHours);
  const share = (map: Map<DaypartId, number>, total: number, id: DaypartId) =>
    total > 0 ? (map.get(id) ?? 0) / total : 0;
  const thenGap = share(prior.byPart, prior.total, prior.id) - share(prior.byPart, prior.total, ctx.rhythmDaypart);
  const nowGap =
    share(now, ctx.sessionTotal, ctx.rhythmDaypart) - share(now, ctx.sessionTotal, prior.id);
  if (thenGap < SHIFT_MARGIN || nowGap < SHIFT_MARGIN) return null;

  const was = daypartMeta(prior.id).label;
  const now_ = daypartMeta(ctx.rhythmDaypart).label;
  const rangeWord = priorWindowNoun(snapshot.scope.rangeDays);
  const wasNow = now.get(prior.id) ?? 0;
  return {
    insight: {
      id: 'shift-daypart',
      facet: 'rhythm',
      linkedTerm: `${was} developer`,
      label: 'What changed',
      hoverLines: [
        `${count(prior.sessions)} of ${count(prior.total)} session starts were in the ${was} then.`,
      ],
      squircle: {
        // Was "You have moved from the morning to the evening" — the sentence the
        // term hangs off, in the past perfect. What the sentence CANNOT say is
        // whether the old habit shrank or vanished, and that is the difference
        // between a drift and a break.
        detail:
          wasNow === 0
            ? `Not one session started in the ${was} this window.`
            : `The ${was} still holds ${count(wasNow)} of your ${count(ctx.sessionTotal)} starts now.`,
        citations: [
          {
            // The rate, where the peek one tier up carries the counts.
            text: `${rateOf(prior.sessions / prior.total, prior.sessions, prior.total, 'session starts')} were in the ${was} then`,
            field: 'accrual.hourlyDistribution',
          },
          // The range was MISSING here while the current-window daypart card
          // carried it, so the one term in the sentence a reader was most likely
          // to question was the one with nothing behind it.
          boundary(
            `The ${was} is ${daypartMeta(prior.id).range} and the ${now_} is ${daypartMeta(ctx.rhythmDaypart!).range}, both on your clock`,
            'accrual.hourlyDistribution',
          ),
          boundary(
            `Compared against the ${rangeWord} immediately before this one, not against all of your history`,
            'accrual.sessions',
          ),
        ],
      },
    },
    segments: [
      {
        type: 'text',
        text: `${capitalize(priorWindowWord(snapshot.scope.rangeDays))}, you were ${article(was)} `,
      },
      { type: 'insight', insightId: 'shift-daypart' },
      { type: 'text', text: '. ' },
    ],
  };
}

function focusShift(snapshot: DeveloperModelSnapshot): Candidate | null {
  // Silent on a scoped read for the same reason the focus sentence is: with one
  // project in view, "your focus moved" is a statement about the picker.
  if (snapshot.scope.repoId !== null) return null;

  const now = snapshot.focus.projectFocus[0];
  const was = snapshot.accrual?.projectFocus[0];
  if (!now || !was || now.repoId === was.repoId) return null;

  // The same separation the daypart shift needs, for the same reason: the gate was
  // "the two leaders are different repos", so a prior window of seorak 12 / feather
  // 11 against a current feather 12 / seorak 11 was reported as a change in what
  // the reader cares about. Ties are worse — the worker sorts focus entries by
  // session count alone, so equal counts resolve by rollup order and the announced
  // move could be pure ordering.
  const nowTotal = snapshot.focus.projectFocus.reduce((t, p) => t + p.sessions, 0);
  const wasTotal = snapshot.accrual!.projectFocus.reduce((t, p) => t + p.sessions, 0);
  const nowIn = (repoId: string, list: typeof snapshot.focus.projectFocus, total: number) =>
    total > 0 ? (list.find((p) => p.repoId === repoId)?.sessions ?? 0) / total : 0;
  const thenGap =
    nowIn(was.repoId, snapshot.accrual!.projectFocus, wasTotal) -
    nowIn(now.repoId, snapshot.accrual!.projectFocus, wasTotal);
  const nowGap =
    nowIn(now.repoId, snapshot.focus.projectFocus, nowTotal) -
    nowIn(was.repoId, snapshot.focus.projectFocus, nowTotal);
  if (thenGap < SHIFT_MARGIN || nowGap < SHIFT_MARGIN) return null;

  const wasNowSessions = snapshot.focus.projectFocus.find((p) => p.repoId === was.repoId)?.sessions ?? 0;
  return {
    insight: {
      id: 'shift-focus',
      facet: 'focus',
      linkedTerm: was.project,
      label: 'What changed',
      hoverLines: [`${was.project} led the window before with ${count(was.sessions)} sessions.`],
      squircle: {
        // Was "Your attention moved from feather to seorak" — the sentence again.
        // Whether the old project is still alive is the fact the sentence has no
        // room for and the reader most wants.
        detail:
          wasNowSessions === 0
            ? `${was.project} saw no sessions at all this window.`
            : `${was.project} still took ${count(wasNowSessions)} of your ${count(nowTotal)} sessions this window.`,
        projectKey: was.project,
        // The bar, filled to the share this card LEADS with — the prior window's.
        // This was the one focus-facet card carrying a project hue and no share,
        // so it rendered a coloured squircle and then, alone among its siblings,
        // no bar under it.
        share: wasTotal > 0 ? was.sessions / wasTotal : undefined,
        citations: [
          {
            text:
              was.share !== null
                ? // The denominator has to be the total the SHARE was taken over.
                  // It was `accrual.sessions`, which the worker counts from
                  // session-start rows in the prior window, while the share is
                  // computed over prior-window session STATES — two different
                  // populations, so the line printed a percentage that did not
                  // equal its own fraction and could show a numerator larger than
                  // its denominator ("58%, 63 of 19 sessions"). The current-window
                  // citation below always used the right total; this one was the
                  // odd one out.
                  `${was.project} took ${rateOf(was.share, was.sessions, wasTotal, 'sessions')} last period`
                : `${was.project} led with ${count(was.sessions)} sessions last period`,
            field: 'accrual.projectFocus',
          },
          {
            text:
              now.share !== null
                ? `${now.project} now takes ${rateOf(now.share, now.sessions, nowTotal, 'sessions')}`
                : `${now.project} leads with ${count(now.sessions)} sessions`,
            field: 'focus.projectFocus',
          },
          boundary(
            'Compared against the window immediately before this one',
            'accrual.projectFocus',
          ),
        ],
      },
    },
    // A COMPLETE sentence, like the other two shifts. It read "The month before,
    // it was feather." and "it" was bound to whatever sentence happened to precede
    // it — which is not the focus sentence whenever focus loses the paragraph cut,
    // and this shift outranks focus by construction. On a real compile that put
    // "The month before, it was feather" directly after "lately you've been an
    // afternoon developer, steadiest on Tuesdays and Wednesdays", where the only
    // available antecedent was the reader's clock.
    segments: [
      {
        type: 'text',
        text: `${capitalize(priorWindowWord(snapshot.scope.rangeDays))}, ${
          isMajority(was.share) ? 'most of your time went to ' : 'more of your time went to '
        }`,
      },
      { type: 'insight', insightId: 'shift-focus' },
      { type: 'text', text: isMajority(was.share) ? '. ' : ' than anywhere else. ' },
    ],
  };
}

function workTypeShift(snapshot: DeveloperModelSnapshot): Candidate | null {
  // BOTH legs go through craft's own gate, which is the point of sharing it.
  // `topWorkType` used to be a bare argmax over anything above zero, so the read
  // hedged the present and overclaimed the past in consecutive sentences — "You
  // were mostly fixing what was broken. The month before, you were mostly building
  // new things." where the second "mostly" was ONE branch name. Gating `now` also
  // stops the shift speaking about a facet whose own sentence never fired, which
  // left "The month before, you were mostly fixing what was broken" hanging off
  // whatever sentence happened to precede it.
  const now = leadingWorkType(snapshot.identity?.branchWorkTypeMix);
  const was = leadingWorkType(snapshot.accrual?.branchWorkTypeMix);
  if (!now || !was || now.workType === was.workType) return null;

  const wasPhrase = WORK_TYPE_COPY[was.workType] ?? `${was.workType} work`;
  const nowPhrase = WORK_TYPE_COPY[now.workType] ?? `${now.workType} work`;
  const wasNowSessions =
    (snapshot.identity?.branchWorkTypeMix ?? []).find((w) => w.workType === was.workType)?.sessions ?? 0;
  // The same hedge craft draws: 40% of five work types is a clear lead and is not
  // most of anything.
  const lead = isMajority(was.share) ? 'you were mostly ' : 'you leaned toward ';
  return {
    insight: {
      id: 'shift-work-type',
      facet: 'shape',
      linkedTerm: wasPhrase,
      label: 'What changed',
      hoverLines: [
        `${count(was.sessions)} of ${count(was.total)} classified sessions ran on branches named for ${wasPhrase} then.`,
      ],
      squircle: {
        // Was the sentence restated. The live count for the OLD kind of work is
        // what says whether it was dropped or merely overtaken.
        detail:
          wasNowSessions === 0
            ? 'No branch this window was named that way at all.'
            : `It still names ${count(wasNowSessions)} of your ${count(now.total)} classified sessions.`,
        citations: [
          {
            text: `${count(was.sessions)} of ${count(was.total)} classified sessions ran on a branch named for ${wasPhrase} last period, against ${count(now.sessions)} of ${count(now.total)} for ${nowPhrase} now`,
            field: 'accrual.branchWorkTypeMix',
          },
          boundary(
            'Read off each session\u2019s branch name on your machine, never from its contents',
            'accrual.branchWorkTypeMix',
          ),
          boundary(
            'Sessions whose branch could not be classified are outside both counts',
            'accrual.branchWorkTypeMix',
          ),
        ],
      },
    },
    segments: [
      {
        type: 'text',
        text: `${capitalize(priorWindowWord(snapshot.scope.rangeDays))}, ${lead}`,
      },
      { type: 'insight', insightId: 'shift-work-type' },
      { type: 'text', text: '. ' },
    ],
  };
}

/**
 * The ONE change the read will speak, ranked by how much it says about the
 * person: when you work, then where it went, then what kind of work it was.
 *
 * Every shift producer calls this on the same inputs and renders only if it won,
 * so exactly one change is ever spoken while each sentence still sits beside the
 * facet it is about. That placement is the point: a change belongs next to the
 * claim it changes. Collected at the end of the paragraph instead, "the month
 * before you were a morning developer" landed five sentences away from "lately
 * you've been an evening developer" and read as an unrelated fact.
 *
 * A paragraph that listed every moved dimension would be a diff, not a read; the
 * ones that lost are still measured and still reachable from the winner's card.
 */
type ShiftId = 'shift-daypart' | 'shift-focus' | 'shift-work-type';

function topShift(
  snapshot: DeveloperModelSnapshot,
  ctx: PortraitContext,
): Candidate | null {
  const accrual = snapshot.accrual;
  if (!accrual || accrual.sessions < PRIOR_MIN_SESSIONS) return null;
  return daypartShift(snapshot, ctx) ?? focusShift(snapshot) ?? workTypeShift(snapshot);
}

function shiftProducerFor(id: ShiftId): PortraitProducer {
  return {
    id,
    paragraph: 'identity',
    // The highest weight in the identity paragraph, and the reason the ranking
    // exists. Everything else on this page is something the reader could have
    // told you themselves; a change measured against their OWN prior window is
    // the one thing they cannot see from the inside. When accrual is present,
    // this takes the space from a steady fact rather than sitting beside it.
    weight: 1,
    produce(snapshot, ctx) {
      const winner = topShift(snapshot, ctx);
      if (!winner || winner.insight.id !== id) return null;
      // A change that cleared the separation gates is notable by construction:
      // the gates are what make it a change rather than noise.
      return { insights: [winner.insight], segments: winner.segments, notability: 1 };
    },
  };
}

export const rhythmShiftProducer = shiftProducerFor('shift-daypart');
export const focusShiftProducer = shiftProducerFor('shift-focus');
export const craftShiftProducer = shiftProducerFor('shift-work-type');

/**
 * Trend — whether the work is landing better or worse than it was.
 *
 * Payoff paragraph, because it is an outcome. Direction only, never a delta in
 * the prose: "holding up better than it was" is the claim, and the two rates that
 * justify it live on the card. A portrait that printed "+14 points" would be a
 * scoreboard, which is the thing this page is explicitly not.
 */
export const trendProducer: PortraitProducer = {
  id: 'trend',
  paragraph: 'payoff',
  // Same reasoning as the shift producers: whether the work is landing BETTER
  // than it was is unknowable without the prior window.
  weight: 1,
  produce(snapshot: DeveloperModelSnapshot): PortraitSentence | null {
    const accrual = snapshot.accrual;
    if (!accrual || accrual.sessions < PRIOR_MIN_SESSIONS) return null;

    const now = snapshot.outcomes.lineSurvival.rate;
    const was = accrual.lineSurvival.rate;
    // BOTH legs must have cleared their own n-floor. Comparing against a floored
    // null would be comparing against nothing and calling it an improvement.
    if (now === null || was === null) return null;

    const move = now - was;
    // SURVIVAL_MOVE alone guarded a rate whose DENOMINATOR was unbounded below.
    // The worker nulls the rate under three rated commits but never floors the
    // line count, and the rate is lines over lines — so three commits touching
    // four lines gave a 100% baseline, and the read told someone whose 1,200-line
    // window survived at 86% that their work was holding up worse than before.
    // The card's own boundary made it worse by citing the commit floor as the
    // guarantee behind a rate taken over four lines.
    //
    // So the required move scales to the smaller sample: it has to be worth more
    // than five of its lines. At 20 lines that demands 25 points, at 200 it
    // relaxes to the existing 10 and nothing changes for a real window.
    const floorLines = Math.max(
      1,
      Math.min(snapshot.outcomes.lineSurvival.linesAuthored, accrual.lineSurvival.linesAuthored),
    );
    if (Math.abs(move) < Math.max(SURVIVAL_MOVE, 5 / floorLines)) return null;
    const better = move > 0;
    const rangeWord = priorWindowNoun(snapshot.scope.rangeDays);

    const insight: ModelInsight = {
      id: 'survival-trend',
      facet: 'payoff',
      // "changed back more than it was" after "It is " is a stative passive that
      // reads as a completed state with nothing for the comparative to attach to.
      // The card body already said it correctly; the term did not.
      linkedTerm: better ? 'holding up better than it was' : 'getting changed back more than it was',
      // NOT "What changed": the one shift sentence in the identity paragraph
      // carries that header, and both can render in the same read, which put two
      // differently-measured cards under one title.
      label: 'Whether it is holding up',
      hoverLines: [
        `${pct(now)} of your landed lines are still there, against ${pct(was)} the window before.`,
      ],
      squircle: {
        // Anti-grade even in the down direction: more rewriting is a fact about
        // the work, not a mark against the person, and the copy says what moved
        // rather than how well you did.
        // The SIZE of the move, which is the one thing the prose may not carry — a
        // portrait that printed "+14 points" in the read would be a scoreboard,
        // and a card that only repeats the direction adds nothing to the term
        // that already stated it.
        detail: `That is a move of ${Math.round(Math.abs(move) * 100)} lines in a hundred.`,
        citations: [
          {
            text: `Now ${rateOf(now, snapshot.outcomes.lineSurvival.linesSurviving, snapshot.outcomes.lineSurvival.linesAuthored, 'landed lines still present')}`,
            field: 'outcomes.lineSurvival.rate',
          },
          {
            text: `Before, ${rateOf(was, accrual.lineSurvival.linesSurviving, accrual.lineSurvival.linesAuthored, 'lines')}`,
            field: 'accrual.lineSurvival.rate',
          },
          {
            text: `Both legs cleared the same floor of ${count(3)} rated commits before either rate was spoken`,
            field: 'accrual.lineSurvival',
          },
          // The portrait's other comparison names its window; this one, which
          // needs it most, named none. The two legs are split on when each
          // SURVIVAL CHECK ran, not on when the sessions ran, so "before" here
          // means a different thing from "last period" on the shift cards a
          // paragraph above and a reader had no way to notice.
          boundary(
            `Compared against the ${rangeWord} immediately before this one, split on when each survival check ran`,
            'accrual.lineSurvival',
          ),
        ],
      },
    };

    return {
      notability: 1,
      insights: [insight],
      segments: [
        { type: 'text', text: 'It is ' },
        { type: 'insight', insightId: 'survival-trend' },
        { type: 'text', text: '. ' },
      ],
      // "It" is the survival sentence's "What you wrote", and that sentence is
      // silent on exactly the windows a reader most wants this one for — a low
      // survival rate. Opening the paragraph, the nearest noun was the project
      // named a paragraph earlier.
      leadSegments: [
        { type: 'text', text: 'What you wrote is ' },
        { type: 'insight', insightId: 'survival-trend' },
        { type: 'text', text: '. ' },
      ],
    };
  },
};

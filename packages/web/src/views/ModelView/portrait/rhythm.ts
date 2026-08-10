import type { DeveloperModelSnapshot, HourBucket } from '@seorak/types';

import { daypartMeta } from '../../../lib/localTime.js';
import type { DaypartId } from '../../../lib/localTime.js';
import type { ModelInsight } from '../modelPresentationTypes.js';
import { daypartRanking, dominantDaypart } from './daypart.js';
import { boundary, count, otherThings, rateOf, remainderText, runnersUp } from './evidence.js';
import { article, concentration } from './format.js';
import type { PortraitContext, PortraitProducer, PortraitSentence } from './types.js';

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A weekday needs this many starts before it can be called steady. */
const STEADY_MIN_SESSIONS = 2;
/** How close the runner-up must sit to the leader before the two are a PAIR
 *  rather than a leader and an also-ran. Unchanged from the original band. */
const STEADY_PAIR_BAND = 0.75;


interface SteadyDay {
  name: string;
  sessions: number;
}

/**
 * The two weekdays the reader's week actually leans on, or nothing.
 *
 * The band was `>= lead * 0.75` followed by `.slice(0, 2)`, and the slice is
 * where it went wrong: the band decides which days may JOIN the top, but nothing
 * asked whether the top was separated from the days it beat. A perfectly FLAT
 * week passes trivially — every day clears 0.75 of the lead — so the read told a
 * developer with three sessions on each of seven days that they were "steadiest
 * on Sundays and Mondays", while the card underneath listed five more days at the
 * identical count. Worse, the pair was decided by `Array#sort` stability over Map
 * insertion order, i.e. by which weekday held the earliest session in the window,
 * so sliding the window one day renamed the pair on unchanged behaviour.
 *
 * ── Two questions, two tests ────────────────────────────────────────────────
 * Requiring the band to hold EXACTLY two made it mean what the slice assumed, and
 * introduced the opposite failure: the cliff is `0.75 x the LEAD`, so the bigger
 * the leader the more of the week falls inside it.
 *
 * On the owner's real month — Thursday 93, Wednesday 91, Tuesday 70, then 44, 30,
 * 12, 9 — the cliff lands at 69.75 and Tuesday clears it by a quarter of a
 * session, so the band holds three and a week with an obvious two-day spine said
 * nothing at all. That is a real answer suppressed by a threshold, not a close
 * call declined.
 *
 * The band was being asked two different things at once. They are now separate:
 *
 *   1. are the top two a PAIR — is the runner-up within `STEADY_PAIR_BAND` of the
 *      leader, or is this a one-day week with a distant second;
 *   2. is the pair SEPARATED — is the drop from the second day to the third
 *      LARGER than the gap inside the pair itself.
 *
 * The second test carries no constant at all, and that is deliberate. A drafted
 * version used a ratio (`third <= 0.8 x second`) fitted to the shape above, and
 * on the owner's real month it decided the sentence by eight tenths of a session
 * — the same threshold luck it was written to remove, pointing the other way. A
 * pair is separated when the step down to the rest of the week is bigger than the
 * step between the two days being named, which is scale-free and true at any
 * volume: 96/91/72 clears it 19 to 5, and no rescaling of the window changes that.
 *
 * Every case the previous rule was written for still holds: a flat 3/3/3/3/3/3/3
 * goes quiet (0 is not > 0), a flat-with-a-tilt 5/4/4/4/4 goes quiet (0 is not >
 * 1), a gently sloped 10/9/8/7 goes quiet (1 is not > 1), and a real two-day
 * rhythm (5, 4, 1) and a genuine lean (6, 5, 2, 2) still speak (3 > 1). Ties are
 * broken by weekday index rather than payload order, so identical counts always
 * produce the identical portrait.
 */
function steadiestDays(localBuckets: HourBucket[], minSessions: number): {
  top: SteadyDay[];
  rest: SteadyDay[];
} {
  const byDow = new Map<number, number>();
  for (const b of localBuckets) {
    byDow.set(b.dow, (byDow.get(b.dow) ?? 0) + b.sessions);
  }
  const ranked = [...byDow.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([dow, sessions]) => ({ name: DOW_NAMES[dow], sessions }));
  const eligible = ranked.filter((d) => d.sessions >= minSessions);
  if (eligible.length < 2) return { top: [], rest: [] };

  const [first, second, third] = eligible;
  if (second.sessions < first.sessions * STEADY_PAIR_BAND) return { top: [], rest: [] };
  if (third && second.sessions - third.sessions <= first.sessions - second.sessions) {
    return { top: [], rest: [] };
  }

  const top = [first, second];
  const names = new Set(top.map((d) => d.name));
  return { top, rest: ranked.filter((d) => !names.has(d.name)) };
}

function daypartInsight(
  id: DaypartId,
  partSessions: number,
  sessionTotal: number,
  localHours: HourBucket[],
): ModelInsight {
  const part = daypartMeta(id).label;
  const others = daypartRanking(localHours)
    .filter((d) => d.id !== id)
    .map((d) => ({ name: daypartMeta(d.id).label, sessions: d.sessions }));
  return {
    id: 'daypart',
    facet: 'rhythm',
    linkedTerm: `${part} developer`,
    // What this card MEASURED, not the facet it belongs to. The facet is already
    // carried by the card's hue, and heading it "When you work" put the identical
    // title on the weekday card beside it — two different measurements under one
    // label, on a surface whose whole job is telling a reader what they are
    // looking at.
    label: 'When you start',
    // The peek carries the NUMBER. It used to be a bare gist, and a hover put a
    // card-shaped surface on screen with a connector pointing at it and nothing
    // inside — which reads as broken, not as restraint. One complete sentence
    // with the count behind the claim is the right size for a hover; the full
    // citation trail still waits for a click.
    hoverLines: [
      `${count(partSessions)} of ${count(sessionTotal)} session starts were in the ${part}, on your clock.`,
    ],
    squircle: {
      // The REMAINDER, not an adverb. `dominantDaypart` clears at a 40% share
      // separated by 10 points, so this line asserted "most" over 11 of 25 — the
      // read's own prose routes every adverb through a measured gate and the card
      // meant to prove it did not. See `remainderText`.
      detail: remainderText({
        numerator: partSessions,
        denominator: sessionTotal,
        unit: 'starts',
        rest: 'were spread across the rest of the day',
        whole: 'Not one session in this window started at any other time of day.',
      }),
      citations: [
        {
          // The rate, where the peek one tier up carries the counts. They used to
          // be the same sentence with the full stop removed, so pinning a daypart
          // added nothing at the top of the card.
          text: `${rateOf(partSessions / sessionTotal, partSessions, sessionTotal, 'session starts')} were in the ${part}`,
          field: 'activity.hourlyDistribution',
        },
        // The runners-up, for the same reason the focus card carries them: naming
        // a leader without saying what it led is what makes a real concentration
        // and a near-tie look identical. This was the one card in the portrait
        // that named a leader and showed nothing it beat.
        ...runnersUp(
          others,
          (d) => d.name,
          (d) => d.sessions,
          'activity.hourlyDistribution',
          'starts',
        ),
        boundary(
          `The ${part} is ${daypartMeta(id).range} on your clock`,
          'activity.hourlyDistribution',
        ),
        boundary(
          'Counted from when each session STARTED, not how long it ran',
          'activity.hourlyDistribution',
        ),
        boundary(
          'Cadence only. When you work is not a measure of how well it went',
          'activity.hourlyDistribution',
        ),
      ],
    },
  };
}

function steadyDaysInsight(
  top: SteadyDay[],
  rest: SteadyDay[],
  sessionTotal: number,
): ModelInsight {
  const held = top[0].sessions + top[1].sessions;
  const otherDays = rest.filter((d) => d.sessions > 0).length;
  return {
    id: 'steady-days',
    facet: 'rhythm',
    linkedTerm: `${top[0].name}s and ${top[1].name}s`,
    label: 'Which days',
    hoverLines: [
      `${top[0].name} and ${top[1].name} hold ${count(held)} of your ${count(sessionTotal)} starts.`,
    ],
    squircle: {
      // Was "Your week leans on a couple of days", which is the sentence the
      // reader clicked, said again. The remainder is the part they cannot see
      // from the term: whether the rest of the week is one quiet day or five.
      detail: remainderText({
        numerator: held,
        denominator: sessionTotal,
        unit: 'starts',
        rest: `were spread across ${otherThings(otherDays, 'day')}`,
        whole: 'No session in this window started on any other day.',
      }),
      citations: [
        // This card used to say only "Tuesday and Wednesday saw the most session
        // starts" — a ranking with no quantity behind it, so a reader could not
        // tell a real lean from a one-session margin.
        {
          // "Tuesday: 8, Wednesday: 7, of 17 starts" reads as though Wednesday's 7
          // were the 7 of 17, which is the one thing this card exists to state.
          // The pair's own total goes first, then the split.
          text: `${rateOf(held / sessionTotal, held, sessionTotal, 'starts')} fell on those two days, ${top.map((d) => `${d.name} ${count(d.sessions)}`).join(' and ')}`,
          field: 'activity.hourlyDistribution',
        },
        ...runnersUp(rest, (d) => d.name, (d) => d.sessions, 'activity.hourlyDistribution', 'starts'),
        boundary(
          'Weekdays are counted on your clock, so a late session belongs to the day you started it',
          'activity.hourlyDistribution',
        ),
      ],
    },
  };
}

/**
 * Rhythm — when you show up, ON THE READER'S CLOCK.
 *
 * The buckets arrive in UTC because the worker cannot know where the reader is
 * (`getUTCHours` / `getUTCDay` in eventlog/developerModel.ts), and this producer
 * used to read them as if they were local: it asked whether hours 18-23 held most
 * of the starts and called that "an evening developer". For a developer in UTC-8
 * that band is 10:00 to 15:00 their time, and their real 21:00 sessions landed in
 * 05:00-11:00 UTC — so the read told a night owl they were a MORNING developer,
 * in the sentence the whole page is built around. The weekday was wrong with it,
 * because a Tuesday-evening session is a Wednesday in UTC.
 *
 * Both claims now come off `ctx.localHours`, shifted once for the whole portrait,
 * and the daypart table is the one every surface shares (lib/localTime.ts). All
 * four dayparts can be named, where the old band pair could only ever say morning
 * or evening and fell silent on an afternoon or night developer.
 *
 * One sentence covers BOTH the daypart and the steadiest weekdays, because they
 * are one claim about the same buckets and splitting them across two producers is
 * how they went out of step before: each appended its own connective to a shared
 * array, and the steady-days clause could land after the daypart lead as "you've
 * been an Wednesdays and Thursdays are steadiest".
 */
export const rhythmProducer: PortraitProducer = {
  id: 'rhythm',
  paragraph: 'identity',
  // When someone works is a real fact about them, but it is also one they can
  // check against their own memory in a second.
  weight: 0.7,
  produce(_snapshot: DeveloperModelSnapshot, ctx: PortraitContext): PortraitSentence | null {
    const sessionTotal = ctx.sessionTotal;
    // The SAME call the context made, so the daypart this sentence names and the
    // one the payoff paragraph refers back to can never disagree.
    const top = dominantDaypart(ctx.localHours, sessionTotal);

    const daypart = top
      ? daypartInsight(top.id, top.sessions, sessionTotal, ctx.localHours)
      : null;

    const days = steadiestDays(ctx.localHours, STEADY_MIN_SESSIONS);
    const steady =
      days.top.length >= 2 ? steadyDaysInsight(days.top, days.rest, sessionTotal) : null;

    if (!daypart && !steady) return null;

    // A window whose starts are spread evenly across the day says nothing about
    // when this person works, even when one daypart technically leads.
    const notability = top ? concentration(top.sessions / sessionTotal, 4) : 0.3;

    if (daypart && steady) {
      return {
        notability,
        insights: [daypart, steady],
        segments: [
          { type: 'text', text: `Lately you’ve been ${article(daypart.linkedTerm)} ` },
          { type: 'insight', insightId: daypart.id },
          { type: 'text', text: ', steadiest on ' },
          { type: 'insight', insightId: steady.id },
          { type: 'text', text: '. ' },
        ],
      };
    }

    if (daypart) {
      // The trailing '. ' is load-bearing and used to be missing: with no steady
      // days the old compiler left the daypart insight as the last segment and the
      // next sentence ran straight into it ("...an evening developerMost of your
      // time went to seorak"). A producer that owns a whole sentence cannot end
      // mid-clause.
      return {
        notability,
        insights: [daypart],
        segments: [
          { type: 'text', text: `Lately you’ve been ${article(daypart.linkedTerm)} ` },
          { type: 'insight', insightId: daypart.id },
          { type: 'text', text: '. ' },
        ],
      };
    }

    return {
      notability,
      insights: [steady!],
      segments: [
        { type: 'text', text: 'Your week leaned on ' },
        { type: 'insight', insightId: steady!.id },
        { type: 'text', text: '. ' },
      ],
    };
  },
};

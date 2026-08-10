import type { ModelAnnotationCitation } from '../modelPresentationTypes.js';
import { pct } from './format.js';

/**
 * The evidence contract for an annotation card.
 *
 * Every claim in the read is a term a reader can pull, and the card behind it has
 * exactly one job: let them check the claim. That takes three things, and the
 * cards were shipping an inconsistent subset of them —
 *
 *   1. the COUNTS the claim is made of, never a bare percentage;
 *   2. the BOUNDARY it was counted against (the hours a daypart covers, the
 *      window a comparison used, the floor a rate had to clear);
 *   3. the DERIVATION, when the number does not obviously follow from its name
 *      ("branch work type" is read off a branch name; "still there" is a blame
 *      check against the branch tip).
 *
 * `84% of landed lines were still there later` had none of the three: no counts,
 * no definition of later, and no way to ask 84% of what. A rate a reader cannot
 * check is a claim wearing a measurement's clothes, which is precisely what the
 * honesty rules exist to prevent — and a card is where the numbers are ALLOWED to
 * be, since the prose deliberately carries none.
 */

/** Crude de-pluralize for a unit word, so a runner-up with one of something does
 *  not read "1 starts". Only the regular case, which is every unit this file
 *  passes; anything irregular should be handed in already correct. */
function singular(unit: string): string {
  return unit.endsWith('s') ? unit.slice(0, -1) : unit;
}

/**
 * A rate over a denominator, WITHOUT inventing the numerator.
 *
 * `rateOf` is for the cases where both counts were measured. Where only the rate
 * and the denominator crossed the wire, multiplying them back out would print a
 * count that was never counted — off by one at any rounding boundary, and stated
 * with the same confidence as a real one.
 */
export function rateOverText(rate: number, denominator: number, unit: string): string {
  return `${pct(rate)} of ${count(denominator)} ${unit}`;
}

/** Thousands separators, so a five-figure line count is readable at a glance. */
export function count(n: number): string {
  return n.toLocaleString();
}

/**
 * A rate stated as the division it is: "68% — 17 of 25 finished sessions".
 * The em-dash-free form keeps to the house copy rules.
 */
export function rateOf(
  rate: number,
  numerator: number,
  denominator: number,
  unit: string,
): string {
  return `${pct(rate)}, ${count(numerator)} of ${count(denominator)} ${unit}`;
}

/** The boundary a claim was counted against. Always its own line, so it reads as
 *  a definition rather than as more evidence. */
export function boundary(text: string, field: string): ModelAnnotationCitation {
  return { text, field };
}

/**
 * How many runners-up a card NAMES before it starts counting them instead.
 *
 * There was no cap, and the tail is unbounded: a developer with eleven active
 * repos got one citation naming ten of them with their counts, 216 characters
 * wide, inside a 340px margin card — and the same line listed twelve languages
 * on the stack card. A list that long is not something a reader checks, it is
 * something they skip, which costs the card the runner-up line entirely. Three is
 * what fits on two lines at the card's width, and what is dropped is still
 * counted rather than silently truncated.
 */
const RUNNERS_UP_NAMED = 3;

/**
 * And a ceiling on the WHOLE line, because three named runners-up is short for
 * languages ("Rust (180 calls)") and long for end reasons ("pick a session back
 * up (4 sessions)"), and the "and four more" tail is itself forty characters.
 * Three lines at the card's 340px, against the 216 the uncapped version reached.
 */
const RUNNERS_UP_CHARS = 150;

/**
 * The runners-up, WITH their counts. Cards used to say "Then Rust and CSS", which
 * names the losers without saying whether they were a close second or a rounding
 * error — the one thing a reader wants from a runner-up line.
 */
export function runnersUp<T>(
  items: T[],
  label: (item: T) => string,
  value: (item: T) => number,
  field: string,
  unit: string,
): ModelAnnotationCitation[] {
  if (items.length === 0) return [];
  const entry = (i: T) => `${label(i)} (${count(value(i))} ${value(i) === 1 ? singular(unit) : unit})`;

  const line = (takeCount: number) => {
    const named = items.slice(0, takeCount);
    const rest = items.slice(takeCount);
    const restTotal = rest.reduce((sum, i) => sum + value(i), 0);
    const tail =
      rest.length === 0
        ? ''
        : `, and ${spelled(rest.length)} more with ${count(restTotal)} ${restTotal === 1 ? singular(unit) : unit} between them`;
    return `Then ${named.map(entry).join(', ')}${tail}`;
  };

  // The most runners-up that fit, never fewer than one: a line naming nobody is
  // worse than a long one, and what is dropped is still counted in the tail.
  let text = line(1);
  for (let take = Math.min(RUNNERS_UP_NAMED, items.length); take >= 1; take -= 1) {
    const candidate = line(take);
    if (candidate.length <= RUNNERS_UP_CHARS || take === 1) {
      text = candidate;
      break;
    }
  }
  return [{ text, field }];
}

/**
 * What the leading count LEAVES OUT.
 *
 * The one line on a pinned card that is not a citation used to be an editorial
 * gloss, and it failed in both available directions: it either restated the
 * sentence the reader had just clicked ("Your week leans on a couple of days"
 * under «Tuesdays and Wednesdays») or it asserted an adverb the gate had never
 * measured ("You start most of your sessions in the afternoon" over 11 of 25).
 * A card whose only non-evidence line is wrong is worse than one with no line at
 * all, because it is the line a reader reads first.
 *
 * The remainder is the fix for both. It is derived from the same two counts the
 * card already states, so it cannot disagree with them; and it is the one thing a
 * reader checking a proportion cannot get from the card without doing the
 * subtraction themselves. "30%, 30 of 100 sessions" is a number. "The other 70
 * sessions were spread across ten other projects" is what that number MEANS, and
 * it is what makes a 30% leader legible as a real concentration rather than a
 * bare fraction.
 */
export function remainderText(opts: {
  numerator: number;
  denominator: number;
  /** Plural noun for the DENOMINATOR: "sessions", "starts", "edit calls". */
  unit: string;
  /**
   * The rest of the sentence, VERB INCLUDED — "were spread across ten other
   * projects", "had been changed by the last check".
   *
   * The verb belongs to the caller because the remainder is not always a simple
   * predicate: the daypart cards qualify the noun first ("lines FROM evening
   * sessions had been changed"). An earlier draft inserted "were" itself and
   * produced "The other 60 lines were from evening sessions had been changed by
   * the last check" on every read that rated a daypart — which is exactly the kind
   * of defect the card harness exists to surface, since it is invisible in a
   * template and obvious in a rendered card.
   */
  rest: string;
  /** The sentence when the leader took everything, so the card never prints a
   *  remainder of zero. */
  whole: string;
}): string {
  const left = opts.denominator - opts.numerator;
  if (left <= 0) return opts.whole;
  // A remainder of one is a different sentence, not the same one with a 1 in it:
  // "The other 1 start were spread across the rest of the day" reached the card
  // harness intact, because the caller owns the verb and cannot see the count. The
  // only verb that has to agree is the copula every caller opens with.
  if (left === 1) {
    return `One other ${singular(opts.unit)} ${opts.rest.replace(/^were\b/, 'was')}.`;
  }
  return `The other ${count(left)} ${opts.unit} ${opts.rest}.`;
}

/** English for a small count, so a card body reads as a sentence rather than as
 *  a spreadsheet cell. Past twelve the digits are clearer than the word. */
const SMALL_NUMBERS = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

export function spelled(n: number): string {
  return n >= 0 && n < SMALL_NUMBERS.length ? SMALL_NUMBERS[n] : count(n);
}

/** "three other projects" / "one other project", for a remainder's spread. */
export function otherThings(n: number, noun: string): string {
  return `${spelled(n)} other ${n === 1 ? noun : `${noun}s`}`;
}

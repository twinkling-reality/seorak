/**
 * The portrait producer contract (docs/specs/introspection.md).
 *
 * A producer owns ONE SENTENCE of the read, end to end: the insights its terms
 * resolve to, and the grammar that joins them. That boundary is the whole point.
 * The compiler used to be a single function of stacked `if` blocks that appended
 * connectives to a shared segment array, and blocks that could not see each other
 * had to guess what came before — one of them by string-searching the array for
 * the substring `'went to'`. It shipped `you've been an Wednesdays and Thursdays
 * are steadiest` to production. A sentence that is assembled in one place cannot
 * fail that way, and a new facet is a new file rather than an edit in the middle
 * of someone else's paragraph.
 */

import type { DeveloperModelSnapshot, HourBucket } from '@seorak/types';

import type { DaypartId } from '../../../lib/localTime.js';
import type { ModelInsight, ModelNarrativeSegment } from '../modelPresentationTypes.js';

/**
 * Everything a producer may read besides the snapshot. INJECTED, never ambient.
 *
 * The clock is the reason this exists. The worker buckets session hours in UTC
 * (`getUTCHours` / `getUTCDay`) because it cannot know where the reader is, so
 * every claim about the reader's day has to be shifted on read. Passing the
 * offset in — rather than calling `new Date().getTimezoneOffset()` inside a
 * producer — is what lets a test pin a night owl in UTC-8 and get the same answer
 * on any machine.
 */
export interface PortraitContext {
  /** `Date.getTimezoneOffset()` convention: minutes to ADD to local to reach UTC. */
  offsetMinutes: number;
  /**
   * The same convention, but the offset that was in force in the middle of the
   * PRIOR window.
   *
   * It exists because the wire carries (dow, hour) and no date, so the whole
   * compile shifts both windows by one offset — and that is wrong for the prior
   * one whenever a daylight-saving transition falls between them. Injected, like
   * `offsetMinutes` and for the same reason: a producer that probed the ambient
   * zone itself would give a different portrait on every machine and could not be
   * tested at all.
   */
  priorOffsetMinutes: number;
  /**
   * `activity.hourlyDistribution` already shifted into the viewer's clock.
   * Localized ONCE here and shared, so two producers cannot disagree about which
   * weekday a session ran on — the shift can move a session's `dow`, and two
   * independent shifts of the same buckets is exactly how that would drift.
   */
  localHours: HourBucket[];
  /** In-window session starts the hour buckets account for. */
  sessionTotal: number;
  /**
   * The daypart the rhythm sentence names, or null when none was dominant enough
   * to name.
   *
   * It lives HERE, derived once, rather than one producer asking another what it
   * said. That distinction is the whole reason the payoff paragraph can be a
   * portrait instead of a list: "you work afternoons" and "your afternoon work
   * lasts longest" are one insight, and stating them five sentences apart as
   * unrelated facts is what made the read feel like a form. More importantly it
   * lets the read say when the two DISAGREE — you work afternoons but your
   * mornings are what last — which is the most useful thing this page can tell
   * someone and was unsayable while each producer only knew its own half.
   */
  rhythmDaypart: DaypartId | null;
}

/**
 * One complete sentence of the portrait.
 *
 * `segments` is the sentence as it reads when something precedes it in its
 * paragraph. `leadSegments` is the form it takes when it OPENS the paragraph —
 * "Lately seorak." rather than "Most of your time went to seorak." A producer
 * that reads the same either way omits it.
 *
 * Both forms must be complete: capitalised, ending in `'. '`. The assembler joins
 * them and never edits inside one.
 */
export interface PortraitSentence {
  insights: ModelInsight[];
  segments: ModelNarrativeSegment[];
  leadSegments?: ModelNarrativeSegment[];
  /**
   * 0–1: how far THIS window's answer sits from the unremarkable case.
   *
   * A producer knowing it *can* speak is not the same as its answer being worth
   * reading. "You worked most often in TypeScript" is true of this developer every
   * single window and tells them nothing they did not already know; the same
   * sentence about a language that was 4% of last month is worth the space.
   *
   * Defaults to 0.5 when a producer has no opinion.
   */
  notability?: number;
}

/** Which paragraph a sentence belongs to. Identity leads, outcomes support
 *  (introspection.md hard rule 1) — the assembler never interleaves them. */
export type PortraitParagraph = 'identity' | 'payoff';

export interface PortraitProducer {
  /** Stable id, for tests and for naming the producer in a failure. */
  id: string;
  paragraph: PortraitParagraph;
  /**
   * 0–1: the editorial CEILING of this facet — how much it could ever tell
   * someone about themselves, at its most interesting.
   *
   * Separate from `notability`, which is about this window; the two multiply.
   * A facet can be perfectly measured, perfectly concentrated, and still not
   * worth a sentence: that a developer closes the chat when they finish is a fact
   * about a keystroke, and no amount of concentration makes it a portrait. A
   * CHANGE is the one thing a reader cannot already know about themselves, so the
   * shift and trend producers carry the highest weights and take the space as
   * soon as there is a prior window to compare against.
   */
  weight: number;
  /** Returns null when the window does not support the claim. Honest-empty is a
   *  producer returning nothing, never a sentence with a zero in it. */
  produce(snapshot: DeveloperModelSnapshot, ctx: PortraitContext): PortraitSentence | null;
}

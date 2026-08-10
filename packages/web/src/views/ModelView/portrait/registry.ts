import { craftProducer } from './craft.js';
import { focusProducer } from './focus.js';
import { habitsProducer } from './habits.js';
import { daypartPayoffProducer, frictionProducer, survivalProducer } from './payoff.js';
import { rhythmProducer } from './rhythm.js';
import {
  craftShiftProducer,
  focusShiftProducer,
  rhythmShiftProducer,
  trendProducer,
} from './shift.js';
import { stackProducer } from './stack.js';
import type { PortraitProducer } from './types.js';

/**
 * The portrait, in reading order.
 *
 * Order is the WHOLE editorial decision and it lives here rather than inside any
 * producer, so adding a facet is appending a line to this list and cannot
 * reshuffle the paragraph around it. Identity leads and outcomes support
 * (introspection.md hard rule 1), and within identity the read moves from when,
 * to where, to what, to how — the order a person would answer "what have you been
 * up to" in.
 *
 * Eight producers, not eight sentences. Each one is silent unless the window
 * measured what it speaks about, and each covers a GROUP of related insights
 * rather than one field, which is what keeps a rich window a portrait instead of
 * a list: the stack sentence carries the language and the model, craft carries
 * the work type and the tools, habits carries verification and how sessions end.
 * Splitting per field would have produced eleven one-clause sentences, which is
 * Overview with the widgets taken away.
 */
export const PORTRAIT_PRODUCERS: readonly PortraitProducer[] = [
  // Each accrual sentence sits IMMEDIATELY after the facet it is a change to, so
  // "the month before you were a morning developer" lands next to "lately you've
  // been an evening developer" instead of five sentences later where it reads as
  // an unrelated fact. At most one of the three ever speaks (see shift.ts).
  rhythmProducer,
  rhythmShiftProducer,
  focusProducer,
  focusShiftProducer,
  stackProducer,
  craftProducer,
  craftShiftProducer,
  habitsProducer,
  survivalProducer,
  daypartPayoffProducer,
  trendProducer,
  frictionProducer,
];

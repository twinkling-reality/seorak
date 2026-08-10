import type { HourBucket } from '@seorak/types';

import { DAYPART_IDS, daypartSessions } from '../../../lib/localTime.js';
import type { DaypartId } from '../../../lib/localTime.js';

/** A daypart must hold at least this share of the window's session starts before
 *  the read will name it. Below it, "when you work" has no answer worth printing. */
export const DAYPART_SHARE = 0.4;
/** And the window needs at least this many starts before a share means anything. */
export const DAYPART_MIN_SESSIONS = 3;
/**
 * How far the leading daypart must sit ABOVE the runner-up, as a share of the
 * window's starts.
 *
 * A share gate is not a separation gate, and only the second one is the question
 * this function is actually asked. With four dayparts, two of them can sit at 41%
 * and 39% and both clear `DAYPART_SHARE` — so the opening clause of the whole
 * page ("lately you've been an afternoon developer") was decided by a single
 * session, and said the opposite thing next period on unchanged behaviour. Worse,
 * an EXACT tie cleared it too and was resolved silently by `DAYPART_IDS` order:
 * reproducible, but reproducible is not true.
 *
 * The boundaries this protects are the ones real developers actually straddle —
 * 12:00 (lunch), 17:00 (end of the workday), 22:00. Ten points is deliberately
 * modest: a genuinely peaked window clears it by twenty to fifty, and the demo's
 * evening lead clears it by sixty-six. What it removes is the coin flip.
 */
export const DAYPART_MARGIN = 0.1;

export interface DominantDaypart {
  id: DaypartId;
  sessions: number;
}

/**
 * The daypart the reader's week actually leans on, or null when none does.
 *
 * Shared by the portrait context, the rhythm producer and the shift producer so
 * that "when you work", "when your work went best" and "when you used to work"
 * are all decided from one answer.
 *
 * Honest-empty when the answer is close: a window whose leader is within
 * `DAYPART_MARGIN` of the runner-up has no single time of day, and the rhythm
 * sentence still has its steadiest-weekdays half to fall back on.
 */
export function dominantDaypart(
  localHours: HourBucket[],
  sessionTotal: number,
): DominantDaypart | null {
  if (sessionTotal < DAYPART_MIN_SESSIONS) return null;
  const totals = daypartSessions(localHours);

  let best: DominantDaypart | null = null;
  let runnerUp = 0;
  for (const id of DAYPART_IDS) {
    const sessions = totals.get(id) ?? 0;
    if (sessions > (best?.sessions ?? 0)) {
      if (best) runnerUp = best.sessions;
      best = { id, sessions };
    } else if (sessions > runnerUp) {
      runnerUp = sessions;
    }
  }

  if (!best || best.sessions < sessionTotal * DAYPART_SHARE) return null;
  // Covers the exact tie as its own case: a zero gap can never clear a positive
  // margin, so the read no longer names one of two equal leaders as a fact.
  if (best.sessions - runnerUp < sessionTotal * DAYPART_MARGIN) return null;
  return best;
}

/** Every daypart that held a start, strongest first, for the runner-up line on
 *  the rhythm card. The daypart card was the one card in the portrait naming a
 *  leader without saying what it led, which is the difference a reader needs to
 *  tell a real concentration from a near-tie. */
export function daypartRanking(
  localHours: HourBucket[],
): Array<{ id: DaypartId; sessions: number }> {
  const totals = daypartSessions(localHours);
  return [...totals.entries()]
    .map(([id, sessions]) => ({ id, sessions }))
    .sort((a, b) => b.sessions - a.sessions || DAYPART_IDS.indexOf(a.id) - DAYPART_IDS.indexOf(b.id));
}

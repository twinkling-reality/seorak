import type {
  DeveloperModelSnapshot,
  LineSurvivalStartHourBucket,
  ShipStartHourBucket,
} from '@seorak/types';
import { CONDITIONAL_OUTCOME_FLOOR } from '@seorak/types';

import { DAYPART_IDS, daypartMeta, daypartOf, localHourOf } from '../../../lib/localTime.js';
import type { DaypartId } from '../../../lib/localTime.js';

/**
 * Fold the worker's UTC-hour outcome COUNTS onto the reader's dayparts, then
 * divide — in that order, and the order is the whole reason this file exists.
 *
 * The worker ships counts because it has no timezone (see @seorak/types
 * developer-model.ts). Folding first means the n-floor is applied to the bucket a
 * person actually reads — "evening" — rather than to twenty-four hourly slices
 * that would each fail it while the daypart they sum to clears it comfortably.
 */

export interface DaypartRate {
  daypart: DaypartId;
  label: string;
  rate: number;
  /** The two counts behind the rate, for the card's citation. Carried rather than
   *  reconstructed from `rate * denominator`, which would print a count that was
   *  never counted and be off by one at any rounding boundary. */
  numerator: number;
  denominator: number;
}

export interface DaypartSplit {
  /** Slices that cleared the floor, strongest first. */
  rated: DaypartRate[];
  /** Dayparts that held measured work but could not clear the floor, as the labels
   *  a reader sees. Carried, not dropped: a card that says "two other parts of the
   *  day did not have enough to rate" is honest about its own coverage, where
   *  silence reads as "you only ever worked in the evening". */
  belowFloor: string[];
}

function emptySplit(): DaypartSplit {
  return { rated: [], belowFloor: [] };
}

function foldToDayparts<T extends { hour: number }>(
  buckets: T[],
  offsetMinutes: number,
): Map<DaypartId, T[]> {
  const byPart = new Map<DaypartId, T[]>();
  for (const bucket of buckets) {
    const part = daypartOf(localHourOf(bucket.hour, offsetMinutes));
    const list = byPart.get(part);
    if (list) list.push(bucket);
    else byPart.set(part, [bucket]);
  }
  return byPart;
}

/** Strongest first; ties resolve by daypart order so the read is reproducible. */
function ranked(rates: DaypartRate[]): DaypartRate[] {
  return [...rates].sort(
    (a, b) =>
      b.rate - a.rate ||
      DAYPART_IDS.indexOf(a.daypart) - DAYPART_IDS.indexOf(b.daypart),
  );
}

export function survivalByDaypart(
  snapshot: DeveloperModelSnapshot,
  offsetMinutes: number,
): DaypartSplit {
  const buckets = snapshot.conditional?.lineSurvivalByStartHour;
  if (!buckets || buckets.length === 0) return emptySplit();

  const rated: DaypartRate[] = [];
  const belowFloor: string[] = [];
  for (const [part, group] of foldToDayparts<LineSurvivalStartHourBucket>(buckets, offsetMinutes)) {
    const linesAuthored = group.reduce((sum, b) => sum + b.linesAuthored, 0);
    const linesSurviving = group.reduce((sum, b) => sum + b.linesSurviving, 0);
    const commitsChecked = group.reduce((sum, b) => sum + b.commitsChecked, 0);
    if (commitsChecked < CONDITIONAL_OUTCOME_FLOOR.lineSurvivalCommits || linesAuthored === 0) {
      belowFloor.push(daypartMeta(part).label);
      continue;
    }
    rated.push({
      daypart: part,
      label: daypartMeta(part).label,
      rate: linesSurviving / linesAuthored,
      numerator: linesSurviving,
      denominator: linesAuthored,
    });
  }
  return { rated: ranked(rated), belowFloor };
}

export function shipByDaypart(
  snapshot: DeveloperModelSnapshot,
  offsetMinutes: number,
): DaypartSplit {
  const buckets = snapshot.conditional?.shipByStartHour;
  if (!buckets || buckets.length === 0) return emptySplit();

  const rated: DaypartRate[] = [];
  const belowFloor: string[] = [];
  for (const [part, group] of foldToDayparts<ShipStartHourBucket>(buckets, offsetMinutes)) {
    const determinable = group.reduce((sum, b) => sum + b.determinable, 0);
    const shipped = group.reduce((sum, b) => sum + b.shipped, 0);
    if (determinable < CONDITIONAL_OUTCOME_FLOOR.shipDeterminable) {
      belowFloor.push(daypartMeta(part).label);
      continue;
    }
    rated.push({
      daypart: part,
      label: daypartMeta(part).label,
      rate: shipped / determinable,
      numerator: shipped,
      denominator: determinable,
    });
  }
  return { rated: ranked(rated), belowFloor };
}

/**
 * The minimum gap between the best and worst rated daypart before the read will
 * name one. Two dayparts a point apart is not "your mornings are better", it is
 * the same number twice, and a portrait that says otherwise teaches the reader to
 * stop trusting the sentences beside it.
 *
 * This is the FLOOR, not the whole gate — see `standoutDaypart`.
 */
export const DAYPART_SPREAD = 0.1;

/**
 * The best daypart, but only when it is measurably better than the worst.
 *
 * A fixed rate delta cannot do that job at the sample sizes this actually runs
 * on, and the gate was unreachable at the floor. `shipDeterminable` is 5, so the
 * smallest admissible denominator makes every rate a multiple of 20 points —
 * twice the gate — and 3-of-5 against 2-of-5 printed "It shipped most often in
 * the evening" off ONE session. Survival is worse because the floor counts
 * COMMITS (3) while the rate divides LINES, and nothing floors the line count at
 * all: three commits touching eight lines makes one line 12.5 points, so flipping
 * a single line reversed the page's claim about when the reader's work holds up.
 *
 * So the required gap scales to the coarser of the two samples: it must be worth
 * at least TWO units of what is being divided, never less than `DAYPART_SPREAD`.
 * At 5 determinable sessions that demands 40 points (4-of-5 beats 2-of-5, 3-of-5
 * does not beat 2-of-5); at 8 lines it demands 25; past 20 it relaxes back to the
 * existing 10 and nothing changes. The cost is that the daypart sentence goes
 * quiet more often on thin windows, which is correct — today it names a best
 * daypart off a single line.
 */
export function standoutDaypart(split: DaypartSplit): DaypartRate | null {
  if (split.rated.length < 2) return null;
  const best = split.rated[0];
  const worst = split.rated[split.rated.length - 1];
  const coarsest = Math.max(1, Math.min(best.denominator, worst.denominator));
  const need = Math.max(DAYPART_SPREAD, 2 / coarsest);
  return best.rate - worst.rate >= need ? best : null;
}

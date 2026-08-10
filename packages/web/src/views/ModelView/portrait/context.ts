import type { DeveloperModelSnapshot, HourBucket } from '@seorak/types';

import { localizeHourBuckets } from '../../../lib/localTime.js';
import { dominantDaypart } from './daypart.js';
import type { PortraitContext } from './types.js';

function totalSessions(buckets: HourBucket[]): number {
  return buckets.reduce((sum, b) => sum + b.sessions, 0);
}

/**
 * Build the shared read context once per compile.
 *
 * `localizeHourBuckets` takes an east-positive HOUR offset while the rest of the
 * portrait speaks `getTimezoneOffset()` minutes (west-positive), so the sign flip
 * lives here, in one place, rather than at each call site where getting it
 * backwards would put a developer's evening twice as far from the truth as
 * leaving it in UTC.
 */
export function buildPortraitContext(
  snapshot: DeveloperModelSnapshot,
  offsetMinutes: number,
  /** The reader's offset in the middle of the prior window. Defaults to the
   *  current one: a caller that injected a fixed clock has injected a zone with
   *  no transitions in it, and only `compileSnapshotToPresentation` — where the
   *  ambient zone legitimately enters — knows better. */
  priorOffsetMinutes: number = offsetMinutes,
): PortraitContext {
  const localHours = localizeHourBuckets(
    snapshot.activity.hourlyDistribution,
    -offsetMinutes / 60,
  );
  // Counted on the localized buckets, which is the same total: the shift moves
  // sessions between buckets and never adds or drops one.
  const sessionTotal = totalSessions(localHours);

  return {
    offsetMinutes,
    priorOffsetMinutes,
    localHours,
    sessionTotal,
    rhythmDaypart: dominantDaypart(localHours, sessionTotal)?.id ?? null,
  };
}

import type { OverviewSnapshot } from '../lib/apiSchemas.js';
import { createEmptyOverview } from '../lib/apiSchemas.js';
import type { DataStatus } from '../lib/stores/pollingTypes.js';

/**
 * Map the aggregate poll lifecycle into the view's loading, hard-error, and
 * retained-snapshot contract. Once any real snapshot exists, a failed refresh
 * is stale and never a full-screen error.
 */
export function deriveOverviewViewState(
  overviewData: OverviewSnapshot | null,
  overviewStatus: DataStatus,
  pollError: string | null,
): { isLoading: boolean; error: string | null; isStale: boolean } {
  return {
    isLoading: !overviewData && (overviewStatus === 'idle' || overviewStatus === 'loading'),
    error: overviewData ? null : pollError,
    isStale: overviewData !== null && overviewStatus === 'stale',
  };
}

/**
 * Overlay the independently-polled live board only after it has produced a
 * response. A null board means "not read yet", so the aggregate's real live
 * rows remain visible; an explicit empty array is a measured quiet board.
 */
export function mergeLiveOverview(
  overviewData: OverviewSnapshot | null,
  liveSessions: OverviewSnapshot['live'] | null,
  rangeDays: number,
): OverviewSnapshot {
  const base = overviewData ?? createEmptyOverview(rangeDays);
  return liveSessions === null ? base : { ...base, live: liveSessions };
}

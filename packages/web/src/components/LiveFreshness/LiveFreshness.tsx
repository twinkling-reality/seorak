import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useLiveFreshness } from '../../hooks/useOverview.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import styles from './LiveFreshness.module.css';

/**
 * "Updated N ago" cue for the live board, driven by the GET /live `generatedAt`
 * (DATA-LAYER §ADR-006). Ticks every second so a board whose poll loop has
 * stopped or is failing reads visibly stale instead of silently lying — the
 * temporal half of the honest-empty contract. Renders nothing when there is no
 * server freshness to report (demo mode, or before the first /live lands).
 */
export default function LiveFreshness() {
  const { generatedAt, status } = useLiveFreshness();
  // Re-render once a second so the relative time advances between polls.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!generatedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [generatedAt]);

  if (!generatedAt) return null;

  const relative = formatRelativeTime(generatedAt) ?? 'just now';
  // 'stale' (kept a prior board after a failed refresh) / 'error' (never reached
  // the worker) = the board may be frozen; say so rather than show a calm stamp.
  const degraded = status === 'stale' || status === 'error';

  return (
    <span
      className={clsx(styles.freshness, degraded && styles.degraded)}
      title={degraded ? 'The live board may be stale. Reconnecting.' : 'Live board freshness'}
      aria-live="off"
    >
      <span className={styles.dot} aria-hidden="true" />
      {degraded ? `Reconnecting, updated ${relative}` : `Updated ${relative}`}
    </span>
  );
}

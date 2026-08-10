/**
 * ChatThinking — pending state for the Ask surface.
 *
 * A mono status line with an ink shimmer (processing, not live data — so no
 * lavender). Reusable label prop for future backend phases ("Reading cost",
 * "Checking sessions", etc.).
 */

import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './ChatThinking.module.css';
import motion from './chatMotion.module.css';

export function ChatThinking({ label = 'Checking your record' }: { label?: string }): ReactNode {
  return (
    <div className={styles.thinking} role="status" aria-live="polite" aria-label={label}>
      <span className={clsx(styles.thinkingShimmer, motion.thinkingShimmer)}>{label}</span>
    </div>
  );
}

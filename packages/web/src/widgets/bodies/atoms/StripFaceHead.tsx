import type { ReactNode } from 'react';
import styles from './StripFaceHead.module.css';

/**
 * The standard head for a Share-face widget (tool-mix, model-mix,
 * files-in-play): one value, one plain unit caption, nothing else. The strip
 * below is the primary viz; this is a supplemental anchor, not a stat-card
 * hero. Face ornament ban (DASHBOARD-CLARITY Precedent 1) applies: no
 * middot-joined facts, no second fact, no restated time scope — the range
 * pill and the widget header already carry those.
 */
export function StripFaceHead({
  value,
  caption,
  titleHint,
}: {
  value: ReactNode;
  caption: string;
  /** Derivation / trust-boundary detail — hover only, never face copy. */
  titleHint?: string;
}) {
  return (
    <div className={styles.head} title={titleHint}>
      <span className={styles.value}>{value}</span>
      <span className={styles.caption}>{caption}</span>
    </div>
  );
}

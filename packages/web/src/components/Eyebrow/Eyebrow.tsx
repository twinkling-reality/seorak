import type { ReactNode } from 'react';
import styles from './Eyebrow.module.css';

/**
 * Small uppercase mono label that sits above a section title, optionally
 * paired with an accent "Preview" pill. The pattern was duplicated verbatim
 * across the drill/detail views; this component is the single source of truth.
 *
 * When you need just the eyebrow string without a preview badge, pass
 * `showPreview={false}` (the default) - the wrapper row still renders so
 * spacing stays identical whether the badge is present or not.
 */
interface Props {
  label: ReactNode;
  showPreview?: boolean;
  /** Text rendered inside the accent pill. Defaults to "Preview". */
  previewLabel?: string;
}

export default function Eyebrow({ label, showPreview = false, previewLabel = 'Preview' }: Props) {
  return (
    <div className={styles.row}>
      <span className={styles.eyebrow}>{label}</span>
      {showPreview && <span className={styles.previewBadge}>{previewLabel}</span>}
    </div>
  );
}

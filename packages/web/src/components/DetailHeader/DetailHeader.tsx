import type { ReactNode } from 'react';
import DrillUpButton from '../DrillUpButton/DrillUpButton.js';
import styles from './DetailHeader.module.css';

interface Props {
  backLabel: string;
  onBack: () => void;
  title: string;
  subtitle?: string;
  /** Optional right-aligned slot - typically a RangePills control. Shares
   * a baseline with the subtitle so the two tie into the same "scope" line. */
  actions?: ReactNode;
}

/**
 * Shared header for drilled-in detail views (Usage, LiveNow, etc.). One
 * visual contract across surfaces: back link above, then the display title
 * on its own row, then a scope row with subtitle on the left and actions
 * on the right sharing a baseline.
 */
export default function DetailHeader({ backLabel, onBack, title, subtitle, actions }: Props) {
  return (
    <header className={styles.header}>
      <DrillUpButton label={backLabel} onClick={onBack} />
      <h1 className={styles.title}>{title}</h1>
      {(subtitle || actions) && (
        <div className={styles.scopeRow}>
          {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : <span />}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
    </header>
  );
}

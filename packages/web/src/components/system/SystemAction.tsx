/**
 * SystemAction — the takeover screens' outline action (RETURN HOME, RETRY, RELOAD).
 *
 * The system family used to take this control from `src/marketing`, which made the
 * public dashboard's failure screen read Seorak's own website tree. ADR 005 sends
 * marketing to the private repository, so the takeover screens carry their own.
 *
 * It is deliberately NOT `components/controls/OutlineActionButton`, whose module
 * comment claims it matches the marketing visuals: that primitive is a 32px pill on
 * a 6px radius with an 11px 500-weight label, sized for a settings row, and these
 * screens frame their action against a 240-280px ring. Geometry, type, and timings
 * below are the ones that already rendered here, so the boundary fix is invisible.
 *
 * Smaller than the marketing control on purpose. Both callers point "back", so the
 * right-stroke variant and the chevron have no caller here and are not carried.
 */

import { type ReactNode } from 'react';
import { systemStyles as styles } from './SystemDiagnostic.js';

export interface SystemActionProps {
  /** Renders an anchor. Omit for a button; RETURN HOME is a real link. */
  href?: string;
  onClick?: () => void;
  label: string;
  className?: string;
}

export function SystemAction({ href, onClick, label, className }: SystemActionProps): ReactNode {
  const cls = className ? `${styles.systemAction} ${className}` : styles.systemAction;
  const content = <span className={styles.systemActionLabel}>{label}</span>;

  if (href === undefined) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <a href={href} className={cls} onClick={onClick}>
      {content}
    </a>
  );
}

export default SystemAction;

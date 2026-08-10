/**
 * SystemError — inline "CONNECTION LOST".
 *
 * The non-takeover variant for view-level failures (a fetch that fell over) that
 * belong inside a content area, not over the whole screen. A small red-accent ring,
 * an all-caps title, optional diagnostics, the raw message, and a RETRY action.
 * Available for adoption by data views; not force-wired into the existing polling
 * error UX.
 */

import { type ReactNode } from 'react';
import { SegmentedRing, systemStyles as styles } from './SystemDiagnostic.js';

export function SystemError({
  title = 'CONNECTION LOST',
  message,
  onRetry,
  diagnostics,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  diagnostics?: [string, string][];
}): ReactNode {
  return (
    <div className={styles.inline} role="alert">
      <SegmentedRing size={64} accent="danger" progress={0.4} pulse />
      <div className={styles.inlineBody}>
        <span className={styles.inlineTitle}>{title}</span>
        {diagnostics && diagnostics.length > 0 ? (
          <div className={styles.inlineDiagnostics}>
            {diagnostics.map(([label, value]) => (
              <div key={label} className={styles.inlineDiag}>
                <span className={styles.inlineDiagLabel}>{label}</span>
                <span className={styles.inlineDiagValue}>{value}</span>
              </div>
            ))}
          </div>
        ) : null}
        {message ? <span className={styles.inlineMessage}>{message}</span> : null}
        {onRetry ? (
          <button type="button" className={styles.action} style={{ alignSelf: 'flex-start' }} onClick={onRetry}>
            {'RETRY -->'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default SystemError;

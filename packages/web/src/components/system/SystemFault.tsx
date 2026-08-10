/**
 * SystemFault — "SYSTEM FAULT".
 *
 * The app-shell error-boundary fallback. The rings keep turning (alive but jammed)
 * while the accent arc sits red at ~65%, a fault checklist names what broke, and
 * RETRY / RELOAD give a way out. Uses window.location.reload when the tree has
 * crashed.
 */

import { type ReactNode } from 'react';
import {
  SegmentedRing,
  ShimmerWord,
  SystemScreen,
  useIsNarrow,
  systemStyles as styles,
} from './SystemDiagnostic.js';
import { SystemAction } from './SystemAction.js';

const DEV = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);

const FAULT_READOUTS = [
  'render failed',
  'state lost',
  'trace → root',
  'recover ready',
  'record cut',
  'surface down',
  'retry available',
  'reload ready',
];

function FaultLine({ label, value, status }: { label: string; value: string; status: 'error' | 'warn' | 'ok' }): ReactNode {
  const color = status === 'error' ? 'var(--danger)' : status === 'warn' ? 'var(--warn)' : 'var(--soft)';
  return (
    <div className={styles.diagLine}>
      <span className={styles.faultDot} style={{ background: color, opacity: status === 'ok' ? 0.4 : 0.8 }} />
      <span className={styles.diagLabel}>{label}</span>
      <span className={styles.diagValue} style={{ color, opacity: status === 'ok' ? 0.5 : 0.9 }}>
        {value}
      </span>
    </div>
  );
}

export function SystemFault({ error, onRetry }: { error?: Error | null; onRetry?: () => void }): ReactNode {
  const narrow = useIsNarrow();
  const ringSize = narrow ? 160 : 240;

  return (
    <SystemScreen
      readouts={FAULT_READOUTS}
      role="alert"
      bottomLeft={<span className={styles.bottomCode}>SYS FAULT</span>}
      label="Something went wrong"
    >
      <SegmentedRing size={ringSize} accent="danger" progress={0.65} pulse />
      <div className={styles.hud}>
        <div className={styles.diagPanel}>
          <FaultLine label="RENDER:" value="FAILED" status="error" />
          <FaultLine label="STATE:" value="LOST" status="warn" />
          <FaultLine label="RECOVERY:" value="AVAILABLE" status="ok" />
        </div>
        <ShimmerWord error>SYSTEM FAULT</ShimmerWord>
        <div className={styles.actionRow}>
          {onRetry ? <SystemAction onClick={onRetry} label="Retry" /> : null}
          <SystemAction
            onClick={() => window.location.reload()}
            label="Reload"
            className={styles.faultSecondaryAction}
          />
        </div>
        {DEV && error ? <pre className={styles.devTrace}>{error.stack ?? error.toString()}</pre> : null}
      </div>
    </SystemScreen>
  );
}

export default SystemFault;

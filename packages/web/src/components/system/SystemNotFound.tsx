/**
 * SystemNotFound — "PAGE LOST".
 *
 * The 404 takeover. Same ring as the loader with the accent turned to the danger
 * red and frozen at ~35% (a halted signal), a faint 404 watermark in the ring, a
 * diagnostic panel, and a single RETURN HOME action. No router here: marketing nav
 * is plain `<a href>`, and the route is read once from window.location.
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

const NOTFOUND_READOUTS = [
  'no page',
  'route → ∅',
  'no record',
  'match = 0',
  'off the map',
  'nothing to derive',
  'trace lost',
  'path unknown',
];

function DiagnosticLine({ label, value, error = false }: { label: string; value: string; error?: boolean }): ReactNode {
  return (
    <div className={styles.diagLine}>
      <span className={styles.diagLabel}>{label}</span>
      <span className={error ? `${styles.diagValue} ${styles.diagValueError}` : styles.diagValue}>{value}</span>
    </div>
  );
}

export function SystemNotFound(): ReactNode {
  const narrow = useIsNarrow();
  const ringSize = narrow ? 180 : 280;
  const route = typeof window === 'undefined' ? '/' : window.location.pathname;

  return (
    <SystemScreen readouts={NOTFOUND_READOUTS} bottomLeft={<span className={styles.bottomCode}>ERR 404</span>} label="Page not found">
      <SegmentedRing size={ringSize} accent="danger" progress={0.35} pulse>
        404
      </SegmentedRing>
      <div className={styles.hud}>
        <div className={styles.diagPanel}>
          <DiagnosticLine label="ROUTE:" value={route} error />
          <DiagnosticLine label="STATUS:" value="NOT FOUND" error />
          <DiagnosticLine label="RECORD:" value="NONE" />
          <DiagnosticLine label="MATCH:" value="∅" />
          <DiagnosticLine label="RECOVERY:" value="AVAILABLE" />
        </div>
        <ShimmerWord error>PAGE LOST</ShimmerWord>
        <SystemAction href="/" label="Return home" />
      </div>
    </SystemScreen>
  );
}

export default SystemNotFound;

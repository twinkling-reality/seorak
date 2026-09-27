/**
 * SystemLoader — the boot screen.
 *
 * Indeterminate by default: a breathing segmented ring and a LOADING shimmer over
 * the facet field, with NO percentage, because nothing here can honestly measure
 * load progress (a Suspense fallback unmounts the instant its chunk resolves). The
 * determinate path — the counting percentage and the status checklist — renders
 * only when a caller passes a real `progress` (0..1), matching Seorak's rule:
 * show a real signal or show nothing, never an invented number.
 *
 * SystemMiniLoader is the compact, non-takeover variant for inline / centered
 * Suspense fallbacks (the home figure, the blog chunk).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ThinkingOrb } from 'thinking-orbs';
import {
  SegmentedRing,
  ShimmerWord,
  SystemScreen,
  useIsNarrow,
  useReducedMotion,
  systemStyles as styles,
} from './SystemDiagnostic.js';

// The collector's real derived stats. Decorative texture, never a measurement.
const LOADER_READOUTS = [
  'session state',
  'duration',
  'token cost',
  'stall',
  'commit',
  'line survival',
  'derive',
  'stat',
];

// The real local pipeline, shown only on the determinate path.
const STATUS_MESSAGES = [
  'COLLECTOR LINK',
  'STAT SYNC',
  'SESSION SCAN',
  'DERIVE STATE',
  'RECORD BUILD',
  'SURFACE READY',
];

function StatusItem({ label, done, active }: { label: string; done: boolean; active: boolean }): ReactNode {
  const color = done ? 'var(--soft)' : active ? 'var(--ink)' : 'var(--soft)';
  return (
    <div className={styles.statusItem} style={{ color, opacity: done ? 0.45 : active ? 1 : 0.3 }}>
      <span className={styles.statusLabel}>{label}</span>
      <div className={styles.statusTrack}>
        <div
          className={styles.statusFill}
          style={{
            width: done ? '100%' : active ? '60%' : '0%',
            background: done ? 'var(--soft)' : 'var(--accent)',
          }}
        />
      </div>
      <span className={styles.statusMark}>{done ? '✓' : active ? '…' : ''}</span>
    </div>
  );
}

// Indeterminate activity: the real pipeline stages, one gently "active" at a time
// on a loop. It claims no completion (no checkmarks) and no fraction (no number) —
// ambient "the system is working", the same honest register as the drifting
// readouts. Only the determinate path (with a real progress prop) shows the
// checklist with checkmarks and the percentage bar.
function ActivityList(): ReactNode {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % STATUS_MESSAGES.length), 900);
    return () => clearInterval(id);
  }, [reduce]);
  return (
    <div className={styles.activityList}>
      {STATUS_MESSAGES.map((msg, i) => {
        const on = i === active;
        return (
          <div key={msg} className={on ? `${styles.activityItem} ${styles.activityItemActive}` : styles.activityItem}>
            <span className={styles.activityDot} />
            <span className={styles.activityLabel}>{msg}</span>
            <span className={styles.activityMark}>{on ? '…' : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

export function SystemLoader({ progress }: { progress?: number }): ReactNode {
  const narrow = useIsNarrow();
  const reduce = useReducedMotion();
  const ringSize = narrow ? 200 : 320;
  const determinate = progress !== undefined;
  const pct = determinate ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : 0;
  const statusIndex = determinate
    ? Math.min(Math.floor((progress ?? 0) * STATUS_MESSAGES.length), STATUS_MESSAGES.length - 1)
    : 0;

  const bottomLeft = determinate ? (
    <span className={styles.progressRow}>
      <span className={styles.progressPct}>{pct}%</span>
      <span className={styles.progressTrack}>
        <span className={styles.progressFill} style={{ width: `${pct}%` }} />
      </span>
    </span>
  ) : (
    /* The indeterminate slot carries an orb, not the old sweeping line. A line
     * that fills reads as progress even when it measures nothing, which is the
     * one thing this path must not imply. `breathing` is the state that makes
     * no claim: the nine states are semantic, and rendering `solving` while a
     * lazy chunk resolves would invent an activity the loader cannot observe.
     * `theme="auto"` watches the `data-theme` attribute useTheme already sets,
     * so it follows the theme switch with no wiring of its own. */
    <ThinkingOrb state="breathing" size={20} theme="auto" paused={reduce} aria-label="Loading" />
  );

  return (
    <SystemScreen readouts={LOADER_READOUTS} bottomLeft={bottomLeft} label="Loading">
      <SegmentedRing size={ringSize} accent="live" progress={progress} />
      <div className={styles.hud}>
        {determinate ? (
          <div className={styles.statusList}>
            {STATUS_MESSAGES.slice(Math.max(0, statusIndex - 2), Math.max(4, statusIndex + 2)).map((msg, i) => {
              const realIdx = Math.max(0, statusIndex - 2) + i;
              return (
                <StatusItem key={msg} label={msg} done={realIdx < statusIndex} active={realIdx === statusIndex} />
              );
            })}
          </div>
        ) : (
          <ActivityList />
        )}
        <ShimmerWord>LOADING</ShimmerWord>
      </div>
    </SystemScreen>
  );
}

/** Compact ring for inline / centered Suspense fallbacks. `center` fills its positioned parent. */
export function SystemMiniLoader({
  label,
  size = 48,
  center = false,
}: {
  label?: string;
  size?: number;
  center?: boolean;
}): ReactNode {
  // The mini loader keeps its own light scaffold (no facet field / bottom bar),
  // so it can sit inside any container without taking over the viewport.
  //
  // The orb ships exactly two tuned sizes, 64 and 20, which are separate designs
  // rather than one design scaled, so an arbitrary `size` is snapped to the
  // nearer of the two instead of being passed through and silently ignored.
  const reduce = useReducedMotion();
  const orbSize = size >= 40 ? 64 : 20;
  return (
    <div className={center ? styles.miniCenter : styles.mini} role="status" aria-live="polite" aria-label={label ?? 'Loading'}>
      <ThinkingOrb state="breathing" size={orbSize} theme="auto" paused={reduce} aria-hidden />
      {label ? <span className={styles.miniLabel}>{label}</span> : null}
    </div>
  );
}

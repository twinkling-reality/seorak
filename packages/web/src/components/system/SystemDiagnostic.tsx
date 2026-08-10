/**
 * SystemDiagnostic — shared engine for the system screens.
 *
 * One token-driven `SegmentedRing` serves the loader, not-found, fault, and
 * inline states with shared reduced-motion behavior.
 *
 * Exports: useIsNarrow, useReducedMotion, GeometricBackground, DriftingReadouts,
 * SegmentedRing, ShimmerWord, SystemScreen.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import styles from './system.module.css';

// ── Hooks ──────────────────────────────────────────────────────────────────

/** Reactive narrow-viewport flag (matchMedia, no resize storm). */
export function useIsNarrow(query = '(max-width: 640px)'): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const onChange = (): void => setNarrow(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return narrow;
}

/** True when the user prefers reduced motion. Drives static readouts. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduce(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduce;
}

// ── Geometric facet background ───────────────────────────────────────────────

/**
 * The faint angled facets behind every system screen: six triangular spokes
 * radiating from center plus a diamond grid, masked to fade at the edges. Stroke
 * is ink at a very low group opacity so it reads as texture on the near-white
 * field, never as content.
 */
export function GeometricBackground(): ReactNode {
  return (
    <svg className={styles.geoBg} xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="sys-radial-mask" cx="50%" cy="48%" r="55%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="60%" stopColor="white" stopOpacity="0.25" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="sys-mask">
          <rect width="100%" height="100%" fill="url(#sys-radial-mask)" />
        </mask>
      </defs>
      <g mask="url(#sys-mask)" opacity="0.04" stroke="var(--ink)" fill="none" strokeWidth="0.5">
        {Array.from({ length: 6 }).map((_, i) => {
          const angle = (i * 60 - 90) * (Math.PI / 180);
          const cx = 720;
          const cy = 400;
          const r1 = 200;
          const r2 = 500;
          const spread = 0.15;
          const x1 = cx + r1 * Math.cos(angle);
          const y1 = cy + r1 * Math.sin(angle);
          const x2 = cx + r2 * Math.cos(angle - spread);
          const y2 = cy + r2 * Math.sin(angle - spread);
          const x3 = cx + r2 * Math.cos(angle + spread);
          const y3 = cy + r2 * Math.sin(angle + spread);
          return <polygon key={`t-${i}`} points={`${x1},${y1} ${x2},${y2} ${x3},${y3}`} />;
        })}
        {Array.from({ length: 10 }).map((_, row) =>
          Array.from({ length: 16 }).map((_, col) => {
            const x = col * 100 + (row % 2 === 0 ? 0 : 50);
            const y = row * 90;
            return (
              <polygon
                key={`d-${row}-${col}`}
                points={`${x},${y - 28} ${x + 22},${y} ${x},${y + 28} ${x - 22},${y}`}
              />
            );
          }),
        )}
      </g>
    </svg>
  );
}

// ── Drifting readouts ────────────────────────────────────────────────────────

interface DriftSlot {
  x: number;
  y: number;
  dx: number;
  dy: number;
  duration: number;
  cycle: number;
}

function randomPosition(): { x: number; y: number } {
  let x: number;
  let y: number;
  do {
    x = 5 + Math.random() * 85;
    y = 5 + Math.random() * 87;
  } while (x > 28 && x < 72 && y > 22 && y < 68);
  return { x, y };
}

function randomDrift(): { dx: number; dy: number } {
  return { dx: (Math.random() - 0.5) * 6, dy: (Math.random() - 0.5) * 4 };
}

function initSlot(): DriftSlot {
  return { ...randomPosition(), ...randomDrift(), duration: 14 + Math.random() * 4, cycle: 0 };
}

/**
 * Faint mono tokens that fade in, drift, and reappear elsewhere. Under
 * reduced motion they render as a fixed, low-opacity scatter (no interval, no
 * animation) so the texture survives without movement.
 */
export function DriftingReadouts({ readouts }: { readouts: string[] }): ReactNode {
  const reduce = useReducedMotion();
  const [slots, setSlots] = useState<DriftSlot[]>(() => readouts.map(() => initSlot()));

  useEffect(() => {
    setSlots(
      readouts.map((_, i) => {
        const slot = initSlot();
        slot.duration = 14 + i * 0.6 + Math.random() * 2;
        return slot;
      }),
    );
  }, [readouts]);

  useEffect(() => {
    if (reduce) return;
    const intervals = slots.map((slot, i) =>
      window.setInterval(() => {
        setSlots((prev) => {
          const next = [...prev];
          next[i] = {
            ...randomPosition(),
            ...randomDrift(),
            duration: 14 + Math.random() * 4,
            cycle: prev[i].cycle + 1,
          };
          return next;
        });
      }, slot.duration * 1000),
    );
    return () => intervals.forEach(clearInterval);
    // Intervals are seeded once from the initial slot durations; re-running on
    // every slot change would reset the timers and freeze the drift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  return (
    <>
      {readouts.map((text, i) => {
        const s = slots[i];
        if (!s) return null;
        if (reduce) {
          return (
            <div key={i} className={styles.readoutStatic} style={{ left: `${s.x}%`, top: `${s.y}%` }}>
              {text}
            </div>
          );
        }
        return (
          <div
            key={`${i}-${s.cycle}`}
            className={styles.readout}
            style={
              {
                left: `${s.x}%`,
                top: `${s.y}%`,
                '--dx': `${s.dx}vw`,
                '--dy': `${s.dy}vh`,
                animationDuration: `${s.duration}s`,
                animationDelay: `${i * -1.8}s`,
              } as CSSProperties
            }
          >
            {text}
          </div>
        );
      })}
    </>
  );
}

// ── Segmented ring ───────────────────────────────────────────────────────────

/**
 * The shared three-layer ring: an ink outer ring (clockwise), an ink inner ring
 * (counter), and a thin accent arc. With `progress` it is determinate (arc length
 * tracks the value); without it the arc is a fixed sweep that rotates — the honest
 * indeterminate state, no number implied. `accent` picks lavender (live) or the
 * danger red (a lost/failed state, always paired with text).
 */
export function SegmentedRing({
  size,
  accent,
  progress,
  pulse = false,
  children,
}: {
  size: number;
  accent: 'live' | 'danger';
  /** 0..1 for a real value; omit for the indeterminate breathing arc. */
  progress?: number;
  pulse?: boolean;
  children?: ReactNode;
}): ReactNode {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.44;
  const innerR = size * 0.38;
  const accentR = size * 0.35;

  const outerC = 2 * Math.PI * outerR;
  const innerC = 2 * Math.PI * innerR;
  const accentC = 2 * Math.PI * accentR;

  const indeterminate = progress === undefined;
  const accentColor = accent === 'danger' ? 'var(--danger)' : 'var(--accent)';
  const accentLen = indeterminate ? accentC * 0.3 : accentC * Math.max(0, Math.min(1, progress));
  const arcClass = `${styles.ringAccent} ${pulse || indeterminate ? styles.pulse : ''} ${
    indeterminate ? '' : styles.arcDeterminate
  }`;

  return (
    <div className={styles.ring} style={{ width: size, height: size }}>
      <div className={`${styles.ringLayer} ${styles.spinCW}`}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            className={styles.ringStroke}
            cx={cx}
            cy={cy}
            r={outerR}
            strokeWidth={size * 0.06}
            strokeDasharray={`${outerC * 0.2} ${outerC * 0.05}`}
            opacity="0.2"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        </svg>
      </div>
      <div className={`${styles.ringLayer} ${styles.spinCCW}`}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            className={styles.ringStroke}
            cx={cx}
            cy={cy}
            r={innerR}
            strokeWidth={size * 0.035}
            strokeDasharray={`${innerC * 0.25} ${innerC * 0.083}`}
            opacity="0.13"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        </svg>
      </div>
      <div className={indeterminate ? `${styles.ringLayer} ${styles.spinArc}` : styles.ringLayer}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            className={arcClass}
            cx={cx}
            cy={cy}
            r={accentR}
            stroke={accentColor}
            strokeWidth={size * 0.012}
            strokeDasharray={`${accentLen} ${accentC}`}
            opacity="0.6"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        </svg>
      </div>
      {children ? (
        <div className={styles.ringCenter} style={{ fontSize: size * 0.35 }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

// ── Shimmer word ─────────────────────────────────────────────────────────────

/** The large status word (LOADING / PAGE LOST / SYSTEM FAULT) with a clipped shimmer. */
export function ShimmerWord({ children, error = false }: { children: string; error?: boolean }): ReactNode {
  return <span className={error ? `${styles.word} ${styles.wordError}` : styles.word}>{children}</span>;
}

// ── Screen scaffold ──────────────────────────────────────────────────────────

/** The shared full-screen frame: facet background, drifting readouts, centered body, bottom bar. */
export function SystemScreen({
  readouts,
  bottomLeft,
  children,
  role = 'status',
  label,
}: {
  readouts: string[];
  bottomLeft?: ReactNode;
  children: ReactNode;
  role?: 'status' | 'alert';
  label?: string;
}): ReactNode {
  return (
    <div className={styles.screen} role={role} aria-live={role === 'alert' ? 'assertive' : 'polite'} aria-label={label}>
      <GeometricBackground />
      <DriftingReadouts readouts={readouts} />
      <div className={styles.center}>{children}</div>
      <div className={styles.bottomBar}>
        <span>{bottomLeft}</span>
        <span className={styles.brandTag}>seorak</span>
      </div>
    </div>
  );
}

export { styles as systemStyles };

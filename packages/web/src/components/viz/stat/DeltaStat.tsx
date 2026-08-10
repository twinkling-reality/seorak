import type { CSSProperties } from 'react';
import styles from './DeltaStat.module.css';

export interface DeltaStatProps {
  /** This-window value (the ink bar). */
  current: number;
  /** Prior-window value (the muted bar). Caller must gate on a real prior leg
   *  (`hasPriorPeriodDelta`) before rendering — this component does not invent a
   *  baseline. */
  previous: number;
  /** Format both legs for the bar labels + screen-reader text. */
  format?: (n: number) => string;
  /** Short tag for the current period (default "now"). */
  currentLabel?: string;
  /** Short tag for the prior period (default "prior"). */
  previousLabel?: string;
}

// Headroom above the taller leg so the value that trails a bar's end always has
// room and never runs off the track.
const SCALE_HEADROOM = 1.22;

/**
 * Period-over-period change as a before/after pair: the prior window and this
 * window drawn as two bars on one common scale, so the CHANGE reads directly as
 * the difference in bar length — not a tick buried near the end of a nearly-full
 * track (the bullet form this replaces). The current window is ink, the prior is
 * muted context; each bar carries its value at its end. Direction is shown by
 * length, never graded — up is not "good", down is not "bad" (DESIGN_LANGUAGE:
 * color is semantic for state, not for movement), so both stay neutral.
 */
export default function DeltaStat({
  current,
  previous,
  format = (n) => n.toLocaleString(),
  currentLabel = 'now',
  previousLabel = 'prior',
}: DeltaStatProps) {
  const scaleMax = Math.max(current, previous, 1) * SCALE_HEADROOM;
  // Prior on top, current below: the eye reads before -> after and lands on the
  // ink bar as the subject.
  const rows = [
    { key: 'prior', tag: previousLabel, value: previous, muted: true },
    { key: 'now', tag: currentLabel, value: current, muted: false },
  ];

  return (
    <div
      className={styles.frame}
      role="img"
      aria-label={`${format(current)} this window versus ${format(previous)} the prior window`}
    >
      {rows.map((row, i) => {
        const pct = Math.max(0, Math.min(100, (row.value / scaleMax) * 100));
        return (
          <div key={row.key} className={styles.row} style={{ '--row-index': i } as CSSProperties}>
            <span className={styles.tag}>{row.tag}</span>
            <div className={styles.barCell}>
              <div className={styles.track} />
              <div
                className={row.muted ? styles.fillMuted : styles.fill}
                style={{ width: `${pct}%` }}
              />
              <span className={styles.value} style={{ left: `${pct}%` }}>
                {format(row.value)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

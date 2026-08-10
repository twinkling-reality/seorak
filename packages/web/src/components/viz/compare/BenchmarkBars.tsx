import type { CSSProperties } from 'react';

import ProjectSquircle from '../../ProjectSquircle/ProjectSquircle.js';
import { projectAccent } from '../../../lib/projectGradient.js';
import styles from './BenchmarkBars.module.css';

export interface BenchmarkBarItem {
  key: string;
  label: string;
  /** The plotted value (a rate, ratio, or count). */
  value: number;
  /** Right-aligned display string (carry the unit here). */
  display: string;
  /**
   * Project identity key (repoId). When set, the row carries the project's
   * squircle before its label AND — absent an explicit `color` — derives its
   * fill from this same key, so a repo's chip and its bar can never disagree.
   * Prefer this over `color` for per-repo bars.
   */
  projectKey?: string;
  /** Explicit per-row fill for non-project bars. Defaults to --ink. */
  color?: string;
}

interface Props {
  /** Pre-sorted rows — the caller decides the order. */
  items: ReadonlyArray<BenchmarkBarItem>;
  /** A real measured benchmark drawn as one reference line across every bar
   *  (e.g. the global average). Never a fabricated target. */
  reference: { value: number; label: string };
  ariaLabel?: string;
}

/**
 * Ranked bars read against a shared benchmark line — "which of these beat the
 * average, and by how far?". Every row is a full-width track, so all fills and
 * the single reference line share one origin and scale (position on a common
 * baseline, the encoding read most accurately). The reference is a real
 * measured value the caller passes in; this component never invents a target.
 */
export default function BenchmarkBars({ items, reference, ariaLabel }: Props) {
  const scaleMax = Math.max(reference.value, ...items.map((i) => i.value), 1) * 1.08;
  const refPct = Math.max(0, Math.min(100, (reference.value / scaleMax) * 100));

  return (
    <div className={styles.wrap} role="img" aria-label={ariaLabel}>
      <div className={styles.refLine} style={{ left: `${refPct}%` }}>
        <span className={styles.refLabel}>{reference.label}</span>
      </div>
      {items.map((item, i) => {
        const pct = Math.max(0, Math.min(100, (item.value / scaleMax) * 100));
        // One key drives both marks: the caller's explicit color wins, else a
        // project bar takes the solid data-fill accent derived from its identity
        // key (the squircle's gradient sibling), so chip and fill share a hue.
        const fill = item.color ?? (item.projectKey ? projectAccent(item.projectKey) : undefined);
        return (
          <div
            key={item.key}
            className={styles.row}
            style={{ '--row-index': i } as CSSProperties}
          >
            <div className={styles.head}>
              <span className={styles.identity}>
                {item.projectKey ? (
                  <ProjectSquircle projectKey={item.projectKey} size="xs" />
                ) : null}
                <span className={styles.label} title={item.label}>
                  {item.label}
                </span>
              </span>
              <span className={styles.value}>{item.display}</span>
            </div>
            <div className={styles.track}>
              <div
                className={styles.fill}
                style={{
                  width: `${pct}%`,
                  ...(fill ? { background: fill } : {}),
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

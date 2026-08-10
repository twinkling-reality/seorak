import { type CSSProperties } from 'react';

import { fmtCount } from '../../../widgets/utils.js';
import styles from './DurationStrip.module.css';

export interface DurationBucket {
  /** Bucket label, e.g. "0-5m". */
  bucket: string;
  /** Session count in the bucket. */
  count: number;
}

export type DurationStripTint = 'monochrome' | 'positional';

export interface DurationStripProps {
  buckets: ReadonlyArray<DurationBucket>;
  /** Show per-bucket label and count under each segment. Default true. */
  showLegend?: boolean;
  /** Tint ramp:
   *   - 'monochrome' (default): --ink alpha 20% to 100% from short to long.
   *   - 'positional': success / ink / warn ramp, short to long. */
  tint?: DurationStripTint;
}

function monochromeColor(i: number, n: number): string {
  const pct = Math.round(20 + (i / Math.max(1, n - 1)) * 80);
  return `color-mix(in srgb, var(--ink) ${pct}%, transparent)`;
}

function positionalColor(i: number, n: number): string {
  const pos = n > 1 ? i / (n - 1) : 0;
  if (pos <= 0.33) return 'var(--success)';
  if (pos >= 0.66) return 'var(--warn)';
  return 'var(--ink)';
}

/**
 * Horizontal proportional strip for duration buckets. Each segment flexes
 * to its share of the total; the label, segment, and count stack in the
 * same column so they stay aligned as widths shift. The two tint ramps
 * cover the Usage (monochrome) and Outcomes (positional) reads without
 * branching at the call site.
 */
export function DurationStrip({
  buckets,
  showLegend = true,
  tint = 'monochrome',
}: DurationStripProps) {
  const total = Math.max(
    1,
    buckets.reduce((s, b) => s + b.count, 0),
  );
  const n = Math.max(1, buckets.length);

  return (
    <div className={styles.frame}>
      <div className={styles.cols}>
        {buckets.map((b, i) => {
          const share = Math.round((b.count / total) * 100);
          const color = tint === 'positional' ? positionalColor(i, n) : monochromeColor(i, n);
          const opacity = tint === 'positional' ? 0.65 : 1;
          return (
            <div
              key={b.bucket}
              className={styles.col}
              style={
                {
                  flex: Math.max(1, b.count),
                  '--row-index': i,
                  '--ds-seg-color': color,
                } as CSSProperties
              }
              title={`${b.bucket} - ${b.count} sessions`}
            >
              {showLegend && <span className={styles.label}>{b.bucket}</span>}
              <div className={styles.seg} style={{ opacity }} />
              {showLegend && (
                <span className={styles.value}>
                  {fmtCount(b.count)}
                  <span className={styles.meta}>- {share}%</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DurationStrip;

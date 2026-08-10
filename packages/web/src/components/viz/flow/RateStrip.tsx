import type { CSSProperties, ReactNode } from 'react';
import styles from './RateStrip.module.css';

export interface RateEntry {
  key: string;
  /** Label rendered on the left. Can include icons. */
  label: ReactNode;
  /** The rate that positions the dot on the 0→max axis. */
  rate: number;
  /** Secondary weight (e.g. hours logged) that scales the dot size. */
  weight: number;
}

interface Props {
  entries: ReadonlyArray<RateEntry>;
  /** Optional hard max for the shared scale. Defaults to the highest
   *  rate across entries. Pass an explicit value to lock the axis
   *  (useful when two strips should compare against the same baseline). */
  scaleMax?: number;
  /** Format rate values (right-aligned mono readout + scale-max label). */
  format?: (rate: number) => string;
  /** Format the weight meta (a trailing "3.4h logged"-style suffix). */
  metaFormat?: (weight: number) => string;
}

/**
 * Horizontal rate comparison. Each entity has a dot on a shared 0→max
 * axis - position is the rate, dot size encodes the weight (e.g. hours
 * logged). Different viz vocabulary from a BreakdownList, so stacking
 * two RateStrip sections (tools + projects) reads as two variants
 * rather than two duplicates.
 */
export default function RateStrip({
  entries,
  scaleMax: scaleMaxOverride,
  format = (n) => `${n.toFixed(1)}/hr`,
  metaFormat = (n) => `${n.toFixed(1)}h`,
}: Props) {
  const scaleMax = scaleMaxOverride ?? Math.max(0.001, ...entries.map((e) => e.rate));
  const maxWeight = Math.max(0.001, ...entries.map((e) => e.weight));
  return (
    <div className={styles.strip}>
      {entries.map((e, i) => {
        const pct = Math.min(100, (e.rate / scaleMax) * 100);
        const dotScale = 0.55 + (e.weight / maxWeight) * 0.45;
        return (
          <div key={e.key} className={styles.row} style={{ '--row-index': i } as CSSProperties}>
            <span className={styles.label}>{e.label}</span>
            <div className={styles.track}>
              <div className={styles.axis} />
              <span
                className={styles.dot}
                style={{
                  left: `${pct}%`,
                  transform: `translate(-50%, -50%) scale(${dotScale.toFixed(3)})`,
                }}
                aria-hidden="true"
              />
            </div>
            <span className={styles.value}>
              {format(e.rate)}
              <span className={styles.meta}>, {metaFormat(e.weight)}</span>
            </span>
          </div>
        );
      })}
      <div className={styles.axisLabels}>
        <span>0</span>
        <span>{format(scaleMax)}</span>
      </div>
    </div>
  );
}

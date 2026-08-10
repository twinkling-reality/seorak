import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './HeroStatRow.module.css';

export interface HeroStatDef {
  key: string;
  /** Display-sized primary value. */
  value: string;
  /** Optional smaller-scale unit suffix (`%`, `/hr`, `min`). */
  unit?: string;
  /** Mono uppercase label beneath the value. */
  label: string;
  /** Mono context line beneath the label - a concrete ratio or date.
   *  Accepts ReactNode so callers can inline small chips (e.g. period-
   *  comparison delta arrows) without redesigning the hero. */
  sublabel?: ReactNode;
  /** Value color token. Defaults to inherited ink. */
  color?: string;
  /** Optional visual sibling rendered to the left of the text column -
   *  e.g. a `<DotMatrix />` pairing value with literal reference. */
  viz?: ReactNode;
}

/**
 * Fold-line KPI row. Each stat pairs a display-sized value with a mono
 * label, optional unit, optional sublabel, and optional viz sibling.
 * Rows stagger via `--row-index` so the hero reveals with rhythm rather
 * than all at once.
 *
 * `direction` controls flow: 'row' (default) packs stats horizontally
 * with wrap; 'column' stacks them vertically so each stat takes the
 * container's full width - useful when the hero column needs to balance
 * height against a denser neighbor (table or ring) across a topGrid.
 */
export default function HeroStatRow({
  stats,
  direction = 'row',
  className,
}: {
  stats: ReadonlyArray<HeroStatDef>;
  direction?: 'row' | 'column';
  className?: string;
}) {
  return (
    <div className={clsx(styles.row, direction === 'column' && styles.rowColumn, className)}>
      {stats.map((s, i) => (
        <div key={s.key} className={styles.stat} style={{ '--row-index': i } as CSSProperties}>
          {s.viz}
          <div className={styles.text}>
            <span className={styles.value} style={s.color ? { color: s.color } : undefined}>
              {s.value}
              {s.unit && <span className={styles.unit}>{s.unit}</span>}
            </span>
            <span className={styles.label}>{s.label}</span>
            {s.sublabel && <span className={styles.sublabel}>{s.sublabel}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

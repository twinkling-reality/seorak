import clsx from 'clsx';
import styles from './Legend.module.css';

/** Dot + label pair used beneath strips and diverging timelines. */
export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className={styles.item}>
      <span className={styles.dot} style={{ background: color }} />
      <span className={styles.label}>{label}</span>
    </div>
  );
}

/** Hatched swatch + label - matches the diagonal-hatch "no signal"
 *  segment in stacked columns so the legend entry reads as the same
 *  vocabulary. */
export function LegendHatch({ label }: { label: string }) {
  return (
    <div className={styles.item}>
      <span className={clsx(styles.dot, styles.hatch)} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </div>
  );
}

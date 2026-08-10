import type { CSSProperties } from 'react';
import styles from './ChurnBar.module.css';

interface Props {
  /** Lines added — the growth flow. */
  added: number;
  /** Lines removed — the deletion flow. */
  removed: number;
  /** Format each count for display (default: locale string). The sign is added
   *  by the component, so pass a magnitude formatter. */
  format?: (n: number) => string;
  ariaLabel?: string;
}

/**
 * ChurnBar — two opposing line-volume flows and their balance.
 *
 * Added and removed are not parts of one whole (a ranked/share list would imply
 * they sum to something meaningful) and they are not a time series. They are two
 * independent magnitudes whose DIFFERENCE is the story: near-equal added/removed
 * is rework, added far past removed is greenfield. So each flow gets its own bar
 * on a COMMON baseline and scale — length is the encoding read most accurately —
 * and the net sits beneath as the residual the two bars leave.
 *
 * Honesty: removing lines is not "bad", so neither flow is green/red. Added is
 * ink, removed is the recessive soft tone, and the +/- signs (never color alone)
 * carry the direction. Net prints its own sign. A genuinely zero flow renders an
 * empty track, never a hairline standing in for data.
 */
export default function ChurnBar({
  added,
  removed,
  format = (n) => n.toLocaleString(),
  ariaLabel,
}: Props) {
  const net = added - removed;
  const scaleMax = Math.max(added, removed, 1);
  const addedPct = Math.max(0, Math.min(100, (added / scaleMax) * 100));
  const removedPct = Math.max(0, Math.min(100, (removed / scaleMax) * 100));
  const netSign = net >= 0 ? '+' : '−';

  const rows: Array<{ key: string; label: string; sign: string; value: number; pct: number; tone: string }> = [
    { key: 'added', label: 'added', sign: '+', value: added, pct: addedPct, tone: 'var(--ink)' },
    { key: 'removed', label: 'removed', sign: '−', value: removed, pct: removedPct, tone: 'var(--soft)' },
  ];

  return (
    <div
      className={styles.wrap}
      role="img"
      aria-label={
        ariaLabel ??
        `${format(added)} lines added, ${format(removed)} removed, a net of ${netSign}${format(Math.abs(net))}`
      }
    >
      {rows.map((r, i) => (
        <div key={r.key} className={styles.row} style={{ '--row-index': i } as CSSProperties}>
          <span className={styles.label}>{r.label}</span>
          <div className={styles.track}>
            <div className={styles.fill} style={{ width: `${r.pct}%`, background: r.tone }} />
          </div>
          <span className={styles.value}>
            {r.sign}
            {format(r.value)}
          </span>
        </div>
      ))}
      <div className={styles.netRow}>
        <span className={styles.netLabel}>net</span>
        <span className={styles.netValue}>
          {netSign}
          {format(Math.abs(net))}
        </span>
      </div>
    </div>
  );
}

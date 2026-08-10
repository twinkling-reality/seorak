import type { CSSProperties, ReactNode } from 'react';
import styles from './BreakdownList.module.css';

export interface BreakdownItem {
  key: string;
  label: ReactNode;
  /** Magnitude for this row. Read RELATIVE to the other rows: the largest
   *  fills the track, the rest scale against it. Pass either a share of the
   *  whole or a raw count — the ranking reads the same either way. Clamped
   *  to 0–100 at render. */
  fillPct: number;
  /** Optional fill color — defaults to --ink. Ranking marks are ink; reserve
   *  --accent for live/selected, never as a categorical or decorative slot. */
  fillColor?: string;
  /** The value that rides the bar. Sits inside the fill (in the page color)
   *  when the bar is wide enough to hold it, otherwise trails just past the
   *  bar's end (in ink). Either way it hugs the mark, never a far-right column. */
  value: ReactNode;
  /** Native hover on the row. Holds a secondary fact (a share, a cost) that
   *  the bar already encodes, so the value stays one fact per the face law. */
  title?: string;
}

interface Props {
  items: ReadonlyArray<BreakdownItem>;
}

// Below this fill width the value can't sit inside the bar without crowding,
// so it trails the bar's end instead. Expressed as a share of the track.
const VALUE_INSIDE_THRESHOLD = 52;

/**
 * The dominant viz inside category detail views — "By tool", "By model",
 * "By project", "By directory". A value-in-the-mark ranking: the label reads
 * on the left, a solid bar carries the magnitude on a common baseline, and the
 * value is typeset AT the bar (inside it when wide, trailing it when narrow).
 *
 * Bars normalize to the largest row, so the leader fills the track and every
 * other bar reads as a fraction of it. The absolute share rides the answer
 * sentence; the raw value rides the bar. This is ADR-6 (DETAIL-VIZ): magnitude
 * as length, the number inside its mark, category at the foot — the geometry,
 * not the palette.
 *
 * Guardrails:
 * - One fill color per row; ink by default. The track is a shared neutral.
 * - Callers pre-sort; there is no sorting here.
 * - Rows reveal staggered via --row-index.
 */
export default function BreakdownList({ items }: Props) {
  const maxPct = items.reduce((m, it) => Math.max(m, Math.max(0, it.fillPct)), 0);

  return (
    <div className={styles.list}>
      {items.map((item, i) => {
        const share = Math.max(0, Math.min(100, item.fillPct));
        // Length is relative to the leader, not the whole, so a ranking where
        // no single row dominates still fills the track and reads at a glance.
        const barPct = maxPct > 0 ? (share / maxPct) * 100 : 0;
        // The value only drops inside a dark ink fill; a light/custom fill
        // (muted failures, etc.) keeps it trailing in ink so it stays legible.
        const darkFill = !item.fillColor || item.fillColor === 'var(--ink)';
        const inside = darkFill && barPct >= VALUE_INSIDE_THRESHOLD;
        return (
          <div
            key={item.key}
            className={styles.row}
            style={{ '--row-index': i } as CSSProperties}
            title={item.title}
          >
            <span className={styles.label}>{item.label}</span>
            <div className={styles.barCell}>
              <div className={styles.track} />
              <div
                className={styles.fill}
                style={{
                  width: `${barPct}%`,
                  ...(item.fillColor ? { background: item.fillColor } : {}),
                }}
              >
                {inside && <span className={styles.valueInside}>{item.value}</span>}
              </div>
              {!inside && (
                <span className={styles.valueOutside} style={{ left: `${barPct}%` }}>
                  {item.value}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Dimmer mono segment for the trailing meta inside a row's value. */
export function BreakdownMeta({ children }: { children: ReactNode }) {
  return <span className={styles.meta}>{children}</span>;
}

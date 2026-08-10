import { useMemo, type CSSProperties, type ReactNode } from 'react';
import styles from './Treemap.module.css';

export interface TreemapItem {
  key: string;
  /** Read on the tile when it is big enough (sans). */
  label: ReactNode;
  /** Magnitude → tile AREA. Read RELATIVE to the other tiles. Non-positive
   *  values get no tile (honest-empty: a measured 0 is not a rectangle). */
  value: number;
  /** The value typeset under the label inside the tile (mono), e.g. "316 lines". */
  valueLabel?: ReactNode;
  /** Native hover fact for the whole tile (a secondary count the area encodes). */
  title?: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The layout is computed in this fixed coordinate space and rendered as
// percentages inside a container that mirrors the aspect ratio, so tiles keep
// their computed proportions at any width without measuring the DOM.
const VIEW_W = 1000;
const VIEW_H = 520;

/** Worst (largest) aspect ratio a row of tile areas would take along `side`. */
function worst(areas: number[], side: number): number {
  if (areas.length === 0) return Infinity;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const a of areas) {
    sum += a;
    if (a > max) max = a;
    if (a < min) min = a;
  }
  const side2 = side * side;
  const sum2 = sum * sum;
  return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
}

/**
 * Squarified treemap (Bruls / Huizing / van Wijk): grows each row while it keeps
 * the tiles closer to square, so the result reads and clicks better than the
 * thin slivers a slice-and-dice layout would give a long tail. Rects come back
 * in INPUT order (mapped by index) in VIEW_W × VIEW_H space.
 */
function squarify(values: number[]): Rect[] {
  const rects: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const total = values.reduce((s, v) => s + Math.max(v, 0), 0);
  if (total <= 0) return rects;

  const scale = (VIEW_W * VIEW_H) / total;
  // Squarified assumes descending areas; sort a copy, keep the original index so
  // rects map back to the caller's item order.
  const items = values
    .map((v, idx) => ({ idx, area: Math.max(v, 0) * scale }))
    .sort((a, b) => b.area - a.area);

  let free: Rect = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };
  let i = 0;
  while (i < items.length) {
    const side = Math.min(free.w, free.h);
    const row: { idx: number; area: number }[] = [];
    let rowAreas: number[] = [];
    // Extend the row while adding the next tile does not worsen the row's worst
    // aspect ratio; stop as soon as it would.
    while (i < items.length) {
      const candidate = rowAreas.concat(items[i].area);
      if (row.length === 0 || worst(candidate, side) <= worst(rowAreas, side)) {
        row.push(items[i]);
        rowAreas = candidate;
        i += 1;
      } else {
        break;
      }
    }

    const rowSum = rowAreas.reduce((s, a) => s + a, 0);
    const thickness = rowSum > 0 ? rowSum / side : 0;
    if (free.w <= free.h) {
      // Shorter side is width: lay the row across the top, tiles span the width.
      let cx = free.x;
      for (const cell of row) {
        const w = thickness > 0 ? cell.area / thickness : 0;
        rects[cell.idx] = { x: cx, y: free.y, w, h: thickness };
        cx += w;
      }
      free = { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };
    } else {
      // Shorter side is height: lay the row down the left, tiles span the height.
      let cy = free.y;
      for (const cell of row) {
        const h = thickness > 0 ? cell.area / thickness : 0;
        rects[cell.idx] = { x: free.x, y: cy, w: thickness, h };
        cy += h;
      }
      free = { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h };
    }
  }
  return rects;
}

interface Props {
  items: ReadonlyArray<TreemapItem>;
  ariaLabel?: string;
}

/**
 * Treemap — area-encoded ranking for a long-tailed set (files, directories).
 * Tile area IS the magnitude, so the whole set fits in fixed space: the leaders
 * dominate, the tail packs in without a cap or a "+N more" footnote. Shade ramps
 * with magnitude (leader = full ink, tail fades toward the page) so concentration
 * reads at a glance; the answer sentence carries the exact top value, and every
 * tile carries its own on hover. Ink only — no categorical color (DETAIL-VIZ).
 */
export default function Treemap({ items, ariaLabel }: Props) {
  const positive = useMemo(() => items.filter((it) => it.value > 0), [items]);
  const rects = useMemo(() => squarify(positive.map((it) => it.value)), [positive]);
  const maxValue = useMemo(
    () => positive.reduce((m, it) => Math.max(m, it.value), 0),
    [positive],
  );

  if (positive.length === 0) return null;

  return (
    <div
      className={styles.frame}
      role="img"
      aria-label={ariaLabel}
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
    >
      {positive.map((it, i) => {
        const r = rects[i];
        if (r.w <= 0 || r.h <= 0) return null;
        // Sequential ink ramp: leader at full ink, tail floored at 22% so the
        // smallest tile still separates from the page. Same metric as the area,
        // so the shade never says anything the size does not.
        const t = maxValue > 0 ? it.value / maxValue : 0;
        const shade = 22 + Math.round(t * 78);
        const onDark = shade >= 58;
        return (
          <div
            key={it.key}
            className={styles.tile}
            title={it.title}
            style={{
              left: `${(r.x / VIEW_W) * 100}%`,
              top: `${(r.y / VIEW_H) * 100}%`,
              width: `${(r.w / VIEW_W) * 100}%`,
              height: `${(r.h / VIEW_H) * 100}%`,
              background: `color-mix(in srgb, var(--ink) ${shade}%, var(--page-bg))`,
              color: onDark ? 'var(--page-bg)' : 'var(--ink)',
              '--tile-index': i,
            } as CSSProperties}
          >
            <span className={styles.tileContent}>
              <span className={styles.tileLabel}>{it.label}</span>
              {it.valueLabel != null && <span className={styles.tileValue}>{it.valueLabel}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

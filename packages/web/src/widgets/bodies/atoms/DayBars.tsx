import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { TrendPoint } from './TrendSparkline.js';
import styles from './DayBars.module.css';

interface Props {
  /** One value per day. null means "no data that day" (honest-empty): the day
   *  keeps its slot but draws no bar, so a gap reads as a gap, not a zero. */
  points: ReadonlyArray<TrendPoint>;
  /** Bar color token. Defaults to --viz-series (validated blue). */
  color?: string;
  ariaLabel?: string;
  /** Tooltip + peak-label value formatter. Default: toLocaleString(). */
  formatValue?: (n: number) => string;
}

// Same geometry bands as TrendSparkline so a bars panel and a line panel keep
// the same vertical rhythm: a top strip for the peak's direct label, the plot,
// and a bottom strip for the two endpoint date anchors.
const PLOT_H = 50;
const TOP = 18;
const BOTTOM = 18;
const H = TOP + PLOT_H + BOTTOM;
const PAD_X = 4;
// A visible floor so a single-session day is distinguishable from a zero day
// without overstating it against a tall peak. Applies to v > 0 only.
const MIN_BAR_H = 2;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatTooltipDate(iso: string): string {
  if (iso.length < 10) return iso;
  const date = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return iso;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Compact bars-over-days chart for a discrete per-day count (sessions/day,
 * edits/day). Bars, not a line: a daily count is a set of discrete events, so
 * height on a common baseline reads each day honestly, where a line would imply
 * interpolation between days that never happened.
 *
 * Honest-empty by construction: a day whose value is null keeps its slot but
 * draws no bar (a gap, never a zero-height stand-in), and the component returns
 * null when fewer than two days carry data — the caller renders its own empty
 * state rather than a fabricated single bar. Width auto-fits via ResizeObserver.
 *
 * Anchoring (legible without hover): the two endpoint days are labeled under the
 * axis, and the tallest bar carries a direct value label. Hover reveals a
 * floating date/value tooltip for the per-day read.
 */
export function DayBars({
  points,
  color = 'var(--viz-series)',
  ariaLabel,
  formatValue = (n) => n.toLocaleString(),
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth || 280);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((obs) => {
      for (const entry of obs) {
        const w = Math.round(entry.contentRect.width);
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dayCount = points.length;
  const observed = useMemo(() => points.filter((p) => p.value != null).length, [points]);

  const { bars, peakIdx, slotW } = useMemo(() => {
    const plotW = Math.max(40, width - PAD_X * 2);
    const slot = dayCount > 0 ? plotW / dayCount : plotW;
    const barW = Math.max(2, Math.min(slot * 0.7, 16));
    const vals = points.map((p) => p.value).filter((v): v is number => v != null);
    const max = Math.max(1, ...vals);
    const baseY = TOP + PLOT_H;

    let peakVal = -Infinity;
    for (const p of points) {
      if (p.value != null && p.value > peakVal) peakVal = p.value;
    }
    const pIdx = points.findIndex((p) => p.value != null && p.value === peakVal);

    const built = points.map((p, i) => {
      if (p.value == null) return null;
      const h = p.value > 0 ? Math.max(MIN_BAR_H, (p.value / max) * PLOT_H) : 0;
      const cx = PAD_X + slot * (i + 0.5);
      return { i, x: cx - barW / 2, y: baseY - h, w: barW, h, cx, value: p.value };
    });

    return { bars: built, peakIdx: pIdx, slotW: slot };
  }, [points, dayCount, width]);

  const peak = peakIdx >= 0 ? bars[peakIdx] : null;
  // Keep the peak's direct label inside the plot near the edges.
  const peakAnchor: 'start' | 'middle' | 'end' = !peak
    ? 'middle'
    : peak.cx < 22
      ? 'start'
      : peak.cx > width - 22
        ? 'end'
        : 'middle';
  const peakLabelX = !peak
    ? 0
    : peakAnchor === 'start'
      ? PAD_X
      : peakAnchor === 'end'
        ? width - PAD_X
        : peak.cx;

  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;
  const hoverBar = hoverIdx != null ? bars[hoverIdx] : null;
  const firstDay = points[0]?.day ?? '';
  const lastDay = points[dayCount - 1]?.day ?? '';

  // Fewer than two observed days: nothing honest to draw. The caller renders its
  // own empty state; we draw nothing rather than a fabricated lone bar.
  if (observed < 2) return null;

  return (
    <div ref={containerRef} className={styles.wrap}>
      <svg
        className={styles.svg}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(ev) => {
          if (dayCount === 0 || slotW === 0) return;
          const rect = ev.currentTarget.getBoundingClientRect();
          const xRel = ev.clientX - rect.left - PAD_X;
          const idx = Math.floor(xRel / slotW);
          setHoverIdx(Math.max(0, Math.min(dayCount - 1, idx)));
        }}
        onPointerLeave={() => setHoverIdx(null)}
      >
        {bars.map((b) =>
          b == null ? null : (
            <rect
              key={b.i}
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={1.5}
              fill={color}
              className={hoverIdx === b.i ? styles.barHover : styles.bar}
            />
          ),
        )}
        {/* Endpoint date anchors: the window's first and last day, so the span
          * reads at a glance without hovering. */}
        <text x={PAD_X} y={TOP + PLOT_H + 13} className={styles.axisDate} textAnchor="start">
          {formatTooltipDate(firstDay)}
        </text>
        <text x={width - PAD_X} y={TOP + PLOT_H + 13} className={styles.axisDate} textAnchor="end">
          {formatTooltipDate(lastDay)}
        </text>
        {/* The tallest day carries the one direct value label (selective direct
          * labels, never a number on every bar). */}
        {peak && (
          <text
            x={peakLabelX}
            y={Math.max(11, peak.y - 5)}
            className={styles.peakLabel}
            textAnchor={peakAnchor}
          >
            {formatValue(peak.value)}
          </text>
        )}
      </svg>
      {hoverBar && hoverPoint?.value != null && (
        <div
          className={styles.tooltip}
          style={
            {
              left: `${Math.min(Math.max(0, hoverBar.cx), width - 88)}px`,
            } as CSSProperties
          }
        >
          <span className={styles.tooltipDate}>{formatTooltipDate(hoverPoint.day)}</span>
          <span className={styles.tooltipValue}>{formatValue(hoverPoint.value)}</span>
        </div>
      )}
    </div>
  );
}

export default DayBars;

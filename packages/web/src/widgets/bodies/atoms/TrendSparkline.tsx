import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import styles from './TrendSparkline.module.css';

export interface TrendPoint {
  /** ISO date YYYY-MM-DD — used for the hover label and as the point key. */
  day: string;
  /** The plotted value. null means "no data that day" (honest-empty) — the
   *  point is skipped, NOT drawn as a zero, so a quiet day doesn't dent the line
   *  toward the floor. */
  value: number | null;
}

interface Props {
  points: ReadonlyArray<TrendPoint>;
  /** Line/area color token. Defaults to --viz-series (validated blue). */
  color?: string;
  ariaLabel?: string;
  /** Tooltip value formatter. Default: toLocaleString(). */
  formatValue?: (n: number) => string;
}

// Geometry bands: a top strip for the peak's direct label, the plot itself, and
// a bottom strip for the two endpoint date anchors. The line lives in PLOT_H;
// TOP/BOTTOM reserve room so labels never clip the curve.
const PLOT_H = 50;
const TOP = 18;
const BOTTOM = 18;
const H = TOP + PLOT_H + BOTTOM;
const PAD_X = 4;

function formatTooltipDate(iso: string): string {
  if (iso.length < 10) return iso;
  const date = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return iso;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Compact line+area chart over a per-day series. Honest-empty by construction:
 * days whose value is null are skipped (not zero-plotted), and the caller is
 * expected to render its own empty state when there is nothing worth drawing —
 * this component returns null rather than a flat baseline when fewer than two
 * days have data. Width auto-fits via ResizeObserver.
 *
 * Anchoring (so the shape is legible without hover): the two endpoint days are
 * labeled under the line, and the peak point carries a direct value label with
 * its unit. Hover still reveals a scanner + floating date/value tooltip for the
 * per-day read.
 */
export function TrendSparkline({
  points,
  color = 'var(--viz-series)',
  ariaLabel,
  formatValue = (n) => n.toLocaleString(),
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const fillId = `trendFill-${useId().replace(/:/g, '')}`;

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

  const { line, area, maxY, peak } = useMemo(() => {
    const plotW = Math.max(40, width - PAD_X * 2);
    const step = dayCount > 1 ? plotW / (dayCount - 1) : 0;
    const vals = points.map((p) => p.value).filter((v): v is number => v != null);
    const max = Math.max(1, ...vals);
    const xAt = (i: number) => PAD_X + i * step;
    const yAt = (v: number) => TOP + PLOT_H - (v / max) * PLOT_H;

    // Build the polyline over only the days that have data, preserving x-position
    // by day index so a gap reads as a gap, not a slope to zero.
    const pts = points
      .map((p, i) => (p.value != null ? { x: xAt(i), y: yAt(p.value), i } : null))
      .filter((p): p is { x: number; y: number; i: number } => p != null);

    if (pts.length < 2) return { line: '', area: '', maxY: max, peak: null };

    // The peak carries the one direct value label (dataviz: selective direct
    // labels, never a number on every point). First occurrence of the max wins.
    let peakVal = -Infinity;
    for (const p of points) {
      if (p.value != null && p.value > peakVal) peakVal = p.value;
    }
    const peakIdx = points.findIndex((p) => p.value === peakVal);
    const peakPoint =
      peakIdx >= 0 ? { x: xAt(peakIdx), y: yAt(peakVal), value: peakVal } : null;

    const lineStr = pts.map((p) => `${p.x},${p.y}`).join(' ');
    const first = pts[0];
    const last = pts[pts.length - 1];
    const baseY = TOP + PLOT_H;
    const areaStr = `${first.x},${baseY} ${lineStr} ${last.x},${baseY}`;
    return { line: lineStr, area: areaStr, maxY: max, peak: peakPoint };
  }, [points, dayCount, width]);

  const hoverPoint = hoverIdx != null ? points[hoverIdx] : null;
  const plotW = Math.max(40, width - PAD_X * 2);
  const step = dayCount > 1 ? plotW / (dayCount - 1) : 0;
  const hoverX = hoverIdx != null ? PAD_X + hoverIdx * step : 0;

  const firstDay = points[0]?.day ?? '';
  const lastDay = points[dayCount - 1]?.day ?? '';
  // Keep the peak's direct label inside the plot: anchor away from a near edge.
  const peakAnchor: 'start' | 'middle' | 'end' = !peak
    ? 'middle'
    : peak.x < 44
      ? 'start'
      : peak.x > width - 44
        ? 'end'
        : 'middle';
  const peakLabelX = !peak
    ? 0
    : peakAnchor === 'start'
      ? PAD_X
      : peakAnchor === 'end'
        ? width - PAD_X
        : peak.x;

  // Fewer than two observed days: nothing honest to draw. The caller renders its
  // own empty state; we draw nothing rather than a fabricated flat line.
  if (observed < 2) return null;

  return (
    <div ref={containerRef} className={styles.wrap}>
      <svg
        className={styles.svg}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(ev) => {
          if (dayCount === 0 || step === 0) return;
          const rect = ev.currentTarget.getBoundingClientRect();
          const xRel = ev.clientX - rect.left - PAD_X;
          const idx = Math.round(xRel / step);
          setHoverIdx(Math.max(0, Math.min(dayCount - 1, idx)));
        }}
        onPointerLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <polygon points={area} fill={`url(#${fillId})`} />}
        {line && (
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* Endpoint date anchors: the window's first and last day, so the span
          * reads at a glance without hovering. */}
        <text x={PAD_X} y={TOP + PLOT_H + 13} className={styles.axisDate} textAnchor="start">
          {formatTooltipDate(firstDay)}
        </text>
        <text x={width - PAD_X} y={TOP + PLOT_H + 13} className={styles.axisDate} textAnchor="end">
          {formatTooltipDate(lastDay)}
        </text>
        {/* Peak marker + its one direct value label (unit via formatValue), so
          * the tallest day's magnitude is legible without hover. */}
        {peak && (
          <>
            <circle cx={peak.x} cy={peak.y} r={2.5} fill={color} className={styles.peakDot} />
            <text
              x={peakLabelX}
              y={Math.max(11, peak.y - 7)}
              className={styles.peakLabel}
              textAnchor={peakAnchor}
            >
              {formatValue(peak.value)}
            </text>
          </>
        )}
        {hoverIdx != null && hoverPoint?.value != null && (
          <>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={TOP}
              y2={TOP + PLOT_H}
              className={styles.scanner}
            />
            <circle
              cx={hoverX}
              cy={TOP + PLOT_H - (hoverPoint.value / maxY) * PLOT_H}
              r={2.5}
              fill={color}
            />
          </>
        )}
      </svg>
      {hoverIdx != null && hoverPoint?.value != null && (
        <div
          className={styles.tooltip}
          style={
            {
              left: `${Math.min(Math.max(0, hoverX), width - 88)}px`,
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

export default TrendSparkline;

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import styles from './StackedArea.module.css';

export interface StackedAreaPoint {
  day: string;
  value: number;
}

export interface StackedAreaEntry {
  key: string;
  label: string;
  series: ReadonlyArray<StackedAreaPoint>;
  /** Required brand color - consumer resolves from tool/work-type palette. */
  color: string;
}

interface Props {
  entries: ReadonlyArray<StackedAreaEntry>;
  /** Axis caption - e.g. "edits per day". Uppercased, mono. */
  unitLabel?: string;
  ariaLabel?: string;
  /** Optional value formatter for the tooltip. Default: toLocaleString. */
  formatValue?: (n: number) => string;
}

const H = 280;
const PAD_L = 58;
const PAD_R = 28;
const PAD_T = 24;
const PAD_B = 42;

function formatAxisDate(iso: string): string {
  if (iso.length >= 10) return iso.slice(5);
  return iso;
}

function formatTooltipDate(iso: string): string {
  if (iso.length < 10) return iso;
  const date = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return iso;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const order = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / order;
  let step: number;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  return step * order;
}

/**
 * Stacked-area chart for positive single-value-per-day series. Heaviest
 * series goes on the bottom; lighter bands stack on top. Hover shows a
 * vertical scanner with a floating tooltip card (per-series breakdown +
 * daily total). No legend - caller is expected to carry one nearby.
 */
export default function StackedArea({
  entries,
  unitLabel = 'per day',
  ariaLabel,
  formatValue = (n) => n.toLocaleString(),
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
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

  const days = useMemo(() => entries[0]?.series.map((p) => p.day) ?? [], [entries]);
  const dayCount = days.length;

  // Stack order: heaviest total at the bottom.
  const stacked = useMemo(() => {
    const withTotals = entries.map((e) => ({
      ...e,
      total: e.series.reduce((s, p) => s + Math.max(0, p.value), 0),
    }));
    withTotals.sort((a, b) => b.total - a.total);
    return withTotals;
  }, [entries]);

  const dailyTotals = useMemo(() => {
    const totals = new Array(dayCount).fill(0);
    for (const e of stacked) {
      e.series.forEach((p, i) => {
        totals[i] += Math.max(0, p.value);
      });
    }
    return totals;
  }, [stacked, dayCount]);

  const maxY = useMemo(() => niceMax(Math.max(1, ...dailyTotals)), [dailyTotals]);

  const plotW = Math.max(120, width - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;
  const step = dayCount > 1 ? plotW / (dayCount - 1) : 0;

  // Scale helpers derive from the same primitives as `layers` below
  // (width, maxY, plotH, step). Keeping them inline in render for the
  // SVG drawing; the memoized `layers` computation re-derives its own
  // local copies so the dependency graph stays explicit.
  const yScale = (v: number) => PAD_T + plotH - (v / maxY) * plotH;
  const xAt = (i: number) => PAD_L + i * step;

  // Build cumulative stacks so each series renders from its base. Scale
  // helpers are redefined inside so React's exhaustive-deps can see
  // them - the outer `yScale`/`xAt` are only used for render-time SVG.
  const layers = useMemo(() => {
    const memoYScale = (v: number) => PAD_T + plotH - (v / maxY) * plotH;
    const memoXAt = (i: number) => PAD_L + i * step;
    const baselines = new Array(dayCount).fill(0);
    return stacked.map((e) => {
      const tops = e.series.map((p, i) => {
        const base = baselines[i];
        const top = base + Math.max(0, p.value);
        return { base, top };
      });
      // Mutate baselines AFTER capturing this layer so next layer stacks above.
      e.series.forEach((p, i) => {
        baselines[i] += Math.max(0, p.value);
      });
      const upper = tops.map((t, i) => `${memoXAt(i)},${memoYScale(t.top)}`).join(' ');
      const lower = tops
        .map((t, i) => `${memoXAt(i)},${memoYScale(t.base)}`)
        .reverse()
        .join(' ');
      return { ...e, path: `M ${upper} L ${lower} Z`, tops };
    });
  }, [stacked, dayCount, maxY, plotH, step]);

  const onMove = useCallback(
    (ev: ReactPointerEvent<SVGSVGElement>) => {
      if (dayCount === 0 || step === 0) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const xRel = ev.clientX - rect.left - PAD_L;
      const idx = Math.round(xRel / step);
      const clamped = Math.max(0, Math.min(dayCount - 1, idx));
      setHoverIdx(clamped);
    },
    [dayCount, step],
  );
  const onLeave = useCallback(() => setHoverIdx(null), []);

  if (dayCount === 0 || entries.length === 0) return null;

  // X-axis label cadence - aim for ~6 labels regardless of range length.
  const labelStep = Math.max(1, Math.floor(dayCount / 6));

  // Y axis ticks at 0, 50%, 100% of maxY.
  const yTicks = [0, maxY / 2, maxY];

  const hoverDay = hoverIdx !== null ? days[hoverIdx] : null;
  const hoverTotal = hoverIdx !== null ? dailyTotals[hoverIdx] : 0;
  const hoverRows =
    hoverIdx !== null
      ? stacked
          .map((e) => ({ label: e.label, color: e.color, value: e.series[hoverIdx]?.value ?? 0 }))
          .filter((r) => r.value > 0)
          .sort((a, b) => b.value - a.value)
      : [];

  return (
    <div ref={containerRef} className={styles.wrap}>
      <svg
        className={styles.svg}
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
      >
        {/* gridlines */}
        {yTicks.map((t, i) => (
          <line
            key={i}
            x1={PAD_L}
            x2={width - PAD_R}
            y1={yScale(t)}
            y2={yScale(t)}
            className={styles.grid}
          />
        ))}
        {/* y labels */}
        {yTicks.map((t, i) => (
          <text key={i} x={PAD_L - 10} y={yScale(t)} className={styles.axisText} textAnchor="end">
            {formatValue(Math.round(t))}
          </text>
        ))}
        {/* stacked layers */}
        {layers.map((l) => (
          <path key={l.key} d={l.path} fill={l.color} className={styles.area} />
        ))}
        {/* x axis ticks */}
        {days.map((d, i) => {
          if (i !== 0 && i !== days.length - 1 && i % labelStep !== 0) return null;
          return (
            <text
              key={d}
              x={xAt(i)}
              y={H - PAD_B + 18}
              className={styles.axisText}
              textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}
            >
              {formatAxisDate(d)}
            </text>
          );
        })}
        {/* axis caption */}
        <text x={PAD_L} y={16} className={styles.caption}>
          {unitLabel}
        </text>
        {/* hover guide */}
        {hoverIdx !== null && (
          <line
            x1={xAt(hoverIdx)}
            x2={xAt(hoverIdx)}
            y1={PAD_T}
            y2={H - PAD_B}
            className={styles.scanner}
          />
        )}
        {hoverIdx !== null &&
          layers.map((l) => {
            const t = l.tops[hoverIdx];
            if (!t || t.top === t.base) return null;
            return (
              <circle
                key={l.key}
                cx={xAt(hoverIdx)}
                cy={yScale(t.top)}
                r={3}
                fill={l.color}
                className={styles.dot}
              />
            );
          })}
      </svg>
      {hoverIdx !== null && hoverDay && hoverRows.length > 0 && (
        <div
          className={styles.tooltip}
          style={{
            left: `${Math.min(Math.max(PAD_L, xAt(hoverIdx)), width - PAD_R - 180)}px`,
          }}
        >
          <div className={styles.tooltipHeader}>{formatTooltipDate(hoverDay)}</div>
          {hoverRows.map((r) => (
            <div key={r.label} className={styles.tooltipRow}>
              <span className={styles.swatch} style={{ background: r.color }} />
              <span className={styles.tooltipLabel}>{r.label}</span>
              <span className={styles.tooltipValue}>{formatValue(r.value)}</span>
            </div>
          ))}
          <div className={styles.tooltipFooter}>
            <span className={styles.tooltipLabel}>Total</span>
            <span className={styles.tooltipValue}>{formatValue(hoverTotal)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

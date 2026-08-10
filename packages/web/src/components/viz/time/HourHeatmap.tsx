import clsx from 'clsx';
import { type CSSProperties } from 'react';
import { DAY_LABELS } from '../../../widgets/utils.js';
import styles from './HourHeatmap.module.css';

const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];

export interface HourCell {
  /** 0 = Sunday, 6 = Saturday. */
  dow: number;
  /** 0–23 clock hour. Callers pass VIEWER-LOCAL hours (the worker buckets in UTC;
   *  localize via lib/localTime.localizeHourBuckets before rendering). */
  hour: number;
  /** Cell weight (e.g. session count). */
  value: number;
}

export interface HourHeatmapPeak {
  dow: number;
  hour: number;
}

interface Props {
  /** Sparse cell list. Missing cells render as the empty floor. */
  data: ReadonlyArray<HourCell>;
  /** Optional row filter - render only these day-of-week indices. Pass
   *  `[1,2,3,4,5]` for a weekday-only mini-grid; defaults to all 7 rows. */
  compactRows?: ReadonlyArray<number>;
  /** Cell height (and y-label row height) in px when sizing='fixed'. Default 14. */
  cellSize?: number;
  /** 'stretch' fills the container height (widget / detail slots). */
  sizing?: 'fixed' | 'stretch';
  /** Ring the busiest cell so the peak reads without hover. */
  peak?: HourHeatmapPeak | null;
  /** Hide the bottom hour-tick labels. Useful when the heatmap renders
   *  in a tight slot or sits inline with other small-multiples that
   *  share an axis caption. */
  hideXLabels?: boolean;
  /** Opacity normalization mode:
   *   - 'p95' (default): normalize against the 95th-percentile populated
   *     value, clamped at 1. Hot cells stay saturated; the long tail keeps
   *     signal. This is the dashboard-grade default.
   *   - 'max': normalize against the absolute max. Faithful to outliers
   *     at the cost of squashing the rest of the grid.
   */
  scale?: 'p95' | 'max';
}

function buildGrid(data: ReadonlyArray<HourCell>): number[][] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of data) {
    if (c.dow < 0 || c.dow > 6 || c.hour < 0 || c.hour > 23) continue;
    grid[c.dow][c.hour] += c.value;
  }
  return grid;
}

function computeMax(grid: number[][], scale: 'p95' | 'max'): number {
  const populated: number[] = [];
  for (const row of grid) for (const v of row) if (v > 0) populated.push(v);
  if (populated.length === 0) return 0;
  populated.sort((a, b) => a - b);
  if (scale === 'max') return populated[populated.length - 1] ?? 0;
  return populated[Math.max(0, Math.floor(populated.length * 0.95) - 1)] ?? 0;
}

function hourGlyph(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

/**
 * Hour × day-of-week heatmap. Single primitive shared by:
 *   - the `heatmap` widget body
 *   - ActivityDetailView's peak-hour question
 *   - any future weekday/weekend mini-grid (via `compactRows`)
 *
 * Color is always `var(--viz-series)`; opacity modulates volume.
 * Lavender (--live) is never used — this is retrospective rhythm data.
 */
export default function HourHeatmap({
  data,
  compactRows,
  cellSize = 14,
  sizing = 'fixed',
  peak = null,
  hideXLabels = false,
  scale = 'p95',
}: Props) {
  const grid = buildGrid(data);
  const max = computeMax(grid, scale);
  const rows = compactRows ?? [0, 1, 2, 3, 4, 5, 6];
  const stretch = sizing === 'stretch';

  const styleVar = {
    '--cell-size': `${cellSize}px`,
  } as CSSProperties;

  return (
    <div className={clsx(styles.wrap, stretch && styles.wrapStretch)}>
      <div className={clsx(styles.grid, stretch && styles.gridStretch)} style={styleVar}>
        <div className={clsx(styles.yLabels, stretch && styles.yLabelsStretch)}>
          {rows.map((dow) => (
            <span key={dow} className={styles.yLabel}>
              {DAY_LABELS[dow] ?? ''}
            </span>
          ))}
        </div>
        <div className={styles.cols}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} className={styles.col} style={{ '--row-index': hour } as CSSProperties}>
              {rows.map((dow) => {
                const val = grid[dow]?.[hour] ?? 0;
                const norm = max > 0 ? Math.min(1, val / max) : 0;
                const opacity = max > 0 && val > 0 ? 0.12 + norm * 0.88 : 1;
                const isPeak =
                  peak != null && peak.dow === dow && peak.hour === hour && val > 0;
                return (
                  <div
                    key={dow}
                    className={clsx(
                      styles.cell,
                      stretch && styles.cellStretch,
                      val > 0 ? styles.cellFilled : styles.cellEmpty,
                      isPeak && styles.cellPeak,
                    )}
                    style={val > 0 ? { opacity } : undefined}
                    title={`${DAY_LABELS[dow] ?? ''} ${hourGlyph(hour)}: ${val} ${
                      val === 1 ? 'session' : 'sessions'
                    }`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {hideXLabels ? null : (
        <div className={styles.xLabels}>
          {HOUR_LABELS.map((h) => (
            <span key={h} className={styles.xLabel}>
              {hourGlyph(h)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

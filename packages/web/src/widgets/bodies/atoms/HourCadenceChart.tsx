import { useMemo } from 'react';
import styles from './HourCadenceChart.module.css';

export interface HourCadencePoint {
  hour: number;
  value: number;
}

const PLOT_H = 56;
const RIM_HOURS = [0, 6, 12, 18];

function hourGlyph(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

/**
 * 24-hour cadence pillars for "when sessions wrap up". The full clock spine
 * stays visible so sparse data still reads as a time-of-day pattern, not a
 * ranked list. Peak hour gets an accent ring; hover carries the exact count.
 */
export function HourCadenceChart({
  points,
  ariaLabel,
  formatValue = (n) => n.toLocaleString(),
}: {
  points: ReadonlyArray<HourCadencePoint>;
  ariaLabel: string;
  formatValue?: (n: number) => string;
}) {
  const { series, max, peakHour } = useMemo(() => {
    const byHour = new Map<number, number>();
    for (const p of points) byHour.set(p.hour, p.value);
    const series = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      value: byHour.get(hour) ?? 0,
    }));
    const max = Math.max(1, ...series.map((p) => p.value));
    const peak = series.reduce(
      (best, p) => (p.value > best.value ? p : best),
      series[0] ?? { hour: 0, value: 0 },
    );
    return { series, max, peakHour: peak.value > 0 ? peak.hour : null };
  }, [points]);

  return (
    <div className={styles.wrap} role="img" aria-label={ariaLabel}>
      <div className={styles.stage}>
        {series.map((p) => {
          const h = max > 0 ? Math.max(p.value > 0 ? 3 : 0, (p.value / max) * PLOT_H) : 0;
          const isPeak = peakHour === p.hour && p.value > 0;
          return (
            <div key={p.hour} className={styles.cell} title={`${hourGlyph(p.hour)}: ${formatValue(p.value)}`}>
              <div
                className={`${styles.pillar} ${isPeak ? styles.pillarPeak : ''}`}
                style={{
                  height: `${h}px`,
                  background: isPeak
                    ? 'var(--viz-series)'
                    : p.value > 0
                      ? `color-mix(in srgb, var(--viz-series) ${Math.round(35 + (p.value / max) * 45)}%, var(--viz-ramp-base))`
                      : 'transparent',
                  opacity: p.value > 0 ? 1 : 0,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className={styles.rim}>
        {RIM_HOURS.map((h) => (
          <span key={h} className={styles.tick}>
            {hourGlyph(h)}
          </span>
        ))}
      </div>
    </div>
  );
}

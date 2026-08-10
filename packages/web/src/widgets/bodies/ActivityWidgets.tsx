import { useMemo } from 'react';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import HourHeatmap, { type HourCell } from '../../components/viz/time/HourHeatmap.js';
import { DAY_LABELS } from '../utils.js';
import { localizeHourBuckets, localizeHourlyReasons } from '../../lib/localTime.js';
import type { HourBucket } from '../../lib/apiSchemas.js';
import { StripFaceHead } from './atoms/StripFaceHead.js';
import { HourCadenceChart } from './atoms/HourCadenceChart.js';
import { totalEnded } from './atoms/endReasonStack.js';
import styles from './ActivityWidgets.module.css';
import { readinessSectionText } from './shared.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';

const HEATMAP_MIN_POPULATED_CELLS = 3;

function hourGlyph(h: number): string {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

function HeatmapWidget({ overview, capture }: WidgetBodyProps) {
  const hourly = overview.activity.hourlyDistribution;
  const { cells, populatedCells, peak } = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const h of localizeHourBuckets(hourly as HourBucket[])) {
      if (h.dow < 0 || h.dow > 6 || h.hour < 0 || h.hour > 23) continue;
      grid[h.dow][h.hour] += h.sessions;
    }
    const out: HourCell[] = [];
    let populated = 0;
    let peakCell: HourCell | null = null;
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        const v = grid[dow][hour];
        if (v > 0) {
          const cell = { dow, hour, value: v };
          out.push(cell);
          populated++;
          if (!peakCell || v > peakCell.value) peakCell = cell;
        }
      }
    }
    return { cells: out, populatedCells: populated, peak: peakCell };
  }, [hourly]);

  if (populatedCells < HEATMAP_MIN_POPULATED_CELLS) {
    return (
      <SectionEmpty>
        {readinessSectionText(
          'heatmap',
          overview,
          capture,
          'Your coding rhythm fills in as you run more sessions',
        )}
      </SectionEmpty>
    );
  }

  return (
    <div className={styles.heatmapFrame}>
      {peak ? (
        <div className={styles.heatmapHead}>
          <StripFaceHead
            value={peak.value.toLocaleString()}
            caption={`busiest ${DAY_LABELS[peak.dow]} ${hourGlyph(peak.hour)}`}
            titleHint="Session starts by day and hour this window."
          />
        </div>
      ) : null}
      <div className={styles.heatmapChart}>
        <HourHeatmap
          data={cells}
          sizing="stretch"
          peak={peak ? { dow: peak.dow, hour: peak.hour } : null}
        />
      </div>
    </div>
  );
}

function HourlyEffectivenessWidget({ overview, capture }: WidgetBodyProps) {
  const byHour = localizeHourlyReasons(overview.activity.endReasonsByHour);
  const points = useMemo(
    () =>
      byHour.map((h) => ({
        hour: h.hour,
        value: h.reasons.reduce((s, r) => s + r.count, 0),
      })),
    [byHour],
  );

  if (byHour.length === 0 || totalEnded(byHour) === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText(
          'hourly-effectiveness',
          overview,
          capture,
          'Counts when sessions stopped, by hour, once you have ended a few',
        )}
      </SectionEmpty>
    );
  }

  const peak = [...points].sort((a, b) => b.value - a.value)[0];
  const formatValue = (n: number) =>
    `${n.toLocaleString()} ${n === 1 ? 'session' : 'sessions'}`;

  return (
    <div className={styles.cadenceFrame}>
      <StripFaceHead
        value={peak.value.toLocaleString()}
        caption={`busiest ${hourGlyph(peak.hour)}`}
        titleHint="When sessions stopped each hour this window. Not whether the work was good."
      />
      <HourCadenceChart
        points={points}
        ariaLabel={`When sessions stopped across 24 hours; peak ${hourGlyph(peak.hour)} with ${formatValue(peak.value)}`}
        formatValue={formatValue}
      />
    </div>
  );
}

export const activityWidgets: WidgetRegistry = {
  heatmap: HeatmapWidget,
  'hourly-effectiveness': HourlyEffectivenessWidget,
};

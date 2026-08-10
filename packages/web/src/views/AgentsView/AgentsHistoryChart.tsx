import type { CSSProperties } from 'react';

import { ToolInline } from '../../components/ToolIcon/ToolIcon.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { fmtCount } from '../../lib/voice/index.js';

import { recordRailWorthShowing, type AgentsHistorySeries } from './agentsVerdict.js';
import styles from './AgentsView.module.css';

/**
 * AgentsHistoryChart — the When panel's past-activity read: sessions by day,
 * edit lines by day, and tool calls by the viewer's clock hour, one bar group
 * per agent. In-DOM SVG (DESIGN_LANGUAGE: information-bearing visuals stay
 * inspectable), brand-tinted bars mixed toward ink, no forecasts, no smoothing:
 * a quiet day is a visible gap, and a day a tool ran without reporting line
 * counts renders a hollow dot at the baseline instead of a fabricated zero bar.
 */

const CHART_W = 720;
const CHART_H = 96;
const CHART_PAD = 2;

function barColor(agentId: string): string {
  return `color-mix(in srgb, ${getToolMeta(agentId).color} 72%, var(--ink))`;
}

function DayBars({
  days,
  values,
  agents,
  max,
  unit,
  showUnmeasuredDot,
}: {
  days: string[];
  values: (number | null)[][];
  agents: string[];
  max: number;
  unit: string;
  /** Render the hollow ran-but-unreported marker for null values. */
  showUnmeasuredDot?: boolean;
}) {
  const step = (CHART_W - CHART_PAD * 2) / Math.max(1, days.length);
  const groupW = step * 0.72;
  const barW = groupW / Math.max(1, agents.length);
  const usableH = CHART_H - 4;

  return (
    <svg
      className={styles.historySvg}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label={`${unit} per day by agent`}
    >
      <line
        className={styles.historyBaseline}
        x1={0}
        y1={CHART_H - 0.5}
        x2={CHART_W}
        y2={CHART_H - 0.5}
      />
      {days.map((day, di) =>
        agents.map((agent, ai) => {
          const value = values[di]?.[ai];
          if (value === undefined) return null;
          const x = CHART_PAD + di * step + (step - groupW) / 2 + ai * barW;
          if (value === null) {
            if (!showUnmeasuredDot) return null;
            return (
              <circle
                key={`${day}-${agent}`}
                className={styles.historyUnmeasured}
                cx={x + barW / 2}
                cy={CHART_H - 4}
                r={2}
                style={{ stroke: barColor(agent) }}
              >
                <title>{`${day}, ${getToolMeta(agent).label} ran, no line counts reported`}</title>
              </circle>
            );
          }
          if (value === 0 || max === 0) return null;
          const h = Math.max(1.5, (value / max) * usableH);
          return (
            <rect
              key={`${day}-${agent}`}
              className={styles.historyBar}
              x={x}
              y={CHART_H - h}
              width={Math.max(1, barW - 1)}
              height={h}
              rx={Math.min(1.5, barW / 3)}
              style={{ fill: barColor(agent) }}
            >
              <title>{`${day}, ${getToolMeta(agent).label}: ${fmtCount(value)} ${unit}`}</title>
            </rect>
          );
        }),
      )}
    </svg>
  );
}

/**
 * The record rail: for each tool, the slice of this window Seorak actually has a record of.
 *
 * Without it the two charts below are ambiguous in the one direction that matters. A day
 * before Codex was ever watched and a day Codex simply did nothing draw the SAME thing (no
 * bar), so a 30-day view reads as "Codex barely did anything" when it means "Seorak barely
 * watched Codex". The rail is drawn on the same x-scale as the bars, so the eye lines the
 * empty stretch up with the missing record without anyone having to say a word about it.
 *
 * Solid = we have a record. Hairline = window shown, nothing recorded. No hatch, no tint, no
 * ornament: the absence IS the statement.
 */
// The rail's SVG scales to the column width, so a viewBox unit lands at roughly a pixel.
// These are the real rendered heights: two 5px bars 9px apart read as one smudged line.
const RAIL_ROW_H = 16;
const RAIL_BAR_H = 7;

function RecordRail({
  days,
  agents,
  recordStart,
}: {
  days: string[];
  agents: string[];
  recordStart: (number | null)[];
}) {
  const step = (CHART_W - CHART_PAD * 2) / Math.max(1, days.length);
  const height = agents.length * RAIL_ROW_H;

  return (
    <svg
      className={styles.historySvg}
      viewBox={`0 0 ${CHART_W} ${height}`}
      role="img"
      aria-label="Days of this window Seorak has a record for, by agent"
    >
      {agents.map((agent, ai) => {
        const start = recordStart[ai];
        if (start === null || start === undefined) return null;
        const y = ai * RAIL_ROW_H + (RAIL_ROW_H - RAIL_BAR_H) / 2;
        const x = CHART_PAD + start * step;
        const w = CHART_W - CHART_PAD - x;
        const covered = days.length - start;
        const label = getToolMeta(agent).label;
        return (
          <g key={agent}>
            <line
              className={styles.railEmpty}
              x1={CHART_PAD}
              y1={y + RAIL_BAR_H / 2}
              x2={CHART_W - CHART_PAD}
              y2={y + RAIL_BAR_H / 2}
            />
            <rect
              className={styles.railHeld}
              x={x}
              y={y}
              width={Math.max(1.5, w)}
              height={RAIL_BAR_H}
              rx={RAIL_BAR_H / 2}
              style={{ fill: barColor(agent) }}
            >
              <title>
                {start === 0
                  ? `${label}: Seorak has a record for all ${fmtCount(days.length)} days shown`
                  : `${label}: Seorak has a record for the last ${fmtCount(covered)} of ${fmtCount(days.length)} days shown, starting ${days[start]}`}
              </title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

function HourBars({
  hourly,
  agents,
  max,
}: {
  hourly: number[][];
  agents: string[];
  max: number;
}) {
  const step = (CHART_W - CHART_PAD * 2) / 24;
  const groupW = step * 0.62;
  const barW = groupW / Math.max(1, agents.length);
  const usableH = CHART_H - 4;

  return (
    <svg
      className={styles.historySvg}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label="Tool calls by local clock hour, by agent"
    >
      <line
        className={styles.historyBaseline}
        x1={0}
        y1={CHART_H - 0.5}
        x2={CHART_W}
        y2={CHART_H - 0.5}
      />
      {hourly.map((row, hour) =>
        agents.map((agent, ai) => {
          const value = row[ai] ?? 0;
          if (value === 0 || max === 0) return null;
          const x = CHART_PAD + hour * step + (step - groupW) / 2 + ai * barW;
          const h = Math.max(1.5, (value / max) * usableH);
          return (
            <rect
              key={`${hour}-${agent}`}
              className={styles.historyBar}
              x={x}
              y={CHART_H - h}
              width={Math.max(1, barW - 1)}
              height={h}
              rx={Math.min(1.5, barW / 3)}
              style={{ fill: barColor(agent) }}
            >
              <title>{`${String(hour).padStart(2, '0')}:00, ${getToolMeta(agent).label}: ${fmtCount(value)} calls`}</title>
            </rect>
          );
        }),
      )}
    </svg>
  );
}

export default function AgentsHistoryChart({ series }: { series: AgentsHistorySeries }) {
  const firstDay = series.days[0];
  const lastDay = series.days[series.days.length - 1];
  const anyLines = series.lines.some((row) => row.some((v) => v !== null && v > 0));
  const anyUnmeasured = series.lines.some((row) => row.some((v) => v === null));
  // Only when a record demonstrably starts inside the window. When every tool has been here
  // the whole time the rail is a row of identical full-width bars, which cannot be false and
  // is therefore decoration, so it does not render at all.
  const showRail = recordRailWorthShowing(series.recordStart);

  return (
    <div className={styles.history}>
      <div className={styles.historyLegend} aria-label="Agents in the charts">
        {series.agents.map((agent) => (
          <span key={agent} className={styles.historyLegendItem}>
            <span
              className={styles.historyLegendSwatch}
              style={{ background: barColor(agent) } as CSSProperties}
              aria-hidden="true"
            />
            <ToolInline tool={agent} />
          </span>
        ))}
      </div>

      {showRail ? (
        <div className={styles.historyBlock}>
          <div className={styles.historyHead}>
            <span className={styles.historyTitle}>What Seorak has a record of</span>
          </div>
          <RecordRail
            days={series.days}
            agents={series.agents}
            recordStart={series.recordStart}
          />
          <div className={styles.historyAxis}>
            <span>{firstDay}</span>
            <span>{lastDay}</span>
          </div>
          <p className={styles.railNote}>
            A tool draws nothing below until its record starts. That gap means Seorak was not
            watching it yet, not that it did nothing.
          </p>
        </div>
      ) : null}

      <div className={styles.historyBlock}>
        <div className={styles.historyHead}>
          <span className={styles.historyTitle}>Sessions started</span>
          <span className={styles.historyScale}>peak {fmtCount(series.maxSessions)}/day</span>
        </div>
        <DayBars
          days={series.days}
          values={series.sessions}
          agents={series.agents}
          max={series.maxSessions}
          unit="sessions"
        />
        <div className={styles.historyAxis}>
          <span>{firstDay}</span>
          <span>{lastDay}</span>
        </div>
      </div>

      <div className={styles.historyBlock}>
        <div className={styles.historyHead}>
          <span className={styles.historyTitle}>Edit lines</span>
          <span className={styles.historyScale}>
            {anyLines ? `peak ${fmtCount(series.maxLines)}/day` : 'no line counts this window'}
          </span>
        </div>
        <DayBars
          days={series.days}
          values={series.lines}
          agents={series.agents}
          max={series.maxLines}
          unit="edit lines"
          showUnmeasuredDot
        />
        <div className={styles.historyAxis}>
          <span>{firstDay}</span>
          {anyUnmeasured ? (
            <span className={styles.historyFootnote}>
              hollow dot: the tool ran, line counts not reported
            </span>
          ) : null}
          <span>{lastDay}</span>
        </div>
      </div>

      <div className={styles.historyBlock}>
        <div className={styles.historyHead}>
          <span className={styles.historyTitle}>Calls by hour, your clock</span>
          <span className={styles.historyScale}>peak {fmtCount(series.maxHourly)}</span>
        </div>
        <HourBars hourly={series.hourly} agents={series.agents} max={series.maxHourly} />
        <div className={styles.historyAxis}>
          <span>00:00</span>
          <span>12:00</span>
          <span>23:00</span>
        </div>
      </div>
    </div>
  );
}

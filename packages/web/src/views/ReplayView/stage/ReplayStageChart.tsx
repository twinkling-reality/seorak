import {
  ReplayTimeStage,
  type ReplayStageRenderMode,
  type ReplayTimeStageMarker,
} from '../../../components/viz/time/index.js';
import {
  formatTimelineAxis,
  formatTimelineClock,
  gapThresholdMs,
  minWindowMs,
  timelineSpanMs,
  type ReplayTimeline,
  type ReplayWindow,
} from '../replayTimeline.js';
import type { ChartPoint, ChartSeries } from '../replayTransforms.js';

export type ReplayStageMarker = ReplayTimeStageMarker;
export type { ReplayStageRenderMode };

/** Binds the replay timeline to the domain-free time stage. */
export default function ReplayStageChart({
  chartData,
  sessionSeries,
  markers,
  timeline,
  window,
  onWindowChange,
  renderMode,
  playheadMs,
  onPlayheadChange,
}: {
  chartData: ChartPoint[];
  sessionSeries: ChartSeries[];
  markers: ReplayStageMarker[];
  timeline: ReplayTimeline;
  window: ReplayWindow;
  onWindowChange: (window: ReplayWindow) => void;
  renderMode: ReplayStageRenderMode;
  playheadMs: number;
  onPlayheadChange: (elapsedMs: number) => void;
}) {
  return (
    <ReplayTimeStage
      chartData={chartData}
      series={sessionSeries}
      markers={markers}
      scopeSpanMs={timelineSpanMs(timeline)}
      gapMs={gapThresholdMs(timeline)}
      minWindowMs={minWindowMs(timeline)}
      window={window}
      onWindowChange={onWindowChange}
      renderMode={renderMode}
      playheadMs={playheadMs}
      onPlayheadChange={onPlayheadChange}
      formatAxis={(elapsedMs) => formatTimelineAxis(timeline, elapsedMs)}
      formatSpan={(ms) => formatTimelineClock(ms, timeline.spanMs)}
    />
  );
}

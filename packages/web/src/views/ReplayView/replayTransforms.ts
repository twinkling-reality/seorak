import type { ReplayActivityBucket, ReplaySession, SessionSummary } from '../../lib/apiSchemas.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { projectAccent, projectGradient } from '../../lib/projectGradient.js';
import { repoIdFor } from './replaySessionHelpers.js';
import type { ReplayTimeline } from './replayTimeline.js';

/** Above this many series, overlaid lines stop being readable and lanes win. */
export const LANE_MODE_SERIES_THRESHOLD = 5;

/** Distinct line color for session drill-down; rhymes with projectAccent hue. */
export function sessionSeriesAccent(repoId: string, index: number, total: number): string {
  const h = hashHue(repoId);
  if (total <= 1) return projectAccent(repoId);
  const lightness = 44 + (index / Math.max(1, total - 1)) * 24;
  const saturation = 34 + (index % 3) * 4;
  return `hsl(${h}, ${saturation}%, ${lightness}%)`;
}

function hashHue(repoId: string): number {
  let hash = 5381;
  for (let i = 0; i < repoId.length; i++) {
    hash = ((hash << 5) + hash + repoId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/** Throughput index for one activity bucket. Web-only; not in the replay contract.
 *  Weights: costUsd + toolCallCount×0.002 + tokensTotal÷120_000. */
export function throughputIndex(bucket: ReplayActivityBucket): number {
  return bucket.costUsd + bucket.toolCallCount * 0.002 + bucket.tokensTotal / 120_000;
}

export type SessionLane = {
  sessionId: string;
  replay: ReplaySession | null;
  session: SessionSummary | null;
  isLoading?: boolean;
  error?: string | null;
  index: number;
};

export type ChartSeries = {
  key: string;
  label: string;
  /** Full status for aria-labels and tooltips. */
  status: string;
  /** Compact superscript beside the label (Customize-button count pattern). */
  statusSup?: string;
  color: string;
  gradient: string;
  repoId: string;
  sessionIds: string[];
  kind: 'project' | 'session';
};

/**
 * One activity instant on the scope timeline. Values are RAW throughput index,
 * not a 0–100 scale: the stage normalizes to whatever is inside the current
 * focus window, so zooming into a quiet stretch makes that stretch readable
 * instead of leaving it pinned to the floor by one distant peak.
 */
export type ChartPoint = {
  elapsedMs: number;
  [seriesKey: string]: number;
};

export type LegendItem = {
  series: ChartSeries;
  /** Whether this session's line is drawn on the chart. */
  selected: boolean;
};

function seriesKey(id: string): string {
  return `series_${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function sessionStatus(session: SessionSummary | null, fallback: string): string {
  if (!session) return fallback;
  const recency = formatRelativeTime(session.lastEventAt);
  return recency ? `${session.status} ${recency}` : session.status;
}

function formatSessionStart(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function sessionSeriesLabel(lane: SessionLane, index: number): string {
  const started = formatSessionStart(lane.session?.startedAt);
  const sessionNumber = `Session ${index + 1}`;
  return started ? `${sessionNumber}, ${started}` : sessionNumber;
}

function projectStatus(lanes: SessionLane[]): { status: string; statusSup?: string } {
  const running = lanes.filter((lane) => lane.session?.status === 'active').length;
  if (lanes.length > 1) {
    return {
      status: running > 0 ? `${running} active` : `${lanes.length} sessions`,
      statusSup: String(lanes.length),
    };
  }
  return {
    status: sessionStatus(lanes[0]?.session ?? null, lanes[0]?.sessionId ?? ''),
  };
}

export function buildChartSeries(
  lanes: SessionLane[],
  focusedProjectId: string | null,
): ChartSeries[] {
  if (focusedProjectId) {
    const projectLanes = lanes.filter(
      (lane) => repoIdFor(lane.session, lane.sessionId) === focusedProjectId,
    );
    return projectLanes.map((lane, index) => {
      const repoId = repoIdFor(lane.session, lane.sessionId);
      const status = sessionStatus(lane.session, lane.sessionId);
      return {
        key: seriesKey(lane.sessionId),
        label: sessionSeriesLabel(lane, index),
        status,
        color: sessionSeriesAccent(repoId, index, projectLanes.length),
        gradient: projectGradient(repoId),
        repoId,
        sessionIds: [lane.sessionId],
        kind: 'session' as const,
      };
    });
  }

  const byProject = new Map<string, SessionLane[]>();
  for (const lane of lanes) {
    const repoId = repoIdFor(lane.session, lane.sessionId);
    const group = byProject.get(repoId) ?? [];
    group.push(lane);
    byProject.set(repoId, group);
  }

  return [...byProject.entries()].map(([repoId, projectLanes]) => {
    const label = projectLanes[0]?.session?.project || repoId;
    const sessionIds = projectLanes.map((lane) => lane.sessionId);
    const { status, statusSup } = projectStatus(projectLanes);
    return {
      key: seriesKey(repoId),
      label,
      status,
      statusSup,
      color: projectAccent(repoId),
      gradient: projectGradient(repoId),
      repoId,
      sessionIds,
      kind: 'project' as const,
    };
  });
}

/** Full session list for focused-project legend; stable colors across chart toggles. */
export function buildFocusedSessionLegend(
  poolSessions: SessionSummary[],
  focusedProjectId: string,
  hiddenSessionIds: ReadonlySet<string>,
): LegendItem[] {
  const projectSessions = poolSessions.filter(
    (session) => repoIdFor(session, session.sessionId) === focusedProjectId,
  );
  return projectSessions.map((session, index) => {
    const repoId = repoIdFor(session, session.sessionId);
    const lane: SessionLane = {
      sessionId: session.sessionId,
      replay: null,
      session,
      index,
    };
    return {
      series: {
        key: seriesKey(session.sessionId),
        label: sessionSeriesLabel(lane, index),
        status: sessionStatus(session, session.sessionId),
        color: sessionSeriesAccent(repoId, index, projectSessions.length),
        gradient: projectGradient(repoId),
        repoId,
        sessionIds: [session.sessionId],
        kind: 'session' as const,
      },
      selected: !hiddenSessionIds.has(session.sessionId),
    };
  });
}

function addBucketScores(
  targetKey: string,
  replay: ReplaySession,
  timeline: ReplayTimeline,
  byElapsed: Map<number, ChartPoint>,
): void {
  for (const bucket of replay.activity) {
    const at = Date.parse(bucket.at);
    if (Number.isNaN(at)) continue;
    // Measured from the scope origin, so a session that started five hours in
    // draws five hours in — not on top of every other session at zero.
    const elapsedMs = at - timeline.originMs;
    const point = byElapsed.get(elapsedMs) ?? { elapsedMs };
    point[targetKey] = (point[targetKey] ?? 0) + throughputIndex(bucket);
    byElapsed.set(elapsedMs, point);
  }
}

export function buildChartData(
  series: ChartSeries[],
  lanes: SessionLane[],
  timeline: ReplayTimeline,
): ChartPoint[] {
  const laneById = new Map(lanes.map((lane) => [lane.sessionId, lane]));
  const byElapsed = new Map<number, ChartPoint>();

  for (const item of series) {
    for (const sessionId of item.sessionIds) {
      const lane = laneById.get(sessionId);
      if (lane?.replay) addBucketScores(item.key, lane.replay, timeline, byElapsed);
    }
  }

  return [...byElapsed.values()].sort((a, b) => a.elapsedMs - b.elapsedMs);
}

/** Lanes once overlaid lines stop being separable by color alone. */
export function shouldDefaultToLanes(seriesCount: number): boolean {
  return seriesCount > LANE_MODE_SERIES_THRESHOLD;
}

export function focusedProjectFromParam(value: string | null, lanes: SessionLane[]): string | null {
  if (!value) return null;
  const ids = new Set(lanes.map((lane) => repoIdFor(lane.session, lane.sessionId)));
  return ids.has(value) ? value : null;
}

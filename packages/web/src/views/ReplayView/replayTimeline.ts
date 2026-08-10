// One origin, not N.
//
// The stage used to key every session's activity to that session's OWN start,
// then merge the results into a single map. Twenty sessions therefore all began
// at x=0 and the axis length was set by whichever single session ran longest —
// so a day of short bursts collapsed into a hairline at the left edge and
// "where did attention spike" had no representation at all.
//
// A replay timeline instead has ONE origin (the earliest session start in
// scope). Every elapsed value downstream — chart points, stage markers, review
// items, playback stop targets — is measured from that origin, so sessions land
// at their true relative positions. For a single-session scope the origin IS
// the session start, which is why single-session replay is unchanged.
//
// The window math itself is domain-free and lives in the viz layer
// (components/viz/time/timeWindow.ts); this module binds it to a timeline.

import {
  axisLabelKind,
  clampWindow as clampTimeWindow,
  formatElapsedClock,
  fullWindow as fullTimeWindow,
  isFullWindow as isFullTimeWindow,
  pageWindowTo as pageTimeWindowTo,
  panWindow as panTimeWindow,
  zoomWindow as zoomTimeWindow,
  type TimeWindow,
} from '../../components/viz/time/timeWindow.js';
import type { SessionLane } from './replayTransforms.js';

export {
  axisLabelKind,
  axisTickStepMs,
  axisTicks,
  binMarkers,
  busiestMarkerBin,
  elapsedAtWindowFrac,
  isInWindow,
  windowFrac,
  windowSpanMs,
  type AxisTick,
  type BinnableMarker,
  type MarkerBin,
  type MarkerTone,
} from '../../components/viz/time/timeWindow.js';

/** A focus window over the replay timeline, in scope-relative elapsed ms. */
export type ReplayWindow = TimeWindow;

/** Fallback bucket width when no loaded replay has declared one. */
export const DEFAULT_BUCKET_MS = 30_000;

/** A gap wider than this many bucket widths breaks the line instead of spanning it. */
const GAP_BUCKET_FACTOR = 1.5;

/** Smallest focus window, as a multiple of the bucket width. */
const MIN_WINDOW_BUCKETS = 4;

/** One session's captured life on the scope clock. */
export interface ReplaySessionSpan {
  /** Scope-relative elapsed at the session's own start. */
  startMs: number;
  /**
   * Scope-relative elapsed at the last thing we captured for it — its end, or
   * its last activity. Never "now": claiming a session ran through a stretch
   * with no capture behind it would invent the part we cannot see.
   */
  endMs: number;
}

export interface ReplayTimeline {
  /** Wall-clock ms of the scope origin — earliest session start in scope. */
  originMs: number;
  /** Scope length in ms, origin through the last captured activity. */
  spanMs: number;
  /** Widest activity bucket in scope; sizes gap breaks and marker bins. */
  bucketMs: number;
  /** Offset from the origin to each session's own start, keyed by session id. */
  sessionOffsets: Map<string, number>;
  /** Captured bounds per session, for reading concurrency at an instant. */
  sessionSpans: Map<string, ReplaySessionSpan>;
  /** True once the scope holds more than one session. */
  multiSession: boolean;
}

function laneStartMs(lane: SessionLane): number | null {
  const fromReplay = lane.replay ? Date.parse(lane.replay.startedAt) : NaN;
  if (!Number.isNaN(fromReplay)) return fromReplay;
  const fromSession = lane.session?.startedAt ? Date.parse(lane.session.startedAt) : NaN;
  return Number.isNaN(fromSession) ? null : fromSession;
}

function laneEndMs(lane: SessionLane, startMs: number): number {
  if (lane.replay) {
    const ended = lane.replay.endedAt ? Date.parse(lane.replay.endedAt) : NaN;
    if (!Number.isNaN(ended)) return ended;
    const lastBucket = lane.replay.activity[lane.replay.activity.length - 1];
    if (lastBucket) {
      const at = Date.parse(lastBucket.at);
      if (!Number.isNaN(at)) return at + lastBucket.bucketMs;
    }
  }
  const lastEvent = lane.session?.lastEventAt ? Date.parse(lane.session.lastEventAt) : NaN;
  if (!Number.isNaN(lastEvent)) return lastEvent;
  const elapsed = Math.max(0, (lane.session?.elapsedSeconds ?? 0) * 1000);
  return startMs + elapsed;
}

/** Scope timeline across every lane. Honest-empty scopes get a zero span. */
export function buildReplayTimeline(lanes: SessionLane[]): ReplayTimeline {
  let originMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  let bucketMs = 0;
  const bounds = new Map<string, { startMs: number; endMs: number }>();

  for (const lane of lanes) {
    const start = laneStartMs(lane);
    if (start == null) continue;
    const end = laneEndMs(lane, start);
    bounds.set(lane.sessionId, { startMs: start, endMs: Math.max(start, end) });
    originMs = Math.min(originMs, start);
    latestMs = Math.max(latestMs, end);
    for (const bucket of lane.replay?.activity ?? []) {
      if (bucket.bucketMs > bucketMs) bucketMs = bucket.bucketMs;
    }
  }

  if (!Number.isFinite(originMs)) {
    return {
      originMs: 0,
      spanMs: 0,
      bucketMs: DEFAULT_BUCKET_MS,
      sessionOffsets: new Map(),
      sessionSpans: new Map(),
      multiSession: false,
    };
  }

  const sessionOffsets = new Map<string, number>();
  const sessionSpans = new Map<string, ReplaySessionSpan>();
  for (const [sessionId, bound] of bounds) {
    sessionOffsets.set(sessionId, bound.startMs - originMs);
    sessionSpans.set(sessionId, {
      startMs: bound.startMs - originMs,
      endMs: bound.endMs - originMs,
    });
  }

  return {
    originMs,
    spanMs: Math.max(0, latestMs - originMs),
    bucketMs: bucketMs > 0 ? bucketMs : DEFAULT_BUCKET_MS,
    sessionOffsets,
    sessionSpans,
    multiSession: bounds.size > 1,
  };
}

/** Offset from the scope origin to one session's own start. */
export function sessionOffsetMs(timeline: ReplayTimeline, sessionId: string): number {
  return timeline.sessionOffsets.get(sessionId) ?? 0;
}

/**
 * Sessions whose captured span covers a scope-relative instant. This is what
 * "3 running" means at the playhead: three sessions had started and had not yet
 * produced their last captured event.
 */
export function sessionsRunningAt(timeline: ReplayTimeline, elapsedMs: number): string[] {
  const running: string[] = [];
  for (const [sessionId, span] of timeline.sessionSpans) {
    if (elapsedMs >= span.startMs && elapsedMs <= span.endMs) running.push(sessionId);
  }
  return running;
}

/** Scope-relative elapsed → that session's own elapsed clock. */
export function toSessionElapsedMs(
  timeline: ReplayTimeline,
  sessionId: string,
  scopeElapsedMs: number,
): number {
  return scopeElapsedMs - sessionOffsetMs(timeline, sessionId);
}

/** Scope-relative elapsed for one timestamp inside the scope. */
export function elapsedFromOrigin(timeline: ReplayTimeline, at: string): number | null {
  const atMs = Date.parse(at);
  if (Number.isNaN(atMs)) return null;
  return atMs - timeline.originMs;
}

/** Gap wider than this reads as absence and breaks the line. */
export function gapThresholdMs(timeline: ReplayTimeline): number {
  return timeline.bucketMs * GAP_BUCKET_FACTOR;
}

export function timelineSpanMs(timeline: ReplayTimeline): number {
  return Math.max(1, timeline.spanMs);
}

export function minWindowMs(timeline: ReplayTimeline): number {
  return Math.min(timelineSpanMs(timeline), Math.max(1_000, timeline.bucketMs * MIN_WINDOW_BUCKETS));
}

export function fullWindow(timeline: ReplayTimeline): ReplayWindow {
  return fullTimeWindow(timelineSpanMs(timeline));
}

export function isFullWindow(window: ReplayWindow, timeline: ReplayTimeline): boolean {
  return isFullTimeWindow(window, timelineSpanMs(timeline));
}

export function clampWindow(window: ReplayWindow, timeline: ReplayTimeline): ReplayWindow {
  return clampTimeWindow(window, timelineSpanMs(timeline), minWindowMs(timeline));
}

export function zoomWindow(
  window: ReplayWindow,
  timeline: ReplayTimeline,
  factor: number,
  anchorMs: number,
): ReplayWindow {
  return zoomTimeWindow(window, timelineSpanMs(timeline), minWindowMs(timeline), factor, anchorMs);
}

export function panWindow(
  window: ReplayWindow,
  timeline: ReplayTimeline,
  deltaMs: number,
): ReplayWindow {
  return panTimeWindow(window, timelineSpanMs(timeline), minWindowMs(timeline), deltaMs);
}

export function pageWindowTo(
  window: ReplayWindow,
  timeline: ReplayTimeline,
  elapsedMs: number,
): ReplayWindow {
  return pageTimeWindowTo(window, timelineSpanMs(timeline), minWindowMs(timeline), elapsedMs);
}

/** Elapsed clock scaled to the scope length. */
export function formatTimelineClock(elapsedMs: number, spanMs: number): string {
  return formatElapsedClock(elapsedMs, spanMs);
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
const WEEKDAY_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
};
const DATE_FORMAT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

/** Axis label for one scope-relative elapsed value. */
export function formatTimelineAxis(timeline: ReplayTimeline, elapsedMs: number): string {
  const span = timelineSpanMs(timeline);
  const kind = axisLabelKind(span);
  if (kind === 'elapsed') return formatElapsedClock(elapsedMs, span);
  const at = new Date(timeline.originMs + elapsedMs);
  if (Number.isNaN(at.getTime())) return formatElapsedClock(elapsedMs, span);
  const options =
    kind === 'time' ? TIME_FORMAT : kind === 'weekday' ? WEEKDAY_FORMAT : DATE_FORMAT;
  return new Intl.DateTimeFormat(undefined, options).format(at);
}

/** Full stamp for hover and tooltips — always names the wall-clock instant. */
export function formatTimelineStamp(timeline: ReplayTimeline, elapsedMs: number): string {
  const at = new Date(timeline.originMs + elapsedMs);
  if (Number.isNaN(at.getTime())) {
    return formatElapsedClock(elapsedMs, timelineSpanMs(timeline));
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

import { describe, expect, it } from 'vitest';

import type { ReplaySession } from '../../../lib/apiSchemas.js';
import type { SessionLane } from '../replayTransforms.js';
import {
  axisLabelKind,
  axisTickStepMs,
  axisTicks,
  binMarkers,
  buildReplayTimeline,
  busiestMarkerBin,
  clampWindow,
  elapsedFromOrigin,
  formatTimelineClock,
  fullWindow,
  gapThresholdMs,
  isFullWindow,
  minWindowMs,
  pageWindowTo,
  panWindow,
  sessionOffsetMs,
  sessionsRunningAt,
  toSessionElapsedMs,
  windowFrac,
  zoomWindow,
  type BinnableMarker,
} from '../replayTimeline.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function replay(sessionId: string, startedAt: string, endedAt: string | null): ReplaySession {
  return {
    sessionId,
    agent: 'claude-code',
    startedAt,
    endedAt,
    keyframes: [],
    activity: [
      { at: startedAt, bucketMs: 30_000, costUsd: 0.1, toolCallCount: 1, tokensTotal: 100 },
    ],
    moments: [],
    totals: { costUsd: 0.1, tokensTotal: 100, toolCallCount: 1, promptCount: 0 },
  };
}

function lane(sessionId: string, startedAt: string, endedAt: string | null): SessionLane {
  return {
    sessionId,
    replay: replay(sessionId, startedAt, endedAt),
    session: null,
    index: 0,
  };
}

describe('buildReplayTimeline', () => {
  it('uses the earliest session start as the single origin', () => {
    const timeline = buildReplayTimeline([
      lane('late', '2026-06-04T15:00:00.000Z', '2026-06-04T15:30:00.000Z'),
      lane('early', '2026-06-04T09:00:00.000Z', '2026-06-04T09:20:00.000Z'),
    ]);

    expect(timeline.originMs).toBe(Date.parse('2026-06-04T09:00:00.000Z'));
    expect(timeline.spanMs).toBe(6.5 * HOUR);
    expect(timeline.multiSession).toBe(true);
  });

  it('places a later session at its real offset instead of at zero', () => {
    const timeline = buildReplayTimeline([
      lane('a', '2026-06-04T09:00:00.000Z', '2026-06-04T09:20:00.000Z'),
      lane('b', '2026-06-04T14:00:00.000Z', '2026-06-04T14:10:00.000Z'),
    ]);

    expect(sessionOffsetMs(timeline, 'a')).toBe(0);
    expect(sessionOffsetMs(timeline, 'b')).toBe(5 * HOUR);
    expect(toSessionElapsedMs(timeline, 'b', 5 * HOUR + MINUTE)).toBe(MINUTE);
  });

  it('reads how many sessions were running at an instant', () => {
    const timeline = buildReplayTimeline([
      lane('a', '2026-06-04T09:00:00.000Z', '2026-06-04T10:00:00.000Z'),
      lane('b', '2026-06-04T09:30:00.000Z', '2026-06-04T11:00:00.000Z'),
      lane('c', '2026-06-04T12:00:00.000Z', '2026-06-04T12:30:00.000Z'),
    ]);

    expect(sessionsRunningAt(timeline, 15 * MINUTE)).toEqual(['a']);
    expect(sessionsRunningAt(timeline, 45 * MINUTE).sort()).toEqual(['a', 'b']);
    // Between b ending and c starting nothing was running. That is a reading,
    // not a missing one.
    expect(sessionsRunningAt(timeline, 2.5 * HOUR)).toEqual([]);
    expect(sessionsRunningAt(timeline, 3.25 * HOUR)).toEqual(['c']);
  });

  it('bounds a still-running session at its last capture, never at now', () => {
    const open = lane('open', '2026-06-04T09:00:00.000Z', null);
    const timeline = buildReplayTimeline([open]);

    // One 30s bucket is all it captured, so that is where its span ends —
    // claiming it ran on would invent the part we cannot see.
    expect(timeline.sessionSpans.get('open')).toEqual({ startMs: 0, endMs: 30_000 });
    expect(sessionsRunningAt(timeline, 20_000)).toEqual(['open']);
    expect(sessionsRunningAt(timeline, 40_000)).toEqual([]);
  });

  it('leaves a single-session scope identical to its own elapsed clock', () => {
    const timeline = buildReplayTimeline([
      lane('solo', '2026-06-04T12:00:00.000Z', '2026-06-04T12:10:00.000Z'),
    ]);

    expect(timeline.originMs).toBe(Date.parse('2026-06-04T12:00:00.000Z'));
    expect(timeline.spanMs).toBe(10 * MINUTE);
    expect(timeline.multiSession).toBe(false);
    expect(elapsedFromOrigin(timeline, '2026-06-04T12:05:00.000Z')).toBe(5 * MINUTE);
  });

  it('falls back to the session summary when no replay has loaded', () => {
    const timeline = buildReplayTimeline([
      {
        sessionId: 'pending',
        replay: null,
        session: {
          startedAt: '2026-06-04T08:00:00.000Z',
          lastEventAt: '2026-06-04T08:45:00.000Z',
        } as never,
        index: 0,
      },
    ]);

    expect(timeline.originMs).toBe(Date.parse('2026-06-04T08:00:00.000Z'));
    expect(timeline.spanMs).toBe(45 * MINUTE);
  });

  it('stays honest-empty with no usable lanes', () => {
    const timeline = buildReplayTimeline([]);
    expect(timeline.spanMs).toBe(0);
    expect(timeline.multiSession).toBe(false);
  });

  it('breaks lines on a gap wider than one bucket', () => {
    const timeline = buildReplayTimeline([
      lane('a', '2026-06-04T09:00:00.000Z', '2026-06-04T09:20:00.000Z'),
    ]);
    expect(gapThresholdMs(timeline)).toBe(45_000);
  });
});

describe('replay window', () => {
  const timeline = buildReplayTimeline([
    lane('a', '2026-06-04T00:00:00.000Z', '2026-06-04T10:00:00.000Z'),
  ]);

  it('starts at the full span', () => {
    const window = fullWindow(timeline);
    expect(window).toEqual({ startMs: 0, endMs: 10 * HOUR });
    expect(isFullWindow(window, timeline)).toBe(true);
  });

  it('holds a window inside the timeline', () => {
    expect(clampWindow({ startMs: -5 * HOUR, endMs: 2 * HOUR }, timeline)).toEqual({
      startMs: 0,
      endMs: 7 * HOUR,
    });
    expect(clampWindow({ startMs: 9 * HOUR, endMs: 20 * HOUR }, timeline)).toEqual({
      startMs: 0,
      endMs: 10 * HOUR,
    });
  });

  it('never collapses below the minimum window', () => {
    const tiny = clampWindow({ startMs: 100, endMs: 200 }, timeline);
    expect(tiny.endMs - tiny.startMs).toBe(minWindowMs(timeline));
  });

  it('zooms around an anchor and keeps the anchor in place', () => {
    const start = { startMs: 0, endMs: 10 * HOUR };
    const zoomed = zoomWindow(start, timeline, 0.5, 5 * HOUR);
    expect(zoomed.endMs - zoomed.startMs).toBe(5 * HOUR);
    expect(windowFrac(zoomed, 5 * HOUR)).toBeCloseTo(0.5);
  });

  it('will not zoom out past the full span', () => {
    const zoomed = zoomWindow({ startMs: 2 * HOUR, endMs: 4 * HOUR }, timeline, 100, 3 * HOUR);
    expect(isFullWindow(zoomed, timeline)).toBe(true);
  });

  it('pans without leaving the timeline', () => {
    expect(panWindow({ startMs: 0, endMs: 2 * HOUR }, timeline, HOUR)).toEqual({
      startMs: HOUR,
      endMs: 3 * HOUR,
    });
    expect(panWindow({ startMs: 9 * HOUR, endMs: 10 * HOUR }, timeline, 5 * HOUR)).toEqual({
      startMs: 9 * HOUR,
      endMs: 10 * HOUR,
    });
  });

  it('turns a page only when the playhead leaves the window', () => {
    const window = { startMs: 0, endMs: 2 * HOUR };
    expect(pageWindowTo(window, timeline, HOUR)).toBe(window);
    const paged = pageWindowTo(window, timeline, 3 * HOUR);
    expect(paged.startMs).toBeLessThan(3 * HOUR);
    expect(paged.endMs).toBeGreaterThan(3 * HOUR);
    expect(paged.endMs - paged.startMs).toBe(2 * HOUR);
  });
});

describe('timeline labels', () => {
  it('formats elapsed by scope length', () => {
    expect(formatTimelineClock(65_000, 30 * MINUTE)).toBe('1:05');
    expect(formatTimelineClock(3 * HOUR + 5 * MINUTE + 7_000, 6 * HOUR)).toBe('3:05:07');
    expect(formatTimelineClock(2 * DAY + 3 * HOUR + 4 * MINUTE, 7 * DAY)).toBe('2d 03:04');
  });

  it('switches from elapsed to an absolute stamp past a few hours', () => {
    expect(axisLabelKind(30 * MINUTE)).toBe('elapsed');
    expect(axisLabelKind(12 * HOUR)).toBe('time');
    expect(axisLabelKind(3 * DAY)).toBe('weekday');
    expect(axisLabelKind(30 * DAY)).toBe('date');
  });

  it('picks round tick steps for the window', () => {
    expect(axisTickStepMs({ startMs: 0, endMs: 10 * MINUTE }, 5)).toBe(2 * MINUTE);
    expect(axisTickStepMs({ startMs: 0, endMs: 10 * HOUR }, 5)).toBe(2 * HOUR);
    expect(axisTickStepMs({ startMs: 0, endMs: 90 * DAY }, 5)).toBe(30 * DAY);
  });

  it('aligns ticks to the step inside the window', () => {
    const ticks = axisTicks({ startMs: 90_000, endMs: 10 * MINUTE }, 5);
    expect(ticks[0]?.elapsedMs).toBe(2 * MINUTE);
    expect(ticks.every((tick) => tick.frac >= 0 && tick.frac <= 1)).toBe(true);
  });
});

describe('binMarkers', () => {
  const markers: BinnableMarker[] = [
    { elapsedMs: 1_000, kind: 'moment', tone: 'neutral' },
    { elapsedMs: 1_500, kind: 'moment', tone: 'alert' },
    { elapsedMs: 2_000, kind: 'keyframe', tone: 'commit' },
    { elapsedMs: 90_000, kind: 'moment', tone: 'peak' },
  ];

  it('collapses a dust cloud into counted columns', () => {
    const bins = binMarkers(markers, { startMs: 0, endMs: 100_000 }, 10);
    expect(bins).toHaveLength(2);
    expect(bins[0]?.count).toBe(3);
    expect(bins[0]?.attentionCount).toBe(2);
    expect(bins[0]?.keyframeCount).toBe(1);
  });

  it('keeps the highest-priority tone in a mixed bin', () => {
    const bins = binMarkers(markers, { startMs: 0, endMs: 100_000 }, 10);
    expect(bins[0]?.tone).toBe('alert');
    expect(bins[1]?.tone).toBe('peak');
  });

  it('drops markers outside the window instead of clamping them to the edge', () => {
    const bins = binMarkers(markers, { startMs: 50_000, endMs: 100_000 }, 10);
    expect(bins).toHaveLength(1);
    expect(bins[0]?.count).toBe(1);
  });

  it('names the busiest bin by attention first', () => {
    const bins = binMarkers(markers, { startMs: 0, endMs: 100_000 }, 10);
    expect(busiestMarkerBin(bins)?.attentionCount).toBe(2);
    expect(busiestMarkerBin([])).toBeNull();
  });
});

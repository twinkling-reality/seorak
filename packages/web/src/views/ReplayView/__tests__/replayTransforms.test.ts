import { describe, expect, it } from 'vitest';

import type { ReplaySession } from '../../../lib/apiSchemas.js';
import { buildNarrative } from '../replayNarrative.js';
import { windowKeyPeaks, windowMaxValue } from '../../../components/viz/time/timeWindow.js';
import { buildReplayTimeline } from '../replayTimeline.js';
import {
  throughputIndex,
  buildChartData,
  buildChartSeries,
  buildFocusedSessionLegend,
  sessionSeriesAccent,
  shouldDefaultToLanes,
} from '../replayTransforms.js';

function sampleReplay(
  sessionId: string,
  project: string,
  costUsd: number,
  startedAt = '2026-06-04T12:00:00.000Z',
): ReplaySession {
  const startMs = Date.parse(startedAt);
  const at = (offsetMs: number) => new Date(startMs + offsetMs).toISOString();
  return {
    sessionId,
    agent: 'claude-code',
    startedAt,
    endedAt: at(600_000),
    keyframes: [],
    activity: [
      { at: at(0), bucketMs: 30_000, costUsd, toolCallCount: 1, tokensTotal: 100 },
      { at: at(300_000), bucketMs: 30_000, costUsd: costUsd * 2, toolCallCount: 2, tokensTotal: 400 },
    ],
    moments: [],
    totals: { costUsd: costUsd * 3, tokensTotal: 500, toolCallCount: 3, promptCount: 0 },
  };
}

describe('replayTransforms', () => {
  it('scores activity from bucket throughput', () => {
    expect(
      throughputIndex({
        at: '2026-06-04T12:00:00.000Z',
        bucketMs: 30_000,
        costUsd: 0.1,
        toolCallCount: 2,
        tokensTotal: 120_000,
      }),
    ).toBeCloseTo(1.104);
  });

  it('aggregates sessions of one project into a single line', () => {
    const lanes = [
      {
        sessionId: 's1',
        replay: sampleReplay('s1', 'alpha', 0.1),
        session: { sessionId: 's1', project: 'alpha', repoId: 'alpha', status: 'ended' } as never,
        index: 0,
      },
      {
        sessionId: 's2',
        replay: sampleReplay('s2', 'alpha', 0.5),
        session: { sessionId: 's2', project: 'alpha', repoId: 'alpha', status: 'ended' } as never,
        index: 1,
      },
    ];
    const series = buildChartSeries(lanes, null);
    expect(series).toHaveLength(1);
    expect(series[0]?.kind).toBe('project');

    const timeline = buildReplayTimeline(lanes);
    const data = buildChartData(series, lanes, timeline);
    const key = series[0]!.key;
    // Both sessions start together here, so their buckets land on the same
    // instants and sum into one value per point.
    expect(data.map((point) => point.elapsedMs)).toEqual([0, 300_000]);
    expect(data[1]![key]).toBeCloseTo(throughputIndex(lanes[0]!.replay.activity[1]!) + throughputIndex(lanes[1]!.replay.activity[1]!));
  });

  it('places a later session at its real offset instead of stacking it at zero', () => {
    const lanes = [
      {
        sessionId: 'morning',
        replay: sampleReplay('morning', 'alpha', 0.1, '2026-06-04T09:00:00.000Z'),
        session: { sessionId: 'morning', project: 'alpha', repoId: 'alpha', status: 'ended' } as never,
        index: 0,
      },
      {
        sessionId: 'evening',
        replay: sampleReplay('evening', 'beta', 0.2, '2026-06-04T18:00:00.000Z'),
        session: { sessionId: 'evening', project: 'beta', repoId: 'beta', status: 'ended' } as never,
        index: 1,
      },
    ];
    const timeline = buildReplayTimeline(lanes);
    const series = buildChartSeries(lanes, null);
    const data = buildChartData(series, lanes, timeline);

    expect(data.map((point) => point.elapsedMs)).toEqual([
      0,
      300_000,
      9 * 3_600_000,
      9 * 3_600_000 + 300_000,
    ]);
    // Each project only carries values where it actually ran.
    const alphaKey = series.find((item) => item.repoId === 'alpha')!.key;
    expect(data[2]![alphaKey]).toBeUndefined();
  });

  it('normalizes to the focus window, not to one distant peak', () => {
    const lanes = [
      {
        sessionId: 'quiet',
        replay: sampleReplay('quiet', 'alpha', 0.01, '2026-06-04T09:00:00.000Z'),
        session: { sessionId: 'quiet', project: 'alpha', repoId: 'alpha', status: 'ended' } as never,
        index: 0,
      },
      {
        sessionId: 'hot',
        replay: sampleReplay('hot', 'beta', 5, '2026-06-04T18:00:00.000Z'),
        session: { sessionId: 'hot', project: 'beta', repoId: 'beta', status: 'ended' } as never,
        index: 1,
      },
    ];
    const timeline = buildReplayTimeline(lanes);
    const series = buildChartSeries(lanes, null);
    const data = buildChartData(series, lanes, timeline);

    const keys = series.map((item) => item.key);
    const wholeScope = windowMaxValue(data, keys, { startMs: 0, endMs: timeline.spanMs });
    const quietOnly = windowMaxValue(data, keys, { startMs: 0, endMs: 3_600_000 });
    expect(wholeScope).toBeGreaterThan(quietOnly * 100);
    // Zoomed into the quiet morning, the quiet work is what fills the plot.
    expect(quietOnly).toBeGreaterThan(0);
  });

  it('reports each series peak inside the window', () => {
    const lanes = [
      {
        sessionId: 's1',
        replay: sampleReplay('s1', 'alpha', 0.1),
        session: { sessionId: 's1', project: 'alpha', repoId: 'alpha', status: 'ended' } as never,
        index: 0,
      },
    ];
    const timeline = buildReplayTimeline(lanes);
    const series = buildChartSeries(lanes, null);
    const data = buildChartData(series, lanes, timeline);
    const peaks = windowKeyPeaks(data, [series[0]!.key], { startMs: 0, endMs: timeline.spanMs });
    expect(peaks.get(series[0]!.key)).toBeCloseTo(throughputIndex(lanes[0]!.replay.activity[1]!));
  });

  it('switches to lanes once lines stop being separable', () => {
    expect(shouldDefaultToLanes(1)).toBe(false);
    expect(shouldDefaultToLanes(5)).toBe(false);
    expect(shouldDefaultToLanes(6)).toBe(true);
  });

  it('uses distinct session labels inside project drill-down', () => {
    const lanes = [
      {
        sessionId: 's1',
        replay: sampleReplay('s1', 'alpha', 0.1),
        session: {
          sessionId: 's1',
          project: 'alpha',
          repoId: 'alpha',
          status: 'ended',
          startedAt: '2026-06-04T12:00:00.000Z',
          lastEventAt: '2026-06-04T12:10:00.000Z',
        } as never,
        index: 0,
      },
      {
        sessionId: 's2',
        replay: sampleReplay('s2', 'alpha', 0.2),
        session: {
          sessionId: 's2',
          project: 'alpha',
          repoId: 'alpha',
          status: 'ended',
          startedAt: '2026-06-04T13:00:00.000Z',
          lastEventAt: '2026-06-04T13:10:00.000Z',
        } as never,
        index: 1,
      },
    ];

    const series = buildChartSeries(lanes, 'alpha');
    expect(series.map((item) => item.label)).toEqual([
      expect.stringContaining('Session 1'),
      expect.stringContaining('Session 2'),
    ]);
    expect(new Set(series.map((item) => item.label)).size).toBe(2);
    expect(new Set(series.map((item) => item.color)).size).toBe(2);
  });

  it('varies session line colors within one project hue', () => {
    const colors = [0, 1, 2].map((index) => sessionSeriesAccent('alpha', index, 3));
    expect(new Set(colors).size).toBe(3);
    expect(sessionSeriesAccent('alpha', 0, 1)).toBe(sessionSeriesAccent('alpha', 1, 1));
  });

  it('keeps unselected sessions in the focused legend list', () => {
    const pool = [
      {
        sessionId: 's1',
        project: 'alpha',
        repoId: 'alpha',
        status: 'ended',
        startedAt: '2026-06-04T12:00:00.000Z',
        lastEventAt: '2026-06-04T12:10:00.000Z',
      },
      {
        sessionId: 's2',
        project: 'alpha',
        repoId: 'alpha',
        status: 'ended',
        startedAt: '2026-06-04T13:00:00.000Z',
        lastEventAt: '2026-06-04T13:10:00.000Z',
      },
    ] as never[];

    const items = buildFocusedSessionLegend(pool, 'alpha', new Set(['s2']));
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.series.sessionIds[0] === 's2')?.selected).toBe(false);
  });
});

describe('replayNarrative', () => {
  it('prefers marker-aware summary copy over session counts', () => {
    const text = buildNarrative({
      mode: 'summary',
      playheadMs: 0,
      statesCount: 5,
      endedCount: 5,
      runningCount: 0,
      replayCount: 5,
      focusedProjectId: null,
      focusedProjectLabel: null,
      totalCost: 8.35,
      currentSignals: [],
      allReviewSignals: [{ tone: 'alert', text: 'alpha: First error (Read)' }],
      alertCount: 1,
      peakBurn: { rate: 0, label: '' },
    });
    expect(text).toContain('1 moment worth revisiting');
    expect(text).toContain('$8.35');
  });
});

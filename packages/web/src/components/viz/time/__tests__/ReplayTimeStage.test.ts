import { describe, expect, it } from 'vitest';

import {
  nearestSeriesValueAt,
  seriesSegments,
  type ReplayTimeStagePoint,
} from '../ReplayTimeStage.js';

describe('nearestSeriesValueAt', () => {
  const chartData = [
    { elapsedMs: 0, series_a: 10, series_b: 0 },
    { elapsedMs: 300_000, series_a: 40, series_b: 0 },
    { elapsedMs: 600_000, series_a: 0, series_b: 80 },
  ];

  it('finds the nearest bucket independently per series', () => {
    expect(nearestSeriesValueAt(chartData, 'series_a', 280_000)).toBe(40);
    expect(nearestSeriesValueAt(chartData, 'series_b', 280_000)).toBe(0);
    expect(nearestSeriesValueAt(chartData, 'series_b', 620_000)).toBe(80);
  });

  it('returns null when a series has no bucket near the hover time', () => {
    expect(nearestSeriesValueAt(chartData, 'series_missing', 280_000)).toBeNull();
  });

  it('refuses to report a bucket further away than the ceiling', () => {
    // Without a ceiling the card confidently showed a value from a bucket
    // minutes — at period scale, hours — away from the cursor.
    expect(nearestSeriesValueAt(chartData, 'series_a', 280_000, 45_000)).toBe(40);
    expect(nearestSeriesValueAt(chartData, 'series_a', 450_000, 45_000)).toBeNull();
  });
});

describe('seriesSegments', () => {
  it('keeps contiguous buckets in one run', () => {
    const points = [
      { elapsedMs: 0, a: 1 },
      { elapsedMs: 30_000, a: 2 },
      { elapsedMs: 60_000, a: 3 },
    ];
    expect(seriesSegments(points, 'a', 45_000)).toEqual([
      [
        [0, 1],
        [30_000, 2],
        [60_000, 3],
      ],
    ]);
  });

  it('breaks the line across a gap instead of drawing through it', () => {
    // Buckets are contiguous inside a session, so a wide gap means no session
    // was running. A straight line across it would invent activity.
    const points = [
      { elapsedMs: 0, a: 1 },
      { elapsedMs: 30_000, a: 2 },
      { elapsedMs: 6 * 3_600_000, a: 5 },
    ];
    const segments = seriesSegments(points, 'a', 45_000);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toEqual([[6 * 3_600_000, 5]]);
  });

  it('skips points where the series has no value', () => {
    const points: ReplayTimeStagePoint[] = [
      { elapsedMs: 0, a: 1 },
      { elapsedMs: 30_000, b: 9 },
      { elapsedMs: 60_000, a: 3 },
    ];
    expect(seriesSegments(points, 'a', 90_000)).toEqual([
      [
        [0, 1],
        [60_000, 3],
      ],
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  bucketAtElapsedMs,
  bucketContainingElapsedMs,
  burnRateAtPlayhead,
  burnRateForBucket,
  formatReplayClock,
  momentsInWindow,
  msToPlayhead,
  nextPlaybackStop,
  playheadToMs,
  reviewPlaybackRate,
  sessionDurationMs,
} from '../replayPlayback.js';
import type { ReplaySession } from '../../../lib/apiSchemas.js';

function sampleReplay(): ReplaySession {
  return {
    sessionId: 's1',
    agent: 'claude-code',
    startedAt: '2026-06-04T12:00:00.000Z',
    endedAt: '2026-06-04T12:10:00.000Z',
    keyframes: [],
    activity: [
      { at: '2026-06-04T12:00:00.000Z', bucketMs: 30_000, costUsd: 0.1, toolCallCount: 1, tokensTotal: 100 },
      { at: '2026-06-04T12:00:30.000Z', bucketMs: 30_000, costUsd: 0.3, toolCallCount: 2, tokensTotal: 400 },
    ],
    moments: [
      { at: '2026-06-04T12:00:05.000Z', seq: 1, kind: 'tool.call', toolName: 'Read' },
      { at: '2026-06-04T12:05:00.000Z', seq: 2, kind: 'tool.call', toolName: 'Edit', errored: true },
    ],
    totals: { costUsd: 0.4, tokensTotal: 500, toolCallCount: 2, promptCount: 0 },
  };
}

describe('replayPlayback', () => {
  it('formats elapsed clock', () => {
    expect(formatReplayClock(65_000)).toBe('1:05');
  });

  it('maps playhead to ms across session duration', () => {
    const replay = sampleReplay();
    expect(sessionDurationMs(replay)).toBe(600_000);
    expect(playheadToMs(replay, 0.5)).toBe(300_000);
    expect(msToPlayhead(replay, 300_000)).toBeCloseTo(0.5);
  });

  it('filters moments near the playhead', () => {
    const replay = sampleReplay();
    const nearStart = momentsInWindow(replay.moments, replay, 0.01, 60_000);
    expect(nearStart).toHaveLength(1);
    expect(nearStart[0]?.toolName).toBe('Read');
  });

  it('derives burn rate from the active bucket', () => {
    const replay = sampleReplay();
    const rate = burnRateAtPlayhead(replay, 0.75);
    expect(rate).toBeCloseTo(0.6);
  });

  it('reads a bucket as a rate, and refuses a zero-width one', () => {
    expect(
      burnRateForBucket({
        at: '2026-06-04T12:00:00.000Z',
        bucketMs: 30_000,
        costUsd: 0.3,
        toolCallCount: 2,
        tokensTotal: 400,
      }),
    ).toBeCloseTo(0.6);
    expect(
      burnRateForBucket({
        at: '2026-06-04T12:00:00.000Z',
        bucketMs: 0,
        costUsd: 0.3,
        toolCallCount: 2,
        tokensTotal: 400,
      }),
    ).toBeNull();
  });

  it('only returns the bucket the playhead is inside', () => {
    const replay = sampleReplay();

    // Inside the second bucket (30s–60s).
    expect(bucketContainingElapsedMs(replay, 45_000)?.costUsd).toBeCloseTo(0.3);
    // The session ran nine more minutes but nothing was bucketed there. The
    // clamped lookup would hand back that last burst forever.
    expect(bucketContainingElapsedMs(replay, 300_000)).toBeNull();
    expect(bucketAtElapsedMs(replay, 300_000)?.costUsd).toBeCloseTo(0.3);
    // Before the first bucket opens.
    expect(bucketContainingElapsedMs({ ...replay, activity: [] }, 0)).toBeNull();
  });

  it('returns the next playback stop crossed by a tick', () => {
    const targets = [
      { id: 'a', elapsedMs: 1_000 },
      { id: 'b', elapsedMs: 2_500 },
      { id: 'c', elapsedMs: 4_000 },
    ];
    expect(nextPlaybackStop(targets, 1_500, 3_000)?.id).toBe('b');
    expect(nextPlaybackStop(targets, 1_500, 3_000, 2_500)).toBeNull();
    expect(nextPlaybackStop(targets, 3_000, 3_500)).toBeNull();
  });

  it('uses review-speed playback instead of real-time replay', () => {
    expect(reviewPlaybackRate(600_000)).toBeGreaterThan(20);
    expect(reviewPlaybackRate(60_000)).toBe(12);
  });
});

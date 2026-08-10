import { describe, expect, it } from 'vitest';

import type { ReplaySession } from '../../../lib/apiSchemas.js';
import { buildStageMarkers, buildStageMarkersForLane, isStageAttentionTone, thinMomentMarkers } from '../replayStageMarkers.js';
import { buildReplayTimeline } from '../replayTimeline.js';
import type { ReplayStageMarker } from '../stage/ReplayStageChart.js';
import type { SessionLane } from '../replayTransforms.js';

function marker(id: string, tone: ReplayStageMarker['tone'], elapsedMs: number): ReplayStageMarker {
  return { id, elapsedMs, kind: 'moment', tone };
}

describe('thinMomentMarkers', () => {
  it('returns all markers when under cap', () => {
    const markers = [marker('a', 'neutral', 1), marker('b', 'alert', 2)];
    expect(thinMomentMarkers(markers, 10)).toEqual(markers);
  });

  it('keeps alert markers before neutral when over cap', () => {
    const markers = [
      marker('n1', 'neutral', 10),
      marker('a1', 'alert', 20),
      marker('n2', 'neutral', 30),
      marker('n3', 'neutral', 40),
    ];
    const thinned = thinMomentMarkers(markers, 2);
    expect(thinned.map((item) => item.id)).toEqual(['n1', 'a1']);
    expect(thinned.some((item) => item.tone === 'alert')).toBe(true);
  });
});

describe('buildStageMarkersForLane', () => {
  it('includes keyframes and attention moments, not routine tool-call ticks', () => {
    const replay: ReplaySession = {
      sessionId: 's1',
      agent: 'claude-code',
      startedAt: '2026-06-04T12:00:00.000Z',
      endedAt: '2026-06-04T12:10:00.000Z',
      keyframes: [
        { kind: 'session-start', at: '2026-06-04T12:00:00.000Z', seq: 0, label: 'Session started' },
        { kind: 'first-error', at: '2026-06-04T12:02:00.000Z', seq: 2, label: 'First error' },
      ],
      activity: [],
      moments: [
        { at: '2026-06-04T12:01:00.000Z', seq: 10, kind: 'tool.call', toolName: 'Read' },
        { at: '2026-06-04T12:03:00.000Z', seq: 11, kind: 'tool.call', toolName: 'Read', errored: true },
        { at: '2026-06-04T12:04:00.000Z', seq: 12, kind: 'tool.call', toolName: 'Read' },
      ],
      totals: { costUsd: 0, tokensTotal: 0, toolCallCount: 5, promptCount: 0 },
    };
    const lane: SessionLane & { replay: ReplaySession } = {
      sessionId: 's1',
      replay,
      session: null,
      index: 0,
    };

    const markers = buildStageMarkersForLane(lane, buildReplayTimeline([lane]), 10);
    expect(markers.filter((item) => item.kind === 'keyframe')).toHaveLength(2);
    expect(markers.filter((item) => item.kind === 'moment')).toHaveLength(1);
    expect(markers.find((item) => item.kind === 'moment')?.tone).toBe('alert');
  });

  it('places a later session marker at its scope offset, not at its own zero', () => {
    const base = (sessionId: string, startedAt: string): SessionLane & { replay: ReplaySession } => ({
      sessionId,
      session: null,
      index: 0,
      replay: {
        sessionId,
        agent: 'claude-code',
        startedAt,
        endedAt: null,
        keyframes: [{ kind: 'session-start', at: startedAt, seq: 0, label: 'Session started' }],
        activity: [],
        moments: [],
        totals: { costUsd: 0, tokensTotal: 0, toolCallCount: 0, promptCount: 0 },
      },
    });
    const lanes = [
      base('first', '2026-06-04T09:00:00.000Z'),
      base('second', '2026-06-04T14:00:00.000Z'),
    ];

    const markers = buildStageMarkers(lanes, buildReplayTimeline(lanes));
    expect(markers.map((item) => item.elapsedMs)).toEqual([0, 5 * 3_600_000]);
  });

  it('treats only non-neutral tones as stage attention', () => {
    expect(isStageAttentionTone('alert')).toBe(true);
    expect(isStageAttentionTone('peak')).toBe(true);
    expect(isStageAttentionTone('neutral')).toBe(false);
  });
});

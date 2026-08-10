import { describe, expect, it } from 'vitest';

import type { ReplayReviewItem } from '../replayReviewModel.js';
import {
  buildUnifiedMomentList,
  formatEventLogLine,
  reviewNowEmptyMessage,
  reviewQueueEmptyMessage,
} from '../review/replayReviewConsoleCopy.js';

function item(
  id: string,
  tone: ReplayReviewItem['tone'],
  title: string,
  elapsedMs: number,
  keyframeKind?: ReplayReviewItem['keyframeKind'],
): ReplayReviewItem {
  return {
    id,
    sessionId: 's1',
    repoId: 'repo',
    project: 'seorak',
    sessionLabel: 'Session 1',
    source: keyframeKind ? 'keyframe' : 'moment',
    stopKind: tone === 'neutral' ? 'moment' : 'highlight',
    tone,
    title,
    detail: null,
    meta: [],
    at: '2026-06-04T12:00:00.000Z',
    elapsedMs,
    timeLabel: formatClock(elapsedMs),
    keyframeKind,
  };
}

function formatClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

describe('buildUnifiedMomentList', () => {
  const nearby = [
    item('near-1', 'alert', 'First error', 125_000),
    item('near-2', 'neutral', 'Tool call', 124_000),
  ];
  const queue = [
    item('q-1', 'alert', 'First error', 125_000),
    item('q-2', 'peak', 'Peak burn', 240_000),
    item('q-3', 'commit', 'Shipped', 480_000),
  ];
  const lifecycle = [
    item('life-start', 'neutral', 'Session started', 0, 'session-start'),
    item('life-end', 'neutral', 'Session ended', 600_000, 'session-end'),
  ];

  it('orders overview rows as starts, nearby, then ends', () => {
    const rows = buildUnifiedMomentList({
      mode: 'summary',
      nowItems: nearby,
      queueItems: queue,
      lifecycleItems: lifecycle,
      playheadNearIds: new Set(nearby.map((row) => row.id)),
    });

    expect(rows.map((row) => row.item.id)).toEqual(['life-start', 'near-1', 'near-2', 'life-end']);
    expect(rows.find((row) => row.item.id === 'near-1')?.nearPlayhead).toBe(true);
    expect(rows.find((row) => row.item.id === 'life-start')?.lifecycle).toBe(true);
  });

  it('dedupes nearby rows that are also in the highlight queue', () => {
    const rows = buildUnifiedMomentList({
      mode: 'summary',
      nowItems: [queue[0]!],
      queueItems: queue,
      lifecycleItems: lifecycle,
      playheadNearIds: new Set([queue[0]!.id]),
    });

    expect(rows.filter((row) => row.item.title === 'First error')).toHaveLength(1);
  });

  it('returns filtered highlights in attention mode with playhead markers', () => {
    const rows = buildUnifiedMomentList({
      mode: 'attention',
      nowItems: nearby,
      queueItems: queue,
      lifecycleItems: lifecycle,
      playheadNearIds: new Set(['q-1']),
    });

    expect(rows.map((row) => row.item.title)).toEqual(['First error', 'Peak burn']);
    expect(rows[0]?.nearPlayhead).toBe(true);
  });

  it('returns all highlights in revisit mode', () => {
    const rows = buildUnifiedMomentList({
      mode: 'review',
      nowItems: nearby,
      queueItems: queue,
      lifecycleItems: lifecycle,
      playheadNearIds: new Set(),
    });

    expect(rows).toHaveLength(3);
  });
});

describe('formatEventLogLine', () => {
  it('writes lifecycle rows as session + project sentences', () => {
    expect(
      formatEventLogLine(
        item('life-start', 'neutral', 'Session started', 0, 'session-start'),
      ),
    ).toBe('Session 1 for seorak started');
    expect(
      formatEventLogLine(
        item('life-end', 'neutral', 'Session ended', 600_000, 'session-end'),
      ),
    ).toBe('Session 1 for seorak ended');
  });

  it('weaves tool calls and errors with session context', () => {
    const toolCall = item('tool-1', 'neutral', 'Tool call', 54_000);
    toolCall.detail = 'Read';
    expect(formatEventLogLine(toolCall)).toBe('Session 1 for seorak, Read tool call');

    const toolError = item('tool-2', 'alert', 'Tool error', 125_000);
    toolError.detail = 'Bash';
    expect(formatEventLogLine(toolError)).toBe('Session 1 for seorak, Bash errored');
  });

  it('appends cost to the sentence when present', () => {
    const toolCall = item('tool-3', 'neutral', 'Tool call', 54_000);
    toolCall.detail = 'Read';
    toolCall.meta = ['$0.02'];
    expect(formatEventLogLine(toolCall)).toBe('Session 1 for seorak, Read tool call, $0.02');
  });

  it('formats keyframe highlights as anchored prose', () => {
    const peak = item('peak', 'peak', 'Peak burn $0.60', 240_000, 'peak-burn');
    expect(formatEventLogLine(peak)).toBe('Session 1 for seorak, peak burn $0.60');

    const firstError = item('err', 'alert', 'First error', 120_000, 'first-error');
    firstError.detail = 'Bash';
    expect(formatEventLogLine(firstError)).toBe('Session 1 for seorak, first error on Bash');

    const commit = item('commit', 'commit', 'Shipped 2 commits', 480_000, 'biggest-commit');
    commit.detail = '5 files';
    expect(formatEventLogLine(commit)).toBe('Session 1 for seorak, shipped 2 commits (5 files)');
  });
});

describe('reviewQueueEmptyMessage', () => {
  it('guides overview users to scrub or switch modes', () => {
    expect(reviewQueueEmptyMessage('summary')).toMatch(/switch filters/);
  });

  it('uses honest-empty copy for filtered modes', () => {
    expect(reviewQueueEmptyMessage('attention')).toMatch(/tool errors or cost spikes/);
    expect(reviewQueueEmptyMessage('review')).toMatch(/errors, spikes, or commits/);
  });
});

describe('reviewNowEmptyMessage', () => {
  it('suggests scrub or play without inventing data', () => {
    expect(reviewNowEmptyMessage()).toMatch(/Scrub or play/);
  });
});

import { describe, expect, it } from 'vitest';

import { filterQueueForMode, NARRATIVE_MODE_OPTIONS } from '../replayNarrative.js';
import type { ReplayReviewItem } from '../replayReviewModel.js';

function item(tone: ReplayReviewItem['tone'], title: string): ReplayReviewItem {
  return {
    id: title,
    sessionId: 's1',
    repoId: 'repo',
    project: 'seorak',
    sessionLabel: 'Session 1',
    source: 'keyframe',
    stopKind: 'highlight',
    tone,
    title,
    detail: null,
    meta: [],
    at: '2026-06-04T12:00:00.000Z',
    elapsedMs: 0,
    timeLabel: '0:00',
  };
}

describe('filterQueueForMode', () => {
  const queue = [
    item('alert', 'First error'),
    item('peak', 'Peak burn'),
    item('commit', 'Shipped 2 commits'),
    item('neutral', 'Prompt sent'),
  ];

  it('returns alert and peak items in attention mode', () => {
    expect(filterQueueForMode(queue, 'attention').map((row) => row.title)).toEqual([
      'First error',
      'Peak burn',
    ]);
  });

  it('returns all highlights in review mode', () => {
    expect(filterQueueForMode(queue, 'review')).toHaveLength(4);
  });

  it('returns empty in summary mode', () => {
    expect(filterQueueForMode(queue, 'summary')).toEqual([]);
  });
});

describe('NARRATIVE_MODE_OPTIONS', () => {
  it('covers every narrative mode once', () => {
    expect(NARRATIVE_MODE_OPTIONS.map((option) => option.mode)).toEqual([
      'summary',
      'attention',
      'review',
    ]);
  });
});

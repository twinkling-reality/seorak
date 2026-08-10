import { describe, expect, it } from 'vitest';

import { formatProjectScope, scopeLoadNote } from '../replayScopeSummary.js';
import type { ReplayScopeSummary } from '../replayReviewModel.js';

function scope(overrides: Partial<ReplayScopeSummary> = {}): ReplayScopeSummary {
  return {
    projectCount: 2,
    sessionCount: 5,
    loadedReplayCount: 5,
    loadingCount: 0,
    emptyReplayCount: 0,
    errorCount: 0,
    endedCount: 5,
    runningCount: 0,
    totalCostUsd: 8.35,
    tokensTotal: 120_000,
    toolCallCount: 42,
    promptCount: 3,
    filesTouchedUncommitted: 0,
    reviewItemCount: 30,
    routineMomentCount: 24,
    highlightCount: 6,
    alertCount: 2,
    peakCount: 1,
    attentionCount: 3,
    commitCount: 1,
    totalDurationMs: 3_600_000,
    ...overrides,
  };
}

describe('formatProjectScope', () => {
  it('speaks one, two, and three names before falling back to a count', () => {
    expect(formatProjectScope([])).toBe('this scope');
    expect(formatProjectScope(['seorak'])).toBe('seorak');
    expect(formatProjectScope(['noru', 'seorak'])).toBe('noru and seorak');
    expect(formatProjectScope(['noru', 'seorak', 'cleanerchat'])).toBe('noru, seorak, and cleanerchat');
    expect(formatProjectScope(['a', 'b', 'c', 'd'])).toBe('4 projects');
  });
});

describe('scopeLoadNote', () => {
  it('stays silent when the read is complete', () => {
    expect(scopeLoadNote(scope())).toBeNull();
  });

  it('reports errors before progress before emptiness', () => {
    expect(scopeLoadNote(scope({ errorCount: 2, loadingCount: 1 }))).toBe('2 load errors');
    expect(scopeLoadNote(scope({ loadingCount: 2, loadedReplayCount: 3 }))).toBe('3 of 5 loaded');
    expect(scopeLoadNote(scope({ emptyReplayCount: 1 }))).toBe('1 empty');
  });

  it('agrees in number for a single load error', () => {
    expect(scopeLoadNote(scope({ errorCount: 1 }))).toBe('1 load error');
  });
});

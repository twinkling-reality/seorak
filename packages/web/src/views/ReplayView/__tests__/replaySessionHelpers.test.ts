import { describe, expect, it } from 'vitest';

import type { SessionSummary } from '../../../lib/apiSchemas.js';
import { projectFor, repoIdFor } from '../replaySessionHelpers.js';

describe('replaySessionHelpers', () => {
  it('prefers repoId and project from session summary', () => {
    const session: SessionSummary = {
      sessionId: 's1',
      project: 'seorak',
      repoId: 'repo-seorak',
      agent: 'claude-code',
      status: 'ended',
      startedAt: '2026-06-04T12:00:00.000Z',
      lastEventAt: '2026-06-04T12:10:00.000Z',
      elapsedSeconds: 600,
      toolCallCount: 1,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      costUsd: 0,
      burnRateUsdPerMin: 0,
    };

    expect(repoIdFor(session, 'fallback')).toBe('repo-seorak');
    expect(projectFor(session, 'fallback')).toBe('seorak');
  });

  it('falls back when session is missing', () => {
    expect(repoIdFor(null, 'fallback-id')).toBe('fallback-id');
    expect(projectFor(null, 'fallback-id')).toBe('fallback-id');
  });
});

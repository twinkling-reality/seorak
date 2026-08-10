import { describe, expect, it } from 'vitest';

import type { SessionSummary } from '../../../lib/apiSchemas.js';
import { sessionSearchText } from '../ReplayCustomizePanel.js';

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 's1',
    project: 'mobile-surfaces',
    repoId: 'repo-mobile-surfaces',
    agent: 'claude-code',
    status: 'ended',
    startedAt: '2026-06-04T12:00:00.000Z',
    lastEventAt: '2026-06-04T12:10:00.000Z',
    endedAt: '2026-06-04T12:10:00.000Z',
    elapsedSeconds: 600,
    toolCallCount: 42,
    tokens: { input: 200, output: 200, cacheRead: 0, cacheWrite: 0, total: 400 },
    costUsd: 1.25,
    burnRateUsdPerMin: 0.04,
    ...overrides,
  } as SessionSummary;
}

describe('replay session search', () => {
  it('matches the project name — the first column and the first thing typed', () => {
    const text = sessionSearchText(session());
    expect(text).toContain('mobile-surfaces');
    expect(text.includes('feather')).toBe(false);
  });

  it('still matches everything else the row shows', () => {
    const text = sessionSearchText(session({ currentTool: 'Bash' }));

    expect(text).toContain('ended');
    expect(text).toContain('claude-code');
    expect(text).toContain('bash');
    expect(text).toContain('42 calls');
    expect(text).toContain('$1.25');
  });

  it('is lower-cased so a typed query never has to match case', () => {
    expect(sessionSearchText(session({ project: 'Mobile-Surfaces' }))).toContain('mobile-surfaces');
  });
});

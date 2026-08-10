import { describe, expect, it } from 'vitest';
import type { DeveloperModelSnapshot } from '@seorak/types';

import { compileSnapshotToPresentation } from '../compileSnapshotToPresentation.js';
import {
  computePortraitFormingState,
  PORTRAIT_MIN_SESSIONS,
} from '../computePortraitForming.js';

const BASE: DeveloperModelSnapshot = {
  scope: { rangeDays: 30, maxRangeDays: 90, repoId: null, generatedAt: '2026-07-01T12:00:00.000Z' },
  focus: { projectFocus: [] },
  outcomes: {
    shipRate: null,
    lineSurvival: {
      rate: null,
      linesAuthored: 0,
      linesSurviving: 0,
      commitsChecked: 0,
      sessionsRated: 0,
      retained: 0,
      overwritten: 0,
      unreachable: 0,
      unknown: 0,
    },
    shipped: 0,
    shipDeterminable: 0,
    stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    endReasons: [],
  },
  activity: { hourlyDistribution: [], endReasonsByHour: [] },
  tools: { byTool: [], byModel: [], callStats: { errorRate: null, erroredCalls: 0, callsWithResult: 0 }, verification: [] },
};

describe('computePortraitFormingState', () => {
  it('tracks zero sessions toward portrait minimum', () => {
    const forming = computePortraitFormingState(BASE);
    expect(forming.sessionCount).toBe(0);
    expect(forming.sessionsRequired).toBe(PORTRAIT_MIN_SESSIONS);
  });

  it('tracks session progress toward portrait minimum', () => {
    const forming = computePortraitFormingState({
      ...BASE,
      focus: { projectFocus: [{ repoId: 'a', project: 'seorak', sessions: 2, share: 1 }] },
      activity: { hourlyDistribution: [{ dow: 1, hour: 10, sessions: 2 }], endReasonsByHour: [] },
    });
    expect(forming.sessionCount).toBe(2);
  });

  // The forming read is chosen by insight count, never by session count, so a
  // window with MORE sessions than the minimum can still land here. The card line
  // must not then read "7 of 3".
  it('never counts past the minimum on the forming card', () => {
    const p = compileSnapshotToPresentation(
      {
        ...BASE,
        scope: { ...BASE.scope, repoId: 'a' },
        focus: { projectFocus: [{ repoId: 'a', project: 'seorak', sessions: 7, share: 1 }] },
      },
      { displayName: 'Test' },
    );
    const rhythm = p.insights.find((i) => i.id === 'forming-evenings');
    expect(rhythm?.hoverLines).toContain('3 of 3 sessions logged in this window');
  });
});

describe('compileSnapshotToPresentation forming', () => {
  it('renders forming read with inline insight terms', () => {
    const p = compileSnapshotToPresentation(BASE, { displayName: 'Test' });
    expect(p.forming).not.toBeNull();
    expect(p.forming?.sessionCount).toBe(0);
    expect(p.insights.length).toBeGreaterThan(0);
    expect(p.prose.some((s) => s.type === 'insight')).toBe(true);
    expect(p.prose).not.toHaveLength(0);
  });

  it('includes session progress in forming annotation hover', () => {
    const p = compileSnapshotToPresentation(BASE, { displayName: 'Test' });
    const rhythm = p.insights.find((i) => i.id === 'forming-evenings');
    expect(rhythm?.hoverLines).toContain('0 of 3 sessions logged in this window');
  });

  it('clears forming when portrait has live insights', () => {
    const p = compileSnapshotToPresentation(
      {
        ...BASE,
        focus: { projectFocus: [{ repoId: 'a', project: 'seorak', sessions: 4, share: 1 }] },
        activity: { hourlyDistribution: [{ dow: 2, hour: 20, sessions: 4 }], endReasonsByHour: [] },
        outcomes: { ...BASE.outcomes, endReasons: [{ reason: 'clear', count: 3 }] },
      },
      { displayName: 'Test' },
    );
    expect(p.insights.some((i) => i.id.startsWith('forming-'))).toBe(false);
    expect(p.forming).toBeNull();
  });
});

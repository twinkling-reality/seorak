import { describe, expect, it } from 'vitest';

import type { ReplayMoment, ReplaySession, SessionSummary } from '../../../lib/apiSchemas.js';
import {
  REPLAY_LENSES,
  REPLAY_LENS_QUESTIONS,
  computeReplayLens,
  lensGroupsForLevel,
  lensIdsWithoutCompute,
  lensesForLevel,
} from '../lenses/index.js';
import type { ReplayLensInput } from '../lenses/types.js';
import { buildReplayTimeline, fullWindow } from '../replayTimeline.js';
import type { SessionLane } from '../replayTransforms.js';

const START = '2026-06-04T09:00:00.000Z';
const START_MS = Date.parse(START);
const MINUTE = 60_000;
const DAY = 86_400_000;

function at(offsetMs: number): string {
  return new Date(START_MS + offsetMs).toISOString();
}

function replay(moments: ReplayMoment[], overrides: Partial<ReplaySession> = {}): ReplaySession {
  return {
    sessionId: 's1',
    agent: 'claude-code',
    startedAt: START,
    endedAt: at(30 * MINUTE),
    keyframes: [
      { kind: 'session-start', at: START, seq: 0, label: 'Session started' },
      { kind: 'first-error', at: at(5 * MINUTE), seq: 20, label: 'First error', detail: 'Bash' },
      { kind: 'session-end', at: at(30 * MINUTE), seq: 99, label: 'Session ended' },
    ],
    activity: [{ at: START, bucketMs: 30_000, costUsd: 1, toolCallCount: 4, tokensTotal: 900 }],
    moments,
    totals: { costUsd: 3, tokensTotal: 900, toolCallCount: 4, promptCount: 2 },
    ...overrides,
  };
}

function laneFor(session: ReplaySession, project = 'alpha', index = 0): SessionLane {
  return {
    sessionId: session.sessionId,
    replay: session,
    session: {
      sessionId: session.sessionId,
      project,
      repoId: project,
      status: 'ended',
      startedAt: session.startedAt,
      lastEventAt: session.endedAt ?? session.startedAt,
      elapsedSeconds: 1800,
      costUsd: session.totals.costUsd,
      toolCallCount: session.totals.toolCallCount,
      tokens: { total: session.totals.tokensTotal },
    } as never,
    index,
  };
}

function inputFor(lanes: SessionLane[], overrides: Partial<ReplayLensInput> = {}): ReplayLensInput {
  const timeline = buildReplayTimeline(lanes);
  return {
    lanes,
    timeline,
    window: fullWindow(timeline),
    level: 'period',
    sessions: [],
    rangeDays: 7,
    compareSessionIds: [],
    nowMs: START_MS + DAY,
    ...overrides,
  };
}

const RICH_MOMENTS: ReplayMoment[] = [
  { at: at(1 * MINUTE), seq: 1, kind: 'tool.call', toolName: 'Read', costUsd: 0.1, fileCategory: 'source', fileLanguage: 'rust' },
  { at: at(2 * MINUTE), seq: 2, kind: 'tool.call', toolName: 'Edit', costUsd: 0.4, fileCategory: 'source', fileLanguage: 'rust' },
  { at: at(3 * MINUTE), seq: 3, kind: 'tool.call', toolName: 'Bash', costUsd: 1.2, errored: true },
  { at: at(4 * MINUTE), seq: 4, kind: 'tool.call', toolName: 'Bash', costUsd: 0.2, verificationKind: 'test', verificationPassed: false },
  { at: at(6 * MINUTE), seq: 5, kind: 'session.notification', notificationType: 'permission_prompt' },
  { at: at(12 * MINUTE), seq: 6, kind: 'tool.call', toolName: 'Edit', costUsd: 0.3, undoKind: 'revert', fileCategory: 'config', fileLanguage: 'toml' },
  { at: at(13 * MINUTE), seq: 7, kind: 'tool.call', toolName: 'Bash', costUsd: 0.1, verificationKind: 'test', verificationPassed: true },
];

describe('lens catalog', () => {
  it('gives every catalog entry a compute function', () => {
    expect(lensIdsWithoutCompute()).toEqual([]);
  });

  it('describes every lens for a reader who cannot see the screen', () => {
    for (const lens of REPLAY_LENSES) {
      expect(lens.description.length).toBeGreaterThan(20);
      expect(lens.emptyHint.length).toBeGreaterThan(10);
      expect(lens.dataKeys.length).toBeGreaterThan(0);
      expect(lens.levels.length).toBeGreaterThan(0);
    }
  });

  it('offers different lenses per level', () => {
    expect(lensesForLevel('period').map((lens) => lens.id)).toContain('projects');
    expect(lensesForLevel('period').map((lens) => lens.id)).not.toContain('session-detail');
    expect(lensesForLevel('session').map((lens) => lens.id)).toContain('session-detail');
    expect(lensesForLevel('session').map((lens) => lens.id)).not.toContain('projects');
  });

  it('returns null for an unknown lens instead of throwing', () => {
    expect(computeReplayLens('not-a-lens', inputFor([]))).toBeNull();
  });
});

// Every lens picker renders these groups, so grouping is compute, not markup.
describe('lens groups', () => {
  it('groups a level by the three questions, in reading order', () => {
    const groups = lensGroupsForLevel('period');

    expect(groups.map((group) => group.question)).toEqual([
      'what-happened',
      'attention',
      'revisit',
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      'What happened',
      'Where attention spiked',
      'Worth revisiting',
    ]);
  });

  it('covers exactly the level lenses, each once', () => {
    for (const level of ['period', 'project', 'session'] as const) {
      const grouped = lensGroupsForLevel(level).flatMap((group) => group.lenses.map((lens) => lens.id));
      expect([...grouped].sort()).toEqual(lensesForLevel(level).map((lens) => lens.id).sort());
      expect(new Set(grouped).size).toBe(grouped.length);
    }
  });

  it('files each lens under the question it says it answers', () => {
    for (const group of lensGroupsForLevel('session')) {
      for (const lens of group.lenses) expect(lens.question).toBe(group.question);
    }
  });

  it('omits a question with no lens rather than heading an empty list', () => {
    const groups = lensGroupsForLevel('project');
    for (const group of groups) expect(group.lenses.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThanOrEqual(REPLAY_LENS_QUESTIONS.length);
  });
});

describe('tool-mix', () => {
  it('ranks tools by call count and counts their errors', () => {
    const result = computeReplayLens('tool-mix', inputFor([laneFor(replay(RICH_MOMENTS))]))!;
    expect(result.rows.map((row) => row.label)).toEqual(['Bash', 'Edit', 'Read']);
    expect(result.rows[0]!.value).toBe(3);
    expect(result.rows[0]!.facts?.find((fact) => fact.label === 'errored')?.value).toBe('1 of 3');
    expect(result.headline).toContain('1 of 6 calls errored');
  });

  it('shares sum to one across the ranked bars', () => {
    const result = computeReplayLens('tool-mix', inputFor([laneFor(replay(RICH_MOMENTS))]))!;
    const total = result.rows.reduce((sum, row) => sum + (row.share ?? 0), 0);
    expect(total).toBeCloseTo(1);
  });

  it('reports the focus window, not the whole scope', () => {
    const lanes = [laneFor(replay(RICH_MOMENTS))];
    const timeline = buildReplayTimeline(lanes);
    const result = computeReplayLens(
      'tool-mix',
      inputFor(lanes, { timeline, window: { startMs: 0, endMs: 2.5 * MINUTE } }),
    )!;
    expect(result.rows.map((row) => row.label)).toEqual(['Edit', 'Read']);
    expect(result.coverage.windowed).toBe(true);
    expect(result.coverage.momentCount).toBe(2);
  });

  it('stays honest-empty when no tool call was captured', () => {
    const result = computeReplayLens('tool-mix', inputFor([laneFor(replay([]))]))!;
    expect(result.rows).toEqual([]);
    expect(result.empty).toContain('No tool calls');
    expect(result.headline).toBeNull();
  });
});

describe('cost-concentration', () => {
  it('attributes cost by tool and scrubs to that tool priciest call', () => {
    const result = computeReplayLens('cost-concentration', inputFor([laneFor(replay(RICH_MOMENTS))]))!;
    expect(result.rows[0]!.label).toBe('Bash');
    expect(result.rows[0]!.value).toBeCloseTo(1.5);
    expect(result.rows[0]!.elapsedMs).toBe(3 * MINUTE);
    expect(result.headline).toContain('of measured cost');
  });

  it('says so when no per-moment cost was captured', () => {
    const moments: ReplayMoment[] = [{ at: at(MINUTE), seq: 1, kind: 'tool.call', toolName: 'Read' }];
    const result = computeReplayLens('cost-concentration', inputFor([laneFor(replay(moments))]))!;
    expect(result.empty).toContain('cannot be attributed');
  });
});

describe('file-touch', () => {
  it('groups by file category with languages riding along', () => {
    const result = computeReplayLens('file-touch', inputFor([laneFor(replay(RICH_MOMENTS))]))!;
    expect(result.rows.map((row) => row.label)).toEqual(['Source', 'Config']);
    expect(result.rows[0]!.value).toBe(2);
    expect(result.rows[0]!.facts?.[0]).toEqual({ label: 'rust', value: '2' });
  });

  it('falls back to language when capture derived no category', () => {
    const moments: ReplayMoment[] = [
      { at: at(MINUTE), seq: 1, kind: 'tool.call', toolName: 'Edit', fileLanguage: 'go' },
      { at: at(2 * MINUTE), seq: 2, kind: 'tool.call', toolName: 'Edit', fileLanguage: 'go' },
    ];
    const result = computeReplayLens('file-touch', inputFor([laneFor(replay(moments))]))!;
    expect(result.rows.map((row) => row.label)).toEqual(['Go']);
    expect(result.headline).toContain('no category');
  });

  it('never invents an uncategorized bucket', () => {
    const moments: ReplayMoment[] = [
      { at: at(MINUTE), seq: 1, kind: 'tool.call', toolName: 'Read', fileCategory: 'source' },
      { at: at(2 * MINUTE), seq: 2, kind: 'tool.call', toolName: 'Grep' },
    ];
    const result = computeReplayLens('file-touch', inputFor([laneFor(replay(moments))]))!;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.value).toBe(1);
  });
});

describe('rework', () => {
  it('lists changes that were rolled back, placed on the timeline', () => {
    const result = computeReplayLens('rework', inputFor([laneFor(replay(RICH_MOMENTS))]))!;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.label).toBe('Revert');
    expect(result.rows[0]!.elapsedMs).toBe(12 * MINUTE);
    expect(result.rows[0]!.share).toBeCloseTo((12 * MINUTE) / (30 * MINUTE));
  });

  it('reads no rollbacks as a real absence, not missing capture', () => {
    const result = computeReplayLens('rework', inputFor([laneFor(replay([]))]))!;
    expect(result.empty).toContain('real absence');
  });
});

describe('verification', () => {
  it('reports runs and notices when the last one came back green', () => {
    const result = computeReplayLens('verification', inputFor([laneFor(replay(RICH_MOMENTS))]))!;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.tone).toBe('negative');
    expect(result.rows[1]!.tone).toBe('positive');
    expect(result.headline).toContain('the last one passed');
  });

  it('does not claim recovery when checks stayed red', () => {
    const moments: ReplayMoment[] = [
      { at: at(MINUTE), seq: 1, kind: 'tool.call', verificationKind: 'test', verificationPassed: false },
    ];
    const result = computeReplayLens('verification', inputFor([laneFor(replay(moments))]))!;
    expect(result.headline).toBe('1 check ran and 1 failed.');
  });
});

describe('interruptions', () => {
  it('measures the wait as the gap to the next captured moment', () => {
    const result = computeReplayLens('interruptions', inputFor([laneFor(replay(RICH_MOMENTS))]))!;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.label).toBe('Needs you');
    expect(result.rows[0]!.facts?.[0]).toEqual({ label: 'waited', value: '6m 0s' });
    expect(result.headline).toContain('waited 6m 0s');
  });

  it('leaves the wait absent when the stop is the last captured moment', () => {
    const moments: ReplayMoment[] = [
      { at: at(MINUTE), seq: 1, kind: 'session.notification', notificationType: 'permission_prompt' },
    ];
    const result = computeReplayLens('interruptions', inputFor([laneFor(replay(moments))]))!;
    expect(result.rows[0]!.facts?.[0]?.value).toBe('still the last captured moment');
    expect(result.headline).not.toContain('waited');
  });

  it('says plainly when the agent never stopped', () => {
    const result = computeReplayLens('interruptions', inputFor([laneFor(replay([]))]))!;
    expect(result.empty).toContain('never stopped for you');
  });
});

describe('cadence', () => {
  it('buckets gaps and names the longest stall', () => {
    const result = computeReplayLens('cadence', inputFor([laneFor(replay(RICH_MOMENTS))]))!;
    expect(result.rows).toHaveLength(5);
    expect(result.rows.reduce((sum, row) => sum + row.value, 0)).toBe(6);
    expect(result.headline).toContain('the longest stall was 6m 0s');
  });

  it('never measures a gap across a session boundary', () => {
    const first = replay([{ at: at(MINUTE), seq: 1, kind: 'tool.call', toolName: 'Read' }]);
    const second = replay(
      [{ at: at(20 * MINUTE), seq: 1, kind: 'tool.call', toolName: 'Read' }],
      { sessionId: 's2', startedAt: at(19 * MINUTE), endedAt: at(25 * MINUTE) },
    );
    const result = computeReplayLens(
      'cadence',
      inputFor([laneFor(first, 'alpha', 0), laneFor(second, 'beta', 1)]),
    )!;
    // One moment in each session means no within-session gap at all.
    expect(result.empty).toContain('Two or more captured moments');
  });
});

describe('projects', () => {
  it('folds sessions per project, heaviest spend first', () => {
    const alpha = laneFor(replay(RICH_MOMENTS), 'alpha', 0);
    const beta = laneFor(
      replay(RICH_MOMENTS, { sessionId: 's2', totals: { costUsd: 9, tokensTotal: 10, toolCallCount: 1, promptCount: 0 } }),
      'beta',
      1,
    );
    const result = computeReplayLens('projects', inputFor([alpha, beta]))!;
    expect(result.rows.map((row) => row.label)).toEqual(['beta', 'alpha']);
    expect(result.rows[0]!.target).toEqual({ kind: 'project', id: 'beta' });
    expect(result.columns).toEqual(['Sessions', 'Elapsed', 'Cost', 'Attention', 'First seen']);
    expect(result.rows[0]!.cells).toHaveLength(5);
  });
});

describe('sessions', () => {
  it('lists sessions with a drill target and flags attention', () => {
    const result = computeReplayLens('sessions', inputFor([laneFor(replay(RICH_MOMENTS))]))!;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.target).toEqual({ kind: 'session', id: 's1' });
    expect(result.headline).toContain('needing attention');
  });
});

describe('session-detail', () => {
  it('carries totals plus the session keyframes as a secondary block', () => {
    const result = computeReplayLens(
      'session-detail',
      inputFor([laneFor(replay(RICH_MOMENTS))], { level: 'session' }),
    )!;
    expect(result.rows.map((row) => row.id)).toContain('cost');
    expect(result.secondary?.label).toBe('Keyframes');
    expect(result.secondary?.rows.map((row) => row.label)).toEqual([
      'Session started',
      'First error',
      'Session ended',
    ]);
  });

  it('is honest-empty when the session has no loaded replay', () => {
    const lane: SessionLane = { sessionId: 's1', replay: null, session: null, index: 0 };
    const result = computeReplayLens('session-detail', inputFor([lane], { level: 'session' }))!;
    expect(result.empty).toContain('no loaded replay');
  });
});

describe('session-compare', () => {
  it('needs two picked sessions before it says anything', () => {
    const result = computeReplayLens('session-compare', inputFor([laneFor(replay(RICH_MOMENTS))]))!;
    expect(result.empty).toContain('Pick two sessions');
  });

  it('reads change from the first session to the second', () => {
    const a = laneFor(replay(RICH_MOMENTS), 'alpha', 0);
    const b = laneFor(
      replay(RICH_MOMENTS, { sessionId: 's2', totals: { costUsd: 6, tokensTotal: 900, toolCallCount: 4, promptCount: 2 } }),
      'alpha',
      1,
    );
    const result = computeReplayLens(
      'session-compare',
      inputFor([a, b], { compareSessionIds: ['s1', 's2'] }),
    )!;
    const cost = result.rows.find((row) => row.id === 'cost')!;
    expect(cost.cells).toEqual(['$3.00', '$6.00', '+100%']);
    // Cost carries no verdict; only attention and uncommitted files do.
    expect(cost.cellTones?.[2]).toBe('neutral');
  });
});

describe('period-compare', () => {
  const sessions = [
    {
      sessionId: 'recent',
      project: 'alpha',
      repoId: 'alpha',
      startedAt: at(0),
      lastEventAt: at(0),
      elapsedSeconds: 3600,
      costUsd: 2,
      toolCallCount: 10,
      tokens: { total: 1000 },
    },
    {
      sessionId: 'older',
      project: 'beta',
      repoId: 'beta',
      startedAt: at(-9 * DAY),
      lastEventAt: at(-9 * DAY),
      elapsedSeconds: 1800,
      costUsd: 1,
      toolCallCount: 4,
      tokens: { total: 400 },
    },
  ] as unknown as SessionSummary[];

  it('compares this window against the one before it', () => {
    const result = computeReplayLens(
      'period-compare',
      inputFor([], { sessions, rangeDays: 7, nowMs: START_MS + DAY }),
    )!;
    const cost = result.rows.find((row) => row.id === 'cost')!;
    expect(cost.cells?.[0]).toBe('$1.00');
    expect(cost.cells?.[1]).toBe('$2.00');
    expect(result.headline).toContain('fold session totals');
  });

  it('refuses a comparison when nothing came before', () => {
    const result = computeReplayLens(
      'period-compare',
      inputFor([], { sessions: [sessions[0]!], rangeDays: 7, nowMs: START_MS + DAY }),
    )!;
    expect(result.empty).toContain('Nothing was captured');
    expect(result.rows).toEqual([]);
  });
});

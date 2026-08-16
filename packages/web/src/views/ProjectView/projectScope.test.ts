// @vitest-environment jsdom
// scopeToProject pulls useProjectData -> router.ts, which reads window.location at
// module load, so this file runs under jsdom for that import to resolve.
import { describe, expect, it } from 'vitest';
import { getWidget } from '../../widgets/catalog/index.js';
import { PROJECT_DEFAULT_LAYOUT } from './projectTabDefaults.js';
import { resolveProjectRouteId, scopeToProject } from './useProjectData.js';
import { createEmptyOverview } from '../../lib/schemas/common.js';
import type { ProjectRollup, SessionSummary } from '../../lib/apiSchemas.js';
import { resolveCapabilities } from '@seorak/types';

// DA-06: ProjectView (scopeToProject) narrows per-repo fields from each
// ProjectRollup. Overview merges all repos; compare pairs two rollups — see
// docs/specs/multi-repo.md.

// scopeToProject is the honesty backstop: every scope:'both' tile reads a field the
// reducer either narrows to THIS repo (endReasons, codebase heat, cacheReuseRatio,
// costPerEdit, lines, dailyTrends, momentum, commitStats, bySession...) or sets
// honest-empty under scope (endReasonsByDay, the global-only agent series, portfolio);
// none render the all-repos value under a repo header (SCOPE.md Phase 0; the "no
// silent global" block below verifies the reduced DATA object directly).
// GLOBAL_BACKED_TILES lists any tile whose field can be NEITHER narrowed nor
// honest-emptied, to keep it out of the project dashboard; currently none, but it
// stays as the guard seam for a future such tile.
const GLOBAL_BACKED_TILES: string[] = [];

const projectDefaultIds = [...new Set(PROJECT_DEFAULT_LAYOUT.map((s) => s.id))];

function emptyCurrentProjectSeries() {
  return {
    agentOutcomes: [],
    agentOutcomesUnusable: 0,
    agentModels: [],
    agentDaily: [],
    dailyTrends: [],
    agentHourly: [],
    cacheReadTokens: 0,
    cacheInputTokens: 0,
  } satisfies Pick<
    ProjectRollup,
    | 'agentOutcomes'
    | 'agentOutcomesUnusable'
    | 'agentModels'
    | 'agentDaily'
    | 'dailyTrends'
    | 'agentHourly'
    | 'cacheReadTokens'
    | 'cacheInputTokens'
  >;
}

describe('project scope honesty (DA-06)', () => {
  it('no scope:both tile is left global-backed (the reducer narrows or empties every field)', () => {
    expect(GLOBAL_BACKED_TILES).toEqual([]);
  });

  it.each(projectDefaultIds)(
    'project default tile %s is project-renderable (scope project|both, never overview)',
    (id) => {
      const scope = getWidget(id)?.scope;
      expect(['project', 'both'], `${id} missing or overview-only`).toContain(scope);
    },
  );

  it('no project default references a known global-backed tile', () => {
    for (const id of projectDefaultIds) {
      expect(
        GLOBAL_BACKED_TILES,
        `${id} is global-backed and must not default into the project dashboard`,
      ).not.toContain(id);
    }
  });
});

describe('resolveProjectRouteId', () => {
  it('keeps stable repoId routes unchanged', () => {
    const overview = createEmptyOverview(30);
    overview.usage.projects = [
      {
        project: 'seorak',
        repoId: 'repo-seorak',
        sessions: 1,
        sessionsDelta: null,
        activeSessions: 1,
        toolCalls: 1,
        tokensTotal: 1,
        costUsd: 1,
        lastEventAt: '2026-07-05T00:00:00.000Z',
        errorRate: null,
        cacheReuseRatio: null,
        shipRate: null,
        oneShotRate: null,
        costDelta: null,
        endReasons: [],
        stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
        byTool: [],
        byModel: [],
        byAgent: [],
        hourlyDistribution: [],
        lineSurvival: null,
        endReasonsByHour: [],
        codebaseFiles: [],
        codebaseDirectories: [],
        codebaseRework: [],
        verification: [],
        ...emptyCurrentProjectSeries(),
      },
    ];

    expect(resolveProjectRouteId(overview, 'repo-seorak')).toBe('repo-seorak');
  });

  it('recovers stale basename project routes when the basename is unique', () => {
    const overview = createEmptyOverview(30);
    overview.usage.projects = [
      {
        project: 'seorak',
        repoId: 'repo-seorak',
        sessions: 1,
        sessionsDelta: null,
        activeSessions: 1,
        toolCalls: 1,
        tokensTotal: 1,
        costUsd: 1,
        lastEventAt: '2026-07-05T00:00:00.000Z',
        errorRate: null,
        cacheReuseRatio: null,
        shipRate: null,
        oneShotRate: null,
        costDelta: null,
        endReasons: [],
        stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
        byTool: [],
        byModel: [],
        byAgent: [],
        hourlyDistribution: [],
        lineSurvival: null,
        endReasonsByHour: [],
        codebaseFiles: [],
        codebaseDirectories: [],
        codebaseRework: [],
        verification: [],
        ...emptyCurrentProjectSeries(),
      },
    ];

    expect(resolveProjectRouteId(overview, 'seorak')).toBe('repo-seorak');
  });
});

// The per-repo seam: scopeToProject must render THIS repo's end reasons, not the
// global all-repos ring, now that the worker projects endReasons onto ProjectRollup.
describe('scopeToProject per-repo end reasons (DA-06 real fix)', () => {
  const rollup = {
    project: 'repo-a',
    repoId: 'r-a',
    sessions: 4,
    sessionsDelta: null,
    activeSessions: 0,
    toolCalls: 12,
    tokensTotal: 0,
    costUsd: null,
    lastEventAt: '2026-06-14T00:00:00.000Z',
    errorRate: null,
    cacheReuseRatio: null,
    shipRate: null,
    oneShotRate: null,
    costDelta: null,
    endReasons: [{ reason: 'clear', count: 3 }],
    stuckness: { rate: 0.1, stuckCount: 2, inFlight: 20, stuckSessionIds: ['x', 'y'] },
    byTool: [],
    byModel: [],
    byAgent: [],
    hourlyDistribution: [],
    lineSurvival: null,
    endReasonsByHour: [],
    codebaseFiles: [{ fileId: 'f-a', label: 'a.ts', edits: 5, linesAdded: 0, linesRemoved: 0, sessions: 2 }],
    codebaseDirectories: [{ dirId: 'd-a', label: 'src', edits: 5, share: 1 }],
    codebaseRework: [{ fileId: 'f-a', label: 'a.ts', sessions: 2, edits: 5 }],
    verification: [{ kind: 'test', passRate: 0, runs: 3, passed: 0 }],
    ...emptyCurrentProjectSeries(),
  } satisfies ProjectRollup;

  it('overrides the global endReasons with the repo rollup', () => {
    const overview = createEmptyOverview(30);
    overview.outcomes.endReasons = [{ reason: 'clear', count: 99 }]; // GLOBAL ring
    const scoped = scopeToProject(overview, 'r-a', [], rollup);
    expect(scoped.outcomes.endReasons).toEqual([{ reason: 'clear', count: 3 }]);
  });

  it('overrides global scalars (stuckness, shipRate, errorRate) with the repo rollup', () => {
    const overview = createEmptyOverview(30);
    overview.outcomes.stuckness = { rate: 0.9, stuckCount: 50, inFlight: 56, stuckSessionIds: ['g'] }; // GLOBAL
    overview.tools.callStats = { totalCalls: 999, errorRate: 0.9 }; // GLOBAL
    const withScalars = { ...rollup, shipRate: 0.7, errorRate: 0.05 } satisfies ProjectRollup;
    const scoped = scopeToProject(overview, 'r-a', [], withScalars);
    expect(scoped.outcomes.stuckness).toEqual({ rate: 0.1, stuckCount: 2, inFlight: 20, stuckSessionIds: ['x', 'y'] });
    expect(scoped.outcomes.shipRate).toBe(0.7);
    expect(scoped.tools.callStats.errorRate).toBe(0.05);
  });

  it('an unknown repo (null rollup) is honest-empty, never the global ring', () => {
    const overview = createEmptyOverview(30);
    overview.outcomes.endReasons = [{ reason: 'clear', count: 99 }];
    const scoped = scopeToProject(overview, 'repo-x', [], null);
    expect(scoped.outcomes.endReasons).toEqual([]);
  });

  it('overrides global codebase heat and verification with the repo rollup', () => {
    const overview = createEmptyOverview(30);
    overview.codebase.files = [{ fileId: 'global', label: 'global.ts', edits: 99, linesAdded: 0, linesRemoved: 0, sessions: 9 }];
    overview.tools.verification = [{ kind: 'test', passRate: 0, runs: 50, passed: 0 }];
    const scoped = scopeToProject(overview, 'r-a', [], rollup);
    expect(scoped.codebase.files).toEqual(rollup.codebaseFiles);
    expect(scoped.codebase.directories).toEqual(rollup.codebaseDirectories);
    expect(scoped.codebase.rework).toEqual(rollup.codebaseRework);
    expect(scoped.tools.verification).toEqual(rollup.verification);
  });
});

// SCOPE.md Phase 0: the reducer must leave NO scope:'both' field showing the
// all-repos value under a one-repo scope. This asserts the reduced DATA object
// directly (stronger than a per-tile render check): every formerly-leaking field is
// either THIS repo's value or honest-empty, never the distinctive global value.
describe('scopeToProject no silent global under scope (SCOPE.md Phase 0)', () => {
  const repoRollup = {
    project: 'repo-a',
    repoId: 'r-a',
    sessions: 4,
    sessionsDelta: null,
    activeSessions: 0,
    toolCalls: 12,
    tokensTotal: 0,
    costUsd: 3.5,
    lastEventAt: '2026-06-14T00:00:00.000Z',
    errorRate: null,
    cacheReuseRatio: 0.3,
    shipRate: null,
    oneShotRate: null,
    costDelta: { current: 3.5, previous: 2.0 },
    endReasons: [],
    stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    byTool: [],
    byModel: [],
    byAgent: [],
    hourlyDistribution: [],
    lineSurvival: null,
    endReasonsByHour: [],
    codebaseFiles: [],
    codebaseDirectories: [],
    codebaseRework: [],
    verification: [],
    ...emptyCurrentProjectSeries(),
    dailyTrends: [
      { day: '2026-06-11', sessions: 2, costUsd: 1.25 },
      { day: '2026-06-12', sessions: 1, costUsd: null },
    ],
  } satisfies ProjectRollup;

  // A global overview where every formerly-leaking field carries a DISTINCTIVE
  // all-repos value, plus git momentum + a per-session outcome for repo-a AND a
  // second repo, so a leak would show the other repo's / summed value.
  function globalOverview() {
    const o = createEmptyOverview(30);
    o.usage.cacheReuseRatio = 0.9;
    o.usage.costPerEdit = 5.0;
    o.usage.lines = { added: 500, removed: 200, delta: null };
    o.usage.dailyTrends = [{ day: '2026-06-10', sessions: 9, costUsd: null }];
    o.usage.momentum = [
      { repoId: 'r-a', repoLabel: 'repo-a', gitContext: 'clean', windowDays: 7, commits: 3, filesTouched: 4, linesAdded: 40, linesDeleted: 10, netLines: 30, generatedLinesExcluded: 0 },
      { repoId: 'r-b', repoLabel: 'repo-b', gitContext: 'clean', windowDays: 7, commits: 7, filesTouched: 9, linesAdded: 90, linesDeleted: 20, netLines: 70, generatedLinesExcluded: 0 },
    ];
    o.usage.portfolio = { windowDays: 7, reposTotal: 2, reposMoved: 2, reposQuiet: 0, repos: [] };
    o.codebase.commitStats = { windowDays: 7, commits: 10, filesTouched: 13, linesAdded: 130, linesDeleted: 30, generatedLinesExcluded: 0, commitsFromSessions: 5 };
    o.outcomes.endReasonsByDay = [{ day: '2026-06-10', reasons: [{ reason: 'clear', count: 9 }] }];
    o.outcomes.bySession = [
      { sessionId: 's-a', project: 'repo-a', repoId: 'r-a', endedAt: '2026-06-13T00:00:00.000Z', status: 'pending' },
      { sessionId: 's-b', project: 'repo-b', repoId: 'r-b', endedAt: '2026-06-13T00:00:00.000Z', status: 'retained' },
    ];
    o.tools.byAgent = [
      { agent: 'claude-code', sessions: 4, activeSessions: 0, toolCalls: 12, tokensTotal: 0, costUsd: null, lines: { added: 100, removed: 20 }, lastEventAt: '2026-06-14T00:00:00.000Z', capabilities: resolveCapabilities('claude-code'), erroredPresent: false },
      { agent: 'codex', sessions: 2, activeSessions: 0, toolCalls: 5, tokensTotal: 0, costUsd: null, lines: { added: 40, removed: 8 }, lastEventAt: '2026-06-14T00:00:00.000Z', capabilities: resolveCapabilities('codex'), erroredPresent: false },
    ];
    // The global-only agent series, each carrying a DISTINCTIVE all-repos value so
    // a spread-through leak would be visible under scope.
    o.tools.agentDaily = [
      { agent: 'claude-code', day: '2026-06-10', sessions: 9, lines: { added: 90, removed: 30 }, tokensTotal: null },
    ];
    o.tools.agentModels = [
      { agent: 'claude-code', model: 'claude-opus-4-8', calls: 44, tokensTotal: 90_000, costUsd: 9.9 },
    ];
    o.tools.agentOutcomes = [
      {
        agent: 'claude-code',
        linesAuthored: 800,
        linesSurviving: 600,
        survivalRate: 0.75,
        commits: 5,
        sessionsRated: 3,
        ratedCostUsd: 4.2,
        costPerSurvivingLine: 0.007,
        unreachableSessions: 1,
        unknownSessions: 0,
        filesGoneFromTip: 2,
        coverage: {
          linesInCommits: 1000,
          linesAuthored: 800,
          linesOtherAgents: 50,
          linesContested: 30,
          linesUnattributed: 120,
        },
      },
    ];
    o.tools.agentOutcomesUnusable = 7;
    o.activity.agentHourly = [{ agent: 'claude-code', hour: 12, calls: 40 }];
    return o;
  }

  it('narrows cacheReuseRatio to the rollup, never the global 0.9', () => {
    const scoped = scopeToProject(globalOverview(), 'r-a', [], repoRollup);
    expect(scoped.usage.cacheReuseRatio).toBe(0.3);
  });

  it('keeps costPerEdit and lines honest-empty when the rollup lacks their sources', () => {
    const scoped = scopeToProject(globalOverview(), 'r-a', [], repoRollup);
    expect(scoped.usage.costPerEdit).toBeNull();
    expect(scoped.usage.lines).toBeNull();
  });

  it("narrows dailyTrends to this repo's series, never the global series", () => {
    const scoped = scopeToProject(globalOverview(), 'r-a', [], repoRollup);
    expect(scoped.usage.dailyTrends).toEqual(repoRollup.dailyTrends);
    expect(scoped.usage.dailyTrends).not.toEqual(globalOverview().usage.dailyTrends);
  });

  it('narrows momentum + commitStats to THIS repo (repo-a, not repo-b or the global sum)', () => {
    const scoped = scopeToProject(globalOverview(), 'r-a', [], repoRollup);
    expect(scoped.usage.momentum.map((m) => m.repoId)).toEqual(['r-a']);
    expect(scoped.codebase.commitStats).toEqual({
      windowDays: 7,
      commits: 3,
      filesTouched: 4,
      linesAdded: 40,
      linesDeleted: 10,
      generatedLinesExcluded: 0,
      commitsFromSessions: null,
    });
  });

  it('empties portfolio breadth under scope (cross-repo by definition)', () => {
    const scoped = scopeToProject(globalOverview(), 'r-a', [], repoRollup);
    expect(scoped.usage.portfolio.reposTotal).toBe(0);
    expect(scoped.usage.portfolio.repos).toEqual([]);
  });

  it('empties endReasonsByDay and filters bySession to THIS repo', () => {
    const scoped = scopeToProject(globalOverview(), 'r-a', [], repoRollup);
    expect(scoped.outcomes.endReasonsByDay).toEqual([]);
    expect(scoped.outcomes.bySession.map((r) => r.repoId)).toEqual(['r-a']);
  });

  it('scopes byAgent to THIS repo rollup (never all-repos agent counts)', () => {
    const scoped = scopeToProject(globalOverview(), 'r-a', [], {
      ...repoRollup,
      byAgent: [
        {
          agent: 'claude-code',
          sessions: 2,
          activeSessions: 0,
          toolCalls: 6,
          tokensTotal: 0,
          costUsd: null,
          lines: { added: 50, removed: 10 },
          lastEventAt: '2026-06-14T00:00:00.000Z',
          capabilities: resolveCapabilities('claude-code'),
          erroredPresent: false,
        },
      ],
    });
    expect(scoped.tools.byAgent).toEqual([
      {
        agent: 'claude-code',
        sessions: 2,
        activeSessions: 0,
        toolCalls: 6,
        tokensTotal: 0,
        costUsd: null,
        lines: { added: 50, removed: 10 },
        lastEventAt: '2026-06-14T00:00:00.000Z',
        capabilities: resolveCapabilities('claude-code'),
        erroredPresent: false,
      },
    ]);
  });

  it('empties byAgent under scope when the rollup has none', () => {
    const scoped = scopeToProject(globalOverview(), 'r-a', [], repoRollup);
    expect(scoped.tools.byAgent).toEqual([]);
  });

  it('empties the global-only agent series under scope (no all-repos series under a repo header)', () => {
    // These have no per-repo legs, so the only honest scope value is empty. Before
    // this override the ...overview.tools / ...overview.activity spreads carried
    // the ALL-REPOS series through under a one-repo header.
    const scoped = scopeToProject(globalOverview(), 'r-a', [], repoRollup);
    expect(scoped.tools.agentDaily).toEqual([]);
    expect(scoped.tools.agentModels).toEqual([]);
    expect(scoped.tools.agentOutcomes).toEqual([]);
    expect(scoped.tools.agentOutcomesUnusable).toBe(0);
    expect(scoped.activity.agentHourly).toEqual([]);
  });

  it('sources cost from the rollup (not the live board) and rides the rollup cost delta', () => {
    const scoped = scopeToProject(globalOverview(), 'r-a', [], repoRollup);
    expect(scoped.usage.cost.totalUsd).toBe(3.5);
    expect(scoped.usage.cost.sessionsWithCost).toBeGreaterThan(0);
    expect(scoped.usage.cost.delta).toEqual({ current: 3.5, previous: 2.0 });
  });

  it('a null-cost repo reads -- (totalUsd null, gate 0)', () => {
    const scoped = scopeToProject(globalOverview(), 'r-a', [], {
      ...repoRollup,
      costUsd: null,
      costDelta: null,
    });
    expect(scoped.usage.cost.totalUsd).toBeNull();
    expect(scoped.usage.cost.sessionsWithCost).toBe(0);
  });

  it('an unknown repo (null rollup) empties every formerly-leaking field, never the global', () => {
    const scoped = scopeToProject(globalOverview(), 'repo-x', [], null);
    expect(scoped.usage.cacheReuseRatio).toBeNull();
    expect(scoped.usage.momentum).toEqual([]);
    expect(scoped.codebase.commitStats).toBeNull();
    expect(scoped.usage.portfolio.reposTotal).toBe(0);
    expect(scoped.outcomes.bySession).toEqual([]);
    expect(scoped.usage.cost.totalUsd).toBeNull();
    expect(scoped.usage.dailyTrends).toEqual([]);
  });
});

// SCOPE.md Phase 0 re-key: matching keys on the salted repoId, not the basename, so
// two repos sharing a basename no longer blend. Before the re-key, live filtering by
// `project` merged both repos' sessions under the first repo's rollup.
describe('scopeToProject keys on repoId, not basename (same-basename collision fix)', () => {
  function liveRow(sessionId: string, project: string, repoId: string): SessionSummary {
    return {
      sessionId,
      project,
      repoId,
      agent: 'claude-code',
      status: 'active',
      startedAt: '2026-06-14T00:00:00.000Z',
      lastEventAt: '2026-06-14T00:00:00.000Z',
      elapsedSeconds: 60,
      toolCallCount: 3,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      costUsd: 0,
      burnRateUsdPerMin: 0,
    };
  }

  it('isolates the live board to the addressed repo when two repos share a basename', () => {
    const o = createEmptyOverview(30);
    // Two DISTINCT repos both named "api" (r-1, r-2), each with one live session.
    o.live = [liveRow('s1', 'api', 'r-1'), liveRow('s2', 'api', 'r-2')];
    const scoped = scopeToProject(o, 'r-1', [], null);
    // Only r-1's session survives; before the repoId re-key both merged under "api".
    expect(scoped.live.map((s) => s.sessionId)).toEqual(['s1']);
  });
});

// SCOPE.md Phase 1: three project-view fields the Phase-0 reducer had to honest-empty
// (no per-repo source) now ride the rollup's enriched legs — cost-per-edit (window cost
// ÷ edit-family calls), line volume, and the session-attributed commit leg. Each still
// falls back to honest-empty (never a fabricated 0) when its source is absent.
describe('scopeToProject per-repo Phase-1 fills', () => {
  function baseRollup(over: Partial<ProjectRollup> = {}): ProjectRollup {
    return {
      project: 'repo-a',
      repoId: 'r-a',
      sessions: 4,
      sessionsDelta: null,
      activeSessions: 0,
      toolCalls: 12,
      tokensTotal: 0,
      costUsd: null,
      lastEventAt: '2026-06-14T00:00:00.000Z',
      errorRate: null,
      cacheReuseRatio: null,
      shipRate: null,
      oneShotRate: null,
      costDelta: null,
      endReasons: [],
      stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
      byTool: [],
      byModel: [],
      byAgent: [],
      hourlyDistribution: [],
      lineSurvival: null,
      endReasonsByHour: [],
      codebaseFiles: [],
      codebaseDirectories: [],
      codebaseRework: [],
      verification: [],
      ...emptyCurrentProjectSeries(),
      ...over,
    };
  }

  const momentum = {
    repoId: 'r-a',
    repoLabel: 'repo-a',
    gitContext: 'clean' as const,
    windowDays: 7,
    commits: 9,
    filesTouched: 4,
    linesAdded: 100,
    linesDeleted: 20,
    netLines: 80,
    generatedLinesExcluded: 0,
  };

  it('keeps the project adjacent-window session legs under project scope', () => {
    const rollup = baseRollup({
      sessionsDelta: { current: 4, previous: 3 },
    });
    const scoped = scopeToProject(createEmptyOverview(30), 'r-a', [], rollup);
    expect(scoped.usage.totals.sessionsDelta).toEqual({ current: 4, previous: 3 });
  });

  it('fills cost-per-edit from window cost ÷ edit-family calls', () => {
    const rollup = baseRollup({ costDelta: { current: 6, previous: null }, editCalls: 3 });
    const scoped = scopeToProject(createEmptyOverview(30), 'r-a', [], rollup);
    expect(scoped.usage.costPerEdit).toBe(2); // 6 / 3
  });

  it('cost-per-edit is honest-empty (never 0) when the repo has no priced row', () => {
    const rollup = baseRollup({ costDelta: null, editCalls: 5 });
    const scoped = scopeToProject(createEmptyOverview(30), 'r-a', [], rollup);
    expect(scoped.usage.costPerEdit).toBeNull();
  });

  it('cost-per-edit is honest-empty (never divide-by-zero) when no edit call accrued', () => {
    const rollup = baseRollup({ costDelta: { current: 6, previous: null }, editCalls: 0 });
    const scoped = scopeToProject(createEmptyOverview(30), 'r-a', [], rollup);
    expect(scoped.usage.costPerEdit).toBeNull();
  });

  it('fills line volume with the prior-window added leg for the delta pill', () => {
    const rollup = baseRollup({ lines: { added: 120, removed: 40, priorAdded: 90 } });
    const scoped = scopeToProject(createEmptyOverview(30), 'r-a', [], rollup);
    expect(scoped.usage.lines).toEqual({
      added: 120,
      removed: 40,
      delta: { current: 120, previous: 90 },
    });
  });

  it('line volume is honest-empty when the repo measured no edit', () => {
    const scoped = scopeToProject(createEmptyOverview(30), 'r-a', [], baseRollup());
    expect(scoped.usage.lines).toBeNull();
  });

  it('fills the session-attributed commit leg on the git-momentum spine', () => {
    const overview = createEmptyOverview(30);
    overview.usage.momentum = [momentum];
    const rollup = baseRollup({ commitsFromSessions: 7 });
    const scoped = scopeToProject(overview, 'r-a', [], rollup);
    expect(scoped.codebase.commitStats?.commits).toBe(9); // git ground-truth spine
    expect(scoped.codebase.commitStats?.commitsFromSessions).toBe(7); // session leg
  });

  it('commit leg stays null (honest-empty) when the repo reported no measured delta', () => {
    const overview = createEmptyOverview(30);
    overview.usage.momentum = [momentum];
    const scoped = scopeToProject(overview, 'r-a', [], baseRollup());
    expect(scoped.codebase.commitStats?.commits).toBe(9); // git spine still renders
    expect(scoped.codebase.commitStats?.commitsFromSessions).toBeNull();
  });
});

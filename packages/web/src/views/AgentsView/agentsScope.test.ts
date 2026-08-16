import { describe, it, expect } from 'vitest';
import type {
  AgentCoverage,
  AgentOutcomeRollup,
  AgentRollup,
  ProjectRollup,
} from '@seorak/types';
import { aggregateAgentSeries } from './agentsScope.js';

// Only the agent-series fields matter to aggregateAgentSeries, so build minimal
// rollups carrying just those (cast — the function never touches the rest).
function proj(over: Partial<ProjectRollup>): ProjectRollup {
  return {
    byAgent: [],
    agentOutcomes: [],
    agentOutcomesUnusable: 0,
    byModel: [],
    agentModels: [],
    agentDaily: [],
    agentHourly: [],
    ...over,
  } as ProjectRollup;
}

const cov = (over: Partial<AgentCoverage> = {}): AgentCoverage => ({
  linesInCommits: 0,
  linesAuthored: 0,
  linesOtherAgents: 0,
  linesContested: 0,
  linesUnattributed: 0,
  ...over,
});

function agent(over: Partial<AgentRollup>): AgentRollup {
  return {
    agent: 'claude-code',
    sessions: 0,
    activeSessions: 0,
    toolCalls: 0,
    tokensTotal: 0,
    costUsd: null,
    lines: null,
    lastEventAt: '2026-07-01T00:00:00.000Z',
    ...over,
  } as AgentRollup;
}

function outcome(over: Partial<AgentOutcomeRollup>): AgentOutcomeRollup {
  return {
    agent: 'claude-code',
    linesAuthored: 0,
    linesSurviving: 0,
    survivalRate: null,
    commits: 0,
    sessionsRated: 0,
    ratedCostUsd: null,
    costPerSurvivingLine: null,
    unreachableSessions: 0,
    unknownSessions: 0,
    filesGoneFromTip: 0,
    coverage: cov(),
    ...over,
  };
}

describe('aggregateAgentSeries — error rate re-summed from legs, never averaged', () => {
  it('recomputes rate as Σerrored / Σreturned across repos', () => {
    const projects = [
      proj({ byAgent: [agent({ errorRate: { errored: 5, returned: 10, calls: 10, rate: 0.5 } })] }),
      proj({ byAgent: [agent({ errorRate: { errored: 3, returned: 10, calls: 12, rate: 0.3 } })] }),
    ];
    const { byAgent } = aggregateAgentSeries(projects);
    expect(byAgent).toHaveLength(1);
    // 8/20 = 0.4 — NOT the (0.5+0.3)/2 = 0.4 an average would coincidentally give; use
    // asymmetric legs to prove it: 6/10 and 0/30 → 6/40 = 0.15, not the 0.3 average.
    expect(byAgent[0].errorRate).toEqual({ errored: 8, returned: 20, calls: 22, rate: 0.4 });
  });

  it('proves it is not an average with asymmetric denominators', () => {
    const projects = [
      proj({ byAgent: [agent({ errorRate: { errored: 6, returned: 10, calls: 10, rate: 0.6 } })] }),
      proj({ byAgent: [agent({ errorRate: { errored: 0, returned: 30, calls: 30, rate: 0 } })] }),
    ];
    const { byAgent } = aggregateAgentSeries(projects);
    expect(byAgent[0].errorRate!.rate).toBeCloseTo(6 / 40); // 0.15, not the 0.3 average
  });

  it('nulls the rate when no call returned (never 0 as a stand-in)', () => {
    const projects = [proj({ byAgent: [agent({ errorRate: { errored: 0, returned: 0, calls: 5, rate: null } })] })];
    expect(aggregateAgentSeries(projects).byAgent[0].errorRate).toEqual({
      errored: 0,
      returned: 0,
      calls: 5,
      rate: null,
    });
  });
});

describe('aggregateAgentSeries — survival floor applied over SUMMED counts', () => {
  it('earns a rate a subset clears even when each repo was below the floor', () => {
    // Each repo: 400 authored (< 500 floor), 2 commits (< 3 floor) → individually null.
    const projects = [
      proj({ agentOutcomes: [outcome({ linesAuthored: 400, linesSurviving: 380, commits: 2, sessionsRated: 3 })] }),
      proj({ agentOutcomes: [outcome({ linesAuthored: 400, linesSurviving: 300, commits: 2, sessionsRated: 4 })] }),
    ];
    const [o] = aggregateAgentSeries(projects).agentOutcomes;
    expect(o.linesAuthored).toBe(800);
    expect(o.linesSurviving).toBe(680);
    expect(o.commits).toBe(4);
    // 800 >= 500 && 4 >= 3 → rate now earned.
    expect(o.survivalRate).toBeCloseTo(680 / 800);
  });

  it('stays null below the floor even after summing', () => {
    const projects = [
      proj({ agentOutcomes: [outcome({ linesAuthored: 200, linesSurviving: 190, commits: 1 })] }),
      proj({ agentOutcomes: [outcome({ linesAuthored: 200, linesSurviving: 180, commits: 1 })] }),
    ];
    // 400 < 500 lines and 2 < 3 commits → still below floor.
    expect(aggregateAgentSeries(projects).agentOutcomes[0].survivalRate).toBeNull();
  });

  it('costPerSurvivingLine sums the priced legs; null (never $0) when the agent cannot price', () => {
    const priced = [
      proj({ agentOutcomes: [outcome({ linesAuthored: 600, linesSurviving: 500, commits: 4, ratedCostUsd: 10 })] }),
      proj({ agentOutcomes: [outcome({ linesAuthored: 600, linesSurviving: 500, commits: 4, ratedCostUsd: 15 })] }),
    ];
    const [o] = aggregateAgentSeries(priced).agentOutcomes;
    expect(o.ratedCostUsd).toBe(25);
    expect(o.costPerSurvivingLine).toBeCloseTo(25 / 1000);

    const unpriced = [proj({ agentOutcomes: [outcome({ linesAuthored: 600, linesSurviving: 500, commits: 4, ratedCostUsd: null })] })];
    expect(aggregateAgentSeries(unpriced).agentOutcomes[0].costPerSurvivingLine).toBeNull();
  });
});

describe('aggregateAgentSeries — count sums + null-aware cost', () => {
  it('sums sessions/toolCalls/tokens and folds null-aware cost + lines per agent', () => {
    const projects = [
      proj({ byAgent: [agent({ agent: 'codex', sessions: 3, toolCalls: 40, tokensTotal: 1000, costUsd: null, lines: { added: 100, removed: 10 } })] }),
      proj({ byAgent: [agent({ agent: 'codex', sessions: 2, toolCalls: 22, tokensTotal: 500, costUsd: 2.5, lines: { added: 40, removed: 5 } })] }),
    ];
    const [a] = aggregateAgentSeries(projects).byAgent;
    expect(a.sessions).toBe(5);
    expect(a.toolCalls).toBe(62);
    expect(a.tokensTotal).toBe(1500);
    expect(a.costUsd).toBe(2.5); // null + 2.5 → 2.5 (one measured leg)
    expect(a.lines).toEqual({ added: 140, removed: 15 });
  });

  it('costUsd stays null when NO repo priced the agent', () => {
    const projects = [
      proj({ byAgent: [agent({ agent: 'codex', costUsd: null })] }),
      proj({ byAgent: [agent({ agent: 'codex', costUsd: null })] }),
    ];
    expect(aggregateAgentSeries(projects).byAgent[0].costUsd).toBeNull();
  });

  it('takes the latest lastEventAt and carries firstSeenAt', () => {
    const projects = [
      proj({ byAgent: [agent({ lastEventAt: '2026-07-01T00:00:00.000Z', firstSeenAt: '2026-06-05T00:00:00.000Z' })] }),
      proj({ byAgent: [agent({ lastEventAt: '2026-07-09T00:00:00.000Z', firstSeenAt: '2026-06-10T00:00:00.000Z' })] }),
    ];
    const [a] = aggregateAgentSeries(projects).byAgent;
    expect(a.lastEventAt).toBe('2026-07-09T00:00:00.000Z');
    expect(a.firstSeenAt).toBe('2026-06-05T00:00:00.000Z'); // earliest record across repos
  });
});

describe('aggregateAgentSeries — model / daily / hourly grouping', () => {
  it('groups byModel and agentModels across repos, null-aware cost', () => {
    const projects = [
      proj({
        byModel: [{ model: 'opus', calls: 2, tokensTotal: 100, costUsd: 1 }],
        agentModels: [{ agent: 'claude-code', model: 'opus', calls: 2, tokensTotal: 100, costUsd: 1 }],
      }),
      proj({
        byModel: [
          { model: 'opus', calls: 3, tokensTotal: 200, costUsd: 2 },
          { model: 'gpt-x', calls: 1, tokensTotal: 50, costUsd: null },
        ],
        agentModels: [{ agent: 'claude-code', model: 'opus', calls: 3, tokensTotal: 200, costUsd: 2 }],
      }),
    ];
    const { byModel, agentModels } = aggregateAgentSeries(projects);
    const opus = byModel.find((m) => m.model === 'opus')!;
    expect(opus).toMatchObject({ calls: 5, tokensTotal: 300, costUsd: 3 });
    expect(byModel.find((m) => m.model === 'gpt-x')!.costUsd).toBeNull();
    expect(agentModels).toHaveLength(1);
    expect(agentModels[0]).toMatchObject({ agent: 'claude-code', model: 'opus', calls: 5, tokensTotal: 300, costUsd: 3 });
  });

  it('sums agentDaily by (agent, day) and agentHourly by (agent, hour)', () => {
    const projects = [
      proj({
        agentDaily: [{ agent: 'codex', day: '2026-07-01', sessions: 2, lines: { added: 10, removed: 1 }, tokensTotal: null }],
        agentHourly: [{ agent: 'codex', hour: 14, calls: 5 }],
      }),
      proj({
        agentDaily: [{ agent: 'codex', day: '2026-07-01', sessions: 1, lines: { added: 4, removed: 0 }, tokensTotal: null }],
        agentHourly: [{ agent: 'codex', hour: 14, calls: 3 }],
      }),
    ];
    const { agentDaily, agentHourly } = aggregateAgentSeries(projects);
    expect(agentDaily).toHaveLength(1);
    expect(agentDaily[0]).toMatchObject({ day: '2026-07-01', sessions: 3, lines: { added: 14, removed: 1 } });
    expect(agentHourly).toEqual([{ agent: 'codex', hour: 14, calls: 8 }]);
  });

  it('sums agentOutcomesUnusable across repos', () => {
    const projects = [proj({ agentOutcomesUnusable: 2 }), proj({ agentOutcomesUnusable: 3 })];
    expect(aggregateAgentSeries(projects).agentOutcomesUnusable).toBe(5);
  });
});

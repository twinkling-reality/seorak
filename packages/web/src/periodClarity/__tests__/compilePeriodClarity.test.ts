import { describe, expect, it } from 'vitest';
import type { OutcomesSnapshot, OverviewSnapshot, UsageSnapshot } from '@seorak/types';
import { DEFAULT_THRESHOLDS, resolveCapabilities } from '@seorak/types';

import { compileWindowSentences } from '../compilePeriodClarity.js';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');

function mkUsage(over: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    totals: { sessions: 0, toolCalls: 0, sessionsDelta: null },
    cost: { totalUsd: null, sessionsWithCost: 0, delta: null },
    lines: null,
    dailyTrends: [],
    projects: [],
    momentum: [],
    portfolio: { windowDays: 7, reposTotal: 0, reposMoved: 0, reposQuiet: 0, repos: [] },
    cacheReuseRatio: null,
    costPerEdit: null,
    ...over,
  };
}

function mkOutcomes(over: Partial<OutcomesSnapshot> = {}): OutcomesSnapshot {
  return {
    endReasons: [],
    activeCount: 0,
    endedCount: 0,
    stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    endReasonsByDay: [],
    oneShotRate: null,
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
    bySession: [],
    ...over,
  };
}

type AgentRow = OverviewSnapshot['tools']['byAgent'][number];

function mkAgent(agent: string, tokensTotal: number, over: Partial<AgentRow> = {}): AgentRow {
  return {
    agent,
    sessions: 1,
    activeSessions: 0,
    toolCalls: 10,
    tokensTotal,
    costUsd: null,
    lines: null,
    lastEventAt: '2026-07-26T11:00:00.000Z',
    capabilities: resolveCapabilities(agent),
    erroredPresent: false,
    ...over,
  };
}

function mkOverview(over: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    generatedAt: '2026-07-26T12:00:00.000Z',
    rangeDays: 7,
    maxRangeDays: 90,
    thresholds: DEFAULT_THRESHOLDS,
    usageAllowances: [],
    live: [],
    usage: mkUsage(),
    outcomes: mkOutcomes(),
    activity: { hourlyDistribution: [], agentHourly: [], endReasonsByHour: [] },
    tools: {
      byTool: [],
      callStats: { totalCalls: 0, errorRate: null },
      byModel: [],
      byAgent: [],
      agentDaily: [],
      agentModels: [],
      agentOutcomes: [],
      agentOutcomesUnusable: 0,
      verification: [],
    },
    codebase: { files: [], directories: [], rework: [], commitStats: null, filesInPlay: null },
    ...over,
  };
}

const spoken = (o: OverviewSnapshot, days = 7): string =>
  compileWindowSentences(o, NOW, days).join(' ');

describe('compileWindowSentences', () => {
  it('opens with volume', () => {
    expect(
      spoken(
        mkOverview({
          usage: mkUsage({ totals: { sessions: 80, toolCalls: 1, sessionsDelta: null } }),
        }),
      ),
    ).toContain('In the last 7 days you ran 80 sessions across 0 projects.');
  });

  it('partial cost is a floor', () => {
    const o = mkOverview({
      usage: mkUsage({
        cost: {
          totalUsd: 4338.52,
          sessionsWithCost: 57,
          costPartial: true,
          unpricedModels: [{ model: 'claude-opus-5', tokensTotal: 1 }],
          delta: null,
        },
      }),
    });
    expect(spoken(o)).toContain('It cost at least $4,339.');
    expect(spoken(o)).toContain('Claude Opus 5 has no public price yet');
  });

  it('outcome coverage names Codex gap', () => {
    const o = mkOverview({
      outcomes: mkOutcomes({ shipRate: 0.74 }),
      tools: {
        ...mkOverview().tools,
        byAgent: [mkAgent('claude-code', 1), mkAgent('codex', 1)],
      },
    });
    expect(spoken(o)).toContain('Codex never reports when a session ends');
  });

  it('shrinks on thin data', () => {
    expect(compileWindowSentences(mkOverview(), NOW, 7)).toHaveLength(1);
  });

  it('never emits middot or em dash', () => {
    const all = spoken(
      mkOverview({
        usage: mkUsage({ totals: { sessions: 80, toolCalls: 1, sessionsDelta: null } }),
        outcomes: mkOutcomes({ shipRate: 0.74 }),
        tools: {
          ...mkOverview().tools,
          byAgent: [mkAgent('claude-code', 1), mkAgent('codex', 1)],
        },
      }),
    );
    expect(all).not.toContain('·');
    expect(all).not.toContain('—');
  });
});

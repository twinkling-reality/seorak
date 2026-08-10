import { describe, expect, it } from 'vitest';
import type { OverviewSnapshot, ProjectRollup } from '@seorak/types';
import { DEFAULT_THRESHOLDS } from '@seorak/types';

import { compilePeriodComparison } from './compilePeriodComparison.js';

function overviewWithRange(days: 7 | 30 | 90): OverviewSnapshot {
  return {
    generatedAt: '2026-07-30T12:00:00.000Z',
    rangeDays: days,
    maxRangeDays: 90,
    thresholds: DEFAULT_THRESHOLDS,
    usageAllowances: [],
    live: [],
    usage: {
      totals: { sessions: 0, toolCalls: 0, sessionsDelta: null },
      cost: { totalUsd: null, sessionsWithCost: 0, delta: null },
      lines: null,
      dailyTrends: [],
      projects: [],
      momentum: [],
      portfolio: {
        windowDays: days,
        reposTotal: 0,
        reposMoved: 0,
        reposQuiet: 0,
        repos: [],
      },
      cacheReuseRatio: null,
      costPerEdit: null,
    },
    outcomes: {
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
    },
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
    codebase: {
      files: [],
      directories: [],
      rework: [],
      commitStats: null,
      filesInPlay: null,
    },
  };
}

function project(over: Partial<ProjectRollup> = {}): ProjectRollup {
  return {
    project: 'seorak',
    repoId: 'repo-seorak',
    sessions: 0,
    sessionsDelta: null,
    activeSessions: 0,
    toolCalls: 0,
    tokensTotal: 0,
    costUsd: null,
    lastEventAt: '2026-07-30T12:00:00.000Z',
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
    agentOutcomes: [],
    agentOutcomesUnusable: 0,
    agentModels: [],
    agentDaily: [],
    dailyTrends: [],
    agentHourly: [],
    cacheReadTokens: 0,
    cacheInputTokens: 0,
    ...over,
  };
}

describe('compilePeriodComparison', () => {
  it('compiles all-work adjacent legs into narrative and compact evidence', () => {
    const overview = overviewWithRange(7);
    overview.usage.totals.sessionsDelta = { current: 12, previous: 9 };
    overview.usage.cost.delta = { current: 8.25, previous: 10 };
    overview.usage.lines = {
      added: 430,
      removed: 100,
      delta: { current: 430, previous: 300 },
    };
    overview.outcomes.shipRate = 0.75;
    overview.outcomes.lineSurvival = {
      rate: 0.8,
      linesAuthored: 500,
      linesSurviving: 400,
      commitsChecked: 5,
      sessionsRated: 4,
      retained: 3,
      overwritten: 1,
      unreachable: 0,
      unknown: 0,
    };

    const compiled = compilePeriodComparison(overview);

    expect(compiled.scope).toEqual({ kind: 'all-work', label: 'All work', repoId: null });
    expect(compiled.evidence.map((row) => row.id)).toEqual([
      'sessions',
      'cost',
      'lines-added',
    ]);
    expect(compiled.evidence.map((row) => row.difference.text)).toEqual([
      '+3',
      '-$1.75',
      '+130',
    ]);
    expect(compiled.narrative.map((line) => line.text).join(' ')).toContain(
      'Sessions were 12 in the last 7 days, compared with 9 in the prior 7 days.',
    );
    expect(compiled.narrative[0]?.text).toBe(
      'Across all work, the compared stats moved differently in the last 7 days: sessions rose 33%, captured lines rose 43%, and measured cost fell 18%.',
    );
  });

  it('uses project-scoped legs and clear 30-day wording', () => {
    const overview = overviewWithRange(30);
    const selected = project({
      project: 'mobile-surfaces',
      shipRate: 0.6,
      shipDeterminable: 10,
      sessionsDelta: { current: 18, previous: 22 },
      costDelta: { current: 6, previous: 4.5 },
      lines: { added: 80, removed: 12, priorAdded: 100 },
      lineSurvival: {
        rate: 0.7,
        linesAuthored: 100,
        linesSurviving: 70,
        commitsChecked: 3,
        sessionsRated: 3,
        retained: 2,
        overwritten: 1,
        unreachable: 0,
        unknown: 0,
      },
    });

    const compiled = compilePeriodComparison(overview, selected);

    expect(compiled.scope).toEqual({
      kind: 'project',
      label: 'mobile-surfaces',
      repoId: 'repo-seorak',
    });
    expect(compiled.currentWindowLabel).toBe('Last 30 days');
    expect(compiled.previousWindowLabel).toBe('Prior 30 days');
    expect(compiled.evidence.map((row) => [row.id, row.current.raw, row.previous.raw])).toEqual([
      ['sessions', 18, 22],
      ['cost', 6, 4.5],
      ['lines-added', 80, 100],
    ]);
    expect(compiled.narrative[0]?.text).toBe(
      'For mobile-surfaces, the compared stats moved differently in the last 30 days: sessions fell 18%, captured lines fell 20%, and measured cost rose 33%.',
    );
  });

  it('omits missing prior legs instead of inventing zeros or steadiness', () => {
    const overview = overviewWithRange(90);
    overview.usage.totals.sessionsDelta = { current: 5, previous: null };
    overview.usage.cost.delta = { current: 2, previous: null };
    overview.usage.lines = {
      added: 20,
      removed: 3,
      delta: { current: 20, previous: null },
    };

    const compiled = compilePeriodComparison(overview);
    const prose = compiled.narrative.map((line) => line.text).join(' ');

    expect(compiled.evidence).toEqual([]);
    expect(prose).toContain('No prior 90-day window has been measured for all work yet.');
    expect(prose).not.toMatch(/\bsteady\b/i);
    expect(prose).not.toContain('compared with 0');
  });

  it('keeps current-only outcomes off the comparison surface', () => {
    const overview = overviewWithRange(7);
    overview.outcomes.shipRate = 0;

    const compiled = compilePeriodComparison(overview);

    expect(compiled.evidence).toEqual([]);
    expect(compiled).not.toHaveProperty('outcomeContext');
    expect(compiled.narrative.map((line) => line.text).join(' ')).not.toContain('Ship rate');
  });

  it('marks partial all-work cost as a measured floor', () => {
    const overview = overviewWithRange(7);
    overview.usage.cost.delta = { current: 5, previous: 4 };
    overview.usage.cost.costPartial = true;

    const compiled = compilePeriodComparison(overview);
    const cost = compiled.evidence.find((row) => row.id === 'cost');

    expect(cost?.note).toContain('current value is a floor');
  });

  it('never emits grading, causal, signal, or middot language', () => {
    const overview = overviewWithRange(7);
    overview.usage.totals.sessionsDelta = { current: 12, previous: 9 };
    overview.usage.cost.delta = { current: 8, previous: 10 };
    overview.outcomes.shipRate = 0.75;

    const compiled = compilePeriodComparison(overview);
    const copy = [
      ...compiled.narrative.map((line) => line.text),
      ...compiled.evidence.flatMap((row) => [row.label, row.note]),
    ].join(' ');

    expect(copy).not.toMatch(/\b(better|worse|winner|because|signals?)\b/i);
    expect(copy).not.toContain('·');
  });
});

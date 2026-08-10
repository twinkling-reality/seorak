// Seorak demo scenario registry. Each scenario returns ONLY an
// OverviewSnapshot — no global/rank/team/memory/conversation/reports fixtures.
//
// The live sessions board is an explicit demo fixture; the current-state
// aggregates (totals, cost, projects, active/ended counts, callStats.totalCalls)
// are DERIVED from those sessions.
//
// Synthetic data, DEMO ONLY: the baseline/healthy scenarios (and the
// solo-cc/high-cost variants spread from them) INTENTIONALLY populate every
// event-log / deep-capture field (dailyTrends, hourlyDistribution, byTool,
// endReasons, stuckness, oneShotRate, byModel, errorRate) with deterministic
// synthetic data via createBaselineOverview, so ?demo can exercise each
// widget's populated state. This is the one sanctioned place for fabrication.
// The never-synthetic rule applies to the LIVE path only — the worker /overview
// endpoint and useOverview must ship honest empties (empty arrays / null) for
// every one of those fields, never zero-filled and never synthetic. Demo
// richness never leaks into the live path. The empty/no-live-sessions scenarios
// here model that honest empty state.

import { resolveCapabilities, type DeveloperModelSnapshot } from '@seorak/types';

import type { OverviewSnapshot } from '../apiSchemas.js';
import { createEmptyDeveloperModel } from '../schemas/developer-model.js';
import { createBaselineOverview, buildDemoProjects } from './baseline.js';
import { createBaselineDeveloperModel } from './developerModel.js';
import { createEmptyOverviewDemo } from './empty.js';

export type DemoScenarioId =
  | 'healthy'
  | 'empty'
  | 'solo-cc'
  | 'no-live-sessions'
  | 'high-cost';

/** Catalog grouping in the switcher / browse table. */
export type DemoCategory = 'baseline' | 'empty-states' | 'coverage' | 'outcomes';

/**
 * Product pillars a scenario exercises. Prefer these over widget jargon when
 * picking or filtering scenarios — insight / intervention / introspection map
 * to the vision jobs; honesty covers capability-shaped multi-tool.
 */
export type DemoDimension =
  | 'live-presence'
  | 'cost'
  | 'capture-depth'
  | 'intervention'
  | 'introspection'
  | 'honesty';

export type DemoView = 'overview' | 'tools' | 'project' | 'compare' | 'replay' | 'model';

export interface DemoData {
  overview: OverviewSnapshot;
  developerModel?: DeveloperModelSnapshot;
}

export interface DemoScenario {
  id: DemoScenarioId;
  label: string;
  category: DemoCategory;
  dimensions: DemoDimension[];
  views: DemoView[];
  summary: string;
  whatToCheck: string;
  build: (rangeDays?: number) => DemoData;
}

// ── Scenario builders ───────────────────────────────────────────────

function normalizeModelRange(rangeDays?: number): 7 | 30 | 90 {
  if (rangeDays === 7 || rangeDays === 90) return rangeDays;
  return 30;
}

function healthy(rangeDays?: number): DemoData {
  const range = normalizeModelRange(rangeDays);
  return {
    overview: createBaselineOverview(range),
    developerModel: createBaselineDeveloperModel(range),
  };
}

function empty(rangeDays?: number): DemoData {
  const range = normalizeModelRange(rangeDays);
  return {
    overview: createEmptyOverviewDemo(range),
    developerModel: createEmptyDeveloperModel(range),
  };
}

// Solo on Claude Code: ONE session, ONE repo — every series clipped to that
// claim so Overview / Agents / Model / Project never keep baseline ghosts.
function soloCC(rangeDays?: number): DemoData {
  const range = normalizeModelRange(rangeDays);
  const base = createBaselineOverview(range);
  const one = base.live.filter((s) => s.agent === 'claude-code').slice(0, 1);
  const session = one[0];
  if (!session) {
    return { overview: createEmptyOverviewDemo(range), developerModel: createEmptyDeveloperModel(range) };
  }
  const toolCalls = session.toolCallCount;
  const costUsd = session.costUsd;
  const projects = buildDemoProjects(one, range);
  const day = base.usage.dailyTrends[base.usage.dailyTrends.length - 1]?.day;
  const overview = {
    ...base,
    live: one,
    usage: {
      ...base.usage,
      totals: { sessions: 1, toolCalls, sessionsDelta: null },
      cost: {
        totalUsd: costUsd,
        sessionsWithCost: costUsd != null && costUsd > 0 ? 1 : 0,
        delta: null,
      },
      lines: {
        added: 180,
        removed: 40,
        delta: null,
      },
      dailyTrends: base.usage.dailyTrends.map((d, i, arr) =>
        i === arr.length - 1
          ? { day: d.day, sessions: 1, costUsd }
          : { day: d.day, sessions: 0, costUsd: null },
      ),
      projects,
      momentum: base.usage.momentum.filter((m) => m.repoId === session.repoId),
      portfolio: {
        windowDays: 7,
        reposTotal: 1,
        reposMoved: 1,
        reposQuiet: 0,
        repos: base.usage.portfolio.repos.filter((r) => r.repoId === session.repoId),
      },
      cacheReuseRatio: 0.55,
      costPerEdit: costUsd == null ? null : Math.round((costUsd / Math.max(1, toolCalls * 0.35)) * 100) / 100,
    },
    outcomes: {
      ...base.outcomes,
      activeCount: session.status !== 'ended' ? 1 : 0,
      endedCount: session.status === 'ended' ? 1 : 0,
      stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
      endReasons: [],
      endReasonsByDay: [],
      oneShotRate: null,
      shipRate: projects[0]?.shipRate ?? null,
      lineSurvival: projects[0]?.lineSurvival ?? base.outcomes.lineSurvival,
      bySession: [],
    },
    activity: {
      hourlyDistribution: [],
      agentHourly: [],
      endReasonsByHour: [],
    },
    codebase: {
      files: projects[0]?.codebaseFiles ?? [],
      directories: projects[0]?.codebaseDirectories ?? [],
      rework: projects[0]?.codebaseRework ?? [],
      commitStats: {
        windowDays: 7,
        commits: projects[0]?.commitsFromSessions ?? 1,
        filesTouched: projects[0]?.codebaseFiles.length ?? 1,
        linesAdded: 180,
        linesDeleted: 40,
        generatedLinesExcluded: 0,
        commitsFromSessions: projects[0]?.commitsFromSessions ?? 1,
      },
      filesInPlay: (() => {
        const files = (base.codebase.filesInPlay?.files ?? [])
          .map((f) => ({
            ...f,
            projects: f.projects.filter((p) => p.repoId === session.repoId),
          }))
          .filter((f) => f.projects.length > 0);
        return { distinctFiles: files.length, files };
      })(),
    },
    tools: {
      byTool: (projects[0]?.byTool ?? []).slice(0, 5),
      callStats: { totalCalls: toolCalls, errorRate: null },
      byModel: (projects[0]?.byModel ?? []).slice(0, 3),
      byAgent: [
        {
          agent: session.agent,
          sessions: 1,
          activeSessions: session.status === 'ended' ? 0 : 1,
          toolCalls,
          tokensTotal: session.tokens.total,
          costUsd,
          lines: { added: 180, removed: 40 },
          lastEventAt: session.lastEventAt,
          capabilities: resolveCapabilities('claude-code'),
          erroredPresent: false,
        },
      ],
      agentOutcomes: base.tools.agentOutcomes.filter((o) => o.agent === 'claude-code'),
      agentOutcomesUnusable: 0,
      agentDaily: day
        ? [{ agent: 'claude-code', day, sessions: 1, lines: { added: 180, removed: 40 } }]
        : [],
      agentModels: (projects[0]?.byModel ?? []).slice(0, 3).map((m) => ({
        agent: 'claude-code' as const,
        model: m.model,
        calls: m.calls,
        tokensTotal: m.tokensTotal,
        costUsd: m.costUsd,
      })),
      verification: projects[0]?.verification ?? [],
    },
  };

  return {
    overview,
    developerModel: createBaselineDeveloperModel(range, overview),
  };
}

// History without a live board: window widgets stay populated; live hero is empty.
function noLiveSessions(rangeDays?: number): DemoData {
  const range = normalizeModelRange(rangeDays);
  const base = createBaselineOverview(range);
  const overview = {
    ...base,
    live: [],
    outcomes: {
      ...base.outcomes,
      activeCount: 0,
      stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    },
    usage: {
      ...base.usage,
      projects: base.usage.projects.map((p) => ({ ...p, activeSessions: 0 })),
    },
    tools: {
      ...base.tools,
      byAgent: base.tools.byAgent.map((a) => ({ ...a, activeSessions: 0 })),
    },
    codebase: {
      ...base.codebase,
      filesInPlay: { files: [], distinctFiles: 0 },
    },
  };
  return {
    overview,
    developerModel: createBaselineDeveloperModel(range, overview),
  };
}

function scaleUsd(n: number | null | undefined, scale: number): number | null {
  if (n == null) return null;
  return Math.round(n * scale * 100) / 100;
}

// High cost: scale EVERY dollar-derived field (live, window, outcomes, Model)
// so Overview / Agents / Model stay one story at 7/30/90.
function highCost(rangeDays?: number): DemoData {
  const range = normalizeModelRange(rangeDays);
  const base = createBaselineOverview(range);
  const scale = 3.2;
  const pricey = base.live.map((s) =>
    s.costUsd == null
      ? s
      : {
          ...s,
          costUsd: scaleUsd(s.costUsd, scale)!,
          burnRateUsdPerMin: scaleUsd(s.burnRateUsdPerMin, scale),
        },
  );
  const priceyAgents = base.tools.byAgent.map((a) =>
    a.costUsd == null ? a : { ...a, costUsd: scaleUsd(a.costUsd, scale) },
  );
  // The headline is the SUM of the scaled agent rows, never an independently
  // scaled copy: per-row cent rounding drifts a penny apart on some window
  // totals, and byAgent must sum exactly to the headline above it.
  const totalUsd =
    base.usage.cost.totalUsd == null
      ? null
      : Math.round(priceyAgents.reduce((s, a) => s + (a.costUsd ?? 0), 0) * 100) / 100;
  const overview = {
    ...base,
    live: pricey,
    usage: {
      ...base.usage,
      cost: {
        totalUsd,
        sessionsWithCost: base.usage.cost.sessionsWithCost,
        delta: base.usage.cost.delta
          ? {
              current: totalUsd ?? 0,
              previous: scaleUsd(base.usage.cost.delta.previous, scale),
            }
          : null,
      },
      dailyTrends: base.usage.dailyTrends.map((d) =>
        d.costUsd == null ? d : { ...d, costUsd: scaleUsd(d.costUsd, scale) },
      ),
      projects: buildDemoProjects(pricey, range),
      costPerEdit: scaleUsd(base.usage.costPerEdit, scale),
    },
    tools: {
      ...base.tools,
      byAgent: priceyAgents,
      agentModels: base.tools.agentModels.map((m) =>
        m.costUsd == null ? m : { ...m, costUsd: scaleUsd(m.costUsd, scale) },
      ),
      byModel: base.tools.byModel.map((m) =>
        m.costUsd == null ? m : { ...m, costUsd: scaleUsd(m.costUsd, scale) },
      ),
      agentOutcomes: base.tools.agentOutcomes.map((o) => ({
        ...o,
        ratedCostUsd: scaleUsd(o.ratedCostUsd, scale),
        costPerSurvivingLine:
          o.costPerSurvivingLine == null || o.ratedCostUsd == null
            ? null
            : (scaleUsd(o.ratedCostUsd, scale)! / Math.max(1, o.linesSurviving)),
      })),
    },
  };
  return {
    overview,
    developerModel: createBaselineDeveloperModel(range, overview),
  };
}

// ── Registry ────────────────────────────────────────────────────────

export const DEMO_SCENARIOS: Record<DemoScenarioId, DemoScenario> = {
  healthy: {
    id: 'healthy',
    label: 'Working right now',
    category: 'baseline',
    dimensions: ['live-presence', 'intervention', 'introspection', 'honesty'],
    views: ['overview', 'tools', 'project', 'compare', 'replay', 'model'],
    summary:
      'Multi-repo live board with stuck and idle sessions worth a look, dual-agent honesty (Claude + priced Codex), and a populated Model portrait.',
    whatToCheck:
      'Live answers whether to look now; Interventions shows stuck_loop + went_cold; Agents matrix prices both tools; Model is populated.',
    build: healthy,
  },
  empty: {
    id: 'empty',
    label: 'Empty account',
    category: 'empty-states',
    dimensions: ['live-presence', 'cost', 'capture-depth', 'introspection'],
    views: ['overview', 'tools', 'project', 'compare', 'replay'],
    summary: 'A new account with zero activity yet.',
    whatToCheck: 'Every widget shows a real empty state, never a fake zero or ghost shape.',
    build: empty,
  },
  'solo-cc': {
    id: 'solo-cc',
    label: 'Solo, one session',
    category: 'coverage',
    dimensions: ['live-presence'],
    views: ['overview', 'project', 'compare', 'replay', 'model'],
    summary: 'One session on Claude Code in one repo.',
    whatToCheck: 'Live board shows a single row; cost and tool-call totals reflect that one session.',
    build: soloCC,
  },
  'no-live-sessions': {
    id: 'no-live-sessions',
    label: 'No sessions running',
    category: 'empty-states',
    dimensions: ['live-presence'],
    views: ['overview', 'tools', 'project', 'compare', 'replay', 'model'],
    summary: 'No sessions are running right now; the window still has history.',
    whatToCheck: 'Live-sessions hero is empty while cost/trends/Model stay populated.',
    build: noLiveSessions,
  },
  'high-cost': {
    id: 'high-cost',
    label: 'High cost period',
    category: 'outcomes',
    dimensions: ['cost', 'intervention'],
    views: ['overview', 'tools', 'project', 'compare', 'replay', 'model'],
    summary: 'Window spend is elevated 3.2x across live, trends, Agents, and Model.',
    whatToCheck: 'Cost headline, sparklines, byAgent, and Model tools all scale together.',
    build: highCost,
  },
};

export const DEMO_CATEGORY_ORDER: DemoCategory[] = [
  'baseline',
  'coverage',
  'outcomes',
  'empty-states',
];

export const DEMO_CATEGORY_LABELS: Record<DemoCategory, string> = {
  baseline: 'Baseline',
  coverage: 'Coverage',
  outcomes: 'Outcomes',
  'empty-states': 'Empty states',
};

export const DEMO_DIMENSION_LABELS: Record<DemoDimension, string> = {
  'live-presence': 'Live presence',
  cost: 'Cost',
  'capture-depth': 'Capture depth',
  intervention: 'Intervention',
  introspection: 'Introspection',
  honesty: 'Honesty',
};

export const DEMO_VIEW_LABELS: Record<DemoView, string> = {
  overview: 'Overview',
  tools: 'Tools',
  project: 'Project',
  compare: 'Compare',
  replay: 'Replay',
  model: 'Model',
};

export const DEMO_SCENARIO_IDS = Object.keys(DEMO_SCENARIOS) as DemoScenarioId[];

export const DEFAULT_SCENARIO: DemoScenarioId = 'healthy';

export function isDemoScenarioId(value: string | null | undefined): value is DemoScenarioId {
  return typeof value === 'string' && value in DEMO_SCENARIOS;
}

export function getDemoData(id?: string | null, rangeDays?: number): DemoData {
  if (isDemoScenarioId(id)) return DEMO_SCENARIOS[id].build(rangeDays);
  return DEMO_SCENARIOS[DEFAULT_SCENARIO].build(rangeDays);
}

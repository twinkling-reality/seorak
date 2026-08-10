/**
 * fixtures.ts — DEV-ONLY demo BoardData, mirroring the web `?demo` scenario ids
 * (healthy / empty / solo-cc / no-live-sessions / high-cost) so the terminal UI
 * can be exercised without a worker (`seorak --demo[=scenario]`).
 *
 * Synthetic data, DEMO ONLY — the same sanctioned-fabrication rule the web demo
 * follows: these fixtures populate the aggregate fields the live path leaves
 * honest-empty so every terminal widget's POPULATED state is visible. Demo
 * richness NEVER leaks into the live path: the real `seorak` session reads only
 * the worker endpoints (fetch.ts), and this module is imported solely on the
 * `--demo` branch. Timestamps are derived from a passed-in `nowMs` (no clock read
 * here) so freshness reads naturally and the builders stay deterministic.
 */
import {
  DEFAULT_THRESHOLDS,
  resolveCapabilities,
  type OverviewSnapshot,
  type SessionSummary,
  WIDEST_OVERVIEW_RANGE_DAYS,
} from "@seorak/types";
import type { BoardData } from "../types.ts";

export const DEMO_SCENARIO_IDS = [
  "healthy",
  "empty",
  "solo-cc",
  "no-live-sessions",
  "high-cost",
  // The two ENTRY-CARD scenarios. They exist because the card is otherwise
  // unviewable: it needs `watching === null` (no hooks installed) or a version
  // you have not seen, and neither is something you can arrange on a machine
  // that already runs seorak. A screen nobody can look at cannot be judged.
  "welcome",
  "news",
] as const;
export type DemoScenarioId = (typeof DEMO_SCENARIO_IDS)[number];
export const DEFAULT_DEMO_SCENARIO: DemoScenarioId = "healthy";

export function isDemoScenarioId(value: string): value is DemoScenarioId {
  return (DEMO_SCENARIO_IDS as readonly string[]).includes(value);
}

const iso = (ms: number): string => new Date(ms).toISOString();

interface SeedSession {
  id: string;
  project: string;
  repoId: string;
  status: SessionSummary["status"];
  currentTool?: string;
  awaitingInput?: boolean;
  elapsedSeconds: number;
  sinceSeconds: number;
  toolCallCount: number;
  tokensTotal: number;
  /** null when the session has no priced model — never a fabricated $0. */
  costUsd: number | null;
  agent?: "claude-code" | "codex";
}

const SEEDS: SeedSession[] = [
  { id: "sess-1", project: "seorak", repoId: "repo-seorak", status: "active", currentTool: "Edit", elapsedSeconds: 2520, sinceSeconds: 4, toolCallCount: 138, tokensTotal: 370300, costUsd: 5.4 },
  { id: "sess-2", project: "seorak", repoId: "repo-seorak", status: "active", currentTool: "Bash", awaitingInput: true, elapsedSeconds: 1080, sinceSeconds: 12, toolCallCount: 47, tokensTotal: 72800, costUsd: 0.62 },
  { id: "sess-3", project: "mobile-surfaces", repoId: "repo-mobile-surfaces", status: "idle", currentTool: "Read", elapsedSeconds: 4380, sinceSeconds: 840, toolCallCount: 211, tokensTotal: 154200, costUsd: 3.48 },
  { id: "sess-4", project: "mobile-surfaces", repoId: "repo-mobile-surfaces", status: "stuck", currentTool: "Bash", elapsedSeconds: 1860, sinceSeconds: 380, toolCallCount: 92, tokensTotal: 98000, costUsd: 1.27 },
  { id: "sess-5", project: "feather", repoId: "repo-feather", status: "active", currentTool: "Write", elapsedSeconds: 1620, sinceSeconds: 8, toolCallCount: 64, tokensTotal: 72000, costUsd: 0.84 },
  // Codex priced via session.tokens (capability contract).
  { id: "sess-6", project: "seorak", repoId: "repo-seorak", status: "active", currentTool: "ApplyPatch", elapsedSeconds: 1320, sinceSeconds: 6, toolCallCount: 53, tokensTotal: 41000, costUsd: 2.4, agent: "codex" },
];

function seedToSummary(seed: SeedSession, nowMs: number): SessionSummary {
  const elapsedMs = seed.elapsedSeconds * 1000;
  const lastEventAt = iso(nowMs - seed.sinceSeconds * 1000);
  const minutes = Math.max(1, seed.elapsedSeconds / 60);
  const agent = seed.agent ?? "claude-code";
  const unpriced = seed.costUsd == null;
  // DEMO ONLY: an actively-working priced seed accrues tokens/cost/tool-calls on
  // a slow deterministic clock (one bump per 9s, wrapping hourly so it stays
  // bounded), so the board's data-caused motion — the value flash and the
  // activity tick — is visible in demo without a worker. Same sanctioned-
  // fabrication rule as the populated aggregates above; never on the live path.
  const working = seed.status === "active" && seed.awaitingInput !== true && !unpriced;
  const bump = working ? Math.floor((nowMs % 3_600_000) / 9000) : 0;
  const tokensTotal = seed.tokensTotal + bump * 350;
  const costUsd = seed.costUsd == null ? null : seed.costUsd + bump * 0.005;
  const summary: SessionSummary = {
    sessionId: seed.id,
    project: seed.project,
    repoId: seed.repoId,
    agent,
    status: seed.status,
    startedAt: iso(nowMs - elapsedMs),
    lastEventAt,
    elapsedSeconds: seed.elapsedSeconds,
    toolCallCount: seed.toolCallCount + bump,
    tokens: {
      input: unpriced ? 0 : Math.round(tokensTotal * 0.35),
      output: unpriced ? 0 : Math.round(tokensTotal * 0.15),
      cacheRead: unpriced ? 0 : Math.round(tokensTotal * 0.45),
      cacheWrite: unpriced ? 0 : Math.round(tokensTotal * 0.05),
      total: unpriced ? 0 : tokensTotal,
    },
    costUsd,
    burnRateUsdPerMin: costUsd == null ? null : Math.round((costUsd / minutes) * 100) / 100,
  };
  if (seed.currentTool !== undefined) summary.currentTool = seed.currentTool;
  if (seed.awaitingInput !== undefined) summary.awaitingInput = seed.awaitingInput;
  return summary;
}

/** A fully-formed, honest-EMPTY OverviewSnapshot — every aggregate at its null /
 *  [] cold-start value. Scenario builders override only what they demonstrate. */
function emptyOverview(nowMs: number, rangeDays: number): OverviewSnapshot {
  return {
    generatedAt: iso(nowMs),
    rangeDays,
    // Demo shows the product unclamped: a fixture is illustrating what seorak
    // reads, not which plan the reader is on.
    maxRangeDays: WIDEST_OVERVIEW_RANGE_DAYS,
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
      portfolio: { windowDays: 7, reposTotal: 0, reposMoved: 0, reposQuiet: 0, repos: [] },
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
      // The terminal renders no per-agent outcome surface, so this stays honest-empty rather
      // than fabricating a head-to-head nobody asked to see.
      agentOutcomes: [],
      agentOutcomesUnusable: 0,
      verification: [],
    },
    codebase: { files: [], directories: [], rework: [], commitStats: null, filesInPlay: null },
  };
}

/** A richly-populated baseline overview (DEMO ONLY) — fills the aggregate fields
 *  the terminal widgets render so their populated state is visible. */
function baselineOverview(nowMs: number, rangeDays: number): OverviewSnapshot {
  const o = emptyOverview(nowMs, rangeDays);
  o.usage.totals = { sessions: 14, toolCalls: 612, sessionsDelta: null };
  o.usage.cost = { totalUsd: 18.42, sessionsWithCost: 12, delta: { current: 18.42, previous: 14.1 } };
  o.usage.cacheReuseRatio = 0.68;
  o.usage.costPerEdit = 0.21;
  o.usage.lines = { added: 1900, removed: 480, delta: null };
  o.usage.projects = [
    { ...projectRollup("seorak", "repo-seorak", 9, 2, nowMs - 4000) },
    { ...projectRollup("mobile-surfaces", "repo-mobile", 5, 1, nowMs - 86400000) },
  ];
  o.outcomes.activeCount = 3;
  o.outcomes.endedCount = 11;
  o.outcomes.shipRate = 0.71;
  o.outcomes.oneShotRate = 0.6;
  o.outcomes.stuckness = { rate: 0.18, stuckCount: 1, inFlight: 6, stuckSessionIds: ["sess-3"] };
  o.outcomes.lineSurvival = {
    rate: 0.82,
    linesAuthored: 1000,
    linesSurviving: 820,
    commitsChecked: 9,
    sessionsRated: 9,
    retained: 7,
    overwritten: 2,
    unreachable: 0,
    unknown: 0,
  };
  o.codebase.commitStats = {
    windowDays: 7,
    commits: 23,
    filesTouched: 64,
    linesAdded: 1900,
    linesDeleted: 480,
    generatedLinesExcluded: 120,
    commitsFromSessions: 17,
  };
  // Dual-agent rollup: Claude + Codex, both priced (session.tokens carrier).
  o.tools.byAgent = [
    {
      agent: "claude-code",
      sessions: 11,
      activeSessions: 4,
      toolCalls: 552,
      tokensTotal: 597300,
      costUsd: 18.42,
      lines: { added: 1840, removed: 420 },
      lastEventAt: iso(nowMs - 4000),
      capabilities: resolveCapabilities("claude-code"),
      erroredPresent: false,
    },
    {
      agent: "codex",
      sessions: 3,
      activeSessions: 1,
      toolCalls: 53,
      tokensTotal: 41000,
      costUsd: 2.4,
      lines: { added: 95, removed: 21 },
      lastEventAt: iso(nowMs - 6000),
      capabilities: resolveCapabilities("codex"),
      erroredPresent: false,
    },
  ];
  return o;
}

function projectRollup(project: string, repoId: string, sessions: number, active: number, lastMs: number) {
  return {
    project,
    repoId,
    sessions,
    sessionsDelta: null,
    activeSessions: active,
    toolCalls: sessions * 40,
    tokensTotal: sessions * 50000,
    costUsd: Math.round(sessions * 1.3 * 100) / 100,
    lastEventAt: iso(lastMs),
    errorRate: null,
    cacheReuseRatio: 0.66,
    shipRate: 0.7,
    oneShotRate: 0.58,
    costDelta: null,
    endReasons: [],
    stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    byTool: [],
    byModel: [],
    byAgent: [],
    hourlyDistribution: [],
    lineSurvival: null,
    endReasonsByHour: [],
    // Per-repo codebase + verification rollups (added to ProjectRollup by the
    // web-glass work). Honest-empty here: the terminal's projects widget renders
    // the leaderboard, not per-project codebase heat.
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
  };
}

/** Build the BoardData for a demo scenario at the given `now`. Always reachable
 *  (the demo path bypasses the worker). */
export function getDemoBoard(id: DemoScenarioId, nowMs: number, rangeDays: number): BoardData {
  const live = SEEDS.map((s) => seedToSummary(s, nowMs));
  switch (id) {
    case "empty":
    case "welcome":
      // Brand-new account: nothing live AND no project history → first-run screen.
      // "welcome" is the same board with the entry card in front of it.
      return { live: [], generatedAt: iso(nowMs), overview: emptyOverview(nowMs, rangeDays) };
    case "no-live-sessions": {
      // History exists but nobody is working now → idle board + aggregates.
      return { live: [], generatedAt: iso(nowMs), overview: baselineOverview(nowMs, rangeDays) };
    }
    case "solo-cc": {
      const one = [live.find((s) => s.agent === "claude-code") ?? live[0]!];
      const overview = baselineOverview(nowMs, rangeDays);
      overview.usage.projects = overview.usage.projects.slice(0, 1);
      overview.tools.byAgent = [
        {
          agent: "claude-code",
          sessions: 1,
          activeSessions: 1,
          toolCalls: one[0]!.toolCallCount,
          tokensTotal: one[0]!.tokens.total,
          costUsd: one[0]!.costUsd,
          lines: { added: 180, removed: 40 },
          lastEventAt: one[0]!.lastEventAt,
          capabilities: resolveCapabilities("claude-code"),
          erroredPresent: false,
        },
      ];
      return { live: one, generatedAt: iso(nowMs), overview };
    }
    case "high-cost": {
      const pricey = live.map((s) =>
        s.costUsd == null
          ? s
          : {
              ...s,
              costUsd: Math.round(s.costUsd * 3.2 * 100) / 100,
              burnRateUsdPerMin:
                s.burnRateUsdPerMin == null
                  ? null
                  : Math.round(s.burnRateUsdPerMin * 3.2 * 100) / 100,
            },
      );
      const overview = baselineOverview(nowMs, rangeDays);
      if (overview.usage.cost.totalUsd != null) {
        overview.usage.cost.totalUsd = Math.round(overview.usage.cost.totalUsd * 3.2 * 100) / 100;
      }
      overview.tools.byAgent = overview.tools.byAgent.map((a) =>
        a.costUsd == null ? a : { ...a, costUsd: Math.round(a.costUsd * 3.2 * 100) / 100 },
      );
      return { live: pricey, generatedAt: iso(nowMs), overview };
    }
    case "healthy":
    default:
      return { live, generatedAt: iso(nowMs), overview: baselineOverview(nowMs, rangeDays) };
  }
}

// Baseline demo OverviewSnapshot. Builds a set of live sessions, derives every
// current-state aggregate from them, and — because this is DEMO mode —
// populates the fields the live path leaves empty (daily trends, hourly
// heatmap, per-tool split, end reasons, per-model spend, stuckness, one-shot
// rate) with believable, DETERMINISTIC synthetic data so ?demo shows a full
// dashboard.
//
// This is the one place fabrication is allowed: demo fixtures exist precisely to
// exercise every widget's populated state. The LIVE path (worker → useOverview)
// still ships honest empties for those fields — see createEmptyOverview in the
// schema layer and the worker projection. Demo richness never leaks into live.

import type {
  OverviewSnapshot,
  SessionSummary,
  ProjectRollup,
  DailyPoint,
  HourBucket,
  ToolCallRollup,
  ModelRollup,
  EndReasonCount,
  DailyEndReasons,
  HourlyEndReasons,
  RepoMomentum,
  RepoTemperature,
  PortfolioMomentum,
  CommitStats,
  AgentRollup,
  AgentDailyPoint,
  AgentHourPoint,
  AgentModelRollup,
  AgentOutcomeRollup,
} from '@seorak/types';
import {
  AGENT_SURVIVAL_FLOOR,
  CAPABILITY_REGISTRY,
  DEFAULT_THRESHOLDS,
  resolveCapabilities,
  WIDEST_OVERVIEW_RANGE_DAYS,
} from '@seorak/types';
import {
  wobble,
  hash,
  allocateIntegerShares,
  buildDaySpine,
  weekdayWeight,
} from './rng.js';

export const DEFAULT_PERIOD_DAYS = 30;

interface SeedSession {
  id: string;
  project: string;
  /** Stable fake salted-style repo id (the keying id). NEVER an absolute path —
   *  the demo must not show one either; `project` is the only display label. */
  repoId: string;
  status: SessionSummary['status'];
  currentTool: string;
  elapsedMin: number;
  /** seconds since the last event — drives the live pulse / stale dot. */
  sinceSec: number;
  toolCalls: number;
  /**
   * Estimated USD when the LIVE row genuinely carries dollars. `null` when it
   * cannot: a session with no priced model, or a Codex session, whose
   * session.tokens carrier never rides the live path. Never a fabricated $0.
   */
  cost: number | null;
  /** Defaults to Claude Code. */
  agent?: 'claude-code' | 'codex';
}

const SEEDS: SeedSession[] = [
  {
    id: 'sess-1',
    project: 'seorak',
    repoId: 'repo-seorak',
    status: 'active',
    currentTool: 'Edit',
    elapsedMin: 42,
    sinceSec: 4,
    toolCalls: 138,
    // Above default costSpikeUsd ($5) so Interventions shows a spend watch.
    cost: 5.4,
  },
  {
    id: 'sess-2',
    project: 'seorak',
    repoId: 'repo-seorak',
    status: 'active',
    currentTool: 'Bash',
    elapsedMin: 18,
    sinceSec: 12,
    toolCalls: 47,
    cost: 0.62,
  },
  {
    id: 'sess-3',
    project: 'mobile-surfaces',
    repoId: 'repo-mobile-surfaces',
    status: 'idle',
    currentTool: 'Read',
    elapsedMin: 73,
    // Quiet long enough to trip went_cold (default 10 min) — intervention seed.
    sinceSec: 840,
    toolCalls: 211,
    cost: 3.48,
  },
  {
    id: 'sess-4',
    project: 'mobile-surfaces',
    repoId: 'repo-mobile-surfaces',
    status: 'stuck',
    currentTool: 'Bash',
    elapsedMin: 31,
    sinceSec: 380,
    toolCalls: 92,
    cost: 1.27,
  },
  {
    id: 'sess-5',
    project: 'feather',
    repoId: 'repo-feather',
    status: 'active',
    currentTool: 'Write',
    elapsedMin: 27,
    sinceSec: 8,
    toolCalls: 64,
    cost: 0.84,
  },
  // Codex live seed: UNPRICED on purpose. Codex's money rides the session.tokens
  // carrier in the event log; the live KV path never sees it, so a live codex row
  // structurally has zero tokens and no cost and reads '--' exactly like prod.
  // The priced codex story lives in the aggregates (byAgent/agentModels), where
  // the carrier genuinely prices it.
  {
    id: 'sess-6',
    project: 'seorak',
    repoId: 'repo-seorak',
    status: 'active',
    currentTool: 'ApplyPatch',
    elapsedMin: 22,
    sinceSec: 6,
    toolCalls: 53,
    cost: null,
    agent: 'codex',
  },
];

function buildSession(seed: SeedSession, i: number): SessionSummary {
  const nowMs = Date.now();
  const startedMs = nowMs - seed.elapsedMin * 60_000;
  const lastEventMs = nowMs - seed.sinceSec * 1_000;
  const agent = seed.agent ?? 'claude-code';
  // Honest-empty tokens when this seed carries no priced cost. The live codex
  // seed is one of those: its session.tokens carrier rides the event log, so
  // the live KV row has zero tokens and no cost, the same shape prod ships.
  const unpriced = seed.cost == null;
  const input = unpriced ? 0 : wobble(i * 7 + 1, 18_000, 6_000);
  const output = unpriced ? 0 : wobble(i * 7 + 2, 9_000, 3_000);
  return {
    sessionId: seed.id,
    project: seed.project,
    repoId: seed.repoId,
    agent,
    status: seed.status,
    startedAt: new Date(startedMs).toISOString(),
    lastEventAt: new Date(lastEventMs).toISOString(),
    elapsedSeconds: seed.elapsedMin * 60,
    toolCallCount: seed.toolCalls,
    currentTool: seed.currentTool,
    tokens: {
      input,
      output,
      cacheRead: unpriced ? 0 : wobble(i * 7 + 3, 40_000, 12_000),
      cacheWrite: unpriced ? 0 : wobble(i * 7 + 4, 6_000, 2_000),
      total: input + output,
    },
    costUsd: seed.cost,
    burnRateUsdPerMin:
      seed.cost == null
        ? null
        : Math.round((seed.cost / Math.max(1, seed.elapsedMin)) * 100) / 100,
  };
}

// Per-repo compare story (DEMO ONLY). The web repo-compare view
// (docs/specs/multi-repo.md) reads per-repo scalars + distributions off each
// ProjectRollup; the live path fills them once the event log accrues, so the
// demo fabricates a believable A/B contrast between the two headline repos:
// `seorak` reads productive (ships, work lasts, ends clean) and
// `mobile-surfaces` reads like a grind (stuck, retries, builds failing,
// sessions abandoned at the input). Keyed by the salted repoId. Anti-grade: a
// low number is neutral here, never "bad work".
const COMPARE_STORY: Record<string, Partial<ProjectRollup>> = {
  'repo-seorak': {
    character: {
      repoShape: { monorepo: true, sizeBand: 'l', ageBand: 'established' },
      packageManager: 'pnpm',
      framework: 'react',
    },
    workMix: {
      fileLanguageMix: [{ language: 'typescript', editCalls: 120 }],
      fileCategoryMix: [{ category: 'source', editCalls: 95 }],
      branchWorkTypeMix: [{ workType: 'feature', sessions: 12 }],
      peakHour: { dow: 2, hour: 10, sessions: 4 },
    },
    shipRate: 0.82,
    oneShotRate: 0.71,
    errorRate: 0.04,
    stuckness: { rate: 0, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    endReasons: [
      { reason: 'clear', count: 14 },
      { reason: 'resume', count: 3 },
    ],
    lineSurvival: {
      rate: 0.79,
      linesAuthored: 1240,
      linesSurviving: 980,
      commitsChecked: 22,
      sessionsRated: 9,
      retained: 8,
      overwritten: 1,
      unreachable: 0,
      unknown: 0,
    },
    codebaseFiles: [
      { fileId: 'sa'.repeat(32), label: 'overview.ts', edits: 14, linesAdded: 220, linesRemoved: 96, sessions: 4 },
      { fileId: 'sb'.repeat(32), label: 'sessions.ts', edits: 9, linesAdded: 130, linesRemoved: 41, sessions: 3 },
    ],
    codebaseDirectories: [
      { dirId: 'sd'.repeat(32), label: 'web', edits: 16, share: 0.55 },
      { dirId: 'se'.repeat(32), label: 'worker', edits: 13, share: 0.45 },
    ],
    codebaseRework: [
      { fileId: 'sa'.repeat(32), label: 'overview.ts', sessions: 4, edits: 14 },
    ],
    verification: [], // no failing checks — the healthy repo reads honest-empty
  },
  'repo-mobile-surfaces': {
    character: {
      repoShape: { monorepo: false, sizeBand: 'm', ageBand: 'recent' },
      framework: 'expo',
      packageManager: 'npm',
    },
    workMix: {
      fileLanguageMix: [{ language: 'typescript', editCalls: 45 }],
      fileCategoryMix: [{ category: 'test', editCalls: 22 }],
      branchWorkTypeMix: [{ workType: 'fix', sessions: 8 }],
    },
    shipRate: 0.31,
    oneShotRate: 0.38,
    errorRate: 0.14,
    stuckness: { rate: 0.25, stuckCount: 1, inFlight: 4, stuckSessionIds: ['sess-4'] },
    endReasons: [
      { reason: 'prompt_input_exit', count: 6 },
      { reason: 'bypass_permissions_disabled', count: 4 },
      { reason: 'clear', count: 3 },
    ],
    lineSurvival: {
      rate: 0.44,
      linesAuthored: 900,
      linesSurviving: 396,
      commitsChecked: 12,
      sessionsRated: 6,
      retained: 3,
      overwritten: 3,
      unreachable: 1,
      unknown: 0,
    },
    codebaseFiles: [
      { fileId: 'ma'.repeat(32), label: 'LiveActivity.swift', edits: 22, linesAdded: 310, linesRemoved: 280, sessions: 5 },
      { fileId: 'mb'.repeat(32), label: 'DynamicIsland.swift', edits: 15, linesAdded: 190, linesRemoved: 170, sessions: 4 },
    ],
    codebaseDirectories: [
      { dirId: 'md'.repeat(32), label: 'ios', edits: 28, share: 0.7 },
      { dirId: 'me'.repeat(32), label: 'src', edits: 12, share: 0.3 },
    ],
    codebaseRework: [
      { fileId: 'ma'.repeat(32), label: 'LiveActivity.swift', sessions: 5, edits: 22 },
    ],
    verification: [
      { kind: 'build', passRate: 0, runs: 3, passed: 0 },
      { kind: 'test', passRate: 0, runs: 2, passed: 0 },
    ],
  },
  'repo-feather': {
    character: {
      // Contract values only: RepoAgeBand has no 'young' and Framework has no
      // 'node' (a runtime, not a framework), so a plain Node CLI omits the
      // optional framework fact rather than inventing one.
      repoShape: { monorepo: false, sizeBand: 's', ageBand: 'recent' },
      packageManager: 'pnpm',
    },
    workMix: {
      fileLanguageMix: [{ language: 'typescript', editCalls: 28 }],
      fileCategoryMix: [{ category: 'source', editCalls: 22 }],
      branchWorkTypeMix: [{ workType: 'chore', sessions: 4 }],
      peakHour: { dow: 4, hour: 16, sessions: 2 },
    },
    shipRate: 0.57,
    oneShotRate: 0.63,
    errorRate: 0.06,
    stuckness: { rate: 0, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    endReasons: [
      { reason: 'clear', count: 7 },
      { reason: 'resume', count: 3 },
      { reason: 'prompt_input_exit', count: 1 },
    ],
    lineSurvival: {
      rate: 0.68,
      linesAuthored: 410,
      linesSurviving: 279,
      commitsChecked: 9,
      sessionsRated: 4,
      retained: 3,
      overwritten: 1,
      unreachable: 0,
      unknown: 0,
    },
    codebaseFiles: [
      { fileId: 'fa'.repeat(32), label: 'exporter.ts', edits: 8, linesAdded: 96, linesRemoved: 28, sessions: 3 },
      { fileId: 'fc'.repeat(32), label: 'sync.test.ts', edits: 5, linesAdded: 64, linesRemoved: 18, sessions: 2 },
    ],
    verification: [
      { kind: 'typecheck', passRate: 0.83, runs: 6, passed: 5 },
      { kind: 'test', passRate: 0.75, runs: 4, passed: 3 },
    ],
  },
};

export function rollupProjects(sessions: SessionSummary[]): ProjectRollup[] {
  // Group by the salted repoId (the keying id), never the absolute path.
  const byRepo = new Map<string, ProjectRollup>();
  for (const s of sessions) {
    const existing = byRepo.get(s.repoId);
    if (existing) {
      existing.sessions += 1;
      existing.activeSessions += s.status === 'ended' ? 0 : 1;
      existing.toolCalls += s.toolCallCount;
      existing.tokensTotal += s.tokens.total;
      // costUsd is number | null per ProjectRollup. Sum measured costs only;
      // a Codex-only repo stays null rather than collapsing to $0.
      existing.costUsd =
        existing.costUsd == null && s.costUsd == null
          ? null
          : (existing.costUsd ?? 0) + (s.costUsd ?? 0);
      if (s.lastEventAt > existing.lastEventAt) existing.lastEventAt = s.lastEventAt;
      bumpProjectAgent(existing, s);
    } else {
      const row: ProjectRollup = {
        project: s.project,
        repoId: s.repoId,
        sessions: 1,
        sessionsDelta: null,
        activeSessions: s.status === 'ended' ? 0 : 1,
        toolCalls: s.toolCallCount,
        tokensTotal: s.tokens.total,
        costUsd: s.costUsd,
        lastEventAt: s.lastEventAt,
        // Per-repo errorRate / cacheReuseRatio / shipRate / oneShotRate / costDelta
        // are mobile-only glance metrics (PROJECT-PROFILES Phase-2b); no web widget
        // renders them, so the demo leaves them honest-empty rather than fabricating
        // per-call / per-session signals.
        errorRate: null,
        cacheReuseRatio: null,
        shipRate: null,
        oneShotRate: null,
        costDelta: null,
        // Per-repo end reasons (DA-06 real fix). Honest-empty in demo; the
        // populated ring is the GLOBAL synthetic outcomes.endReasons below.
        endReasons: [],
        stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
        byTool: [],
        byModel: [],
        byAgent: [],
        hourlyDistribution: [],
        lineSurvival: null,
        endReasonsByHour: [],
        // Per-repo codebase + verification. Base honest-empty (never undefined,
        // so the compare view's array reads are safe); the two headline repos
        // are enriched from COMPARE_STORY below.
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
      bumpProjectAgent(row, s);
      byRepo.set(s.repoId, row);
    }
  }
  for (const p of byRepo.values()) {
    for (const a of p.byAgent) {
      if (a.agent === 'claude-code') {
        a.lines = {
          added: Math.max(20, Math.round(a.sessions * 38)),
          removed: Math.max(4, Math.round(a.sessions * 9)),
        };
      } else if (a.agent === 'codex') {
        a.lines = {
          added: Math.max(12, Math.round(a.toolCalls * 1.8)),
          removed: Math.max(3, Math.round(a.toolCalls * 0.4)),
        };
      }
    }
  }
  return [...byRepo.values()]
    .map((p) => ({ ...p, ...COMPARE_STORY[p.repoId] }))
    .map(enrichProjectDemoFields)
    .sort((a, b) => b.sessions - a.sessions);
}

/** Per-repo share of synthetic WINDOW history (live stays separate). Matches the
 *  focus weights in developerModel so Overview / Project / Model stay one story. */
const REPO_WINDOW_SHARE: Record<string, number> = {
  'repo-seorak': 0.52,
  'repo-mobile-surfaces': 0.33,
  'repo-feather': 0.15,
};

/**
 * Lift live-derived project rows into a range-aware WINDOW rollup.
 * activeSessions stay live-only; sessions/cost/toolCalls/files scale with rangeDays
 * so Project view's 7d / 30d / 90d pills actually move the numbers.
 */
export function buildDemoProjects(live: SessionSummary[], rangeDays: number): ProjectRollup[] {
  const liveRows = rollupProjects(live);
  // ~18 history sessions at 30d reference; scales linearly with the picker.
  const histSessionsTotal = Math.max(0, Math.round((rangeDays / 30) * 18));
  const histCostTotal = histSessionsTotal * 1.45;
  const histCallsTotal = histSessionsTotal * 26;
  const fileScale = Math.max(1, rangeDays / 7);

  return liveRows
    .map((p) => {
      const share = REPO_WINDOW_SHARE[p.repoId] ?? 1 / Math.max(1, liveRows.length);
      const histSessions = Math.max(0, Math.round(histSessionsTotal * share));
      const histCost = Math.round(histCostTotal * share * 100) / 100;
      const histCalls = Math.max(0, Math.round(histCallsTotal * share));
      const liveCost = p.costUsd ?? 0;
      const sessions = p.sessions + histSessions;
      const toolCalls = p.toolCalls + histCalls;
      const costUsd = Math.round((liveCost + histCost) * 100) / 100;
      return enrichProjectDemoFields({
        ...p,
        sessions,
        sessionsDelta: {
          current: sessions,
          previous: Math.max(1, Math.round(sessions * 0.8)),
        },
        // activeSessions stays the live count from rollupProjects.
        toolCalls,
        tokensTotal: Math.round(toolCalls * 900),
        costUsd,
        costDelta: {
          current: costUsd,
          previous: Math.round(costUsd * (0.72 + hash(p.repoId.length) * 0.1) * 100) / 100,
        },
        byTool: [],
        byModel: [],
        codebaseFiles: p.codebaseFiles.map((f) => ({
          ...f,
          edits: Math.max(1, Math.round(f.edits * fileScale)),
          linesAdded: Math.round(f.linesAdded * fileScale),
          linesRemoved: Math.round(f.linesRemoved * fileScale),
          sessions: Math.max(1, Math.round(f.sessions * Math.max(1, rangeDays / 30))),
        })),
        codebaseDirectories: [],
        codebaseRework: [],
      });
    })
    .sort((a, b) => b.sessions - a.sessions);
}

/** Fill Project/Compare demo fields the live path leaves empty until event-log
 *  depth lands — byTool/byModel/hourly, editCalls, costDelta, directories/rework. */
function enrichProjectDemoFields(p: ProjectRollup): ProjectRollup {
  const editCalls = Math.max(1, Math.round(p.toolCalls * 0.35));
  const byTool =
    p.byTool.length > 0
      ? p.byTool
      : buildByTool(Math.max(12, p.toolCalls)).map((t) => ({
          ...t,
          calls: Math.max(1, Math.round(t.calls * Math.max(0.15, p.toolCalls / 400))),
          sessions: Math.max(1, p.sessions),
        }));
  const byModel =
    p.byModel.length > 0
      ? p.byModel
      : buildByModel(Math.max(12, p.toolCalls), p.costUsd ?? 1).map((m) => ({
          ...m,
          calls: Math.max(1, Math.round(m.calls * Math.max(0.15, p.toolCalls / 400))),
          costUsd:
            p.costUsd == null
              ? null
              : Math.round(((p.costUsd * (m.costUsd ?? 0)) / Math.max(1, p.costUsd || 1)) * 100) / 100,
        }));
  // Normalize model costs to the repo headline when priced.
  if (p.costUsd != null && byModel.length > 0) {
    const modelSum = byModel.reduce((s, m) => s + (m.costUsd ?? 0), 0) || 1;
    for (const m of byModel) {
      m.costUsd = Math.round(((p.costUsd * (m.costUsd ?? 0)) / modelSum) * 100) / 100;
    }
  }
  const hourly =
    p.hourlyDistribution.length > 0
      ? p.hourlyDistribution
      : buildHourlyDistribution()
          .filter((b) => b.sessions > 0 && (b.dow + b.hour + hash(p.repoId.length)) % 3 === 0)
          .slice(0, 18)
          .map((b) => ({ ...b, sessions: Math.max(1, Math.round(b.sessions * 0.4)) }));
  const files = p.codebaseFiles;
  const directories =
    p.codebaseDirectories.length > 0
      ? p.codebaseDirectories
      : files.length > 0
        ? [
            {
              dirId: `${p.repoId}-d1`.padEnd(64, '0').slice(0, 64),
              label: p.project === 'mobile-surfaces' ? 'ios' : 'src',
              edits: files.reduce((s, f) => s + f.edits, 0),
              share: 1,
            },
          ]
        : [];
  const rework =
    p.codebaseRework.length > 0
      ? p.codebaseRework
      : files.slice(0, 1).map((f) => ({
          fileId: f.fileId,
          label: f.label,
          sessions: f.sessions,
          edits: f.edits,
        }));
  // Per-repo AGENT series (Agents surface repo filter, DEMO). Derived from THIS
  // project's own byAgent so a FILTERED demo Agents page shows coherent, non-empty
  // panels instead of honest-empty. Coarse and illustrative; when the user selects
  // repos the client re-aggregation (agentsScope) recomputes rates from these counts,
  // exactly as it does on real data.
  const today = new Date().toISOString().slice(0, 10);
  const agentDaily: AgentDailyPoint[] = p.byAgent.map((a) => ({
    agent: a.agent,
    day: today,
    sessions: Math.max(1, a.sessions),
    lines: a.lines,
  }));
  const agentHourly: AgentHourPoint[] = p.byAgent.map((a) => ({
    // Codex concentrated late, Claude in the working day — mirrors the global demo cadence.
    agent: a.agent,
    hour: a.agent === 'codex' ? 22 : 15,
    calls: Math.max(1, a.toolCalls),
  }));
  const agentModels: AgentModelRollup[] = p.byAgent.map((a) => ({
    agent: a.agent,
    model: a.agent === 'codex' ? 'gpt-5.6-sol' : 'claude-opus-4-8',
    calls: Math.max(1, a.toolCalls),
    tokensTotal: Math.max(1, a.tokensTotal),
    costUsd: a.costUsd,
  }));
  const agentOutcomes: AgentOutcomeRollup[] = p.byAgent.map((a) => {
    // Scale authored lines to the agent's edit volume so a substantial demo project
    // clears the survival floor and a tiny one honestly reads null beside real counts.
    const authored = a.lines?.added ?? Math.round(a.toolCalls * 6);
    const rate = a.agent === 'codex' ? 0.58 : 0.74;
    const surviving = Math.round(authored * rate);
    return {
      agent: a.agent,
      linesAuthored: authored,
      linesSurviving: surviving,
      survivalRate: authored >= AGENT_SURVIVAL_FLOOR.lines ? surviving / authored : null,
      commits: Math.max(AGENT_SURVIVAL_FLOOR.commits, Math.round(a.sessions * 1.4)),
      sessionsRated: a.sessions,
      ratedCostUsd: a.costUsd,
      costPerSurvivingLine: a.costUsd != null && surviving > 0 ? a.costUsd / surviving : null,
      unreachableSessions: 0,
      unknownSessions: 0,
      filesGoneFromTip: 0,
      coverage: {
        linesInCommits: authored,
        linesAuthored: authored,
        linesOtherAgents: 0,
        linesContested: 0,
        linesUnattributed: 0,
      },
    };
  });
  return {
    ...p,
    cacheReadTokens: Math.round(p.tokensTotal * 0.62),
    cacheInputTokens: Math.round(p.tokensTotal * 0.38),
    editCalls,
    costDelta:
      p.costDelta ??
      (p.costUsd == null
        ? null
        : { current: p.costUsd, previous: Math.round(p.costUsd * 0.78 * 100) / 100 }),
    byTool,
    byModel,
    hourlyDistribution: hourly,
    codebaseDirectories: directories,
    codebaseRework: rework,
    agentDaily,
    agentHourly,
    agentModels,
    agentOutcomes,
    agentOutcomesUnusable: 0,
    lines:
      p.lines ??
      ({
        added: Math.round(editCalls * 4.2),
        removed: Math.round(editCalls * 1.1),
        priorAdded: Math.round(editCalls * 3.4),
      } as ProjectRollup['lines']),
    commitsFromSessions: p.commitsFromSessions ?? Math.max(1, Math.round(p.sessions * 0.7)),
    cacheReuseRatio: p.cacheReuseRatio ?? 0.58,
  };
}

function bumpProjectAgent(project: ProjectRollup, s: SessionSummary): void {
  const existing = project.byAgent.find((a) => a.agent === s.agent);
  if (existing) {
    existing.sessions += 1;
    existing.activeSessions += s.status === 'ended' ? 0 : 1;
    existing.toolCalls += s.toolCallCount;
    existing.tokensTotal += s.tokens.total;
    if (s.costUsd != null) {
      existing.costUsd = (existing.costUsd ?? 0) + s.costUsd;
    }
    if (s.lastEventAt > existing.lastEventAt) existing.lastEventAt = s.lastEventAt;
  } else {
    project.byAgent.push({
      agent: s.agent,
      sessions: 1,
      activeSessions: s.status === 'ended' ? 0 : 1,
      toolCalls: s.toolCallCount,
      tokensTotal: s.tokens.total,
      costUsd: s.costUsd,
      lines: null,
      lastEventAt: s.lastEventAt,
      capabilities: resolveCapabilities(s.agent),
      erroredPresent: false,
    });
  }
}

// ── Synthetic event-log / deep-capture fields (DEMO ONLY) ────────────
// These fields need either a retained event log (daily trends, hourly heatmap,
// end reasons) or deeper per-call / per-model capture the collector does not
// emit (per-tool split, per-model spend). The live path ships them empty; demo
// fabricates them so every widget has a populated state to render.

// Per-day sessions + cost over the window, shaped by weekday rhythm so the
// sparklines have a recognizable weekly cadence rather than noise.
function buildDailyTrends(periodDays: number): DailyPoint[] {
  return buildDaySpine(periodDays).map((day, i) => {
    const weight = weekdayWeight(day);
    const sessions = Math.round(wobble(i * 3 + 11, 6, 3) * weight);
    // Honor the DailyPoint contract: costUsd is null (never 0 as a stand-in)
    // on a zero-session day, so the cost trend reads "no data" not "$0".
    const costUsd = sessions === 0 ? null : Math.round(sessions * (1.4 + hash(i * 5 + 2)) * 100) / 100;
    return { day, sessions, costUsd };
  });
}

// 7×24 session-count grid, peaking during weekday working hours.
function buildHourlyDistribution(): HourBucket[] {
  const out: HourBucket[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const dayWeight = dow >= 1 && dow <= 5 ? 1.0 : 0.3;
    for (let hour = 0; hour < 24; hour++) {
      // Working-hours hump centered ~14:00.
      const workHump = Math.max(0, 1 - Math.abs(hour - 14) / 9);
      const sessions = Math.round(wobble(dow * 24 + hour + 100, 5, 4) * dayWeight * workHump);
      out.push({ dow, hour, sessions });
    }
  }
  return out;
}

// Per-tool call split — allocated against the real total tool-call count so the
// shares sum exactly to the headline number.
function buildByTool(totalCalls: number): ToolCallRollup[] {
  // TEN tools on purpose: past the strip's top-7 fold, so the demo
  // exercises the "+N more" tail state (demo fixtures exist to exercise
  // every widget state, the overflow protocol's included).
  //
  // `other` is in the list because PRODUCTION SENDS IT. It is the aggregate
  // remainder for calls whose tool name the rollup did not keep, and on a real
  // window it is the second largest entry by call count. Omitting it here let the
  // Model portrait rank it as a tool and print "you spent more of it Bash and
  // Other than anything else" to a real reader, with every test green — a fixture
  // shaped by what we expected instead of what the sender emits cannot catch a
  // bug of this kind, it hides one.
  const tools = [
    { tool: 'Read', share: 30, sessions: 4 },
    { tool: 'other', share: 20, sessions: 4 },
    { tool: 'Edit', share: 22, sessions: 4 },
    { tool: 'Bash', share: 19, sessions: 4 },
    { tool: 'Grep', share: 11, sessions: 3 },
    { tool: 'Write', share: 7, sessions: 3 },
    { tool: 'TodoWrite', share: 4, sessions: 2 },
    { tool: 'WebFetch', share: 3, sessions: 2 },
    { tool: 'Glob', share: 2, sessions: 2 },
    { tool: 'Task', share: 2, sessions: 1 },
  ];
  const calls = allocateIntegerShares(totalCalls, tools.map((t) => t.share));
  return tools
    .map((t, i) => ({ tool: t.tool, calls: calls[i] ?? 0, sessions: t.sessions }))
    .filter((t) => t.calls > 0)
    .sort((a, b) => b.calls - a.calls);
}

// Per-model spend split, summing to the live board's real cost. Full minor
// versions, matching what a collector actually reports (the collector's own
// CURRENT_MODEL_IDS guard) — a bare `claude-opus-4` is a MODEL_PRICES family
// key, not an id any transcript carries.
function buildByModel(totalCalls: number, totalCost: number): ModelRollup[] {
  const models = [
    { model: 'claude-opus-4-8', share: 58 },
    { model: 'claude-sonnet-4-6', share: 34 },
    { model: 'claude-haiku-4-5', share: 8 },
  ];
  const callSplit = allocateIntegerShares(totalCalls, models.map((m) => m.share));
  const sumShares = models.reduce((s, m) => s + m.share, 0);
  // Cents get the same largest-remainder split as calls so the rows SUM EXACTLY
  // to the cost they divide: independent per-row rounding drifts a penny on some
  // window totals, and a demo whose numbers do not add up teaches the reader to
  // distrust the real one.
  const centSplit = allocateIntegerShares(Math.round(totalCost * 100), models.map((m) => m.share));
  // Tokens track the same shares (small wobble) so calls, tokens, and cost tell
  // one story — and Opus holds a real majority for the models pairing sentence.
  return models.map((m, i) => ({
    model: m.model,
    calls: callSplit[i] ?? 0,
    tokensTotal: Math.round((360_000 * m.share) / sumShares) + wobble(i * 9 + 70, 6_000, 3_000),
    costUsd: (centSplit[i] ?? 0) / 100,
  }));
}

// Cross-repo momentum (DEMO ONLY). Eight repos so the repo-activity face
// exercises every state it can render: five that moved (including one with a
// null baseline, so the "vs prior 7d" column shows its honest "--"), three
// quiet at different depths — and, with the face capped at five rows, the
// SectionOverflow fold ("+3 more repos") is visible in the demo. Anti-vanity:
// the demo leads with files-touched + net change; the LIVE path derives all
// of this from the git.momentum history, honest-empty until commits land.
interface DemoRepo {
  repoId: string;
  repoLabel: string;
  /** null = moved but history too thin to judge (mirrors the worker). */
  temperature: RepoTemperature['temperature'];
  commits: number;
  filesTouched: number;
  linesAdded: number;
  linesDeleted: number;
  generatedLinesExcluded: number;
  quietDays: number | null;
  baseline: { commits: number; filesTouched: number } | null;
}

const DEMO_REPOS: DemoRepo[] = [
  // The headline repos share the rollup repoIds so the compare view's
  // git-commits row resolves the momentum snapshot by repoId. The other five
  // keep demo-* ids.
  { repoId: 'repo-seorak', repoLabel: 'seorak', temperature: 'heating', commits: 12, filesTouched: 34, linesAdded: 720, linesDeleted: 180, generatedLinesExcluded: 490, quietDays: null, baseline: { commits: 5, filesTouched: 18 } },
  { repoId: 'repo-mobile-surfaces', repoLabel: 'mobile-surfaces', temperature: 'steady', commits: 5, filesTouched: 11, linesAdded: 180, linesDeleted: 60, generatedLinesExcluded: 0, quietDays: null, baseline: { commits: 5, filesTouched: 10 } },
  { repoId: 'repo-feather', repoLabel: 'feather', temperature: 'heating', commits: 4, filesTouched: 8, linesAdded: 126, linesDeleted: 34, generatedLinesExcluded: 0, quietDays: null, baseline: { commits: 1, filesTouched: 3 } },
  { repoId: 'demo-port', repoLabel: 'portfolio-site', temperature: 'cooling', commits: 2, filesTouched: 3, linesAdded: 60, linesDeleted: 100, generatedLinesExcluded: 0, quietDays: null, baseline: { commits: 6, filesTouched: 14 } },
  { repoId: 'demo-dot', repoLabel: 'dotfiles', temperature: null, commits: 1, filesTouched: 2, linesAdded: 12, linesDeleted: 3, generatedLinesExcluded: 0, quietDays: null, baseline: null },
  { repoId: 'demo-notes', repoLabel: 'notes-cli', temperature: 'quiet', commits: 0, filesTouched: 0, linesAdded: 0, linesDeleted: 0, generatedLinesExcluded: 0, quietDays: 9, baseline: { commits: 3, filesTouched: 6 } },
  { repoId: 'demo-blog', repoLabel: 'blog', temperature: 'quiet', commits: 0, filesTouched: 0, linesAdded: 0, linesDeleted: 0, generatedLinesExcluded: 0, quietDays: 4, baseline: { commits: 2, filesTouched: 5 } },
  { repoId: 'demo-maintenance', repoLabel: 'mature-api', temperature: 'quiet', commits: 0, filesTouched: 0, linesAdded: 0, linesDeleted: 0, generatedLinesExcluded: 0, quietDays: 21, baseline: null },
];

function buildMomentum(): RepoMomentum[] {
  return DEMO_REPOS.map((r) => ({
    repoId: r.repoId,
    repoLabel: r.repoLabel,
    gitContext: 'clean',
    windowDays: 7,
    commits: r.commits,
    filesTouched: r.filesTouched,
    linesAdded: r.linesAdded,
    linesDeleted: r.linesDeleted,
    netLines: r.linesAdded - r.linesDeleted,
    generatedLinesExcluded: r.generatedLinesExcluded,
  }));
}

// Mirror the worker's commitStats build (overview.ts): commit stats are the
// cross-repo SUM of the latest per-repo momentum snapshot. Deriving it from the
// same array means the demo can never drift from `usage.momentum` the way a
// hand-set object would (net lines here == lines-added minus lines-removed on
// the tiles). `commitsFromSessions` is an independent leg (session ship deltas).
function commitStatsFromMomentum(
  momentum: RepoMomentum[],
  commitsFromSessions: number,
): CommitStats {
  return {
    windowDays: momentum.reduce((max, m) => Math.max(max, m.windowDays), 0),
    commits: momentum.reduce((s, m) => s + m.commits, 0),
    filesTouched: momentum.reduce((s, m) => s + m.filesTouched, 0),
    linesAdded: momentum.reduce((s, m) => s + m.linesAdded, 0),
    linesDeleted: momentum.reduce((s, m) => s + m.linesDeleted, 0),
    generatedLinesExcluded: momentum.reduce((s, m) => s + m.generatedLinesExcluded, 0),
    commitsFromSessions,
  };
}

function buildPortfolio(): PortfolioMomentum {
  const repos: RepoTemperature[] = DEMO_REPOS.map((r) => ({
    repoId: r.repoId,
    repoLabel: r.repoLabel,
    gitContext: 'clean',
    temperature: r.temperature,
    quietDays: r.quietDays,
    commits: r.commits,
    filesTouched: r.filesTouched,
    netLines: r.linesAdded - r.linesDeleted,
    generatedLinesExcluded: r.generatedLinesExcluded,
    baseline: r.baseline,
  }));
  const reposMoved = repos.filter((r) => r.temperature !== 'quiet').length;
  return {
    windowDays: 7,
    reposTotal: repos.length,
    reposMoved,
    reposQuiet: repos.length - reposMoved,
    repos,
  };
}

// How ended sessions ended — coarse LIFECYCLE, not completion. Demo populates a
// believable distribution over the six real Claude Code SessionEnd reasons.
function buildEndReasons(): EndReasonCount[] {
  return [
    { reason: 'clear', count: 38 },
    { reason: 'resume', count: 11 },
    { reason: 'logout', count: 4 },
    { reason: 'other', count: 2 },
  ];
}

// "How sessions ended, day by day" (DEMO ONLY) — a per-day reason mix over the
// window, weekday-weighted so the trend reads like a real working rhythm. Days
// with no ends are OMITTED (honest-empty: no zero-filled spine), mostly cleared
// with a few resume/logout/other, mirroring the point-in-time ring. The LIVE path
// derives this from the event log's session.end rows, honest-empty until ends land.
function buildEndReasonsByDay(periodDays: number): DailyEndReasons[] {
  const out: DailyEndReasons[] = [];
  buildDaySpine(periodDays).forEach((day, i) => {
    const ended = Math.round(wobble(i * 7 + 3, 5, 2) * weekdayWeight(day));
    if (ended === 0) return; // no ends that day → omit (honest-empty)
    const clear = Math.max(1, Math.round(ended * 0.7));
    const resume = Math.round(ended * 0.2);
    const rest = Math.max(0, ended - clear - resume);
    const reasons: EndReasonCount[] = [{ reason: 'clear', count: clear }];
    if (resume > 0) reasons.push({ reason: 'resume', count: resume });
    if (rest > 0) reasons.push({ reason: i % 3 === 0 ? 'logout' : 'other', count: rest });
    out.push({ day, reasons });
  });
  return out;
}

// "How sessions ended, by hour" (DEMO ONLY) — a per-hour reason mix humped on
// late-afternoon/evening wrap-ups. Hours with no ends are OMITTED (honest-empty,
// no zero-filled 24-spine). A CADENCE lens, never an effectiveness grade. The LIVE
// path derives this from the event log's session.end UTC hours.
function buildEndReasonsByHour(): HourlyEndReasons[] {
  const out: HourlyEndReasons[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const hump = Math.max(0, 1 - Math.abs(hour - 15) / 8);
    const ended = Math.round(wobble(hour + 50, 4, 2) * hump);
    if (ended === 0) continue;
    const clear = Math.max(1, Math.round(ended * 0.7));
    const rest = Math.max(0, ended - clear);
    const reasons: EndReasonCount[] = [{ reason: 'clear', count: clear }];
    if (rest > 0) reasons.push({ reason: hour % 2 ? 'resume' : 'logout', count: rest });
    out.push({ hour, reasons });
  }
  return out;
}

function buildByAgent(live: SessionSummary[], windowSessions: number, windowCost: number): AgentRollup[] {
  const agents = new Map<string, AgentRollup>();
  for (const s of live) {
    const existing = agents.get(s.agent);
    if (existing) {
      existing.sessions += 1;
      existing.activeSessions += s.status === 'ended' ? 0 : 1;
      existing.toolCalls += s.toolCallCount;
      existing.tokensTotal += s.tokens.total;
      if (s.costUsd != null) {
        existing.costUsd = (existing.costUsd ?? 0) + s.costUsd;
      }
      if (s.lastEventAt > existing.lastEventAt) existing.lastEventAt = s.lastEventAt;
    } else {
      agents.set(s.agent, {
        agent: s.agent,
        sessions: 1,
        activeSessions: s.status === 'ended' ? 0 : 1,
        toolCalls: s.toolCallCount,
        tokensTotal: s.tokens.total,
        costUsd: s.costUsd,
        // Demo edit-line volume: Claude carries the window history; Codex still
        // has fair edit lines (Appendix A) even when its live row is thinner.
        lines: null,
        lastEventAt: s.lastEventAt,
        capabilities: resolveCapabilities(s.agent),
        erroredPresent: false,
      });
    }
  }
  // Window history is Claude-shaped (daily trends carry cost). Fold the prior
  // window onto the Claude row only — never invent Codex history in trends.
  const claude = agents.get('claude-code');
  if (claude) {
    const liveClaudeSessions = claude.sessions;
    claude.sessions = Math.max(claude.sessions, windowSessions - (live.length - liveClaudeSessions));
    // Claude carries the window's cost MINUS Codex's window share so the two
    // agent rows sum to the headline above them.
    claude.costUsd = windowCost - (agents.has('codex') ? CODEX_DEMO_COST : 0);
    claude.lines = { added: Math.round(windowSessions * 42), removed: Math.round(windowSessions * 11) };
  }
  const codex = agents.get('codex');
  if (codex) {
    codex.lines = {
      added: Math.max(40, Math.round(codex.toolCalls * 1.8)),
      removed: Math.max(8, Math.round(codex.toolCalls * 0.4)),
    };
    codex.tokensTotal = CODEX_DEMO_MODELS.reduce((s, m) => s + m.tokensTotal, 0);
    // Codex prices via session.tokens — agent row = sum of its model rows.
    codex.costUsd = CODEX_DEMO_COST;
    // Fixture CONSUMES the shipped contract — never hand-authors a parallel one.
    codex.capabilities = { ...CAPABILITY_REGISTRY.codex };
    // Record asymmetry: Codex tailer started after Claude hooks (compare disclosure).
    codex.firstSeenAt = new Date(Date.now() - CODEX_RECORD_DAYS * 86_400_000).toISOString();
    // Partial error leg: Codex only sees results on Shell calls (~44% coverage).
    codex.erroredPresent = true;
    codex.errorRate = errorLeg(codex.toolCalls, 0.44, 0.036);
  }
  if (claude) {
    claude.capabilities = { ...CAPABILITY_REGISTRY['claude-code'] };
    claude.erroredPresent = true;
    claude.errorRate = errorLeg(claude.toolCalls, 1, 0.052);
    claude.firstSeenAt = new Date(Date.now() - CLAUDE_RECORD_DAYS * 86_400_000).toISOString();
  }
  return [...agents.values()].sort((a, b) => b.toolCalls - a.toolCalls);
}

/**
 * An error leg that RECONCILES with the agent's own tool-call count, because a demo whose
 * numbers do not add up teaches the reader to distrust the real one. `calls` is exactly the
 * `toolCalls` rendered one row above it, `returned` is the share the tool could observe,
 * and `rate` is exactly errored/returned rather than a separately-invented percentage.
 */
function errorLeg(
  toolCalls: number,
  coverage: number,
  errorShare: number,
): AgentRollup['errorRate'] {
  const returned = Math.round(toolCalls * coverage);
  const errored = Math.round(returned * errorShare);
  return {
    rate: returned === 0 ? null : errored / returned,
    errored,
    returned,
    calls: toolCalls,
  };
}

/**
 * Per-agent OUTCOMES from git (DEMO ONLY) — what each agent's landed work actually did.
 * The LIVE path derives this from commit-attributed `session.linesurvival` rows; it is
 * honest-empty until those accrue.
 *
 * These numbers RECONCILE against the global `outcomes.lineSurvival` above on purpose,
 * because the surface lets you read them side by side and a demo that does not add up
 * teaches the reader to distrust the real one:
 *
 *   global   15 sessions rated · 1,840 authored · 1,546 surviving · 44 commits
 *   claude   10 sessions       · 1,180          · 1,010           · 31
 *   codex     3 sessions       ·   520          ·   402           ·  9
 *   unusable  2 sessions       ·   140          ·   134           ·  4   → agentOutcomesUnusable
 *
 * The last row is the point of `agentOutcomesUnusable`: those rows predate git attribution,
 * so they can be summed globally but CANNOT be split per agent. The compare is over a
 * subset, and it says so.
 *
 * The demo deliberately shows the three honesty modes the panel exists for:
 *   - Codex clears the n-floor, so BOTH rates render (what build week looks like);
 *   - Codex cost legs are priced (session.tokens) — never a fake $0;
 *   - both agents disclose their COVERAGE, and the coverage is COMPARABLE, which is the
 *     only thing that licenses putting the two rates next to each other.
 */
function buildAgentOutcomes(): AgentOutcomeRollup[] {
  return [
    {
      agent: 'claude-code',
      linesAuthored: 1180,
      linesSurviving: 1010,
      survivalRate: 1010 / 1180,
      commits: 31,
      sessionsRated: 10,
      ratedCostUsd: 40.4,
      costPerSurvivingLine: 40.4 / 1010,
      unreachableSessions: 2,
      unknownSessions: 0,
      filesGoneFromTip: 7,
      coverage: {
        linesInCommits: 1880,
        linesAuthored: 1180,
        linesOtherAgents: 140,
        linesContested: 0,
        linesUnattributed: 560,
      },
    },
    {
      agent: 'codex',
      linesAuthored: 520,
      linesSurviving: 402,
      survivalRate: 402 / 520,
      commits: 9,
      sessionsRated: 3,
      // Priced via session.tokens — same dollars as the Codex model rows.
      ratedCostUsd: CODEX_DEMO_COST,
      costPerSurvivingLine: CODEX_DEMO_COST / 402,
      unreachableSessions: 0,
      unknownSessions: 0,
      filesGoneFromTip: 1,
      coverage: {
        linesInCommits: 760,
        linesAuthored: 520,
        linesOtherAgents: 90,
        linesContested: 0,
        linesUnattributed: 150,
      },
    },
  ];
}

/**
 * Codex's demo model rows. Shared so byAgent's tokensTotal and agentModels always agree.
 * Priced at the shipped table's rates (types/pricing.ts).
 */
const CODEX_DEMO_MODELS: ReadonlyArray<Omit<AgentModelRollup, 'agent'>> = [
  // 1.674M in ($8.37) + 146K out ($4.37) + 1.674M cached ($0.84)
  { model: 'gpt-5.5', calls: 96, tokensTotal: 1_820_000, costUsd: 13.58 },
  // 221K in ($0.17) + 19K out ($0.09) + 221K cached ($0.02)
  { model: 'gpt-5.4-mini', calls: 31, tokensTotal: 240_000, costUsd: 0.28 },
];

/** What the two Codex model rows above cost — agent row and model rows stay locked. */
const CODEX_DEMO_COST = CODEX_DEMO_MODELS.reduce((s, m) => s + (m.costUsd ?? 0), 0);

/**
 * How far back each tool's record actually goes, in days. Not decoration: the GAP between
 * them is what draws the record rail in the When panel, and the gap is real. Claude has been
 * hooked since the collector shipped; the Codex tailer went live far later.
 *
 * The shape is what matters (one record spans a 30-day window and one plainly does not), not
 * the exact figures. Codex sits at 6 rather than the 1 the live log currently shows, because
 * a demo has a second job the live path does not: every widget has to reach a POPULATED
 * state. At 1 day the Codex bars collapse to a single sliver and the charts stop
 * demonstrating anything, while the honest fact the rail exists to show, that one record is
 * a fraction of the other, reads exactly the same at 6.
 */
const CLAUDE_RECORD_DAYS = 38;
const CODEX_RECORD_DAYS = 6;

// Per-(agent, model) split. Claude mirrors buildByModel's families/shares so the
// two panels tell one story; Codex rides CODEX_DEMO_MODELS (priced).
function buildAgentModels(claudeCalls: number, claudeCost: number): AgentModelRollup[] {
  const claude = buildByModel(claudeCalls, claudeCost).map((m) => ({
    agent: 'claude-code',
    model: m.model,
    calls: m.calls,
    tokensTotal: m.tokensTotal,
    costUsd: m.costUsd,
  }));
  const codex = CODEX_DEMO_MODELS.map((m) => ({ agent: 'codex', ...m }));
  return [...claude, ...codex];
}

// Per-agent daily series. The per-day TOTAL reuses buildDailyTrends' exact
// formula, then splits: Codex takes 0-2 sessions on roughly half the days
// (a second tool you reach for sometimes), Claude carries the rest — so the
// Agents history chart sums to the Overview trend beside it.
function buildAgentDaily(periodDays: number): AgentDailyPoint[] {
  const out: AgentDailyPoint[] = [];
  // NEITHER agent gets a daily point before its own record starts, and this is load-bearing
  // rather than cosmetic. The When panel draws a record rail directly above these bars, so a
  // fixture that rails "Codex from day 24" while drawing Codex bars from day 1 is a demo
  // contradicting itself in a single glance. Claude needs the same gate even though it looks
  // unnecessary at 30 days: its record is 38 days, so at the 90-DAY range it too has a
  // pre-record stretch, and ungated it drew bars across the whole spine while its own rail
  // said the record began halfway in. A fixture is a contract CONSUMER, and the contract here
  // is that an unwatched day and an idle day are not the same fact.
  const watchedFrom: Record<string, number> = {
    'claude-code': Math.max(0, periodDays - CLAUDE_RECORD_DAYS),
    codex: Math.max(0, periodDays - CODEX_RECORD_DAYS),
  };
  buildDaySpine(periodDays).forEach((day, i) => {
    const weight = weekdayWeight(day);
    const total = Math.round(wobble(i * 3 + 11, 6, 3) * weight);
    if (total === 0) return;
    const codexSessions =
      i >= watchedFrom.codex && hash(i * 7 + 3) > 0.55
        ? Math.min(total, 1 + Math.round(hash(i * 11 + 5)))
        : 0;
    const claudeSessions = i >= watchedFrom['claude-code'] ? total - codexSessions : 0;
    if (claudeSessions > 0) {
      out.push({
        agent: 'claude-code',
        day,
        sessions: claudeSessions,
        lines: {
          added: claudeSessions * wobble(i * 13 + 17, 180, 90, 20),
          removed: claudeSessions * wobble(i * 17 + 23, 45, 25, 4),
        },
      });
    }
    if (codexSessions > 0) {
      out.push({
        agent: 'codex',
        day,
        sessions: codexSessions,
        lines: {
          added: codexSessions * wobble(i * 19 + 29, 110, 60, 12),
          removed: codexSessions * wobble(i * 23 + 31, 26, 14, 2),
        },
      });
    }
  });
  return out;
}

// Per-agent UTC clock-hour activity. Claude spreads over the working-hours hump
// (mirroring buildHourlyDistribution); Codex concentrates late — a real cadence
// gap for the fit sentence to speak, matching the late-hour codex live seeds.
function buildAgentHourly(): AgentHourPoint[] {
  const out: AgentHourPoint[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const workHump = Math.max(0, 1 - Math.abs(hour - 14) / 9);
    const claude = Math.round(wobble(hour + 300, 90, 45) * workHump);
    if (claude > 0) out.push({ agent: 'claude-code', hour, calls: claude });
    const lateHump = Math.max(0, 1 - Math.abs(hour - 21) / 3);
    const codex = Math.round(wobble(hour + 400, 40, 18) * lateHump);
    if (codex > 0) out.push({ agent: 'codex', hour, calls: codex });
  }
  return out.sort((a, b) => a.agent.localeCompare(b.agent) || a.hour - b.hour);
}

export function createBaselineOverview(rangeDays = DEFAULT_PERIOD_DAYS): OverviewSnapshot {
  const nowMs = Date.now();
  const live = SEEDS.map(buildSession);
  const claudeLive = live.filter((s) => s.agent === 'claude-code');
  const totalCost = Math.round(claudeLive.reduce((s, x) => s + (x.costUsd ?? 0), 0) * 100) / 100;
  const totalCalls = live.reduce((s, x) => s + x.toolCallCount, 0);
  // byTool vocabulary is Claude-only; do not inflate Claude tool shares with Codex calls.
  const claudeLiveCalls = claudeLive.reduce((s, x) => s + x.toolCallCount, 0);

  const dailyTrends = buildDailyTrends(rangeDays);
  const endReasons = buildEndReasons();
  const endedCount = endReasons.reduce((s, r) => s + r.count, 0);
  const stuckIds = live.filter((x) => x.status === 'stuck').map((x) => x.sessionId);
  // Aggregate window totals lean on the synthetic history, not just the live
  // board, so the demo reads like a real account with prior sessions.
  const windowSessions = dailyTrends.reduce((s, d) => s + d.sessions, 0) + live.length;
  const windowCost =
    Math.round(
      (dailyTrends.reduce((s, d) => s + (d.costUsd ?? 0), 0) + totalCost) * 100,
    ) / 100;
  const historyCalls = Math.round(windowSessions * 24);
  const windowCalls = totalCalls + historyCalls;
  const claudeWindowCalls = claudeLiveCalls + historyCalls;

  // One momentum array feeds BOTH the per-repo board (`usage.momentum`) and the
  // summed `codebase.commitStats`, exactly as the worker derives them, so the
  // git-count tiles reconcile (net == added minus removed).
  const momentum = buildMomentum();

  return {
    generatedAt: new Date().toISOString(),
    rangeDays,
    // Demo shows the product unclamped: the fixture is illustrating what Seorak
    // reads, not which plan a visitor is on.
    maxRangeDays: WIDEST_OVERVIEW_RANGE_DAYS,
    thresholds: DEFAULT_THRESHOLDS,
    usageAllowances: [],
    live,
    usage: {
      totals: {
        sessions: windowSessions,
        toolCalls: windowCalls,
        // A believable prior window so the Sessions delta pill renders in demo mode
        // (current = the window's session count, previous a touch lower).
        sessionsDelta: { current: windowSessions, previous: Math.round(windowSessions * 0.75) },
      },
      cost: {
        totalUsd: windowCost,
        // Both agents can price (CAPABILITY_REGISTRY); coverage is the full window.
        sessionsWithCost: windowSessions,
        // A believable prior window so the delta pill renders in demo mode.
        delta: { current: windowCost, previous: Math.round(windowCost * 0.82 * 100) / 100 },
      },
      // Edit-tool line delta (collector on-machine derivation). Scaled off the
      // window's edit-family call share so the demo numbers hang together.
      lines: {
        added: Math.round(windowCalls * 1.9),
        removed: Math.round(windowCalls * 0.7),
        delta: {
          current: Math.round(windowCalls * 1.9),
          previous: Math.round(windowCalls * 1.9 * 0.78),
        },
      },
      dailyTrends,
      projects: buildDemoProjects(live, rangeDays),
      // Cross-repo momentum: a populated board so the hero demonstrates breadth +
      // temperature. The LIVE path derives both from the git.momentum history.
      momentum,
      portfolio: buildPortfolio(),
      cacheReuseRatio: 0.62,
      costPerEdit: Math.round((windowCost / Math.max(1, claudeWindowCalls * 0.35)) * 100) / 100,
    },
    // The file/directory axis — believable labeled rows so the demo shows the
    // opted-in shape (live data renders salted ids until the labels opt-in).
    codebase: {
      // 14 files on purpose: past the detail's FILE_CAP fold, so the demo
      // exercises the ranked-list "+N more" residue (the overflow protocol).
      files: [
        { fileId: 'f1'.repeat(32), label: 'overview.ts', edits: 14, linesAdded: 220, linesRemoved: 96, sessions: 4 },
        { fileId: 'f2'.repeat(32), label: 'sessions.ts', edits: 9, linesAdded: 130, linesRemoved: 41, sessions: 3 },
        { fileId: 'f3'.repeat(32), label: 'api.ts', edits: 6, linesAdded: 58, linesRemoved: 22, sessions: 2 },
        { fileId: 'f4'.repeat(32), label: 'App.tsx', edits: 4, linesAdded: 36, linesRemoved: 12, sessions: 1 },
        { fileId: 'f5'.repeat(32), label: 'SeorakTabBar.tsx', edits: 4, linesAdded: 30, linesRemoved: 10, sessions: 2 },
        { fileId: 'f6'.repeat(32), label: 'router.ts', edits: 3, linesAdded: 28, linesRemoved: 14, sessions: 2 },
        { fileId: 'f7'.repeat(32), label: 'types.ts', edits: 3, linesAdded: 18, linesRemoved: 6, sessions: 1 },
        { fileId: 'f8'.repeat(32), label: 'utils.ts', edits: 2, linesAdded: 22, linesRemoved: 9, sessions: 2 },
        { fileId: 'f9'.repeat(32), label: 'client.ts', edits: 2, linesAdded: 14, linesRemoved: 4, sessions: 1 },
        { fileId: 'fa'.repeat(32), label: 'useOverview.ts', edits: 2, linesAdded: 11, linesRemoved: 3, sessions: 1 },
        { fileId: 'fb'.repeat(32), label: 'theme.ts', edits: 1, linesAdded: 9, linesRemoved: 2, sessions: 1 },
        { fileId: 'fc'.repeat(32), label: 'format.ts', edits: 1, linesAdded: 7, linesRemoved: 5, sessions: 1 },
        { fileId: 'fd'.repeat(32), label: 'icons.tsx', edits: 1, linesAdded: 6, linesRemoved: 1, sessions: 1 },
        { fileId: 'fe'.repeat(32), label: 'config.ts', edits: 1, linesAdded: 4, linesRemoved: 2, sessions: 1 },
      ],
      directories: [
        { dirId: 'd1'.repeat(32), label: 'worker', edits: 19, share: 0.46 },
        { dirId: 'd2'.repeat(32), label: 'web', edits: 13, share: 0.32 },
        { dirId: 'd3'.repeat(32), label: 'collector', edits: 9, share: 0.22 },
      ],
      rework: [
        { fileId: 'f1'.repeat(32), label: 'overview.ts', sessions: 4, edits: 14 },
        { fileId: 'f2'.repeat(32), label: 'sessions.ts', sessions: 3, edits: 9 },
      ],
      commitStats: commitStatsFromMomentum(momentum, 17),
      filesInPlay: {
        distinctFiles: 11,
        files: [
          {
            fileId: 'f1'.repeat(32),
            label: 'overview.ts',
            category: 'source',
            edits: 5,
            lastEditedAt: new Date(nowMs).toISOString(),
            projects: [{ repoId: 'repo-seorak', project: 'seorak', edits: 5, sessions: 1 }],
          },
          {
            fileId: 'f3'.repeat(32),
            label: 'overview.test.ts',
            category: 'test',
            edits: 2,
            lastEditedAt: new Date(nowMs).toISOString(),
            projects: [{ repoId: 'repo-seorak', project: 'seorak', edits: 2, sessions: 1 }],
          },
          {
            fileId: 'f5'.repeat(32),
            label: 'tokens.css',
            category: 'styles',
            edits: 1,
            lastEditedAt: new Date(nowMs).toISOString(),
            projects: [{ repoId: 'repo-seorak', project: 'seorak', edits: 1, sessions: 1 }],
          },
          {
            fileId: 'f7'.repeat(32),
            label: 'wrangler.toml',
            category: 'config',
            edits: 1,
            lastEditedAt: new Date(nowMs).toISOString(),
            projects: [{ repoId: 'repo-seorak', project: 'seorak', edits: 1, sessions: 1 }],
          },
          {
            fileId: 'f9'.repeat(32),
            label: 'README.md',
            category: 'docs',
            edits: 1,
            lastEditedAt: new Date(nowMs).toISOString(),
            projects: [{ repoId: 'repo-seorak', project: 'seorak', edits: 1, sessions: 1 }],
          },
          {
            fileId: 'fb'.repeat(32),
            label: 'seed.sql',
            category: 'data',
            edits: 1,
            lastEditedAt: new Date(nowMs).toISOString(),
            projects: [{ repoId: 'repo-seorak', project: 'seorak', edits: 1, sessions: 1 }],
          },
          {
            fileId: 'fe'.repeat(32),
            label: 'exporter.ts',
            category: 'source',
            edits: 3,
            lastEditedAt: new Date(nowMs - 2 * 60_000).toISOString(),
            projects: [{ repoId: 'repo-feather', project: 'feather', edits: 3, sessions: 1 }],
          },
          {
            fileId: 'ff'.repeat(32),
            label: 'sync.test.ts',
            category: 'test',
            edits: 2,
            lastEditedAt: new Date(nowMs - 5 * 60_000).toISOString(),
            projects: [{ repoId: 'repo-feather', project: 'feather', edits: 2, sessions: 1 }],
          },
          {
            fileId: 'a1'.repeat(32),
            label: 'router.ts',
            category: 'source',
            edits: 2,
            lastEditedAt: new Date(nowMs - 1 * 60_000).toISOString(),
            projects: [{ repoId: 'repo-seorak', project: 'seorak', edits: 2, sessions: 1 }],
          },
          {
            fileId: 'a3'.repeat(32),
            label: 'utils.ts',
            category: 'source',
            edits: 1,
            lastEditedAt: new Date(nowMs - 3 * 60_000).toISOString(),
            projects: [{ repoId: 'repo-seorak', project: 'seorak', edits: 1, sessions: 1 }],
          },
          {
            fileId: 'a5'.repeat(32),
            label: 'client.ts',
            category: 'source',
            edits: 1,
            lastEditedAt: new Date(nowMs - 4 * 60_000).toISOString(),
            projects: [{ repoId: 'repo-feather', project: 'feather', edits: 1, sessions: 1 }],
          },
        ],
      },
    },
    outcomes: {
      endReasons,
      activeCount: live.filter((x) => x.status !== 'ended').length,
      endedCount,
      stuckness: {
        rate: Math.round((stuckIds.length / Math.max(1, live.length)) * 100) / 100,
        stuckCount: stuckIds.length,
        // The same denominator the rate above divides by, so the demo exercises
        // the shipped shape rather than a convenient one.
        inFlight: live.filter((x) => x.status !== 'ended').length,
        stuckSessionIds: stuckIds,
      },
      // "How sessions ended, day by day" — the LIVE path derives this from the
      // event log's session.end rows, honest-empty until ends accrue.
      endReasonsByDay: buildEndReasonsByDay(rangeDays),
      oneShotRate: 0.41,
      shipRate: 0.68,
      // On-branch line-survival (DEMO ONLY): line-level rate over rated
      // (retained+overwritten) sessions, floored at >=3 commits. The LIVE path
      // derives this from session.linesurvival, honest-empty until checks accrue.
      lineSurvival: {
        rate: 0.84,
        linesAuthored: 1840,
        linesSurviving: 1546,
        commitsChecked: 44,
        sessionsRated: 15,
        retained: 12,
        overwritten: 3,
        unreachable: 2,
        unknown: 0,
      },
      // Per-session "outcome pending → fate" card (DEMO ONLY): recent ended sessions,
      // a couple still maturing (pending), the rest resolved to a neutral fate. The
      // LIVE path joins ended sessions to their session.linesurvival fate, honest-
      // empty until those land. Never a fabricated verdict.
      bySession: [
        { sessionId: 'demo-o1', project: 'seorak', repoId: 'repo-seorak', endedAt: new Date(nowMs - 0.4 * 86_400_000).toISOString(), status: 'pending' },
        { sessionId: 'demo-o2', project: 'mobile-surfaces', repoId: 'repo-mobile-surfaces', endedAt: new Date(nowMs - 1.6 * 86_400_000).toISOString(), status: 'pending' },
        { sessionId: 'demo-o3', project: 'seorak', repoId: 'repo-seorak', endedAt: new Date(nowMs - 4 * 86_400_000).toISOString(), status: 'retained' },
        { sessionId: 'demo-o4', project: 'feather', repoId: 'repo-feather', endedAt: new Date(nowMs - 4.8 * 86_400_000).toISOString(), status: 'retained' },
        { sessionId: 'demo-o7', project: 'portfolio-site', repoId: 'demo-port', endedAt: new Date(nowMs - 5 * 86_400_000).toISOString(), status: 'overwritten' },
        { sessionId: 'demo-o5', project: 'mobile-surfaces', repoId: 'repo-mobile-surfaces', endedAt: new Date(nowMs - 6 * 86_400_000).toISOString(), status: 'retained' },
        { sessionId: 'demo-o6', project: 'notes-cli', repoId: 'demo-notes', endedAt: new Date(nowMs - 7 * 86_400_000).toISOString(), status: 'unreachable' },
      ],
    },
    activity: {
      hourlyDistribution: buildHourlyDistribution(),
      // Per-agent UTC clock-hour activity — Codex concentrated late, Claude wide.
      agentHourly: buildAgentHourly(),
      // "How sessions ended, by hour" — LIVE derives from session.end UTC hours.
      endReasonsByHour: buildEndReasonsByHour(),
    },
    tools: {
      // Claude vocabulary only — Codex Shell/ApplyPatch must not dilute byTool shares.
      byTool: buildByTool(claudeWindowCalls),
      callStats: { totalCalls: windowCalls, errorRate: 0.07 },
      // Claude-only byModel uses Claude's share of the window (not the full
      // headline) so Models + byAgent never disagree by Codex's carve-out.
      byModel: buildByModel(claudeWindowCalls, Math.max(0, windowCost - (live.some((s) => s.agent === 'codex') ? CODEX_DEMO_COST : 0))),
      // Dual-agent: Claude + Codex, both capability-shaped (tokens/cost estimated).
      byAgent: buildByAgent(live, windowSessions, windowCost),
      // Per-agent OUTCOMES from git — the head-to-head. Reconciles against
      // outcomes.lineSurvival above; see buildAgentOutcomes.
      agentOutcomes: buildAgentOutcomes(),
      agentOutcomesUnusable: 2,
      // Per-agent daily series + model split (Agents Tier 1).
      agentDaily: buildAgentDaily(rangeDays),
      agentModels: buildAgentModels(
        claudeWindowCalls,
        Math.max(0, windowCost - (live.some((s) => s.agent === 'codex') ? CODEX_DEMO_COST : 0)),
      ),
      verification: [
        { kind: 'test', passRate: 0.85, runs: 34, passed: 29 },
        { kind: 'typecheck', passRate: 0.96, runs: 22, passed: 21 },
        { kind: 'lint', passRate: 0.78, runs: 18, passed: 14 },
        { kind: 'build', passRate: 0.92, runs: 12, passed: 11 },
      ],
    },
  };
}

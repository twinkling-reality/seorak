// Per-repo project rollups for the demo (DEMO ONLY).
import type {
  SessionSummary,
  ProjectRollup,
  AgentDailyPoint,
  AgentHourPoint,
  AgentModelRollup,
  AgentOutcomeRollup,
} from '@seorak/types';
import { AGENT_SURVIVAL_FLOOR, resolveCapabilities } from '@seorak/types';
import { hash } from '../rng.js';
import { buildByTool, buildByModel, buildHourlyDistribution } from './usage.js';

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
    tokensTotal: Math.max(0, a.tokensTotal),
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

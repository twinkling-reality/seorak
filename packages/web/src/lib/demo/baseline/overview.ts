// Assembles the baseline demo OverviewSnapshot from domain builders.
//
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

import type { OverviewSnapshot } from '@seorak/types';
import { DEFAULT_THRESHOLDS, WIDEST_OVERVIEW_RANGE_DAYS } from '@seorak/types';
import { DEFAULT_PERIOD_DAYS, buildLiveSessions } from './sessions.js';
import { buildDemoProjects } from './projects.js';
import {
  buildDailyTrends,
  buildHourlyDistribution,
  buildByTool,
  buildByModel,
  buildEndReasons,
  buildEndReasonsByDay,
  buildEndReasonsByHour,
} from './usage.js';
import {
  buildMomentum,
  buildPortfolio,
  commitStatsFromMomentum,
} from './codebase.js';
import {
  CODEX_DEMO_COST,
  buildByAgent,
  buildAgentOutcomes,
  buildAgentModels,
  buildAgentDaily,
  buildAgentHourly,
} from './agents.js';

export function createBaselineOverview(rangeDays = DEFAULT_PERIOD_DAYS): OverviewSnapshot {
  const nowMs = Date.now();
  const live = buildLiveSessions();
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

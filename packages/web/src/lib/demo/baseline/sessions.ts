// Live demo session seeds and builders.
import type { SessionSummary } from '@seorak/types';
import { wobble } from '../rng.js';

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

/** Build the demo live board from the fixed seed table. */
export function buildLiveSessions(): SessionSummary[] {
  return SEEDS.map(buildSession);
}

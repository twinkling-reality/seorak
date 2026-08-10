/**
 * Shared builders for the verdict tests. One copy, because a fixture that drifted
 * between the matrix test and the outcomes test would let the two panels disagree
 * about the same agent while both stayed green.
 */
import { resolveCapabilities, type ResolvedSessionCapabilities } from '@seorak/types';

import type {
  AgentHourPoint,
  AgentModelRollup,
  AgentOutcomeRollup,
  AgentRollup,
  ModelRollup,
  ProjectRollup,
} from '../../../../lib/apiSchemas.js';
import { getToolMeta } from '../../../../lib/toolMeta.js';
import type { AgentsNarrative } from '../notes.js';

export function agent(
  id: string,
  partial: Partial<AgentRollup> & Pick<AgentRollup, 'sessions' | 'toolCalls'>,
): AgentRollup {
  return {
    agent: id,
    activeSessions: 0,
    tokensTotal: 0,
    costUsd: null,
    lines: null,
    lastEventAt: '2026-07-11T00:00:00.000Z',
    capabilities: resolveCapabilities(id),
    erroredPresent: false,
    ...partial,
  };
}

export function model(id: string, partial: Partial<ModelRollup>): ModelRollup {
  return { model: id, calls: 0, tokensTotal: 0, costUsd: null, ...partial };
}

export function hourPoint(agentId: string, hour: number, calls: number): AgentHourPoint {
  return { agent: agentId, hour, calls };
}

export function agentModel(
  agentId: string,
  modelId: string,
  tokensTotal: number,
): AgentModelRollup {
  return { agent: agentId, model: modelId, calls: 1, tokensTotal, costUsd: null };
}

export function outcome(
  id: string,
  partial: Partial<AgentOutcomeRollup> &
    Pick<AgentOutcomeRollup, 'linesAuthored' | 'linesSurviving'>,
): AgentOutcomeRollup {
  const authored = partial.linesAuthored;
  return {
    agent: id,
    survivalRate: authored > 0 ? partial.linesSurviving / authored : null,
    commits: 10,
    sessionsRated: 4,
    ratedCostUsd: null,
    costPerSurvivingLine: null,
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
    ...partial,
  };
}

/** An outcome whose commits Seorak could only partly trace. */
export function withTrace(o: AgentOutcomeRollup, share: number): AgentOutcomeRollup {
  const total = Math.round(o.linesAuthored / share);
  return {
    ...o,
    coverage: { ...o.coverage, linesInCommits: total, linesUnattributed: total - o.linesAuthored },
  };
}

/** Flatten the segment stream to the sentence a reader would see. */
export function readOut(n: AgentsNarrative): string {
  return n.segments
    .map((s) => {
      if (s.type === 'text') return s.text;
      if (s.type === 'agent') return getToolMeta(s.agentId).label;
      return s.term;
    })
    .join('');
}

export function noteById(n: AgentsNarrative, id: string) {
  return n.notes.find((note) => note.id === id);
}

export const TWO_PROJECTS = [
  {
    project: 'seorak',
    repoId: 'r-1',
    byAgent: [
      agent('claude-code', { sessions: 2, toolCalls: 4, lines: { added: 20, removed: 2 } }),
      agent('codex', { sessions: 1, toolCalls: 2, lines: { added: 3, removed: 1 } }),
    ],
  },
  {
    project: 'chinmeister',
    repoId: 'r-2',
    byAgent: [
      agent('claude-code', { sessions: 1, toolCalls: 1, lines: { added: 5, removed: 0 } }),
    ],
  },
] as ProjectRollup[];

export const TWO_AGENTS = [
  agent('claude-code', { sessions: 8, toolCalls: 400, lines: { added: 900, removed: 200 } }),
  agent('codex', { sessions: 3, toolCalls: 120, lines: { added: 300, removed: 60 } }),
];

export const CLAUDE_CAPS: ResolvedSessionCapabilities = {
  hasTokens: true,
  hasCacheTokens: true,
  cost: 'estimated',
  toolResult: 'both',
  endReason: true,
  duration: 'measured',
  verification: 'both',
  costScope: 'call',
  usageWindow: 'count',
};

export const CODEX_CAPS: ResolvedSessionCapabilities = {
  hasTokens: false,
  hasCacheTokens: false,
  cost: 'none',
  toolResult: 'both',
  endReason: false,
  duration: 'inferred',
  verification: 'none',
  costScope: 'session',
  usageWindow: 'ratio',
};

// agentsScope.ts — re-aggregate the Agents surface over a REPO SUBSET, client-side.
//
// The Agents page reads global per-agent series off `/overview` (tools.byAgent /
// agentOutcomes / agentModels / agentDaily + activity.agentHourly). Each of those
// ALSO rides every ProjectRollup, grouped by repo, carrying the COUNTS behind its
// rates (errored/returned, linesAuthored/surviving, ratedCostUsd, coverage legs …).
//
// So a repo filter needs no re-fetch and no per-selection server build: pick the
// selected projects, SUM their counts per agent, and recompute each rate as
// Σnumerator / Σdenominator. Summing counts (never averaging rates) is the only
// honest way to combine survival / error rates across repos — a repo with 3 rated
// lines and one with 3,000 must not weigh equally. Every floor and null-gate the
// worker applies is re-applied here over the summed counts, so a single-repo
// selection reproduces that repo's server-computed rollup exactly.
//
// The default "All projects" view does NOT come through here: it uses the global
// tools.* fields directly (which also cover sessions attributed to no repo). This
// module runs only for a STRICT repo subset.

import type {
  AgentCoverage,
  AgentDailyPoint,
  AgentHourPoint,
  AgentModelRollup,
  AgentOutcomeRollup,
  AgentRollup,
  ModelRollup,
  ProjectRollup,
  ResolvedSessionCapabilities,
} from '@seorak/types';
import { AGENT_SURVIVAL_FLOOR } from '@seorak/types';

/** The per-agent series the Agents page renders — the exact fields it reads today,
 *  just re-scoped to the selected repos. */
export interface AgentSeries {
  byAgent: AgentRollup[];
  agentOutcomes: AgentOutcomeRollup[];
  agentOutcomesUnusable: number;
  byModel: ModelRollup[];
  agentModels: AgentModelRollup[];
  agentDaily: AgentDailyPoint[];
  agentHourly: AgentHourPoint[];
}

/** Fold a nullable count into an accumulator that stays null until a real value
 *  arrives (honest-empty: "no source measured this", never a stand-in 0). */
function addNullable(acc: number | null, value: number | null | undefined): number | null {
  if (value == null) return acc;
  return (acc ?? 0) + value;
}

type Lines = { added: number; removed: number } | null;

function addLines(acc: Lines, value: Lines | undefined): Lines {
  if (value == null) return acc;
  if (acc == null) return { added: value.added, removed: value.removed };
  return { added: acc.added + value.added, removed: acc.removed + value.removed };
}

// ── byAgent (AgentRollup) ────────────────────────────────────────────────────

interface AgentAcc {
  agent: string;
  sessions: number;
  activeSessions: number;
  toolCalls: number;
  tokensTotal: number;
  costUsd: number | null;
  lines: Lines;
  lastEventAt: string;
  firstSeenAt?: string;
  capabilities: ResolvedSessionCapabilities;
  /** lastEventAt of the rollup we took `capabilities` from — capabilities resolve
   *  from the LATEST-active session, so keep the freshest across repos. */
  capsAt: string;
  erroredPresent: boolean;
  errored: number;
  returned: number;
  calls: number;
  /** Whether ANY selected repo carried this agent's errorRate (else omit it). */
  sawErrorRate: boolean;
}

function aggregateByAgent(perRepo: AgentRollup[][]): AgentRollup[] {
  const acc = new Map<string, AgentAcc>();
  for (const list of perRepo) {
    for (const a of list) {
      let e = acc.get(a.agent);
      if (e === undefined) {
        e = {
          agent: a.agent,
          sessions: 0,
          activeSessions: 0,
          toolCalls: 0,
          tokensTotal: 0,
          costUsd: null,
          lines: null,
          lastEventAt: a.lastEventAt,
          capabilities: a.capabilities,
          capsAt: a.lastEventAt,
          erroredPresent: false,
          errored: 0,
          returned: 0,
          calls: 0,
          sawErrorRate: false,
        };
        acc.set(a.agent, e);
      }
      e.sessions += a.sessions;
      e.activeSessions += a.activeSessions;
      e.toolCalls += a.toolCalls;
      e.tokensTotal += a.tokensTotal;
      e.costUsd = addNullable(e.costUsd, a.costUsd);
      e.lines = addLines(e.lines, a.lines);
      if (a.lastEventAt > e.lastEventAt) e.lastEventAt = a.lastEventAt;
      // firstSeenAt is whole-log (repo-independent), but take the earliest defensively.
      if (a.firstSeenAt && (e.firstSeenAt === undefined || a.firstSeenAt < e.firstSeenAt)) {
        e.firstSeenAt = a.firstSeenAt;
      }
      if (a.lastEventAt >= e.capsAt) {
        e.capabilities = a.capabilities;
        e.capsAt = a.lastEventAt;
      }
      if (a.erroredPresent) e.erroredPresent = true;
      if (a.errorRate) {
        e.sawErrorRate = true;
        e.errored += a.errorRate.errored;
        e.returned += a.errorRate.returned;
        e.calls += a.errorRate.calls;
      }
    }
  }
  return [...acc.values()].map((e) => ({
    agent: e.agent as AgentRollup['agent'],
    sessions: e.sessions,
    activeSessions: e.activeSessions,
    toolCalls: e.toolCalls,
    tokensTotal: e.tokensTotal,
    costUsd: e.costUsd,
    lines: e.lines,
    lastEventAt: e.lastEventAt,
    ...(e.firstSeenAt !== undefined ? { firstSeenAt: e.firstSeenAt } : {}),
    capabilities: e.capabilities,
    erroredPresent: e.erroredPresent,
    ...(e.sawErrorRate
      ? {
          errorRate: {
            errored: e.errored,
            returned: e.returned,
            calls: e.calls,
            // Recompute over SUMMED legs — null when no call returned (never 0).
            rate: e.returned > 0 ? e.errored / e.returned : null,
          },
        }
      : {}),
  }));
}

// ── agentOutcomes (AgentOutcomeRollup) ───────────────────────────────────────

interface OutcomeAcc {
  agent: string;
  linesAuthored: number;
  linesSurviving: number;
  commits: number;
  sessionsRated: number;
  ratedCostUsd: number | null;
  unreachableSessions: number;
  unknownSessions: number;
  filesGoneFromTip: number;
  coverage: AgentCoverage;
}

function zeroCoverage(): AgentCoverage {
  return {
    linesInCommits: 0,
    linesAuthored: 0,
    linesOtherAgents: 0,
    linesContested: 0,
    linesUnattributed: 0,
  };
}

function aggregateAgentOutcomes(perRepo: AgentOutcomeRollup[][]): AgentOutcomeRollup[] {
  const acc = new Map<string, OutcomeAcc>();
  for (const list of perRepo) {
    for (const o of list) {
      let e = acc.get(o.agent);
      if (e === undefined) {
        e = {
          agent: o.agent,
          linesAuthored: 0,
          linesSurviving: 0,
          commits: 0,
          sessionsRated: 0,
          ratedCostUsd: null,
          unreachableSessions: 0,
          unknownSessions: 0,
          filesGoneFromTip: 0,
          coverage: zeroCoverage(),
        };
        acc.set(o.agent, e);
      }
      e.linesAuthored += o.linesAuthored;
      e.linesSurviving += o.linesSurviving;
      // commits are deduped WITHIN a repo; a commit lives in exactly one repo, so the
      // per-repo counts are disjoint and sum cleanly across repos.
      e.commits += o.commits;
      e.sessionsRated += o.sessionsRated;
      e.ratedCostUsd = addNullable(e.ratedCostUsd, o.ratedCostUsd);
      e.unreachableSessions += o.unreachableSessions;
      e.unknownSessions += o.unknownSessions;
      e.filesGoneFromTip += o.filesGoneFromTip;
      e.coverage.linesInCommits += o.coverage.linesInCommits;
      e.coverage.linesAuthored += o.coverage.linesAuthored;
      e.coverage.linesOtherAgents += o.coverage.linesOtherAgents;
      e.coverage.linesContested += o.coverage.linesContested;
      e.coverage.linesUnattributed += o.coverage.linesUnattributed;
    }
  }
  return [...acc.values()].map((e) => {
    // Re-apply the SAME floor the worker uses (AGENT_SURVIVAL_FLOOR), now over the
    // combined counts: a subset that clears the floor gets a rate the individual
    // repos may each have been too small to earn. null below the floor / with no
    // authored lines — the counts still render beside it.
    const rateable =
      e.linesAuthored >= AGENT_SURVIVAL_FLOOR.lines &&
      e.commits >= AGENT_SURVIVAL_FLOOR.commits &&
      e.linesAuthored > 0;
    const survivalRate = rateable ? e.linesSurviving / e.linesAuthored : null;
    // NEVER $0: an agent that cannot price its work reads null, not "free" (ADR-H8).
    const costPerSurvivingLine =
      e.ratedCostUsd != null && e.linesSurviving > 0 ? e.ratedCostUsd / e.linesSurviving : null;
    return {
      agent: e.agent as AgentOutcomeRollup['agent'],
      linesAuthored: e.linesAuthored,
      linesSurviving: e.linesSurviving,
      survivalRate,
      commits: e.commits,
      sessionsRated: e.sessionsRated,
      ratedCostUsd: e.ratedCostUsd,
      costPerSurvivingLine,
      unreachableSessions: e.unreachableSessions,
      unknownSessions: e.unknownSessions,
      filesGoneFromTip: e.filesGoneFromTip,
      coverage: e.coverage,
    };
  });
}

// ── byModel / agentModels (per-model spend) ──────────────────────────────────

function aggregateByModel(perRepo: ModelRollup[][]): ModelRollup[] {
  const acc = new Map<string, { calls: number; tokensTotal: number; costUsd: number | null }>();
  for (const list of perRepo) {
    for (const m of list) {
      const e = acc.get(m.model) ?? { calls: 0, tokensTotal: 0, costUsd: null };
      e.calls += m.calls;
      e.tokensTotal += m.tokensTotal;
      e.costUsd = addNullable(e.costUsd, m.costUsd);
      acc.set(m.model, e);
    }
  }
  return [...acc.entries()].map(([model, e]) => ({
    model,
    calls: e.calls,
    tokensTotal: e.tokensTotal,
    costUsd: e.costUsd,
  }));
}

function aggregateAgentModels(perRepo: AgentModelRollup[][]): AgentModelRollup[] {
  const acc = new Map<string, { agent: string; model: string; calls: number; tokensTotal: number; costUsd: number | null }>();
  for (const list of perRepo) {
    for (const m of list) {
      const key = `${m.agent}\0${m.model}`;
      const e = acc.get(key) ?? { agent: m.agent, model: m.model, calls: 0, tokensTotal: 0, costUsd: null };
      e.calls += m.calls;
      e.tokensTotal += m.tokensTotal;
      e.costUsd = addNullable(e.costUsd, m.costUsd);
      acc.set(key, e);
    }
  }
  return [...acc.values()].map((e) => ({
    agent: e.agent as AgentModelRollup['agent'],
    model: e.model,
    calls: e.calls,
    tokensTotal: e.tokensTotal,
    costUsd: e.costUsd,
  }));
}

// ── agentDaily / agentHourly (activity spines) ───────────────────────────────

function aggregateAgentDaily(perRepo: AgentDailyPoint[][]): AgentDailyPoint[] {
  const acc = new Map<string, {
    agent: string;
    day: string;
    sessions: number;
    lines: Lines;
    tokensTotal: number | null;
  }>();
  for (const list of perRepo) {
    for (const d of list) {
      const key = `${d.agent}\0${d.day}`;
      // Sessions belong to one repo, so per-repo per-day counts are disjoint.
      const e = acc.get(key) ?? {
        agent: d.agent,
        day: d.day,
        sessions: 0,
        lines: null,
        tokensTotal: null,
      };
      e.sessions += d.sessions;
      e.lines = addLines(e.lines, d.lines);
      if (d.tokensTotal !== null) {
        e.tokensTotal = (e.tokensTotal ?? 0) + d.tokensTotal;
      }
      acc.set(key, e);
    }
  }
  return [...acc.values()].map((e) => ({
    agent: e.agent as AgentDailyPoint['agent'],
    day: e.day,
    sessions: e.sessions,
    lines: e.lines,
    tokensTotal: e.tokensTotal,
  }));
}

function aggregateAgentHourly(perRepo: AgentHourPoint[][]): AgentHourPoint[] {
  const acc = new Map<string, { agent: string; hour: number; calls: number }>();
  for (const list of perRepo) {
    for (const h of list) {
      const key = `${h.agent}\0${h.hour}`;
      const e = acc.get(key) ?? { agent: h.agent, hour: h.hour, calls: 0 };
      e.calls += h.calls;
      acc.set(key, e);
    }
  }
  return [...acc.values()].map((e) => ({
    agent: e.agent as AgentHourPoint['agent'],
    hour: e.hour,
    calls: e.calls,
  }));
}

/**
 * Re-aggregate every Agents series over the given projects (already narrowed to the
 * selection). Pure — the same projects in any order give the same result. Feed the
 * output straight to the existing Agents builders; they take these arrays verbatim.
 */
export function aggregateAgentSeries(projects: ProjectRollup[]): AgentSeries {
  return {
    byAgent: aggregateByAgent(projects.map((p) => p.byAgent)),
    agentOutcomes: aggregateAgentOutcomes(projects.map((p) => p.agentOutcomes)),
    agentOutcomesUnusable: projects.reduce(
      (sum, p) => sum + p.agentOutcomesUnusable,
      0,
    ),
    byModel: aggregateByModel(projects.map((p) => p.byModel)),
    agentModels: aggregateAgentModels(projects.map((p) => p.agentModels)),
    agentDaily: aggregateAgentDaily(projects.map((p) => p.agentDaily)),
    agentHourly: aggregateAgentHourly(projects.map((p) => p.agentHourly)),
  };
}

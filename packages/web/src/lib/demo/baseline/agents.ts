// Per-agent demo rollups and series (DEMO ONLY).
import type {
  SessionSummary,
  AgentRollup,
  AgentDailyPoint,
  AgentHourPoint,
  AgentModelRollup,
  AgentOutcomeRollup,
} from '@seorak/types';
import { CAPABILITY_REGISTRY, resolveCapabilities } from '@seorak/types';
import { wobble, hash, buildDaySpine, weekdayWeight } from '../rng.js';
import { buildByModel } from './usage.js';

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
export const CODEX_DEMO_COST = CODEX_DEMO_MODELS.reduce((s, m) => s + (m.costUsd ?? 0), 0);

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

export function buildByAgent(live: SessionSummary[], windowSessions: number, windowCost: number): AgentRollup[] {
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
export function buildAgentOutcomes(): AgentOutcomeRollup[] {
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

export function buildAgentModels(claudeCalls: number, claudeCost: number): AgentModelRollup[] {
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
export function buildAgentDaily(periodDays: number): AgentDailyPoint[] {
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
        tokensTotal: claudeSessions * wobble(i * 29 + 41, 40_000, 18_000, 1_000),
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
        tokensTotal: codexSessions * wobble(i * 31 + 43, 28_000, 12_000, 800),
      });
    }
  });
  return out;
}

// Per-agent UTC clock-hour activity. Claude spreads over the working-hours hump
// (mirroring buildHourlyDistribution); Codex concentrates late — a real cadence
// gap for the fit sentence to speak, matching the late-hour codex live seeds.
export function buildAgentHourly(): AgentHourPoint[] {
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

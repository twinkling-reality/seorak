// Per-agent rollup shapes + session capability contract.
import { z } from 'zod';
import type {
  AgentRollup,
  AgentCoverage,
  AgentDailyPoint,
  AgentModelRollup,
  AgentOutcomeRollup,
  ResolvedSessionCapabilities,
} from '@seorak/types';

export const sessionCapabilitiesSchema: z.ZodType<ResolvedSessionCapabilities> = z.object({
  hasTokens: z.boolean(),
  hasCacheTokens: z.boolean(),
  cost: z.enum(['billed', 'estimated', 'none']),
  toolResult: z.enum(['both', 'failures-only', 'passes-only', 'none']),
  endReason: z.boolean(),
  duration: z.enum(['measured', 'inferred']),
  verification: z.enum(['both', 'failures-only', 'passes-only', 'none']),
  // At what grain the tool's cost EXISTS (CODEX-CAPTURE ADR-C12). 'call' = the money is on
  // each tool.call (Claude); 'session' = it rides a session-scoped carrier because the
  // source reports no per-call attribution (Codex).
  //
  // A future grain degrades to the current call baseline, while an omitted field
  // still fails the current contract.
  costScope: z.preprocess(
    (value) =>
      value === undefined || value === 'call' || value === 'session' ? value : 'call',
    z.enum(['call', 'session']),
  ),
  // Which leg of a usage-headroom reading the tool can report (CODEX-CAPTURE ADR-C15,
  // docs/specs/multi-tool.md):
  // 'count' means we sum its tokens ourselves (Claude), 'ratio' means the provider
  // hands us a percentage (Codex), 'none' means neither. Same forward-drift guard
  // as costScope: an unknown future value degrades to this field, while omission
  // still fails the current contract.
  usageWindow: z.preprocess(
    (value) =>
      value === undefined || value === 'count' || value === 'ratio' || value === 'none'
        ? value
        : 'none',
    z.enum(['count', 'ratio', 'none']),
  ),
}) as unknown as z.ZodType<ResolvedSessionCapabilities>;

export const unpricedModelSchema = z.object({
  model: z.string(),
  tokensTotal: z.number(),
});

export const agentRollupSchema: z.ZodType<AgentRollup> = z.object({
  agent: z.string(),
  sessions: z.number(),
  activeSessions: z.number(),
  toolCalls: z.number(),
  tokensTotal: z.number(),
  costUsd: z.number().nullable(),
  // Edit-tool line volume; null until in-window rows for this agent carry the
  // derivation. Fairest cross-tool compare (multi-tool.md Appendix A).
  lines: z
    .object({ added: z.number(), removed: z.number() })
    .nullable(),
  lastEventAt: z.string(),
  // How far back this agent's record goes, across the WHOLE log (not the window). The one
  // fact the cross-agent compare cannot be honest without: Claude has been recorded since
  // June and Codex since July, so a 30-day view puts a full record beside a one-day one.
  // Optional because a retained first event may not exist. Declaring the field
  // here prevents Zod strip mode from dropping it when it is measured.
  firstSeenAt: z.string().optional(),
  capabilities: sessionCapabilitiesSchema,
  erroredPresent: z.boolean(),
  // The UNBLENDED per-agent error rate + the coverage it was measured over
  // (CODEX-CAPTURE ADR-C6). This measurement is optional, but when the worker sends
  // it the schema must declare it or Zod strip mode would silently discard it.
  // `.catch(undefined)` scopes a malformed blob to this field rather than letting one
  // bad row take the whole agents section down (the F2 resume-bug lesson).
  errorRate: z
    .object({
      rate: z.number().nullable(),
      errored: z.number(),
      returned: z.number(),
      calls: z.number(),
    })
    .optional()
    .catch(undefined),
}) as unknown as z.ZodType<AgentRollup>;

// One (agent, day) activity point (tools.agentDaily). PAST ACTIVITY ONLY; lines
// null on a day whose rows carried no line fields (never {0,0}). `tokensTotal`
// is null when NEITHER carrier measured tokens that day for this agent, and 0
// only when a carrier measured a real zero — the same honest-empty distinction
// `lines` makes, and the one both producers emit: the worker's
// `agentDailyFromBuckets` returns null off `tokensMeasured`, and the collector's
// local projection starts each bucket at null and only assigns on a measuring
// carrier. This schema required a number until 2026-08-17, so a single
// unmeasured day rejected the WHOLE overview and the dashboard rendered no
// projects at all.
//
// No `as unknown as` cast here, deliberately: input and output coincide for this
// shape, so the annotation alone type-checks, and that catches a wrong-TYPE
// drift a cast would hide. It does NOT catch this bug's shape — a schema
// stricter than the contract (`number` where `number | null` is declared) is
// assignable by output covariance, verified with tsc. Only the null fixture in
// contract-parity.test.ts catches that, which is why it exists.
export const agentDailyPointSchema: z.ZodType<AgentDailyPoint> = z.object({
  agent: z.string(),
  day: z.string(),
  sessions: z.number(),
  lines: z
    .object({ added: z.number(), removed: z.number() })
    .nullable(),
  tokensTotal: z.number().nullable(),
});

export const agentModelRollupSchema: z.ZodType<AgentModelRollup> = z.object({
  agent: z.string(),
  model: z.string(),
  calls: z.number(),
  tokensTotal: z.number(),
  costUsd: z.number().nullable(),
}) as unknown as z.ZodType<AgentModelRollup>;

export const agentCoverageSchema: z.ZodType<AgentCoverage> = z.object({
  linesInCommits: z.number(),
  linesAuthored: z.number(),
  linesOtherAgents: z.number(),
  linesContested: z.number(),
  linesUnattributed: z.number(),
}) as unknown as z.ZodType<AgentCoverage>;

export const agentOutcomeRollupSchema: z.ZodType<AgentOutcomeRollup> = z.object({
  agent: z.string(),
  linesAuthored: z.number(),
  linesSurviving: z.number(),
  survivalRate: z.number().nullable(),
  commits: z.number(),
  sessionsRated: z.number(),
  ratedCostUsd: z.number().nullable(),
  costPerSurvivingLine: z.number().nullable(),
  unreachableSessions: z.number(),
  unknownSessions: z.number(),
  filesGoneFromTip: z.number(),
  coverage: agentCoverageSchema,
}) as unknown as z.ZodType<AgentOutcomeRollup>;

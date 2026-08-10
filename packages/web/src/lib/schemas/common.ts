// Seorak zod schemas, authored against @seorak/types OverviewSnapshot +
// SessionSummary. These guard the UI layer against malformed worker data and
// give the demo layer a typed shape to build. Publish-safe: no external
// analytics/team/conversation contracts.

import { z } from 'zod';
import {
  DEFAULT_THRESHOLDS,
  PUSH_DELIVERY_HEALTH_WINDOW_DAYS,
  SESSION_END_REASONS,
  UNKNOWN_NOTIFICATION_AVAILABILITY,
  WIDEST_OVERVIEW_RANGE_DAYS,
} from '@seorak/types';
import type {
  OverviewSnapshot,
  SessionSummary,
  ProjectRollup,
  DailyPoint,
  EndReasonCount,
  DailyEndReasons,
  HourlyEndReasons,
  HourBucket,
  ToolCallRollup,
  ModelRollup,
  AgentRollup,
  AgentCoverage,
  AgentDailyPoint,
  AgentHourPoint,
  AgentModelRollup,
  AgentOutcomeRollup,
  ResolvedSessionCapabilities,
  RepoMomentum,
  RepoTemperature,
  PortfolioMomentum,
  VerificationRollup,
  LineSurvivalRollup,
  SessionOutcomeRow,
  Intervention,
  InterventionThresholds,
  PushDeliveryHealth,
  NotificationAvailability,
} from '@seorak/types';

// ── SessionSummary (the live-session row) ───────────

export const sessionSummarySchema: z.ZodType<SessionSummary> = z.object({
  sessionId: z.string(),
  project: z.string(),
  repoId: z.string(),
  agent: z.string(),
  status: z.enum(['active', 'idle', 'stuck', 'ended']),
  member: z
    .object({
      memberId: z.string(),
      displayName: z.string(),
    })
    .optional(),
  startedAt: z.string(),
  lastEventAt: z.string(),
  endedAt: z.string().optional(),
  elapsedSeconds: z.number(),
  toolCallCount: z.number(),
  currentTool: z.string().optional(),
  // Live-only "needs you" glance (present only while blocked; absent ⇒ not waiting).
  awaitingInput: z.boolean().optional(),
  tokens: z
    .object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
      total: z.number(),
    }),
  // null when the host tool cannot price its work (Codex floor: cost:'none').
  // Defaulting to 0 would fabricate a measured zero for activity-only agents.
  costUsd: z.number().nullable(),
  burnRateUsdPerMin: z.number().nullable(),
}) as unknown as z.ZodType<SessionSummary>;

export type { SessionSummary };

// ── LiveSnapshot (GET /live, the fresh zero-D1 head) ─
//
// The fast-polled live-session board, split out of /overview (DATA-LAYER
// §ADR-002). `live` is the SAME SessionSummary[] shape as overview.live — just
// always fresh, computed on-request — so the web overrides overview.live with it.
// `generatedAt` is the worker's compute time, the "updated N ago" freshness source.

export interface LiveSnapshot {
  generatedAt: string;
  live: SessionSummary[];
}

export const liveSnapshotSchema: z.ZodType<LiveSnapshot> = z.object({
  generatedAt: z.string(),
  live: z.array(sessionSummarySchema),
}) as unknown as z.ZodType<LiveSnapshot>;

// ── OverviewSnapshot sub-shapes ─────────────────────

const dailyPointSchema: z.ZodType<DailyPoint> = z.object({
  day: z.string(),
  sessions: z.number(),
  costUsd: z.number().nullable(),
  // Input+output tokens that day (cache excluded). NOTHING RENDERS IT: the menu
  // bar's daily-usage chart was the only reader and that surface was removed on
  // 2026-08-08, so the worker measures and emits this with no consumer. It stays
  // declared anyway, because z.object() strips unknown keys and an undeclared
  // field is dropped from GET /overview with zero diagnostics. Dropping it for
  // real is a wire-contract decision, not a schema tidy-up.
  tokensTotal: z.number().optional(),
}) as unknown as z.ZodType<DailyPoint>;

const periodDeltaSchema = z.object({
  current: z.number(),
  previous: z.number().nullable(),
});

const projectRollupSchema: z.ZodType<ProjectRollup> = z.object({
  project: z.string(),
  repoId: z.string(),
  sessions: z.number(),
  // Required on current workers; null is the honest KV-only/unmeasured state.
  sessionsDelta: periodDeltaSchema.nullable(),
  activeSessions: z.number(),
  toolCalls: z.number(),
  tokensTotal: z.number(),
  // null (never 0) per repo when no session reported cost — silent-zero ban,
  // mirroring byAgent.
  costUsd: z.number().nullable(),
  lastEventAt: z.string(),
  // Per-repo glance metrics are present on every current worker response. null
  // means the measurement is honestly unavailable, never that the field vanished.
  errorRate: z.number().nullable(),
  cacheReuseRatio: z.number().nullable(),
  shipRate: z.number().nullable(),
  oneShotRate: z.number().nullable(),
  costDelta: z
    .object({ current: z.number(), previous: z.number().nullable() })
    .nullable(),
  // z.lazy: endReasonCountSchema is declared just below, so defer the reference
  // to parse time (avoids the module-load temporal-dead-zone).
  endReasons: z.array(z.lazy(() => endReasonCountSchema)),
  stuckness: z.object({
    rate: z.number().nullable(),
    stuckCount: z.number(),
    inFlight: z.number(),
    stuckSessionIds: z.array(z.string()),
  }),
  byTool: z.array(z.lazy(() => toolCallRollupSchema)),
  byModel: z.array(z.lazy(() => modelRollupSchema)),
  byAgent: z.array(z.lazy(() => agentRollupSchema)),
  hourlyDistribution: z.array(z.lazy(() => hourBucketSchema)),
  lineSurvival: z.lazy(() => lineSurvivalRollupSchema).nullable(),
  endReasonsByHour: z.array(z.lazy(() => hourlyEndReasonsSchema)),
  codebaseFiles: z
    .array(
      z.object({
        fileId: z.string(),
        label: z.string().nullable(),
        edits: z.number(),
        linesAdded: z.number(),
        linesRemoved: z.number(),
        sessions: z.number(),
      }),
    ),
  codebaseDirectories: z
    .array(
      z.object({
        dirId: z.string(),
        label: z.string().nullable(),
        edits: z.number(),
        share: z.number(),
      }),
    ),
  codebaseRework: z
    .array(
      z.object({
        fileId: z.string(),
        label: z.string().nullable(),
        sessions: z.number(),
        edits: z.number(),
      }),
    ),
  verification: z.array(z.lazy(() => verificationRollupSchema)),
  // Per-repo AGENT series (Agents surface repo filter). Same shapes as the global
  // tools.agentOutcomes / agentModels / agentDaily / activity.agentHourly, grouped by
  // this repo, carrying counts so the multi-select re-aggregates client-side.
  agentOutcomes: z.array(z.lazy(() => agentOutcomeRollupSchema)),
  agentOutcomesUnusable: z.number(),
  agentModels: z.array(z.lazy(() => agentModelRollupSchema)),
  agentDaily: z.array(z.lazy(() => agentDailyPointSchema)),
  agentHourly: z.array(z.lazy(() => agentHourPointSchema)),
  // This repo's OWN daily series — same shape and same honest-empty contract as the
  // global `usage.dailyTrends`, grouped by this repo. Required rather than optional:
  // the worker always emits it, `[]` on the KV-only path that has no per-day derivation.
  dailyTrends: z.array(z.lazy(() => dailyPointSchema)),
  // Event-log subset-merge substrate. These remain optional because a current
  // worker without an event-log binding cannot measure them; absence must stay
  // absent rather than turning into a zero contribution.
  shipped: z.number().optional(),
  shipDeterminable: z.number().optional(),
  oneShots: z.number().optional(),
  oneShotDeterminable: z.number().optional(),
  toolErrors: z.number().optional(),
  toolCallsReturned: z.number().optional(),
  // These two KV-derived legs are present on every current project rollup.
  cacheReadTokens: z.number(),
  cacheInputTokens: z.number(),
  editCalls: z.number().optional(),
  dirEditsTotal: z.number().optional(),
  commitsFromSessions: z.number().nullable().optional(),
  lines: z
    .object({
      added: z.number(),
      removed: z.number(),
      priorAdded: z.number().nullable(),
    })
    .nullable()
    .optional(),
  character: z
    .object({
      repoShape: z
        .object({
          monorepo: z.boolean(),
          sizeBand: z.enum(['xs', 's', 'm', 'l', 'xl']),
          ageBand: z.enum(['new', 'recent', 'established', 'mature']),
        })
        .optional(),
      packageManager: z
        .enum([
          'npm',
          'pnpm',
          'yarn',
          'bun',
          'pip',
          'poetry',
          'uv',
          'pipenv',
          'cargo',
          'gomod',
          'bundler',
          'composer',
          'maven',
          'gradle',
        ])
        .optional(),
      framework: z
        .enum([
          'next',
          'nuxt',
          'remix',
          'sveltekit',
          'astro',
          'react',
          'vue',
          'svelte',
          'angular',
          'solid',
          'expo',
          'react-native',
          'electron',
          'express',
          'fastify',
          'nest',
          'django',
          'flask',
          'fastapi',
          'rails',
          'laravel',
          'spring',
        ])
        .optional(),
      observedAt: z.string().optional(),
    })
    .optional(),
  workMix: z
    .object({
      fileLanguageMix: z
        .array(
          z.object({
            language: z.enum([
              'typescript',
              'javascript',
              'python',
              'rust',
              'go',
              'java',
              'kotlin',
              'swift',
              'c',
              'cpp',
              'csharp',
              'ruby',
              'php',
              'shell',
              'lua',
              'html',
              'css',
              'sql',
              'markdown',
              'json',
              'yaml',
              'toml',
              'vue',
              'svelte',
            ]),
            editCalls: z.number(),
          }),
        )
        .optional(),
      branchWorkTypeMix: z
        .array(
          z.object({
            workType: z.enum(['feature', 'fix', 'refactor', 'chore', 'other']),
            sessions: z.number(),
          }),
        )
        .optional(),
      fileCategoryMix: z
        .array(
          z.object({
            category: z.enum(['source', 'test', 'config', 'styles', 'docs', 'data', 'other']),
            editCalls: z.number(),
          }),
        )
        .optional(),
      peakHour: z
        .object({ dow: z.number(), hour: z.number(), sessions: z.number() })
        .nullable()
        .optional(),
      sessionDurationMedianSeconds: z.number().nullable().optional(),
    })
    .optional(),
  interventionFires: z.number().optional(),
}) as unknown as z.ZodType<ProjectRollup>;

const endReasonCountSchema: z.ZodType<EndReasonCount> = z.object({
  // Built FROM the union's runtime array, never re-typed: the developer-model schema
  // hand-copied this list, drifted to four values, and blanked its whole pillar on the
  // first `resume`. `.catch('other')` so a reason the collector adds tomorrow lands in the
  // union's own catch-all bucket instead of failing the parse.
  reason: z.preprocess(
    (value) =>
      value === undefined || (SESSION_END_REASONS as readonly unknown[]).includes(value)
        ? value
        : 'other',
    z.enum(SESSION_END_REASONS),
  ),
  count: z.number(),
}) as unknown as z.ZodType<EndReasonCount>;

// Per-repo git ground-truth rollup (the LATEST git.momentum snapshot per repo).
// COUNTS + ids/enum ONLY — repoLabel is a basename, never a path; raw LOC is
// never a score. zod .object() strips unknown keys, so these fields MUST be
// declared here or GET /overview would silently drop them.
const repoMomentumSchema: z.ZodType<RepoMomentum> = z.object({
  repoId: z.string(),
  repoLabel: z.string(),
  gitContext: z.enum(['no-repo', 'clean', 'dirty-at-start', 'detached', 'no-remote']),
  windowDays: z.number(),
  commits: z.number(),
  filesTouched: z.number(),
  linesAdded: z.number(),
  linesDeleted: z.number(),
  netLines: z.number(),
  generatedLinesExcluded: z.number(),
}) as unknown as z.ZodType<RepoMomentum>;

const hourBucketSchema: z.ZodType<HourBucket> = z.object({
  dow: z.number(),
  hour: z.number(),
  sessions: z.number(),
}) as unknown as z.ZodType<HourBucket>;

// Per-day + per-hour session-end reason series (FOLLOW-UP #5 → outcome-trend +
// hourly-effectiveness). Only days/hours with ends appear (honest-empty, no
// zero-filled spine); reasons reuse endReasonCountSchema. z.object() strips
// unknown keys, so these MUST be declared or GET /overview drops them.
const dailyEndReasonsSchema: z.ZodType<DailyEndReasons> = z.object({
  day: z.string(),
  reasons: z.array(endReasonCountSchema),
}) as unknown as z.ZodType<DailyEndReasons>;

const hourlyEndReasonsSchema: z.ZodType<HourlyEndReasons> = z.object({
  hour: z.number(),
  reasons: z.array(endReasonCountSchema),
}) as unknown as z.ZodType<HourlyEndReasons>;

const toolCallRollupSchema: z.ZodType<ToolCallRollup> = z.object({
  tool: z.string(),
  calls: z.number(),
  sessions: z.number(),
}) as unknown as z.ZodType<ToolCallRollup>;

const verificationRollupSchema: z.ZodType<VerificationRollup> = z.object({
  kind: z.enum(['test', 'build', 'typecheck', 'lint']),
  passRate: z.number().nullable(),
  runs: z.number(),
  passed: z.number(),
}) as unknown as z.ZodType<VerificationRollup>;

// On-branch LINE-survival — the honest, revert-catching "did the work LAST?"
// read. Line-level rate over rated (retained+overwritten) fates, floored at >=3
// commits. rate null (never 0) until the floor is met. Anti-grade: a low rate is
// "more changed back", never "bad work". z.object() strips unknown keys, so this
// MUST be declared or GET /overview silently drops it.
const lineSurvivalRollupSchema: z.ZodType<LineSurvivalRollup> = z.object({
  rate: z.number().nullable(),
  linesAuthored: z.number(),
  linesSurviving: z.number(),
  commitsChecked: z.number(),
  sessionsRated: z.number(),
  retained: z.number(),
  overwritten: z.number(),
  unreachable: z.number(),
  unknown: z.number(),
}) as unknown as z.ZodType<LineSurvivalRollup>;

// Per-session outcome row (ADR-OA7 → outcomes.bySession "pending → fate" card).
// CONTENT-FREE: salted repoId keys it, project is the basename the live board
// already exposes, status is a closed enum (pending | the four fates). z.object()
// strips unknown keys, so every field MUST be declared or GET /overview drops it.
const sessionOutcomeSchema: z.ZodType<SessionOutcomeRow> = z.object({
  sessionId: z.string(),
  project: z.string(),
  repoId: z.string(),
  endedAt: z.string(),
  status: z.enum(['pending', 'retained', 'overwritten', 'unreachable', 'unknown']),
}) as unknown as z.ZodType<SessionOutcomeRow>;

const modelRollupSchema: z.ZodType<ModelRollup> = z.object({
  model: z.string(),
  calls: z.number(),
  tokensTotal: z.number(),
  costUsd: z.number().nullable(),
}) as unknown as z.ZodType<ModelRollup>;

// The reporting contract resolved by the current worker for every agent rollup.
// Stored pre-ledger sessions are normalized against the registry before this
// response is built, so the web reads one current shape.
const sessionCapabilitiesSchema: z.ZodType<ResolvedSessionCapabilities> = z.object({
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

/**
 * A model the pricing table holds no row for, with the tokens it burned unpriced
 * (CODEX-CAPTURE ADR-C11). The actionable half of `costPartial`: the boolean says the
 * total understates spend, this says BY WHAT, and a missing row is a one-line fix nobody
 * can make while it is anonymous.
 */
const unpricedModelSchema = z.object({
  model: z.string(),
  tokensTotal: z.number(),
});

// Per-agent rollup (tools.byAgent). costUsd / lines null (never 0 / {0,0}) per
// agent when unmeasured — silent-zero ban, mirroring ProjectRollup.
const agentRollupSchema: z.ZodType<AgentRollup> = z.object({
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
// null on a day whose rows carried no line fields (never {0,0}).
const agentDailyPointSchema: z.ZodType<AgentDailyPoint> = z.object({
  agent: z.string(),
  day: z.string(),
  sessions: z.number(),
  lines: z
    .object({ added: z.number(), removed: z.number() })
    .nullable(),
}) as unknown as z.ZodType<AgentDailyPoint>;

// Per-(agent, model) split (tools.agentModels). costUsd null when unpriced.
const agentModelRollupSchema: z.ZodType<AgentModelRollup> = z.object({
  agent: z.string(),
  model: z.string(),
  calls: z.number(),
  tokensTotal: z.number(),
  costUsd: z.number().nullable(),
}) as unknown as z.ZodType<AgentModelRollup>;

// The coverage split over the commits one agent landed work in (tools.agentOutcomes[].coverage).
// The five buckets PARTITION linesInCommits, so a compare can see what the rate is *about*.
const agentCoverageSchema: z.ZodType<AgentCoverage> = z.object({
  linesInCommits: z.number(),
  linesAuthored: z.number(),
  linesOtherAgents: z.number(),
  linesContested: z.number(),
  linesUnattributed: z.number(),
}) as unknown as z.ZodType<AgentCoverage>;

// Per-agent OUTCOMES from git (tools.agentOutcomes). Every rate is nullable,
// NEVER 0: a survival rate below the n-floor and a cost the agent cannot report are
// both honest-empty, and a coerced 0 would read as "none of its work lasted" / "it was free".
const agentOutcomeRollupSchema: z.ZodType<AgentOutcomeRollup> = z.object({
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

// One (agent, UTC hour) tool-call bucket (activity.agentHourly).
const agentHourPointSchema: z.ZodType<AgentHourPoint> = z.object({
  agent: z.string(),
  hour: z.number(),
  calls: z.number(),
}) as unknown as z.ZodType<AgentHourPoint>;

// Per-repo temperature (usage.portfolio.repos). temperature null = history too
// thin to judge (never a fabricated "steady"); judged on files/commits/recency,
// never raw LOC. baseline null when no comparable prior snapshot.
const repoTemperatureSchema: z.ZodType<RepoTemperature> = z.object({
  repoId: z.string(),
  repoLabel: z.string(),
  gitContext: z.enum(['no-repo', 'clean', 'dirty-at-start', 'detached', 'no-remote']),
  temperature: z.preprocess(
      (value) =>
        value === undefined ||
        value === null ||
        value === 'heating' ||
        value === 'steady' ||
        value === 'cooling' ||
        value === 'quiet'
          ? value
          : null,
    z.enum(['heating', 'steady', 'cooling', 'quiet']).nullable(),
  ),
  quietDays: z.number().nullable(),
  commits: z.number(),
  filesTouched: z.number(),
  netLines: z.number(),
  generatedLinesExcluded: z.number(),
  baseline: z
    .object({ commits: z.number(), filesTouched: z.number() })
    .nullable(),
}) as unknown as z.ZodType<RepoTemperature>;

// Cross-repo breadth + temperature board (usage.portfolio). Non-null, honest-
// empty repos:[] + zero counts when there is no in-window git.momentum history.
const portfolioMomentumSchema: z.ZodType<PortfolioMomentum> = z.object({
  windowDays: z.number(),
  reposTotal: z.number(),
  reposMoved: z.number(),
  reposQuiet: z.number(),
  repos: z.array(repoTemperatureSchema),
}) as unknown as z.ZodType<PortfolioMomentum>;

// A fired intervention (GET /interventions). Enum mirrors intervention.ts's full
// 8-signal SignalId set; the panel + the notifications history read exactly these
// fields. Validating guards window.history navigation off a malformed deepLink.
//
// PROJECT-AS-TITLE rework (NOTIFICATIONS.md §2/§4A): a fired row now carries the
// repo `project` label (notification title + history row), its salted `repoId`,
// the human `signalLabel` (subtitle), the per-signal `interruptionLevel`, and the
// `held` flag (quiet hours suppressed the PUSH but the fire is still recorded).
export const interventionSchema: z.ZodType<Intervention> = z.object({
  kind: z.enum([
    'cost_spike',
    'high_burn_rate',
    'long_session',
    'stuck_loop',
    'went_cold',
    'session_ended',
    'daily_cost_cap',
    'first_error',
  ]),
  sessionId: z.string(),
  project: z.string(),
  repoId: z.string(),
  triggeredAt: z.string(),
  signalLabel: z.string(),
  body: z.string(),
  deepLink: z.string(),
  interruptionLevel: z.enum(['passive', 'active', 'timeSensitive']).optional(),
  held: z.boolean().optional(),
}) as unknown as z.ZodType<Intervention>;

export const interventionsArraySchema: z.ZodType<Intervention[]> = z.array(interventionSchema);

const unobservedDeliveryEnvironmentSchema = z.object({
  registeredDevices: z.number().int().nonnegative(),
  state: z.literal('unobserved'),
  completedAttempts: z.null(),
  lastCompletedAt: z.null(),
  lastAcceptedAt: z.null(),
  terminalFailures: z.null(),
  lastTerminalAt: z.null(),
});

const observedDeliveryEnvironmentSchema = z.object({
  registeredDevices: z.number().int().nonnegative(),
  state: z.literal('observed'),
  completedAttempts: z.number().int().positive(),
  lastCompletedAt: z.string().datetime(),
  lastAcceptedAt: z.string().datetime().nullable(),
  terminalFailures: z.number().int().nonnegative(),
  lastTerminalAt: z.string().datetime().nullable(),
}).refine(
  (value) =>
    (value.terminalFailures === 0 && value.lastTerminalAt === null) ||
    (value.terminalFailures > 0 && value.lastTerminalAt !== null),
  { message: 'terminal failure count and timestamp disagree' },
);

/** GET /delivery-health. The union preserves honest-empty semantics through
 * zod instead of stripping nullable evidence into apparent zeroes. */
export const pushDeliveryHealthSchema: z.ZodType<PushDeliveryHealth> = z.object({
  observedAt: z.string().datetime(),
  windowDays: z.literal(PUSH_DELIVERY_HEALTH_WINDOW_DAYS),
  environments: z.object({
    development: z.union([
      unobservedDeliveryEnvironmentSchema,
      observedDeliveryEnvironmentSchema,
    ]),
    production: z.union([
      unobservedDeliveryEnvironmentSchema,
      observedDeliveryEnvironmentSchema,
    ]),
  }),
}) as unknown as z.ZodType<PushDeliveryHealth>;

// Resolved wedge thresholds (FOLLOW-UP #3) — DEFAULT_THRESHOLDS overlaid with any
// per-deploy env overrides, surfaced so the watch-cards show the real limits.
// NOTE: every field is declared because z.object() STRIPS unknown keys — the two
// new bounds (wentColdMinutes, dailyCostCapUsd) MUST be listed or GET /overview's
// thresholds would silently lose them, and createEmptyOverview's DEFAULT_THRESHOLDS
// (which carries all seven) would fail to round-trip through this schema.
const interventionThresholdsSchema: z.ZodType<InterventionThresholds> = z.object({
  costSpikeUsd: z.number(),
  longSessionMinutes: z.number(),
  highBurnRateUsdPerMinute: z.number(),
  stuckLoopRepeatedToolCalls: z.number(),
  stuckLoopErroredToolCalls: z.number(),
  wentColdMinutes: z.number(),
  dailyCostCapUsd: z.number(),
}) as unknown as z.ZodType<InterventionThresholds>;

// Per-(tool, window) usage-headroom reading (`UsageAllowance` in `@seorak/types`). Declared so
// the field round-trips the contract-parity guard (z.object() strips unknown keys);
// no surface renders it at all. The menu bar decoded /overview directly and was the
// only intended reader; it was removed on 2026-08-08 and nothing replaced it.
//
// EVERY field is declared, including the nullable ones, and that is not pedantry: this
// schema runs in STRIP mode, so a field the worker sends and this object does not name
// is dropped with ZERO diagnostics. A perfect API response and an empty surface. The
// two-leg contract (CODEX-CAPTURE ADR-C15) puts the entire Codex reading in
// `usedPercent`, so omitting it here would silently erase Codex's gauge while every
// test stayed green.
const usageAllowanceSchema = z.object({
  tool: z.string(),
  period: z.enum(["rolling-5h", "weekly"]),
  // COUNT leg — null on a tool that reports a ratio and no absolute terms (Codex).
  consumed: z.number().nullable(),
  unit: z.enum(["tokens", "requests", "messages"]).nullable(),
  allowance: z.number().nullable(),
  // RATIO leg — the provider's own percentage. Null on a tool we count ourselves.
  usedPercent: z.number().nullable(),
  resetsAt: z.string().nullable(),
  observedAt: z.string().nullable(),
  source: z.enum(["none", "self-calibrated", "plan-estimate", "provider-auth"]),
  coverageComplete: z.boolean(),
});

// Content-free watch availability. Keep every catalog key explicit: z.object()
// strips undeclared fields, while a partial record would let one watch silently
// disappear between the worker and Settings.
const notificationSignalAvailabilitySchema = z.object({
  state: z.enum(['available', 'unavailable', 'unknown']),
  supportedBy: z.array(z.string()),
});

const notificationAvailabilitySchema: z.ZodType<NotificationAvailability> = z.object({
  agents: z.array(z.string()),
  signals: z.object({
    cost_spike: notificationSignalAvailabilitySchema,
    high_burn_rate: notificationSignalAvailabilitySchema,
    long_session: notificationSignalAvailabilitySchema,
    stuck_loop: notificationSignalAvailabilitySchema,
    went_cold: notificationSignalAvailabilitySchema,
    session_ended: notificationSignalAvailabilitySchema,
    daily_cost_cap: notificationSignalAvailabilitySchema,
    first_error: notificationSignalAvailabilitySchema,
  }),
}) as unknown as z.ZodType<NotificationAvailability>;

export const overviewSnapshotSchema: z.ZodType<OverviewSnapshot> = z.object({
  generatedAt: z.string(),
  rangeDays: z.number(),
  // The plan's widest window. Declared because this schema parses in STRIP mode:
  // an undeclared field is silently dropped, so omitting it here would discard
  // the ceiling and leave the range pills offering a window the worker clamps.
  maxRangeDays: z.number(),
  // Config and headroom are always emitted by the current, co-deployed worker.
  thresholds: interventionThresholdsSchema,
  // Keep element-level additive forward compatibility: a future enum value costs
  // one gauge, while omission of the current field rejects the response.
  usageAllowances: z
    .array(usageAllowanceSchema.nullable().catch(null))
    .transform((rows) =>
      rows.filter((r): r is z.infer<typeof usageAllowanceSchema> => r != null),
    ),
  // Optional only across a rolling worker/web deployment. Current workers emit
  // it; Settings falls back to tools.byAgent when this contract is absent.
  notificationAvailability: notificationAvailabilitySchema.optional(),
  live: z.array(sessionSummarySchema),
  usage: z.object({
    totals: z.object({
      sessions: z.number(),
      toolCalls: z.number(),
      // Current workers always emit the field; null is its honest unmeasured state.
      sessionsDelta: periodDeltaSchema.nullable(),
    }),
    cost: z.object({
      totalUsd: z.number().nullable(),
      sessionsWithCost: z.number(),
      // Worker omits it when the total is complete; default false so a render can
      // read it as a plain boolean (COST-NULLABILITY.md ADR-2).
      costPartial: z.boolean().optional().default(false),
      // WHICH models we have no price row for (CODEX-CAPTURE ADR-C11). `costPartial`
      // says the total understates spend; this says by what.
      //
      // It MUST be declared here or it is silently dropped: z.object() strips unknown
      // keys with zero diagnostics, so the worker would send it, the web would discard
      // it, and CI would stay green while the dashboard never told the buyer a price row
      // was owed. That is not hypothetical: it is how claude-fable-5 burned 3.49 billion
      // tokens and $5,225 of real spend behind a $0.00.
      //
      // `.catch([])` so a malformed entry costs this field and nothing else. The headline
      // must never be blanked by the field that exists to explain the headline.
      unpricedModels: z.array(unpricedModelSchema).catch([]).optional().default([]),
      delta: periodDeltaSchema.nullable(),
    }),
    // Edit-tool line delta (collector on-machine derivation, counts only).
    // z.object() STRIPS unknown keys, so this MUST be declared or GET /overview
    // silently drops it. null until in-window rows carry the derivation.
    lines: z
      .object({
        added: z.number(),
        removed: z.number(),
        delta: periodDeltaSchema.nullable(),
      })
      .nullable(),
    dailyTrends: z.array(dailyPointSchema),
    projects: z.array(projectRollupSchema),
    // Honest-empty [] until git.momentum events land.
    momentum: z.array(repoMomentumSchema),
    // Cross-repo breadth + temperature board. z.object() STRIPS unknown keys, so
    // this MUST be declared or GET /overview silently drops it. Non-null; honest-
    // empty repos:[] when no history.
    portfolio: portfolioMomentumSchema,
    // cacheRead/(cacheRead+input); null (never 0) until the denominator > 0.
    cacheReuseRatio: z.number().nullable(),
    // Window cost / edit-family calls; null until both sides are measured.
    costPerEdit: z.number().nullable(),
  }),
  // The file/directory axis (salted fileId signal; labels are basenames under
  // the fileLabels opt-in). z.object() STRIPS unknown keys, so this MUST be
  // declared or GET /overview silently drops it. Every member honest-empty.
  codebase: z.object({
    files: z.array(
      z.object({
        fileId: z.string(),
        label: z.string().nullable(),
        edits: z.number(),
        linesAdded: z.number(),
        linesRemoved: z.number(),
        sessions: z.number(),
        projects: z
          .array(
            z.object({
              repoId: z.string(),
              project: z.string(),
              edits: z.number(),
              sessions: z.number(),
            }),
          )
          .optional(),
      }),
    ),
    directories: z.array(
      z.object({
        dirId: z.string(),
        label: z.string().nullable(),
        edits: z.number(),
        share: z.number(),
        projects: z
          .array(
            z.object({
              repoId: z.string(),
              project: z.string(),
              edits: z.number(),
              sessions: z.number(),
            }),
          )
          .optional(),
      }),
    ),
    rework: z.array(
      z.object({
        fileId: z.string(),
        label: z.string().nullable(),
        sessions: z.number(),
        edits: z.number(),
        projects: z
          .array(
            z.object({
              repoId: z.string(),
              project: z.string(),
              edits: z.number(),
              sessions: z.number(),
            }),
          )
          .optional(),
      }),
    ),
    commitStats: z
      .object({
        windowDays: z.number(),
        commits: z.number(),
        filesTouched: z.number(),
        linesAdded: z.number(),
        linesDeleted: z.number(),
        generatedLinesExcluded: z.number(),
        commitsFromSessions: z.number().nullable(),
      })
      .nullable(),
    filesInPlay: z
      .object({
        distinctFiles: z.number(),
        files: z.array(
          z.object({
            fileId: z.string(),
            label: z.string().nullable(),
            // A future FileCategory value degrades this one field to null, while
            // omission still fails the current contract.
            category: z.preprocess(
              (value) =>
                value === undefined ||
                value === null ||
                value === 'source' ||
                value === 'test' ||
                value === 'config' ||
                value === 'styles' ||
                value === 'docs' ||
                value === 'data' ||
                value === 'other'
                  ? value
                  : null,
              z
                .enum(['source', 'test', 'config', 'styles', 'docs', 'data', 'other'])
                .nullable(),
            ),
            edits: z.number(),
            lastEditedAt: z.string(),
            projects: z.array(
              z.object({
                repoId: z.string(),
                project: z.string(),
                edits: z.number(),
                sessions: z.number(),
              }),
            ),
          }),
        ),
      })
      .nullable(),
  }),
  outcomes: z.object({
    endReasons: z.array(endReasonCountSchema),
    activeCount: z.number(),
    endedCount: z.number(),
    stuckness: z.object({
      rate: z.number().nullable(),
      stuckCount: z.number(),
      inFlight: z.number(),
      stuckSessionIds: z.array(z.string()),
    }),
    // "How sessions ended, day by day" (FOLLOW-UP #5); honest-empty [] until
    // sessions end (no zero-filled day spine).
    endReasonsByDay: z.array(dailyEndReasonsSchema),
    oneShotRate: z.number().nullable(),
    // Share of sessions that shipped a commit; null until session.delta lands.
    shipRate: z.number().nullable(),
    // On-branch line-survival — survived-change attribution ("did the work
    // LAST?"). MUST be declared or z.object() strips it. Honest-empty until
    // line-survival checks accrue.
    lineSurvival: lineSurvivalRollupSchema,
    // Per-session outcome rows (ADR-OA7 → the "pending → fate" card). z.object()
    // strips unknown keys, so this MUST be declared or GET /overview drops it.
    // Honest-empty [] until ended sessions accrue.
    bySession: z.array(sessionOutcomeSchema),
  }),
  activity: z.object({
    hourlyDistribution: z.array(hourBucketSchema),
    // Per-agent UTC clock-hour activity (Agents cadence). Honest-empty [].
    agentHourly: z.array(agentHourPointSchema),
    // "How sessions ended, by hour" (FOLLOW-UP #5); honest-empty [] until ends land.
    endReasonsByHour: z.array(hourlyEndReasonsSchema),
  }),
  tools: z.object({
    byTool: z.array(toolCallRollupSchema),
    callStats: z.object({
      totalCalls: z.number(),
      errorRate: z.number().nullable(),
    }),
    byModel: z.array(modelRollupSchema),
    // Per-agent rollup; z.object() strips unknown keys, so this MUST be declared.
    // Honest-empty [] until sessions exist.
    byAgent: z.array(agentRollupSchema),
    // Per-agent daily series + model split (Agents Tier 1). Honest-empty [].
    agentDaily: z.array(agentDailyPointSchema),
    agentModels: z.array(agentModelRollupSchema),
    // Per-agent OUTCOMES from git (HEAD-TO-HEAD Tier 2) + the count of survival rows the
    // split could not use. Honest-empty [] / 0 until commit-attributed rows land.
    agentOutcomes: z.array(agentOutcomeRollupSchema),
    agentOutcomesUnusable: z.number(),
    // Verification pass-rate by kind; honest-empty [] until verification runs land.
    verification: z.array(verificationRollupSchema),
  }),
}) as unknown as z.ZodType<OverviewSnapshot>;

export type { OverviewSnapshot };

// ── Honest-empty fallback ───────────────────────────

/**
 * The canonical empty OverviewSnapshot. Every field backed by the retained
 * event log, or by deeper per-call / per-model capture the collector does not
 * emit, is an empty array or null (NEVER zero-filled) so widgets render their
 * honest empty state. Used for first-render scaffolding and demo fixtures. It is
 * never a substitute for an
 * invalid production API response.
 */
export function createEmptyOverview(rangeDays = 30): OverviewSnapshot {
  return {
    generatedAt: new Date(0).toISOString(),
    rangeDays,
    // Scaffolding advertises the widest supported window, not a plan ceiling: no
    // worker has answered yet, so there is no plan to know. A real snapshot
    // replaces it before any picker decision is made off it.
    maxRangeDays: WIDEST_OVERVIEW_RANGE_DAYS,
    // Config, not measured data — a current worker always sends it, so the empty
    // fallback matches the live shape (defaults until an env override tunes them).
    thresholds: DEFAULT_THRESHOLDS,
    usageAllowances: [],
    notificationAvailability: UNKNOWN_NOTIFICATION_AVAILABILITY,
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
    codebase: { files: [], directories: [], rework: [], commitStats: null, filesInPlay: null },
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
      agentOutcomes: [],
      agentOutcomesUnusable: 0,
      verification: [],
    },
  };
}

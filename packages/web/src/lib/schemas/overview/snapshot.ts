// OverviewSnapshot contract + honest-empty fallback.
import { z } from 'zod';
import {
  DEFAULT_THRESHOLDS,
  UNKNOWN_NOTIFICATION_AVAILABILITY,
  WIDEST_OVERVIEW_RANGE_DAYS,
} from '@seorak/types';
import type { OverviewSnapshot } from '@seorak/types';
import { sessionSummarySchema } from './session.js';
import { dailyPointSchema, periodDeltaSchema, projectRollupSchema } from './projects.js';
import { endReasonCountSchema, dailyEndReasonsSchema, hourlyEndReasonsSchema } from './end-reasons.js';
import { hourBucketSchema, agentHourPointSchema } from './activity.js';
import { toolCallRollupSchema, modelRollupSchema, verificationRollupSchema } from './tools.js';
import { lineSurvivalRollupSchema, sessionOutcomeSchema } from './outcomes.js';
import {
  agentRollupSchema,
  agentDailyPointSchema,
  agentModelRollupSchema,
  agentOutcomeRollupSchema,
  unpricedModelSchema,
} from './agents.js';
import { repoMomentumSchema, portfolioMomentumSchema } from './codebase.js';
import {
  interventionThresholdsSchema,
  usageAllowanceSchema,
  notificationAvailabilitySchema,
} from './interventions.js';

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

import { z } from 'zod';
import { SESSION_END_REASONS, WIDEST_OVERVIEW_RANGE_DAYS } from '@seorak/types';
import type {
  DeveloperModelSnapshot,
  LineSurvivalRollup,
  EndReasonCount,
  HourBucket,
  HourlyEndReasons,
  DailyEndReasons,
  ToolCallRollup,
  ModelRollup,
  VerificationRollup,
} from '@seorak/types';
import { validateResponse } from './validation.js';

const lineSurvivalSchema: z.ZodType<LineSurvivalRollup> = z.object({
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

/**
 * The SIX lifecycle values of `SessionEndEvent.reason`, matching `@seorak/types` and
 * `schemas/common.ts` exactly. This list drifted once and it cost the whole pillar: it
 * was missing `resume` and `bypass_permissions_disabled`, so the moment a real session
 * ended with `resume` the snapshot parse failed, `validateDeveloperModel` swapped in an
 * EMPTY snapshot, and the Model page told a developer with 185k events to "run your first
 * agent sessions". The `as unknown as` cast below is why TypeScript never caught it.
 *
 * `.catch('other')` is the load-bearing part. A reason the collector adds tomorrow must
 * degrade to the union's own catch-all bucket, NEVER fail the parse. An end reason is one
 * cell of one ring; it can't be allowed to take the pillar down with it.
 */
const endReasonSchema: z.ZodType<EndReasonCount> = z.object({
  reason: z.enum(SESSION_END_REASONS).catch('other'),
  count: z.number(),
}) as unknown as z.ZodType<EndReasonCount>;

const hourBucketSchema: z.ZodType<HourBucket> = z.object({
  dow: z.number(),
  hour: z.number(),
  sessions: z.number(),
}) as unknown as z.ZodType<HourBucket>;

const hourlyEndReasonsSchema: z.ZodType<HourlyEndReasons> = z.object({
  hour: z.number(),
  reasons: z.array(endReasonSchema),
}) as unknown as z.ZodType<HourlyEndReasons>;

const dailyEndReasonsSchema: z.ZodType<DailyEndReasons> = z.object({
  day: z.string(),
  reasons: z.array(endReasonSchema),
}) as unknown as z.ZodType<DailyEndReasons>;

const toolCallRollupSchema: z.ZodType<ToolCallRollup> = z.object({
  tool: z.string(),
  calls: z.number(),
  sessions: z.number(),
}) as unknown as z.ZodType<ToolCallRollup>;

const modelRollupSchema: z.ZodType<ModelRollup> = z.object({
  model: z.string(),
  calls: z.number(),
  tokensTotal: z.number(),
  costUsd: z.number().nullable(),
}) as unknown as z.ZodType<ModelRollup>;

const verificationRollupSchema: z.ZodType<Omit<VerificationRollup, 'passRate'>> = z.object({
  kind: z.enum(['test', 'build', 'typecheck', 'lint']),
  runs: z.number(),
  passed: z.number(),
}) as unknown as z.ZodType<Omit<VerificationRollup, 'passRate'>>;

export const developerModelSnapshotSchema: z.ZodType<DeveloperModelSnapshot> = z.object({
  scope: z.object({
    rangeDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    // Declared for the same reason as on the overview schema: strip mode drops
    // an undeclared field, and dropping the ceiling would leave the Model range
    // picker offering a window the worker clamps.
    maxRangeDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    repoId: z.string().nullable(),
    generatedAt: z.string(),
  }),
  focus: z
    .object({
      projectFocus: z
        .array(
          z.object({
            repoId: z.string(),
            project: z.string(),
            sessions: z.number(),
            share: z.number().nullable(),
          }),
        ),
    }),
  outcomes: z
    .object({
      shipRate: z.number().nullable(),
      lineSurvival: lineSurvivalSchema,
      // The counts each rate above divides. Declared (not optional) because a
      // surface must be able to say "of how many"; strip mode would drop them.
      shipped: z.number(),
      shipDeterminable: z.number(),
      stuckness: z.object({
        rate: z.number().nullable(),
        stuckCount: z.number(),
        // The denominator, for the same reason as the three counts above: the
        // friction card states a stuck COUNT and had nothing to divide it by, and
        // `stuckCount / rate` is the reconstruction the evidence rules forbid.
        inFlight: z.number(),
        stuckSessionIds: z.array(z.string()),
      }),
      endReasons: z.array(endReasonSchema),
    }),
  activity: z
    .object({
      hourlyDistribution: z.array(hourBucketSchema),
      endReasonsByHour: z.array(hourlyEndReasonsSchema),
    }),
  tools: z
    .object({
      byTool: z.array(toolCallRollupSchema),
      byModel: z.array(modelRollupSchema),
      callStats: z.object({
        errorRate: z.number().nullable(),
        // Required, like the three counts above: a rate the reader cannot check
        // is a claim wearing a measurement's clothes.
        erroredCalls: z.number(),
        callsWithResult: z.number(),
      }),
      verification: z.array(verificationRollupSchema),
    }),
  identity: z
    .object({
      fileLanguageMix: z.array(z.object({ language: z.string(), calls: z.number() })).optional(),
      branchWorkTypeMix: z
        .array(z.object({ workType: z.string(), sessions: z.number() }))
        .optional(),
    })
    .optional(),
  // COUNTS at UTC-hour grain, never rates at a named bucket — the fold onto the
  // reader's dayparts and the n-floor both happen in the portrait compiler, since
  // the worker has no timezone to bucket by. See @seorak/types developer-model.ts.
  // The prior adjacent window. Raw distributions, never prior CONCLUSIONS — the
  // surface has to derive "you were a morning developer then" on the reader's own
  // clock, or a shift would be announced that never happened.
  accrual: z
    .object({
      sessions: z.number(),
      hourlyDistribution: z.array(hourBucketSchema),
      projectFocus: z.array(
        z.object({
          repoId: z.string(),
          project: z.string(),
          sessions: z.number(),
          share: z.number().nullable(),
        }),
      ),
      branchWorkTypeMix: z
        .array(z.object({ workType: z.string(), sessions: z.number() }))
        .optional(),
      lineSurvival: lineSurvivalSchema,
    })
    .optional(),
  conditional: z
    .object({
      lineSurvivalByStartHour: z
        .array(
          z.object({
            hour: z.number(),
            linesAuthored: z.number(),
            linesSurviving: z.number(),
            commitsChecked: z.number(),
            sessionsRated: z.number(),
          }),
        )
        .optional(),
      shipByStartHour: z
        .array(
          z.object({
            hour: z.number(),
            shipped: z.number(),
            determinable: z.number(),
          }),
        )
        .optional(),
    })
    .optional(),
}) as unknown as z.ZodType<DeveloperModelSnapshot>;

export function createEmptyDeveloperModel(rangeDays: 7 | 30 | 90 = 30): DeveloperModelSnapshot {
  return {
    scope: {
      rangeDays,
      // Scaffolding: no worker has answered, so there is no plan ceiling to
      // report. The widest supported window is the honest placeholder.
      maxRangeDays: WIDEST_OVERVIEW_RANGE_DAYS,
      repoId: null,
      generatedAt: new Date().toISOString(),
    },
    focus: { projectFocus: [] },
    outcomes: {
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
      shipped: 0,
      shipDeterminable: 0,
      stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
      endReasons: [],
    },
    activity: { hourlyDistribution: [], endReasonsByHour: [] },
    tools: { byTool: [], byModel: [], callStats: { errorRate: null, erroredCalls: 0, callsWithResult: 0 }, verification: [] },
  };
}

export function validateDeveloperModel(data: unknown): DeveloperModelSnapshot {
  return validateResponse(developerModelSnapshotSchema, data, 'developer-model');
}

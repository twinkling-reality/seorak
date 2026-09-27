// Project rollup + daily usage point shapes.
import { z } from 'zod';
import type { ProjectRollup, DailyPoint } from '@seorak/types';
import { endReasonCountSchema, hourlyEndReasonsSchema } from './end-reasons.js';
import { hourBucketSchema, agentHourPointSchema } from './activity.js';
import { toolCallRollupSchema, modelRollupSchema, verificationRollupSchema } from './tools.js';
import { lineSurvivalRollupSchema } from './outcomes.js';
import {
  agentRollupSchema,
  agentOutcomeRollupSchema,
  agentModelRollupSchema,
  agentDailyPointSchema,
} from './agents.js';

export const dailyPointSchema: z.ZodType<DailyPoint> = z.object({
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

export const periodDeltaSchema = z.object({
  current: z.number(),
  previous: z.number().nullable(),
});

export const projectRollupSchema: z.ZodType<ProjectRollup> = z.object({
  project: z.string(),
  repoId: z.string(),
  // Present only when the owner archived this project; absent means active.
  // Optional rather than defaulted, so a worker that does not yet emit it is
  // read as "nothing archived" instead of failing the whole snapshot.
  archived: z.boolean().optional(),
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

// SessionSummary + LiveSnapshot (GET /live).
import { z } from 'zod';
import type { SessionSummary } from '@seorak/types';

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


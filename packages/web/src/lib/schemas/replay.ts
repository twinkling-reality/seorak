// Zod schema for the keyframe-replay contract (GET /replay/:sessionId),
// authored against @seorak/types ReplaySession / Keyframe. Guards the replay
// view against malformed worker data the same way overviewSnapshotSchema guards
// the dashboard.
//
// Publish-safe: a keyframe carries COUNTS + metadata + a derived label ONLY —
// never a prompt, command, file path, diff, stdout/stderr, or commit message.
// `label`/`detail` are content-free strings; the enum is validated so a
// fabricated keyframe kind is rejected (the load-bearing guard a test asserts).

import { z } from 'zod';
import type { Keyframe, ReplaySession } from '@seorak/types';

// The seven moments Seorak can honestly reconstruct from the event log. Mirrors
// KeyframeKind exactly; an unknown kind fails parse so a malformed timeline is
// caught rather than rendered as a blank row.
export const KEYFRAME_KINDS = [
  'session-start',
  'first-tool-call',
  'first-error',
  'verification-failed',
  'peak-burn',
  'biggest-commit',
  'session-end',
] as const;

export const keyframeSchema: z.ZodType<Keyframe> = z.object({
  kind: z.enum(KEYFRAME_KINDS),
  at: z.string(),
  seq: z.number(),
  label: z.string(),
  detail: z.string().optional(),
}) as unknown as z.ZodType<Keyframe>;

export const replayMomentSchema = z.object({
  at: z.string(),
  seq: z.number(),
  kind: z.enum(['tool.call', 'session.notification', 'session.prompt']),
  toolName: z.string().optional(),
  costUsd: z.number().optional(),
  errored: z.boolean().optional(),
  verificationKind: z.string().optional(),
  verificationPassed: z.boolean().optional(),
  fileCategory: z.string().optional(),
  fileLanguage: z.string().optional(),
  undoKind: z.enum(['reset-hard', 'restore', 'clean', 'revert']).optional(),
  notificationType: z.string().optional(),
});

export const replayActivityBucketSchema = z.object({
  at: z.string(),
  bucketMs: z.number(),
  costUsd: z.number(),
  toolCallCount: z.number(),
  tokensTotal: z.number(),
});

export const replayTotalsSchema = z.object({
  costUsd: z.number(),
  tokensTotal: z.number(),
  toolCallCount: z.number(),
  promptCount: z.number(),
  filesTouchedUncommitted: z.number().optional(),
});

export const replaySessionSchema: z.ZodType<ReplaySession> = z.object({
  sessionId: z.string(),
  agent: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  keyframes: z.array(keyframeSchema),
  activity: z.array(replayActivityBucketSchema),
  moments: z.array(replayMomentSchema),
  totals: replayTotalsSchema,
}) as unknown as z.ZodType<ReplaySession>;

export type { Keyframe, ReplaySession };

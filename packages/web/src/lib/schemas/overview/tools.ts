// Tool / model / verification rollup shapes.
import { z } from 'zod';
import type { ToolCallRollup, ModelRollup, VerificationRollup } from '@seorak/types';

export const toolCallRollupSchema: z.ZodType<ToolCallRollup> = z.object({
  tool: z.string(),
  calls: z.number(),
  sessions: z.number(),
}) as unknown as z.ZodType<ToolCallRollup>;

export const verificationRollupSchema: z.ZodType<VerificationRollup> = z.object({
  kind: z.enum(['test', 'build', 'typecheck', 'lint']),
  passRate: z.number().nullable(),
  runs: z.number(),
  passed: z.number(),
}) as unknown as z.ZodType<VerificationRollup>;

export const modelRollupSchema: z.ZodType<ModelRollup> = z.object({
  model: z.string(),
  calls: z.number(),
  tokensTotal: z.number(),
  costUsd: z.number().nullable(),
}) as unknown as z.ZodType<ModelRollup>;

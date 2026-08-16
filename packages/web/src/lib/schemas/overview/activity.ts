// Activity heatmap / clock-hour shapes.
import { z } from 'zod';
import type { HourBucket, AgentHourPoint } from '@seorak/types';

export const hourBucketSchema: z.ZodType<HourBucket> = z.object({
  dow: z.number(),
  hour: z.number(),
  sessions: z.number(),
}) as unknown as z.ZodType<HourBucket>;

export const agentHourPointSchema: z.ZodType<AgentHourPoint> = z.object({
  agent: z.string(),
  hour: z.number(),
  calls: z.number(),
}) as unknown as z.ZodType<AgentHourPoint>;

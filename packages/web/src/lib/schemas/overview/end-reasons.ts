// Session-end reason shapes.
import { z } from 'zod';
import { SESSION_END_REASONS } from '@seorak/types';
import type { EndReasonCount, DailyEndReasons, HourlyEndReasons } from '@seorak/types';

export const endReasonCountSchema: z.ZodType<EndReasonCount> = z.object({
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

export const dailyEndReasonsSchema: z.ZodType<DailyEndReasons> = z.object({
  day: z.string(),
  reasons: z.array(endReasonCountSchema),
}) as unknown as z.ZodType<DailyEndReasons>;

export const hourlyEndReasonsSchema: z.ZodType<HourlyEndReasons> = z.object({
  hour: z.number(),
  reasons: z.array(endReasonCountSchema),
}) as unknown as z.ZodType<HourlyEndReasons>;

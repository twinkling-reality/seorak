// Outcome survival / per-session fate shapes.
import { z } from 'zod';
import type { LineSurvivalRollup, SessionOutcomeRow } from '@seorak/types';

export const lineSurvivalRollupSchema: z.ZodType<LineSurvivalRollup> = z.object({
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

export const sessionOutcomeSchema: z.ZodType<SessionOutcomeRow> = z.object({
  sessionId: z.string(),
  project: z.string(),
  repoId: z.string(),
  endedAt: z.string(),
  status: z.enum(['pending', 'retained', 'overwritten', 'unreachable', 'unknown']),
}) as unknown as z.ZodType<SessionOutcomeRow>;

// Cross-repo momentum / portfolio shapes.
import { z } from 'zod';
import type { RepoMomentum, RepoTemperature, PortfolioMomentum } from '@seorak/types';

export const repoMomentumSchema: z.ZodType<RepoMomentum> = z.object({
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

export const repoTemperatureSchema: z.ZodType<RepoTemperature> = z.object({
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

export const portfolioMomentumSchema: z.ZodType<PortfolioMomentum> = z.object({
  windowDays: z.number(),
  reposTotal: z.number(),
  reposMoved: z.number(),
  reposQuiet: z.number(),
  repos: z.array(repoTemperatureSchema),
}) as unknown as z.ZodType<PortfolioMomentum>;

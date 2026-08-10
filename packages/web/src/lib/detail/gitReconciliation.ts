import type { CodebaseSnapshot, PortfolioMomentum, UsageSnapshot } from '@seorak/types';

export interface GitReconciliationSummary {
  agentAdded: number;
  agentRemoved: number;
  agentNet: number;
  gitCommits: number | null;
  gitFilesTouched: number | null;
  gitNetLines: number | null;
  reposMoved: number | null;
  windowDays: number | null;
}

/**
 * Pair agent edit-volume (usage.lines) with git ground-truth (commitStats /
 * portfolio breadth). Returns null when neither side has measurable data.
 */
export function gitReconciliationSummary(
  lines: NonNullable<UsageSnapshot['lines']>,
  commitStats: CodebaseSnapshot['commitStats'],
  portfolio: PortfolioMomentum,
): GitReconciliationSummary {
  return {
    agentAdded: lines.added,
    agentRemoved: lines.removed,
    agentNet: lines.added - lines.removed,
    gitCommits: commitStats?.commits ?? null,
    gitFilesTouched: commitStats?.filesTouched ?? null,
    gitNetLines: commitStats
      ? commitStats.linesAdded - commitStats.linesDeleted
      : null,
    reposMoved: portfolio.reposMoved > 0 ? portfolio.reposMoved : null,
    windowDays: commitStats?.windowDays ?? portfolio.windowDays ?? null,
  };
}

export function hasGitReconciliation(summary: GitReconciliationSummary): boolean {
  return (
    summary.gitCommits != null ||
    summary.gitFilesTouched != null ||
    summary.reposMoved != null
  );
}

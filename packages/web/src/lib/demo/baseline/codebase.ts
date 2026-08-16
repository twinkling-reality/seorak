// Cross-repo momentum / portfolio (DEMO ONLY).
import type {
  RepoMomentum,
  RepoTemperature,
  PortfolioMomentum,
  CommitStats,
} from '@seorak/types';

interface DemoRepo {
  repoId: string;
  repoLabel: string;
  /** null = moved but history too thin to judge (mirrors the worker). */
  temperature: RepoTemperature['temperature'];
  commits: number;
  filesTouched: number;
  linesAdded: number;
  linesDeleted: number;
  generatedLinesExcluded: number;
  quietDays: number | null;
  baseline: { commits: number; filesTouched: number } | null;
}

const DEMO_REPOS: DemoRepo[] = [
  // The headline repos share the rollup repoIds so the compare view's
  // git-commits row resolves the momentum snapshot by repoId. The other five
  // keep demo-* ids.
  { repoId: 'repo-seorak', repoLabel: 'seorak', temperature: 'heating', commits: 12, filesTouched: 34, linesAdded: 720, linesDeleted: 180, generatedLinesExcluded: 490, quietDays: null, baseline: { commits: 5, filesTouched: 18 } },
  { repoId: 'repo-mobile-surfaces', repoLabel: 'mobile-surfaces', temperature: 'steady', commits: 5, filesTouched: 11, linesAdded: 180, linesDeleted: 60, generatedLinesExcluded: 0, quietDays: null, baseline: { commits: 5, filesTouched: 10 } },
  { repoId: 'repo-feather', repoLabel: 'feather', temperature: 'heating', commits: 4, filesTouched: 8, linesAdded: 126, linesDeleted: 34, generatedLinesExcluded: 0, quietDays: null, baseline: { commits: 1, filesTouched: 3 } },
  { repoId: 'demo-port', repoLabel: 'portfolio-site', temperature: 'cooling', commits: 2, filesTouched: 3, linesAdded: 60, linesDeleted: 100, generatedLinesExcluded: 0, quietDays: null, baseline: { commits: 6, filesTouched: 14 } },
  { repoId: 'demo-dot', repoLabel: 'dotfiles', temperature: null, commits: 1, filesTouched: 2, linesAdded: 12, linesDeleted: 3, generatedLinesExcluded: 0, quietDays: null, baseline: null },
  { repoId: 'demo-notes', repoLabel: 'notes-cli', temperature: 'quiet', commits: 0, filesTouched: 0, linesAdded: 0, linesDeleted: 0, generatedLinesExcluded: 0, quietDays: 9, baseline: { commits: 3, filesTouched: 6 } },
  { repoId: 'demo-blog', repoLabel: 'blog', temperature: 'quiet', commits: 0, filesTouched: 0, linesAdded: 0, linesDeleted: 0, generatedLinesExcluded: 0, quietDays: 4, baseline: { commits: 2, filesTouched: 5 } },
  { repoId: 'demo-maintenance', repoLabel: 'mature-api', temperature: 'quiet', commits: 0, filesTouched: 0, linesAdded: 0, linesDeleted: 0, generatedLinesExcluded: 0, quietDays: 21, baseline: null },
];

export function buildMomentum(): RepoMomentum[] {
  return DEMO_REPOS.map((r) => ({
    repoId: r.repoId,
    repoLabel: r.repoLabel,
    gitContext: 'clean',
    windowDays: 7,
    commits: r.commits,
    filesTouched: r.filesTouched,
    linesAdded: r.linesAdded,
    linesDeleted: r.linesDeleted,
    netLines: r.linesAdded - r.linesDeleted,
    generatedLinesExcluded: r.generatedLinesExcluded,
  }));
}

// Mirror the worker's commitStats build (overview.ts): commit stats are the
// cross-repo SUM of the latest per-repo momentum snapshot. Deriving it from the
// same array means the demo can never drift from `usage.momentum` the way a
// hand-set object would (net lines here == lines-added minus lines-removed on
// the tiles). `commitsFromSessions` is an independent leg (session ship deltas).
export function commitStatsFromMomentum(
  momentum: RepoMomentum[],
  commitsFromSessions: number,
): CommitStats {
  return {
    windowDays: momentum.reduce((max, m) => Math.max(max, m.windowDays), 0),
    commits: momentum.reduce((s, m) => s + m.commits, 0),
    filesTouched: momentum.reduce((s, m) => s + m.filesTouched, 0),
    linesAdded: momentum.reduce((s, m) => s + m.linesAdded, 0),
    linesDeleted: momentum.reduce((s, m) => s + m.linesDeleted, 0),
    generatedLinesExcluded: momentum.reduce((s, m) => s + m.generatedLinesExcluded, 0),
    commitsFromSessions,
  };
}

export function buildPortfolio(): PortfolioMomentum {
  const repos: RepoTemperature[] = DEMO_REPOS.map((r) => ({
    repoId: r.repoId,
    repoLabel: r.repoLabel,
    gitContext: 'clean',
    temperature: r.temperature,
    quietDays: r.quietDays,
    commits: r.commits,
    filesTouched: r.filesTouched,
    netLines: r.linesAdded - r.linesDeleted,
    generatedLinesExcluded: r.generatedLinesExcluded,
    baseline: r.baseline,
  }));
  const reposMoved = repos.filter((r) => r.temperature !== 'quiet').length;
  return {
    windowDays: 7,
    reposTotal: repos.length,
    reposMoved,
    reposQuiet: repos.length - reposMoved,
    repos,
  };
}

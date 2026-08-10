import { useMemo } from 'react';
import type { SessionSummary } from '@seorak/types';
import { useOverview } from '../../hooks/useOverview.js';
import { useRoute } from '../../lib/router.js';
import type { OverviewSnapshot, ProjectRollup } from '../../lib/apiSchemas.js';

// Per-repo lens over the solo user's own sessions. ProjectView scopes one
// ProjectRollup; Overview merges all; Compare reads this rollup over time or,
// explicitly, beside another repo — docs/specs/multi-repo.md.

interface UseProjectDataReturn {
  /** The salted repoId from the route (`/project/:id`) — the stable per-repo key that
   *  disambiguates repos sharing a basename. */
  projectId: string | null;
  /** Display label for the repo (its basename, resolved from the rollup / live board;
   *  the route id is a salted hash, never shown). */
  projectLabel: string;
  /** Whether a rollup exists for this repo in the current snapshot. */
  hasProject: boolean;
  /** Live sessions in this repo. */
  liveSessions: SessionSummary[];
  /** This repo's rollup, or null when the snapshot has no row for it. */
  rollup: ProjectRollup | null;
  /** A snapshot narrowed to this repo, for the shared detail views. */
  scopedOverview: OverviewSnapshot;
  isLoading: boolean;
  error: string | null;
  /** Showing a prior snapshot because the last /overview refresh failed. The view
   *  keeps rendering and shows a reconnecting banner rather than dying. */
  isStale: boolean;
}

/** Narrow the live file signal to one repo: keep only files this repo's
 *  sessions are editing, count only this repo's edits on each, and re-rank.
 *  Each file's `projects[]` split ships per-repo edit/session counts, so this
 *  is a projection, never an estimate. `distinctFiles` becomes a count over
 *  the server-capped shipped list — a floor, honest for the solo scale. */
function scopeFilesInPlay(
  filesInPlay: OverviewSnapshot['codebase']['filesInPlay'],
  repoId: string,
): OverviewSnapshot['codebase']['filesInPlay'] {
  if (!filesInPlay) return null;
  const files = filesInPlay.files
    .flatMap((f) => {
      const own = f.projects.find((p) => p.repoId === repoId);
      return own ? [{ ...f, edits: own.edits, projects: [own] }] : [];
    })
    .sort((a, b) => b.edits - a.edits);
  return files.length > 0 ? { distinctFiles: files.length, files } : null;
}

/** Build a single-repo CommitStats from this repo's latest git.momentum snapshot.
 *  overview.codebase.commitStats sums EVERY repo, so under a one-repo scope it would
 *  show all-repos git counts under a repo header — a silent global leak. Per-repo git
 *  ground-truth is the matching RepoMomentum row (the widget's spine); the
 *  session-attributed `commitsFromSessions` leg now rides the rollup (SCOPE.md Phase 1)
 *  and hangs on that spine — null when the repo reported no measured delta. Null when
 *  the repo has no git snapshot to anchor the widget. */
function repoCommitStats(
  momentum: OverviewSnapshot['usage']['momentum'],
  repoId: string | null,
  commitsFromSessions: number | null,
): OverviewSnapshot['codebase']['commitStats'] {
  if (!repoId) return null;
  const m = momentum.find((row) => row.repoId === repoId);
  if (!m) return null;
  return {
    windowDays: m.windowDays,
    commits: m.commits,
    filesTouched: m.filesTouched,
    linesAdded: m.linesAdded,
    linesDeleted: m.linesDeleted,
    generatedLinesExcluded: m.generatedLinesExcluded,
    commitsFromSessions,
  };
}

/** Narrow an OverviewSnapshot to a single repo. Scalars derivable from current
 *  session state are recomputed from the repo's own live sessions + rollup;
 *  fields backed by the retained event log or deeper per-call capture stay empty
 *  until that data accrues, so the scoped widgets render the same honest empty
 *  states as the overview. */
export function scopeToProject(
  overview: OverviewSnapshot,
  projectId: string | null,
  liveSessions: SessionSummary[],
  rollup: ProjectRollup | null,
): OverviewSnapshot {
  if (!projectId) return overview;
  // The route id IS the salted repoId now (SCOPE.md Phase 0 re-key); it keys the live
  // board and every per-repo leg (momentum, commitStats, bySession) directly, so a repo
  // with live sessions but no rollup row still narrows honestly instead of leaking.
  const repoId = projectId;
  const repoLive = overview.live.filter((s) => s.repoId === repoId);
  // Per-repo cost-per-edit + line volume now ride the rollup (SCOPE.md Phase 1):
  // window cost ÷ edit-family calls, and the edit-tool added/removed with the prior
  // window's added leg for the delta pill. null honest-empty when the repo has no
  // priced row (winCost null) or no measured edit (editCalls 0), never a fabricated 0.
  const winCost = rollup?.costDelta?.current ?? null;
  const editCalls = rollup?.editCalls ?? 0;
  const costPerEdit = winCost != null && winCost > 0 && editCalls > 0 ? winCost / editCalls : null;
  const repoLines = rollup?.lines ?? null;
  const lines = repoLines
    ? {
        added: repoLines.added,
        removed: repoLines.removed,
        delta: { current: repoLines.added, previous: repoLines.priorAdded },
      }
    : null;
  return {
    ...overview,
    live: repoLive,
    usage: {
      ...overview.usage,
      totals: {
        sessions: rollup?.sessions ?? repoLive.length,
        toolCalls: rollup?.toolCalls ?? repoLive.reduce((s, x) => s + x.toolCallCount, 0),
        // The per-repo adjacent-window start leg is projected from the same
        // widened event-log read as the global period comparison.
        sessionsDelta: rollup?.sessionsDelta ?? null,
      },
      cost: {
        // Source this repo's window cost from the rollup (KV + event-log hybrid),
        // NOT the live board: the live board holds only currently-resident sessions,
        // so an ended costed session would drop and the figure would undercount.
        // null (never $0) when the repo reported no cost. sessionsWithCost is the
        // "--" gate only (never displayed) — mirror totalUsd's null-ness (SCOPE.md
        // "null-gate from all-null costUsd").
        totalUsd: rollup?.costUsd ?? null,
        sessionsWithCost: rollup?.costUsd != null ? 1 : 0,
        // Per-repo cost period-over-period rides the rollup (the SAME adjacent
        // windows as the global delta); null suppresses the pill honestly.
        delta: rollup?.costDelta ?? null,
      },
      projects: rollup ? [rollup] : [],
      // Formerly-global usage fields that leaked the all-repos value under a repo
      // header (SCOPE.md Phase 0). cacheReuseRatio / costPerEdit / lines now ride the
      // rollup's per-repo legs (SCOPE.md Phase 1, derived above); dailyTrends rides
      // this repo's own daily series; momentum narrows to THIS repo's snapshot.
      // Portfolio breadth is cross-repo by definition, so it is honest-empty
      // (never "moved X of N repos" under one repo).
      cacheReuseRatio: rollup?.cacheReuseRatio ?? null,
      costPerEdit,
      lines,
      dailyTrends: rollup?.dailyTrends ?? [],
      momentum: repoId ? overview.usage.momentum.filter((m) => m.repoId === repoId) : [],
      portfolio: {
        windowDays: overview.usage.portfolio.windowDays,
        reposTotal: 0,
        reposMoved: 0,
        reposQuiet: 0,
        repos: [],
      },
    },
    outcomes: {
      ...overview.outcomes,
      activeCount: liveSessions.filter((s) => s.status !== 'ended').length,
      endedCount: liveSessions.filter((s) => s.status === 'ended').length,
      // Per-repo end reasons + scalars now ride the rollup (DA-06 real fix);
      // override the global spread so these tiles render THIS repo, never the
      // all-repos aggregate under a repo header.
      endReasons: rollup?.endReasons ?? [],
      shipRate: rollup?.shipRate ?? null,
      oneShotRate: rollup?.oneShotRate ?? null,
      stuckness: rollup?.stuckness ?? { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
      lineSurvival: rollup?.lineSurvival ?? {
        rate: null,
        linesAuthored: 0,
        linesSurviving: 0,
        commitsChecked: 0,
        sessionsRated: 0,
        retained: 0,
        overwritten: 0,
        unreachable: 0,
        unknown: 0,
      },
      // Global-only daily series → honest-empty under scope (the outcome-trend tile
      // read the all-repos series before; SCOPE.md Phase 0). Per-session outcome rows
      // filter to THIS repo (each row carries repoId); honest-empty without a rollup.
      endReasonsByDay: [],
      bySession: repoId ? overview.outcomes.bySession.filter((r) => r.repoId === repoId) : [],
    },
    tools: {
      ...overview.tools,
      callStats: {
        totalCalls: rollup?.toolCalls ?? repoLive.reduce((s, x) => s + x.toolCallCount, 0),
        // Per-repo error rate from the rollup (DA-06); null honest-empty without it.
        errorRate: rollup?.errorRate ?? null,
      },
      // Per-repo tool/model/agent mix from the rollup (DA-06); honest-empty [] without it.
      byTool: rollup?.byTool ?? [],
      byModel: rollup?.byModel ?? [],
      verification: rollup?.verification ?? [],
      // Per-repo agent rollup (Agents → Projects). Never the global byAgent under
      // a repo header — only this repo's legs (SCOPE.md).
      byAgent: rollup?.byAgent ?? [],
      // The remaining agent series (daily, per-model, git outcomes) are global-only:
      // no per-repo legs exist yet, so they go honest-empty under scope rather than
      // spreading the all-repos series under a repo header.
      agentDaily: [],
      agentModels: [],
      agentOutcomes: [],
      agentOutcomesUnusable: 0,
    },
    activity: {
      ...overview.activity,
      // Per-repo session rhythm + per-hour end reasons from the rollup (DA-06);
      // honest-empty [] without it. agentHourly is global-only, so honest-empty
      // under scope like the other agent series.
      hourlyDistribution: rollup?.hourlyDistribution ?? [],
      endReasonsByHour: rollup?.endReasonsByHour ?? [],
      agentHourly: [],
    },
    codebase: {
      ...overview.codebase,
      files: rollup?.codebaseFiles ?? [],
      directories: rollup?.codebaseDirectories ?? [],
      rework: rollup?.codebaseRework ?? [],
      filesInPlay: scopeFilesInPlay(overview.codebase.filesInPlay, projectId),
      // The global commitStats sums every repo; narrow to THIS repo's latest git
      // snapshot (honest-empty when none) so commits / net-lines never show all-repos
      // git counts under a repo header (SCOPE.md Phase 0).
      commitStats: repoCommitStats(overview.usage.momentum, repoId, rollup?.commitsFromSessions ?? null),
    },
  };
}

export function resolveProjectRouteId(
  overview: OverviewSnapshot,
  routeProjectId: string | null,
): string | null {
  if (!routeProjectId) return null;
  if (overview.usage.projects.some((p) => p.repoId === routeProjectId)) return routeProjectId;

  const basenameMatches = overview.usage.projects.filter((p) => p.project === routeProjectId);
  if (basenameMatches.length === 1) return basenameMatches[0].repoId;
  return routeProjectId;
}

export function useProjectData(rangeDays: 7 | 30 | 90 = 7): UseProjectDataReturn {
  const route = useRoute();
  const routeProjectId = route.projectId;
  const { overview, isLoading, error, isStale } = useOverview(rangeDays);
  const projectId = useMemo(
    () => resolveProjectRouteId(overview, routeProjectId),
    [overview, routeProjectId],
  );

  const liveSessions = useMemo(() => {
    const all = overview.live;
    return projectId ? all.filter((s) => s.repoId === projectId) : all;
  }, [overview, projectId]);

  const rollup = useMemo<ProjectRollup | null>(
    () => overview.usage.projects.find((p) => p.repoId === projectId) ?? null,
    [overview.usage.projects, projectId],
  );

  const scopedOverview = useMemo(
    () => scopeToProject(overview, projectId, liveSessions, rollup),
    [overview, projectId, liveSessions, rollup],
  );

  const hasProject = rollup !== null || liveSessions.length > 0;

  return {
    projectId,
    // The route id is a salted hash; the human label is the basename off the rollup
    // (or the live board when this repo has sessions but no rollup row yet).
    projectLabel: rollup?.project ?? liveSessions[0]?.project ?? 'this repo',
    hasProject,
    liveSessions,
    rollup,
    scopedOverview,
    isLoading,
    error,
    isStale,
  };
}

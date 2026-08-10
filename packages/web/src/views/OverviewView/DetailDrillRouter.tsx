import { navigateToReplay } from '../../lib/router.js';
import type { SessionSummary } from '@seorak/types';
import type { Intervention, OverviewSnapshot } from '../../lib/apiSchemas.js';
import type { DetailDrills } from '../../hooks/useDetailDrills.js';
import LiveNowView from './LiveNowView.js';
import UsageDetailView from './UsageDetailView/UsageDetailView.js';
import OutcomesDetailView from './OutcomesDetailView/OutcomesDetailView.js';
import ActivityDetailView from './ActivityDetailView/ActivityDetailView.js';
import ToolsDetailView from './ToolsDetailView/ToolsDetailView.js';
import CodebaseDetailView from './CodebaseDetailView/CodebaseDetailView.js';
import type { RangeDays } from './overview-utils.js';
import type { DataStatus } from '../../lib/stores/pollingTypes.js';

export interface DetailDrillRouterProps {
  /** The shared drill chain (one query-param per detail category). */
  drills: DetailDrills['drills'];
  /** Close every open drill (the live board's Back + the replay handoff use it). */
  closeAll: () => void;
  /** Snapshot the detail views read — full (Overview) or repo-scoped (Project). */
  overview: OverviewSnapshot;
  liveSessions: SessionSummary[];
  /** Fired interventions for the outcomes Watch tab (honest-empty []). */
  interventions: Intervention[];
  interventionsStatus: DataStatus;
  focusSessionId: string | null;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
  /**
   * Breadcrumb label on each detail's Back button. Overview omits it (the views
   * default to "Overview"); Project passes "Project".
   */
  backLabel?: string;
  /** Live-board empty-state scope wording (Project passes "in this repo"). */
  scopeLabel?: string;
  /** Codebase cross-repo panel — Project hides it (single repo). Default true. */
  showCrossRepo?: boolean;
  /**
   * Opens a repo's Project view from the usage Projects tab. Only Overview passes
   * it (cross-repo); when omitted the Projects tab is dropped. The router closes
   * the usage drill first so the route change starts from a clean URL.
   */
  onOpenProject?: (repoId: string) => void;
}

/**
 * The single place the six detail views are mounted. Both OverviewView and
 * ProjectView drill into the SAME detail surfaces from the SAME drill chain, so
 * this component is that shared mount — the two dashboards cannot drift in which
 * views exist or how their props are wired (audit D6). It renders only the
 * active drill (or null when none is open); the caller owns the RouteTransition
 * wrapper and the non-drill dashboard body.
 *
 * The per-view prop differences between the two dashboards are the props above:
 * `overview` (full vs scoped), `backLabel`, `scopeLabel`, `showCrossRepo`, and
 * `onOpenProject`. Everything else is identical, which is exactly why one mount
 * can serve both.
 */
export function DetailDrillRouter({
  drills,
  closeAll,
  overview,
  liveSessions,
  interventions,
  interventionsStatus,
  focusSessionId,
  rangeDays,
  onRangeChange,
  backLabel,
  scopeLabel,
  showCrossRepo,
  onOpenProject,
}: DetailDrillRouterProps) {
  const { live, usage, outcomes, activity, tools, codebase } = drills;

  if (live.shifted) {
    return (
      <LiveNowView
        liveSessions={liveSessions}
        filesInPlay={overview.codebase.filesInPlay}
        focusSessionId={focusSessionId}
        onBack={closeAll}
        backLabel={backLabel}
        scopeLabel={scopeLabel}
        onOpenReplay={(sessionId, repoId) => {
          closeAll();
          navigateToReplay(sessionId, repoId);
        }}
      />
    );
  }
  if (usage.shifted) {
    return (
      <UsageDetailView
        overview={overview}
        initialTab={usage.param}
        onBack={usage.close}
        rangeDays={rangeDays}
        onRangeChange={onRangeChange}
        backLabel={backLabel}
        onOpenProject={
          onOpenProject
            ? (repoId) => {
                usage.close();
                onOpenProject(repoId);
              }
            : undefined
        }
      />
    );
  }
  if (outcomes.shifted) {
    return (
      <OutcomesDetailView
        overview={overview}
        fired={interventions}
        firedStatus={interventionsStatus}
        initialTab={outcomes.param}
        onBack={outcomes.close}
        rangeDays={rangeDays}
        onRangeChange={onRangeChange}
        backLabel={backLabel}
      />
    );
  }
  if (activity.shifted) {
    return (
      <ActivityDetailView
        overview={overview}
        initialTab={activity.param}
        onBack={activity.close}
        rangeDays={rangeDays}
        onRangeChange={onRangeChange}
        backLabel={backLabel}
      />
    );
  }
  if (tools.shifted) {
    return (
      <ToolsDetailView
        overview={overview}
        initialTab={tools.param}
        onBack={tools.close}
        rangeDays={rangeDays}
        onRangeChange={onRangeChange}
        backLabel={backLabel}
      />
    );
  }
  if (codebase.shifted) {
    return (
      <CodebaseDetailView
        overview={overview}
        initialTab={codebase.param}
        onBack={codebase.close}
        rangeDays={rangeDays}
        onRangeChange={onRangeChange}
        backLabel={backLabel}
        showCrossRepo={showCrossRepo}
      />
    );
  }
  return null;
}

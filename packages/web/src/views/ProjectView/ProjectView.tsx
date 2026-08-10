import { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
} from '@dnd-kit/core';
import {
  snapChipToCursor,
} from '../../components/WidgetGrid/WidgetGrid.js';

import { forceRefresh } from '../../lib/stores/polling.js';
import { navigate, navigateToCompare } from '../../lib/router.js';
import { isDemoActive } from '../../lib/demoMode.js';
import StatusState from '../../components/StatusState/StatusState.jsx';
import OverviewStaleBanner from '../../components/Banner/OverviewStaleBanner.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import CustomizeButton from '../../components/CustomizeButton/CustomizeButton.jsx';
import RangePills from '../../components/RangePills/RangePills.jsx';
import {
  ShimmerText,
  SkeletonStatGrid,
  SkeletonRows,
  SkeletonLine,
} from '../../components/Skeleton/Skeleton.jsx';

import { useProjectData } from './useProjectData.js';
import { useAllowedRanges, useInterventions } from '../../hooks/useOverview.js';
import { useProjectDashboardLayout } from './useProjectTabLayout.js';
import { PROJECT_DEFAULT_LAYOUT } from './projectTabDefaults.js';
import { useDetailDrills } from '../../hooks/useDetailDrills.js';
import { useCustomizeHotkey } from '../../hooks/useCustomizeHotkey.js';
import { useWidgetGridDrag } from '../../hooks/useWidgetGridDrag.js';
import { useIsMobile } from '../../hooks/useMediaQuery.js';
import { useCaptureSettings } from '../../hooks/useCaptureSettings.js';
import {
  useAnnouncer,
  useDashboardLayoutActions,
  useRecentlyAdded,
  useUndoHotkey,
} from '../../hooks/useDashboardChrome.js';
import { RouteTransition, dashboardDrillKey } from '../../motion/index.js';
import { DetailDrillRouter } from '../OverviewView/DetailDrillRouter.js';

import { WidgetGrid } from '../../components/WidgetGrid/WidgetGrid.js';
import { WidgetRenderer } from '../../widgets/WidgetRenderer.js';
import { DeferredWidgetCatalog } from '../../widgets/DeferredWidgetCatalog.js';
import { getWidget } from '../../widgets/catalog/index.js';

import chromeStyles from '../../styles/dashboardChrome.module.css';
import styles from './ProjectView.module.css';

// ── Main component ──────────────────────────────

export default function ProjectView() {
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(7);
  const {
    projectId,
    projectLabel,
    hasProject,
    liveSessions,
    scopedOverview,
    isLoading,
    error,
    isStale,
  } = useProjectData(rangeDays);
  const ranges = useAllowedRanges();
  const {
    interventions,
    status: interventionsStatus,
  } = useInterventions();

  const [catalogOpen, setCatalogOpen] = useState(false);
  const captureSettings = useCaptureSettings();
  const { announcement, announce } = useAnnouncer();
  const { recentlyAddedId, setRecentlyAddedId } = useRecentlyAdded();
  const isMobile = useIsMobile();

  // Detail-drill chain shared with OverviewView. Project mounts the same six
  // detail components (via DetailDrillRouter), scoped to this repo's snapshot.
  const { drills, anyOpen, activeKey, closeAll } = useDetailDrills();
  const { live } = drills;
  const focusSessionId = live.param && live.param.length > 0 ? live.param : null;

  const dashboardLayout = useProjectDashboardLayout('dashboard', PROJECT_DEFAULT_LAYOUT);

  const layoutActions = useDashboardLayoutActions({
    widgetIds: dashboardLayout.widgetIds,
    toggleWidget: dashboardLayout.toggleWidget,
    addWidgets: dashboardLayout.addWidgets,
    removeWidget: dashboardLayout.removeWidget,
    clearAll: dashboardLayout.clearAll,
    announce,
    setRecentlyAddedId,
  });

  const handleResetToDefault = useCallback(() => {
    dashboardLayout.resetToDefault();
    announce('Restored default layout');
  }, [dashboardLayout, announce]);

  // ── Drag context for the project dashboard (catalog drop + reorder) ──
  const slotIds = useMemo(() => dashboardLayout.slots.map((slot) => slot.id), [dashboardLayout.slots]);
  const {
    sensors,
    catalogDragging,
    sortableDragging,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  } = useWidgetGridDrag({
    slotIds,
    onCatalogInsert: useCallback(
      (widgetId, insertIndex) => {
        dashboardLayout.addWidgetAt(widgetId, insertIndex);
        const def = getWidget(widgetId);
        if (def) announce(`Added ${def.name}`);
        setRecentlyAddedId(widgetId);
      },
      [dashboardLayout, announce],
    ),
    onReorder: dashboardLayout.reorderWidgets,
  });

  useCustomizeHotkey({
    enabled: !isMobile && !anyOpen,
    onToggle: useCallback(() => setCatalogOpen((open) => !open), []),
  });

  const openProject = useCallback((repoId: string) => {
    navigate('project', repoId);
  }, []);

  // Stable render callback for WidgetGrid. Bodies read the repo-scoped snapshot
  // plus its live sessions; openProject re-points to another repo.
  const renderWidget = useCallback(
    (id: string) => (
      <WidgetRenderer
        widgetId={id}
        overview={scopedOverview}
        liveSessions={liveSessions}
        openProject={openProject}
        capture={captureSettings}
      />
    ),
    [scopedOverview, liveSessions, openProject, captureSettings],
  );

  // Cmd/Ctrl-Z to undo layout changes (matches OverviewView behavior).
  useUndoHotkey(dashboardLayout.undo, announce);

  // ── Loading guard ──
  if (isLoading) {
    return (
      <div className={styles.page}>
        <header style={{ marginBottom: 28 }}>
          <span className={styles.loadingEyebrow}>Project</span>
          <ShimmerText as="h1" className={styles.loadingTitle}>
            {`Loading ${projectLabel}`}
          </ShimmerText>
        </header>
        <SkeletonStatGrid count={4} />
        <div style={{ marginTop: 40 }}>
          <SkeletonLine width="100%" height={32} />
        </div>
        <div style={{ marginTop: 28 }}>
          <SkeletonRows count={4} columns={3} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <StatusState
          tone="danger"
          eyebrow="Project unavailable"
          title={`Could not load ${projectLabel}`}
          hint="This repo's overview is temporarily unavailable."
          detail={error}
          meta="Project"
          actionLabel="Retry"
          onAction={forceRefresh}
        />
      </div>
    );
  }

  if (!hasProject) {
    return (
      <div className={styles.page}>
        <StatusState
          tone="neutral"
          eyebrow="Project"
          title={`No activity for ${projectLabel}`}
          hint="No sessions have been tracked for this repo yet."
          meta="Project"
          actionLabel="Back to overview"
          onAction={() => navigate('overview')}
        />
      </div>
    );
  }

  // The last /overview refresh failed but we still hold a prior snapshot: keep the
  // dashboard up and float a non-blocking "reconnecting" cue rather than blanking the
  // whole view (a transient worker 503 must not read as "this project is gone").
  const staleBanner = <OverviewStaleBanner visible={isStale} />;

  const activeSlots = dashboardLayout.slots.filter((s) => getWidget(s.id));

  // Detail-drill render. Both dashboards mount the SAME six detail views from the
  // SAME drill chain via DetailDrillRouter (audit D6); Project scopes them to this
  // repo's snapshot, labels Back "Project", and hides the cross-repo panel. The
  // Projects tab is dropped by omitting onOpenProject (this IS a single repo).
  if (anyOpen) {
    return (
      <RouteTransition
        routeKey={dashboardDrillKey('project', activeKey)}
        preset="dashboard-detail"
      >
        {staleBanner}
        <DetailDrillRouter
          drills={drills}
          closeAll={closeAll}
          overview={scopedOverview}
          liveSessions={liveSessions}
          interventions={interventions}
          interventionsStatus={interventionsStatus}
          focusSessionId={focusSessionId}
          rangeDays={rangeDays}
          onRangeChange={setRangeDays}
          backLabel="Project"
          scopeLabel="in this repo"
          showCrossRepo={false}
        />
      </RouteTransition>
    );
  }

  return (
    <RouteTransition
      routeKey={dashboardDrillKey('project', null)}
      preset="dashboard-detail"
    >
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {staleBanner}
        <div className={styles.page}>
          <section className={styles.header}>
            <ViewHeader eyebrow="Project" title={projectLabel} demo={isDemoActive()} />

            <div className={chromeStyles.rangeRow}>
              <div className={chromeStyles.controlTray}>
                {projectId && (
                  <button
                    type="button"
                    className={styles.comparePeriods}
                    onClick={() =>
                      navigateToCompare({ scope: projectId, range: rangeDays })
                    }
                  >
                    Compare periods
                  </button>
                )}
                {!isMobile && (
                  <CustomizeButton
                    active={catalogOpen}
                    onClick={() => setCatalogOpen(!catalogOpen)}
                    ariaLabel={`Customize project, ${dashboardLayout.widgetIds.length.toLocaleString()} widgets`}
                    count={dashboardLayout.widgetIds.length.toLocaleString()}
                    kbd="c"
                  />
                )}
                <RangePills value={rangeDays} onChange={setRangeDays} options={ranges} />
              </div>
            </div>
          </section>

          <section className={styles.vizArea}>
            <div className={styles.vizPanel}>
              <div className={chromeStyles.gridBleed}>
                <WidgetGrid
                  slots={activeSlots}
                  recentlyAddedId={recentlyAddedId}
                  renderWidget={renderWidget}
                  onReorder={dashboardLayout.reorderWidgets}
                  onRemove={layoutActions.removeWidget}
                />
              </div>
            </div>
          </section>

          <DeferredWidgetCatalog
            open={catalogOpen}
            onClose={() => setCatalogOpen(false)}
            widgetIds={dashboardLayout.widgetIds}
            toggleWidget={layoutActions.toggleWidget}
            onAddWidgets={layoutActions.addWidgets}
            resetToDefault={handleResetToDefault}
            clearAll={layoutActions.clearAll}
            viewScope="project"
            overview={scopedOverview}
            capture={captureSettings}
          />
        </div>

        <div role="status" aria-live="polite" aria-atomic="true" className={styles.srOnly}>
          {announcement}
        </div>
        <DragOverlay
          dropAnimation={null}
          modifiers={catalogDragging ? [snapChipToCursor] : undefined}
        >
          {catalogDragging ? (
            <div className={chromeStyles.dragOverlayCard}>
              <span className={chromeStyles.dragOverlayName}>{catalogDragging.name}</span>
            </div>
          ) : sortableDragging ? (
            <div
              className={chromeStyles.dragOverlayWidget}
              style={{ width: sortableDragging.w, height: sortableDragging.h }}
            >
              {renderWidget(sortableDragging.id)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </RouteTransition>
  );
}

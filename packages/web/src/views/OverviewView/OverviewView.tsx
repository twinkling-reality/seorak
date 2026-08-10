import {
  lazy,
  Suspense,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import clsx from 'clsx';
import {
  DndContext,
  DragOverlay,
} from '@dnd-kit/core';
import {
  snapChipToCursor,
} from '../../components/WidgetGrid/WidgetGrid.js';

import { forceRefresh } from '../../lib/stores/polling.js';
import { useAuthStore } from '../../lib/stores/auth.js';
import { isReadyForFullLayout } from '../../lib/widgetReadiness.js';
import { getColorHex } from '../../lib/utils.js';
import { navigate } from '../../lib/router.js';
import { isDemoActive } from '../../lib/demoMode.js';
import { projectGradient } from '../../lib/projectGradient.js';
import { projectSquircleKey } from '../../components/ProjectSquircle/ProjectSquircle.js';
import { RouteTransition, dashboardDrillKey } from '../../motion/index.js';
import { useAllowedRanges, useOverview, useInterventions } from '../../hooks/useOverview.js';
import { useCustomizeHotkey } from '../../hooks/useCustomizeHotkey.js';
import { useWidgetGridDrag } from '../../hooks/useWidgetGridDrag.js';
import { useDetailDrills } from '../../hooks/useDetailDrills.js';
import { useIsMobile } from '../../hooks/useMediaQuery.js';
import { useCaptureSettings } from '../../hooks/useCaptureSettings.js';
import {
  useAnnouncer,
  useDashboardLayoutActions,
  useRecentlyAdded,
  useUndoHotkey,
} from '../../hooks/useDashboardChrome.js';
import EmptyState from '../../components/EmptyState/EmptyState.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import OverviewStaleBanner from '../../components/Banner/OverviewStaleBanner.jsx';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import CustomizeButton from '../../components/CustomizeButton/CustomizeButton.jsx';
import { ChatTrigger } from '../../chat/index.js';
import RangePills from '../../components/RangePills/RangePills.jsx';
import LiveFreshness from '../../components/LiveFreshness/LiveFreshness.jsx';
import {
  ShimmerText,
  SkeletonStatGrid,
  SkeletonRows,
} from '../../components/Skeleton/Skeleton.jsx';
import { DetailDrillRouter } from './DetailDrillRouter.js';
import { type RangeDays } from './overview-utils.js';
import { useOverviewLayout } from './useOverviewLayout.js';
import { getWidget } from '../../widgets/catalog/index.js';
import { WidgetRenderer } from '../../widgets/WidgetRenderer.js';
import { DeferredWidgetCatalog } from '../../widgets/DeferredWidgetCatalog.js';

import styles from './OverviewView.module.css';
import chromeStyles from '../../styles/dashboardChrome.module.css';
import glass from '../../components/surface/glass.module.css';
import glassTrigger from '../../components/controls/glassTrigger.module.css';
import { WidgetGrid } from '../../components/WidgetGrid/WidgetGrid.js';
import CollectionPanel from '../../components/CollectionPanel/CollectionPanel.js';
import ProjectDropdown, {
  ProjectDropdownItem,
  ProjectDropdownItemName,
  ProjectDropdownStatic,
  ProjectDropdownStaticLabel,
  ProjectDropdownSwatch,
} from '../../components/ProjectDropdown/ProjectDropdown.js';

const LazyPeriodClarityReveal = lazy(() => import('./LazyPeriodClarityReveal.js'));

// ── Repo Filter ───────────────────────────────────
//
// The team multi-select collapses to a simple per-repo lens over the solo
// user's own sessions. Repos are the distinct `project` values surfaced by
// Repo navigator — NOT a filter (docs/specs/multi-repo.md). Overview stays merged;
// this menu opens one Project view. Repo compare (A vs B) is a separate route.

interface RepoOption {
  /** Display label (repo basename); may collide across repos. */
  project: string;
  /** Salted per-repo id — the stable key the project route navigates on. */
  repoId: string;
}

function RepoFilter({
  repos,
  onOpenProject,
}: {
  repos: RepoOption[];
  onOpenProject: (repoId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (repos.length === 0) return null;

  if (repos.length === 1) {
    const only = repos[0];
    return (
      <ProjectDropdownStatic title={only.project}>
        <ProjectDropdownSwatch style={{ background: projectGradient(projectSquircleKey(only.repoId, only.project)) }} />
        <ProjectDropdownStaticLabel>{only.project}</ProjectDropdownStaticLabel>
      </ProjectDropdownStatic>
    );
  }

  return (
    <ProjectDropdown
      ariaLabel={`Open projects, ${repos.length} repos available`}
      trigger="Projects"
      open={open}
      onOpenChange={setOpen}
    >
      {repos.map((r) => (
        <ProjectDropdownItem
          key={r.repoId}
          role="menuitem"
          onClick={() => {
            onOpenProject(r.repoId);
            setOpen(false);
          }}
        >
          <ProjectDropdownSwatch style={{ background: projectGradient(projectSquircleKey(r.repoId, r.project)) }} />
          <ProjectDropdownItemName>{r.project}</ProjectDropdownItemName>
        </ProjectDropdownItem>
      ))}
    </ProjectDropdown>
  );
}

// ── Main Component ────────────────────────────────

export default function OverviewView() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(7);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [periodLoaded, setPeriodLoaded] = useState(false);

  const { overview, isLoading, error, isStale } = useOverview(rangeDays);
  const ranges = useAllowedRanges();
  const {
    interventions,
    status: interventionsStatus,
  } = useInterventions();
  const user = useAuthStore((s) => s.user);
  const userColor = getColorHex(user?.color ?? '') || '#121317';

  // The live board and per-repo filter options share the same snapshot.
  const liveSessions = overview.live;
  const repos = useMemo<RepoOption[]>(
    () => overview.usage.projects.map((p) => ({ project: p.project, repoId: p.repoId })),
    [overview.usage.projects],
  );
  const hasAnyData = liveSessions.length > 0 || repos.length > 0;

  // Detail drill chain (live / usage / outcomes / activity / tools). The
  // shared hook tracks one query-param per category so ProjectView can mount
  // the same detail surfaces from the same helper.
  const { drills, anyOpen, activeKey, closeAll } = useDetailDrills();
  const { live } = drills;
  const focusSessionId = live.param && live.param.length > 0 ? live.param : null;

  const openProject = useCallback((repoId: string) => {
    navigate('project', repoId);
  }, []);

  const {
    widgetIds,
    slots,
    toggleWidget: toggleWidgetRaw,
    addWidgets,
    addWidgetAt,
    removeWidget: removeWidgetRaw,
    reorderWidgets,
    resetToDefault,
    promoteToFullLayout,
    clearAll: clearAllRaw,
    undo,
  } = useOverviewLayout();

  const captureSettings = useCaptureSettings();
  const promotedRef = useRef(false);

  const isMobile = useIsMobile();

  // Visually-hidden live region for screen-reader announcements when
  // widgets are added/removed/restored.
  const { announcement, announce } = useAnnouncer();

  useEffect(() => {
    if (!overview || promotedRef.current) return;
    if (!isReadyForFullLayout(overview, captureSettings)) return;
    if (promoteToFullLayout()) {
      promotedRef.current = true;
      announce('Expanded your dashboard as more stats became ready');
    }
  }, [overview, captureSettings, promoteToFullLayout, announce]);

  // Trigger for scroll + highlight. Cleared after GridContainer picks it up.
  const { recentlyAddedId, setRecentlyAddedId } = useRecentlyAdded();

  const layoutActions = useDashboardLayoutActions({
    widgetIds,
    toggleWidget: toggleWidgetRaw,
    addWidgets,
    removeWidget: removeWidgetRaw,
    clearAll: clearAllRaw,
    announce,
    setRecentlyAddedId,
  });

  const handleResetToDefault = useCallback(() => {
    resetToDefault(overview, captureSettings);
    announce(
      isReadyForFullLayout(overview, captureSettings)
        ? 'Restored full default layout'
        : 'Restored starter layout',
    );
  }, [resetToDefault, overview, captureSettings, announce]);

  // ── Drag context (covers both catalog drag AND grid reorder) ──
  const slotIds = useMemo(() => slots.map((slot) => slot.id), [slots]);
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
        addWidgetAt(widgetId, insertIndex);
        const def = getWidget(widgetId);
        if (def) announce(`Added ${def.name}`);
        setRecentlyAddedId(widgetId);
      },
      [addWidgetAt, announce],
    ),
    onReorder: reorderWidgets,
  });

  // Stable render callback for WidgetGrid. Each body reads from the single
  // OverviewSnapshot plus the adapter-derived live board; openProject drills
  // into a repo's ProjectView.
  const renderWidget = useCallback(
    (id: string) => (
      <WidgetRenderer
        widgetId={id}
        overview={overview}
        liveSessions={liveSessions}
        openProject={openProject}
        capture={captureSettings}
      />
    ),
    [overview, liveSessions, openProject, captureSettings],
  );

  // Cmd/Ctrl-Z to undo layout changes.
  useUndoHotkey(undo, announce);

  useCustomizeHotkey({
    enabled: !isMobile && !anyOpen,
    onToggle: useCallback(() => setCatalogOpen((open) => !open), []),
  });

  // ── Guards ──────────────────────────────────────
  if (isLoading) {
    return (
      <div className={styles.overview}>
        <section className={styles.header}>
          <span className={styles.eyebrow}>Overview</span>
          <ShimmerText as="h1" className={styles.loadingTitle}>
            Loading your sessions
          </ShimmerText>
          <SkeletonStatGrid count={4} />
        </section>
        <SkeletonRows count={3} columns={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.overview}>
        <StatusState
          tone="danger"
          eyebrow="Overview unavailable"
          title="Could not load your overview"
          hint="We could not load your overview right now."
          detail={error}
          meta="Overview"
          actionLabel="Retry"
          onAction={forceRefresh}
        />
      </div>
    );
  }

  if (!hasAnyData) {
    return (
      <div className={styles.overview}>
        <EmptyState
          large
          title="No sessions yet"
          hint={
            <>
              Use Claude Code or Codex and your sessions appear here. If you just ran{" "}
              <code>seorak init</code>, restart Claude Code so the hooks load.
            </>
          }
        />
      </div>
    );
  }

  // Active widgets with valid definitions.
  const activeSlots = slots.filter((s) => Boolean(getWidget(s.id)));

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={styles.overview}>
        {/* Last refresh failed but a prior snapshot is up: float a non-blocking
          * reconnecting cue instead of dropping to the full-death error card. */}
        <OverviewStaleBanner visible={isStale} />
        <RouteTransition
          routeKey={dashboardDrillKey('overview', activeKey)}
          preset="dashboard-detail"
        >
          {anyOpen ? (
            <DetailDrillRouter
              drills={drills}
              closeAll={closeAll}
              overview={overview}
              liveSessions={liveSessions}
              interventions={interventions}
              interventionsStatus={interventionsStatus}
              focusSessionId={focusSessionId}
              rangeDays={rangeDays}
              onRangeChange={setRangeDays}
              onOpenProject={openProject}
            />
          ) : (
            <>
              <CollectionPanel overview={overview} capture={captureSettings} />

              {/* ── Header ── (light; the interactive controls are grouped into a
                * subtle .controlTray so they read as one anchored cluster instead
                * of floating on the page. Token-based fill, so it holds in both
                * light and dark mode; LiveFreshness stays outside on the right as
                * a status readout, not a control.) */}
              <section className={styles.header}>
                <ViewHeader
                  eyebrow="Overview"
                  demo={isDemoActive()}
                  title={
                    <>
                      Welcome back
                      {user?.handle ? (
                        <>
                          {', '}
                          <span style={{ color: userColor }}>{user.handle}</span>
                        </>
                      ) : null}
                      .
                    </>
                  }
                />

                <div className={chromeStyles.rangeRow}>
                  <div className={chromeStyles.controlTray}>
                    <RepoFilter repos={repos} onOpenProject={openProject} />
                    {!isMobile && (
                      <CustomizeButton
                        active={catalogOpen}
                        onClick={() => setCatalogOpen(!catalogOpen)}
                        ariaLabel={`Customize overview, ${widgetIds.length.toLocaleString()} widgets`}
                        count={widgetIds.length.toLocaleString()}
                        kbd="c"
                      />
                    )}
                    <ChatTrigger />
                    <button
                      type="button"
                      className={clsx(
                        glassTrigger.glassTrigger,
                        glass.sheet,
                        glass.rim,
                        periodOpen && glassTrigger.glassTriggerActive,
                      )}
                      aria-expanded={periodOpen}
                      aria-label={`Summary of how the last ${rangeDays} days went`}
                      onClick={() => {
                        setPeriodLoaded(true);
                        setPeriodOpen((open) => !open);
                      }}
                    >
                      Summary
                    </button>
                    {periodLoaded && (
                      <Suspense fallback={null}>
                        <LazyPeriodClarityReveal
                          overview={overview}
                          rangeDays={rangeDays}
                          open={periodOpen}
                          onOpenChange={setPeriodOpen}
                        />
                      </Suspense>
                    )}
                    <RangePills value={rangeDays} onChange={setRangeDays} options={ranges} />
                  </div>
                  <LiveFreshness />
                </div>
              </section>

              {/* ── Widget Grid ── */}
              <div className={chromeStyles.gridBleed}>
                <WidgetGrid
                  slots={activeSlots}
                  recentlyAddedId={recentlyAddedId}
                  renderWidget={renderWidget}
                  onReorder={reorderWidgets}
                  onRemove={layoutActions.removeWidget}
                />
              </div>
            </>
          )}
        </RouteTransition>

        {/* Visually-hidden live region for layout-change announcements. */}
        <div role="status" aria-live="polite" aria-atomic="true" className={styles.srOnly}>
          {announcement}
        </div>

        {/* ── Widget catalog ──
          * Suppressed while a detail drill is open (matching ProjectView,
          * which early-returns drills before its catalog): a drill replaces
          * the grid, so customize would edit an invisible canvas — toggles
          * give no feedback, catalog drags have no drop target, and the
          * catalog's keyboard bindings (including ⇧C empty-dashboard) would
          * stay live in a context where they can't be seen acting. State is
          * kept, so backing out of the drill resumes customize mode. */}
        <DeferredWidgetCatalog
          open={catalogOpen && !anyOpen}
          onClose={() => setCatalogOpen(false)}
          widgetIds={widgetIds}
          toggleWidget={layoutActions.toggleWidget}
          onAddWidgets={layoutActions.addWidgets}
          resetToDefault={handleResetToDefault}
          clearAll={layoutActions.clearAll}
          viewScope="overview"
          overview={overview}
          capture={captureSettings}
        />
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
  );
}

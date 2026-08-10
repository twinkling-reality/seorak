import { Suspense, lazy, useState, useEffect, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore, authActions } from './lib/stores/auth.js';
import {
  usePollingStore,
  startPolling,
  stopPolling,
  resetPollingState,
  forceRefresh,
} from './lib/stores/polling.js';
import { prefetchModel, resetModelStore } from './lib/stores/model.js';
import { entersWithoutSignIn, probeDataPlane } from './lib/dataPlane.js';
import { isDemoActive } from './lib/demoMode.js';
import { useRoute, type Route } from './lib/router.js';
import { useTheme } from './lib/useTheme.js';
import {
  WorkspaceContextProvider,
  useWorkspaceContext,
} from './lib/workspaceContext.js';

// Eagerly loaded: the default post-boot view. The unauthenticated OAuth entry
// is its own chunk so a returning session does not pay for provider UI.
import OverviewView from './views/OverviewView/OverviewView.js';
import Sidebar from './components/Sidebar/Sidebar.js';
import Banner from './components/Banner/Banner.js';
import DemoSwitcher from './components/DemoSwitcher/DemoSwitcher.js';
import { ChatProvider, useChat } from './chat/ChatProvider.js';
import RenderErrorBoundary from './components/RenderErrorBoundary/RenderErrorBoundary.js';
import { BrandMark } from './brand/brand.js';
import StatusState from './components/StatusState/StatusState.js';
import type { HostedGate } from './lib/hostedGate.js';
import { SystemLoader, SystemNotFound } from './components/system/index.js';
import { RoutePending, RouteTransition, dashboardRouteKey } from './motion/index.js';
import {
  DesktopShellGate,
  useDashboardShellWide,
} from './components/DesktopShellGate/DesktopShellGate.js';

const ProjectView = lazy(() => import('./views/ProjectView/ProjectView.js'));
const EntryView = lazy(() => import('./views/EntryView/EntryView.js'));
const CompareView = lazy(() => import('./views/CompareView/CompareView.js'));
const AgentsView = lazy(() => import('./views/AgentsView/AgentsView.js'));
const SettingsView = lazy(() => import('./views/SettingsView/SettingsView.js'));
const ReplayView = lazy(() => import('./views/ReplayView/ReplayView.js'));
const ModelView = lazy(() => import('./views/ModelView/ModelView.js'));
const DemoView = lazy(() => import('./views/DemoView/DemoView.js'));
const ChatPanel = lazy(() => import('./chat/ChatPanel.js'));

import styles from './DashboardApp.module.css';

function ViewLoading(): ReactNode {
  return <RoutePending label="Loading view" />;
}

/** Keep the chat surface out of the dashboard bootstrap and do not fetch its
 * chunk until the keyboard shortcut or trigger actually opens it. */
function DeferredChatPanel(): ReactNode {
  const chat = useChat();
  if (!chat?.open) return null;
  return (
    <Suspense fallback={null}>
      <ChatPanel />
    </Suspense>
  );
}

type BootState = 'loading' | 'ready' | 'unauthenticated';
const SIDEBAR_COLLAPSE_STORAGE_KEY = 'seorak:sidebar-collapsed-v1';

function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Default to collapsed (stored '0' means explicitly expanded).
    return localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

interface SidebarFallbackProps {
  reset: () => void;
}

function SidebarFallback({ reset }: SidebarFallbackProps): ReactNode {
  return (
    <aside className={styles.sidebarFallback}>
      <BrandMark size={36} className={styles.sidebarFallbackIcon} />
      <button onClick={reset} className={styles.sidebarFallbackBtn}>
        Reload sidebar
      </button>
    </aside>
  );
}

function SharedWorkspaceEmptyState({
  visible,
}: {
  visible: boolean;
}): ReactNode {
  const workspace = useWorkspaceContext();
  if (!visible || workspace?.mode !== 'workspace') return null;
  return (
    <div className={styles.sharedEmpty} role="status">
      <span className={styles.sharedEmptyEyebrow}>Shared workspace</span>
      <strong>Nothing has been shared here yet.</strong>
      <span>
        Capture while both are joined to this workspace. Personal history stays
        private and is not backfilled into {workspace.workspaceName}.
      </span>
    </div>
  );
}

/**
 * What the owner sees when the cell says a capability is not on their plan.
 *
 * Neutral, not danger. The read did not fail; it was answered. Free is complete
 * and local-first, so the sentence has to name what Pro ADDS without implying
 * anything local was taken away — and the retry stays available because an
 * upgrade takes effect on the cell, which this tab cannot observe on its own.
 */
function HostedGateState({
  gate,
  onRetry,
}: {
  gate: HostedGate;
  onRetry: () => void;
}): ReactNode {
  return (
    <StatusState
      tone="neutral"
      eyebrow="Pro"
      title={gate.title}
      hint={gate.hint}
      meta="Free plan"
      actionLabel="Check again"
      onAction={onRetry}
    />
  );
}

export default function DashboardApp(): ReactNode {
  useTheme();
  const [bootCompleted, setBootCompleted] = useState<boolean>(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => readSidebarCollapsed());
  const route = useRoute();

  const { token, sessionExpired } = useAuthStore(
    useShallow((s) => ({
      token: s.token,
      sessionExpired: s.sessionExpired,
    })),
  );
  const { overviewData, overviewStatus, pollError, consecutiveFailures, hostedGate } =
    usePollingStore(
      useShallow((s) => ({
        overviewData: s.overviewData,
        overviewStatus: s.overviewStatus,
        pollError: s.pollError,
        consecutiveFailures: s.consecutiveFailures,
        hostedGate: s.hostedGate,
      })),
    );
  const dashboardShellWide = useDashboardShellWide();

  const isAuthenticated = !!token;
  const hasSnapshot = overviewStatus === 'stale' && !!overviewData;
  const errorDismissed = pollError && dismissedError === pollError;
  // Only show after 2+ consecutive failures — prevents flicker during dev
  // server restarts. A plan gate is never an error banner: it is a settled
  // answer, and it gets the whole content area rather than a retry prompt.
  const showError =
    pollError && !errorDismissed && consecutiveFailures >= 2 && hasSnapshot && !hostedGate;

  const bootState: BootState = !bootCompleted
    ? 'loading'
    : isAuthenticated
      ? 'ready'
      : 'unauthenticated';

  useEffect(() => {
    if (bootCompleted && !isAuthenticated) {
      resetPollingState();
      resetModelStore();
    }
  }, [bootCompleted, isAuthenticated]);

  // Warm the Model cache once, on idle, after Overview lands — so the first click
  // into Model is instant instead of paying the worker's cold build. prefetchModel
  // is a one-shot guard and skips in demo (the Model view derives demo locally), so
  // this never fans out a parallel cold build of every page at boot.
  useEffect(() => {
    if (bootState === 'ready' && isAuthenticated && overviewData && !isDemoActive()) {
      prefetchModel();
    }
  }, [bootState, isAuthenticated, overviewData]);

  useEffect(() => {
    try {
      if (sidebarCollapsed) {
        localStorage.removeItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
      } else {
        localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, '0');
      }
    } catch {
      // Ignore storage failures; collapse state still works for this session.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (bootState === 'ready' && isAuthenticated && dashboardShellWide) {
      startPolling();
      return () => stopPolling();
    }
    stopPolling();
    return undefined;
  }, [bootState, isAuthenticated, dashboardShellWide]);

  // Boot first consumes a control-plane handoff, then asks which data plane it
  // is on, then restores a product HttpOnly session. Token fragments remain an
  // emergency/dogfood path only.
  //
  // The plane probe is what makes the Free product account-free: a local plane
  // is the machine that owns the history and requires no operator credential,
  // so there is nothing to sign in to and the app enters directly. Scoped
  // integration credentials do not authenticate this first-party path. Anything else — an
  // unreachable plane, a worker predating the contract, a credentialed remote —
  // falls through to exactly the behavior that shipped before.
  //
  // The descriptor is also where the CONTROL PLANE ORIGIN comes from, which is
  // why every path below ends with the plane asked exactly once. The two
  // sign-in branches mint the credential that read needs, so their probe
  // follows them; the other two already probed on the way in.
  useEffect(() => {
    let active = true;
    void (async () => {
      const handoff = authActions.readHandoffFromHash();
      const fromHash = authActions.readTokenFromHash();
      const stored = authActions.getStoredToken();
      if (!handoff && !fromHash && window.location.hash) {
        authActions.discardAuthFragment();
      }
      if (handoff) {
        await authActions.signInWithHandoff(handoff);
        await probeDataPlane();
      } else if (fromHash) {
        await authActions.signInWithToken(fromHash);
        await probeDataPlane();
      } else if (entersWithoutSignIn(await probeDataPlane())) {
        await authActions.authenticate();
      } else if (!(await authActions.restore()) && stored) {
        await authActions.signInWithToken(stored);
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (active) setBootCompleted(true);
      });
    return () => {
      active = false;
      stopPolling();
    };
  }, []);

  const activeView: Route['view'] = route.view;

  if (bootState === 'loading') {
    return <SystemLoader />;
  }

  if (bootState === 'unauthenticated') {
    const notice = sessionExpired ? 'Your session expired. Sign in again.' : null;
    return (
      <Suspense fallback={<SystemLoader />}>
        <EntryView notice={notice} />
      </Suspense>
    );
  }

  const activeRouteKey = dashboardRouteKey(route);
  let activeViewContent: ReactNode = null;

  // One statement for the whole shell, not one per view. `remoteVisibility`
  // gates /overview, /sessions, /settings, /live, and /developer-model
  // together, so every hosted view would otherwise render its own version of
  // the same sentence — and each one used to render it as a breakage.
  if (hostedGate && !isDemoActive()) {
    activeViewContent = (
      <HostedGateState gate={hostedGate} onRetry={forceRefresh} />
    );
  } else if (activeView === 'overview') {
    activeViewContent = (
      <RenderErrorBoundary label="OverviewView" resetKey={activeView}>
        <OverviewView />
      </RenderErrorBoundary>
    );
  } else if (activeView === 'project') {
    activeViewContent = (
      <RenderErrorBoundary label="ProjectView" resetKey={`project-${route.projectId}`}>
        <Suspense fallback={<ViewLoading />}>
          <ProjectView />
        </Suspense>
      </RenderErrorBoundary>
    );
  } else if (activeView === 'compare') {
    activeViewContent = (
      <RenderErrorBoundary label="CompareView" resetKey={activeView}>
        <Suspense fallback={<ViewLoading />}>
          <CompareView />
        </Suspense>
      </RenderErrorBoundary>
    );
  } else if (activeView === 'agents') {
    activeViewContent = (
      <RenderErrorBoundary label="AgentsView" resetKey={activeView}>
        <Suspense fallback={<ViewLoading />}>
          <AgentsView />
        </Suspense>
      </RenderErrorBoundary>
    );
  } else if (activeView === 'replay') {
    activeViewContent = (
      <RenderErrorBoundary label="ReplayView" resetKey={activeView}>
        <Suspense fallback={<ViewLoading />}>
          <ReplayView />
        </Suspense>
      </RenderErrorBoundary>
    );
  } else if (activeView === 'model') {
    activeViewContent = (
      <RenderErrorBoundary label="ModelView" resetKey={activeView}>
        <Suspense fallback={<ViewLoading />}>
          <ModelView />
        </Suspense>
      </RenderErrorBoundary>
    );
  } else if (activeView === 'settings') {
    activeViewContent = (
      <RenderErrorBoundary label="SettingsView" resetKey={activeView}>
        <Suspense fallback={<ViewLoading />}>
          <SettingsView />
        </Suspense>
      </RenderErrorBoundary>
    );
  } else if (activeView === 'demo') {
    activeViewContent = (
      <RenderErrorBoundary label="DemoView" resetKey={activeView}>
        <Suspense fallback={<ViewLoading />}>
          <DemoView />
        </Suspense>
      </RenderErrorBoundary>
    );
  } else if (activeView === 'not-found') {
    activeViewContent = <SystemNotFound />;
  }

  return (
    <DesktopShellGate wide={dashboardShellWide}>
      {/* ChatProvider sits at shell level so every authenticated view shares one
        * conversation and the Cmd/Ctrl+K toggle; the panel itself portals to body. */}
      <WorkspaceContextProvider>
        <ChatProvider>
        <div
          className={sidebarCollapsed ? `${styles.layout} ${styles.layoutCollapsed}` : styles.layout}
        >
          <RenderErrorBoundary label="Sidebar" fallback={SidebarFallback}>
            <Sidebar
              activeView={activeView}
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((c) => !c)}
            />
          </RenderErrorBoundary>

          <div className={styles.main}>
            {showError && (
              <div className={styles.bannerSlot}>
                <Banner
                  variant="error"
                  actions={[{ label: 'Retry', onClick: forceRefresh }]}
                  onDismiss={() => setDismissedError(pollError)}
                >
                  {pollError}
                </Banner>
              </div>
            )}

            <div className={styles.content}>
              <SharedWorkspaceEmptyState
                visible={
                  activeView === 'overview' &&
                  !!overviewData &&
                  overviewData.usage.totals.sessions === 0
                }
              />
              <RouteTransition routeKey={activeRouteKey} preset="dashboard-view">
                {activeViewContent}
              </RouteTransition>
            </div>
          </div>
          <DemoSwitcher />
          <DeferredChatPanel />
        </div>
        </ChatProvider>
      </WorkspaceContextProvider>
    </DesktopShellGate>
  );
}

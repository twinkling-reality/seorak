import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import type { WorkspaceContext } from '@seorak/types';
import { usePollingStore } from '../../lib/stores/polling.js';
import {
  navigate,
  navigateToCompare,
  useRoute,
  type DashboardView,
  type Route,
} from '../../lib/router.js';
import { useTheme } from '../../lib/useTheme.js';
import { useWorkspaceContext } from '../../lib/workspaceContext.js';
import ProjectSquircle, { projectSquircleKey } from '../ProjectSquircle/ProjectSquircle.js';
import { BrandMark } from '../../brand/brand.js';
import Tooltip, { type TooltipChild } from '../Tooltip/Tooltip.js';
import listFade from '../../styles/listFade.module.css';
import styles from './Sidebar.module.css';

/* Collapsed rail: the labels are width-clipped away, so each control names
 * itself with the shared Tooltip pill to the right of the rail (portaled,
 * because the rail is the scroll container and would clip an in-flow
 * tooltip). Expanded, the visible label carries the name and the wrapper
 * renders nothing extra. */
function RailTip({
  label,
  when,
  children,
}: {
  label: string;
  when: boolean;
  children: TooltipChild;
}): ReactNode {
  if (!when) return children;
  return (
    <Tooltip label={label} placement="right">
      {children}
    </Tooltip>
  );
}

/* Icon plus name for the active workspace. Extracted because it renders inside
 * a link when there is somewhere to switch AT, and inside a plain group when
 * there is not; the badge itself is the same either way. */
function WorkspaceBadge({ workspace }: { workspace: WorkspaceContext }): ReactNode {
  return (
    <>
      <span className={styles.workspaceIcon} aria-hidden="true">
        {workspace.mode === 'workspace' ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="6" cy="5.25" r="2.25" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="11.4" cy="6.15" r="1.65" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M2.25 13.25c0-2.3 1.68-4.15 3.75-4.15s3.75 1.85 3.75 4.15M9.3 10.05c.58-.6 1.3-.95 2.1-.95 1.58 0 2.85 1.48 2.85 3.3"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M3.5 13.5c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      {/* The second line appears only when it changes what you would believe.
        * "Shared workspace" earns it: it says these sessions are other people's
        * too, under member-bound capture. "Private history" did not — it was
        * the default state restating the product's premise in permanent chrome,
        * and Settings already makes that claim where it belongs ("This
        * dashboard reads your own computer. No account, and nothing is
        * uploaded."). */}
      <span className={styles.workspaceCopy}>
        <strong>{workspace.workspaceName ?? 'Personal'}</strong>
        {workspace.mode === 'workspace' ? <span>Shared workspace</span> : null}
      </span>
    </>
  );
}

interface Props {
  activeView: Route['view'];
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({ activeView, collapsed = false, onToggle }: Props) {
  const route = useRoute();
  // "Projects" = repos explicitly captured into the active Personal or Shared
  // workspace, derived from the overview snapshot's per-repo rollups.
  const overview = usePollingStore(useShallow((s) => s.overviewData));
  const projectRollups = overview?.usage.projects ?? [];
  // Archived projects keep their rollup (Settings needs the label to offer a
  // restore) but leave the navigation list, which is the whole point of
  // archiving one.
  const projects = useMemo(
    () =>
      projectRollups
        .filter((p) => !p.archived)
        .map((p) => ({ project: p.project, repoId: p.repoId })),
    [projectRollups],
  );
  const overviewActive = activeView === 'overview';
  const replayActive = activeView === 'replay';
  const modelActive = activeView === 'model';
  const settingsActive = activeView === 'settings';
  const compareActive = activeView === 'compare';
  const agentsActive = activeView === 'agents';
  const activeProjectId = route.view === 'project' ? route.projectId : null;

  const { resolved, setTheme } = useTheme();
  const workspace = useWorkspaceContext();
  const workspaceName = workspace?.workspaceName ?? 'Personal';
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  /* Scroll-edge fade for the project list, the same read the widget catalog and
   * the Replay customize panel use. `none` while the list fits, because a fade
   * with nothing behind it claims there is more to see. */
  const projectListRef = useRef<HTMLDivElement>(null);
  const [projectFade, setProjectFade] = useState<'none' | 'top' | 'bottom' | 'both'>('none');

  const updateProjectFade = useCallback(() => {
    const el = projectListRef.current;
    if (!el) return;
    const canUp = el.scrollTop > 0;
    const canDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setProjectFade(canUp && canDown ? 'both' : canUp ? 'top' : canDown ? 'bottom' : 'none');
  }, []);

  /* Unlike the catalog and the customize panel, this list is not a fixed set
   * opened on demand: projects arrive and leave with each overview poll, and
   * collapsing the rail changes the row height. Both resize the scroller
   * without ever firing a scroll event, so measuring on scroll alone would
   * leave a stale fade (or none at all on first paint). */
  useEffect(() => {
    const el = projectListRef.current;
    if (!el) return;
    updateProjectFade();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateProjectFade);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [updateProjectFade, projects, collapsed]);

  const go = (view: DashboardView, projectId?: string) => () => {
    if (projectId !== undefined) {
      navigate(view, projectId);
    } else {
      navigate(view);
    }
    setMobileOpen(false);
  };

  return (
    <>
      <button
        className={styles.mobileToggle}
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          {mobileOpen ? (
            <path
              d="M5 5l10 10M15 5l-10 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M3 5h14M3 10h14M3 15h14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>

      {mobileOpen && (
        <div
          className={styles.mobileBackdrop}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className={clsx(styles.sidebarWrap, collapsed && styles.sidebarWrapCollapsed)}>
        {onToggle && (
          <button
            type="button"
            className={styles.sidebarToggle}
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg
              className={styles.toggleIcon}
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
            >
              <path
                d="M9 3.5 5.25 7 9 10.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}

        <aside
          className={clsx(
            styles.sidebar,
            mobileOpen && styles.sidebarOpen,
            collapsed && styles.sidebarCollapsed,
          )}
        >
          <div className={styles.sidebarHeader}>
            <RailTip label="Overview" when={collapsed}>
              <button
                type="button"
                className={styles.sidebarLogo}
                onClick={go('overview')}
                aria-label="Home"
              >
                <BrandMark size={32} className={styles.logoSvg} />
              </button>
            </RailTip>
          </div>

          {/* A switcher needs a control plane to switch AT, and only the
            * serving plane knows whether it has one. When it sends none there
            * is no account page to reach, so this is workspace identity with no
            * affordance rather than a link into somebody else's account. */}
          {workspace ? (
            <RailTip
              label={
                workspace.controlPlaneUrl
                  ? `${workspaceName}, switch workspace`
                  : workspaceName
              }
              when={collapsed}
            >
              {workspace.controlPlaneUrl ? (
                <a
                  className={styles.workspaceSwitcher}
                  href={`${workspace.controlPlaneUrl}/homes`}
                  aria-label={`Current workspace: ${workspaceName}. Switch workspace or manage people.`}
                >
                  <WorkspaceBadge workspace={workspace} />
                </a>
              ) : (
                <div
                  className={styles.workspaceSwitcher}
                  role="group"
                  aria-label={`Current workspace: ${workspaceName}.`}
                >
                  <WorkspaceBadge workspace={workspace} />
                </div>
              )}
            </RailTip>
          ) : null}

          <nav className={styles.sidebarNav} aria-label="Primary">
            <RailTip label="Overview" when={collapsed}>
            <button
              type="button"
              className={clsx(styles.navItem, overviewActive && styles.navItemActive)}
              onClick={go('overview')}
              aria-current={overviewActive ? 'page' : undefined}
              aria-label="Overview"
            >
              <svg
                className={styles.navIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <span className={styles.navLabel}>Overview</span>
            </button>
            </RailTip>
            {/* Compare stays in the primary rail as the change-over-time view.
              * Its bare route deliberately asks the stable default question:
              * all work in this window versus the prior equal window. */}
            <RailTip label="Compare" when={collapsed}>
              <button
                type="button"
                className={clsx(styles.navItem, compareActive && styles.navItemActive)}
                onClick={() => navigateToCompare()}
                aria-current={compareActive ? 'page' : undefined}
                aria-label="Compare periods"
              >
                <svg
                  className={styles.navIcon}
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <rect x="1.5" y="2.5" width="5.5" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="9" y="2.5" width="5.5" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                <span className={styles.navLabel}>Compare</span>
              </button>
            </RailTip>
            <RailTip label="Agents" when={collapsed}>
              <button
                type="button"
                className={clsx(styles.navItem, agentsActive && styles.navItemActive)}
                onClick={go('agents')}
                aria-current={agentsActive ? 'page' : undefined}
                aria-label="Compare agents"
              >
                <svg
                  className={styles.navIcon}
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <circle cx="5.5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                  <circle cx="10.5" cy="10.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                  <path
                    d="M7.5 7.5l1 1"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
                <span className={styles.navLabel}>Agents</span>
              </button>
            </RailTip>
            <RailTip label="Replay" when={collapsed}>
            <button
              type="button"
              className={clsx(styles.navItem, replayActive && styles.navItemActive)}
              onClick={go('replay')}
              aria-current={replayActive ? 'page' : undefined}
              aria-label="Replay"
            >
              <svg
                className={styles.navIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M6.5 5.5v5l4-2.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              <span className={styles.navLabel}>Replay</span>
            </button>
            </RailTip>
            <RailTip label="Model" when={collapsed}>
            <button
              type="button"
              className={clsx(styles.navItem, modelActive && styles.navItemActive)}
              onClick={go('model')}
              aria-current={modelActive ? 'page' : undefined}
              aria-label="Model"
            >
              <svg
                className={styles.navIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d="M3.5 13.5c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
              <span className={styles.navLabel}>Model</span>
            </button>
            </RailTip>
            <RailTip label="Settings" when={collapsed}>
            <button
              type="button"
              className={clsx(styles.navItem, settingsActive && styles.navItemActive)}
              onClick={go('settings')}
              aria-current={settingsActive ? 'page' : undefined}
              aria-label="Settings"
            >
              <svg
                className={styles.navIcon}
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
              >
                <path
                  d="M6.7 1.6 9.3 1.6 8.9 3.6 11.3 5 12.8 3.6 14.2 6 12.3 6.6 12.3 9.4 14.2 10 12.8 12.4 11.3 11 8.9 12.4 9.3 14.4 6.7 14.4 7.1 12.4 4.7 11 3.2 12.4 1.8 10 3.7 9.4 3.7 6.6 1.8 6 3.2 3.6 4.7 5 7.1 3.6Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <span className={styles.navLabel}>Settings</span>
            </button>
            </RailTip>
          </nav>

          <div className={styles.sidebarSection}>
            <span className={styles.sectionHeader}>Projects</span>
            <div
              ref={projectListRef}
              onScroll={updateProjectFade}
              className={clsx(
                styles.projectList,
                projectFade === 'top' && listFade.fadeTop,
                projectFade === 'bottom' && listFade.fadeBottom,
                projectFade === 'both' && listFade.fadeBoth,
              )}
            >
              {projects.length > 0 ? (
                projects.map((project) => (
                  <RailTip key={project.repoId} label={project.project} when={collapsed}>
                    <button
                      type="button"
                      className={clsx(
                        styles.navItem,
                        styles.navItemProject,
                        activeProjectId === project.repoId && styles.navItemActive,
                      )}
                      onClick={go('project', project.repoId)}
                      aria-current={activeProjectId === project.repoId ? 'page' : undefined}
                      aria-label={project.project}
                      /* Expanded, long names ellipsize (.projectName), so the
                       * native title stays as the full-name reveal there. */
                      title={collapsed ? undefined : project.project}
                    >
                      <ProjectSquircle
                        projectKey={projectSquircleKey(project.repoId, project.project)}
                        size="md"
                        active={activeProjectId === project.repoId}
                      />
                      <span className={styles.projectName}>{project.project}</span>
                    </button>
                  </RailTip>
                ))
              ) : (
                <p className={styles.sectionEmpty}>No repos yet</p>
              )}
            </div>
          </div>

          <div className={styles.sidebarSpacer} />

          <RailTip label={resolved === 'dark' ? 'Light' : 'Dark'} when={collapsed}>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => {
              // Binary flip writes an explicit light/dark preference (replacing
              // system). Resolved appearance drives the direction so system
              // users toggle from what they see now, not a fixed default.
              setTheme(resolved === 'dark' ? 'light' : 'dark');
            }}
            aria-label={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <svg className={styles.navIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
              {resolved === 'dark' ? (
                <>
                  <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                  <path
                    d="M8 1v2M8 13v2M1 8h2M13 8h2M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </>
              ) : (
                <path
                  d="M14 8.5A6 6 0 1 1 7.5 2A4.7 4.7 0 0 0 14 8.5z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
            <span className={styles.navLabel}>
              {resolved === 'dark' ? 'Light' : 'Dark'}
            </span>
          </button>
          </RailTip>
        </aside>
      </div>
    </>
  );
}

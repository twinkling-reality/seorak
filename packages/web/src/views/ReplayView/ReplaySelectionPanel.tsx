import {
  useCallback,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import clsx from 'clsx';

import { ChatTrigger } from '../../chat/index.js';
import CustomizeButton from '../../components/CustomizeButton/CustomizeButton.js';
import glass from '../../components/surface/glass.module.css';
import glassTrigger from '../../components/controls/glassTrigger.module.css';
import ProjectDropdown, {
  ProjectDropdownItem,
  ProjectDropdownItemCount,
  ProjectDropdownItemLabel,
  ProjectDropdownItemName,
  ProjectDropdownSwatch,
  ProjectDropdownToggle,
  ProjectDropdownTriggerLabel,
} from '../../components/ProjectDropdown/ProjectDropdown.js';
import RangePills from '../../components/RangePills/RangePills.js';
import type { SessionSummary } from '../../lib/apiSchemas.js';
import { projectGradient } from '../../lib/projectGradient.js';
import chromeStyles from '../../styles/dashboardChrome.module.css';
import styles from './ReplaySelectionPanel.module.css';

export interface ReplayProjectOption {
  repoId: string;
  project: string;
  sessions: SessionSummary[];
}

type ReplayRangeDays = 1 | 7 | 30 | 90;

const RANGE_OPTIONS = [1, 7, 30, 90] as const;

function projectKey(session: SessionSummary): string {
  return session.repoId || session.project || 'unknown';
}

export function groupReplayProjects(sessions: SessionSummary[]): ReplayProjectOption[] {
  const map = new Map<string, ReplayProjectOption>();
  for (const session of sessions) {
    const key = projectKey(session);
    const existing = map.get(key);
    if (existing) {
      existing.sessions.push(session);
    } else {
      map.set(key, {
        repoId: key,
        project: session.project || key,
        sessions: [session],
      });
    }
  }
  return [...map.values()]
    .map((project) => ({
      ...project,
      sessions: [...project.sessions].sort(
        (a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt),
      ),
    }))
    .sort((a, b) => Date.parse(b.sessions[0]?.lastEventAt ?? '') - Date.parse(a.sessions[0]?.lastEventAt ?? ''));
}

export default function ReplaySelectionPanel({
  sessions,
  selectedProjectIds,
  selectedSessionIds,
  rangeDays,
  usingCustomSelection,
  customizeOpen,
  summaryOpen,
  lensPicker,
  onProjectsChange,
  onRangeChange,
  onCustomize,
  onToggleSummary,
}: {
  sessions: SessionSummary[];
  selectedProjectIds: string[];
  selectedSessionIds: string[];
  rangeDays: ReplayRangeDays;
  usingCustomSelection: boolean;
  customizeOpen: boolean;
  summaryOpen: boolean;
  /** The lens picker. A slot, so scope controls stay unaware of the catalog. */
  lensPicker?: ReactNode;
  onProjectsChange: (repoIds: string[] | null) => void;
  onRangeChange: (rangeDays: ReplayRangeDays) => void;
  onCustomize: () => void;
  onToggleSummary: () => void;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const projects = useMemo(() => groupReplayProjects(sessions), [sessions]);
  const selectedProjectSet = new Set(selectedProjectIds);
  const allProjectsSelected = projects.length > 0 && selectedProjectIds.length === projects.length;
  const firstSelectedProject = projects.find((project) => selectedProjectSet.has(project.repoId)) ?? projects[0] ?? null;
  const selectedProjectIndex = Math.max(
    0,
    projects.findIndex((project) => selectedProjectSet.has(project.repoId)),
  );

  const focusSelectedProject = useCallback(() => {
    requestAnimationFrame(() => itemRefs.current[selectedProjectIndex]?.focus());
  }, [selectedProjectIndex]);

  function toggleProject(repoId: string) {
    const selected = new Set(selectedProjectIds);
    if (selected.has(repoId)) selected.delete(repoId);
    else selected.add(repoId);
    const ordered = projects.map((project) => project.repoId).filter((id) => selected.has(id));
    onProjectsChange(ordered.length === 0 || ordered.length === projects.length ? null : ordered);
  }

  function focusProject(index: number) {
    const count = projects.length;
    if (count === 0) return;
    itemRefs.current[(index + count) % count]?.focus();
  }

  function onProjectKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusProject(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusProject(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusProject(0);
        break;
      case 'End':
        event.preventDefault();
        focusProject(projects.length - 1);
        break;
      default:
        break;
    }
  }

  if (!firstSelectedProject) return null;

  const selectedCount = selectedSessionIds.length;
  const projectButtonLabel =
    allProjectsSelected
      ? 'All projects'
      : selectedProjectIds.length === 1
        ? firstSelectedProject.project
        : 'Selected projects';

  return (
    <section className={styles.panel} aria-label="Replay scope controls">
      <div className={chromeStyles.controlTray}>
        <ProjectDropdown
          width="fill"
          ariaLabel={`Projects: ${projectButtonLabel}`}
          onOpen={focusSelectedProject}
          trigger={
            <>
              <ProjectDropdownSwatch
                style={{
                  background: projectGradient(allProjectsSelected ? 'all-projects' : firstSelectedProject.repoId),
                }}
              />
              <ProjectDropdownTriggerLabel>{projectButtonLabel}</ProjectDropdownTriggerLabel>
            </>
          }
        >
          {projects.map((project, index) => {
            const active = selectedProjectSet.has(project.repoId);
            return (
              <ProjectDropdownItem
                key={project.repoId}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                onClick={() => toggleProject(project.repoId)}
                onKeyDown={(event) => onProjectKeyDown(event, index)}
                role="menuitemcheckbox"
                aria-checked={active}
              >
                <ProjectDropdownSwatch style={{ background: projectGradient(project.repoId) }} />
                <ProjectDropdownItemLabel>
                  <ProjectDropdownItemName>{project.project}</ProjectDropdownItemName>
                  <ProjectDropdownItemCount>{project.sessions.length.toLocaleString()}</ProjectDropdownItemCount>
                </ProjectDropdownItemLabel>
                <ProjectDropdownToggle on={active} />
              </ProjectDropdownItem>
            );
          })}
        </ProjectDropdown>

        <CustomizeButton
          active={customizeOpen}
          onClick={onCustomize}
          ariaLabel={`Customize replay sessions, ${selectedCount.toLocaleString()} selected`}
          count={selectedCount.toLocaleString()}
          kbd="c"
        />

        <ChatTrigger />

        {/* Same Summary affordance as Overview — reading the scope and
            watching its shape are no longer mutually exclusive. */}
        <button
          type="button"
          className={clsx(
            glassTrigger.glassTrigger,
            glass.sheet,
            glass.rim,
            summaryOpen && glassTrigger.glassTriggerActive,
          )}
          aria-expanded={summaryOpen}
          aria-label="Summary of this replay scope"
          onClick={onToggleSummary}
        >
          Summary
        </button>

        {lensPicker}

        <RangePills
          value={rangeDays}
          onChange={(next) => onRangeChange(next as ReplayRangeDays)}
          options={RANGE_OPTIONS}
          formatLabel={(days) => (days === 1 ? 'Today' : `${days}d`)}
          ariaLabel="Replay range"
        />
      </div>

      {usingCustomSelection ? <span className={styles.scopeNote}>Custom replay scope</span> : null}
    </section>
  );
}

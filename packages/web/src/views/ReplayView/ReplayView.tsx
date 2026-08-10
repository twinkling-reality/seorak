// Replay — full-width activity review. Project + range define the default
// scope; session selection is only a refinement of that scope.
//
// The screen has three levels, all in the URL so a read is shareable:
//
//   period            what happened across the range
//   ?focus=repoId     what happened in one project
//   ?session=id       what happened in one session
//
// Each level narrows both the stage's series AND its timeline, so drilling in
// is also a zoom. The breadcrumb in the header is the way back out.

import { useCallback, useMemo, useState } from 'react';

import ViewHeader from '../../components/ViewHeader/ViewHeader.js';
import EmptyState from '../../components/EmptyState/EmptyState.js';
import { useCustomizeHotkey } from '../../hooks/useCustomizeHotkey.js';
import { useReplaySessions, useReplays } from '../../hooks/useReplay.js';
import { isDemoActive } from '../../lib/demoMode.js';
import { setQueryParams, useQueryParam } from '../../lib/router.js';
import type { NarrativeMode } from './replayNarrative.js';
import {
  inRange,
  parseListParam,
  parseRangeParam,
  resolveSelectedProjects,
  resolveSelectedSessionIds,
  sameIds,
  sessionsParamForSelection,
  toggleSessionInScope,
} from './replayScope.js';
import ReplaySelectionPanel, { groupReplayProjects } from './ReplaySelectionPanel.js';
import ReplayCustomizePanel from './ReplayCustomizePanel.js';
import ReplayLensPicker from './ReplayLensPicker.js';
import ReplayStackPlayer from './ReplayStackPlayer.js';
import { replayLevel } from './lenses/level.js';
import styles from './ReplayView.module.css';

const NARRATIVE_MODES: NarrativeMode[] = ['summary', 'attention', 'review'];
/** Two sessions is a comparison; three is a table. */
const COMPARE_LIMIT = 2;

function parseNarrativeMode(value: string | null): NarrativeMode {
  return NARRATIVE_MODES.includes(value as NarrativeMode) ? (value as NarrativeMode) : 'summary';
}

export default function ReplayView() {
  const projectsParam = useQueryParam('projects');
  const sessionsParam = useQueryParam('sessions');
  const rangeParam = useQueryParam('range');
  const narrativeParam = useQueryParam('q');
  const focusParam = useQueryParam('focus');
  const sessionParam = useQueryParam('session');
  const compareParam = useQueryParam('compare');
  const lensParam = useQueryParam('lens');
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lensPickerOpen, setLensPickerOpen] = useState(false);
  const { sessions, isLoading: sessionsLoading, error: sessionsError } = useReplaySessions();
  const projects = useMemo(() => groupReplayProjects(sessions), [sessions]);
  const rangeDays = parseRangeParam(rangeParam);
  const narrativeMode = parseNarrativeMode(narrativeParam);

  const selectedProjects = useMemo(
    () => resolveSelectedProjects({ projects, projectsParam }),
    [projects, projectsParam],
  );

  const selectedProjectIds = useMemo(
    () => selectedProjects.map((project) => project.repoId),
    [selectedProjects],
  );

  const scopedSessions = useMemo(
    () =>
      selectedProjects
        .flatMap((project) => project.sessions)
        .filter((session) => inRange(session, rangeDays)),
    [selectedProjects, rangeDays],
  );

  const selectedIds = useMemo(
    () => resolveSelectedSessionIds({ selectedProjects, sessionsParam, scopedSessions }),
    [selectedProjects, sessionsParam, scopedSessions],
  );

  const compareSessionIds = useMemo(
    () => parseListParam(compareParam).filter((id) => selectedIds.includes(id)).slice(0, COMPARE_LIMIT),
    [compareParam, selectedIds],
  );

  const replayStates = useReplays(selectedIds);

  const selectProjects = (repoIds: string[] | null) => {
    setQueryParams({
      projects: repoIds == null ? null : repoIds.join(','),
      sessions: null,
      focus: null,
      session: null,
      compare: null,
      lens: null,
    });
  };

  const selectRange = (nextRange: typeof rangeDays) => {
    setQueryParams({
      range: nextRange === 1 ? null : String(nextRange),
      sessions: null,
      focus: null,
      session: null,
      compare: null,
      lens: null,
    });
  };

  const setSelectedSessions = (sessionIds: string[] | null) => {
    if (sessionIds == null) {
      setQueryParams({ sessions: null, focus: null, session: null, compare: null });
      return;
    }
    const scopedIds = scopedSessions.map((session) => session.sessionId);
    setQueryParams({
      projects: projectsParam,
      sessions: sessionsParamForSelection(sessionIds, scopedIds),
    });
  };

  const toggleSession = (sessionId: string) => {
    setSelectedSessions(
      toggleSessionInScope(
        sessionId,
        selectedIds,
        scopedSessions.map((session) => session.sessionId),
      ),
    );
  };

  const setFocusedProject = (repoId: string | null) => {
    setQueryParams({ focus: repoId, session: null, compare: null });
  };

  const setFocusedSession = (sessionId: string | null) => {
    setQueryParams({ session: sessionId });
  };

  const toggleCompareSession = (sessionId: string) => {
    const next = compareSessionIds.includes(sessionId)
      ? compareSessionIds.filter((id) => id !== sessionId)
      : [...compareSessionIds, sessionId].slice(-COMPARE_LIMIT);
    setQueryParams({ compare: next.length > 0 ? next.join(',') : null });
  };

  const setNarrativeMode = (mode: NarrativeMode) => {
    setQueryParams({ q: mode === 'summary' ? null : mode });
  };

  useCustomizeHotkey({
    onToggle: useCallback(() => setCustomizeOpen((open) => !open), []),
  });

  const focusedProject = focusParam
    ? (selectedProjects.find((project) => project.repoId === focusParam) ?? null)
    : null;
  const focusedSession = sessionParam
    ? (sessions.find((session) => session.sessionId === sessionParam && selectedIds.includes(session.sessionId)) ?? null)
    : null;

  const scopeTitle =
    selectedProjects.length === 0
      ? 'Session replay'
      : selectedProjects.length === projects.length
        ? 'All projects'
        : selectedProjects.length === 1
          ? selectedProjects[0]!.project
          : 'Selected projects';

  const sessionLabel = focusedSession
    ? `Session ${Math.max(1, selectedIds.indexOf(focusedSession.sessionId) + 1)}`
    : null;

  const crumbs: Array<{ label: string; onClick?: () => void }> = [];
  if (focusedProject || focusedSession) {
    crumbs.push({
      label: scopeTitle,
      onClick: () => setQueryParams({ focus: null, session: null, compare: null }),
    });
  }
  if (focusedProject && focusedProject.project !== scopeTitle) {
    crumbs.push({
      label: focusedProject.project,
      onClick: focusedSession ? () => setFocusedSession(null) : undefined,
    });
  }
  if (sessionLabel) crumbs.push({ label: sessionLabel });

  const pageTitle =
    crumbs.length === 0 ? (
      scopeTitle
    ) : (
      <span className={styles.titleBreadcrumb}>
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`} className={styles.titleCrumb}>
            {index > 0 ? (
              <span className={styles.titleSeparator} aria-hidden="true">
                /
              </span>
            ) : null}
            {crumb.onClick ? (
              <button type="button" className={styles.titleCrumbButton} onClick={crumb.onClick}>
                {crumb.label}
              </button>
            ) : (
              <span>{crumb.label}</span>
            )}
          </span>
        ))}
      </span>
    );

  // The lens picker lives in the scope tray, so it reads the level from the
  // same two params the player does rather than from the player's state.
  const level = replayLevel(focusedProject?.repoId ?? null, focusedSession?.sessionId ?? null);

  const usingCustomSelection = sessionsParam != null;
  const replayKeyMatches = sameIds(
    replayStates.map((state) => state.sessionId),
    selectedIds,
  );

  return (
    <div className={styles.page}>
      <ViewHeader eyebrow="Replay" title={pageTitle} demo={isDemoActive()} />

      {sessions.length === 0 ? (
        <EmptyState
          large
          title={sessionsLoading ? 'Loading sessions…' : 'No sessions to replay yet'}
          hint={sessionsError ?? undefined}
        />
      ) : (
        <>
          <ReplaySelectionPanel
            sessions={sessions}
            selectedProjectIds={selectedProjectIds}
            selectedSessionIds={selectedIds}
            rangeDays={rangeDays}
            usingCustomSelection={usingCustomSelection}
            customizeOpen={customizeOpen}
            summaryOpen={summaryOpen}
            onProjectsChange={selectProjects}
            onRangeChange={selectRange}
            onCustomize={() => setCustomizeOpen((open) => !open)}
            onToggleSummary={() => setSummaryOpen((open) => !open)}
            lensPicker={
              <ReplayLensPicker
                level={level}
                activeLensId={lensParam}
                open={lensPickerOpen}
                onOpenChange={setLensPickerOpen}
                onSelectLens={(id) => setQueryParams({ lens: id })}
              />
            }
          />

          <ReplayCustomizePanel
            open={customizeOpen}
            sessions={scopedSessions}
            selectedSessionIds={selectedIds}
            usingCustomSelection={usingCustomSelection}
            onToggleSession={toggleSession}
            onSetSessions={setSelectedSessions}
            onClose={() => setCustomizeOpen(false)}
          />

          <section className={styles.playerPanel} aria-label="Replay player">
            {selectedIds.length === 0 ? (
              <EmptyState
                title="No sessions in this replay scope"
                hint="Press C to open Customize and add sessions back."
              />
            ) : replayKeyMatches ? (
              <ReplayStackPlayer
                states={replayStates}
                sessions={sessions}
                scopedSessions={scopedSessions}
                narrativeMode={narrativeMode}
                onNarrativeModeChange={setNarrativeMode}
                focusedProjectId={focusParam}
                onFocusProject={(repoId) => setFocusedProject(repoId)}
                onClearFocus={() => setFocusedProject(null)}
                focusedSessionId={sessionParam}
                onFocusSession={setFocusedSession}
                rangeDays={rangeDays}
                customSessionSelection={usingCustomSelection}
                summaryOpen={summaryOpen}
                onCloseSummary={() => setSummaryOpen(false)}
                compareSessionIds={compareSessionIds}
                onToggleCompareSession={toggleCompareSession}
                onClearCompare={() => setQueryParams({ compare: null })}
                activeLensId={lensParam}
                onSelectLens={(id) => setQueryParams({ lens: id })}
              />
            ) : (
              <EmptyState title="Loading replay…" />
            )}
          </section>
        </>
      )}
    </div>
  );
}

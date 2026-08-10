import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import clsx from 'clsx';

import SegmentedControl from '../../components/SegmentedControl/SegmentedControl.js';
import type { ReplaySession, SessionSummary } from '../../lib/apiSchemas.js';
import type { ReplayLoadState } from '../../hooks/useReplay.js';
import { nextPlaybackStop, reviewPlaybackRate } from './replayPlayback.js';
import { type NarrativeMode } from './replayNarrative.js';
import { projectFor, repoIdFor } from './replaySessionHelpers.js';
import {
  buildReplayNow,
  buildReplayReviewBase,
  stopTargetsForMode,
  type ReplayStopMode,
} from './replayReviewModel.js';
import { PauseIcon, PlayIcon } from './replayIcons.js';
import { scopeLoadNote } from './replayScopeSummary.js';
import { buildStageMarkers } from './replayStageMarkers.js';
import {
  buildReplayTimeline,
  fullWindow,
  isFullWindow,
  pageWindowTo,
  timelineSpanMs,
  windowSpanMs,
  type ReplayWindow,
} from './replayTimeline.js';
import {
  buildChartData,
  buildChartSeries,
  buildFocusedSessionLegend,
  focusedProjectFromParam,
  shouldDefaultToLanes,
  type SessionLane,
} from './replayTransforms.js';
import ReplayReviewConsole from './review/ReplayReviewConsole.js';
import { computeReplayLens, replayLens } from './lenses/index.js';
import type { ReplayLensRow } from './lenses/types.js';
import { replayLevel } from './lenses/level.js';
import ReplayLensSheet from './sheet/ReplayLensSheet.js';
import { useViewportFill } from '../../hooks/useViewportFill.js';
import type { ReplayRangeDays } from './replayScope.js';
import ReplaySessionLegend from './stage/ReplaySessionLegend.js';
import ReplayStageChart, { type ReplayStageRenderMode } from './stage/ReplayStageChart.js';
import ReplayStopPicker from './stage/ReplayStopPicker.js';
import styles from './ReplayStackPlayer.module.css';

const LazyReplayClarityReveal = lazy(() => import('./LazyReplayClarityReveal.js'));

const RENDER_MODE_OPTIONS = [
  { value: 'lines' as const, label: 'Lines' },
  { value: 'lanes' as const, label: 'Lanes' },
];

export default function ReplayStackPlayer({
  states,
  sessions,
  narrativeMode,
  onNarrativeModeChange,
  focusedProjectId,
  onFocusProject,
  onClearFocus,
  focusedSessionId,
  onFocusSession,
  scopedSessions,
  rangeDays,
  customSessionSelection,
  summaryOpen,
  onCloseSummary,
  compareSessionIds,
  onToggleCompareSession,
  onClearCompare,
  activeLensId,
  onSelectLens,
}: {
  states: ReplayLoadState[];
  sessions: SessionSummary[];
  narrativeMode: NarrativeMode;
  onNarrativeModeChange: (mode: NarrativeMode) => void;
  focusedProjectId: string | null;
  onFocusProject: (repoId: string) => void;
  onClearFocus: () => void;
  focusedSessionId: string | null;
  onFocusSession: (sessionId: string | null) => void;
  scopedSessions: SessionSummary[];
  rangeDays: ReplayRangeDays;
  customSessionSelection: boolean;
  summaryOpen: boolean;
  onCloseSummary: () => void;
  compareSessionIds: string[];
  onToggleCompareSession: (sessionId: string) => void;
  onClearCompare: () => void;
  activeLensId: string | null;
  onSelectLens: (id: string | null) => void;
}) {
  const [playheadMs, setPlayheadState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stopMode, setStopMode] = useState<ReplayStopMode>('highlights');
  const [hiddenChartSessions, setHiddenChartSessions] = useState(() => new Set<string>());
  const [manualRenderMode, setManualRenderMode] = useState<ReplayStageRenderMode | null>(null);
  const [viewWindow, setViewWindow] = useState<ReplayWindow | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const lastAutoStopMsRef = useRef<number | null>(null);
  /** Playhead the rAF loop advances, so the tick never reads stale state. */
  const playheadRef = useRef(0);
  const cockpitRef = useRef<HTMLElement | null>(null);
  // null on short or narrow viewports — the cockpit then falls back to normal
  // document flow, because pinning a tall stage on a small screen is worse
  // than letting the page scroll.
  const cockpitHeight = useViewportFill(cockpitRef);

  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.sessionId, session])),
    [sessions],
  );
  const lanes = useMemo<SessionLane[]>(
    () =>
      states.map((state, index) => ({
        sessionId: state.sessionId,
        replay: state.replay,
        session: sessionById.get(state.sessionId) ?? null,
        isLoading: state.isLoading,
        error: state.error,
        index,
      })),
    [states, sessionById],
  );

  const focusedProject = focusedProjectFromParam(focusedProjectId, lanes);
  const focusedSession = useMemo(
    () => (focusedSessionId && lanes.some((lane) => lane.sessionId === focusedSessionId) ? focusedSessionId : null),
    [focusedSessionId, lanes],
  );

  /**
   * Period → project → session. Each level narrows what the stage draws AND
   * what the timeline spans, so drilling in is also a zoom.
   */
  const scopedLanes = useMemo(() => {
    if (focusedSession) return lanes.filter((lane) => lane.sessionId === focusedSession);
    if (!focusedProject) return lanes;
    return lanes.filter((lane) => repoIdFor(lane.session, lane.sessionId) === focusedProject);
  }, [lanes, focusedProject, focusedSession]);

  const chartLanes = useMemo(() => {
    if (focusedSession) return scopedLanes;
    if (!focusedProject) return lanes;
    return scopedLanes.filter((lane) => !hiddenChartSessions.has(lane.sessionId));
  }, [lanes, scopedLanes, focusedProject, focusedSession, hiddenChartSessions]);

  const timeline = useMemo(() => buildReplayTimeline(scopedLanes), [scopedLanes]);
  const scopeSpanMs = timelineSpanMs(timeline);

  const drilled = Boolean(focusedProject || focusedSession);
  /** One line per project at period level; one per session once drilled in. */
  const seriesGroupId = focusedProject
    ?? (focusedSession ? repoIdFor(scopedLanes[0]?.session ?? null, focusedSession) : null);
  const sessionSeries = useMemo(
    () => buildChartSeries(drilled ? chartLanes : lanes, seriesGroupId),
    [chartLanes, lanes, drilled, seriesGroupId],
  );

  const legendItems = useMemo(() => {
    if (!focusedProject) return sessionSeries.map((series) => ({ series, selected: true }));
    return buildFocusedSessionLegend(scopedSessions, focusedProject, hiddenChartSessions);
  }, [focusedProject, sessionSeries, scopedSessions, hiddenChartSessions]);

  const chartData = useMemo(
    () => buildChartData(sessionSeries, drilled ? chartLanes : lanes, timeline),
    [sessionSeries, chartLanes, lanes, drilled, timeline],
  );

  const renderMode: ReplayStageRenderMode =
    manualRenderMode ?? (shouldDefaultToLanes(sessionSeries.length) ? 'lanes' : 'lines');

  const activeWindow = viewWindow ?? fullWindow(timeline);
  const zoomed = !isFullWindow(activeWindow, timeline);

  const markerLanes = drilled ? chartLanes : scopedLanes;
  const loadedReplays = markerLanes.filter(
    (lane): lane is SessionLane & { replay: ReplaySession } => Boolean(lane.replay),
  );
  const stageMarkers = useMemo(
    () => buildStageMarkers(loadedReplays, timeline),
    [loadedReplays, timeline],
  );

  const reviewBase = useMemo(
    () => buildReplayReviewBase(scopedLanes, timeline),
    [scopedLanes, timeline],
  );
  const reviewNow = useMemo(
    () => buildReplayNow(scopedLanes, reviewBase, playheadMs, timeline),
    [scopedLanes, reviewBase, playheadMs, timeline],
  );
  const reviewModel = useMemo(() => ({ ...reviewBase, now: reviewNow }), [reviewBase, reviewNow]);
  const stopTargets = useMemo(() => stopTargetsForMode(reviewBase, stopMode), [reviewBase, stopMode]);
  const loadNote = useMemo(() => scopeLoadNote(reviewModel.scope), [reviewModel.scope]);

  const projectCountInScope = useMemo(
    () => new Set(lanes.map((lane) => repoIdFor(lane.session, lane.sessionId))).size,
    [lanes],
  );
  const clarityContext = useMemo(
    () => ({
      rangeDays,
      customSessionSelection,
      projectLabels: [
        ...new Set(scopedLanes.map((lane) => projectFor(lane.session, lane.sessionId))),
      ].sort(),
      focusLabel: focusedSession
        ? (scopedLanes[0]?.session?.project ?? null)
        : focusedProject
          ? (scopedLanes[0]?.session?.project ?? null)
          : null,
    }),
    [rangeDays, customSessionSelection, scopedLanes, focusedProject, focusedSession],
  );

  // Mount the reveal lazily on first open, then keep it mounted so reopening
  // does not re-suspend mid-animation.
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  useEffect(() => {
    if (summaryOpen) setSummaryLoaded(true);
  }, [summaryOpen]);

  const atEnd = playheadMs >= scopeSpanMs - 1;
  const playLabel = playing ? 'Pause' : atEnd ? 'Replay' : 'Play';
  const backLabel = focusedSession
    ? 'Back to sessions'
    : projectCountInScope > 1
      ? 'Back to projects'
      : 'Back to chart';

  const stageFrameStyle = {
    '--chart-margin-left': '48px',
    '--chart-margin-right': '16px',
  } as CSSProperties;

  /** Single place the playhead moves — so the window always follows it. */
  const movePlayhead = (elapsedMs: number, { stopPlayback = true } = {}) => {
    const next = Math.max(0, Math.min(scopeSpanMs, elapsedMs));
    if (stopPlayback) {
      setPlaying(false);
      lastAutoStopMsRef.current = null;
    }
    playheadRef.current = next;
    setPlayheadState(next);
    setViewWindow((current) => pageWindowTo(current ?? fullWindow(timeline), timeline, next));
  };

  const jumpToElapsed = (elapsedMs: number) => {
    onCloseSummary();
    movePlayhead(elapsedMs);
  };

  const sessionKey = states.map((state) => state.sessionId).join('\x1f');

  // ── Lenses ────────────────────────────────────────────────────────────
  const level = replayLevel(focusedProject, focusedSession);
  const activeLens = useMemo(() => {
    const lens = activeLensId ? replayLens(activeLensId) : null;
    return lens && lens.levels.includes(level) ? lens : null;
  }, [activeLensId, level]);

  const lensResult = useMemo(() => {
    if (!activeLens) return null;
    return computeReplayLens(activeLens.id, {
      lanes: scopedLanes,
      timeline,
      window: activeWindow,
      level,
      sessions,
      rangeDays,
      compareSessionIds,
      nowMs: Date.now(),
    });
  }, [
    activeLens,
    scopedLanes,
    timeline,
    activeWindow,
    level,
    sessions,
    rangeDays,
    compareSessionIds,
  ]);

  /** A lens row either names an instant to scrub to or a scope object to open. */
  const handleLensRow = (row: ReplayLensRow) => {
    if (row.target?.kind === 'project') {
      onSelectLens(null);
      onFocusProject(row.target.id);
      return;
    }
    if (row.target?.kind === 'session') {
      // Inside the Sessions lens at project level a row picks for comparison
      // instead of navigating — that is where the compare pair gets chosen.
      if (activeLens?.id === 'sessions' && level === 'project') {
        onToggleCompareSession(row.target.id);
        return;
      }
      onSelectLens(null);
      onFocusSession(row.target.id);
      return;
    }
    if (row.elapsedMs != null) movePlayhead(row.elapsedMs);
  };

  useEffect(() => {
    playheadRef.current = 0;
    setPlayheadState(0);
    setPlaying(false);
    lastAutoStopMsRef.current = null;
    setViewWindow(null);
    setManualRenderMode(null);
  }, [sessionKey, focusedProject, focusedSession]);

  useEffect(() => {
    setHiddenChartSessions(new Set());
  }, [focusedProject, sessionKey]);

  useEffect(() => {
    lastAutoStopMsRef.current = null;
  }, [stopMode]);

  useEffect(() => {
    if (summaryOpen) setPlaying(false);
  }, [summaryOpen]);

  // Playback runs on the window, not the scope: a 90-day scope would otherwise
  // take hours even at the old 420x ceiling. When the playhead leaves the
  // window the view turns a page rather than scrolling under the reader.
  const playbackSpanMs = windowSpanMs(activeWindow);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = null;
      return;
    }

    const land = (elapsedMs: number) => {
      playheadRef.current = elapsedMs;
      setPlayheadState(elapsedMs);
      setViewWindow((current) => pageWindowTo(current ?? fullWindow(timeline), timeline, elapsedMs));
    };

    const tick = (now: number) => {
      if (lastTickRef.current == null) lastTickRef.current = now;
      const delta = (now - lastTickRef.current) * reviewPlaybackRate(playbackSpanMs);
      lastTickRef.current = now;

      const fromMs = playheadRef.current;
      const toMs = fromMs + delta;
      const stop = nextPlaybackStop(stopTargets, fromMs, toMs, lastAutoStopMsRef.current);
      if (stop) {
        lastAutoStopMsRef.current = stop.elapsedMs;
        setPlaying(false);
        land(stop.elapsedMs);
        return;
      }
      if (toMs >= scopeSpanMs) {
        setPlaying(false);
        land(scopeSpanMs);
        return;
      }
      land(toMs);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, playbackSpanMs, scopeSpanMs, stopTargets, timeline]);

  const toggleChartSession = (sessionId: string) => {
    setHiddenChartSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  return (
    <section
      ref={cockpitRef}
      className={clsx(styles.cockpit, cockpitHeight != null && styles.cockpitPinned)}
      style={{ ...stageFrameStyle, ...(cockpitHeight != null ? { height: cockpitHeight } : {}) }}
      aria-label="Replay cockpit"
    >
      {summaryLoaded ? (
        <Suspense fallback={null}>
          <LazyReplayClarityReveal
            scope={reviewModel.scope}
            context={clarityContext}
            open={summaryOpen}
            onOpenChange={(next) => {
              if (!next) onCloseSummary();
            }}
          />
        </Suspense>
      ) : null}

      <div className={styles.cockpitBody}>
        <div className={styles.stagePane}>
          <div className={styles.stageBody}>
            <ReplayStageChart
              chartData={chartData}
              sessionSeries={sessionSeries}
              markers={stageMarkers}
              timeline={timeline}
              window={activeWindow}
              onWindowChange={(next) => setViewWindow(next)}
              renderMode={renderMode}
              playheadMs={playheadMs}
              onPlayheadChange={(elapsedMs) => movePlayhead(elapsedMs)}
            />
          </div>

          {focusedSession ? null : (
            <ReplaySessionLegend
              items={legendItems}
              focusedProjectId={focusedProject}
              onFocusProject={onFocusProject}
              onClearFocus={onClearFocus}
              onToggleChartSession={toggleChartSession}
            />
          )}
        </div>

        <aside className={styles.inspector} aria-label="Playhead inspector">
          <ReplayReviewConsole
            model={reviewModel}
            mode={narrativeMode}
            onModeChange={onNarrativeModeChange}
            onJumpToMs={jumpToElapsed}
          />
        </aside>

        {activeLens && lensResult ? (
          <ReplayLensSheet
            lens={activeLens}
            level={level}
            result={lensResult}
            onClose={() => onSelectLens(null)}
            onSelectLens={onSelectLens}
            onSelectRow={handleLensRow}
          />
        ) : null}
      </div>

      <div className={styles.transport}>
        <div className={styles.controlCluster}>
          <button
            type="button"
            className={styles.playButton}
            onClick={() => {
              if (atEnd) {
                lastAutoStopMsRef.current = null;
                movePlayhead(0, { stopPlayback: false });
                setPlaying(true);
                return;
              }
              setPlaying((value) => !value);
            }}
            aria-label={`${playLabel} replay`}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
            <span>{playLabel}</span>
          </button>

          <ReplayStopPicker value={stopMode} onChange={setStopMode} />

          {sessionSeries.length > 1 ? (
            <SegmentedControl
              value={renderMode}
              onChange={(next) => setManualRenderMode(next)}
              options={RENDER_MODE_OPTIONS}
              ariaLabel="Stage render mode"
            />
          ) : null}

          {zoomed ? (
            <button
              type="button"
              className={styles.pillButton}
              onClick={() => setViewWindow(fullWindow(timeline))}
            >
              Full range
            </button>
          ) : null}

          {focusedProject || focusedSession ? (
            <button
              type="button"
              className={styles.pillButton}
              onClick={() => {
                if (focusedSession) onFocusSession(null);
                else onClearFocus();
              }}
            >
              {backLabel}
            </button>
          ) : null}

          {loadNote ? <span className={styles.loadNoteInline}>{loadNote}</span> : null}
        </div>
      </div>
    </section>
  );
}

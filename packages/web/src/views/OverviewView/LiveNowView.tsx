import { type ReactNode } from 'react';
import {
  DetailView,
  FocusedDetailView,
  Metric,
  listQuestion,
  type DetailTabDef,
  type FocusedQuestion,
} from '../../components/DetailView/index.js';
import { DetailTable, type DetailColumn } from '../../components/viz/index.js';
import { useTabs } from '../../hooks/useTabs.js';
import { useQueryParam, setQueryParam } from '../../lib/router.js';
import { projectGradient } from '../../lib/projectGradient.js';
import { formatDuration, formatDurationLong } from '../../lib/utils.js';
import type { SessionSummary } from '@seorak/types';
import type { OverviewSnapshot } from '../../lib/apiSchemas.js';
import LiveSessionsTable, {
  secondsSinceLastEvent,
} from '../../components/LiveSessionsTable/LiveSessionsTable.js';
import FileTypeMark from '../../components/FileTypeMark/FileTypeMark.js';
import { ProjectInline, projectSquircleKey } from '../../components/ProjectSquircle/ProjectSquircle.js';
import { liveNeedsYou } from '../../widgets/utils.js';
import { count, countMetric, naturalListNodes, plural } from '../../lib/voice/index.js';
import { formatScope } from './overview-utils.js';
import styles from './LiveNowView.module.css';

const LIVE_TABS = ['sessions', 'files'] as const;
type LiveTab = (typeof LIVE_TABS)[number];

/** The overview's live file signal (salted ids + counts, capped hottest-first
 *  server-side with an uncapped `distinctFiles`). Null until live rows carry it. */
type FilesInPlay = OverviewSnapshot['codebase']['filesInPlay'];

interface Props {
  liveSessions: SessionSummary[];
  /** Files current sessions are editing (`codebase.filesInPlay`, scoped to the
   *  repo when ProjectView mounts this detail). Feeds the Files tab. */
  filesInPlay: FilesInPlay;
  focusSessionId: string | null;
  onBack: () => void;
  /** Open Replay focused on one session within its project. */
  onOpenReplay: (sessionId: string, repoId: string) => void;
  // Label for the back chevron. "Overview" by default; ProjectView passes
  // "Project" when mounting this detail in a single-project context.
  backLabel?: string;
  // Scope phrasing used in the empty-state subtitle. Default reads "across
  // your repos"; ProjectView passes "in this repo".
  scopeLabel?: string;
}

export default function LiveNowView({
  liveSessions,
  filesInPlay,
  focusSessionId,
  onBack,
  onOpenReplay,
  backLabel = 'Overview',
  scopeLabel = 'across your repos',
}: Props) {
  const totalSessions = liveSessions.length;
  const reposRepresented = new Set(liveSessions.map((s) => s.project).filter(Boolean)).size;

  // The live drill's tab rides the `live-tab` aux param (`?live=` itself
  // carries the focused session id), set by navigateToDetail and cleared by
  // closeAll. Read at mount; in-view switching goes through the tab bar.
  const liveTabParam = useQueryParam('live-tab');
  const tabControl = useTabs(LIVE_TABS, liveTabParam === 'files' ? 'files' : 'sessions');
  const { activeTab } = tabControl;

  const questionParam = useQueryParam('q');

  const liveSubtitle =
    totalSessions === 0
      ? `No sessions running right now ${scopeLabel}.`
      : formatScope([
          { count: totalSessions, singular: 'session' },
          { count: reposRepresented, singular: 'repo' },
        ]);

  const inPlayFiles = filesInPlay?.files ?? [];
  const distinctFiles = filesInPlay?.distinctFiles ?? 0;
  // The server ships a capped hottest-first list; distinctFiles is the
  // uncapped count. Anything past the cap is named, never silently dropped.
  const filesNotShown = Math.max(0, distinctFiles - inPlayFiles.length);
  const fileRepos = new Set(inPlayFiles.flatMap((f) => f.projects.map((p) => p.repoId))).size;

  const tabs: Array<DetailTabDef<LiveTab>> = [
    {
      id: 'sessions',
      // Present-tense phrase, not a bare noun: Live is the one "right now" view,
      // so the label reads as the stat it heads ("5 sessions running").
      label: 'Sessions running',
      value: totalSessions,
      ...(totalSessions > 0 ? { tone: 'accent' as const } : {}),
    },
    {
      id: 'files',
      label: 'Files in play',
      value: distinctFiles,
      ...(distinctFiles > 0 ? { tone: 'accent' as const } : {}),
    },
  ];

  const focusedSession = focusSessionId
    ? liveSessions.find((s) => s.sessionId === focusSessionId)
    : null;

  const sessionsTable = (
    <LiveSessionsTable
      sessions={liveSessions}
      variant="detail"
      actionLabel="Replay"
      focusSessionId={activeTab === 'sessions' ? focusSessionId : null}
      onRowClick={(s) => onOpenReplay(s.sessionId, s.repoId)}
    />
  );

  // Files tab: the full in-play list the widget's top-3 face drills into.
  // Rows are informational (no click target invents itself here), so this is a
  // non-interactive read → DetailTable. Last edit is coarse minutes on purpose
  // — the signal rides the 30s overview poll, so finer precision would be theater.
  type InPlayFile = (typeof inPlayFiles)[number];
  const fileColumns: DetailColumn<InPlayFile>[] = [
    {
      key: 'file',
      header: 'File',
      width: 'minmax(170px, 1.4fr)',
      render: (f) => {
        const label = f.label ?? `${f.fileId.slice(0, 10)}…`;
        // File-TYPE mark: the type icon names the type (recognizable on its own,
        // not color-alone), colored by the collector category so it still rhymes
        // with the Kind column. The mark parses the real f.label, so a hashed-id
        // row with no name shows the neutral glyph, not a fabricated type.
        return (
          <span className={styles.filesFile} title={label}>
            <FileTypeMark label={f.label} category={f.category} />
            <span className={styles.filesName}>{label}</span>
          </span>
        );
      },
    },
    {
      key: 'kind',
      header: 'Kind',
      width: 'minmax(90px, 0.7fr)',
      // The text twin of the widget's category color (never color-alone).
      // "--" for rows older collectors shipped.
      render: (f) => (
        <span className={styles.filesKind}>
          {f.category ? (f.category === 'other' ? 'unclassified' : f.category) : '--'}
        </span>
      ),
    },
    {
      key: 'project',
      header: 'Project',
      width: 'minmax(140px, 1fr)',
      render: (f) => {
        const primary = f.projects[0] ?? null;
        return primary ? (
          <span className={styles.filesProject}>
            <span
              className={styles.filesSwatch}
              style={{ background: projectGradient(primary.project) }}
              aria-hidden="true"
            />
            <span className={styles.filesProjectName} title={primary.project}>
              {primary.project}
            </span>
            {f.projects.length > 1 && (
              <span className={styles.filesProjectMore}>+{f.projects.length - 1}</span>
            )}
          </span>
        ) : (
          '--'
        );
      },
    },
    {
      key: 'edits',
      header: 'Edits',
      align: 'end',
      width: 'minmax(64px, 0.5fr)',
      render: (f) => f.edits.toLocaleString(),
    },
    {
      key: 'sessions',
      header: 'Sessions',
      align: 'end',
      width: 'minmax(76px, 0.5fr)',
      render: (f) => f.projects.reduce((sum, p) => sum + p.sessions, 0).toLocaleString(),
    },
    {
      key: 'last-edit',
      header: 'Last edit',
      align: 'end',
      width: 'minmax(88px, 0.7fr)',
      render: (f) => {
        const minutesAgo = Math.floor((Date.now() - Date.parse(f.lastEditedAt)) / 60_000);
        return `${formatDuration(minutesAgo)} ago`;
      },
    },
  ];

  const filesTable = (
    <>
      <DetailTable
        columns={fileColumns}
        rows={inPlayFiles}
        rowKey={(f) => f.fileId}
        ariaLabel="Files in play right now"
      />
      {/* Honest residue safety net: the detail is the tail's home, so the
        * server ships the in-play list large enough to be complete for a real
        * live board (bounded by live sessions). This line only appears in the
        * pathological case where the board exceeds even that cap; the tail is
        * named rather than silently dropped. Kept outside the grid so it reads
        * as a footnote, not a data row. */}
      {filesNotShown > 0 && (
        <div className={styles.filesResidue}>
          {count(filesNotShown, 'more file')} {plural(filesNotShown, 'is', 'are')} in play but not
          listed here.
        </div>
      )}
    </>
  );

  const filesQuestions: FocusedQuestion[] = [
    listQuestion({
      id: 'files-in-play',
      question: 'Which files are in play right now?',
      answer:
        distinctFiles > 0 ? (
          <>
            {countMetric(distinctFiles, 'file')} {plural(distinctFiles, 'is', 'are')} in play
            across {countMetric(fileRepos, 'repo')} right now.
          </>
        ) : (
          <>No files are in play right now.</>
        ),
      children:
        inPlayFiles.length > 0 ? (
          filesTable
        ) : (
          <span className={styles.empty}>No files are in play right now.</span>
        ),
    }),
  ];

  // The needs-you question isolates the WAITING sessions in its viz, not the full
  // board (the answer says "N waiting", so the table must show those N, not every
  // running session — audit C7).
  const needsYouSessions = liveSessions.filter((s) => liveNeedsYou(s));
  const needsYouCount = needsYouSessions.length;
  const needsYouTable = (
    <LiveSessionsTable
      sessions={needsYouSessions}
      variant="detail"
      actionLabel="Replay"
      onRowClick={(s) => onOpenReplay(s.sessionId, s.repoId)}
    />
  );

  // Health split for the "what is running" answer: the running sessions broken
  // down by live state (active → idle → stuck order; any unknown state falls to
  // the end). Built from the raw status counts so it always sums to the total —
  // the sentence never claims a split that doesn't add up.
  const STATUS_WORD_ORDER = ['active', 'idle', 'stuck'];
  const statusCounts = new Map<string, number>();
  for (const s of liveSessions) statusCounts.set(s.status, (statusCounts.get(s.status) ?? 0) + 1);
  const statusRank = (word: string) => {
    const i = STATUS_WORD_ORDER.indexOf(word);
    return i === -1 ? STATUS_WORD_ORDER.length : i;
  };
  const statusSplit = [...statusCounts.entries()]
    .sort((a, b) => statusRank(a[0]) - statusRank(b[0]))
    .map(([word, count]) => ({ word, count }));

  // The answer reads like a person describing the board: lead with the count
  // (and repos when there's more than one), then the state split, honest-empty
  // when a state has no sessions. Focused drills center the one session's own
  // state and duration, the dimensions the stat tabs can't carry.
  const runningLead = (
    <>
      {countMetric(totalSessions, 'session')} {plural(totalSessions, 'is', 'are')} running
      {reposRepresented > 1 ? (
        <>
          {' '}
          across {countMetric(reposRepresented, 'repo')}
        </>
      ) : null}{' '}
      right now
    </>
  );

  let activeSessionsAnswer: ReactNode;
  if (totalSessions === 0) {
    activeSessionsAnswer = <>No sessions are running right now.</>;
  } else if (focusedSession) {
    const fs = focusedSession;
    // The project reads as an identity, not a metric: the same squircle the rows
    // carry rides next to the name (keyed off fs.project exactly as the rows key
    // their mark). No identity to show when the row has no project name, so the
    // sentence falls back to a plain "This session".
    const fsProjectNode = fs.project ? (
      <ProjectInline
        projectKey={projectSquircleKey(fs.repoId, fs.project)}
        label={fs.project}
        title={fs.project}
      />
    ) : (
      <strong>This session</strong>
    );
    let stateClause: ReactNode;
    if (liveNeedsYou(fs)) {
      stateClause = <>{fsProjectNode} is waiting on you right now</>;
    } else if (fs.status === 'stuck') {
      const quiet = formatDurationLong(
        Math.max(1, Math.floor(secondsSinceLastEvent(fs) / 60)),
      );
      stateClause = (
        <>
          {fsProjectNode} has been stuck for <Metric>{quiet}</Metric>, worth a look now
        </>
      );
    } else if (fs.status === 'idle') {
      stateClause = (
        <>
          {fsProjectNode} has gone idle, either stalled or you stepped away
        </>
      );
    } else if (fs.status === 'active') {
      stateClause = (
        <>
          {fsProjectNode} is active and has been running for{' '}
          <Metric>{formatDurationLong(Math.floor(fs.elapsedSeconds / 60))}</Metric>
        </>
      );
    } else {
      stateClause = <>{fsProjectNode} is running</>;
    }
    activeSessionsAnswer = (
      <>
        {stateClause}.{' '}
        {totalSessions > 1 ? (
          <>
            It's one of {countMetric(totalSessions, 'session')} running right now.
          </>
        ) : (
          <>It's the only session running right now.</>
        )}
      </>
    );
  } else if (statusSplit.length <= 1) {
    const only = statusSplit[0];
    activeSessionsAnswer = only ? (
      <>
        {runningLead}
        {totalSessions === 1 ? <>, and it's {only.word}.</> : <>, all {only.word}.</>}
      </>
    ) : (
      <>{runningLead}.</>
    );
  } else {
    const splitNodes: ReactNode[] = statusSplit.map((b, i) => (
      <>
        <Metric>{b.count}</Metric> {i === 0 ? plural(b.count, 'is ', 'are ') : ''}
        {b.word}
      </>
    ));
    activeSessionsAnswer = (
      <>
        {runningLead}. {naturalListNodes(splitNodes)}.
      </>
    );
  }

  // Sessions rows are clickable (each opens its project), so they stay on the
  // bespoke button grid rather than the non-interactive DetailTable. We still
  // route them through listQuestion so Live's questions flow through the same
  // template system as everything else.
  const sessionsQuestions: FocusedQuestion[] = [
    listQuestion({
      id: 'active-sessions',
      question: 'What is running right now?',
      answer: activeSessionsAnswer,
      children:
        totalSessions > 0 ? (
          sessionsTable
        ) : (
          <span className={styles.empty}>No sessions are running right now.</span>
        ),
    }),
  ];

  // Intervention lean-in: stuck / idle sessions are the ones worth a look while
  // there's still time to change the hour — not a post-mortem board.
  const attentionSessions = liveSessions.filter(
    (s) => s.status === 'stuck' || s.status === 'idle',
  );
  if (attentionSessions.length > 0) {
    const stuckN = attentionSessions.filter((s) => s.status === 'stuck').length;
    const idleN = attentionSessions.filter((s) => s.status === 'idle').length;
    const attentionBits: ReactNode[] = [];
    if (stuckN > 0) {
      attentionBits.push(
        <>
          {countMetric(stuckN, 'session')} {plural(stuckN, 'is', 'are')} stuck
        </>,
      );
    }
    if (idleN > 0) {
      attentionBits.push(
        <>
          {countMetric(idleN, 'session')} {plural(idleN, 'has', 'have')} gone idle
        </>,
      );
    }
    sessionsQuestions.push(
      listQuestion({
        id: 'look-now',
        question: 'Should you look now?',
        answer: (
          <>
            Yes, {naturalListNodes(attentionBits)}. Worth a look while you can still change the hour.
          </>
        ),
        children: (
          <LiveSessionsTable
            sessions={attentionSessions}
            variant="detail"
            actionLabel="Replay"
            onRowClick={(s) => onOpenReplay(s.sessionId, s.repoId)}
          />
        ),
      }),
    );
  }

  if (needsYouCount > 0) {
    sessionsQuestions.push(
      listQuestion({
        id: 'needs-you',
        question: 'Does anything need you right now?',
        answer: (
          <>
            {countMetric(needsYouCount, 'session')} {plural(needsYouCount, 'is', 'are')} waiting on
            you.
          </>
        ),
        // The "why" is a caveat, not the finding, so it belongs below the viz.
        note: 'Usually a permission prompt.',
        children: needsYouTable,
      }),
    );
  }

  const activeQuestions = activeTab === 'files' ? filesQuestions : sessionsQuestions;

  return (
    <DetailView
      backLabel={backLabel}
      onBack={onBack}
      title="live"
      subtitle={liveSubtitle}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="live"
      tablistLabel="Live sections"
      panelCompact
    >
      <FocusedDetailView
        questions={activeQuestions}
        activeId={questionParam}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </DetailView>
  );
}

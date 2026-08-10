import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { REPLAY_SESSION_REQUEST_MAX } from '@seorak/types';

import glass from '../../components/surface/glass.module.css';
import cmd from '../../styles/commandStrip.module.css';
import { ProjectDropdownSwatch, ProjectDropdownToggle } from '../../components/ProjectDropdown/ProjectDropdown.js';
import { projectSquircleKey } from '../../components/ProjectSquircle/ProjectSquircle.js';
import type { SessionSummary } from '../../lib/apiSchemas.js';
import { projectGradient } from '../../lib/projectGradient.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import { formatDuration } from '../../lib/utils.js';
import { formatCost, formatTokens } from '../../widgets/utils.js';
import { setSessionsInScope } from './replayScope.js';
import styles from './ReplayCustomizePanel.module.css';

type StatusFilter = 'all' | SessionSummary['status'];

const STATUS_CYCLE: StatusFilter[] = ['all', 'active', 'idle', 'stuck', 'ended'];
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  active: 'Active',
  idle: 'Idle',
  stuck: 'Stuck',
  ended: 'Ended',
};

function sessionLabel(session: SessionSummary): string {
  const recency = formatRelativeTime(session.lastEventAt);
  return recency ? `${session.status} ${recency}` : session.status;
}

function durationLabel(session: SessionSummary): string {
  return formatDuration(Math.round(session.elapsedSeconds / 60));
}

/**
 * Everything the row puts on screen is searchable. Project led that list and
 * was missing from it — the first column, the one thing a reader with sessions
 * across several projects would type first, and typing it returned nothing.
 */
export function sessionSearchText(session: SessionSummary): string {
  return [
    session.project,
    session.status,
    session.agent,
    session.currentTool ?? '',
    formatRelativeTime(session.lastEventAt),
    formatTokens(session.tokens.total),
    formatCost(session.costUsd),
    `${session.toolCallCount} calls`,
    durationLabel(session),
  ]
    .join(' ')
    .toLowerCase();
}

export default function ReplayCustomizePanel({
  open,
  sessions,
  selectedSessionIds,
  usingCustomSelection,
  onToggleSession,
  onSetSessions,
  onClose,
}: {
  open: boolean;
  sessions: SessionSummary[];
  selectedSessionIds: string[];
  usingCustomSelection: boolean;
  onToggleSession: (sessionId: string) => void;
  onSetSessions: (sessionIds: string[] | null) => void;
  onClose: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [listFade, setListFade] = useState<'none' | 'top' | 'bottom' | 'both'>('none');
  const [searchBottom, setSearchBottom] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setStatusFilter('all');
      setSearchOpen(false);
      setSearchQuery('');
    }
  }, [open]);

  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchOpen]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((session) => {
      if (statusFilter !== 'all' && session.status !== statusFilter) return false;
      if (q && !sessionSearchText(session).includes(q)) return false;
      return true;
    });
  }, [sessions, searchQuery, statusFilter]);

  const selectedSet = useMemo(() => new Set(selectedSessionIds), [selectedSessionIds]);

  // The master control acts on what the filter is SHOWING, not on the whole
  // scope — narrow to a handful, take them, and the sessions the filter hid
  // keep whatever state they had. "Only these" is then clear-then-filter-then-
  // take, in standard table order, rather than a second button that means
  // something subtly different from the first.
  const shownIds = useMemo(
    () => filteredSessions.map((session) => session.sessionId),
    [filteredSessions],
  );
  const shownSelectedCount = shownIds.filter((id) => selectedSet.has(id)).length;
  const allShownSelected = shownIds.length > 0 && shownSelectedCount === shownIds.length;

  const toggleAllShown = useCallback(() => {
    onSetSessions(
      setSessionsInScope(
        shownIds,
        selectedSessionIds,
        sessions.map((session) => session.sessionId),
        !allShownSelected,
      ),
    );
  }, [allShownSelected, onSetSessions, selectedSessionIds, sessions, shownIds]);

  const cycleStatus = useCallback(() => {
    setStatusFilter((prev) => {
      const index = STATUS_CYCLE.indexOf(prev);
      return STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length]!;
    });
  }, []);

  const updateListFade = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const canUp = el.scrollTop > 0;
    const canDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setListFade(canUp && canDown ? 'both' : canUp ? 'top' : canDown ? 'bottom' : 'none');
  }, []);

  const updateSearchPosition = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const gap = 8;
    setSearchBottom(Math.round(window.innerHeight - panel.getBoundingClientRect().top + gap));
  }, []);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(updateListFade);
  }, [open, filteredSessions.length, statusFilter, searchQuery, updateListFade]);

  useEffect(() => {
    if (!open || !searchOpen) return;
    const frame = requestAnimationFrame(updateSearchPosition);
    window.addEventListener('resize', updateSearchPosition);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateSearchPosition);
    };
  }, [open, searchOpen, filteredSessions.length, updateSearchPosition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) {
        if (event.key === 'Escape') {
          setSearchOpen(false);
          setSearchQuery('');
          event.preventDefault();
        }
        return;
      }

      switch (event.key) {
        case 'Escape':
          onClose();
          event.preventDefault();
          break;
        case '/':
          setSearchOpen((value) => !value);
          if (!searchOpen) setSearchQuery('');
          event.preventDefault();
          break;
        case 'Tab':
          cycleStatus();
          event.preventDefault();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, searchOpen, cycleStatus]);

  if (!open) return null;

  return createPortal(
    <>
      {searchOpen && (
        <div
          className={clsx(cmd.searchBar, styles.replaySearchBar, glass.sheet, glass.rim)}
          style={searchBottom == null ? undefined : { bottom: searchBottom }}
        >
          <svg
            className={cmd.searchIcon}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="6.5" cy="6.5" r="5" />
            <path d="M10.5 10.5 L14.5 14.5" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            className={cmd.searchInput}
            placeholder="Search sessions..."
            aria-label="Search replay sessions"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <span className={cmd.searchHint}>Esc to close</span>
        </div>
      )}

      <div className={clsx(styles.panel, glass.sheetStrong)} ref={panelRef} data-viewport-exclusion="true">
        <div className={styles.tableHead}>
          <span aria-hidden="true">Project</span>
          <span aria-hidden="true">Status</span>
          <span aria-hidden="true">Tool</span>
          <span aria-hidden="true">Tokens</span>
          <span aria-hidden="true">Cost</span>
          <span aria-hidden="true">Calls</span>
          <span aria-hidden="true">Duration</span>
          {/* Master of the column it sits above. The header's last cell was
              empty and directly over the toggles, so the control needs no new
              chrome and no explanation — it is where a table puts this. */}
          <button
            type="button"
            className={styles.headToggle}
            onClick={toggleAllShown}
            disabled={shownIds.length === 0}
            aria-label={`${allShownSelected ? 'Deselect' : 'Select'} ${
              shownIds.length === 1
                ? 'the 1 shown session'
                : `all ${shownIds.length.toLocaleString()} shown sessions`
            }`}
            aria-pressed={allShownSelected}
          >
            <ProjectDropdownToggle
              on={allShownSelected}
              mixed={shownSelectedCount > 0}
            />
          </button>
        </div>
        <div
          ref={listRef}
          className={clsx(
            styles.list,
            listFade === 'top' && cmd.listFadeTop,
            listFade === 'bottom' && cmd.listFadeBottom,
            listFade === 'both' && cmd.listFadeBoth,
          )}
          role="menu"
          aria-label="Replay sessions"
          onScroll={updateListFade}
        >
          {filteredSessions.length === 0 ? (
            <span className={styles.empty}>No sessions match.</span>
          ) : (
            filteredSessions.map((session) => {
              const selected = selectedSet.has(session.sessionId);
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  className={clsx(styles.row, selected && styles.rowSelected)}
                  onClick={() => onToggleSession(session.sessionId)}
                  role="menuitemcheckbox"
                  aria-checked={selected}
                >
                  <span className={styles.projectCell}>
                    <ProjectDropdownSwatch
                      style={{
                        background: projectGradient(projectSquircleKey(session.repoId, session.project)),
                      }}
                    />
                    <span className={styles.projectName}>{session.project || 'project'}</span>
                  </span>
                  <span className={styles.sessionName}>{sessionLabel(session)}</span>
                  <span className={styles.sessionTool}>{session.currentTool || session.agent}</span>
                  <span className={styles.numCell}>{formatTokens(session.tokens.total)}</span>
                  <span className={styles.numCell}>{formatCost(session.costUsd)}</span>
                  <span className={styles.numCell}>{session.toolCallCount.toLocaleString()}</span>
                  <span className={styles.numCell}>{durationLabel(session)}</span>
                  <ProjectDropdownToggle on={selected} />
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className={clsx(cmd.strip, styles.replayStrip, glass.rim)} ref={stripRef} data-viewport-exclusion="true">
        {/* State, not an action — where the selection stands once the panel
            closes. At a handful you can count the toggles; at hundreds you
            cannot, and the master control needs its effect to be legible. */}
        <span className={cmd.stripLabel} aria-live="polite">
          {`${selectedSessionIds.length.toLocaleString()} of ${sessions.length.toLocaleString()} selected, ${REPLAY_SESSION_REQUEST_MAX} maximum`}
        </span>
        <span className={cmd.stripDivider} />
        <button type="button" className={cmd.stripAction} onClick={onClose}>
          Done <kbd className={cmd.kbd}>Esc</kbd>
        </button>
        <span className={cmd.stripDivider} />
        <button
          type="button"
          className={clsx(cmd.stripAction, statusFilter !== 'all' && cmd.stripActionActive)}
          onClick={cycleStatus}
          aria-label={`Filter sessions by review state: ${STATUS_LABELS[statusFilter]}`}
        >
          Review state: {STATUS_LABELS[statusFilter]} <kbd className={cmd.kbd}>Tab</kbd>
        </button>
        <span className={cmd.stripDivider} />
        <button
          type="button"
          className={clsx(cmd.stripAction, searchOpen && cmd.stripActionActive)}
          onClick={() => {
            setSearchOpen((value) => !value);
            if (!searchOpen) setSearchQuery('');
          }}
        >
          Search <kbd className={cmd.kbd}>/</kbd>
        </button>
      </div>
    </>,
    document.body,
  );
}

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  IDLE_THRESHOLD_MS,
  STUCK_THRESHOLD_MS,
  type SessionSummary,
} from '@seorak/types';
import ToolIcon from '../ToolIcon/ToolIcon.js';
import Tooltip from '../Tooltip/Tooltip.js';
import { ProjectIdentity, projectSquircleKey } from '../ProjectSquircle/ProjectSquircle.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { formatDuration } from '../../lib/utils.js';
import { liveCostLabel, liveNeedsYou } from '../../widgets/utils.js';
import styles from './LiveSessionsTable.module.css';

/** Past this many seconds since the last event a session reads as "stale". */
export const STALE_AFTER_SECONDS = 30;

const IDLE_S = Math.round(IDLE_THRESHOLD_MS / 1000);
const STUCK_MIN = Math.round(STUCK_THRESHOLD_MS / 60_000);

interface StatusPresence {
  label: string;
  color: string;
  definition: string;
}

function statusPresence(status: string): StatusPresence {
  switch (status) {
    case 'active':
      return {
        label: 'active',
        color: 'var(--live, var(--accent))',
        definition: `Events are arriving right now (last one under ${IDLE_S}s ago).`,
      };
    case 'idle':
      return {
        label: 'idle',
        color: 'var(--muted)',
        definition: `No events for ${IDLE_S}s or more. The session is still open.`,
      };
    case 'stuck':
      return {
        label: 'stuck',
        color: 'var(--danger)',
        definition: `No events for ${STUCK_MIN} minutes or more, with the session still open.`,
      };
    case 'ended':
      return {
        label: 'ended',
        color: 'var(--soft)',
        definition: 'The session has ended.',
      };
    default:
      return {
        label: status,
        color: 'var(--muted)',
        definition: 'Session state reported by the collector.',
      };
  }
}

const NEEDS_YOU: StatusPresence = {
  label: 'needs you',
  color: 'var(--warn)',
  definition: 'Waiting on a permission prompt. The agent is paused until you answer.',
};

export function secondsSinceLastEvent(
  session: SessionSummary,
  nowMs = Date.now(),
): number {
  const lastEventMs = Date.parse(session.lastEventAt);
  return Number.isNaN(lastEventMs)
    ? 0
    : Math.max(0, Math.floor((nowMs - lastEventMs) / 1000));
}

function sessionActivity(
  session: SessionSummary,
  needsYou: boolean,
  secondsSinceUpdate: number,
): string | null {
  if (needsYou) return 'permission prompt';
  if (session.currentTool && session.status === 'active') return session.currentTool;
  if (session.status === 'stuck') {
    return `quiet ${formatDuration(Math.max(1, Math.floor(secondsSinceUpdate / 60)))}`;
  }
  return null;
}

export interface LiveSessionsTableProps {
  sessions: SessionSummary[];
  onRowClick: (session: SessionSummary) => void;
  /** Per-row drill affordance label. Default "View". */
  actionLabel?: string;
  /** Scroll this session into view when mounted (LiveNow focus drill-in). */
  focusSessionId?: string | null;
  /** Widget face (subgrid + container queries) vs detail drill-in layout. */
  variant?: 'widget' | 'detail';
  /** Optional footer row (e.g. SectionOverflow) spanning all columns in widget mode. */
  footer?: ReactNode;
  className?: string;
}

export default function LiveSessionsTable({
  sessions,
  onRowClick,
  actionLabel = 'View',
  focusSessionId = null,
  variant = 'widget',
  footer,
  className,
}: LiveSessionsTableProps) {
  const focusRowRef = useRef<HTMLButtonElement>(null);
  const isDetail = variant === 'detail';

  useEffect(() => {
    if (!focusSessionId) return;
    const el = focusRowRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 260);
    return () => clearTimeout(t);
  }, [focusSessionId]);

  const table = (
    <div className={clsx(styles.table, isDetail && styles.tableDetail, className)}>
      <div className={styles.header}>
        <span>Project</span>
        <span>Tool</span>
        <span>Status</span>
        <span className={styles.activityCol}>Activity</span>
        <span>Duration</span>
        <span aria-hidden="true" />
      </div>
      <div className={styles.body}>
        {sessions.map((session, i) => {
          const meta = getToolMeta(session.agent);
          const sessionLabel = formatDuration(Math.floor(session.elapsedSeconds / 60));
          const secondsSinceUpdate = secondsSinceLastEvent(session);
          const isStale = secondsSinceUpdate > STALE_AFTER_SECONDS;
          const costLabel = liveCostLabel(session.costUsd, session.tokens.total, 2);
          const needsYou = liveNeedsYou(session);
          const presence = needsYou ? NEEDS_YOU : statusPresence(session.status);
          const activity = sessionActivity(session, needsYou, secondsSinceUpdate);
          const isFocused = session.sessionId === focusSessionId;

          return (
            <button
              key={session.sessionId}
              ref={isFocused ? focusRowRef : undefined}
              type="button"
              className={clsx(styles.row, isStale && styles.rowStale)}
              style={{ '--row-index': i } as CSSProperties}
              onClick={() => onRowClick(session)}
              aria-label={
                actionLabel === 'Replay'
                  ? `Open replay for ${session.project || 'unknown project'} (${presence.label})`
                  : `View ${session.project || 'unknown project'} session (${presence.label})`
              }
            >
              <ProjectIdentity
                projectKey={projectSquircleKey(session.repoId, session.project)}
                label={session.project || '--'}
                title={session.project}
              />
              <span className={clsx(styles.cell, styles.cellTool)}>
                <ToolIcon tool={session.agent} size={16} />
                <span className={styles.toolIdentity}>
                  <span>{meta.label}</span>
                  {session.member ? (
                    <span className={styles.memberName}>{session.member.displayName}</span>
                  ) : null}
                </span>
              </span>
              <span className={styles.status}>
                <Tooltip label={presence.definition} placement="right" wrap>
                  <span className={styles.statusWord} style={{ color: presence.color }}>
                    {presence.label}
                  </span>
                </Tooltip>
              </span>
              <span
                className={clsx(
                  styles.cell,
                  styles.activityCol,
                  !activity && styles.cellEmpty,
                )}
              >
                {activity ?? '--'}
              </span>
              <span
                className={clsx(styles.cell, styles.cellNum)}
                title={`Running ${sessionLabel}, ${costLabel} so far`}
              >
                {sessionLabel}
              </span>
              <span className={styles.actionPill}>{actionLabel}</span>
            </button>
          );
        })}
      </div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  );

  if (isDetail) return table;

  return <div className={styles.container}>{table}</div>;
}

import { REPLAY_SESSION_REQUEST_MAX } from '@seorak/types';
import type { SessionSummary } from '../../lib/apiSchemas.js';
import type { ReplayProjectOption } from './ReplaySelectionPanel.js';

export const REPLAY_RANGE_OPTIONS = [1, 7, 30, 90] as const;
export type ReplayRangeDays = (typeof REPLAY_RANGE_OPTIONS)[number];

export function parseListParam(value: string | null): string[] {
  if (value == null) return [];
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function parseRangeParam(value: string | null): ReplayRangeDays {
  const n = Number(value);
  return REPLAY_RANGE_OPTIONS.includes(n as ReplayRangeDays) ? (n as ReplayRangeDays) : 1;
}

/** Plain phrase for the selected replay window — matches the range picker labels. */
export function replayRangePhrase(rangeDays: ReplayRangeDays): string {
  if (rangeDays === 1) return 'Today';
  if (rangeDays === 7) return 'Over the last 7 days';
  if (rangeDays === 30) return 'Over the last 30 days';
  return 'Over the last 90 days';
}

export function inRange(
  session: { startedAt: string; lastEventAt: string },
  rangeDays: ReplayRangeDays,
): boolean {
  const anchor = Date.parse(session.lastEventAt || session.startedAt);
  if (Number.isNaN(anchor)) return false;
  const cutoff = Date.now() - rangeDays * 86_400_000;
  return anchor >= cutoff;
}

export function resolveSelectedProjects({
  projects,
  projectsParam,
}: {
  projects: ReplayProjectOption[];
  projectsParam: string | null;
}): ReplayProjectOption[] {
  if (projects.length === 0) return [];
  const byId = new Map(projects.map((project) => [project.repoId, project]));
  const explicit = parseListParam(projectsParam)
    .map((id) => byId.get(id))
    .filter((project): project is ReplayProjectOption => Boolean(project));
  if (explicit.length > 0) return explicit;
  return projects;
}

/** URL `sessions` param: null when all scoped sessions are selected. */
export function sessionsParamForSelection(
  sessionIds: string[],
  scopedSessionIds: string[],
): string | null {
  const boundedIds = sessionIds.slice(0, REPLAY_SESSION_REQUEST_MAX);
  if (boundedIds.length === 0) return '';
  if (
    scopedSessionIds.length <= REPLAY_SESSION_REQUEST_MAX &&
    boundedIds.length === scopedSessionIds.length &&
    sameIds(boundedIds, scopedSessionIds)
  ) {
    return null;
  }
  return boundedIds.join(',');
}

/** Toggle one session in scope; order follows scopedSessionIds. */
export function toggleSessionInScope(
  sessionId: string,
  selectedIds: string[],
  scopedSessionIds: string[],
): string[] {
  const selected = new Set(selectedIds);
  if (selected.has(sessionId)) selected.delete(sessionId);
  else {
    const selectedInScope = scopedSessionIds.filter((id) => selected.has(id));
    if (selectedInScope.length >= REPLAY_SESSION_REQUEST_MAX) {
      return selectedInScope.slice(0, REPLAY_SESSION_REQUEST_MAX);
    }
    selected.add(sessionId);
  }
  return scopedSessionIds
    .filter((id) => selected.has(id))
    .slice(0, REPLAY_SESSION_REQUEST_MAX);
}

/**
 * Set every listed session to one state at once, leaving the rest of the
 * selection alone. This is what the picker's master control does over whatever
 * the filter is currently showing — narrowing to a handful and taking them
 * should not cost one click per session, and it must not silently drop the
 * sessions the filter happens to be hiding.
 *
 * Order follows the scope, so the URL param a selection produces is stable
 * whichever way the reader arrived at it.
 */
export function setSessionsInScope(
  sessionIds: string[],
  selectedIds: string[],
  scopedSessionIds: string[],
  selected: boolean,
): string[] {
  const next = new Set(selectedIds);
  for (const id of sessionIds) {
    if (selected) next.add(id);
    else next.delete(id);
  }
  return scopedSessionIds
    .filter((id) => next.has(id))
    .slice(0, REPLAY_SESSION_REQUEST_MAX);
}

export function resolveSelectedSessionIds({
  selectedProjects,
  sessionsParam,
  scopedSessions,
}: {
  selectedProjects: ReplayProjectOption[];
  sessionsParam: string | null;
  scopedSessions: SessionSummary[];
}): string[] {
  if (selectedProjects.length === 0) return [];
  const projectIds = new Set(
    selectedProjects.flatMap((project) => project.sessions.map((session) => session.sessionId)),
  );
  const explicitIds =
    sessionsParam != null ? parseListParam(sessionsParam).filter((id) => projectIds.has(id)) : [];
  if (sessionsParam != null) {
    return explicitIds.slice(0, REPLAY_SESSION_REQUEST_MAX);
  }
  return scopedSessions
    .map((session) => session.sessionId)
    .slice(0, REPLAY_SESSION_REQUEST_MAX);
}

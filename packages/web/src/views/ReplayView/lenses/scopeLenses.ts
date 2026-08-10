// The structural lenses: what is in the scope, and what one session was.

import { formatDuration } from '../../../lib/utils.js';
import { formatCost, formatTokens } from '../../../widgets/utils.js';
import { buildReplayReviewBase } from '../replayReviewModel.js';
import { projectFor, repoIdFor } from '../replaySessionHelpers.js';
import { formatTimelineAxis, windowFrac } from '../replayTimeline.js';
import type {
  ReplayLensInput,
  ReplayLensResult,
  ReplayLensRow,
  ReplayLensTone,
} from './types.js';
import { coverageFor, countLabel, emptyResult, loadedLanes } from './shared.js';

function attentionTone(count: number): ReplayLensTone | undefined {
  return count > 0 ? 'warning' : undefined;
}

const PROJECT_COLUMNS = ['Sessions', 'Elapsed', 'Cost', 'Attention', 'First seen'];
const SESSION_COLUMNS = ['Elapsed', 'Cost', 'Tool calls', 'Attention'];

/** Every project in the period, heaviest measured spend first. */
export function computeProjects(input: ReplayLensInput): ReplayLensResult {
  const base = buildReplayReviewBase(input.lanes, input.timeline);
  const coverage = coverageFor(input, base.allItems.length, false);
  if (input.lanes.length === 0) {
    return emptyResult('projects', 'table', 'No projects are in this replay scope.', coverage);
  }

  const rowsBySession = new Map(base.sessionRows.map((row) => [row.sessionId, row]));
  const firstBySession = new Map<string, number>();
  for (const item of base.allItems) {
    const current = firstBySession.get(item.sessionId);
    if (current == null || item.elapsedMs < current) {
      firstBySession.set(item.sessionId, item.elapsedMs);
    }
  }

  type Entry = {
    repoId: string;
    project: string;
    sessions: number;
    durationMs: number;
    costUsd: number;
    attention: number;
    firstElapsedMs: number | null;
  };
  const byProject = new Map<string, Entry>();

  for (const lane of input.lanes) {
    const repoId = repoIdFor(lane.session, lane.sessionId);
    const row = rowsBySession.get(lane.sessionId);
    const entry =
      byProject.get(repoId) ??
      ({
        repoId,
        project: projectFor(lane.session, lane.sessionId),
        sessions: 0,
        durationMs: 0,
        costUsd: 0,
        attention: 0,
        firstElapsedMs: null,
      } satisfies Entry);

    entry.sessions += 1;
    entry.durationMs += row?.durationMs ?? 0;
    entry.costUsd += row?.costUsd ?? 0;
    entry.attention += row?.attentionCount ?? 0;

    const first = firstBySession.get(lane.sessionId);
    if (first != null && (entry.firstElapsedMs == null || first < entry.firstElapsedMs)) {
      entry.firstElapsedMs = first;
    }
    byProject.set(repoId, entry);
  }

  const entries = [...byProject.values()].sort(
    (a, b) => b.costUsd - a.costUsd || a.project.localeCompare(b.project),
  );
  const totalCost = entries.reduce((sum, entry) => sum + entry.costUsd, 0);

  const rows: ReplayLensRow[] = entries.map((entry) => ({
    id: `project-${entry.repoId}`,
    label: entry.project,
    value: entry.costUsd,
    display: formatCost(entry.costUsd),
    share: totalCost > 0 ? entry.costUsd / totalCost : undefined,
    target: { kind: 'project', id: entry.repoId },
    cells: [
      entry.sessions.toLocaleString(),
      formatDuration(Math.round(entry.durationMs / 60_000)),
      formatCost(entry.costUsd),
      entry.attention.toLocaleString(),
      entry.firstElapsedMs == null ? '—' : formatTimelineAxis(input.timeline, entry.firstElapsedMs),
    ],
    cellTones: [undefined, undefined, undefined, attentionTone(entry.attention), undefined],
  }));

  const top = entries[0];
  const headline = top
    ? `${countLabel(entries.length, 'project')} in this period; ${top.project} carried the most measured spend at ${formatCost(top.costUsd)}.`
    : null;

  return {
    id: 'projects',
    viz: 'table',
    headline,
    rows,
    columns: PROJECT_COLUMNS,
    empty: null,
    coverage,
  };
}

/** Every session in the current scope. */
export function computeSessions(input: ReplayLensInput): ReplayLensResult {
  const base = buildReplayReviewBase(input.lanes, input.timeline);
  const coverage = coverageFor(input, base.allItems.length, false);
  if (base.sessionRows.length === 0) {
    return emptyResult('sessions', 'table', 'No sessions are in this replay scope.', coverage);
  }

  const rows: ReplayLensRow[] = base.sessionRows.map((row) => ({
    id: `session-${row.sessionId}`,
    label: row.label,
    value: row.costUsd,
    display: formatCost(row.costUsd),
    target: { kind: 'session', id: row.sessionId },
    tone: attentionTone(row.attentionCount),
    facts: [{ label: 'project', value: row.project }],
    cells: [
      formatDuration(Math.round(row.durationMs / 60_000)),
      formatCost(row.costUsd),
      row.toolCallCount.toLocaleString(),
      row.attentionCount.toLocaleString(),
    ],
    cellTones: [undefined, undefined, undefined, attentionTone(row.attentionCount)],
  }));

  const needing = base.sessionRows.filter((row) => row.attentionCount > 0).length;
  const headline =
    needing > 0
      ? `${countLabel(base.sessionRows.length, 'session')} in scope; ${needing.toLocaleString()} ${needing === 1 ? 'has' : 'have'} something needing attention.`
      : `${countLabel(base.sessionRows.length, 'session')} in scope, none flagged for attention.`;

  return {
    id: 'sessions',
    viz: 'table',
    headline,
    rows,
    columns: SESSION_COLUMNS,
    empty: null,
    coverage,
  };
}

/** Totals for the focused session, plus its keyframes in timeline order. */
export function computeSessionDetail(input: ReplayLensInput): ReplayLensResult {
  const base = buildReplayReviewBase(input.lanes, input.timeline);
  const coverage = coverageFor(input, base.allItems.length, false);
  const lane = loadedLanes(input.lanes)[0];
  const row = lane ? base.sessionRows.find((entry) => entry.sessionId === lane.sessionId) : null;

  if (!lane || !row) {
    return emptyResult(
      'session-detail',
      'stat-grid',
      'This session has no loaded replay.',
      coverage,
    );
  }

  const stat = (
    id: string,
    label: string,
    value: number,
    display: string,
    tone?: ReplayLensTone,
  ): ReplayLensRow => ({ id, label, value, display, tone });

  const rows: ReplayLensRow[] = [
    stat('elapsed', 'Elapsed', row.durationMs, formatDuration(Math.round(row.durationMs / 60_000))),
    stat('cost', 'Cost', row.costUsd, formatCost(row.costUsd)),
    stat('tokens', 'Tokens', row.tokensTotal, formatTokens(row.tokensTotal)),
    stat('toolCalls', 'Tool calls', row.toolCallCount, row.toolCallCount.toLocaleString()),
    stat('prompts', 'Messages sent', row.promptCount, row.promptCount.toLocaleString()),
    stat(
      'attention',
      'Needs attention',
      row.attentionCount,
      row.attentionCount.toLocaleString(),
      attentionTone(row.attentionCount),
    ),
  ];

  if (row.filesTouchedUncommitted > 0) {
    rows.push(
      stat(
        'uncommitted',
        'Uncommitted at end',
        row.filesTouchedUncommitted,
        row.filesTouchedUncommitted.toLocaleString(),
        'warning',
      ),
    );
  }

  const keyframes = base.allItems
    .filter((item) => item.source === 'keyframe' && item.sessionId === lane.sessionId)
    .sort((a, b) => a.elapsedMs - b.elapsedMs);

  const secondaryRows: ReplayLensRow[] = keyframes.map((item) => ({
    id: item.id,
    label: item.title,
    value: item.elapsedMs,
    display: formatTimelineAxis(input.timeline, item.elapsedMs),
    share: Math.max(0, Math.min(1, windowFrac(input.window, item.elapsedMs))),
    elapsedMs: item.elapsedMs,
    tone:
      item.tone === 'alert'
        ? 'negative'
        : item.tone === 'commit'
          ? 'positive'
          : item.tone === 'peak'
            ? 'warning'
            : undefined,
    facts: item.detail ? [{ label: 'detail', value: item.detail }] : [],
  }));

  return {
    id: 'session-detail',
    viz: 'stat-grid',
    headline: `${row.label} in ${row.project} ran ${formatDuration(Math.round(row.durationMs / 60_000))} for ${formatCost(row.costUsd)}.`,
    rows,
    secondary:
      secondaryRows.length > 0
        ? { label: 'Keyframes', viz: 'timeline-marks', rows: secondaryRows }
        : undefined,
    empty: null,
    coverage,
  };
}

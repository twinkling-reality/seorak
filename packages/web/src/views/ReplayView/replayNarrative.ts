import type { Keyframe, ReplaySession, SessionSummary } from '../../lib/apiSchemas.js';
import { formatCost, formatRate } from '../../widgets/utils.js';
import { burnRateAtPlayhead, formatReplayClock } from './replayPlayback.js';

export type NarrativeMode = 'summary' | 'attention' | 'review';

/** In-UI + URL (`?q=`) filters for the event log (display only). */
export const NARRATIVE_MODE_OPTIONS: ReadonlyArray<{
  mode: NarrativeMode;
  label: string;
  /** For the cockpit's narrow inspector rail. The hint still carries the full meaning. */
  shortLabel: string;
  hint: string;
}> = [
  {
    mode: 'summary',
    label: 'Near playhead',
    shortLabel: 'Near',
    hint: 'Events close to the scrubber, plus session start and end.',
  },
  {
    mode: 'attention',
    label: 'Errors & spikes',
    shortLabel: 'Attention',
    hint: 'Tool errors and cost spikes across the full scope. Commits are not included.',
  },
  {
    mode: 'review',
    label: 'Errors, spikes, commits',
    shortLabel: 'All marked',
    hint: 'All marked moments in scope: errors, spikes, and commit milestones.',
  },
];

export type NarrativeSignal = {
  type: 'keyframe' | 'moment';
  tone: 'alert' | 'peak' | 'commit' | 'neutral';
  label: string;
  text: string;
};

export type ReviewSignal = {
  tone: 'alert' | 'peak' | 'commit' | 'neutral';
  text: string;
};

function sessionName(session: SessionSummary | null, fallback: string): string {
  return session?.project || fallback;
}

function summarizeKeyframe(keyframe: Keyframe, session: SessionSummary | null, fallback: string): string {
  const name = sessionName(session, fallback);
  return keyframe.detail ? `${name}: ${keyframe.label} (${keyframe.detail})` : `${name}: ${keyframe.label}`;
}

export function buildNarrative({
  mode,
  playheadMs,
  statesCount,
  endedCount,
  runningCount,
  replayCount,
  focusedProjectId,
  focusedProjectLabel,
  totalCost,
  currentSignals,
  allReviewSignals,
  alertCount,
  peakBurn,
}: {
  mode: NarrativeMode;
  playheadMs: number;
  statesCount: number;
  endedCount: number;
  runningCount: number;
  replayCount: number;
  focusedProjectId: string | null;
  focusedProjectLabel: string | null;
  totalCost: number;
  currentSignals: NarrativeSignal[];
  allReviewSignals: ReviewSignal[];
  alertCount: number;
  peakBurn: { rate: number; label: string };
}): string {
  if (statesCount === 0) return 'No sessions are selected for this replay.';

  const scopeHint = focusedProjectId && focusedProjectLabel
    ? `Showing ${focusedProjectLabel} sessions. `
    : '';

  if (mode === 'attention') {
    const alerts = currentSignals.filter((signal) => signal.tone === 'alert');
    if (alerts.length > 0) {
      return `${scopeHint}At ${formatReplayClock(playheadMs)}, ${alerts.slice(0, 2).map((signal) => signal.text).join('; ')}.`;
    }
    if (peakBurn.rate > 0) {
      return `${scopeHint}At ${formatReplayClock(playheadMs)}, ${peakBurn.label} is the hottest line at ${formatRate(peakBurn.rate)}.`;
    }
    return `${scopeHint}At ${formatReplayClock(playheadMs)}, nothing near the playhead needs attention.`;
  }

  if (mode === 'review') {
    if (allReviewSignals.length > 0) {
      return allReviewSignals.slice(0, 3).map((signal) => signal.text).join('. ') + '.';
    }
    return 'No review highlights were found in the selected sessions.';
  }

  const markerCount = allReviewSignals.length;
  const loadingNote = replayCount < statesCount ? ` ${statesCount - replayCount} still loading.` : '';
  if (markerCount > 0) {
    const momentLabel = markerCount === 1 ? 'moment' : 'moments';
    return `${scopeHint}${markerCount.toLocaleString()} ${momentLabel} worth revisiting across ${statesCount.toLocaleString()} sessions (${formatCost(totalCost)}). Scrub to see when they land.${loadingNote}`;
  }
  if (runningCount > 0) {
    return `${scopeHint}${runningCount.toLocaleString()} of ${statesCount.toLocaleString()} sessions still running. Scrub elapsed time to compare activity shape.${loadingNote}`;
  }
  return `${scopeHint}${statesCount.toLocaleString()} ended sessions in scope (${formatCost(totalCost)}). Scrub to compare when activity peaked.${loadingNote}`;
}

export { summarizeKeyframe, sessionName };

export function filterQueueForMode<T extends { tone: NarrativeSignal['tone'] }>(
  items: T[],
  mode: NarrativeMode,
): T[] {
  if (mode === 'attention') {
    return items.filter((item) => item.tone === 'alert' || item.tone === 'peak');
  }
  if (mode === 'summary') return [];
  return items;
}

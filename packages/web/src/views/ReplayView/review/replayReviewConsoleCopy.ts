import type { NarrativeMode } from '../replayNarrative.js';
import { filterQueueForMode } from '../replayNarrative.js';
import type { ReplayReviewItem } from '../replayReviewModel.js';

export const REPLAY_EVENT_LOG_EYEBROW = 'Event log';
export const REPLAY_EVENT_LOG_ARIA_LABEL = 'Replay event log';
export const REPLAY_EVENT_LOG_FILTER_ARIA_LABEL = 'Event log filter';

export type UnifiedMomentRow = {
  item: ReplayReviewItem;
  nearPlayhead: boolean;
  lifecycle: boolean;
};

/** Unified right-pane rows — overview shows nearby + bounds; other modes filter the highlight queue. */
export function buildUnifiedMomentList({
  mode,
  nowItems,
  queueItems,
  lifecycleItems,
  playheadNearIds,
}: {
  mode: NarrativeMode;
  nowItems: ReplayReviewItem[];
  queueItems: ReplayReviewItem[];
  lifecycleItems: ReplayReviewItem[];
  playheadNearIds: Set<string>;
}): UnifiedMomentRow[] {
  if (mode === 'summary') {
    const seen = new Set<string>();
    const rows: UnifiedMomentRow[] = [];
    const append = (item: ReplayReviewItem, nearPlayhead: boolean, lifecycle: boolean) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      rows.push({ item, nearPlayhead, lifecycle });
    };

    for (const item of lifecycleItems) {
      if (item.keyframeKind === 'session-start') append(item, false, true);
    }
    for (const item of nowItems.slice(0, 6)) {
      append(item, playheadNearIds.has(item.id), false);
    }
    for (const item of lifecycleItems) {
      if (item.keyframeKind === 'session-end') append(item, false, true);
    }
    return rows;
  }

  return filterQueueForMode(queueItems, mode).map((item) => ({
    item,
    nearPlayhead: playheadNearIds.has(item.id),
    lifecycle: false,
  }));
}

export function reviewQueueEmptyMessage(mode: NarrativeMode): string {
  if (mode === 'summary') {
    return 'No captured events near this point. Scrub the chart or switch filters.';
  }
  if (mode === 'attention') {
    return 'No tool errors or cost spikes in this scope.';
  }
  return 'No marked moments in this scope. No errors, spikes, or commits.';
}

export function reviewNowEmptyMessage(): string {
  return 'No captured moments in this window. Scrub or play to inspect nearby activity.';
}

function sessionAnchor(item: ReplayReviewItem): string {
  return `${item.sessionLabel} for ${item.project}`;
}

function lowerLead(text: string): string {
  if (!text) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function withCost(line: string, item: ReplayReviewItem): string {
  const cost = item.meta.find((part) => part.startsWith('$'));
  return cost ? `${line}, ${cost}` : line;
}

/** One readable sentence per event — no separator dots, no file-metadata tags. */
export function formatEventLogLine(item: ReplayReviewItem): string {
  const anchor = sessionAnchor(item);

  if (item.keyframeKind === 'session-start') return `${anchor} started`;
  if (item.keyframeKind === 'session-end') {
    return item.detail ? `${anchor} ended (${item.detail})` : `${anchor} ended`;
  }
  if (item.keyframeKind === 'first-tool-call') {
    const line = item.detail
      ? `${anchor}, first ${item.detail} tool call`
      : `${anchor}, first tool call`;
    return withCost(line, item);
  }
  if (item.keyframeKind === 'first-error') {
    const line = item.detail
      ? `${anchor}, first error on ${item.detail}`
      : `${anchor}, first error`;
    return withCost(line, item);
  }
  if (item.keyframeKind === 'verification-failed') {
    return withCost(`${anchor}, verification failed`, item);
  }
  if (item.keyframeKind === 'peak-burn') {
    return withCost(`${anchor}, ${lowerLead(item.title)}`, item);
  }
  if (item.keyframeKind === 'biggest-commit') {
    const line = item.detail
      ? `${anchor}, ${lowerLead(item.title)} (${item.detail})`
      : `${anchor}, ${lowerLead(item.title)}`;
    return withCost(line, item);
  }
  if (item.source === 'keyframe') {
    const line = item.detail
      ? `${anchor}, ${lowerLead(item.title)} (${item.detail})`
      : `${anchor}, ${lowerLead(item.title)}`;
    return withCost(line, item);
  }

  if (item.momentKind === 'session.prompt') return `${anchor}, prompt sent`;
  if (item.title === 'Tool call' && item.detail) {
    return withCost(`${anchor}, ${item.detail} tool call`, item);
  }
  if (item.title === 'Tool error' && item.detail) {
    return withCost(`${anchor}, ${item.detail} errored`, item);
  }
  if (item.detail) {
    return withCost(`${anchor}, ${lowerLead(item.title)} (${item.detail})`, item);
  }
  return withCost(`${anchor}, ${lowerLead(item.title)}`, item);
}

import type {
  Keyframe,
  ReplayMoment,
  ReplaySession,
} from '../../lib/apiSchemas.js';
import {
  bucketContainingElapsedMs,
  bucketsThroughElapsedMs,
  burnRateForBucket,
  scrubWindowMs,
  sessionDurationMs,
} from './replayPlayback.js';
import { projectFor, repoIdFor } from './replaySessionHelpers.js';
import {
  axisLabelKind,
  buildReplayTimeline,
  elapsedFromOrigin as elapsedFromScopeOrigin,
  formatTimelineClock,
  formatTimelineStamp,
  sessionsRunningAt,
  timelineSpanMs,
  toSessionElapsedMs,
  type ReplayTimeline,
} from './replayTimeline.js';
import type { SessionLane } from './replayTransforms.js';

export type ReplayReviewTone = 'alert' | 'peak' | 'commit' | 'neutral';
export type ReplayStopMode = 'off' | 'highlights' | 'moments';

export interface ReplayScopeSummary {
  projectCount: number;
  sessionCount: number;
  loadedReplayCount: number;
  loadingCount: number;
  emptyReplayCount: number;
  errorCount: number;
  endedCount: number;
  runningCount: number;
  totalCostUsd: number;
  tokensTotal: number;
  toolCallCount: number;
  promptCount: number;
  filesTouchedUncommitted: number;
  reviewItemCount: number;
  /** Routine timeline pauses (non-highlight moments). */
  routineMomentCount: number;
  highlightCount: number;
  /** Tool errors and verification failures in highlights. */
  alertCount: number;
  /** Peak-burn spikes in highlights. */
  peakCount: number;
  attentionCount: number;
  commitCount: number;
  /** Sum of elapsed time across scoped sessions. */
  totalDurationMs: number;
}

export interface ReplayReviewItem {
  id: string;
  sessionId: string;
  repoId: string;
  project: string;
  sessionLabel: string;
  source: 'keyframe' | 'moment';
  stopKind: 'highlight' | 'moment';
  tone: ReplayReviewTone;
  title: string;
  detail: string | null;
  meta: string[];
  at: string;
  elapsedMs: number;
  timeLabel: string;
  keyframeKind?: Keyframe['kind'];
  momentKind?: ReplayMoment['kind'];
}

/**
 * What the scope captured AT ALL — so a zero at the playhead can be told from
 * a measurement that was never taken. "0 errors" is a real absence only when
 * tool calls were logged; with no tool-call capture the row belongs nowhere.
 */
export interface ReplayNowCaptured {
  toolCalls: boolean;
  checks: boolean;
  prompts: boolean;
}

/**
 * Lane-stable lookups the playhead reads. Built once per scope so scrubbing
 * costs a binary search per stat instead of a walk over every moment: a scope
 * runs to 10,000 rows and the playhead moves every animation frame.
 */
export interface ReplayNowIndex {
  /** Sorted scope-relative elapsed of every captured tool error. */
  errorAt: number[];
  /** Sorted elapsed of every captured verification run, and of the failures. */
  checkAt: number[];
  checkFailedAt: number[];
  /** Sorted elapsed of every captured steering tick. */
  promptAt: number[];
  /** Measured bucket spend across the scope — denominator for the share landed. */
  totalBucketCostUsd: number;
  captured: ReplayNowCaptured;
}

export interface ReplayNowModel {
  playheadMs: number;
  /** Elapsed from the scope origin. */
  clock: string;
  /** The wall-clock instant, or null while elapsed is still the honest read. */
  stamp: string | null;
  /** Sessions whose captured span covers the playhead. */
  runningSessionCount: number;
  /** Sessions in scope — the denominator for that. */
  sessionCount: number;
  /**
   * Spend per minute across the sessions burning at the playhead. Null when no
   * session is inside a measured bucket, or when every live one is unpriced —
   * absent, never a $0.00/min that reads like a quiet stretch.
   */
  burnRateUsdPerMin: number | null;
  /** Cumulative through the playhead bucket (ticks up as you scrub). */
  costUsd: number;
  toolCallCount: number;
  tokensTotal: number;
  /** Current bucket only — shown as inline delta beside the cumulative stat. */
  bucketCostUsd: number;
  bucketToolCallCount: number;
  bucketTokensTotal: number;
  /** Steering ticks captured at or before the playhead. */
  promptCount: number;
  /** Tool calls that errored at or before the playhead. */
  errorCount: number;
  /** Verification runs at or before the playhead, and how many went red. */
  checkCount: number;
  checkFailedCount: number;
  /** 0..1 of the scope's measured spend landed by here. Null when none was. */
  costShare: number | null;
  captured: ReplayNowCaptured;
  items: ReplayReviewItem[];
}

export interface ReplaySessionReviewRow {
  sessionId: string;
  repoId: string;
  project: string;
  label: string;
  status: string;
  durationMs: number;
  costUsd: number;
  tokensTotal: number;
  toolCallCount: number;
  promptCount: number;
  filesTouchedUncommitted: number;
  reviewItemCount: number;
  highlightCount: number;
  attentionCount: number;
}

export interface ReplayReviewModel {
  scope: ReplayScopeSummary;
  now: ReplayNowModel;
  queueItems: ReplayReviewItem[];
  lifecycleItems: ReplayReviewItem[];
  allItems: ReplayReviewItem[];
  sessionRows: ReplaySessionReviewRow[];
}

/** Lane-stable review data — recompute only when lanes change, not on playhead scrub. */
export type ReplayReviewBase = Omit<ReplayReviewModel, 'now'> & { nowIndex: ReplayNowIndex };

function sessionLabel(lane: SessionLane): string {
  return `Session ${lane.index + 1}`;
}

/** Every review item is measured from the one scope origin, not its own session start. */
function elapsedFromStart(timeline: ReplayTimeline, at: string): number | null {
  return elapsedFromScopeOrigin(timeline, at);
}

function keyframeStopKind(kind: Keyframe['kind']): ReplayReviewItem['stopKind'] {
  return ['first-error', 'verification-failed', 'peak-burn', 'biggest-commit'].includes(kind)
    ? 'highlight'
    : 'moment';
}

export function toneForKeyframe(kind: Keyframe['kind']): ReplayReviewTone {
  if (kind === 'first-error' || kind === 'verification-failed') return 'alert';
  if (kind === 'peak-burn') return 'peak';
  if (kind === 'biggest-commit') return 'commit';
  return 'neutral';
}

export function toneForMoment(moment: ReplayMoment): ReplayReviewTone {
  if (moment.errored || moment.verificationPassed === false) return 'alert';
  if (moment.notificationType === 'permission_prompt') return 'alert';
  if (moment.undoKind) return 'alert';
  return 'neutral';
}

function momentStopKind(moment: ReplayMoment): ReplayReviewItem['stopKind'] {
  return toneForMoment(moment) === 'alert' ? 'highlight' : 'moment';
}

function momentTitle(moment: ReplayMoment): string {
  if (moment.kind === 'session.prompt') return 'Prompt sent';
  if (moment.kind === 'session.notification') {
    if (moment.notificationType === 'permission_prompt') return 'Needs you';
    if (moment.notificationType === 'idle_prompt') return 'Idle notice';
    return 'Notification';
  }
  if (moment.verificationPassed === false) return 'Verification failed';
  if (moment.verificationKind) return 'Verification run';
  if (moment.undoKind) return 'Work changed back';
  if (moment.errored) return 'Tool error';
  return 'Tool call';
}

function momentDetail(moment: ReplayMoment): string | null {
  if (moment.kind === 'session.notification') {
    if (moment.notificationType === 'permission_prompt') return 'Permission needed';
    if (moment.notificationType === 'idle_prompt') return 'Idle notice';
    return moment.notificationType ?? null;
  }
  if (moment.kind === 'tool.call') return moment.toolName ?? 'tool';
  if (moment.undoKind) return moment.undoKind;
  return null;
}

function momentMeta(moment: ReplayMoment): string[] {
  if (typeof moment.costUsd === 'number' && moment.costUsd > 0) {
    return [`$${moment.costUsd.toFixed(2)}`];
  }
  return [];
}

function keyframeItem(
  lane: SessionLane & { replay: ReplaySession },
  keyframe: Keyframe,
  timeline: ReplayTimeline,
): ReplayReviewItem | null {
  const elapsedMs = elapsedFromStart(timeline, keyframe.at);
  if (elapsedMs == null) return null;
  return {
    id: `${lane.sessionId}-keyframe-${keyframe.seq}-${keyframe.kind}`,
    sessionId: lane.sessionId,
    repoId: repoIdFor(lane.session, lane.sessionId),
    project: projectFor(lane.session, lane.sessionId),
    sessionLabel: sessionLabel(lane),
    source: 'keyframe',
    stopKind: keyframeStopKind(keyframe.kind),
    tone: toneForKeyframe(keyframe.kind),
    title: keyframe.label,
    detail: keyframe.detail ?? null,
    meta: [],
    at: keyframe.at,
    elapsedMs,
    timeLabel: formatTimelineClock(elapsedMs, timeline.spanMs),
    keyframeKind: keyframe.kind,
  };
}

function momentItem(
  lane: SessionLane & { replay: ReplaySession },
  moment: ReplayMoment,
  timeline: ReplayTimeline,
): ReplayReviewItem | null {
  const elapsedMs = elapsedFromStart(timeline, moment.at);
  if (elapsedMs == null) return null;
  return {
    id: `${lane.sessionId}-moment-${moment.seq}-${moment.kind}`,
    sessionId: lane.sessionId,
    repoId: repoIdFor(lane.session, lane.sessionId),
    project: projectFor(lane.session, lane.sessionId),
    sessionLabel: sessionLabel(lane),
    source: 'moment',
    stopKind: momentStopKind(moment),
    tone: toneForMoment(moment),
    title: momentTitle(moment),
    detail: momentDetail(moment),
    meta: momentMeta(moment),
    at: moment.at,
    elapsedMs,
    timeLabel: formatTimelineClock(elapsedMs, timeline.spanMs),
    momentKind: moment.kind,
  };
}

function loadedLanes(lanes: SessionLane[]): Array<SessionLane & { replay: ReplaySession }> {
  return lanes.filter((lane): lane is SessionLane & { replay: ReplaySession } => Boolean(lane.replay));
}

function byTimeline(a: ReplayReviewItem, b: ReplayReviewItem): number {
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  if (a.project !== b.project) return a.project.localeCompare(b.project);
  return a.sessionId.localeCompare(b.sessionId);
}

function buildItems(
  lanes: Array<SessionLane & { replay: ReplaySession }>,
  timeline: ReplayTimeline,
): ReplayReviewItem[] {
  const bySlot = new Map<string, ReplayReviewItem>();
  for (const lane of lanes) {
    for (const keyframe of lane.replay.keyframes) {
      const item = keyframeItem(lane, keyframe, timeline);
      if (item) bySlot.set(`${lane.sessionId}:${keyframe.seq}`, item);
    }
    for (const moment of lane.replay.moments) {
      const slot = `${lane.sessionId}:${moment.seq}`;
      if (bySlot.has(slot)) continue;
      const item = momentItem(lane, moment, timeline);
      if (item) bySlot.set(slot, item);
    }
  }
  return [...bySlot.values()].sort(byTimeline);
}

function buildScope(lanes: SessionLane[], items: ReplayReviewItem[]): ReplayScopeSummary {
  const projects = new Set(lanes.map((lane) => repoIdFor(lane.session, lane.sessionId)));
  const loaded = loadedLanes(lanes);
  const endedCount = lanes.filter((lane) => lane.replay?.endedAt || lane.session?.status === 'ended').length;
  const totalCostUsd = lanes.reduce(
    (sum, lane) => sum + (lane.replay?.totals.costUsd ?? lane.session?.costUsd ?? 0),
    0,
  );
  const tokensTotal = lanes.reduce(
    (sum, lane) => sum + (lane.replay?.totals.tokensTotal ?? lane.session?.tokens.total ?? 0),
    0,
  );
  const toolCallCount = lanes.reduce(
    (sum, lane) => sum + (lane.replay?.totals.toolCallCount ?? lane.session?.toolCallCount ?? 0),
    0,
  );
  const promptCount = lanes.reduce(
    (sum, lane) => sum + (lane.replay?.totals.promptCount ?? 0),
    0,
  );
  const filesTouchedUncommitted = lanes.reduce(
    (sum, lane) => sum + (lane.replay?.totals.filesTouchedUncommitted ?? 0),
    0,
  );
  const highlights = items.filter((item) => item.stopKind === 'highlight');

  return {
    projectCount: projects.size,
    sessionCount: lanes.length,
    loadedReplayCount: loaded.length,
    loadingCount: lanes.filter((lane) => lane.isLoading).length,
    emptyReplayCount: lanes.filter((lane) => !lane.replay && !lane.isLoading && !lane.error).length,
    errorCount: lanes.filter((lane) => lane.error).length,
    endedCount,
    runningCount: Math.max(0, lanes.length - endedCount),
    totalCostUsd,
    tokensTotal,
    toolCallCount,
    promptCount,
    filesTouchedUncommitted,
    reviewItemCount: items.length,
    routineMomentCount: items.filter((item) => item.stopKind === 'moment').length,
    highlightCount: highlights.length,
    alertCount: highlights.filter((item) => item.tone === 'alert').length,
    peakCount: highlights.filter((item) => item.tone === 'peak').length,
    attentionCount: highlights.filter((item) => item.tone === 'alert' || item.tone === 'peak').length,
    commitCount: highlights.filter((item) => item.tone === 'commit').length,
    totalDurationMs: lanes.reduce((sum, lane) => {
      if (lane.replay) return sum + sessionDurationMs(lane.replay);
      return sum + Math.max(0, (lane.session?.elapsedSeconds ?? 0) * 1000);
    }, 0),
  };
}

/** How many of a sorted list land at or before an instant. */
function countAtOrBefore(sorted: number[], atMs: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid]! <= atMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * A host that cannot price its work reports `costUsd: null` on the session
 * rather than zero. Its buckets still carry 0, so folding it into a burn rate
 * would print "$0.00/min" for a session that was in fact burning something we
 * are not allowed to claim a number for.
 */
function isUnpriced(lane: SessionLane): boolean {
  return lane.session?.costUsd === null;
}

function buildNowIndex(
  lanes: Array<SessionLane & { replay: ReplaySession }>,
  timeline: ReplayTimeline,
): ReplayNowIndex {
  const errorAt: number[] = [];
  const checkAt: number[] = [];
  const checkFailedAt: number[] = [];
  const promptAt: number[] = [];
  let totalBucketCostUsd = 0;
  let toolCalls = false;

  for (const lane of lanes) {
    for (const bucket of lane.replay.activity) totalBucketCostUsd += bucket.costUsd;
    for (const moment of lane.replay.moments) {
      const elapsedMs = elapsedFromStart(timeline, moment.at);
      if (elapsedMs == null) continue;
      if (moment.kind === 'tool.call') toolCalls = true;
      if (moment.kind === 'session.prompt') promptAt.push(elapsedMs);
      if (moment.errored === true) errorAt.push(elapsedMs);
      if (moment.verificationKind != null || moment.verificationPassed != null) {
        checkAt.push(elapsedMs);
        if (moment.verificationPassed === false) checkFailedAt.push(elapsedMs);
      }
    }
  }

  const ascending = (a: number, b: number) => a - b;
  errorAt.sort(ascending);
  checkAt.sort(ascending);
  checkFailedAt.sort(ascending);
  promptAt.sort(ascending);

  return {
    errorAt,
    checkAt,
    checkFailedAt,
    promptAt,
    totalBucketCostUsd,
    captured: {
      toolCalls,
      checks: checkAt.length > 0,
      prompts: promptAt.length > 0,
    },
  };
}

function buildNow(
  lanes: Array<SessionLane & { replay: ReplaySession }>,
  items: ReplayReviewItem[],
  index: ReplayNowIndex,
  playheadMs: number,
  timeline: ReplayTimeline,
): ReplayNowModel {
  let costUsd = 0;
  let toolCallCount = 0;
  let tokensTotal = 0;
  let bucketCostUsd = 0;
  let bucketToolCallCount = 0;
  let bucketTokensTotal = 0;
  let burnRateUsdPerMin: number | null = null;
  let largestWindowMs = 30_000;

  for (const lane of lanes) {
    largestWindowMs = Math.max(largestWindowMs, scrubWindowMs(lane.replay.activity));
    // The playhead runs on the scope clock; each session reads it on its own.
    // A session that had not started yet contributes nothing — clamping its
    // negative offset to zero would credit it with its first bucket.
    const sessionElapsedMs = toSessionElapsedMs(timeline, lane.sessionId, playheadMs);
    if (sessionElapsedMs < 0) continue;

    for (const bucket of bucketsThroughElapsedMs(lane.replay, sessionElapsedMs)) {
      costUsd += bucket.costUsd;
      toolCallCount += bucket.toolCallCount;
      tokensTotal += bucket.tokensTotal;
    }

    // "This bucket" and the burn rate are instantaneous, so they need the
    // bucket the playhead is INSIDE. Past a session's end the clamped lookup
    // would keep reporting its final burst forever.
    const bucket = bucketContainingElapsedMs(lane.replay, sessionElapsedMs);
    if (!bucket) continue;
    bucketCostUsd += bucket.costUsd;
    bucketToolCallCount += bucket.toolCallCount;
    bucketTokensTotal += bucket.tokensTotal;
    if (isUnpriced(lane)) continue;
    const rate = burnRateForBucket(bucket);
    if (rate != null) burnRateUsdPerMin = (burnRateUsdPerMin ?? 0) + rate;
  }

  const spanMs = timelineSpanMs(timeline);

  return {
    playheadMs,
    clock: formatTimelineClock(playheadMs, timeline.spanMs),
    // Past a few hours of scope the reader wants to know *when*, the same rule
    // the axis switches on.
    stamp: axisLabelKind(spanMs) === 'elapsed' ? null : formatTimelineStamp(timeline, playheadMs),
    runningSessionCount: sessionsRunningAt(timeline, playheadMs).length,
    sessionCount: timeline.sessionSpans.size,
    burnRateUsdPerMin,
    costUsd,
    toolCallCount,
    tokensTotal,
    bucketCostUsd,
    bucketToolCallCount,
    bucketTokensTotal,
    promptCount: countAtOrBefore(index.promptAt, playheadMs),
    errorCount: countAtOrBefore(index.errorAt, playheadMs),
    checkCount: countAtOrBefore(index.checkAt, playheadMs),
    checkFailedCount: countAtOrBefore(index.checkFailedAt, playheadMs),
    costShare: index.totalBucketCostUsd > 0 ? costUsd / index.totalBucketCostUsd : null,
    captured: index.captured,
    items: items
      .filter((item) => Math.abs(item.elapsedMs - playheadMs) <= largestWindowMs)
      .sort((a, b) => Math.abs(a.elapsedMs - playheadMs) - Math.abs(b.elapsedMs - playheadMs)),
  };
}

function buildSessionRows(lanes: SessionLane[], items: ReplayReviewItem[]): ReplaySessionReviewRow[] {
  return lanes.map((lane) => {
    const laneItems = items.filter((item) => item.sessionId === lane.sessionId);
    const highlights = laneItems.filter((item) => item.stopKind === 'highlight');
    const durationMs = lane.replay
      ? sessionDurationMs(lane.replay)
      : Math.max(0, (lane.session?.elapsedSeconds ?? 0) * 1000);
    return {
      sessionId: lane.sessionId,
      repoId: repoIdFor(lane.session, lane.sessionId),
      project: projectFor(lane.session, lane.sessionId),
      label: sessionLabel(lane),
      status: lane.session?.status ?? (lane.replay ? 'loaded' : lane.isLoading ? 'loading' : 'empty'),
      durationMs,
      costUsd: lane.replay?.totals.costUsd ?? lane.session?.costUsd ?? 0,
      tokensTotal: lane.replay?.totals.tokensTotal ?? lane.session?.tokens.total ?? 0,
      toolCallCount: lane.replay?.totals.toolCallCount ?? lane.session?.toolCallCount ?? 0,
      promptCount: lane.replay?.totals.promptCount ?? 0,
      filesTouchedUncommitted: lane.replay?.totals.filesTouchedUncommitted ?? 0,
      reviewItemCount: laneItems.length,
      highlightCount: highlights.length,
      attentionCount: highlights.filter((item) => item.tone === 'alert' || item.tone === 'peak').length,
    };
  });
}

function buildLifecycleItems(items: ReplayReviewItem[]): ReplayReviewItem[] {
  return items
    .filter(
      (item) => item.keyframeKind === 'session-start' || item.keyframeKind === 'session-end',
    )
    .sort(byTimeline);
}

export function buildReplayReviewBase(
  lanes: SessionLane[],
  timeline: ReplayTimeline = buildReplayTimeline(lanes),
): ReplayReviewBase {
  const loaded = loadedLanes(lanes);
  const allItems = buildItems(loaded, timeline);
  const queueItems = allItems.filter((item) => item.stopKind === 'highlight');
  return {
    scope: buildScope(lanes, allItems),
    queueItems,
    lifecycleItems: buildLifecycleItems(allItems),
    allItems,
    sessionRows: buildSessionRows(lanes, allItems),
    nowIndex: buildNowIndex(loaded, timeline),
  };
}

export function buildReplayNow(
  lanes: SessionLane[],
  base: Pick<ReplayReviewBase, 'allItems' | 'nowIndex'>,
  playheadMs: number,
  timeline: ReplayTimeline = buildReplayTimeline(lanes),
): ReplayNowModel {
  return buildNow(loadedLanes(lanes), base.allItems, base.nowIndex, playheadMs, timeline);
}

export function buildReplayReviewModel(
  lanes: SessionLane[],
  playheadMs: number,
  timeline: ReplayTimeline = buildReplayTimeline(lanes),
): ReplayReviewModel {
  const base = buildReplayReviewBase(lanes, timeline);
  return {
    ...base,
    now: buildReplayNow(lanes, base, playheadMs, timeline),
  };
}

export function stopTargetsForMode(base: ReplayReviewBase, mode: ReplayStopMode): ReplayReviewItem[] {
  if (mode === 'off') return [];
  const items = mode === 'highlights' ? base.queueItems : base.allItems;
  return items.filter((item) => item.elapsedMs > 0).sort(byTimeline);
}

function firstElapsedMs(
  items: ReplayReviewItem[],
  filter: (item: ReplayReviewItem) => boolean,
): number | null {
  const match = items.filter(filter).sort(byTimeline).find((item) => item.elapsedMs > 0);
  return match?.elapsedMs ?? null;
}

/** First worth-revisiting highlight in timeline order. */
export function firstRevisitElapsedMs(queueItems: ReplayReviewItem[]): number | null {
  return firstElapsedMs(queueItems, () => true);
}

/** First alert or peak-burn highlight in timeline order. */
export function firstAttentionElapsedMs(queueItems: ReplayReviewItem[]): number | null {
  return firstElapsedMs(queueItems, (item) => item.tone === 'alert' || item.tone === 'peak');
}

/** First commit highlight in timeline order. */
export function firstCommitElapsedMs(queueItems: ReplayReviewItem[]): number | null {
  return firstElapsedMs(queueItems, (item) => item.tone === 'commit');
}

/** First tool-call moment or keyframe in timeline order. */
export function firstToolCallElapsedMs(allItems: ReplayReviewItem[]): number | null {
  return firstElapsedMs(
    allItems,
    (item) =>
      item.keyframeKind === 'first-tool-call' ||
      (item.source === 'moment' && item.momentKind === 'tool.call'),
  );
}

/** Peak-burn keyframe — where cost/tokens spiked. */
export function firstPeakBurnElapsedMs(allItems: ReplayReviewItem[]): number | null {
  return firstElapsedMs(allItems, (item) => item.keyframeKind === 'peak-burn');
}

/** Session end when uncommitted files were captured at close. */
export function firstUncommittedSessionEndElapsedMs(
  allItems: ReplayReviewItem[],
  filesTouchedUncommitted: number,
): number | null {
  if (filesTouchedUncommitted <= 0) return null;
  return firstElapsedMs(allItems, (item) => item.keyframeKind === 'session-end');
}

/** First review jump target for a session row — highlight, then session start. */
export function firstSessionReviewElapsedMs(
  sessionId: string,
  items: ReplayReviewItem[],
): number | null {
  const sessionItems = items
    .filter((item) => item.sessionId === sessionId)
    .sort(byTimeline);
  const highlight = sessionItems.find((item) => item.stopKind === 'highlight' && item.elapsedMs > 0);
  if (highlight) return highlight.elapsedMs;
  const start = sessionItems.find((item) => item.keyframeKind === 'session-start');
  if (start) return start.elapsedMs;
  const first = sessionItems.find((item) => item.elapsedMs > 0);
  return first?.elapsedMs ?? null;
}

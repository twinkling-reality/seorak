import type { Keyframe, ReplayActivityBucket, ReplayMoment, ReplaySession } from '../../lib/apiSchemas.js';

/** Format ms elapsed as m:ss (playback clock). */
export function formatReplayClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function sessionDurationMs(replay: ReplaySession, nowMs = Date.now()): number {
  const start = Date.parse(replay.startedAt);
  const end = replay.endedAt ? Date.parse(replay.endedAt) : nowMs;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

export function playheadToMs(replay: ReplaySession, playheadFrac: number, nowMs = Date.now()): number {
  return Math.round(sessionDurationMs(replay, nowMs) * clamp01(playheadFrac));
}

export function msToPlayhead(replay: ReplaySession, ms: number, nowMs = Date.now()): number {
  const dur = sessionDurationMs(replay, nowMs);
  if (dur <= 0) return 0;
  return clamp01(ms / dur);
}

export function playheadIso(replay: ReplaySession, playheadFrac: number, nowMs = Date.now()): string {
  const start = Date.parse(replay.startedAt);
  const offset = playheadToMs(replay, playheadFrac, nowMs);
  return new Date(start + offset).toISOString();
}

/** One bucket's spend as a rate. The single definition of $/min in Replay. */
export function burnRateForBucket(bucket: ReplayActivityBucket): number | null {
  if (bucket.bucketMs <= 0) return null;
  return bucket.costUsd / (bucket.bucketMs / 60_000);
}

/** Burn rate ($/min) at the playhead bucket. Honest-zero when bucket is quiet. */
export function burnRateAtPlayhead(
  replay: ReplaySession,
  playheadFrac: number,
  nowMs = Date.now(),
): number {
  const bucket = bucketAtPlayhead(replay.activity, replay, playheadFrac, nowMs);
  if (!bucket) return 0;
  return burnRateForBucket(bucket) ?? 0;
}

/**
 * The bucket the playhead is actually INSIDE, or null.
 *
 * `bucketAtElapsedMs` clamps to the last bucket at or before the playhead,
 * which is right for a running total and wrong for an instantaneous rate: past
 * a session's end it would keep reporting that session's final burst as if it
 * were still burning. Buckets are contiguous inside a session (a quiet bucket
 * is a real zero), so "no containing bucket" means no session was running —
 * the same rule that breaks the stage's line across a gap.
 */
export function bucketContainingElapsedMs(
  replay: ReplaySession,
  elapsedMs: number,
  nowMs = Date.now(),
): ReplayActivityBucket | null {
  const bucket = bucketAtElapsedMs(replay, elapsedMs, nowMs);
  if (!bucket) return null;
  const startMs = Date.parse(replay.startedAt);
  const bucketStartMs = Date.parse(bucket.at);
  if (Number.isNaN(startMs) || Number.isNaN(bucketStartMs)) return null;
  const offsetMs = bucketStartMs - startMs;
  return elapsedMs >= offsetMs && elapsedMs < offsetMs + bucket.bucketMs ? bucket : null;
}

export function bucketAtPlayhead(
  activity: ReplayActivityBucket[],
  replay: ReplaySession,
  playheadFrac: number,
  nowMs: number,
): ReplayActivityBucket | null {
  if (activity.length === 0) return null;
  const startMs = Date.parse(replay.startedAt);
  const atMs = startMs + playheadToMs(replay, playheadFrac, nowMs);
  if (Number.isNaN(atMs)) return activity[0] ?? null;
  for (let i = activity.length - 1; i >= 0; i--) {
    const b = activity[i]!;
    const bStart = Date.parse(b.at);
    if (!Number.isNaN(bStart) && atMs >= bStart) return b;
  }
  return activity[0] ?? null;
}

export function bucketAtElapsedMs(
  replay: ReplaySession,
  elapsedMs: number,
  nowMs = Date.now(),
): ReplayActivityBucket | null {
  return bucketAtPlayhead(replay.activity, replay, msToPlayhead(replay, elapsedMs, nowMs), nowMs);
}

/** Activity buckets from session start through the playhead bucket (inclusive). */
export function bucketsThroughElapsedMs(
  replay: ReplaySession,
  elapsedMs: number,
  nowMs = Date.now(),
): ReplayActivityBucket[] {
  const current = bucketAtElapsedMs(replay, elapsedMs, nowMs);
  if (!current) return [];
  const currentStart = Date.parse(current.at);
  if (Number.isNaN(currentStart)) return [current];
  return replay.activity.filter((bucket) => {
    const bucketStart = Date.parse(bucket.at);
    return !Number.isNaN(bucketStart) && bucketStart <= currentStart;
  });
}

/** Moments within ±windowMs of the playhead instant. */
export function momentsInWindow(
  moments: ReplayMoment[],
  replay: ReplaySession,
  playheadFrac: number,
  windowMs: number,
  nowMs = Date.now(),
): ReplayMoment[] {
  const center = Date.parse(playheadIso(replay, playheadFrac, nowMs));
  if (Number.isNaN(center)) return [];
  return moments.filter((m) => {
    const t = Date.parse(m.at);
    if (Number.isNaN(t)) return false;
    return Math.abs(t - center) <= windowMs;
  });
}

/** Keyframes within ±windowMs of the playhead. */
export function keyframesInWindow(
  keyframes: Keyframe[],
  replay: ReplaySession,
  playheadFrac: number,
  windowMs: number,
  nowMs = Date.now(),
): Keyframe[] {
  const center = Date.parse(playheadIso(replay, playheadFrac, nowMs));
  if (Number.isNaN(center)) return [];
  return keyframes.filter((k) => {
    const t = Date.parse(k.at);
    if (Number.isNaN(t)) return false;
    return Math.abs(t - center) <= windowMs;
  });
}

export function chartPoints(activity: ReplayActivityBucket[]): { x: number; y: number }[] {
  if (activity.length === 0) return [];
  const max = Math.max(0.001, ...activity.map((b) => b.costUsd));
  return activity.map((b, i) => ({
    x: activity.length <= 1 ? 0.5 : i / (activity.length - 1),
    y: b.costUsd / max,
  }));
}

export function playheadFromChartX(xFrac: number): number {
  return clamp01(xFrac);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Default scrub window: half the bucket width, min 20s, max 90s. */
export function scrubWindowMs(activity: ReplayActivityBucket[]): number {
  const bucketMs = activity[0]?.bucketMs ?? 30_000;
  return Math.min(90_000, Math.max(20_000, Math.round(bucketMs * 1.5)));
}

/**
 * Playback speed for the span actually on screen — the focus window, not the
 * whole scope. The old 420x ceiling meant a 30-day scope would have taken 1.7
 * hours to play through; any window now plays in about 22 seconds, and short
 * windows stay slow enough to watch.
 */
export function reviewPlaybackRate(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  return Math.max(12, durationMs / 22_000);
}

export interface ReplayStopTarget {
  id: string;
  elapsedMs: number;
}

export function nextPlaybackStop(
  targets: ReplayStopTarget[],
  fromMs: number,
  toMs: number,
  ignoredMs: number | null = null,
): ReplayStopTarget | null {
  if (toMs <= fromMs || targets.length === 0) return null;
  const floor = fromMs + 75;
  const ceiling = toMs + 75;
  return (
    targets
      .filter((target) => {
        if (ignoredMs != null && Math.abs(target.elapsedMs - ignoredMs) < 1) return false;
        return target.elapsedMs > floor && target.elapsedMs <= ceiling;
      })
      .sort((a, b) => a.elapsedMs - b.elapsedMs)[0] ?? null
  );
}

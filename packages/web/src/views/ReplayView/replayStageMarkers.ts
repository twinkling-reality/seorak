import type { ReplaySession } from '../../lib/apiSchemas.js';
import { toneForKeyframe, toneForMoment } from './replayReviewModel.js';
import { elapsedFromOrigin, type ReplayTimeline } from './replayTimeline.js';
import type { SessionLane } from './replayTransforms.js';
import type { ReplayStageMarker } from './stage/ReplayStageChart.js';

/** Max neutral moment ticks per session on the stage rail (unused when neutrals are excluded). */
export const STAGE_MOMENT_CAP_PER_SESSION = 500;

/** Max alert/attention moment ticks per session on the shared stage rail. */
export const STAGE_ATTENTION_MOMENT_CAP_PER_SESSION = 48;

export function isStageAttentionTone(tone: ReplayStageMarker['tone']): boolean {
  return tone !== 'neutral';
}

function markerPriority(tone: ReplayStageMarker['tone']): number {
  if (tone === 'alert') return 0;
  if (tone === 'peak' || tone === 'commit') return 1;
  return 2;
}

/** Keep attention-worthy markers; evenly sample neutral moments when over cap. */
export function thinMomentMarkers(markers: ReplayStageMarker[], cap: number): ReplayStageMarker[] {
  if (markers.length <= cap) return markers;
  const ranked = [...markers].sort((a, b) => {
    const toneDelta = markerPriority(a.tone) - markerPriority(b.tone);
    if (toneDelta !== 0) return toneDelta;
    return a.elapsedMs - b.elapsedMs;
  });
  const kept = ranked.slice(0, cap);
  return kept.sort((a, b) => a.elapsedMs - b.elapsedMs);
}

export function buildStageMarkersForLane(
  lane: SessionLane & { replay: ReplaySession },
  timeline: ReplayTimeline,
  attentionCap = STAGE_ATTENTION_MOMENT_CAP_PER_SESSION,
): ReplayStageMarker[] {
  const keyframeMarkers = lane.replay.keyframes
    .map((keyframe, index): ReplayStageMarker | null => {
      const elapsedMs = elapsedFromOrigin(timeline, keyframe.at);
      if (elapsedMs == null) return null;
      return {
        id: `${lane.sessionId}-keyframe-${keyframe.seq}-${index}`,
        elapsedMs,
        kind: 'keyframe',
        tone: toneForKeyframe(keyframe.kind),
      };
    })
    .filter((marker): marker is ReplayStageMarker => marker != null);

  const attentionMoments = lane.replay.moments
    .map((moment, index): ReplayStageMarker | null => {
      const elapsedMs = elapsedFromOrigin(timeline, moment.at);
      if (elapsedMs == null) return null;
      const tone = toneForMoment(moment);
      if (!isStageAttentionTone(tone)) return null;
      return {
        id: `${lane.sessionId}-moment-${moment.seq}-${index}`,
        elapsedMs,
        kind: 'moment',
        tone,
      };
    })
    .filter((marker): marker is ReplayStageMarker => marker != null);

  return [...keyframeMarkers, ...thinMomentMarkers(attentionMoments, attentionCap)];
}

export function buildStageMarkers(
  lanes: Array<SessionLane & { replay: ReplaySession }>,
  timeline: ReplayTimeline,
  attentionCap = STAGE_ATTENTION_MOMENT_CAP_PER_SESSION,
): ReplayStageMarker[] {
  return lanes.flatMap((lane) => buildStageMarkersForLane(lane, timeline, attentionCap));
}

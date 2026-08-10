// Shared plumbing for lens compute. Pure; no React, no DOM.

import type { ReplayMoment, ReplaySession } from '../../../lib/apiSchemas.js';
import { elapsedFromOrigin, isInWindow } from '../replayTimeline.js';
import type { SessionLane } from '../replayTransforms.js';
import type {
  ReplayLensCoverage,
  ReplayLensInput,
  ReplayLensResult,
  ReplayLensRow,
  ReplayLensViz,
} from './types.js';

export type LoadedLane = SessionLane & { replay: ReplaySession };

/** One captured moment placed on the scope timeline. */
export interface PlacedMoment {
  lane: LoadedLane;
  moment: ReplayMoment;
  /** Scope-relative elapsed ms. */
  elapsedMs: number;
}

export function loadedLanes(lanes: SessionLane[]): LoadedLane[] {
  return lanes.filter((lane): lane is LoadedLane => Boolean(lane.replay));
}

/**
 * Every captured moment in the scope, placed on the timeline and sorted.
 * `windowed` narrows to the stage's focus window, so zooming into a burst
 * re-reads the lens for that burst.
 */
export function placedMoments(input: ReplayLensInput, windowed: boolean): PlacedMoment[] {
  const out: PlacedMoment[] = [];
  for (const lane of loadedLanes(input.lanes)) {
    for (const moment of lane.replay.moments) {
      const elapsedMs = elapsedFromOrigin(input.timeline, moment.at);
      if (elapsedMs == null) continue;
      if (windowed && !isInWindow(input.window, elapsedMs)) continue;
      out.push({ lane, moment, elapsedMs });
    }
  }
  return out.sort((a, b) => a.elapsedMs - b.elapsedMs);
}

export function coverageFor(
  input: ReplayLensInput,
  momentCount: number,
  windowed: boolean,
): ReplayLensCoverage {
  return {
    sessionCount: input.lanes.length,
    loadedCount: loadedLanes(input.lanes).length,
    windowed,
    momentCount,
  };
}

export function emptyResult(
  id: string,
  viz: ReplayLensViz,
  hint: string,
  coverage: ReplayLensCoverage,
): ReplayLensResult {
  return { id, viz, headline: null, rows: [], empty: hint, coverage };
}

/** Attach a 0..1 share of the row total. Zero total means no share at all. */
export function withShares(rows: ReplayLensRow[]): ReplayLensRow[] {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  if (total <= 0) return rows;
  return rows.map((row) => ({ ...row, share: Math.max(0, row.value) / total }));
}

export function plural(n: number, word: string, plural_ = `${word}s`): string {
  return n === 1 ? word : plural_;
}

export function countLabel(n: number, word: string, plural_?: string): string {
  return `${n.toLocaleString()} ${plural(n, word, plural_)}`;
}

/** Compact gap label — lens rows carry formatted strings, not raw ms. */
export function formatGap(ms: number): string {
  if (ms < 1_000) return '<1s';
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Title-case a captured enum value for display without inventing meaning. */
export function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// The lens registry: catalog id → pure compute function.
//
// This is the whole seam. A UI asks for a lens by id and renders the result; a
// future `GET /replay/lenses/:id` or MCP tool calls the same function and
// serializes the same object. Neither knows about the other.

import {
  computeCadence,
  computeInterruptions,
  computeRework,
  computeVerification,
} from './attentionLenses.js';
import { computePeriodCompare, computeSessionCompare } from './compareLenses.js';
import {
  REPLAY_LENSES,
  REPLAY_LENS_QUESTIONS,
  lensGroupsForLevel,
  lensesForLevel,
  replayLens,
} from './catalog.js';
import { computeProjects, computeSessionDetail, computeSessions } from './scopeLenses.js';
import {
  computeCostConcentration,
  computeFileTouch,
  computeToolMix,
} from './workLenses.js';
import type { ReplayLensCompute, ReplayLensInput, ReplayLensResult } from './types.js';

const COMPUTE: Record<string, ReplayLensCompute> = {
  'tool-mix': computeToolMix,
  'cost-concentration': computeCostConcentration,
  'file-touch': computeFileTouch,
  rework: computeRework,
  verification: computeVerification,
  interruptions: computeInterruptions,
  cadence: computeCadence,
  projects: computeProjects,
  sessions: computeSessions,
  'session-detail': computeSessionDetail,
  'session-compare': computeSessionCompare,
  'period-compare': computePeriodCompare,
};

/** Every catalog entry has a compute function. Guards the two lists apart drifting. */
export function lensIdsWithoutCompute(): string[] {
  return REPLAY_LENSES.filter((lens) => !COMPUTE[lens.id]).map((lens) => lens.id);
}

export function computeReplayLens(id: string, input: ReplayLensInput): ReplayLensResult | null {
  const compute = COMPUTE[id];
  if (!compute) return null;
  return compute(input);
}

export { REPLAY_LENSES, REPLAY_LENS_QUESTIONS, lensGroupsForLevel, lensesForLevel, replayLens };
export * from './types.js';

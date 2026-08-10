import type { ReplayLevel } from './types.js';

/** Replay's reading level, read off the two focus params. */
export function replayLevel(
  focusedProjectId: string | null,
  focusedSessionId: string | null,
): ReplayLevel {
  if (focusedSessionId) return 'session';
  if (focusedProjectId) return 'project';
  return 'period';
}

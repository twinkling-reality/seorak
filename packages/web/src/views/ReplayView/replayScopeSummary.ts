// What survives of the old Replay summary: the load caveat and the project
// phrasing. The prose compilers and the `ReplayScopeBody` component they fed
// are gone — Replay's Summary is now the annotated reveal Overview uses
// (`compileReplayClarity` → `PeriodClarityReveal`), so a second, flatter prose
// path would be a duplicate read that drifts out of agreement with it.
//
// The clickable summary stats went with it. Jumping to a moment now belongs to
// the lens rows and the inspector queue, which scrub directly; the Summary
// read explains what the numbers mean instead of doubling as navigation.

import type { ReplayScopeSummary } from './replayReviewModel.js';

/** Load-state caveat — only when something is wrong or incomplete. */
export function scopeLoadNote(scope: ReplayScopeSummary): string | null {
  if (scope.errorCount > 0) {
    return `${scope.errorCount.toLocaleString()} load error${scope.errorCount === 1 ? '' : 's'}`;
  }
  if (scope.loadingCount > 0) {
    return `${scope.loadedReplayCount.toLocaleString()} of ${scope.sessionCount.toLocaleString()} loaded`;
  }
  if (scope.emptyReplayCount > 0) {
    return `${scope.emptyReplayCount.toLocaleString()} empty`;
  }
  return null;
}

/** Spoken project scope: one name, two joined, three listed, then a count. */
export function formatProjectScope(labels: string[]): string {
  if (labels.length === 0) return 'this scope';
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  if (labels.length === 3) return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
  return `${labels.length} projects`;
}

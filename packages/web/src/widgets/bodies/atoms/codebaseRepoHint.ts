import type { CodebaseProjectSplit } from '../../../lib/apiSchemas.js';

/** Hover suffix for a heat row's repo scope (overview / multi-repo). */
export function codebaseRepoHint(projects: CodebaseProjectSplit[] | undefined): string {
  if (!projects || projects.length === 0) return '';
  if (projects.length === 1) {
    return ` in ${projects[0].project}`;
  }
  return ` across ${projects.map((p) => `${p.project} (${p.edits})`).join(', ')}`;
}

import type { OverviewSnapshot } from '../../../lib/apiSchemas.js';

/**
 * The edit-family tool set, shared by the Edits tab value and EditsPanel so the
 * strip and the panel always agree. Mirrors EDIT_TOOLS in
 * `widgets/bodies/UsageWidgets.tsx` (the overview `edits` widget) — same
 * definition of "an edit": an edit-family TOOL CALL from the hook stream, not
 * an individual line edit.
 */
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export interface EditCallRollup {
  /** Total edit-family tool calls in the window. */
  total: number;
  /** Per-tool rows (calls + distinct sessions), edit family only, by calls desc. */
  byTool: Array<{ tool: string; calls: number; sessions: number }>;
  /** All tool calls in the window — the share denominator. */
  allCalls: number;
}

/** Roll `tools.byTool` down to the edit family. `total` 0 + empty rows when the
 *  event log has no in-window tool calls — the caller renders honest-empty. */
export function editCallRollup(overview: OverviewSnapshot): EditCallRollup {
  const byTool = overview.tools.byTool.filter((t) => EDIT_TOOLS.has(t.tool));
  return {
    total: byTool.reduce((s, t) => s + t.calls, 0),
    byTool,
    allCalls: overview.tools.byTool.reduce((s, t) => s + t.calls, 0),
  };
}

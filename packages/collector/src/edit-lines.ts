/**
 * edit-lines.ts — on-machine line-delta derivation for edit-tool calls.
 *
 * CAPTURE-PRINCIPLE: derive on the machine, ship the derivation. The functions
 * here read edit-tool CONTENT (old/new strings, written file content) as local
 * inputs and return COUNTS only. Callers (adapters) discard the strings
 * immediately; nothing here is content by the time it reaches a CanonicalInput
 * or an event, and the emit.ts allowlist is the runtime backstop.
 *
 * Tool-agnostic on purpose (the multi-tool seam): any adapter whose payload
 * carries before/after strings (Claude Code Edit, Cursor edits, …) derives
 * through the same diff, so "lines added" means the same thing across tools.
 */

export interface EditLineCounts {
  added: number;
  removed: number;
}

/** Line count of a text blob. Empty string is 0 lines (an empty old_string is
 *  "nothing was replaced", not a 1-line removal). */
export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

/** Guard for the O(n·m) LCS table: beyond ~2000×2000 lines fall back to the
 *  full-replace count rather than burning CPU inside a hook script. */
const LCS_CELL_CAP = 4_000_000;

/**
 * Honest line delta of one old → new replacement: added/removed are the lines
 * NOT on the longest common subsequence, so unchanged lines inside the hunk
 * count as neither (a 1-line tweak in a 10-line old_string is 1/1, not 10/10).
 * Oversized inputs degrade to the full-replace count (added = all new lines,
 * removed = all old lines) — an upper bound, never an invented number.
 */
export function diffLineCounts(oldText: string, newText: string): EditLineCounts {
  const oldCount = lineCount(oldText);
  const newCount = lineCount(newText);
  if (oldCount === 0 || newCount === 0 || oldCount * newCount > LCS_CELL_CAP) {
    return { added: newCount, removed: oldCount };
  }
  const a = oldText.split("\n");
  const b = newText.split("\n");
  // Two-row LCS length DP.
  let prev = new Array<number>(b.length + 1).fill(0);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? (prev[j - 1] ?? 0) + 1
          : Math.max(prev[j] ?? 0, curr[j - 1] ?? 0);
    }
    [prev, curr] = [curr, prev];
  }
  const common = prev[b.length] ?? 0;
  return { added: newCount - common, removed: oldCount - common };
}

/**
 * Line delta of a unified diff body (Codex `patch_apply_end.changes[*].unified_diff`):
 * added = lines starting `+`, removed = lines starting `-`, with the `+++`/`---`
 * file headers excluded. The diff TEXT is a local input read to count and
 * discarded by the caller — same contract as diffLineCounts. Hunk context lines
 * count as neither, so the numbers mean the same thing as the LCS-derived Claude
 * counts: lines that actually changed.
 *
 * Accepted imprecision (reviewed, kept): a REMOVED body line whose own text
 * starts with `--` renders as `---…` and is excluded as if it were a header
 * (2 such lines exist across the 909 real diffs — markdown rules). Codex bodies
 * carry no actual header lines today, so the exclusion currently only
 * undercounts; it stays because the alternative — counting header lines as
 * changes if a future format adds them — errs in the fabricating direction.
 */
export function unifiedDiffLineCounts(diff: string): EditLineCounts {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

/** Sum counts; used for MultiEdit's per-edit hunks. */
export function sumEditLineCounts(parts: EditLineCounts[]): EditLineCounts {
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    added += p.added;
    removed += p.removed;
  }
  return { added, removed };
}

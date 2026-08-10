/**
 * format.ts — the terminal surface's SHARED formatting + honesty primitives,
 * extracted verbatim from the v0 `renderStats` so there is ONE source of the
 * honesty gates across every widget renderer:
 *
 *   - `pct` / `usd` print "--" for a null AGGREGATE, never a fabricated 0% / $0.00
 *   - live per-session cost/burn are NOT routed through `usd`'s gate ($0 is real)
 *   - `paint` emits ZERO escape bytes when color is off (non-TTY / NO_COLOR /
 *     --no-color), so the plain-text layout never carries stray ANSI
 *
 * Everything here is PURE (no TTY, no fetch, no clock read — `now` is passed in),
 * so each gate is unit-tested on literal inputs, same as the v0 stats oracle.
 */

/** ANSI wrap, or a no-op when color is off — the non-TTY / NO_COLOR / --no-color
 *  branch must emit zero escape bytes (tested). */
export function paint(color: boolean, code: string, s: string): string {
  return color ? `\x1b[${code}m${s}\x1b[0m` : s;
}

/** Cap any framed element so an ultra-wide terminal doesn't stretch the board /
 *  boxes absurdly. ONE source for the header box, the input box, and the board
 *  grid so the top frame, the board, and the bottom frame all line up. */
export const FRAME_MAX_WIDTH = 100;

/** The outer width of a framed box (header + input) for a given terminal width —
 *  clamped so both boxes are always the SAME width and share a left edge, which
 *  is what frames the screen symmetrically top and bottom. */
export function frameBoxWidth(width: number): number {
  return Math.max(24, Math.min(width, FRAME_MAX_WIDTH));
}

const ANSI = /\x1b\[[0-9;]*m/g;

/** Visible (printable) width of a string, ignoring ANSI escapes — so padding /
 *  alignment in the grid is correct whether or not color is on. */
export function visibleWidth(s: string): number {
  return s.replace(ANSI, "").length;
}

/** Right-pad to a visible width (ANSI-aware). Never truncates — widgets are
 *  expected to fit their cell; the grid pads short lines to align columns. */
export function padEndVisible(s: string, width: number): string {
  const gap = width - visibleWidth(s);
  return gap > 0 ? s + " ".repeat(gap) : s;
}

/** "updated N ago" vocabulary, mirroring the web's `formatRelativeTime` so both
 *  surfaces read identically. PURE — `now` is passed in, not read. */
export function formatAgo(fromIso: string | null, nowMs: number): string {
  if (!fromIso) return "just now";
  const t = Date.parse(fromIso);
  if (Number.isNaN(t)) return "just now";
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Greedy word-wrap to a max visible width. Single words longer than the width
 *  are left to overflow (labels are short enough that this is rare). */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    if (cur === "") cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

/**
 * list.ts — PURE. The board's LIST form (`/view list`), the alternative to the
 * paragraph for readers who would rather scan than read.
 *
 * NOT the old widget grid coming back. That was a 12-column responsive packer
 * rendering the web's catalog into cells, and its problem was never the shape,
 * it was that a cell has nowhere to put a caveat. These rows carry the caveat in
 * a `note` beside the number, and they are built from the SAME facts the
 * paragraph speaks (`windowRows` sits next to `windowSentences`), so switching
 * form can never switch what the board claims.
 *
 * The honesty rule is unchanged: a row with no measurement is never emitted, so
 * the list gets shorter on thin data rather than filling with "--".
 */
import { paint, padEndVisible, visibleWidth, wrapText } from "./format.ts";
import type { LiveRow, StatRow } from "../narrative.ts";

/** Meter track length in cells. */
const BAR_WIDTH = 10;
/** Horizontal eighth blocks for sub-cell fill. Block Elements ONLY: they fill a
 *  cell exactly in every monospace font, where geometric shapes do not. */
const PARTIALS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"] as const;
/** The bar's ink: the web `--accent` lavender anchor, the same cell the identity
 *  mark's ramp ends on. Green and amber stay out; here they mean running and
 *  needs-you. */
const BAR_INK = "38;5;146";

/**
 * bar — PURE. A rate's shape, over a dim track. Renders under NO_COLOR too (it
 * is data-shaped static text, not decoration); only the ink is color-gated.
 * Callers gate null upstream, so a real 0 draws an empty track and an unmeasured
 * rate never reaches here at all.
 */
export function bar(color: boolean, rate: number, width = BAR_WIDTH): string {
  const clamped = Math.max(0, Math.min(1, rate));
  const exact = clamped * width;
  const full = Math.floor(exact);
  const remainder = exact - full;
  const partialIndex = Math.floor(remainder * 8);
  const partial = full < width && partialIndex > 0 ? PARTIALS[partialIndex - 1]! : "";
  const filled = "█".repeat(full) + partial;
  const track = "░".repeat(Math.max(0, width - visibleWidth(filled)));
  return paint(color, BAR_INK, filled) + paint(color, "2", track);
}

/**
 * renderList — PURE. The whole board as rows: what is live, then the window.
 * `width` is the usable text width (the frame's indent is already removed).
 */
export function renderList(
  live: readonly LiveRow[],
  stats: readonly StatRow[],
  color: boolean,
  width: number,
  days: number,
): string[] {
  const dim = (s: string) => paint(color, "2", s);
  const out: string[] = [];

  out.push(dim("now"));
  if (live.length === 0) {
    out.push("  Nothing is running right now.");
  } else {
    const nameCol = Math.min(24, Math.max(...live.map((r) => r.project.length)) + 2);
    for (const row of live) {
      const marker = row.needsYou ? paint(color, "33", "▎") : " ";
      const name = row.needsYou ? paint(color, "33", row.project) : row.project;
      out.push(`${marker} ${padEndVisible(name, nameCol)}${dim(row.state)}`);
    }
  }

  if (stats.length === 0) return out;
  out.push("", dim(`last ${days} days`));

  // One label column across every row, so the values line up into a spine the
  // eye can run down. Capped so a long label cannot push the values off screen.
  const labelCol = Math.min(26, Math.max(...stats.map((r) => r.label.length)) + 2);
  const noteIndent = 2 + labelCol;
  for (const row of stats) {
    const value = row.rate === undefined ? row.value : `${padEndVisible(row.value, 5)}${bar(color, row.rate)}`;
    const head = `  ${dim(padEndVisible(row.label, labelCol))}${value}`;
    if (!row.note) {
      out.push(head);
      continue;
    }
    // A caveat rides its own row when it fits, and drops under the value when it
    // does not. Always breaking it out made every row two lines tall and turned
    // a list you scan into a list you read.
    const inline = `${head}   ${dim(row.note)}`;
    if (visibleWidth(inline) <= width) {
      out.push(inline);
      continue;
    }
    out.push(head);
    for (const line of wrapText(row.note, Math.max(16, width - noteIndent))) {
      out.push(`${" ".repeat(noteIndent)}${dim(line)}`);
    }
  }
  return out;
}

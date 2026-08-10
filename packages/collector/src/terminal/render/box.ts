/**
 * box.ts — PURE: the ONE rounded-box drawer shared by the header (frame.ts) and
 * the input box (prompt.ts), so the screen is framed by two visually-identical
 * boxes top and bottom (same corners, same border weight, same width). Callers
 * pass already-PAINTED left/right content; this only draws the border and pads
 * the middle by VISIBLE width (ANSI-aware) so the right border never drifts when
 * color is on.
 */
import { paint, visibleWidth } from "./format.ts";

/**
 * boxLines — a three-line rounded box (`╭─╮ / │ … │ / ╰─╯`) `inner` cells wide
 * between the bars. `left` sits at the start, `right` (optional) is flush to the
 * right border, and the gap between them is padded with spaces. When the two
 * would collide, `right` is dropped (the left content wins). Both inputs are
 * already painted; `color` only toggles whether the BORDER carries ANSI.
 * `borderCode` mirrors boxBlock's: dim chrome by default, the muted accent for
 * an identity moment (the working board's header, BOARD-CRAFT round 2).
 */
export function boxLines(
  left: string,
  right: string,
  color: boolean,
  inner: number,
  borderCode = "2",
): string[] {
  const border = (s: string) => paint(color, borderCode, s);
  const leftW = visibleWidth(left);
  const rightW = visibleWidth(right);
  const gap = Math.max(rightW > 0 ? 1 : 0, inner - leftW - rightW);
  // Re-derive the visible content width to size the trailing pad; if left alone
  // overflows the box (shouldn't, callers size to fit) clamp so we never go < 0.
  const used = Math.min(inner, leftW + gap + rightW);
  const content = `${left}${" ".repeat(gap)}${right}`;
  const tail = " ".repeat(Math.max(0, inner - used));
  return [
    border(`╭${"─".repeat(inner)}╮`),
    `${border("│")}${content}${tail}${border("│")}`,
    border(`╰${"─".repeat(inner)}╯`),
  ];
}

/**
 * boxBlock — the multi-row sibling of `boxLines`: the SAME rounded border around
 * N already-painted rows (identity block, future multi-line panels). Rows are
 * padded to `inner` by VISIBLE width; a row that would overflow is kept (callers
 * size to fit) but never breaks the right border on shorter rows.
 */
export function boxBlock(rows: string[], color: boolean, inner: number, borderCode = "2"): string[] {
  const border = (s: string) => paint(color, borderCode, s);
  const body = rows.map((row) => {
    const pad = " ".repeat(Math.max(0, inner - visibleWidth(row)));
    return `${border("│")}${row}${pad}${border("│")}`;
  });
  return [border(`╭${"─".repeat(inner)}╮`), ...body, border(`╰${"─".repeat(inner)}╯`)];
}

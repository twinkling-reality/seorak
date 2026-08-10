/**
 * prompt.ts — PURE: the bottom input REGION (a bordered box like Codex / Claude
 * Code) plus the REACTIVE suggestion palette that filters as you type. Kept pure
 * (buffer + layout + status in, lines + cursor position out) so the live
 * autocomplete is unit-tested without a TTY; the shell owns only the keystroke
 * loop and the cursor move.
 *
 * Reactivity model:
 *   - "/"          → list every command (name + summary)
 *   - "/ra"        → commands whose name/alias starts with the prefix
 *   - "/range …"   → 7 / 30 / 90
 *   - free text    → no palette; an "ask" hint (chat is v1-stubbed)
 */
import { frameBoxWidth, paint } from "./format.ts";
import { boxLines } from "./box.ts";
import { COMMAND_TABLE, commandUsage, findCommand, takesArg } from "../input/commands.ts";
import { ALLOWED_RANGE_DAYS, ALLOWED_VIEWS } from "../layout.ts";
import type { TerminalLayout } from "../types.ts";

/** Max suggestion rows shown at once (the palette never grows the footer without
 *  bound — a long stat list scrolls within this window, keeping the highlight
 *  visible, with a "+N more" tail). */
export const SUGGESTION_CAP = 8;

export interface Suggestion {
  /** The display text for the row (the aligned command usage, or a full
   *  "/range 30" arg line). */
  label: string;
  /** A dim trailing hint (a command summary, a stat category, …). */
  hint: string;
  /** The buffer text accepting this row produces (Tab, or Enter when `run` is
   *  false). For an arg-taking command name this is "/range " (expand, keep typing);
   *  for a complete command it is the runnable line. */
  apply: string;
  /** Whether ACCEPTING this row (Enter) runs it immediately. False for an
   *  arg-taking command name (you still owe it an arg), true for a complete line. */
  run: boolean;
}

/** Clamp a (possibly stale) selection index into a list's bounds. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, index), length - 1);
}

/**
 * suggestions — PURE. The reactive palette for the current buffer. Empty when the
 * buffer is not a slash-command in progress (the footer then shows status/hint).
 */
export function suggestions(buffer: string, layout: TerminalLayout): Suggestion[] {
  if (!buffer.startsWith("/")) return [];
  const rest = buffer.slice(1);
  const spaceIdx = rest.indexOf(" ");

  // Still typing the command NAME → filter the command table by prefix. A
  // no-arg command runs on accept; an arg-taking one expands to "/name ".
  if (spaceIdx === -1) {
    const prefix = rest.toLowerCase();
    return COMMAND_TABLE.filter(
      (c) => c.name.startsWith(prefix) || (c.aliases ?? []).some((a) => a.startsWith(prefix)),
    ).map((c) => ({
      label: commandUsage(c),
      hint: c.summary,
      apply: takesArg(c) ? `/${c.name} ` : `/${c.name}`,
      run: !takesArg(c),
    }));
  }

  // Command name complete → argument suggestions. Accepting one runs the command.
  const spec = findCommand(rest.slice(0, spaceIdx).toLowerCase());
  if (!spec) return [];
  const arg = rest.slice(spaceIdx + 1).trim().toLowerCase();

  if (spec.name === "view") {
    return ALLOWED_VIEWS.filter((v) => v.startsWith(arg)).map((v) => ({
      label: `/view ${v}`,
      hint: v === "list" ? "label and value rows" : v === "projects" ? "every project side by side" : "full sentences",
      apply: `/view ${v}`,
      run: true,
    }));
  }
  if (spec.name === "range") {
    return ALLOWED_RANGE_DAYS.filter((d) => String(d).startsWith(arg)).map((d) => ({
      label: `/range ${d}`,
      hint: `last ${d} days`,
      apply: `/range ${d}`,
      run: true,
    }));
  }
  return [];
}

/**
 * completeBuffer — PURE. Tab-completion target: the `apply` of the currently
 * HIGHLIGHTED suggestion (default top), or null when there's nothing to complete.
 * Tab fills the buffer WITHOUT running, so the user can keep editing.
 */
export function completeBuffer(buffer: string, layout: TerminalLayout, selected = 0): string | null {
  const sugg = suggestions(buffer, layout);
  if (sugg.length === 0) return null;
  return sugg[clampIndex(selected, sugg.length)]!.apply;
}

export interface EnterResolution {
  /** The line to submit/route now, or null to keep editing (no submit). */
  submit: string | null;
  /** The buffer the input holds AFTER Enter: cleared on submit, expanded to
   *  "/<name> " when accepting an arg-taking command name. */
  buffer: string;
}

/**
 * resolveOnEnter — PURE. Enter CHOOSES the highlighted palette row (arrow-key
 * selection, default top), like a normal autocomplete menu:
 *   - highlighted complete command ("/range 30", "/quit") → run it
 *   - highlighted arg-taking command name ("/range")      → expand to "/range " (keep typing)
 *   - no palette (free text / unknown / empty)            → submit the buffer verbatim
 * Selection (not a unique-prefix rule) disambiguates, so "/r" + ↓ + Enter can pick
 * range OR another matching command. The leading slash is still required for the palette to open, so
 * bare words stay free-text chat.
 */
export function resolveOnEnter(buffer: string, layout: TerminalLayout, selected = 0): EnterResolution {
  const sugg = suggestions(buffer, layout);
  if (sugg.length === 0) return { submit: buffer, buffer: "" };
  const choice = sugg[clampIndex(selected, sugg.length)]!;
  return choice.run ? { submit: choice.apply, buffer: "" } : { submit: null, buffer: choice.apply };
}

export interface Footer {
  /** The footer block, top to bottom (input box + palette/status below it). */
  lines: string[];
  /** Index within `lines` of the input line carrying the buffer (for the cursor). */
  inputLineOffset: number;
  /** 1-indexed terminal COLUMN the cursor should sit at (just after the buffer). */
  cursorCol: number;
}

/** Visible cells before the buffer inside the box: "│ › " = border, space, ›, space. */
const PROMPT_LEAD = 4;

/**
 * renderFooter — PURE. The bordered input box with the buffer, then either the
 * reactive palette (while typing a command) or the status/hint lines below it.
 * Returns the cursor target so the shell can place the caret inside the box.
 */
export function renderFooter(
  buffer: string,
  layout: TerminalLayout,
  statusLines: string[],
  color: boolean,
  width: number,
  selected = 0,
): Footer {
  const dim = (s: string) => paint(color, "2", s);
  const accent = (s: string) => paint(color, "36", s);

  const inner = frameBoxWidth(width) - 2; // cells between the two border bars
  const maxBuf = inner - PROMPT_LEAD + 1; // room for the buffer after " › "

  // Horizontal-scroll the buffer when it outgrows the box; keep the caret visible.
  const overflow = buffer.length > maxBuf;
  const shownBuf = overflow ? buffer.slice(buffer.length - maxBuf) : buffer;
  const cursorCol = overflow ? 1 + inner : PROMPT_LEAD + 1 + shownBuf.length;

  // The box, drawn by the SHARED box helper so it matches the header exactly.
  const content = ` ${accent("›")} ${shownBuf}`;
  const lines: string[] = boxLines(content, "", color, inner);
  const inputLineOffset = 1;

  // Below the box: the reactive palette while typing a command; otherwise the
  // last status/hint (or an "ask" affordance for free-text chat). The window
  // filter is NOT here — it lives top-right in the header.
  const palette = suggestions(buffer, layout);
  if (buffer.startsWith("/")) {
    if (palette.length === 0) {
      lines.push(`  ${dim("no matching command (try /help)")}`);
    } else {
      // Scroll a CAP-sized window so the highlighted row stays visible; only that
      // row reads as selected (a "▸" marker + accent), the rest are dim.
      const sel = clampIndex(selected, palette.length);
      const start =
        palette.length <= SUGGESTION_CAP
          ? 0
          : Math.min(Math.max(0, sel - SUGGESTION_CAP + 1), palette.length - SUGGESTION_CAP);
      const rows = palette.slice(start, start + SUGGESTION_CAP);
      const labelWidth = Math.min(28, Math.max(...rows.map((r) => r.label.length)) + 2);
      rows.forEach((r, i) => {
        const on = start + i === sel;
        const marker = on ? accent("▸ ") : "  ";
        const label = on ? accent(r.label.padEnd(labelWidth)) : dim(r.label.padEnd(labelWidth));
        lines.push(`${marker}${label}${dim(r.hint)}`);
      });
      const hiddenBelow = palette.length - (start + rows.length);
      if (hiddenBelow > 0) lines.push(`  ${dim(`+${hiddenBelow} more`)}`);
    }
  } else if (buffer.trim() !== "") {
    lines.push(`  ${dim("press enter to ask about your stats (chat, coming soon)")}`);
  } else {
    for (const l of statusLines) lines.push(`  ${dim(l)}`);
  }

  return { lines, inputLineOffset, cursorCol };
}

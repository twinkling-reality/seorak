/**
 * terminal-prompt.test.ts — the reactive command palette + the bordered input
 * box. PURE: buffer + layout in, suggestions / footer lines + cursor out. This is
 * the "type a command and see it filter live" behavior, asserted without a TTY.
 */
import { describe, expect, it } from "vitest";
import { COMMAND_TABLE } from "../src/terminal/input/commands.ts";
import {
  completeBuffer,
  renderFooter,
  resolveOnEnter,
  suggestions,
} from "../src/terminal/render/prompt.ts";
import type { TerminalLayout } from "../src/terminal/types.ts";

const layout: TerminalLayout = { rangeDays: 7, view: "paragraph" };

describe("suggestions — reactive command palette", () => {
  it("'/' lists every command", () => {
    expect(suggestions("/", layout)).toHaveLength(COMMAND_TABLE.length);
  });

  it("filters commands by typed prefix (name or alias)", () => {
    expect(suggestions("/ra", layout).map((s) => s.apply)).toEqual(["/range "]);
    expect(suggestions("/q", layout).map((s) => s.apply)).toEqual(["/quit"]);
  });

  it("offers NO stat-curation commands: prose has no slots to arrange", () => {
    const all = suggestions("/", layout).map((s) => s.apply);
    expect(all).not.toContain("/add ");
    expect(all).not.toContain("/remove ");
    expect(all).not.toContain("/layout");
  });

  it("'/view ' still suggests every view even though /view takes no arg", () => {
    expect(suggestions("/view ", layout).map((s) => s.label)).toEqual([
      "/view paragraph",
      "/view list",
      "/view projects",
    ]);
  });

  it("'/range ' suggests the allowed windows", () => {
    expect(suggestions("/range ", layout).map((s) => s.label)).toEqual([
      "/range 7",
      "/range 30",
      "/range 90",
    ]);
  });

  it("free text opens no palette", () => {
    expect(suggestions("why is cost high", layout)).toEqual([]);
    expect(suggestions("", layout)).toEqual([]);
  });
});

describe("completeBuffer — Tab accepts the highlighted suggestion (no run)", () => {
  it("completes a half-typed command name to the command + a space (arg-taking)", () => {
    expect(completeBuffer("/ra", layout)).toBe("/range ");
    // a no-arg command completes to the bare name (no trailing space)
    expect(completeBuffer("/q", layout)).toBe("/quit");
  });

  it("completes a partial arg to the highlighted window", () => {
    expect(completeBuffer("/range 3", layout)).toBe("/range 30");
    expect(completeBuffer("/range 9", layout)).toBe("/range 90");
  });

  it("returns null when there's nothing to complete", () => {
    expect(completeBuffer("free text", layout)).toBeNull();
    expect(completeBuffer("/range 14", layout)).toBeNull();
  });
});

describe("resolveOnEnter — Enter chooses the highlighted palette row", () => {
  it("expands an arg-taking command name to the name + a space (does NOT run)", () => {
    expect(resolveOnEnter("/ra", layout)).toEqual({ submit: null, buffer: "/range " });
    expect(resolveOnEnter("/range", layout)).toEqual({ submit: null, buffer: "/range " });
  });

  it("runs a no-arg command immediately", () => {
    expect(resolveOnEnter("/q", layout)).toEqual({ submit: "/quit", buffer: "" });
    expect(resolveOnEnter("/he", layout)).toEqual({ submit: "/help", buffer: "" });
  });

  it("picks the highlighted row when several match (no longer a no-op)", () => {
    // '/' highlights the first command (range) by default
    expect(resolveOnEnter("/", layout)).toEqual({ submit: null, buffer: "/range " });
    // arrow down to the second row → view, a no-arg toggle, so it RUNS
    expect(resolveOnEnter("/", layout, 1)).toEqual({ submit: "/view", buffer: "" });
  });

  it("runs a complete command (name + arg) on Enter", () => {
    expect(resolveOnEnter("/range 30", layout)).toEqual({ submit: "/range 30", buffer: "" });
  });

  it("submits free text verbatim, and an unknown command for the router to report", () => {
    expect(resolveOnEnter("why is cost high", layout)).toEqual({
      submit: "why is cost high",
      buffer: "",
    });
    expect(resolveOnEnter("/zzz", layout)).toEqual({ submit: "/zzz", buffer: "" });
  });
});

describe("renderFooter — bordered input box + cursor", () => {
  it("draws a box around the buffer and places the cursor just after it", () => {
    const f = renderFooter("/ad", layout, [], false, 80);
    expect(f.lines[0]).toMatch(/^╭─+╮$/);
    expect(f.lines[f.inputLineOffset]).toContain("› /ad");
    expect(f.lines[2]).toMatch(/^╰─+╯$/);
    // "│ › " = 4 cells before the buffer; caret sits after "/ad" (len 3) → col 8.
    expect(f.cursorCol).toBe(8);
  });

  it("shows the palette below the box while typing a command", () => {
    const f = renderFooter("/", layout, [], false, 80);
    const palette = f.lines.slice(3).join("\n");
    expect(palette).toContain("/range");
    expect(palette).toContain("/quit");
  });

  it("highlights exactly ONE palette row (the selected), not all of them", () => {
    const rows = (sel: number) => renderFooter("/", layout, [], false, 80, sel).lines.slice(3);
    const top = rows(0);
    const marked = top.filter((l) => l.startsWith("▸"));
    expect(marked).toHaveLength(1);
    expect(top[0]!.startsWith("▸")).toBe(true); // default highlight = first row
    // moving the selection moves the single marker
    const second = rows(1);
    expect(second[0]!.startsWith("▸")).toBe(false);
    expect(second[1]!.startsWith("▸")).toBe(true);
  });

  it("shows status lines (not a palette) when not typing a command", () => {
    const f = renderFooter("", layout, ["/help for commands, /quit to exit"], false, 80);
    expect(f.lines.slice(3).join("\n")).toContain("/help for commands");
  });

  it("emits zero ANSI escape bytes when color is off", () => {
    const f = renderFooter("/range 30", layout, [], false, 80);
    expect(f.lines.join("\n")).not.toContain("\x1b");
  });

  it("the header and input boxes are the SAME width (the frame is symmetric)", () => {
    const f = renderFooter("", layout, [], false, 80);
    // top + bottom borders equal width; matches the header box (frameBoxWidth)
    expect([...f.lines[0]!].length).toBe([...f.lines[2]!].length);
    expect([...f.lines[0]!].length).toBe(80);
  });
});

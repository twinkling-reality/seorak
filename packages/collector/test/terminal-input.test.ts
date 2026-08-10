/**
 * terminal-input.test.ts — the PURE input pipeline: `parseInput` (classify) +
 * `routeInput` (dispatch commands / chat). No TTY, no I/O — the shell applies the
 * returned CommandResult. Chat is a v1 stub (echo), asserted so the free-text path
 * is provably wired end-to-end without fabricating an answer.
 */
import { describe, expect, it } from "vitest";
import { parseInput } from "../src/terminal/input/parser.ts";
import { routeInput } from "../src/terminal/input/router.ts";
import type { TerminalLayout } from "../src/terminal/types.ts";

const layout: TerminalLayout = { rangeDays: 7, view: "paragraph" };

describe("parseInput", () => {
  it("classifies blank, command, and chat", () => {
    expect(parseInput("   ")).toEqual({ kind: "empty" });
    expect(parseInput("/range 30")).toEqual({ kind: "command", name: "range", args: ["30"] });
    expect(parseInput("/HELP")).toEqual({ kind: "command", name: "help", args: [] });
    expect(parseInput("why is my cost high?")).toEqual({ kind: "chat", text: "why is my cost high?" });
  });

  it("collapses extra whitespace in command args", () => {
    expect(parseInput("/range    30")).toEqual({ kind: "command", name: "range", args: ["30"] });
  });
});

describe("routeInput — commands", () => {
  it("/range sets an allowed window and rejects others", () => {
    expect(routeInput(parseInput("/range 30"), layout).layout?.rangeDays).toBe(30);
    const bad = routeInput(parseInput("/range 14"), layout);
    expect(bad.layout).toBeUndefined();
    expect(bad.message).toContain("must be one of");
  });

  it("/help returns multi-line output and no longer offers a board to curate", () => {
    const help = routeInput(parseInput("/help"), layout).lines!;
    expect(help[0]).toBe("commands:");
    expect(help.join("\n")).not.toContain("/add");
    expect(help.join("\n")).toContain("dashboard");
  });

  it("/quit requests exit; unknown command is reported", () => {
    expect(routeInput(parseInput("/quit"), layout).quit).toBe(true);
    expect(routeInput(parseInput("/exit"), layout).quit).toBe(true); // alias
    expect(routeInput(parseInput("/bogus"), layout).message).toContain("unknown command");
  });
});

describe("routeInput — chat stub", () => {
  it("echoes the parsed question (no fabricated answer) and is empty for blank", () => {
    expect(routeInput(parseInput("how much did I spend today?"), layout).message).toContain(
      'You asked: "how much did I spend today?"',
    );
    expect(routeInput(parseInput("   "), layout)).toEqual({});
  });
});

/**
 * edit-lines.test.ts — on-machine line-delta derivation (CAPTURE-PRINCIPLE:
 * derive on machine, ship the derivation).
 *
 * Two layers under test:
 *   1. The pure diff math in edit-lines.ts (LCS line counts, honest-empty
 *      semantics for empty strings, the oversized-input fallback).
 *   2. The claude-code adapter's deriveEditLines wiring: which tools derive,
 *      that failed calls derive NOTHING (the edit never applied), and that the
 *      counts ride CanonicalInput.editLines while the strings stay behind.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseClaudeCodeHook } from "../src/adapters/claude-code.ts";
import { resetCaptureSettingsCache } from "../src/capture-settings.ts";
import { diffLineCounts, lineCount } from "../src/edit-lines.ts";

describe("lineCount", () => {
  it("counts an empty string as 0 lines (nothing replaced, not a 1-line blob)", () => {
    expect(lineCount("")).toBe(0);
  });

  it("counts newline-separated lines", () => {
    expect(lineCount("a")).toBe(1);
    expect(lineCount("a\nb\nc")).toBe(3);
  });
});

describe("diffLineCounts", () => {
  it("counts only changed lines, not the whole hunk", () => {
    // One line tweaked inside a 4-line hunk: 1 added, 1 removed.
    const oldText = "a\nb\nc\nd";
    const newText = "a\nB\nc\nd";
    expect(diffLineCounts(oldText, newText)).toEqual({ added: 1, removed: 1 });
  });

  it("pure insertion / pure deletion", () => {
    expect(diffLineCounts("a\nc", "a\nb\nc")).toEqual({ added: 1, removed: 0 });
    expect(diffLineCounts("a\nb\nc", "a\nc")).toEqual({ added: 0, removed: 1 });
  });

  it("empty old (insertion-style edit) counts all new lines as added", () => {
    expect(diffLineCounts("", "x\ny")).toEqual({ added: 2, removed: 0 });
  });

  it("full replacement counts both sides", () => {
    expect(diffLineCounts("a\nb", "x\ny\nz")).toEqual({ added: 3, removed: 2 });
  });
});

describe("claude-code adapter editLines derivation", () => {
  // Isolate from THIS machine's cached capture settings: a fresh SEORAK_DIR holds no
  // capture.json, so captureSettings() resolves to DEFAULTS (fileLabels OFF) — the
  // default trust-boundary path this block asserts. Without this, a machine with the
  // fileLabels opt-in ON emits a basename dirLabel and the "carries NO strings" test
  // fails on the (intentionally) opted-in label rather than a real leak.
  let sandbox: string;
  let savedDir: string | undefined;
  beforeEach(() => {
    savedDir = process.env.SEORAK_DIR;
    sandbox = mkdtempSync(join(tmpdir(), "seorak-editlines-"));
    process.env.SEORAK_DIR = sandbox;
    resetCaptureSettingsCache();
  });
  afterEach(() => {
    if (savedDir === undefined) delete process.env.SEORAK_DIR;
    else process.env.SEORAK_DIR = savedDir;
    resetCaptureSettingsCache();
    rmSync(sandbox, { recursive: true, force: true });
  });

  const base = {
    session_id: "s1",
    cwd: "/tmp",
    transcript_path: "/nonexistent",
  };

  it("derives counts for a successful Edit and carries NO strings", () => {
    const canonical = parseClaudeCodeHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "/secret/path.ts", old_string: "a\nb\nc", new_string: "a\nB\nc\nd" },
    });
    expect(canonical.editLines).toEqual({ added: 2, removed: 1 });
    // The strings/paths must not ride the canonical input anywhere.
    expect(JSON.stringify(canonical)).not.toContain("secret");
    expect(JSON.stringify(canonical)).not.toContain("old_string");
  });

  it("sums MultiEdit hunks", () => {
    const canonical = parseClaudeCodeHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "MultiEdit",
      tool_input: {
        file_path: "/x.ts",
        edits: [
          { old_string: "a", new_string: "a\nb" },
          { old_string: "c\nd", new_string: "e" },
        ],
      },
    });
    expect(canonical.editLines).toEqual({ added: 2, removed: 2 });
  });

  it("Write counts content lines as added, removed 0 (replaced content unknowable)", () => {
    const canonical = parseClaudeCodeHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/x.ts", content: "l1\nl2\nl3" },
    });
    expect(canonical.editLines).toEqual({ added: 3, removed: 0 });
  });

  it("derives NOTHING for a failed call — the edit never applied", () => {
    const canonical = parseClaudeCodeHook({
      ...base,
      hook_event_name: "PostToolUseFailure",
      tool_name: "Edit",
      tool_input: { old_string: "a", new_string: "b" },
    });
    expect(canonical.editLines).toBeUndefined();
  });

  it("derives NOTHING for non-edit tools (absent, never {0,0})", () => {
    const canonical = parseClaudeCodeHook({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "rm -rf /" },
    });
    expect(canonical.editLines).toBeUndefined();
  });
});

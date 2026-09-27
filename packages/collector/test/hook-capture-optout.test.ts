/**
 * hook-capture-optout.test.ts: `SEORAK_CAPTURE=0`, the switch a program that
 * spawns coding agents sets so its OWN invocations are not recorded as the
 * developer's sessions.
 *
 * Why it has to exist at all: the hooks are installed once, globally, in
 * `~/.claude/settings.json`, so they fire for every `claude` process on the
 * machine. A daemon that shells out to `claude -p` for its own work makes real
 * agent invocations (they call tools, so every honest predicate counts them)
 * that are nobody's development session, and no field in the hook payload can
 * tell them apart: `source` is `"startup"` for both, `CLAUDE_CODE_ENTRYPOINT` is
 * inherited from the ancestor process, and the transcript is content this
 * collector does not read. The spawner is the only party that knows.
 *
 * Contracts under test:
 *
 *   - EVERY installed binding refuses, not just SessionStart. A per-event check
 *     would leave a session that never ends, or tool calls belonging to no
 *     session, and a half-captured session is worse than none. The table is
 *     driven off EVENT_BINS, so a seventh binding cannot be added without
 *     landing here;
 *   - the refusal is CLEAN and SILENT: exit 0, no stdout, no stderr. A hook that
 *     fails is a hook that disrupts the agent that ran it;
 *   - the refusal writes NOTHING. Asserted on the local store itself
 *     (`history.sqlite` row counts) and on `events.jsonl`, not on a return
 *     value, and on a fresh install the collector state directory is not so much
 *     as created;
 *   - unset, or any other value, captures normally. Off is spelled exactly `0`,
 *     the same spelling `SEORAK_CODEX` and `SEORAK_MOMENTUM` use.
 *
 * fs-sandboxed: SEORAK_DIR and SEORAK_CONTROL_DIR point at temp dirs, and
 * SEORAK_MOMENTUM=0 keeps the session-start hook out of `git`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hookCaptureEnabled } from "../src/hook-capture.ts";
import { EVENT_BINS, SEORAK_EVENTS } from "../src/install.ts";
import { localHistoryCounts } from "../src/local-store.ts";
import { localHistoryDatabasePath } from "../src/paths.ts";

const collectorRoot = new URL("..", import.meta.url);
const sandboxes: string[] = [];
const SESSION_ID = "capture-optout-probe";

/** One well-formed payload per installed binding. Keyed by the Claude Code event
 *  name so the coverage assertion below can compare it against EVENT_BINS. */
const PAYLOADS: Record<string, Record<string, unknown>> = {
  SessionStart: {
    hook_event_name: "SessionStart",
    session_id: SESSION_ID,
    cwd: "/tmp/seorak-capture-optout-non-repo",
    source: "startup",
  },
  PostToolUse: {
    hook_event_name: "PostToolUse",
    session_id: SESSION_ID,
    tool_name: "Bash",
  },
  PostToolUseFailure: {
    hook_event_name: "PostToolUseFailure",
    session_id: SESSION_ID,
    tool_name: "Bash",
  },
  SessionEnd: {
    hook_event_name: "SessionEnd",
    session_id: SESSION_ID,
    reason: "clear",
  },
  Notification: {
    hook_event_name: "Notification",
    session_id: SESSION_ID,
    notification_type: "permission_prompt",
  },
  UserPromptSubmit: {
    hook_event_name: "UserPromptSubmit",
    session_id: SESSION_ID,
    prompt: "content that is never read",
  },
};

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  sandboxes.push(path);
  return path;
}

/**
 * Run one installed hook executable exactly as Claude Code would, in a sandbox.
 * `capture` is the literal SEORAK_CAPTURE value, or undefined for "unset" (which
 * has to be deleted explicitly: the runner's own environment is inherited, and
 * a developer with the switch exported would otherwise silently pass this file).
 */
function runHook(
  event: string,
  options: { stateDir: string; controlDir: string; capture?: string },
): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SEORAK_DIR: options.stateDir,
    SEORAK_CONTROL_DIR: options.controlDir,
    SEORAK_MOMENTUM: "0",
  };
  if (options.capture === undefined) delete env.SEORAK_CAPTURE;
  else env.SEORAK_CAPTURE = options.capture;

  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      new URL(`./bin/${EVENT_BINS[event]!}`, collectorRoot).pathname,
    ],
    { input: JSON.stringify(PAYLOADS[event]), encoding: "utf8", env },
  );
}

function eventLines(stateDir: string): string[] {
  const path = join(stateDir, "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
}

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

describe("SEORAK_CAPTURE", () => {
  it("has a payload for every installed binding", () => {
    expect(Object.keys(PAYLOADS).sort()).toEqual([...SEORAK_EVENTS].sort());
    expect(SEORAK_EVENTS).toHaveLength(6);
  });

  it("is on unless it is exactly the string 0", () => {
    const saved = process.env.SEORAK_CAPTURE;
    try {
      delete process.env.SEORAK_CAPTURE;
      expect(hookCaptureEnabled()).toBe(true);
      for (const value of ["1", "true", "", "off", "false", "00", " 0", "0 "]) {
        process.env.SEORAK_CAPTURE = value;
        expect(hookCaptureEnabled(), `SEORAK_CAPTURE=${value}`).toBe(true);
      }
      process.env.SEORAK_CAPTURE = "0";
      expect(hookCaptureEnabled()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.SEORAK_CAPTURE;
      else process.env.SEORAK_CAPTURE = saved;
    }
  });

  it.each(SEORAK_EVENTS)(
    "%s records nothing, quietly, while SEORAK_CAPTURE=0",
    (event) => {
      // The state dir deliberately does NOT exist yet: a refused invocation must
      // not even create it, which is the strongest form of "wrote nothing".
      const root = temp("seorak-capture-off-");
      const stateDir = join(root, "state");
      const controlDir = join(root, "control");

      const result = runHook(event, { stateDir, controlDir, capture: "0" });

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(existsSync(stateDir)).toBe(false);
      expect(existsSync(localHistoryDatabasePath(stateDir))).toBe(false);
    },
  );

  it.each(SEORAK_EVENTS)(
    "%s captures normally when SEORAK_CAPTURE is unset",
    (event) => {
      const stateDir = temp("seorak-capture-unset-");
      const controlDir = temp("seorak-capture-unset-control-");

      const result = runHook(event, { stateDir, controlDir });

      expect(result.status).toBe(0);
      const events = eventLines(stateDir).map(
        (line) => JSON.parse(line) as { kind: string; sessionId: string },
      );
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.every((entry) => entry.sessionId === SESSION_ID)).toBe(true);
      expect(localHistoryCounts(stateDir).events).toBe(events.length);
    },
  );

  it.each(["1", "true", "", "off", "0 "])(
    "captures normally with SEORAK_CAPTURE=%j (off is exactly 0)",
    (value) => {
      const stateDir = temp("seorak-capture-other-");
      const controlDir = temp("seorak-capture-other-control-");

      const result = runHook("UserPromptSubmit", {
        stateDir,
        controlDir,
        capture: value,
      });

      expect(result.status).toBe(0);
      expect(eventLines(stateDir)).toHaveLength(1);
    },
  );

  it("leaves an already-populated local store untouched", () => {
    const stateDir = temp("seorak-capture-store-");
    const controlDir = temp("seorak-capture-store-control-");

    // Seed real history, so the assertion is "unchanged", not "empty".
    expect(
      runHook("UserPromptSubmit", { stateDir, controlDir }).status,
    ).toBe(0);
    const before = localHistoryCounts(stateDir);
    const linesBefore = eventLines(stateDir);
    expect(before.events).toBe(1);

    for (const event of SEORAK_EVENTS) {
      const result = runHook(event, { stateDir, controlDir, capture: "0" });
      expect(result.status, `${event} must exit 0`).toBe(0);
    }

    expect(localHistoryCounts(stateDir)).toEqual(before);
    expect(eventLines(stateDir)).toEqual(linesBefore);
  });

  it("gates every hook executable at the shared invocation lease", () => {
    // The refusal lives in acquireHookInvocationLease, the one call all six
    // bindings make BEFORE they parse anything. A binding that skipped it, or
    // reached the parser first, would capture what the spawner opted out of.
    for (const [event, bin] of Object.entries(EVENT_BINS)) {
      const source = readFileSync(
        new URL(`./bin/${bin}`, collectorRoot),
        "utf8",
      );
      expect(source, `${event} must take the lease`).toContain(
        "acquireHookInvocationLease",
      );
      expect(source.indexOf("acquireHookInvocationLease")).toBeLessThan(
        source.indexOf("parseClaudeCodeHook("),
      );
    }

    const gate = readFileSync(
      new URL("./src/hook-append.ts", collectorRoot),
      "utf8",
    );
    expect(gate).toMatch(/if\s*\(!hookCaptureEnabled\(\)\)\s*return null;/);
  });
});

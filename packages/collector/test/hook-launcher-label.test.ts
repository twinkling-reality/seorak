/**
 * hook-launcher-label.test.ts: `SEORAK_LAUNCHER`, the label a program that
 * launches coding agents on the developer's behalf sets so those sessions are
 * attributed rather than dropped (ADR 007).
 *
 * Contracts under test:
 *
 *   - a valid label is recorded beside the session, lowercased, and the session
 *     itself is captured exactly as it would be without one;
 *   - the label never enters an event: not the `session.start` payload in
 *     history, and not the events.jsonl queue a worker is sent;
 *   - an invalid label records no label and still captures the session, because
 *     an unlabeled session is honest-unknown and a rewritten label is invented;
 *   - `SEORAK_CAPTURE=0` still wins: nothing is recorded, label included;
 *   - the first label wins, so a resume under another program does not relabel.
 *
 * fs-sandboxed: SEORAK_DIR and SEORAK_CONTROL_DIR point at temp dirs, and
 * SEORAK_MOMENTUM=0 keeps the session-start hook out of `git`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hookLauncherLabel } from "../src/hook-capture.ts";
import { EVENT_BINS } from "../src/install.ts";
import { localHistoryCounts, openLocalHistory } from "../src/local-store.ts";

const collectorRoot = new URL("..", import.meta.url);
const sandboxes: string[] = [];
const SESSION_ID = "attribution-probe";

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  sandboxes.push(path);
  return path;
}

function runSessionStart(options: {
  stateDir: string;
  controlDir: string;
  launcher?: string;
  capture?: string;
  sessionId?: string;
}): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SEORAK_DIR: options.stateDir,
    SEORAK_CONTROL_DIR: options.controlDir,
    SEORAK_MOMENTUM: "0",
  };
  delete env.SEORAK_CAPTURE;
  delete env.SEORAK_LAUNCHER;
  if (options.capture !== undefined) env.SEORAK_CAPTURE = options.capture;
  if (options.launcher !== undefined) env.SEORAK_LAUNCHER = options.launcher;
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      new URL(`./bin/${EVENT_BINS.SessionStart!}`, collectorRoot).pathname,
    ],
    {
      input: JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: options.sessionId ?? SESSION_ID,
        cwd: "/tmp/seorak-attribution-non-repo",
        source: "startup",
      }),
      encoding: "utf8",
      env,
    },
  );
}

function launchers(stateDir: string): Array<{ session_id: string; launcher: string }> {
  const database = openLocalHistory(stateDir);
  try {
    return database
      .prepare("SELECT session_id, launcher FROM local_session_launcher ORDER BY session_id")
      .all() as Array<{ session_id: string; launcher: string }>;
  } finally {
    database.close();
  }
}

function storedPayloads(stateDir: string): string[] {
  const database = openLocalHistory(stateDir);
  try {
    return (
      database.prepare("SELECT payload_json FROM local_event").all() as Array<{
        payload_json: string;
      }>
    ).map((row) => row.payload_json);
  } finally {
    database.close();
  }
}

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

describe("SEORAK_LAUNCHER", () => {
  it("reads a label, lowercases it, and refuses anything it would have to rewrite", () => {
    const saved = process.env.SEORAK_LAUNCHER;
    try {
      delete process.env.SEORAK_LAUNCHER;
      expect(hookLauncherLabel()).toBeUndefined();
      for (const [raw, expected] of [
        ["my-orchestrator", "my-orchestrator"],
        ["Build.Bot_2", "build.bot_2"],
        ["a".repeat(64), "a".repeat(64)],
        ["", undefined],
        ["-leading-dash", undefined],
        ["has space", undefined],
        ["slash/path", undefined],
        ["a".repeat(65), undefined],
        ["émoji", undefined],
      ] as const) {
        process.env.SEORAK_LAUNCHER = raw;
        expect(hookLauncherLabel(), JSON.stringify(raw)).toBe(expected);
      }
    } finally {
      if (saved === undefined) delete process.env.SEORAK_LAUNCHER;
      else process.env.SEORAK_LAUNCHER = saved;
    }
  });

  it("records the label beside the session and never on an event", () => {
    const stateDir = temp("seorak-launcher-");
    const controlDir = temp("seorak-launcher-control-");

    const result = runSessionStart({ stateDir, controlDir, launcher: "Agent-Host" });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(launchers(stateDir)).toEqual([
      { session_id: SESSION_ID, launcher: "agent-host" },
    ]);
    expect(localHistoryCounts(stateDir).events).toBeGreaterThanOrEqual(1);
    for (const payload of storedPayloads(stateDir)) {
      expect(payload).not.toContain("agent-host");
      expect(payload).not.toContain("launcher");
    }
    const queue = readFileSync(join(stateDir, "events.jsonl"), "utf8");
    expect(queue).not.toContain("agent-host");
    expect(queue).not.toContain("launcher");
  });

  it("captures the session unlabeled when the label is invalid or unset", () => {
    for (const launcher of [undefined, "", "not valid!"]) {
      const stateDir = temp("seorak-launcher-invalid-");
      const controlDir = temp("seorak-launcher-invalid-control-");

      const result = runSessionStart({
        stateDir,
        controlDir,
        ...(launcher === undefined ? {} : { launcher }),
      });

      expect(result.status, JSON.stringify(launcher)).toBe(0);
      expect(localHistoryCounts(stateDir).events).toBeGreaterThanOrEqual(1);
      expect(launchers(stateDir)).toEqual([]);
    }
  });

  it("records nothing at all while SEORAK_CAPTURE=0, label included", () => {
    const root = temp("seorak-launcher-off-");
    const stateDir = join(root, "state");
    const controlDir = join(root, "control");

    const result = runSessionStart({
      stateDir,
      controlDir,
      capture: "0",
      launcher: "agent-host",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(existsSync(stateDir)).toBe(false);
  });

  it("keeps the first label when the same session starts again elsewhere", () => {
    const stateDir = temp("seorak-launcher-first-");
    const controlDir = temp("seorak-launcher-first-control-");

    expect(runSessionStart({ stateDir, controlDir, launcher: "first-host" }).status).toBe(0);
    expect(runSessionStart({ stateDir, controlDir, launcher: "second-host" }).status).toBe(0);
    expect(runSessionStart({ stateDir, controlDir }).status).toBe(0);

    expect(launchers(stateDir)).toEqual([
      { session_id: SESSION_ID, launcher: "first-host" },
    ]);
  });
});

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCaptureFailure } from "../src/capture-failure.ts";
import {
  activateCollectorState,
  beginCollectorPurge,
  claimCollectorState,
  resolveCollectorLifecyclePaths,
} from "../src/collector-lifecycle.ts";
import { withEventLogLock } from "../src/event-log.ts";
import { resolveEventLogPathContext } from "../src/paths.ts";

const collectorRoot = new URL("..", import.meta.url);
const sandboxes: string[] = [];

function hookControlDir(sandbox: string): string {
  const control = `${sandbox}-control`;
  if (!sandboxes.includes(control)) sandboxes.push(control);
  return control;
}

function runHook(bin: string, input: string | object): string {
  const sandbox = mkdtempSync(join(tmpdir(), "seorak-hook-dispatch-"));
  sandboxes.push(sandbox);
  const control = hookControlDir(sandbox);
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      new URL(`./bin/${bin}`, collectorRoot).pathname,
    ],
    {
      input: typeof input === "string" ? input : JSON.stringify(input),
      env: {
        ...process.env,
        SEORAK_DIR: sandbox,
        SEORAK_CONTROL_DIR: control,
        SEORAK_MOMENTUM: "0",
      },
    },
  );
  return sandbox;
}

function executeHook(
  sandbox: string,
  bin: string,
  input: string | object,
  extraEnv: NodeJS.ProcessEnv = {},
): void {
  const control = extraEnv.SEORAK_CONTROL_DIR ?? hookControlDir(sandbox);
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      new URL(`./bin/${bin}`, collectorRoot).pathname,
    ],
    {
      input: typeof input === "string" ? input : JSON.stringify(input),
      env: {
        ...process.env,
        SEORAK_DIR: sandbox,
        SEORAK_CONTROL_DIR: control,
        SEORAK_MOMENTUM: "0",
        ...extraEnv,
      },
    },
  );
}

function executeHookAsync(
  sandbox: string,
  bin: string,
  input: string | object,
): Promise<void> {
  const control = hookControlDir(sandbox);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        new URL(`./bin/${bin}`, collectorRoot).pathname,
      ],
      {
        env: {
          ...process.env,
          SEORAK_DIR: sandbox,
          SEORAK_CONTROL_DIR: control,
          SEORAK_MOMENTUM: "0",
        },
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`hook exited ${String(code)}: ${stderr}`));
    });
    child.stdin.end(
      typeof input === "string" ? input : JSON.stringify(input),
    );
  });
}

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

describe("installed hook dispatch", () => {
  it("emits a valid Claude SessionStart under Claude authority", () => {
    const sandbox = runHook("hook-session-start.mjs", {
      hook_event_name: "SessionStart",
      session_id: "session-1",
      cwd: "/tmp/seorak-hook-non-repo",
      source: "startup",
    });
    const events = readFileSync(join(sandbox, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "session.start",
      sessionId: "session-1",
      agent: "claude-code",
    });
  });

  it.each([
    ["hook-session-start.mjs", "{"],
    [
      "hook-session-start.mjs",
      {
        hook_event_name: "PostToolUse",
        session_id: "session-1",
        tool_name: "Bash",
      },
    ],
    ["hook-session-start.mjs", { hook_event_name: "SessionStart" }],
    ["hook-session-end.mjs", { hook_event_name: "SessionEnd" }],
    [
      "hook-session-end.mjs",
      { hook_event_name: "SessionStart", session_id: "session-1" },
    ],
    [
      "hook-tool-use.mjs",
      {
        hook_event_name: "FutureHook",
        session_id: "session-1",
        tool_name: "Bash",
      },
    ],
  ])("%s drops malformed or mismatched input", (bin, input) => {
    const sandbox = runHook(bin, input);
    expect(existsSync(join(sandbox, "events.jsonl"))).toBe(false);
  });

  it(
    "contains lock contention without hiding the content-free capture gap",
    async () => {
      const sandbox = mkdtempSync(join(tmpdir(), "seorak-hook-contention-"));
      sandboxes.push(sandbox);
      const paths = resolveEventLogPathContext(sandbox);

      await withEventLogLock(paths, async () => {
        executeHook(sandbox, "hook-user-prompt.mjs", {
          hook_event_name: "UserPromptSubmit",
          session_id: "session-private",
          prompt: "must never reach failure evidence",
        });
      });

      expect(existsSync(paths.events)).toBe(false);
      const failure = readCaptureFailure(paths);
      expect(failure.kind).toBe("current");
      if (failure.kind !== "current") return;
      expect(failure.snapshot).toEqual({
        schemaVersion: 1,
        reason: "event-log-lock-timeout",
        recordedAt: expect.any(String),
      });
      expect(readFileSync(paths.captureFailure, "utf8")).not.toContain(
        "session-private",
      );
      expect(readFileSync(paths.captureFailure, "utf8")).not.toContain(
        "must never",
      );
    },
  );

  it(
    "serializes real concurrent hook processes without torn records",
    async () => {
      const sandbox = mkdtempSync(join(tmpdir(), "seorak-hook-processes-"));
      sandboxes.push(sandbox);
      const paths = resolveEventLogPathContext(sandbox);
      const count = 16;

      const results = await Promise.allSettled(
        Array.from({ length: count }, (_, index) =>
          executeHookAsync(sandbox, "hook-user-prompt.mjs", {
            hook_event_name: "UserPromptSubmit",
            session_id: `session-${index}`,
          }),
        ),
      );
      expect(results).toEqual(
        Array.from({ length: count }, () => ({
          status: "fulfilled",
          value: undefined,
        })),
      );

      const events = readFileSync(paths.events, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { sessionId: string });
      expect(events).toHaveLength(count);
      expect(new Set(events.map((event) => event.sessionId)).size).toBe(count);
      expect(readCaptureFailure(paths)).toEqual({ kind: "missing" });
    },
  );

  it("keeps non-timeout filesystem failures explicit", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "seorak-hook-fs-failure-"));
    sandboxes.push(sandbox);
    const notDirectory = join(sandbox, "state-file");
    writeFileSync(notDirectory, "not a directory", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        new URL("./bin/hook-user-prompt.mjs", collectorRoot).pathname,
      ],
      {
        input: JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "session-1",
        }),
        env: {
          ...process.env,
          SEORAK_DIR: notDirectory,
          SEORAK_MOMENTUM: "0",
        },
      },
    );

    expect(result.status).not.toBe(0);
  });

  it("makes a stale installed hook a no-op after local capture is revoked", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "seorak-hook-purged-"));
    const control = mkdtempSync(join(tmpdir(), "seorak-hook-control-"));
    sandboxes.push(sandbox, control);
    const lifecycle = resolveCollectorLifecyclePaths(sandbox, {
      controlDir: control,
    });
    claimCollectorState(lifecycle, { controlDir: control });
    activateCollectorState(lifecycle);
    beginCollectorPurge(lifecycle);

    executeHook(
      sandbox,
      "hook-user-prompt.mjs",
      {
        hook_event_name: "UserPromptSubmit",
        session_id: "session-after-purge",
      },
      { SEORAK_CONTROL_DIR: control },
    );

    expect(existsSync(join(sandbox, "events.jsonl"))).toBe(false);
  });

  it("exits SessionStart before derivation can recreate any purged state", () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), "seorak-hook-purged-start-"));
    sandboxes.push(sandboxRoot);
    const state = join(sandboxRoot, "state");
    const control = join(sandboxRoot, "control");
    const lifecycle = resolveCollectorLifecyclePaths(state, {
      controlDir: control,
    });
    beginCollectorPurge(lifecycle);
    expect(existsSync(state)).toBe(false);

    executeHook(
      state,
      "hook-session-start.mjs",
      {
        hook_event_name: "SessionStart",
        session_id: "session-after-purge",
        cwd: process.cwd(),
        source: "startup",
      },
      { SEORAK_CONTROL_DIR: control },
    );

    expect(existsSync(state)).toBe(false);
  });
});

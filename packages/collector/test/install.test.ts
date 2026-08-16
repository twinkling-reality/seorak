/**
 * install.test.ts — the shared hook-merge module behind both
 * scripts/install-hooks.mjs and `seorak init`. Covers the PURE merge/strip logic
 * (no disk) AND the installHooks/removeHooks fs path against a sandboxed
 * settings file (SEORAK_DIR/tmp), proving: merge-not-clobber, idempotency,
 * backup-on-overwrite, the 4 separate bindings, and a clean uninstall.
 *
 * fs-sandboxed: each test writes settings into a fresh temp dir; binDir points at
 * the real collector bin/ so the script-existence guard passes.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EVENT_BINS,
  commandFor,
  defaultBinDir,
  hasSeorakHook,
  installHooks,
  mergeHooks,
  presentEvents,
  removeHooks,
  seorakCommandPath,
  stripHooks,
} from "../src/install.ts";

const REAL_BIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "bin");

let dir: string;
let settingsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seorak-install-"));
  settingsPath = join(dir, "settings.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("mergeHooks (pure)", () => {
  it("adds all six bindings to an empty settings object", () => {
    const { settings, added, skipped } = mergeHooks({}, "/bin");
    expect(added.sort()).toEqual(["Notification", "PostToolUse", "PostToolUseFailure", "SessionEnd", "SessionStart", "UserPromptSubmit"]);
    expect(skipped).toEqual([]);
    // PostToolUse and PostToolUseFailure are SEPARATE events — both bound.
    const hooks = settings.hooks as Record<string, unknown>;
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.PostToolUseFailure).toBeDefined();
  });

  it("preserves existing non-Seorak hooks (merge, not clobber)", () => {
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo mine" }] }],
        PreToolUse: [{ hooks: [{ type: "command", command: "echo other" }] }],
      },
    };
    const { settings } = mergeHooks(existing, "/bin");
    const hooks = settings.hooks as Record<string, any[]>;
    // The user's own SessionStart hook survives, Seorak's is appended alongside.
    expect(hooks.SessionStart).toHaveLength(2);
    expect(hooks.SessionStart[0].hooks[0].command).toBe("echo mine");
    expect(hooks.SessionStart[1].hooks[0].command).toContain("hook-session-start.mjs");
    // An unrelated event the user configured is untouched.
    expect(hooks.PreToolUse).toHaveLength(1);
    // The original object is NOT mutated.
    expect((existing.hooks.SessionStart as any[]).length).toBe(1);
  });

  it("is idempotent — a second merge skips all six and adds nothing", () => {
    const once = mergeHooks({}, "/bin");
    const twice = mergeHooks(once.settings, "/bin");
    expect(twice.added).toEqual([]);
    expect(twice.skipped.sort()).toEqual(["Notification", "PostToolUse", "PostToolUseFailure", "SessionEnd", "SessionStart", "UserPromptSubmit"]);
    // No duplicate groups introduced.
    const hooks = twice.settings.hooks as Record<string, any[]>;
    expect(hooks.SessionStart).toHaveLength(1);
  });

  it("re-points a Seorak hook bound to another dir rather than duplicating it", () => {
    // Recognised by bin FILENAME, so a relocated install is never bound twice —
    // but it is RE-POINTED, not left behind. Skipping it was safe only while the
    // bin dir was version-stable; with ~/.seorak/runtime/<version>/ it left the
    // hooks on the previous build while the LaunchAgent moved to the new one.
    const existing = {
      hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "node /old/path/hook-session-end.mjs" }] }] },
    };
    const { added, repaired, settings } = mergeHooks(existing, "/new/path");
    expect(repaired).toContain("SessionEnd");
    expect(added).not.toContain("SessionEnd");
    const groups = (settings.hooks as Record<string, unknown[]>).SessionEnd!;
    expect(groups).toHaveLength(1);
    expect(JSON.stringify(groups)).toContain("/new/path/hook-session-end.mjs");
    expect(JSON.stringify(groups)).not.toContain("/old/path");
  });
});

describe("hook command contract", () => {
  it("executes a hook whose absolute path contains shell metacharacters", () => {
    const binFile = EVENT_BINS.SessionStart!;
    const binDir = join(dir, "hooks with spaces ' $ ; (safe)");
    const scriptPath = join(binDir, binFile);
    const outputPath = join(dir, "hook-ran");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      scriptPath,
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.env.SEORAK_TEST_OUTPUT, 'ran');\n",
      "utf8",
    );

    const command = commandFor(binFile, binDir, "darwin");
    expect(seorakCommandPath(command, binFile)).toBe(scriptPath);
    execFileSync("/bin/sh", ["-c", command], {
      env: { ...process.env, SEORAK_TEST_OUTPUT: outputPath },
    });
    expect(readFileSync(outputPath, "utf8")).toBe("ran");
  });

  it("keeps a Windows hook path out of shell syntax", () => {
    const binFile = EVENT_BINS.SessionStart!;
    const binDir = join(dir, "hooks with %PATH% & spaces");
    const command = commandFor(binFile, binDir, "win32");
    expect(command).not.toContain(binDir);
    expect(seorakCommandPath(command, binFile)).toBe(join(binDir, binFile));
  });

  it("does not treat a command that merely mentions a bin filename as ours", () => {
    const settings = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "printf 'hook-session-start.mjs'",
              },
            ],
          },
        ],
      },
    };
    expect(
      hasSeorakHook(settings, "SessionStart", EVENT_BINS.SessionStart!),
    ).toBe(false);
  });
});

describe("stripHooks (pure)", () => {
  it("removes only the Seorak groups, keeping user hooks", () => {
    const merged = mergeHooks(
      { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo mine" }] }] } },
      "/bin",
    ).settings;
    const { settings, removed } = stripHooks(merged);
    expect(removed.sort()).toEqual(["Notification", "PostToolUse", "PostToolUseFailure", "SessionEnd", "SessionStart", "UserPromptSubmit"]);
    const hooks = settings.hooks as Record<string, any[]>;
    // The user's own SessionStart hook remains; the empty events are dropped.
    expect(hooks.SessionStart).toHaveLength(1);
    expect(hooks.SessionStart[0].hooks[0].command).toBe("echo mine");
    expect(hooks.PostToolUse).toBeUndefined();
    expect(hooks.SessionEnd).toBeUndefined();
  });

  it("drops the hooks key entirely when nothing is left", () => {
    const merged = mergeHooks({}, "/bin").settings;
    const { settings, removed } = stripHooks(merged);
    expect(removed).toHaveLength(6);
    expect(settings.hooks).toBeUndefined();
  });

  it("is a no-op on settings with no Seorak hooks", () => {
    const { settings, removed } = stripHooks({ hooks: { PreToolUse: [{ hooks: [{ command: "x" }] }] } });
    expect(removed).toEqual([]);
    expect((settings.hooks as any).PreToolUse).toHaveLength(1);
  });
});

describe("presentEvents (pure)", () => {
  it("reports 6/6 present after a merge", () => {
    const merged = mergeHooks({}, "/bin").settings;
    const { present, missing } = presentEvents(merged);
    expect(present).toHaveLength(6);
    expect(missing).toEqual([]);
  });

  it("names the missing event on a 5/6 file", () => {
    const merged = mergeHooks({}, "/bin").settings;
    // Drop one event (the often-forgotten PostToolUseFailure) from a full merge.
    const partial = { ...merged, hooks: { ...(merged.hooks as Record<string, unknown>) } };
    delete (partial.hooks as Record<string, unknown>).PostToolUseFailure;
    const { present, missing } = presentEvents(partial);
    expect(present).toHaveLength(5);
    expect(missing).toEqual(["PostToolUseFailure"]);
  });
});

describe("installHooks / removeHooks (fs)", () => {
  it("writes all six hooks to a fresh file with no backup", () => {
    const result = installHooks({ settingsPath, binDir: REAL_BIN_DIR });
    expect(result.added).toHaveLength(6);
    expect(result.backedUp).toBe(false);
    expect(existsSync(settingsPath)).toBe(true);
    expect(existsSync(`${settingsPath}.bak`)).toBe(false);
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(Object.keys(written.hooks).sort()).toEqual([
      "Notification",
      "PostToolUse",
      "PostToolUseFailure",
      "SessionEnd",
      "SessionStart",
      "UserPromptSubmit",
    ]);
  });

  it("backs up and merges into an existing file (preserving user hooks)", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: "echo keep" }] }] }, other: 1 }),
      "utf8",
    );
    const result = installHooks({ settingsPath, binDir: REAL_BIN_DIR });
    expect(result.backedUp).toBe(true);
    expect(existsSync(`${settingsPath}.bak`)).toBe(true);
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(written.other).toBe(1);
    expect(written.hooks.SessionStart).toHaveLength(2); // user's + Seorak's
  });

  it("is idempotent on disk — a second install does not rewrite (no .bak churn)", () => {
    installHooks({ settingsPath, binDir: REAL_BIN_DIR });
    rmSync(`${settingsPath}.bak`, { force: true });
    const second = installHooks({ settingsPath, binDir: REAL_BIN_DIR });
    expect(second.added).toEqual([]);
    expect(second.backedUp).toBe(false);
    expect(existsSync(`${settingsPath}.bak`)).toBe(false);
  });

  it("throws on a missing hook script (partial checkout)", () => {
    expect(() => installHooks({ settingsPath, binDir: join(dir, "nope") })).toThrow(/missing hook script/);
  });

  it("removeHooks strips the Seorak bindings and reports them", () => {
    installHooks({ settingsPath, binDir: REAL_BIN_DIR });
    const removed = removeHooks({ settingsPath });
    expect(removed.removed).toHaveLength(6);
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(written.hooks).toBeUndefined();
  });

  it("removeHooks on a no-Seorak file is a no-op", () => {
    writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: "x" }] }] } }), "utf8");
    const removed = removeHooks({ settingsPath });
    expect(removed.removed).toEqual([]);
    expect(removed.backedUp).toBe(false);
  });
});

describe("EVENT_BINS contract", () => {
  it("binds PostToolUse and PostToolUseFailure to the SAME tool-use script", () => {
    expect(EVENT_BINS.PostToolUse).toBe("hook-tool-use.mjs");
    expect(EVENT_BINS.PostToolUseFailure).toBe("hook-tool-use.mjs");
  });

  it("defaultBinDir resolves to the collector bin/", () => {
    expect(defaultBinDir()).toBe(REAL_BIN_DIR);
  });
});

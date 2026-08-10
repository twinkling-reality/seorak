/**
 * install-repair.test.ts — the moved-checkout self-heal: seorakHookPaths (the
 * status check's stale-binding detector) and mergeHooks' scriptExists repair leg. The
 * footgun: hook bindings match by bin FILENAME, so after a repo move the stale
 * absolute path reads as "already installed" forever while Claude Code fires
 * hooks into ENOENT. With scriptExists injected, a fully-stale binding is
 * replaced and reported as `repaired`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EVENT_BINS,
  SEORAK_EVENTS,
  installHooks,
  mergeHooks,
  seorakCommandPath,
  seorakHookPaths,
} from "../src/install.ts";

const REAL_BIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "bin");
const OLD_DIR = "/moved/away/checkout/packages/collector/bin";

/** A settings object with every Seorak event bound against `binDir`. */
function boundSettings(binDir: string): Record<string, unknown> {
  return mergeHooks({}, binDir).settings;
}

describe("seorakCommandPath", () => {
  it("extracts the script path token from the runner command", () => {
    expect(seorakCommandPath(`node ${OLD_DIR}/hook-tool-use.mjs`, "hook-tool-use.mjs")).toBe(
      `${OLD_DIR}/hook-tool-use.mjs`,
    );
  });
  it("returns null when the command does not carry the bin file", () => {
    expect(seorakCommandPath("node /elsewhere/other.mjs", "hook-tool-use.mjs")).toBeNull();
  });
});

describe("seorakHookPaths", () => {
  it("lists one path per Seorak binding, keyed by event", () => {
    const paths = seorakHookPaths(boundSettings(OLD_DIR));
    expect(paths).toHaveLength(SEORAK_EVENTS.length);
    for (const { event, path } of paths) {
      expect(path).toBe(join(OLD_DIR, EVENT_BINS[event]!));
    }
  });
  it("ignores non-Seorak hooks and empty settings", () => {
    expect(seorakHookPaths({})).toEqual([]);
    expect(
      seorakHookPaths({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] } }),
    ).toEqual([]);
  });
});

describe("mergeHooks — scriptExists repair leg", () => {
  it("without scriptExists, a stale binding still reads as present (old behavior)", () => {
    const { added, skipped, repaired } = mergeHooks(boundSettings(OLD_DIR), REAL_BIN_DIR);
    expect(added).toEqual([]);
    expect(repaired).toEqual([]);
    expect(skipped).toHaveLength(SEORAK_EVENTS.length);
  });

  it("re-points every fully-stale binding and reports it as repaired", () => {
    const { settings, added, skipped, repaired } = mergeHooks(
      boundSettings(OLD_DIR),
      REAL_BIN_DIR,
      (path) => !path.startsWith("/moved/away/"),
    );
    expect(added).toEqual([]);
    expect(skipped).toEqual([]);
    expect(repaired).toHaveLength(SEORAK_EVENTS.length);
    for (const { path } of seorakHookPaths(settings)) {
      expect(path.startsWith(REAL_BIN_DIR)).toBe(true);
    }
  });

  it("leaves a binding alone when its script still exists", () => {
    const { skipped, repaired } = mergeHooks(
      boundSettings(OLD_DIR),
      REAL_BIN_DIR,
      () => true,
    );
    expect(repaired).toEqual([]);
    expect(skipped).toHaveLength(SEORAK_EVENTS.length);
  });

  it("preserves non-Seorak hooks on a repaired event", () => {
    const settings = boundSettings(OLD_DIR);
    const hooks = settings.hooks as Record<string, unknown[]>;
    hooks.SessionStart = [...hooks.SessionStart!, { hooks: [{ type: "command", command: "echo mine" }] }];
    const result = mergeHooks(settings, REAL_BIN_DIR, () => false);
    expect(result.repaired).toContain("SessionStart");
    const kept = JSON.stringify(result.settings);
    expect(kept).toContain("echo mine");
  });
});

describe("installHooks — end-to-end repair on disk", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "seorak-install-repair-"));
    settingsPath = join(dir, "settings.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("rewrites a moved-checkout settings file and reports repaired events", () => {
    writeFileSync(settingsPath, JSON.stringify(boundSettings(OLD_DIR), null, 2), "utf8");
    const result = installHooks({ settingsPath, binDir: REAL_BIN_DIR });
    expect(result.repaired).toHaveLength(SEORAK_EVENTS.length);
    expect(result.added).toEqual([]);
    expect(result.backedUp).toBe(true);
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    for (const { path } of seorakHookPaths(written)) {
      expect(path.startsWith(REAL_BIN_DIR)).toBe(true);
    }
  });

  it("stays a no-op (no .bak churn) when bindings already point at a live checkout", () => {
    writeFileSync(settingsPath, JSON.stringify(boundSettings(REAL_BIN_DIR), null, 2), "utf8");
    const result = installHooks({ settingsPath, binDir: REAL_BIN_DIR });
    expect(result.added).toEqual([]);
    expect(result.repaired).toEqual([]);
    expect(result.backedUp).toBe(false);
  });
});

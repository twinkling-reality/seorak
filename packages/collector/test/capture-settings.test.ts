/**
 * capture-settings.test.ts — on-machine enforcement of the Data & capture
 * toggles. Contracts under test:
 *
 *   - defaults-on: an absent/corrupt capture.json reads as everything enabled
 *     (the cache can never take capture down with it);
 *   - lineCounts=false stops the adapter from deriving editLines at all;
 *   - gitMomentum=false turns momentumEnabled() off, but the local env
 *     (SEORAK_MOMENTUM) stays the explicit word and wins both ways.
 *
 * fs-sandboxed: SEORAK_DIR points at a temp dir so the cache file lives in a
 * sandbox, never the real ~/.seorak.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseClaudeCodeHook } from "../src/adapters/claude-code.ts";
import {
  captureSettings,
  resetCaptureSettingsCache,
  syncCaptureSettings,
} from "../src/capture-settings.ts";
import { momentumEnabled } from "../src/git.ts";
import { captureSettingsPath } from "../src/paths.ts";

let sandbox: string;
const savedDir = process.env.SEORAK_DIR;
const savedMomentum = process.env.SEORAK_MOMENTUM;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "seorak-capture-"));
  process.env.SEORAK_DIR = sandbox;
  delete process.env.SEORAK_MOMENTUM;
});

afterEach(() => {
  rmSync(captureSettingsPath(), { force: true });
  resetCaptureSettingsCache();
  delete process.env.SEORAK_MOMENTUM;
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
  if (savedMomentum === undefined) delete process.env.SEORAK_MOMENTUM;
  else process.env.SEORAK_MOMENTUM = savedMomentum;
});

function writeSettings(value: unknown): void {
  writeFileSync(captureSettingsPath(), JSON.stringify(value), "utf8");
  resetCaptureSettingsCache();
}

describe("captureSettings cache", () => {
  it("defaults when the cache file is absent (fileLabels stays opt-in OFF)", () => {
    expect(captureSettings()).toEqual({
      lineCounts: true,
      gitMomentum: true,
      fileSignals: true,
      toolchain: true,
      fileLabels: false,
      repoLabels: false,
    });
  });

  it("defaults when the cache file is corrupt", () => {
    writeFileSync(captureSettingsPath(), "{not json", "utf8");
    resetCaptureSettingsCache();
    expect(captureSettings()).toEqual({
      lineCounts: true,
      gitMomentum: true,
      fileSignals: true,
      toolchain: true,
      fileLabels: false,
      repoLabels: false,
    });
  });

  it("reads stored toggles", () => {
    writeSettings({ lineCounts: false, gitMomentum: false, fileSignals: false, fileLabels: true });
    expect(captureSettings()).toEqual({
      lineCounts: false,
      gitMomentum: false,
      fileSignals: false,
      toolchain: true,
      fileLabels: true,
      repoLabels: false,
    });
  });
});

describe("lineCounts gate in the claude-code adapter", () => {
  const editPayload = {
    hook_event_name: "PostToolUse",
    session_id: "s1",
    tool_name: "Edit",
    tool_input: { old_string: "a", new_string: "a\nb" },
  };

  it("derives editLines when the toggle is on (default)", () => {
    expect(parseClaudeCodeHook(editPayload)?.editLines).toEqual({ added: 1, removed: 0 });
  });

  it("derives NOTHING when the toggle is off", () => {
    writeSettings({ lineCounts: false });
    expect(parseClaudeCodeHook(editPayload)?.editLines).toBeUndefined();
  });
});

describe("syncCaptureSettings — read-token auth (Stage 4)", () => {
  const savedFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = savedFetch;
    rmSync(captureSettingsPath(), { force: true });
    resetCaptureSettingsCache();
  });

  it("sends the read token as a Bearer header (the daemon passes SEORAK_READ_KEY ?? SEORAK_INGEST_KEY)", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url: String(url), headers: init?.headers ?? {} });
      return {
        ok: true,
        json: async () => ({ capture: { lineCounts: false } }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await syncCaptureSettings("http://worker.test", "read-tok");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("http://worker.test/settings");
    // The read token gates GET /settings (requireReadAuth), so it MUST be sent —
    // an ingest-only key would 401 against an armed worker.
    expect(seen[0]!.headers.authorization).toBe("Bearer read-tok");
    // And the fetched capture toggles landed in the local cache.
    resetCaptureSettingsCache();
    expect(JSON.parse(readFileSync(captureSettingsPath(), "utf8")).lineCounts).toBe(false);
  });

  it("sends no auth header against an open worker (empty key)", async () => {
    let headers: Record<string, string> = { placeholder: "unset" };
    globalThis.fetch = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      headers = init?.headers ?? {};
      return { ok: true, json: async () => ({ capture: {} }) } as unknown as Response;
    }) as unknown as typeof fetch;

    await syncCaptureSettings("http://worker.test");
    expect(headers.authorization).toBeUndefined();
  });
});

describe("gitMomentum gate", () => {
  it("follows the toggle when no env is set", () => {
    writeSettings({ gitMomentum: false });
    expect(momentumEnabled()).toBe(false);
    writeSettings({ gitMomentum: true });
    expect(momentumEnabled()).toBe(true);
  });

  it("the explicit local env wins both ways", () => {
    writeSettings({ gitMomentum: true });
    process.env.SEORAK_MOMENTUM = "0";
    expect(momentumEnabled()).toBe(false);
    writeSettings({ gitMomentum: false });
    process.env.SEORAK_MOMENTUM = "1";
    expect(momentumEnabled()).toBe(true);
  });
});

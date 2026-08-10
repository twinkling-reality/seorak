/**
 * file-id.test.ts — the salted file-identity signal (CAPTURE-PRINCIPLE: repoId
 * one level down). Contracts under test:
 *
 *   - fileId/dirId are 64-hex salted hashes, STABLE for the same path and
 *     distinct across paths; the raw path never rides the canonical input;
 *   - labels are BASENAMES only and appear ONLY under the fileLabels opt-in;
 *   - the fileSignals toggle kills the whole derivation;
 *   - failed calls and non-edit tools derive nothing (absent, not partial);
 *   - the emitted tool.call event passes assertEmitSafe with the new fields.
 *
 * fs-sandboxed: SEORAK_DIR points at a temp dir so the salt file lives in a
 * sandbox, never the real ~/.seorak.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { parseClaudeCodeHook } from "../src/adapters/claude-code.ts";
import { captureSettingsPath } from "../src/paths.ts";
import { resetCaptureSettingsCache } from "../src/capture-settings.ts";
import { deriveFileCategory, deriveFileIdentity } from "../src/file-id.ts";
import { assertEmitSafe } from "../src/emit.ts";

let sandbox: string;
const savedDir = process.env.SEORAK_DIR;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "seorak-fileid-"));
  process.env.SEORAK_DIR = sandbox;
});

afterEach(() => {
  rmSync(captureSettingsPath(), { force: true });
  resetCaptureSettingsCache();
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
});

function writeSettings(value: unknown): void {
  writeFileSync(captureSettingsPath(), JSON.stringify(value), "utf8");
  resetCaptureSettingsCache();
}

const SECRET_PATH = "/Users/someone/clientco-secret-repo/src/billing/invoice.ts";

const editPayload = {
  session_id: "s-1",
  hook_event_name: "PostToolUse",
  tool_name: "Edit",
  tool_input: { file_path: SECRET_PATH, old_string: "a", new_string: "b" },
};

describe("deriveFileIdentity", () => {
  it("derives stable 64-hex ids and no labels by default", () => {
    const a = deriveFileIdentity("Edit", { file_path: SECRET_PATH }, false);
    const b = deriveFileIdentity("Write", { file_path: SECRET_PATH }, false);
    expect(a?.fileId).toMatch(/^[0-9a-f]{64}$/);
    expect(a?.dirId).toMatch(/^[0-9a-f]{64}$/);
    expect(a?.fileId).toBe(b?.fileId); // same path, same id, any edit tool
    expect(a?.fileId).not.toBe(a?.dirId);
    expect(a?.fileLabel).toBeUndefined();
    expect(a?.dirLabel).toBeUndefined();
  });

  it("distinct paths hash to distinct ids; same dir shares dirId", () => {
    const a = deriveFileIdentity("Edit", { file_path: "/r/src/a.ts" }, false);
    const b = deriveFileIdentity("Edit", { file_path: "/r/src/b.ts" }, false);
    expect(a?.fileId).not.toBe(b?.fileId);
    expect(a?.dirId).toBe(b?.dirId);
  });

  it("labels are basenames ONLY, and only when opted in", () => {
    const id = deriveFileIdentity("Edit", { file_path: SECRET_PATH }, true);
    expect(id?.fileLabel).toBe("invoice.ts");
    expect(id?.dirLabel).toBe("billing");
    expect(JSON.stringify(id)).not.toContain("clientco");
    expect(JSON.stringify(id)).not.toContain("/");
  });

  it("NotebookEdit uses notebook_path; non-edit tools derive nothing", () => {
    expect(
      deriveFileIdentity("NotebookEdit", { notebook_path: "/r/nb.ipynb" }, false)?.fileId,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveFileIdentity("Read", { file_path: "/r/a.ts" }, false)).toBeUndefined();
    expect(deriveFileIdentity("Bash", { command: "rm -rf /" }, false)).toBeUndefined();
  });
});

describe("deriveFileCategory", () => {
  it("classifies by extension into the closed enum", () => {
    expect(deriveFileCategory("/r/src/overview.ts")).toBe("source");
    expect(deriveFileCategory("/r/src/tokens.css")).toBe("styles");
    expect(deriveFileCategory("/r/README.md")).toBe("docs");
    expect(deriveFileCategory("/r/wrangler.toml")).toBe("config");
    expect(deriveFileCategory("/r/seed.sql")).toBe("data");
  });

  it("test markers outrank the extension (suffix and directory)", () => {
    expect(deriveFileCategory("/r/src/overview.test.ts")).toBe("test");
    expect(deriveFileCategory("/r/src/api.spec.tsx")).toBe("test");
    expect(deriveFileCategory("/r/pkg/foo_test.go")).toBe("test");
    expect(deriveFileCategory("/r/src/__tests__/helpers.ts")).toBe("test");
    expect(deriveFileCategory("/r/test/fixtures.json")).toBe("test");
  });

  it("dotfiles read as config; no rule means other, never a guess", () => {
    expect(deriveFileCategory("/r/.gitignore")).toBe("config");
    expect(deriveFileCategory("/r/.eslintrc")).toBe("config");
    expect(deriveFileCategory("/r/Makefile")).toBe("other");
    expect(deriveFileCategory("/r/logo.xcassets")).toBe("other");
  });

  it("rides deriveFileIdentity regardless of the fileLabels opt-in", () => {
    const withoutLabels = deriveFileIdentity("Edit", { file_path: SECRET_PATH }, false);
    const withLabels = deriveFileIdentity("Edit", { file_path: SECRET_PATH }, true);
    expect(withoutLabels?.fileCategory).toBe("source");
    expect(withLabels?.fileCategory).toBe("source");
  });
});

describe("file identity through the claude-code adapter", () => {
  it("rides the canonical input for a successful edit — ids only, no path", () => {
    const canonical = parseClaudeCodeHook(editPayload);
    expect(canonical.file?.fileId).toMatch(/^[0-9a-f]{64}$/);
    expect(canonical.file?.dirId).toMatch(/^[0-9a-f]{64}$/);
    expect(canonical.file?.fileLabel).toBeUndefined(); // opt-in is OFF by default
    const serialized = JSON.stringify(canonical);
    expect(serialized).not.toContain("clientco");
    expect(serialized).not.toContain("invoice.ts");
    expect(serialized).not.toContain("file_path");
  });

  it("carries basename labels when fileLabels is opted in", () => {
    writeSettings({ fileLabels: true });
    const canonical = parseClaudeCodeHook(editPayload);
    expect(canonical.file?.fileLabel).toBe("invoice.ts");
    expect(canonical.file?.dirLabel).toBe("billing");
    expect(JSON.stringify(canonical)).not.toContain("clientco");
  });

  it("derives NOTHING when fileSignals is off", () => {
    writeSettings({ fileSignals: false, fileLabels: true });
    expect(parseClaudeCodeHook(editPayload)?.file).toBeUndefined();
  });

  it("derives NOTHING for a failed edit (PostToolUseFailure)", () => {
    const canonical = parseClaudeCodeHook({
      ...editPayload,
      hook_event_name: "PostToolUseFailure",
    });
    expect(canonical.file).toBeUndefined();
  });
});

describe("emit allowlist accepts the new fields", () => {
  it("a tool.call with fileId/dirId/category/labels passes assertEmitSafe", () => {
    expect(() =>
      assertEmitSafe({
        kind: "tool.call",
        eventId: "e-1",
        sessionId: "s-1",
        at: "2026-06-09T00:00:00.000Z",
        toolName: "Edit",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        fileId: "a".repeat(64),
        dirId: "b".repeat(64),
        fileCategory: "source",
        fileLabel: "invoice.ts",
        dirLabel: "billing",
      }),
    ).not.toThrow();
  });
});

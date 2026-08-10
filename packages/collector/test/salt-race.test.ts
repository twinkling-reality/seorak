// Guard for the salt cold-start race (git.ts readOrCreateSalt). The salt is the
// root of every deterministic id (repoId, fileId, line-survival, and the coming
// Codex tailer ids). If two processes cold-start with no salt file and each mints
// its own, the loser's ids never survive a re-tail and INSERT OR IGNORE cannot
// collapse them. These pin that the persisted value is stable across calls and
// that a value already on disk always wins over a fresh mint.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { readOrCreateSalt, saltedHash } from "../src/git.ts";
import { repoSaltPath } from "../src/paths.ts";

const savedDir = process.env.SEORAK_DIR;
let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "seorak-salt-"));
  process.env.SEORAK_DIR = sandbox;
});
afterEach(() => {
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
  rmSync(sandbox, { recursive: true, force: true });
});

describe("readOrCreateSalt", () => {
  it("is stable across repeated calls (persisted, not per-call random)", () => {
    const a = readOrCreateSalt();
    const b = readOrCreateSalt();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("honors a pre-seeded salt file verbatim (the winner of a race is read back)", () => {
    const saltPath = repoSaltPath();
    mkdirSync(dirname(saltPath), { recursive: true });
    const seeded = "deadbeef".repeat(8);
    writeFileSync(saltPath, seeded, "utf8");
    expect(readOrCreateSalt()).toEqual(seeded);
    // saltedHash over a fixed seed must reflect the persisted salt, not a fresh one.
    const once = saltedHash("codex\0session\0file\0line0");
    const twice = saltedHash("codex\0session\0file\0line0");
    expect(twice).toEqual(once);
  });
});

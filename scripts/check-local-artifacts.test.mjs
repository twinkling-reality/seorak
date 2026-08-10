import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";

import { gitSync } from "./isolated-git.mjs";

import {
  checkLocalArtifacts,
  indexedRepositoryPaths,
  localArtifactCategory,
  parseNulPaths,
  summarizeLocalArtifacts,
} from "./check-local-artifacts.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const temporary = [];

afterEach(() => {
  while (temporary.length > 0) {
    rmSync(temporary.pop(), { recursive: true, force: true });
  }
});

test("classifies known local tool roots and secret configuration paths", () => {
  const expected = new Map([
    [".devstack", "local development tool state"],
    [".orchescope/state/orchescope.db", "local audit tool state"],
    [".yummycode/sessions/sess_private.json", "local session tool state"],
    [".port/decision.md", "local design scratch"],
    [".playwright-mcp/browser.json", "local browser session state"],
    [".wrangler/state/v3/d1.sqlite", "local Cloudflare state"],
    [".cf/account.json", "local Cloudflare state"],
    ["packages/worker/.dev.vars.staging", "local secret configuration"],
    ["packages/web/.env.local", "local secret configuration"],
    ["packages/push/AuthKey_ABC1234567.p8", "local secret configuration"],
    ["certificates/apns.pem", "local secret configuration"],
    ["signing/distribution.KEY", "local secret configuration"],
    ["signing/profile.p12", "local secret configuration"],
  ]);

  for (const [path, category] of expected) {
    assert.equal(localArtifactCategory(path), category, path);
  }
});

test("allows repository source, fixtures, templates, and product HTML", () => {
  for (const path of [
    "docs/ARCHITECTURE.md",
    "packages/worker/test/fixtures/overview-golden.json",
    "packages/worker/test/fixtures/migration.sqlite",
    "packages/web/site/index.html",
    "docs/benchmarks/operation-report.json",
    ".env.example",
    "packages/worker/.dev.vars.example",
  ]) {
    assert.equal(localArtifactCategory(path), null, path);
  }
});

test("parses NUL-delimited Git output and deduplicates tracked plus staged paths", () => {
  assert.deepEqual(parseNulPaths("one\0two\0"), ["one", "two"]);
  const summary = summarizeLocalArtifacts([
    ".orchescope/state/a.db",
    "./.orchescope/state/a.db",
    "src/index.ts",
  ]);
  assert.deepEqual([...summary], [
    ["local audit tool state", 1],
  ]);
});

test("queries tracked and staged names without reading files", async () => {
  const calls = [];
  const paths = await indexedRepositoryPaths({
    cwd: "/fixture",
    runGit: async (args, cwd) => {
      calls.push({ args, cwd });
      return args[0] === "ls-files"
        ? "tracked.ts\0.orchescope/state/private.db\0"
        : ".yummycode/sessions/sess_private.json\0";
    },
  });

  assert.deepEqual(calls, [
    { args: ["ls-files", "--cached", "-z"], cwd: "/fixture" },
    {
      args: ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
      cwd: "/fixture",
    },
  ]);
  assert.deepEqual(paths, [
    "tracked.ts",
    ".orchescope/state/private.db",
    ".yummycode/sessions/sess_private.json",
  ]);
});

test("failure reports only category counts, never scratch filenames", async () => {
  const privateName = ".yummycode/sessions/sess_do-not-log.json";
  await assert.rejects(
    checkLocalArtifacts({
      loadPaths: async () => [
        privateName,
        ".orchescope/state/orchescope.db",
        ".orchescope/state/orchescope.db",
      ],
    }),
    (error) => {
      assert.match(error.message, /rejected 2 tracked\/staged file/);
      assert.match(error.message, /local audit tool state: 1/);
      assert.match(error.message, /local session tool state: 1/);
      assert.doesNotMatch(error.message, /sess_do-not-log|orchescope\.db/);
      return true;
    },
  );
});

test("rejects a local-state path forced into a real Git index", async () => {
  const root = mkdtempSync(join(tmpdir(), "seorak-local-artifact-check-"));
  temporary.push(root);
  const path = join(root, ".orchescope", "state", "private.db");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  gitSync(["init", "--quiet"], { cwd: root });
  gitSync(["add", "--force", ".orchescope/state/private.db"], {
    cwd: root,
  });

  await assert.rejects(
    checkLocalArtifacts({ cwd: root }),
    /local audit tool state: 1/,
  );
});

test("ignores signing keys everywhere and rejects a forced add", async () => {
  const root = mkdtempSync(join(tmpdir(), "seorak-signing-key-check-"));
  temporary.push(root);
  const relativePath = "packages/push/AuthKey_TEST1234.p8";
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    join(root, ".gitignore"),
    readFileSync(resolve(REPO_ROOT, ".gitignore"), "utf8"),
  );
  writeFileSync(path, "test fixture, never key material");
  gitSync(["init", "--quiet"], { cwd: root });

  assert.throws(
    () => gitSync(["add", relativePath], { cwd: root, stdio: "pipe" }),
    /ignored by/i,
  );
  gitSync(["add", "--force", relativePath], { cwd: root });
  await assert.rejects(
    checkLocalArtifacts({ cwd: root }),
    /local secret configuration: 1/,
  );
});

test("repository wiring keeps ignores, scripts, and CI on the one guard", () => {
  const ignore = readFileSync(resolve(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(ignore, /^\/\.devstack$/m);
  assert.match(ignore, /^\/\.orchescope\/$/m);
  assert.match(ignore, /^\/\.yummycode\/$/m);
  for (const extension of ["p8", "pem", "key", "p12"]) {
    assert.match(ignore, new RegExp(`^\\*\\.${extension}$`, "m"));
  }

  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["local-artifacts:check"],
    "node scripts/check-local-artifacts.mjs",
  );
  assert.equal(
    pkg.scripts["local-artifacts:test"],
    "node --test scripts/check-local-artifacts.test.mjs",
  );

  // CI is per-repository. The ownership map places `.github/**` private because
  // these workflows carry the macOS signing and Expo jobs, and ADR 005 phase C
  // gives the public core its own rather than a filtered copy, so the public
  // tree has no workflow for this to read. Absent means "this tree has no CI to
  // wire"; a workflow that EXISTS and drops the guard still fails.
  const ciPath = resolve(REPO_ROOT, ".github/workflows/ci.yml");
  if (!existsSync(ciPath)) return;
  const ci = readFileSync(ciPath, "utf8");
  assert.match(ci, /npm run local-artifacts:test/);
  assert.match(ci, /npm run local-artifacts:check/);
});

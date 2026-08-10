/**
 * capture-foundation.test.ts — the derivation modules for the toolchain +
 * behavioral capture layer (CAPTURE-FOUNDATION). Proves each derivation returns a
 * CLOSED enum / band and DISCARDS its raw input (branch name, path, command,
 * manifest) — the boundary lives at emit.ts (see emit-allowlist.test.ts), and this
 * proves the derivers feed it only content-free values.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyBranchWorkType } from "../src/branch-work-type.ts";
import { deriveFileLanguage } from "../src/file-language.ts";
import { classifyUndo } from "../src/hooks.ts";
import { deriveRepoShape } from "../src/repo-shape.ts";
import { detectFramework, detectPackageManager, detectToolchain } from "../src/toolchain.ts";

describe("classifyBranchWorkType — prefix → closed enum, branch string discarded", () => {
  it("maps conventional prefixes", () => {
    expect(classifyBranchWorkType("feat/add-thing")).toBe("feature");
    expect(classifyBranchWorkType("feature/x")).toBe("feature");
    expect(classifyBranchWorkType("fix/leak")).toBe("fix");
    expect(classifyBranchWorkType("hotfix/urgent")).toBe("fix");
    expect(classifyBranchWorkType("refactor/split")).toBe("refactor");
    expect(classifyBranchWorkType("chore/deps")).toBe("chore");
    expect(classifyBranchWorkType("ci/pipeline")).toBe("chore");
    expect(classifyBranchWorkType("docs/readme")).toBe("chore");
  });

  it("maps trunk / bare / unknown to 'other' and null to 'other'", () => {
    expect(classifyBranchWorkType("main")).toBe("other");
    expect(classifyBranchWorkType("master")).toBe("other");
    expect(classifyBranchWorkType("some-random-branch")).toBe("other");
    expect(classifyBranchWorkType(null)).toBe("other");
    expect(classifyBranchWorkType(undefined)).toBe("other");
  });

  it("never returns anything but the closed enum (even for a secret-looking branch)", () => {
    const out = classifyBranchWorkType("feat/acme-secret-launch-2026");
    expect(["feature", "fix", "refactor", "chore", "other"]).toContain(out);
    expect(out).toBe("feature"); // and it carries none of the branch text
  });
});

describe("deriveFileLanguage — extension → language family, path discarded", () => {
  it("maps representative extensions to families", () => {
    expect(deriveFileLanguage("/x/foo.ts")).toBe("typescript");
    expect(deriveFileLanguage("/x/foo.tsx")).toBe("typescript");
    expect(deriveFileLanguage("/x/foo.rs")).toBe("rust");
    expect(deriveFileLanguage("/x/foo.py")).toBe("python");
    expect(deriveFileLanguage("/x/a.scss")).toBe("css");
    expect(deriveFileLanguage("/x/a.h")).toBe("c");
    expect(deriveFileLanguage("/x/a.cc")).toBe("cpp");
  });

  it("returns undefined for no-extension / dotfiles / unknown (honest-empty, never a guess)", () => {
    expect(deriveFileLanguage("/x/Makefile")).toBeUndefined();
    expect(deriveFileLanguage("/x/.gitignore")).toBeUndefined();
    expect(deriveFileLanguage("/x/foo.xyz")).toBeUndefined();
  });
});

describe("classifyUndo — git command → closed enum, command discarded", () => {
  it("classifies genuine work-discards", () => {
    expect(classifyUndo("git reset --hard HEAD~1")).toBe("reset-hard");
    expect(classifyUndo("git revert abc1234")).toBe("revert");
    expect(classifyUndo("git clean -fd")).toBe("clean");
    expect(classifyUndo("git restore .")).toBe("restore");
    expect(classifyUndo("git restore --staged src/x.ts")).toBe("restore");
    expect(classifyUndo("git checkout -- src/x.ts")).toBe("restore");
    expect(classifyUndo("git checkout .")).toBe("restore");
  });

  it("does NOT classify a branch switch or a non-undo command", () => {
    expect(classifyUndo("git checkout main")).toBeUndefined(); // a switch, not a discard
    expect(classifyUndo("git reset --soft HEAD~1")).toBeUndefined(); // soft reset keeps the tree
    expect(classifyUndo("npm test")).toBeUndefined();
    expect(classifyUndo("git status")).toBeUndefined();
    expect(classifyUndo(undefined)).toBeUndefined();
  });
});

describe("detectToolchain — enums only, the manifest is read then discarded", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "seorak-tc-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("detects the package manager from lockfile presence only", () => {
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    expect(detectPackageManager(dir)).toBe("pnpm");
  });

  it("detects the framework from a dependency KEY and returns ONLY the enum (no manifest content)", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "acme-secret-internal-service",
        repository: "git@github.com:acmecorp/secret.git",
        dependencies: { next: "^14.0.0", react: "^18" },
      }),
    );
    writeFileSync(join(dir, "package-lock.json"), "{}");
    const result = detectToolchain(dir);
    expect(result).toEqual({ packageManager: "npm", framework: "next" }); // meta beats base
    // The manifest's private name / repo url must NOT survive into the result.
    expect(JSON.stringify(result)).not.toContain("acme");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("returns nulls when nothing is detectable (honest-empty)", () => {
    expect(detectToolchain(dir)).toEqual({ packageManager: null, framework: null });
  });

  it("detects python frameworks by token without shipping the manifest", () => {
    writeFileSync(join(dir, "pyproject.toml"), '[project]\nname="x"\ndependencies=["django>=5"]\n');
    expect(detectFramework(dir)).toBe("django");
  });
});

describe("deriveRepoShape — gated on a real repo, bands only", () => {
  it("returns undefined for a non-git directory (honest-empty gate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "seorak-rs-"));
    try {
      expect(deriveRepoShape(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { currentBranch, repoToplevel } from "../src/git.ts";

/**
 * The suite must not inherit git's own environment. `test/support/
 * isolate-git-environment.ts` is what guarantees it; this is the guard that
 * fails when that guarantee goes away.
 *
 * It is not hypothetical. A pre-push hook exports `GIT_DIR` into everything it
 * runs, the hook runs the gate set, and the gate set runs this suite — so on
 * 2026-08-08 these files were building and reading fixture repositories in the
 * DEVELOPER'S repository, the `Test` gate exited 1, and every push to main was
 * refused while `npm run test` at a terminal stayed green.
 *
 * Delete either `setupFiles` entry and the last case here goes red.
 */
const scratch: string[] = [];
afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "seorak-git-env-"));
  scratch.push(root);
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "one"], { cwd: root });
  return root;
}

describe("the suite's git environment", () => {
  it("carries no inherited GIT_* variable", () => {
    expect(Object.keys(process.env).filter((n) => n.startsWith("GIT_"))).toEqual([]);
  });

  it("builds a fixture repository in the directory it was given, not elsewhere", () => {
    const root = repo();
    const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    // realpath, because macOS hands out /var symlinks for /private/var.
    expect(toplevel).toBe(
      execFileSync("realpath", [root], { encoding: "utf8" }).trim(),
    );
  });

  it("answers about the repository it was asked about, whatever the ambient GIT_DIR says", () => {
    // The product path, with the failure planted: point GIT_DIR at a DIFFERENT
    // repository and require the readers to keep answering about `cwd`. Without
    // the scrub in src/git/runner.ts these report the elsewhere repo instead,
    // which for a tool that counts commits is a confident wrong number rather
    // than an error anybody would notice.
    const mine = repo();
    const elsewhere = repo();
    execFileSync("git", ["branch", "-m", "not-main"], { cwd: elsewhere });

    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = join(elsewhere, ".git");
    try {
      expect(currentBranch(mine)).toBe("main");
      expect(repoToplevel(mine)).toBe(
        execFileSync("realpath", [mine], { encoding: "utf8" }).trim(),
      );
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
  });
});

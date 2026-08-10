/**
 * commit-watcher.test.ts — the git side of the Tier 2 attribution walk, against REAL
 * temp git repos (HEAD-TO-HEAD).
 *
 * Concerns:
 *  (a) `commitsSince` returns EVERY commit — including the NEWEST. This is a regression
 *      guard with teeth: the walker marks commit headers with a sentinel, and the first
 *      sentinel it ever used was a leading SPACE. `git()` trims its stdout, so the first
 *      header lost its marker, was misread as a numstat line, and the newest commit was
 *      silently dropped from every walk. Silently: no error, no null, just one fewer
 *      commit. Caught on live data only because the newest commit happened to be one we
 *      had just made and could count by hand.
 *  (b) OLDEST-FIRST ordering, which the attribution walk depends on: each commit sets the
 *      `lastCommitAt` bound the NEXT commit to that file reads.
 *  (c) merges excluded, renames contributing 0 added lines, ignore-globs honored.
 *  (d) the cursor: a second walk from the first walk's tip sees only what is new, and an
 *      unresolvable cursor (rewritten history) degrades to the bounded window instead of
 *      walking everything or dying.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitsSince, seedLastCommitAt } from "../src/git.ts";

let repo: string;

function g(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

/** Commit `lines` new lines into `file`. Content is irrelevant; only counts matter. */
function commit(file: string, lines: number, message: string): string {
  const body = Array.from({ length: lines }, (_, i) => `line ${message} ${i}`).join("\n");
  writeFileSync(join(repo, file), `${body}\n`, { flag: "a" });
  g(["add", "-A"]);
  g(["commit", "-m", message]);
  return g(["rev-parse", "HEAD"]);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "seorak-watch-"));
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "t@t.t"]);
  g(["config", "user.name", "t"]);
  g(["config", "commit.gpgsign", "false"]);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("commitsSince — every commit, newest included, oldest first", () => {
  it("REGRESSION: the NEWEST commit is not silently dropped", () => {
    commit("a.txt", 3, "first");
    commit("a.txt", 4, "second");
    const newest = commit("a.txt", 5, "third");

    const commits = commitsSince(repo, null, "HEAD", [], 30);
    expect(commits).not.toBeNull();
    expect(commits).toHaveLength(3);
    // The bug dropped exactly this one, and nothing else, with no error.
    expect(commits!.at(-1)!.sha).toBe(newest);
    expect(commits!.at(-1)!.files).toEqual([{ path: "a.txt", added: 5 }]);
  });

  it("returns commits OLDEST FIRST (the attribution walk depends on it)", () => {
    const first = commit("a.txt", 1, "first");
    const second = commit("a.txt", 1, "second");
    const commits = commitsSince(repo, null, "HEAD", [], 30)!;
    expect(commits.map((c) => c.sha)).toEqual([first, second]);
    expect(commits[0]!.at).toBeLessThanOrEqual(commits[1]!.at);
  });

  it("carries per-file ADDED counts and the AUTHOR time", () => {
    commit("a.txt", 7, "seed");
    const commits = commitsSince(repo, null, "HEAD", [], 30)!;
    expect(commits[0]!.files).toEqual([{ path: "a.txt", added: 7 }]);
    expect(commits[0]!.at).toBeGreaterThan(0);
    // Epoch MS, not seconds — an off-by-1000 here would put every commit in 1970 and
    // silently mature every attribution instantly.
    expect(commits[0]!.at).toBeGreaterThan(Date.parse("2020-01-01"));
  });

  it("EXCLUDES merge commits (they author no lines)", () => {
    commit("base.txt", 1, "base");
    g(["checkout", "-q", "-b", "feat"]);
    commit("feat.txt", 5, "on-branch");
    g(["checkout", "-q", "main"]);
    commit("main.txt", 2, "on-main");
    g(["merge", "--no-ff", "--no-edit", "-q", "feat"]);

    const commits = commitsSince(repo, null, "HEAD", [], 30)!;
    const messages = commits.flatMap((c) => c.files.map((f) => f.path)).sort();
    expect(messages).toEqual(["base.txt", "feat.txt", "main.txt"]);
    // 4 commits exist (3 + the merge); only the 3 line-authoring ones come back.
    expect(commits).toHaveLength(3);
  });

  it("a pure RENAME authors NO lines (git reports it 0-added under -M)", () => {
    commit("old.txt", 20, "seed");
    g(["mv", "old.txt", "new.txt"]);
    g(["commit", "-m", "rename"]);

    const commits = commitsSince(repo, null, "HEAD", [], 30)!;
    expect(commits).toHaveLength(2);
    expect(commits[0]!.files).toEqual([{ path: "old.txt", added: 20 }]);

    // The rename carries NO files: it authored nothing, and must not, because
    // `git blame -M -C` at the tip traces the moved lines back to the commit that
    // ORIGINALLY wrote them. Crediting the rename would hand it a denominator whose
    // lines blame to someone else, and its work would read as dead.
    expect(commits[1]!.files).toEqual([]);

    // It is still RETURNED, empty, rather than filtered out — the cursor advances to the
    // newest commit walked, and dropping an empty newest commit would leave the cursor
    // behind it and re-walk the rename on every single tick, forever.
    expect(commits[1]!.sha).toBe(g(["rev-parse", "HEAD"]));
  });

  it("honors ignore globs (lockfiles / generated files never enter a denominator)", () => {
    commit("src.ts", 4, "code");
    writeFileSync(join(repo, "pnpm-lock.yaml"), "lock\n".repeat(500));
    g(["add", "-A"]);
    g(["commit", "-m", "lock"]);

    const commits = commitsSince(repo, null, "HEAD", ["pnpm-lock.yaml"], 30)!;
    expect(commits.flatMap((c) => c.files.map((f) => f.path))).toEqual(["src.ts"]);
  });

  it("honest-empty: a repo with nothing new since the cursor yields []", () => {
    const head = commit("a.txt", 1, "only");
    expect(commitsSince(repo, head, "HEAD", [], 30)).toEqual([]);
  });
});

describe("commitsSince — the cursor", () => {
  it("a cursor walks only what landed AFTER it", () => {
    commit("a.txt", 1, "first");
    const cursor = commit("a.txt", 1, "second");
    const third = commit("a.txt", 9, "third");

    const commits = commitsSince(repo, cursor, "HEAD", [], 30)!;
    expect(commits).toHaveLength(1);
    expect(commits[0]!.sha).toBe(third);
    expect(commits[0]!.files[0]!.added).toBe(9);
  });

  it("an UNRESOLVABLE cursor (history rewritten) falls back to the bounded window", () => {
    commit("a.txt", 1, "first");
    commit("a.txt", 1, "second");
    const bogus = "0".repeat(40); // a sha that does not exist in this repo

    const commits = commitsSince(repo, bogus, "HEAD", [], 30);
    // It must neither die nor walk all of history — it re-walks the bounded window and
    // lets the downstream deterministic ids make the overlap a no-op.
    expect(commits).not.toBeNull();
    expect(commits).toHaveLength(2);
  });

  it("a non-repo cwd yields null (transient), never a fabricated empty walk", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "seorak-norepo-"));
    try {
      expect(commitsSince(notARepo, null, "HEAD", [], 30)).toBeNull();
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

describe("seedLastCommitAt — the cold-start bound", () => {
  it("returns each path's most recent commit time in the window", () => {
    commit("a.txt", 1, "one");
    commit("b.txt", 1, "two");
    // Window [since=30d, until=0d) covers everything just committed.
    const seed = seedLastCommitAt(repo, 30, 0, [])!;
    expect(Object.keys(seed).sort()).toEqual(["a.txt", "b.txt"]);
    expect(seed["a.txt"]).toBeGreaterThan(Date.parse("2020-01-01"));
  });

  it("honors ignore globs", () => {
    commit("src.ts", 1, "code");
    writeFileSync(join(repo, "yarn.lock"), "x\n");
    g(["add", "-A"]);
    g(["commit", "-m", "lock"]);
    const seed = seedLastCommitAt(repo, 30, 0, ["yarn.lock"])!;
    expect(Object.keys(seed)).toEqual(["src.ts"]);
  });

  it("a non-repo cwd yields null, not an empty seed (which would look conclusive)", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "seorak-norepo-"));
    try {
      expect(seedLastCommitAt(notARepo, 30, 0, [])).toBeNull();
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

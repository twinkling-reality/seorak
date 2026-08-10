/**
 * git/repo-state.ts — the repo-state and ref primitives every other git module
 * reads: the honest-empty context gate, the toplevel, HEAD, branch names, and
 * commit counting between two shas.
 *
 * PRIVACY: shas, branch names, and the toplevel path are LOCAL ONLY. A branch name
 * is content and never leaves this machine; a sha is a globally-correlatable
 * fingerprint and is consumed for counting or as a git ref, never emitted. Only
 * `gitContext` (a closed enum) and counts travel.
 */
import type { GitContext } from "@seorak/types";
import { git, runGitStatus } from "./runner.ts";

/**
 * gitContext(cwd) — the honest-empty gate. A single documented precedence:
 *
 *   no-repo > detached > dirty-at-start > no-remote > clean
 *
 * - no-repo:        `git rev-parse --is-inside-work-tree` is not "true" (or fails)
 * - detached:       `git symbolic-ref -q HEAD` fails (HEAD is not on a branch)
 * - dirty-at-start: `git status --porcelain` is non-empty (uncommitted changes)
 * - no-remote:      `git remote` is empty (no configured remote)
 * - clean:          on a branch, no uncommitted changes, has a remote
 *
 * Each step's git read is guarded; a failed read at a non-gating step degrades
 * conservatively rather than throwing.
 */
export function gitContext(cwd: string): GitContext {
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return "no-repo";

  // detached: symbolic-ref fails (non-zero -> null) when HEAD is detached.
  const symRef = git(cwd, ["symbolic-ref", "-q", "HEAD"]);
  if (symRef === null) return "detached";

  // dirty-at-start: any porcelain output means uncommitted changes.
  const status = git(cwd, ["status", "--porcelain"]);
  if (status !== null && status.length > 0) return "dirty-at-start";

  // no-remote: empty remote list.
  const remotes = git(cwd, ["remote"]);
  if (remotes === null || remotes.length === 0) return "no-remote";

  return "clean";
}

/** The absolute repo toplevel for `cwd`, or null when not a repo. LOCAL ONLY —
 *  used by the daemon's repo registry as a git `cwd`; never emitted. */
export function repoToplevel(cwd: string): string | null {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  return top && top.length > 0 ? top : null;
}

/** The full HEAD sha (40-hex), or null when there is no commit / not a repo. The
 *  sha is used LOCALLY only (cursor + commit counting) and is NEVER emitted. */
export function headSha(cwd: string): string | null {
  const sha = git(cwd, ["rev-parse", "HEAD"]);
  return sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
}

/** The current branch short name (e.g. "main", "feat/x"), or null when HEAD is
 *  detached / not a repo. LOCAL ONLY — a branch name is content and never leaves
 *  this machine; it is used only as a local ref at survival-sweep time. */
export function currentBranch(cwd: string): string | null {
  const name = git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return name && name.length > 0 ? name : null;
}

/**
 * The repo's default branch short name: origin/HEAD's target when configured, else
 * a local `main`, else a local `master`. null when none resolves. LOCAL ONLY — a
 * branch name is content and never ships; it is used purely as a git ref here.
 */
export function defaultBranch(cwd: string): string | null {
  const head = git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head !== null && head.length > 0) {
    const short = head.startsWith("origin/") ? head.slice("origin/".length) : head;
    if (short.length > 0) return short;
  }
  for (const name of ["main", "master"]) {
    if (runGitStatus(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]) === 0) {
      return name;
    }
  }
  return null;
}

/** Number of commits on `endSha` not reachable from `startSha` (rev-list count),
 *  or null when either sha is missing/unresolvable (shallow clone, rebase). 0
 *  when the shas are equal. COUNT only — no sha ever leaves this function. */
export function commitsBetween(
  cwd: string,
  startSha: string,
  endSha: string,
): number | null {
  if (!startSha || !endSha) return null;
  if (startSha === endSha) return 0;
  const out = git(cwd, ["rev-list", "--count", `${startSha}..${endSha}`]);
  if (out === null) return null;
  const n = Number.parseInt(out, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * git/runner.ts — the ONLY place in the collector that spawns git.
 *
 * EVERY git invocation is GUARDED: spawnSync runs with a bounded timeout and is
 * wrapped so a missing git binary, a non-repo cwd, or a hung process can never
 * throw out of this layer. Two readers, because the two questions are different:
 * `git()` wants stdout and collapses every failure to null; `runGitStatus()` wants
 * the EXIT CODE and keeps "git answered 1" distinct from "git could not be
 * consulted", which is the distinction every ancestry check depends on.
 *
 * No caller above this module touches spawnSync, so every git read in the
 * collector is uniformly fail-soft and uniformly time-bounded.
 */
import { spawnSync } from "node:child_process";

/** Hard ceiling on any single git call so a hook never hangs the event loop. */
const GIT_TIMEOUT_MS = 2_000;

/**
 * Every git call below promises to answer about `cwd`. `GIT_DIR`,
 * `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_CONFIG_*` BEAT `cwd`, and git
 * exports them into every hook it runs — so a collector reading a repository
 * from inside one would silently answer about the hook's repository instead.
 * The failure is not an error: it is a confident wrong number, which for a tool
 * that reports commit counts is the worst shape available.
 *
 * The whole `GIT_*` namespace goes rather than a list of names, and overrides
 * are applied AFTER the scrub so a caller that means a variable still gets it.
 */
function gitEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) delete environment[name];
  }
  return { ...environment, ...overrides };
}

/**
 * Run a git command in `cwd` and return trimmed stdout, or `null` if the call
 * failed for ANY reason (non-zero exit, timeout, signal, missing binary, throw).
 * This is the single guarded entry point — no other code in the collector calls
 * spawnSync directly, so every git read is uniformly fail-soft.
 */
export function git(cwd: string, args: string[]): string | null {
  try {
    const res = spawnSync("git", args, {
      cwd,
      env: gitEnvironment(),
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (res.error) return null;
    if (res.signal) return null;
    if (typeof res.status !== "number" || res.status !== 0) return null;
    return (res.stdout ?? "").trim();
  } catch {
    return null;
  }
}

/**
 * Run a git command for its EXIT STATUS (not stdout). Returns the numeric exit
 * code, or null when the call could not run at all (timeout/signal/missing
 * binary/throw). Lets callers distinguish "git answered 1" (a real negative)
 * from "git could not be consulted" (unknown) — the `git()` reader above collapses
 * both to null, which is wrong for ancestry checks. Same hard timeout.
 */
export function runGitStatus(cwd: string, args: string[]): number | null {
  try {
    const res = spawnSync("git", args, {
      cwd,
      env: gitEnvironment(),
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (res.error) return null;
    if (res.signal) return null;
    if (typeof res.status !== "number") return null;
    return res.status;
  } catch {
    return null;
  }
}

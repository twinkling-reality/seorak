/**
 * The one way this repository spawns git.
 *
 * ---------------------------------------------------------------------------
 * WHY A WRAPPER AND NOT A CONVENTION
 * ---------------------------------------------------------------------------
 *
 * Git exports its own variables into every hook it runs, and they BEAT a child
 * process's `cwd:`. `GIT_DIR` picks the repository, `GIT_WORK_TREE` picks the
 * tree, `GIT_INDEX_FILE` picks the index, and `GIT_CONFIG_GLOBAL` /
 * `GIT_CONFIG_SYSTEM` pick which config file a write lands in. A helper that
 * strips `GIT_DIR` alone leaves four other routes to the same damage.
 *
 * This repository's pre-push hook runs the gate set, and the gate set runs the
 * suites under `scripts/`. Those suites create a temporary repository and then
 * `init`, `config` and `add --force` inside it. Inheriting the hook's
 * environment pointed every one of those at the DEVELOPER'S repository.
 *
 * OBSERVED, 2026-08-07, not hypothetical. One push left `core.hooksPath` in the
 * shared config pointing at a temp directory deleted seconds later, and
 * `core.bare = true`. A dangling `hooksPath` means every later push runs no
 * hook and says nothing. `core.bare = true` means `git rev-parse
 * --show-toplevel` fails, which is line 13 of the hook under `set -e`, so
 * pushes die with a bare `fatal:` and no gate output at all.
 *
 * It disables the thing that would have caught it. That is why it survived a
 * day of investigation, and it is why this is a wrapper every caller must go
 * through rather than a rule every caller must remember:
 * `check-isolated-git.mjs` fails the build when a file under `scripts/` names
 * the binary itself.
 *
 * ---------------------------------------------------------------------------
 * USING IT
 * ---------------------------------------------------------------------------
 *
 * `gitSync` / `gitSpawn` / `gitAsync` take the ARGUMENT LIST, not the command:
 *
 *   gitSync(["init", "--quiet"], { cwd: root })
 *
 * `env` on any of them means OVERRIDES on a scrubbed copy of `process.env`, not
 * a replacement environment. There is no way through this module to hand git an
 * inherited `GIT_*`, which is the point.
 *
 * `isolatedEnvironment()` is for spawning something that is not git but must
 * still not inherit the hook's view of the repository — the hook body itself,
 * or a `node` process that will go on to run git.
 */

import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Every variable git uses to override what `cwd` would have chosen shares this
 * prefix. Stripping the namespace rather than naming members is deliberate: a
 * list is a thing to keep in step with git, and nothing under `scripts/` wants
 * any of them.
 */
export const GIT_VARIABLE_PREFIX = "GIT_";

/**
 * A copy of the environment with git's own variables removed, then the caller's
 * overrides applied.
 *
 * THE ORDER IS THE POINT, and it was wrong until 2026-08-08. Scrubbing after the
 * merge deleted the caller's own `GIT_*` too, so a deliberate
 * `GIT_AUTHOR_DATE` — the way every suite in this repository writes a commit at
 * a fixed time — vanished silently and the commit took the wall clock instead.
 * No caller passed one yet, so nothing failed; the collector's date-sensitive
 * suites are the first, and they would have got a green run measuring the wrong
 * thing. An INHERITED `GIT_*` is a wrong answer. An ASKED-FOR one is the caller
 * saying what it means.
 */
export function isolatedEnvironment(overrides = {}) {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith(GIT_VARIABLE_PREFIX)) delete environment[name];
  }
  return { ...environment, ...overrides };
}

/** `execFileSync`, isolated. Throws on a non-zero exit, as it does. */
export function gitSync(args, options = {}) {
  return execFileSync("git", args, {
    ...options,
    env: isolatedEnvironment(options.env),
  });
}

/** `spawnSync`, isolated. For callers that read `status` instead of throwing. */
export function gitSpawn(args, options = {}) {
  return spawnSync("git", args, {
    ...options,
    env: isolatedEnvironment(options.env),
  });
}

/** Promisified `execFile`, isolated. Resolves `{ stdout, stderr }`. */
export function gitAsync(args, options = {}) {
  return execFileAsync("git", args, {
    ...options,
    env: isolatedEnvironment(options.env),
  });
}

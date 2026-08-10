#!/usr/bin/env node

/**
 * Git isolation gate: nothing under `scripts/` may name the git binary except
 * the wrapper that scrubs the environment first.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A GATE AND NOT A REVIEW NOTE
 * ---------------------------------------------------------------------------
 *
 * The failure it guards is silent and self-concealing. Git exports `GIT_DIR`
 * and friends into every hook; those beat a child's `cwd:`; the pre-push hook
 * runs the gate set; the gate set runs the suites here. A suite that spawns git
 * raw therefore acts on the DEVELOPER'S repository, and what it writes there
 * (`core.hooksPath`, `core.bare`) stops the hook running at all — so the next
 * push reports nothing wrong because nothing ran. `isolated-git.mjs` records the
 * measurement. Ten suites were affected when this was written; the eleventh is
 * the one this file exists for.
 *
 * ---------------------------------------------------------------------------
 * IT DERIVES, IT DOES NOT LIST
 * ---------------------------------------------------------------------------
 *
 * There is deliberately no list of suite names here. This repository has twice
 * paid for a second copy of a list: a duplicated public file set drifted 37
 * files with both gates green, and four gates shipped reachable only through a
 * script CI never ran. A list of the ten suites known to be affected in
 * 2026-08-07 would be green forever and would not see suite eleven.
 *
 * So the check WALKS `scripts/` and reads the source. Any call whose first
 * argument is the git binary — `"git"` or a path ending in `/git`, in any
 * quoting, on the same line or the next — is a finding, whatever the function
 * is called. That catches `execFileSync`, `spawnSync`, a promisified
 * `execFileAsync`, and a local `run()` wrapper somebody adds tomorrow, because
 * it matches on the ARGUMENT rather than on the caller.
 *
 * ONE FILE IS EXEMPT, and it is derived from what it is rather than named as a
 * policy: the wrapper module has to name the binary, because wrapping it is its
 * whole job. Everything else, test and gate alike, goes through it. This file
 * scans itself and passes, which is why it is not exempt.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(import.meta.dirname, "..");

/** The directory this gate governs. */
export const SCANNED_DIRECTORY = "scripts";

/** The wrapper. The only file allowed to name the binary, because it is it. */
export const WRAPPER_MODULE = "isolated-git.mjs";

/** What a caller should be using instead, named in the failure message. */
export const WRAPPERS = ["gitSync", "gitSpawn", "gitAsync", "isolatedEnvironment"];

export class GitIsolationError extends Error {
  constructor(message) {
    super(message);
    this.name = "GitIsolationError";
  }
}

/**
 * A call whose first argument is the git binary.
 *
 * `[\w$.]*` so `child_process.execFileSync` is caught as readily as a bare
 * name. `\s*` spans newlines, so the multi-line form several gates here use —
 * the function on one line and the command on the next — is not a way past it.
 * The optional leading path segment catches an absolute `/usr/bin/git`.
 */
const BINARY_CALL = /([A-Za-z_$][\w$.]*)\s*\(\s*(["'`])(?:[^"'`\n]*\/)?git\2\s*,/g;

/** Every `.mjs` file under a directory, in a stable order. */
export function moduleFiles(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".mjs") || entry.endsWith(".js")) found.push(path);
    }
  };
  walk(directory);
  return found;
}

/** Every raw git spawn in one file's source, as `{ line, column, callee }`. */
export function rawGitCalls(source) {
  const findings = [];
  for (const match of source.matchAll(BINARY_CALL)) {
    const before = source.slice(0, match.index);
    const line = before.split("\n").length;
    findings.push({
      line,
      callee: match[1],
      text: match[0].replace(/\s+/g, " ").trim(),
    });
  }
  return findings;
}

/**
 * Every file under `scripts/` that spawns git without the wrapper. Returns
 * `{ file, line, callee, text }` entries, sorted, so a caller can print them.
 */
export function findRawGitSpawns(repositoryRoot = REPO_ROOT) {
  const directory = resolve(repositoryRoot, SCANNED_DIRECTORY);
  const findings = [];
  for (const path of moduleFiles(directory)) {
    if (path.endsWith(`/${WRAPPER_MODULE}`)) continue;
    for (const call of rawGitCalls(readFileSync(path, "utf8"))) {
      findings.push({ file: relative(repositoryRoot, path), ...call });
    }
  }
  return findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.line - right.line,
  );
}

export function assertGitIsolation(repositoryRoot = REPO_ROOT) {
  const findings = findRawGitSpawns(repositoryRoot);
  if (findings.length === 0) return findings;
  const detail = findings
    .map(({ file, line, callee, text }) => `  ${file}:${line}  ${callee}  ${text}`)
    .join("\n");
  throw new GitIsolationError(
    `${findings.length} raw git spawn(s) under ${SCANNED_DIRECTORY}/:\n${detail}\n` +
      `Spawn git through ${SCANNED_DIRECTORY}/${WRAPPER_MODULE} instead ` +
      `(${WRAPPERS.join(", ")}). A raw spawn inherits the pre-push hook's ` +
      `GIT_DIR and writes to the developer's repository.`,
  );
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isMain()) {
  try {
    const scanned = moduleFiles(resolve(REPO_ROOT, SCANNED_DIRECTORY)).length;
    assertGitIsolation();
    console.log(
      `Git isolation policy passed: ${scanned} module(s) under ` +
        `${SCANNED_DIRECTORY}/, every git spawn goes through ${WRAPPER_MODULE}`,
    );
  } catch (error) {
    console.error(
      error instanceof GitIsolationError
        ? `Git isolation policy failed: ${error.message}`
        : "Git isolation policy failed",
    );
    process.exitCode = 1;
  }
}

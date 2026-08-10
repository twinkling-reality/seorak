#!/usr/bin/env node

/**
 * Refuse control bytes that make a text file unreadable to text tools.
 *
 * A single raw NUL byte makes a source file BINARY to grep, `file`, and every
 * text-based audit, so a symbol search over that module silently returns
 * nothing and the code reads as absent. `tsc` never notices, tests never
 * notice, and review never notices, because the file looks completely normal in
 * an editor. Four sites of this cost three separate sessions real time: one
 * reported a symbol as undefined when it was there, and two concluded a
 * function did not exist when it did.
 *
 * The fix at each site is to write the escape (`\0`) instead of the byte, which
 * is byte-identical at runtime. This check exists because nothing else in the
 * pipeline can see the difference.
 *
 * Scoped to text source extensions. Genuinely binary assets are excluded by
 * extension rather than by content sniffing, so a new binary type must be added
 * here deliberately instead of being silently tolerated.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { gitSpawn } from "./isolated-git.mjs";

const DEFAULT_ROOTS = ["packages", "apps", "scripts", "docs", "tests"];

/** Text formats where a control byte is always a mistake. */
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".sql",
  ".md",
  ".css",
  ".html",
  ".swift",
  ".toml",
  ".yml",
  ".yaml",
  ".sh",
  ".txt",
]);

/**
 * Fallback only. The primary file list comes from git, so ignore rules are
 * whatever `.gitignore` already says rather than a second copy of them here. A
 * hand-maintained skip list is the kind that rots: it needs an entry for every
 * new build directory, and the first thing a noisy check loses is credibility.
 */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".wrangler",
  "coverage",
  ".expo",
  "test-results",
  "Pods",
]);

/**
 * Every C0 control plus DEL, except tab, newline, and carriage return.
 *
 * The rule is about the ENCODING, not the character. Choosing NUL or Unit
 * Separator as a key separator is good design precisely because neither can
 * occur in an ISO instant, a session id, an agent name, or a tool name. Writing
 * that choice as a raw byte instead of an escape is what breaks things: the
 * escape is the identical character at runtime and leaves the file readable by
 * every text tool. So this forbids the byte and permits the escape.
 *
 * The range is complete rather than a hand-picked list, because a subset is a
 * gate with a hole in it. The one file that used a raw `0x1f` was invisible to
 * a NUL-only check for exactly the reason the check exists.
 */
const CONTROL_BYTE_NAMES = [
  "NUL", "SOH", "STX", "ETX", "EOT", "ENQ", "ACK", "BEL",
  "BS", "HT", "LF", "VT", "FF", "CR", "SO", "SI",
  "DLE", "DC1", "DC2", "DC3", "DC4", "NAK", "SYN", "ETB",
  "CAN", "EM", "SUB", "ESC", "FS", "GS", "RS", "US",
];

/** Structural whitespace, which is what a text file is made of. */
const ALLOWED_BYTES = new Set([0x09, 0x0a, 0x0d]);

const FORBIDDEN_BYTES = new Map([
  ...CONTROL_BYTE_NAMES.flatMap((name, byte) =>
    ALLOWED_BYTES.has(byte) ? [] : [[byte, name]],
  ),
  [0x7f, "DEL"],
]);

function normalizePath(path) {
  return path.split(sep).join("/");
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIP_DIRECTORIES.has(entry.name) ? [] : walk(join(directory, entry.name));
    }
    return entry.isFile() ? [join(directory, entry.name)] : [];
  });
}

/** Every forbidden byte in one buffer, reported with a 1-based line number. */
export function scanBuffer(buffer) {
  const issues = [];
  let line = 1;
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte === 0x0a) {
      line += 1;
      continue;
    }
    const name = FORBIDDEN_BYTES.get(byte);
    if (name !== undefined) {
      issues.push({ line, byte, name });
    }
  }
  return issues;
}

/**
 * Files git knows about: tracked, plus untracked that are not ignored. This is
 * the authority for what "source" means, so build output and scratch cannot
 * trip the check and no second ignore list has to be maintained. Returns null
 * outside a repository, where the directory walk takes over.
 */
function gitTrackedFiles(root) {
  const result = gitSpawn(
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0 || result.error) return null;
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry !== "")
    .map((entry) => join(root, entry));
}

export function scanSourceBytes({ repoRoot, roots = DEFAULT_ROOTS } = {}) {
  const root = resolve(
    repoRoot ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const tracked = gitTrackedFiles(root);
  const candidates =
    tracked ??
    roots.flatMap((sourceRoot) => {
      const base = resolve(root, sourceRoot);
      if (!existsSync(base)) return [];
      return statSync(base).isDirectory() ? walk(base) : [base];
    });

  const issues = [];
  for (const path of candidates) {
    if (!TEXT_EXTENSIONS.has(extname(path))) continue;
    if (!existsSync(path)) continue;
    for (const issue of scanBuffer(readFileSync(path))) {
      issues.push({ path: normalizePath(relative(root, path)), ...issue });
    }
  }
  return issues.sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.byte - b.byte,
  );
}

function formatIssue(issue) {
  return `${issue.path}:${issue.line} contains a raw ${issue.name} byte (0x${issue.byte
    .toString(16)
    .padStart(2, "0")}); write the escape instead`;
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isMain()) {
  const issues = scanSourceBytes();
  if (issues.length > 0) {
    console.error(
      `Source byte check failed (${issues.length} issue${issues.length === 1 ? "" : "s"}):`,
    );
    issues.forEach((issue) => console.error(`- ${formatIssue(issue)}`));
    console.error(
      "\nA raw control byte makes the whole file binary to grep and every text audit.\n" +
        "Do not fix it through a shell heredoc: the terminal turns the escape back\n" +
        "into the byte. Edit the file directly, or use a script that writes bytes.",
    );
    process.exitCode = 1;
  } else {
    console.log("Source byte check passed.");
  }
}

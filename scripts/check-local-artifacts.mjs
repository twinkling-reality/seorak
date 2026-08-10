#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { gitAsync } from "./isolated-git.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..");

/**
 * Root-local tool state is never repository source. Several of these tools can
 * retain browser sessions, account metadata, generated reports, or local
 * databases, so a forced `git add` must still fail even when .gitignore is
 * bypassed.
 */
const LOCAL_STATE_ROOTS = new Map([
  [".devstack", "local development tool state"],
  [".orchescope", "local audit tool state"],
  [".yummycode", "local session tool state"],
  [".port", "local design scratch"],
  [".playwright-mcp", "local browser session state"],
  [".wrangler", "local Cloudflare state"],
  [".cf", "local Cloudflare state"],
]);

export class LocalArtifactPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "LocalArtifactPolicyError";
  }
}

function normalizeRepoPath(path) {
  return path.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
}

function isSecretArtifactName(name) {
  if (/^\.env(?:\..+)?$/i.test(name)) {
    return !/\.(?:example|sample|template)$/i.test(name);
  }
  if (/^\.dev\.vars(?:\..+)?$/i.test(name)) {
    return !/\.(?:example|sample|template)$/i.test(name);
  }
  return /\.(?:p8|pem|key|p12)$/i.test(name);
}

/**
 * Classify using the repository-relative path only. This guard never opens,
 * hashes, scans, or logs a candidate file.
 */
export function localArtifactCategory(path) {
  const normalized = normalizeRepoPath(path);
  if (!normalized) return null;

  const [root] = normalized.split("/");
  const rootCategory = LOCAL_STATE_ROOTS.get(root);
  if (rootCategory) return rootCategory;

  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (isSecretArtifactName(basename)) return "local secret configuration";
  return null;
}

export function parseNulPaths(stdout) {
  return stdout.split("\0").filter(Boolean);
}

/**
 * Return category counts rather than matching paths. A failure tells the
 * operator what kind of state reached the index without echoing machine/session
 * identifiers into CI logs.
 */
export function summarizeLocalArtifacts(paths) {
  const unique = new Set(paths.map(normalizeRepoPath).filter(Boolean));
  const counts = new Map();
  for (const path of unique) {
    const category = localArtifactCategory(path);
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return new Map([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

async function runGit(args, cwd = REPO_ROOT) {
  const { stdout } = await gitAsync(args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

/**
 * Inspect Git's index only. Untracked local state is handled by .gitignore; the
 * staged query is retained explicitly so the policy remains clear for pre-commit
 * use even though staged additions also appear in `git ls-files --cached`.
 */
export async function indexedRepositoryPaths(options = {}) {
  const run = options.runGit ?? runGit;
  const cwd = options.cwd ?? REPO_ROOT;
  const [tracked, staged] = await Promise.all([
    run(["ls-files", "--cached", "-z"], cwd),
    run(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], cwd),
  ]);
  return [...parseNulPaths(tracked), ...parseNulPaths(staged)];
}

export async function checkLocalArtifacts(options = {}) {
  let paths;
  try {
    paths = await (options.loadPaths ?? indexedRepositoryPaths)(options);
  } catch {
    throw new LocalArtifactPolicyError(
      "Unable to enumerate tracked and staged repository paths",
    );
  }

  const counts = summarizeLocalArtifacts(paths);
  if (counts.size === 0) return { categories: 0, files: 0 };

  const files = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const summary = [...counts]
    .map(([category, count]) => `${category}: ${count}`)
    .join("; ");
  throw new LocalArtifactPolicyError(
    `Local artifact policy rejected ${files} tracked/staged file(s) (${summary}). ` +
      "Remove them from the Git index without deleting local user state.",
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkLocalArtifacts()
    .then(() => {
      console.log("Local artifact policy passed");
    })
    .catch((error) => {
      const message =
        error instanceof LocalArtifactPolicyError
          ? error.message
          : "Local artifact policy failed";
      console.error(message);
      process.exitCode = 1;
    });
}

/**
 * repo-shape.ts — derive the coarse SHAPE of a repo ON-MACHINE (CAPTURE-FOUNDATION
 * ADR-CF7): is it a monorepo, its size band, its age band. BANDS ONLY — never a raw
 * file count or commit date, so it conditions outcomes (outcome | repo-shape)
 * without pinning an exact repo. Every git call is guarded (bounded timeout,
 * fault-soft) and every fs read size-capped; an underivable facet omits the whole
 * shape (honest-empty, never a guessed band). Runs at session-start on the momentum
 * path only, never on the tool.call hot path.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RepoAgeBand, RepoShape, RepoSizeBand } from "@seorak/types";

/** Hard ceiling on any single git call (mirrors git.ts GIT_TIMEOUT_MS). */
const GIT_TIMEOUT_MS = 2_000;
const MARKER_MAX_BYTES = 512 * 1024;

/** Guarded git read → trimmed stdout, or null on ANY failure (non-zero, timeout,
 *  signal, missing binary, throw). Self-contained so this module never couples to
 *  git.ts's private reader, which is why the GIT_* scrub is repeated here rather
 *  than imported: git/runner.ts is a git-layer internal and importing it from
 *  outside git/ is what split-module-boundary.test.ts exists to refuse. */
function gitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) delete environment[name];
  }
  return environment;
}

function git(cwd: string, args: string[]): string | null {
  try {
    const res = spawnSync("git", args, {
      cwd,
      env: gitEnvironment(),
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (res.error || res.signal) return null;
    if (typeof res.status !== "number" || res.status !== 0) return null;
    return (res.stdout ?? "").trim();
  } catch {
    return null;
  }
}

/** Read a small marker file (size-capped, fault-soft), or null. */
function readMarker(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    if (statSync(path).size > MARKER_MAX_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Monorepo iff a workspace marker is present (existsSync) or a manifest declares
 *  workspaces. Content read only to match a closed shape, then discarded. */
function detectMonorepo(cwd: string): boolean {
  for (const f of ["pnpm-workspace.yaml", "lerna.json", "turbo.json", "nx.json", "go.work"]) {
    try {
      if (existsSync(join(cwd, f))) return true;
    } catch {
      // fs error → treat as absent
    }
  }
  const pkg = readMarker(join(cwd, "package.json"));
  if (pkg) {
    try {
      if ((JSON.parse(pkg) as { workspaces?: unknown }).workspaces !== undefined) return true;
    } catch {
      // malformed → not a workspace by this signal
    }
  }
  const cargo = readMarker(join(cwd, "Cargo.toml"));
  if (cargo && /^\s*\[workspace\]/m.test(cargo)) return true;
  return false;
}

/** Distinct tracked-file count → size band, or null when `ls-files` is unavailable. */
function detectSizeBand(cwd: string): RepoSizeBand | null {
  const out = git(cwd, ["ls-files"]);
  if (out === null) return null;
  const count = out.length === 0 ? 0 : out.split("\n").length;
  if (count < 50) return "xs";
  if (count < 200) return "s";
  if (count < 1_000) return "m";
  if (count < 5_000) return "l";
  return "xl";
}

/** Root-commit age → age band, or null when there is no root commit / not a repo. */
function detectAgeBand(cwd: string): RepoAgeBand | null {
  const out = git(cwd, ["log", "--max-parents=0", "--format=%ct"]);
  if (out === null || out.length === 0) return null;
  // A repo can have multiple roots (merged histories); the EARLIEST is its age.
  let earliest = Number.POSITIVE_INFINITY;
  for (const line of out.split("\n")) {
    const ts = Number.parseInt(line.trim(), 10);
    if (Number.isFinite(ts) && ts < earliest) earliest = ts;
  }
  if (!Number.isFinite(earliest)) return null;
  const ageDays = (Date.now() / 1000 - earliest) / 86_400;
  if (ageDays < 30) return "new";
  if (ageDays < 180) return "recent";
  if (ageDays < 730) return "established";
  return "mature";
}

/**
 * deriveRepoShape(cwd) — the coarse repo shape, or undefined when it cannot be
 * fully derived (not a repo, no commits, git unavailable). All three facets are
 * required so a partial shape is never emitted.
 */
export function deriveRepoShape(cwd: string): RepoShape | undefined {
  // Gate: not inside a work tree → no shape.
  if (git(cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") return undefined;
  const sizeBand = detectSizeBand(cwd);
  const ageBand = detectAgeBand(cwd);
  if (sizeBand === null || ageBand === null) return undefined;
  return { monorepo: detectMonorepo(cwd), sizeBand, ageBand };
}

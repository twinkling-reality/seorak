/**
 * git/momentum.ts — the lockfile-aware NET-change momentum capture (Capture
 * Roadmap Phase 1, item 4 + 5) and the three env resolvers that configure it.
 *
 * PRIVACY: this module reads the working tree but NEVER returns or emits a path, a
 * diff, a commit message, or any code text. Callers receive COUNTS + enums + a
 * salted repo id + a basename-only label. A non-git cwd resolves to "no-repo" /
 * null, which gates the momentum event out entirely (honest-empty, never a silent
 * zero).
 */
import type { GitMomentumEvent } from "@seorak/types";
import { captureSettings } from "../capture-settings.ts";
import { deriveRepoShape } from "../repo-shape.ts";
import { repoIdentity } from "./identity.ts";
import { compileIgnore, DEFAULT_IGNORE_GLOBS, parseNumstatLine } from "./numstat.ts";
import { gitContext } from "./repo-state.ts";
import { git } from "./runner.ts";

export interface MomentumCounts {
  windowDays: number;
  commits: number;
  filesTouched: number;
  linesAdded: number;
  linesDeleted: number;
  generatedLinesExcluded: number;
}

/**
 * captureMomentum(cwd, opts) — a lockfile-aware NET-change counts object, or
 * null when cwd is not a git repo (honest-empty gate).
 *
 * Reads `git log --since="<windowDays> days ago" --numstat --pretty=format:%H`
 * (guarded). filesTouched = distinct NON-ignored paths; linesAdded/Deleted =
 * summed over NON-ignored files; generatedLinesExcluded = added+deleted over
 * IGNORED files; commits = count of %H lines in the window.
 *
 * COUNTS ONLY — no path, no diff, no message ever leaves this function.
 */
export function captureMomentum(
  cwd: string,
  opts: { windowDays: number; ignoreGlobs: string[] },
): MomentumCounts | null {
  // Gate: not a repo -> null, never a zero-filled object.
  if (git(cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") return null;

  const windowDays = opts.windowDays;
  const out = git(cwd, [
    "log",
    `--since=${windowDays} days ago`,
    "--numstat",
    "--no-color",
    "--pretty=format:%H",
  ]);
  if (out === null) return null;

  const isIgnored = compileIgnore(opts.ignoreGlobs);
  const touched = new Set<string>();
  let commits = 0;
  let linesAdded = 0;
  let linesDeleted = 0;
  let generatedLinesExcluded = 0;

  for (const line of out.split("\n")) {
    if (line.length === 0) continue;
    const stat = parseNumstatLine(line);
    if (stat === null) {
      // A %H commit-hash line (40 hex chars) or a degenerate line. Count commit
      // hashes; ignore anything else.
      if (/^[0-9a-f]{7,40}$/.test(line)) commits += 1;
      continue;
    }
    if (isIgnored(stat.path)) {
      generatedLinesExcluded += stat.added + stat.deleted;
      continue;
    }
    touched.add(stat.path);
    linesAdded += stat.added;
    linesDeleted += stat.deleted;
  }

  return {
    windowDays,
    commits,
    filesTouched: touched.size,
    linesAdded,
    linesDeleted,
    generatedLinesExcluded,
  };
}

/** Whether momentum/git capture is on. The local env is the explicit word and
 *  wins (SEORAK_MOMENTUM=0 disables entirely, any other set value forces on);
 *  with no env set, the Data & capture toggle (worker-served, locally cached
 *  by the daemon — see capture-settings.ts) decides. Defaults-on. */
export function momentumEnabled(): boolean {
  const env = process.env.SEORAK_MOMENTUM;
  if (env !== undefined) return env !== "0";
  return captureSettings().gitMomentum;
}

/** Trailing window in days (SEORAK_MOMENTUM_WINDOW_DAYS, default 7). A bad value
 *  falls back to the default rather than throwing. */
export function momentumWindowDays(): number {
  const raw = process.env.SEORAK_MOMENTUM_WINDOW_DAYS;
  if (!raw) return 7;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/** The effective ignore-glob set: defaults plus any comma-separated entries from
 *  SEORAK_MOMENTUM_IGNORE (appended, so defaults always apply). */
export function momentumIgnoreGlobs(): string[] {
  const extra = (process.env.SEORAK_MOMENTUM_IGNORE ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...DEFAULT_IGNORE_GLOBS, ...extra];
}

/**
 * buildGitMomentum(cwd, sessionId, eventId, at) — assemble a publish-safe
 * GitMomentumEvent, or undefined when momentum is disabled, cwd is "no-repo",
 * identity is unresolvable, or the counts cannot be read. COUNTS + ids/enum
 * only; no path field exists on the event by construction.
 */
export function buildGitMomentum(
  cwd: string,
  sessionId: string,
  eventId: string,
  at: string,
): GitMomentumEvent | undefined {
  if (!momentumEnabled()) return undefined;

  const context = gitContext(cwd);
  if (context === "no-repo") return undefined;

  const identity = repoIdentity(cwd);
  if (identity === null) return undefined;

  const counts = captureMomentum(cwd, {
    windowDays: momentumWindowDays(),
    ignoreGlobs: momentumIgnoreGlobs(),
  });
  if (counts === null) return undefined;

  // Coarse repo shape (bands only), derived + bucketed on-machine; absent when
  // underivable. Bounded + fail-soft, session-start only (not the tool.call path).
  const repoShape = deriveRepoShape(cwd);

  return {
    kind: "git.momentum",
    eventId,
    sessionId,
    at,
    repoId: identity.repoId,
    repoLabel: identity.repoLabel,
    gitContext: context,
    windowDays: counts.windowDays,
    commits: counts.commits,
    filesTouched: counts.filesTouched,
    linesAdded: counts.linesAdded,
    linesDeleted: counts.linesDeleted,
    generatedLinesExcluded: counts.generatedLinesExcluded,
    ...(repoShape !== undefined ? { repoShape } : {}),
  };
}

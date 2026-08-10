/**
 * git/history.ts — commit observation (HEAD-TO-HEAD: the daemon's commit watcher).
 * Walks newly-landed commits with per-file added-line counts, and seeds each path's
 * most recent commit time so a cold-start attribution is exact rather than merely
 * conservative.
 *
 * PRIVACY: shas and paths here are LOCAL ONLY. A sha is salted before it can ride an
 * event; the paths are used to derive salted file ids and as blame targets and never
 * reach an event.
 */
import { compileIgnore, parseNumstatLine, resolveNumstatPath, SENTINEL } from "./numstat.ts";
import { git, runGitStatus } from "./runner.ts";

/** One file's change inside an observed commit. LOCAL ONLY — the path is used to
 *  derive the salted fileId and as a blame target; it never reaches an event. */
export interface CommitFileChange {
  /** Repo-relative path the lines LIVE AT after this commit (i.e. the rename TARGET,
   *  since that is what blame reads at the tip). */
  path: string;
  /** Non-ignored lines this commit ADDED to this file. Line-survival is scoped to
   *  added-line persistence, so a file with 0 added lines carries no denominator and
   *  is dropped by the caller. */
  added: number;
}

/** A commit the watcher has newly observed. LOCAL ONLY: the sha is salted before it
 *  can ride an event, and the paths never leave the machine. */
export interface ObservedCommit {
  sha: string;
  /** AUTHOR time in epoch ms — when the work was MADE. Preserved across a rebase,
   *  unlike the committer date, so the attribution window stays tied to when the
   *  agent actually edited (HEAD-TO-HEAD ADR-H3). */
  at: number;
  files: CommitFileChange[];
}

/** Hard ceiling on commits a single watcher tick will attribute — bounds the per-tick
 *  cost after a long daemon outage or a big merge. The overflow is NOT silently
 *  dropped: the cursor advances only over what was processed, so the next tick picks
 *  up exactly where this one stopped. */
const COMMIT_WATCH_CAP = 500;

/**
 * commitsSince(cwd, cursorSha, ref, ignoreGlobs) — every NON-MERGE commit reachable
 * from `ref` but not from `cursorSha`, **oldest first**, with per-file ADDED line
 * counts. `null` when git could not be consulted (the caller leaves its cursor put
 * and retries). `[]` when nothing new has landed.
 *
 * - `cursorSha === null` (cold start) or an unresolvable cursor (history rewritten)
 *   falls back to a bounded `--since` window rather than walking all of history.
 * - Merge commits are excluded: they author no lines, and their numstat against the
 *   first parent would double-count the branch they merge.
 * - Rename detection is ON (`-M`), so a pure rename reports 0 added lines and drops
 *   out. That is correct and load-bearing: `git blame -M -C` at the tip traces moved
 *   lines back to the commit that ORIGINALLY wrote them, so counting a rename's lines
 *   as newly-authored would give the renaming session a denominator whose lines blame
 *   to someone else — its work would read as dead.
 * - Oldest-first is required by the attribution walk, which needs each file's PREVIOUS
 *   commit to bound the touch window.
 *
 * COUNTS + LOCAL paths/shas only; nothing here is emitted.
 */
export function commitsSince(
  cwd: string,
  cursorSha: string | null,
  ref: string,
  ignoreGlobs: string[],
  fallbackDays: number,
): ObservedCommit[] | null {
  // A cursor that no longer resolves (rebase, reset, fresh clone) must not walk all
  // of history — fall back to the bounded window and let idempotency sort it out.
  const cursorOk =
    cursorSha !== null &&
    /^[0-9a-f]{7,40}$/.test(cursorSha) &&
    runGitStatus(cwd, ["cat-file", "-e", `${cursorSha}^{commit}`]) === 0;

  const range = cursorOk ? [`${cursorSha}..${ref}`] : [ref, `--since=${fallbackDays} days ago`];
  const out = git(cwd, [
    "-c",
    "core.quotePath=false",
    "log",
    ...range,
    "--no-merges",
    "--numstat",
    "--no-color",
    "-M",
    "--pretty=format:@@@%H %at",
  ]);
  if (out === null) return null;

  const isIgnored = compileIgnore(ignoreGlobs);
  const commits: ObservedCommit[] = [];
  let current: ObservedCommit | null = null;

  for (const line of out.split("\n")) {
    if (line.startsWith(SENTINEL)) {
      const [sha, at] = line.slice(SENTINEL.length).split(" ");
      if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
        current = null;
        continue;
      }
      const seconds = Number.parseInt(at ?? "", 10);
      if (!Number.isFinite(seconds)) {
        current = null;
        continue;
      }
      current = { sha, at: seconds * 1000, files: [] };
      commits.push(current);
      continue;
    }
    if (line.length === 0 || current === null) continue;
    const stat = parseNumstatLine(line);
    if (stat === null) continue;
    const path = resolveNumstatPath(stat.path);
    if (isIgnored(path)) continue;
    // 0 added lines carries no survival denominator (a pure deletion, a pure rename,
    // or a binary file). Dropped here so it never reaches the attribution walk.
    if (stat.added === 0) continue;
    current.files.push({ path, added: stat.added });
  }

  // git log yields newest-first; the attribution walk needs oldest-first.
  commits.reverse();
  return commits.length > COMMIT_WATCH_CAP ? commits.slice(0, COMMIT_WATCH_CAP) : commits;
}

/**
 * seedLastCommitAt(cwd, sinceDays, untilDays, ignoreGlobs) — each non-ignored path's
 * most recent commit time (epoch ms) over the window `[now-sinceDays, now-untilDays)`.
 *
 * This is what makes a COLD-START attribution exact rather than merely conservative.
 * The walk bounds each file's touch window below by that file's PREVIOUS commit; on a
 * cold start no previous commit is known, so without this a file's window would open
 * all the way back and could charge an agent for a touch that had ALREADY been
 * committed. Seeding the commits in the ledger-retention span BEFORE the attribution
 * window closes that hole: a path missing from the seed provably has no commit inside
 * the ledger's horizon, so an open window below is then genuinely safe.
 *
 * `--name-only` (not `--numstat`): we need only paths and times here, which keeps the
 * output small enough for one guarded call even over a long span.
 * LOCAL ONLY — paths and times stay on this machine.
 */
export function seedLastCommitAt(
  cwd: string,
  sinceDays: number,
  untilDays: number,
  ignoreGlobs: string[],
): Record<string, number> | null {
  const out = git(cwd, [
    "-c",
    "core.quotePath=false",
    "log",
    `--since=${sinceDays} days ago`,
    `--until=${untilDays} days ago`,
    "--no-merges",
    "--name-only",
    "--no-color",
    "-M",
    "--pretty=format:@@@%at",
  ]);
  if (out === null) return null;

  const isIgnored = compileIgnore(ignoreGlobs);
  const seed: Record<string, number> = {};
  let at = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith(SENTINEL)) {
      const seconds = Number.parseInt(line.slice(SENTINEL.length), 10);
      at = Number.isFinite(seconds) ? seconds * 1000 : 0;
      continue;
    }
    if (line.length === 0 || at === 0) continue;
    const path = resolveNumstatPath(line);
    if (isIgnored(path)) continue;
    // git log is newest-first, so the FIRST time we see a path is its latest commit.
    if (seed[path] === undefined) seed[path] = at;
  }
  return seed;
}

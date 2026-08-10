/**
 * commit-watcher.ts — the daemon's COMMIT WATCHER (HEAD-TO-HEAD, Tier 2).
 *
 * It is what replaces `session.end` as the trigger for outcome attribution, and that
 * single change is what makes survival tool-independent:
 *
 *   BEFORE  session ends (a CLAUDE HOOK) → remember every commit in the session's
 *           window → blame later. Codex has no session end, so Codex had no outcomes.
 *   AFTER   a commit LANDS (a daemon git poll) → attribute its files to whichever
 *           agent edited them → blame later. Git does not care which tool wrote a line.
 *
 * The clock now starts when work LANDS rather than when a chat ENDS (ADR-H3), which is
 * both the more principled reading of "did this work last?" and, incidentally, the
 * thing that frees every future tool at once.
 *
 * Per registered repo (registry.ts already maps repoId → toplevel for the hourly
 * momentum sweep, so the watcher is free to ride the same registry):
 *
 *   1. walk the commits landed since our cursor           (git.commitsSince)
 *   2. attribute each (commit × file) to an agent          (attribution.attributeCommits)
 *   3. group the attributed files by the session that earned them
 *   4. advance the cursor
 *
 * The daemon then turns each credited session into an attribution-pending record
 * (survival.recordAttributionPending), which matures on ITS OWN commit clock and sweeps
 * into a `session.linesurvival` event. This module still emits nothing itself.
 *
 * PRIVACY: shas, branch names, and repo-relative paths live in this module and in its
 * local state file ONLY. Nothing here is emitted; the survival event that eventually
 * consumes it carries counts, closed enums, and salted ids.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type AttributionWalk,
  type CoverageTotals,
  type LastCommitAt,
  type SessionAttribution,
  attributeCommits,
  groupBySession,
} from "./attribution.ts";
import { fileIdentityForPath } from "./file-id.ts";
import { commitsSince, currentBranch, momentumIgnoreGlobs, seedLastCommitAt } from "./git.ts";
import { LEDGER_RETENTION_DAYS, type FileTouchLedger } from "./ledger.ts";
import { commitWatchStatePath } from "./paths.ts";
import { loadRegistry } from "./registry.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How far back a COLD start attributes. Deliberately modest: it is enough to populate
 *  the surface with real history the day the watcher first runs, without re-deriving a
 *  year of commits nobody is going to look at. */
export const COMMIT_BACKFILL_DAYS = 30;

/** How far back the cold-start SEED pass reaches BEFORE the backfill window, so every
 *  file's previous commit inside the ledger's touch horizon is known. Must be >= the
 *  ledger retention or the cold-start walk could charge an agent for an already-committed
 *  touch (see git.seedLastCommitAt). */
const SEED_LOOKBACK_DAYS = LEDGER_RETENTION_DAYS;

/** Drop `lastCommitAt` entries older than this so the state file cannot grow forever on
 *  deleted paths. Anything this old is past the ledger horizon, so its exact previous-commit
 *  time no longer changes any attribution. */
const LAST_COMMIT_RETENTION_DAYS = COMMIT_BACKFILL_DAYS + SEED_LOOKBACK_DAYS;

export interface RepoWatchState {
  /** The newest commit already attributed for this repo. LOCAL ONLY. null = cold. */
  cursorSha: string | null;
  /** Repo-relative path → epoch ms of its most recent observed commit. LOCAL ONLY.
   *  This is the bound that stops a touch already carried by an earlier commit from
   *  being charged to a later one, and it must persist because a file's consecutive
   *  commits routinely land on different daemon ticks. */
  lastCommitAt: LastCommitAt;
}

export interface CommitWatchState {
  version: 1;
  repos: Record<string, RepoWatchState>;
}

export function emptyWatchState(): CommitWatchState {
  return { version: 1, repos: {} };
}

/** Read the watch state, degrading to empty on a missing/corrupt/old-version file. An
 *  empty state is not a failure: the repo simply re-seeds and re-walks its backfill
 *  window, and the deterministic ids downstream make the re-walk a no-op. */
export function loadWatchState(): CommitWatchState {
  try {
    const path = commitWatchStatePath();
    if (!existsSync(path)) return emptyWatchState();
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CommitWatchState>;
    if (parsed.version !== 1 || !parsed.repos || typeof parsed.repos !== "object") {
      return emptyWatchState();
    }
    return { version: 1, repos: parsed.repos as Record<string, RepoWatchState> };
  } catch {
    return emptyWatchState();
  }
}

/** Persist atomically (tmp + rename) — a torn write would reset the cursor and force a
 *  needless re-walk. */
export function saveWatchState(state: CommitWatchState): void {
  try {
    const path = commitWatchStatePath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, path);
  } catch {
    // Local cursor; a write failure just re-walks next tick. Never throws into the loop.
  }
}

/** Drop `lastCommitAt` paths older than the retention horizon (deleted files, mostly).
 *  PURE. */
export function pruneLastCommitAt(map: LastCommitAt, nowMs: number): LastCommitAt {
  const floor = nowMs - LAST_COMMIT_RETENTION_DAYS * MS_PER_DAY;
  const kept: LastCommitAt = {};
  for (const [path, at] of Object.entries(map)) {
    if (at >= floor) kept[path] = at;
  }
  return kept;
}

/** What one repo's tick produced. Emitted by nobody — returned for the daemon to log and
 *  to turn into attribution-pending records. */
export interface RepoAttribution {
  repoId: string;
  repoLabel: string;
  /** LOCAL ONLY — the blame cwd. */
  toplevel: string;
  /** LOCAL ONLY — the branch HEAD was on when the work was observed, and so the PREFERRED
   *  blame ref. Null (detached HEAD) is not fatal: ADR-H0 then resolves the ref by
   *  CONTAINMENT, which is the honest question anyway ("does this work still exist?"). */
  branch: string | null;
  /** Sessions credited with landed work, each with its own maturation clock. */
  sessions: SessionAttribution[];
  /** The three-bucket coverage split over every committed line in this tick's window.
   *  `attributed + contested + unattributed` is the whole denominator: rendering an
   *  agent's line count WITHOUT this is claiming a completeness the capture does not have. */
  coverage: CoverageTotals;
  /** Commits walked this tick (including ones that attributed to nobody). */
  commitsWalked: number;
}

/**
 * sweepCommitAttribution(ledger, nowMs) — one watcher tick across every registered repo.
 *
 * Fail-soft per repo: a repo whose git cannot be consulted is SKIPPED with its cursor
 * left put, so it retries next tick rather than advancing over commits it never saw. A
 * repo that is no longer a repo is simply skipped (the momentum sweep is what prunes the
 * registry; the watcher does not own that).
 *
 * The returned state is NOT persisted here — the caller saves it, so a crash between
 * computing and acting leaves the cursor where it was and the tick simply repeats.
 */
export function sweepCommitAttribution(
  ledger: FileTouchLedger,
  nowMs: number,
  state: CommitWatchState = loadWatchState(),
): { results: RepoAttribution[]; state: CommitWatchState } {
  const ignore = momentumIgnoreGlobs();
  const registry = loadRegistry();
  const results: RepoAttribution[] = [];
  const next: CommitWatchState = { version: 1, repos: { ...state.repos } };

  // A touch older than the ledger's horizon cannot exist, so this is the natural floor
  // for any file whose previous commit we do not know.
  const windowFloorMs = nowMs - LEDGER_RETENTION_DAYS * MS_PER_DAY;

  for (const [repoId, entry] of Object.entries(registry)) {
    const prior = state.repos[repoId];
    const cold = prior === undefined;

    // COLD START: seed each file's previous-commit time across the ledger's horizon, so
    // the first walk is exact rather than merely conservative. A seed that cannot run
    // means git is unavailable — skip the repo entirely rather than attribute on a
    // window we know is wrong.
    let lastCommitAt: LastCommitAt;
    if (cold) {
      const seed = seedLastCommitAt(
        entry.toplevel,
        COMMIT_BACKFILL_DAYS + SEED_LOOKBACK_DAYS,
        COMMIT_BACKFILL_DAYS,
        ignore,
      );
      if (seed === null) continue; // git unavailable → retry next tick, cursor untouched
      lastCommitAt = seed;
    } else {
      lastCommitAt = prior.lastCommitAt ?? {};
    }

    const commits = commitsSince(
      entry.toplevel,
      cold ? null : (prior.cursorSha ?? null),
      "HEAD",
      ignore,
      COMMIT_BACKFILL_DAYS,
    );
    if (commits === null) continue; // transient git failure → cursor stays put

    const walk: AttributionWalk = attributeCommits(commits, {
      ledger,
      toplevel: entry.toplevel,
      windowFloorMs,
      fileIdOf: (absPath) => fileIdentityForPath(absPath, false).fileId,
      lastCommitAt,
    });

    // Advance the cursor only over what we actually walked. If the batch hit the
    // per-tick cap, the next tick resumes from here — bounded, never skipped.
    const newestSha = commits.length > 0 ? commits[commits.length - 1]!.sha : null;
    next.repos[repoId] = {
      cursorSha: newestSha ?? prior?.cursorSha ?? null,
      lastCommitAt: pruneLastCommitAt(walk.lastCommitAt, nowMs),
    };

    if (commits.length === 0) continue; // nothing landed; state still refreshed above

    results.push({
      repoId,
      repoLabel: entry.repoLabel,
      toplevel: entry.toplevel,
      branch: currentBranch(entry.toplevel),
      sessions: groupBySession(walk),
      coverage: walk.coverage,
      commitsWalked: commits.length,
    });
  }

  return { results, state: next };
}

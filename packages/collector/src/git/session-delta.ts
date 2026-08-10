/**
 * git/session-delta.ts — the session-bounded git delta (Capture Roadmap item 3):
 * the uncommitted working-tree counts, plus the LOCAL start cursor that lets
 * session end report what landed during the session.
 *
 * PRIVACY: the cursor holds a sha and a branch name, both LOCAL ONLY — the sha is
 * consumed for commit counting and the branch as a git ref at survival-sweep time.
 * Neither ever ships. The event carries COUNTS + enums only.
 */
import type { GitContext } from "@seorak/types";
import {
  deleteSessionCursor,
  readSessionCursor,
  writeSessionCursor,
} from "../session-cursors.ts";
import { momentumIgnoreGlobs } from "./momentum.ts";
import { compileIgnore, parseNumstatLine } from "./numstat.ts";
import { commitsBetween, currentBranch, gitContext, headSha } from "./repo-state.ts";
import { git } from "./runner.ts";

export interface UncommittedCounts {
  filesTouched: number;
  linesAdded: number;
  linesDeleted: number;
  generatedLinesExcluded: number;
}

/**
 * Counts of the uncommitted working-tree change at this moment: NET lines over
 * tracked modifications vs HEAD (`git diff --numstat HEAD`) plus a count of
 * untracked files, all behind the SAME lockfile/generated ignore-glob as
 * momentum (generated lines surfaced separately, never folded into the headline).
 * Null when cwd is not a repo. Paths are read for ignore-matching only, never
 * emitted.
 */
export function uncommittedCounts(
  cwd: string,
  ignoreGlobs: string[],
): UncommittedCounts | null {
  if (git(cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") return null;
  const isIgnored = compileIgnore(ignoreGlobs);
  const touched = new Set<string>();
  let linesAdded = 0;
  let linesDeleted = 0;
  let generatedLinesExcluded = 0;

  // Tracked changes vs HEAD (null when there is no HEAD yet — handled as zeros).
  const tracked = git(cwd, ["diff", "--numstat", "--no-color", "HEAD"]);
  if (tracked !== null) {
    for (const line of tracked.split("\n")) {
      if (line.length === 0) continue;
      const stat = parseNumstatLine(line);
      if (stat === null) continue;
      if (isIgnored(stat.path)) {
        generatedLinesExcluded += stat.added + stat.deleted;
        continue;
      }
      touched.add(stat.path);
      linesAdded += stat.added;
      linesDeleted += stat.deleted;
    }
  }

  // Untracked files: counted as touched (no cheap line count), ignore-filtered.
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  if (untracked !== null) {
    for (const path of untracked.split("\n")) {
      if (path.length === 0 || isIgnored(path)) continue;
      touched.add(path);
    }
  }

  return { filesTouched: touched.size, linesAdded, linesDeleted, generatedLinesExcluded };
}

interface SessionStartGit {
  startSha: string | null;
  startGitContext: GitContext;
  /** The branch HEAD was on at session start — LOCAL ONLY (a branch name is
   *  content and is NEVER emitted), used at survival-sweep time as the on-branch
   *  tip to measure line-survival against (OUTCOME-ATTRIBUTION ADR-OA1b). null
   *  when HEAD was detached at start, or for a cursor written before this shipped. */
  startBranch?: string | null;
}

/** Remember the start HEAD + git context + branch for `sessionId` in a LOCAL cursor
 *  (the sha + branch never ship). Best-effort: a write failure just means the end
 *  delta has no start reference (honest-empty), never a throw. */
export function writeSessionStartGit(sessionId: string, cwd: string): void {
  try {
    const record: SessionStartGit = {
      startSha: headSha(cwd),
      startGitContext: gitContext(cwd),
      startBranch: currentBranch(cwd),
    };
    writeSessionCursor("git", sessionId, JSON.stringify(record));
  } catch {
    // best-effort; absent cursor → uncommitted-only delta at end.
  }
}

function readSessionStartGit(sessionId: string): SessionStartGit | null {
  try {
    const raw = readSessionCursor("git", sessionId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionStartGit>;
    return {
      startSha: typeof parsed.startSha === "string" ? parsed.startSha : null,
      startGitContext: (parsed.startGitContext ?? "no-repo") as GitContext,
      startBranch: typeof parsed.startBranch === "string" ? parsed.startBranch : null,
    };
  } catch {
    return null;
  }
}

function clearSessionStartGit(sessionId: string): void {
  try {
    deleteSessionCursor("git", sessionId);
  } catch {
    // ignore — a leftover cursor is harmless and gets overwritten next start.
  }
}

export interface SessionDeltaCounts {
  gitContext: GitContext;
  startGitContext: GitContext;
  commitsLanded: number | undefined;
  headMoved: boolean;
  filesTouchedUncommitted: number;
  linesAddedUncommitted: number;
  linesDeletedUncommitted: number;
  generatedLinesExcludedUncommitted: number;
}

/**
 * Compute the session-bounded git delta at session end (reads + clears the start
 * cursor). Null when cwd is not a repo (honest-empty gate). `commitsLanded` is
 * undefined when the start HEAD was unknown or unresolvable — never a fabricated
 * 0. COUNTS + enums only; the cursor's sha is consumed for counting and discarded.
 */
export function captureSessionDelta(
  cwd: string,
  sessionId: string,
): SessionDeltaCounts | null {
  const endContext = gitContext(cwd);
  if (endContext === "no-repo") {
    clearSessionStartGit(sessionId);
    return null;
  }

  const start = readSessionStartGit(sessionId);
  const endSha = headSha(cwd);
  const uncommitted =
    uncommittedCounts(cwd, momentumIgnoreGlobs()) ?? {
      filesTouched: 0,
      linesAdded: 0,
      linesDeleted: 0,
      generatedLinesExcluded: 0,
    };

  let commitsLanded: number | undefined;
  let headMoved = false;
  if (start && start.startSha && endSha) {
    const between = commitsBetween(cwd, start.startSha, endSha);
    commitsLanded = between === null ? undefined : between;
    headMoved = start.startSha !== endSha;
  }

  clearSessionStartGit(sessionId);
  return {
    gitContext: endContext,
    startGitContext: start?.startGitContext ?? endContext,
    commitsLanded,
    headMoved,
    filesTouchedUncommitted: uncommitted.filesTouched,
    linesAddedUncommitted: uncommitted.linesAdded,
    linesDeletedUncommitted: uncommitted.linesDeleted,
    generatedLinesExcludedUncommitted: uncommitted.generatedLinesExcluded,
  };
}

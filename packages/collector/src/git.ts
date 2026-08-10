/**
 * git.ts — the SINGLE entry point to the collector's git layer.
 *
 * The implementation lives in `git/`, split at the seams the module actually has:
 *
 *   git/runner.ts        the only spawnSync in the collector; both guarded readers
 *   git/identity.ts      the machine salt, saltedHash, and the ledger-anchored repoId
 *   git/repo-state.ts    gitContext, toplevel, HEAD, branch names, commit counting
 *   git/numstat.ts       --numstat parsing + the generated-file ignore globs
 *   git/momentum.ts      the NET-change momentum capture and its env resolvers
 *   git/session-delta.ts uncommitted counts + the LOCAL session start cursor
 *   git/history.ts       the commit watcher's walk and its cold-start seed
 *   git/line-survival.ts blame-based on-branch survival
 *
 * This file is a re-export FACADE and holds no logic. Nothing outside `git/` may
 * import `git/*` directly — `test/split-module-boundary.test.ts` enforces that, so
 * there is exactly one path to every function here and no second working path.
 *
 * PRIVACY (unchanged by the split, and asserted per module): the git layer reads the
 * working tree but NEVER returns or emits a path, a diff, a commit message, or any
 * code text. Callers receive COUNTS + enums + a salted repo id + a basename-only
 * label. The only strings that leave this machine are `repoLabel` (the last path
 * segment) and the opaque `repoId` hash — never the absolute path, never the origin
 * url, never a branch name, never a raw sha.
 */
export { readOrCreateSalt, repoIdentity, repoIdentityOrCwd, saltedHash } from "./git/identity.ts";
export {
  commitsBetween,
  currentBranch,
  defaultBranch,
  gitContext,
  headSha,
  repoToplevel,
} from "./git/repo-state.ts";
export { resolveNumstatPath } from "./git/numstat.ts";
export {
  buildGitMomentum,
  captureMomentum,
  momentumEnabled,
  momentumIgnoreGlobs,
  momentumWindowDays,
  type MomentumCounts,
} from "./git/momentum.ts";
export {
  captureSessionDelta,
  type SessionDeltaCounts,
  type UncommittedCounts,
  uncommittedCounts,
  writeSessionStartGit,
} from "./git/session-delta.ts";
export {
  type CommitFileChange,
  commitsSince,
  type ObservedCommit,
  seedLastCommitAt,
} from "./git/history.ts";
export {
  type AttributedBlame,
  blameAttributedLines,
  captureAttributedSurvival,
  type LineSurvivalResult,
} from "./git/line-survival.ts";

/**
 * registry.ts — the local repo registry behind the daemon's commit-history
 * momentum sweep (Capture Roadmap item: cross-repo momentum incl. non-Claude
 * commits).
 *
 * The daemon is LOCAL, so it may keep a registry that maps each observed
 * `repoId` to its absolute toplevel path. The path lives ONLY here (a local JSON
 * file under collectorDir()) and is used solely as a git `cwd` — it is NEVER put
 * on an event. Only counts + the salted `repoId` + the basename label ship,
 * exactly like session-start momentum. Same trust boundary as the repo salt.
 *
 * Populated at session-start time (the session-start hook calls
 * `registerRepoFromCwd` with the raw cwd in hand, since the emitted session.start
 * no longer carries the absolute path) plus the user repo-config list, and swept
 * on a timer: each still-valid repo emits a `git.momentum` (reusing the same
 * `buildGitMomentum` path, including the lockfile filter + honest-empty gate);
 * paths that are no longer git repos are pruned.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { GitMomentumEvent } from "@seorak/types";
import { buildGitMomentum, gitContext, repoIdentity, repoToplevel } from "./git.ts";
import { reposConfigPath, reposRegistryPath } from "./paths.ts";

export interface RepoRegistryEntry {
  /** Absolute repo toplevel — LOCAL ONLY, used as a git cwd, never emitted. */
  toplevel: string;
  repoLabel: string;
  lastSeenAt: string;
}
export type RepoRegistry = Record<string, RepoRegistryEntry>;

/** The sessionId stamped on daemon-swept momentum events. Stable + synthetic: the
 *  worker reducer skips git.momentum and repoMomentum ignores sessionId, so this
 *  never pollutes per-session state — it just labels the provenance. */
const DAEMON_SESSION_ID = "daemon-momentum";

/** Read the registry, degrading to {} on a missing/corrupt file (never throws) —
 *  mirrors daemon.readOffset / git.readOrCreateSalt fault tolerance. */
export function loadRegistry(): RepoRegistry {
  try {
    const path = reposRegistryPath();
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as RepoRegistry) : {};
  } catch {
    return {};
  }
}

function saveRegistry(reg: RepoRegistry): void {
  try {
    const path = reposRegistryPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(reg), "utf8");
  } catch {
    // Local-only state; a write failure just means the sweep set is stale.
  }
}

/**
 * Upsert the repo containing `cwd` into the registry (no-op when cwd is not a
 * git repo). Idempotent — refreshes `lastSeenAt`. Called at session-start time
 * (from the hook, with the raw cwd in hand) and by the user repo-config path.
 */
export function registerRepoFromCwd(cwd: string, nowIso: string): void {
  const identity = repoIdentity(cwd);
  const toplevel = repoToplevel(cwd);
  if (!identity || !toplevel) return;
  const reg = loadRegistry();
  reg[identity.repoId] = {
    toplevel,
    repoLabel: identity.repoLabel,
    lastSeenAt: nowIso,
  };
  saveRegistry(reg);
}

/**
 * Sweep every registered repo: emit a `git.momentum` for each still-valid one
 * (reusing buildGitMomentum), and PRUNE entries whose path is no longer a git
 * repo (moved/deleted). Returns the events for the caller to append. Pruning is
 * gated on a DEFINITIVE `no-repo` (not a transient git failure), so a momentary
 * timeout never drops a live repo.
 */
export function sweepRegistryMomentum(nowIso: string): GitMomentumEvent[] {
  const reg = loadRegistry();
  const events: GitMomentumEvent[] = [];
  let changed = false;

  for (const [repoId, entry] of Object.entries(reg)) {
    if (gitContext(entry.toplevel) === "no-repo") {
      delete reg[repoId];
      changed = true;
      continue;
    }
    const event = buildGitMomentum(entry.toplevel, DAEMON_SESSION_ID, randomUUID(), nowIso);
    if (event) events.push(event);
  }

  if (changed) saveRegistry(reg);
  return events;
}

// ── Manual repo-add: user-maintained config list (LOCAL ONLY) ───────────────
//
// Closes the coverage gap where the registry was bootstrapped only from observed
// session.start cwds — a repo never touched by an instrumented session was never
// swept. The config list lets a user include un-instrumented repos in portfolio
// momentum. Absolute paths live ONLY in repos.config.json (used as a git cwd);
// only counts + salted repoId + basename label ever ship.

/** Read the user repo-config list (array of absolute toplevels), degrading to []
 *  on a missing/corrupt file — mirrors loadRegistry fault tolerance. */
export function loadConfigRepos(): string[] {
  try {
    const path = reposConfigPath();
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string" && p.length > 0);
  } catch {
    return [];
  }
}

function saveConfigRepos(paths: string[]): void {
  try {
    const path = reposConfigPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(paths, null, 2), "utf8");
  } catch {
    // Local-only state; a write failure just means the edit didn't persist.
  }
}

/**
 * Add an absolute repo path to the config list (idempotent) AND register it now.
 * Returns the resolved repo identity, or null when the path is not a git repo.
 * Used by the `seorak-collector repo add` CLI.
 */
export function addConfigRepo(
  cwd: string,
  nowIso: string,
): { repoId: string; repoLabel: string } | null {
  const abs = resolve(cwd);
  const identity = repoIdentity(abs);
  const toplevel = repoToplevel(abs);
  if (!identity || !toplevel) return null;
  const list = loadConfigRepos();
  if (!list.includes(toplevel)) {
    list.push(toplevel);
    saveConfigRepos(list);
  }
  registerRepoFromCwd(toplevel, nowIso);
  return identity;
}

/**
 * Remove a repo from the config list by basename label OR absolute path. Returns
 * the count removed. (The observed registry self-prunes on the next sweep when a
 * path is no longer a repo; this only edits the user list.)
 */
export function removeConfigRepo(labelOrPath: string): number {
  const list = loadConfigRepos();
  const target = resolve(labelOrPath);
  const kept = list.filter((p) => {
    const base = p.split("/").filter(Boolean).pop() ?? p;
    return p !== target && base !== labelOrPath;
  });
  if (kept.length !== list.length) saveConfigRepos(kept);
  return list.length - kept.length;
}

/**
 * Register every repo in the config list into the observed registry (no-op for
 * non-repos, already guarded in registerRepoFromCwd). Called by the daemon at
 * startup + each sweep so config edits are picked up without a restart.
 */
export function registerConfiguredRepos(nowIso: string): void {
  for (const toplevel of loadConfigRepos()) {
    registerRepoFromCwd(toplevel, nowIso);
  }
}

/**
 * A screenshot-safe listing of registered repos: basename label + a MASKED
 * repoId only. NEVER returns the absolute toplevel — even local CLI stdout must
 * not leak a path. Used by `seorak-collector repo list`.
 */
export function listRegisteredRepos(): { repoLabel: string; repoIdMasked: string }[] {
  const reg = loadRegistry();
  return Object.entries(reg).map(([repoId, entry]) => ({
    repoLabel: entry.repoLabel,
    repoIdMasked: `${repoId.slice(0, 8)}…`,
  }));
}

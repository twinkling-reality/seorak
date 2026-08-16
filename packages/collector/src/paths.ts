import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";

function canonicalProspectivePath(path: string): string {
  let cursor = path;
  const tail: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    tail.unshift(basename(cursor));
    cursor = parent;
  }
  const canonicalBase = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return join(canonicalBase, ...tail);
}

export function collectorDir(): string {
  const configured = process.env.SEORAK_DIR;
  const selected = configured ?? join(homedir(), ".seorak");
  if (!isAbsolute(selected)) {
    throw new Error("SEORAK_DIR must be an absolute path.");
  }
  const resolved = normalize(resolve(selected));
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) {
    throw new Error("SEORAK_DIR must not be a symbolic link.");
  }
  return normalize(canonicalProspectivePath(resolved));
}

/** The launchd service label `seorak setup` registers on macOS. */
export const LAUNCHD_LABEL = "app.seorak.collector";

/** Absolute path to the launchd plist for this user. */
export function launchAgentPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

export function eventsLogPath(): string {
  return join(collectorDir(), "events.jsonl");
}

/** Cross-process mutex for hook appends and acknowledged log rollover. */
export function eventsLogLockPath(): string {
  return join(collectorDir(), "events.lock");
}

/** Monotonic local generation used to disambiguate byte offsets after rollover. */
export function eventsLogGenerationPath(): string {
  return join(collectorDir(), "events.generation");
}

/** Fully acknowledged prior generation, present only across a rollover crash. */
export function acknowledgedEventsLogPath(generation: number): string {
  return join(collectorDir(), `events.acknowledged.${generation}.jsonl`);
}

/**
 * Immutable paths for one event-log operation. `SEORAK_DIR` is process-global
 * and tests, embedders, or future multi-profile callers can change it while an
 * append is waiting for the cross-process lock. Resolving once prevents a lock
 * acquired in one collector directory from guarding a write in another.
 */
export interface EventLogPathContext {
  directory: string;
  events: string;
  lock: string;
  generation: string;
  offset: string;
  rejectionCheckpoint: string;
  captureFailure: string;
}

export function resolveEventLogPathContext(
  directory: string = collectorDir(),
): EventLogPathContext {
  return {
    directory,
    events: join(directory, "events.jsonl"),
    lock: join(directory, "events.lock"),
    generation: join(directory, "events.generation"),
    offset: join(directory, "events.offset"),
    rejectionCheckpoint: join(directory, "events.rejections.json"),
    captureFailure: join(directory, "capture-failure.json"),
  };
}

export function acknowledgedEventLogPath(
  paths: EventLogPathContext,
  generation: number,
): string {
  return join(paths.directory, `events.acknowledged.${generation}.jsonl`);
}

export function offsetPath(): string {
  return join(collectorDir(), "events.offset");
}

/** Bounded, content-free classification checkpoint for rejected records. */
export function eventRejectionCheckpointPath(): string {
  return join(collectorDir(), "events.rejections.json");
}

export function deviceIdPath(): string {
  return join(collectorDir(), "device-id");
}

/** Mode-0600 hosted connection written by `seorak login`. */
export function connectionPath(): string {
  return join(collectorDir(), "connection.json");
}

/**
 * The credential that admits a request to the plane's non-loopback binding.
 *
 * A FILE rather than an environment variable, deliberately. Environment
 * variables surface in process listings, crash dumps, and service definitions,
 * and none of those can be checked; a mode-0600 file can be, and the plane
 * refuses to bind a routable socket behind one anybody else on the machine can
 * read. It is also rotatable in one command without editing the service.
 *
 * Absent by default and never created implicitly: an operator who has not run
 * `seorak remote credential` has not enabled remote access, and the daemon says
 * so rather than quietly binding. Honors SEORAK_DIR. Reasoning:
 * `docs/reference/self-hosted-plane-hardening.md`.
 */
export function selfHostedCredentialPath(
  directory: string = collectorDir(),
): string {
  return join(directory, "self-hosted-credential");
}

/**
 * Daemon liveness heartbeat (FOLLOW-UP #4). The running daemon rewrites this file
 * with the current epoch-ms on a fixed interval (and at startup / after each
 * ship), so `seorak status` can tell a LIVE daemon from a wedged one — launchd's
 * KeepAlive only restarts on process EXIT, never on a hang, so a stale heartbeat
 * is the only signal that the process is up but stuck. Honors SEORAK_DIR.
 */
export function heartbeatPath(): string {
  return join(collectorDir(), "heartbeat");
}

/** Content-free durable delivery health read by `seorak status`. */
export function shippingStatusPath(): string {
  return join(collectorDir(), "shipping-status.json");
}

/** launchd's combined stdout/stderr file for the collector daemon. */
export function daemonLogPath(): string {
  return join(collectorDir(), "daemon.log");
}

/** One recoverable prior generation retained by copy-truncate rotation. */
export function daemonLogArchivePath(): string {
  return join(collectorDir(), "daemon.log.1");
}

/**
 * Per-machine secret salt for git repoId hashing (git.ts:repoIdentity). Lives
 * under collectorDir() so it honors SEORAK_DIR — the test sandbox and any
 * relocated state dir get their own salt. Stored separately from device-id
 * because it is a hashing secret, not a shippable identifier: device-id is
 * emitted on every batch, the repo salt NEVER leaves the machine. Created lazily
 * (32 random bytes hex) on first momentum capture. TRADEOFF: the salt is
 * single-machine, so the same repo yields a stable id on this machine but a
 * different id elsewhere — intentional, to keep repoId non-correlatable across
 * machines and non-reversible to a path/origin.
 */
export function repoSaltPath(): string {
  return join(collectorDir(), "repo-salt");
}

/**
 * Transactional local cursor store shared by transcript usage and session git
 * state. One database replaces the old cursor-<sessionId>/gitcursor-<sessionId>
 * inode-per-session layout without deleting resume/idempotency evidence.
 */
export function sessionCursorDatabasePath(): string {
  return join(collectorDir(), "session-cursors.sqlite");
}

/**
 * Permanent local product history. Unlike events.jsonl, this database is never
 * reclaimed after hosted acknowledgement. It is the local-first source of
 * truth for reports, replay, export, and compact sync.
 */
export function localHistoryDatabasePath(
  directory: string = collectorDir(),
): string {
  return join(directory, "history.sqlite");
}

/** Machine-local AES-256 key for managed archive encryption. It is never sent
 * to the hosted service, which stores only opaque ciphertext. */
export function localArchiveKeyPath(
  directory: string = collectorDir(),
): string {
  return join(directory, "archive-key-v1");
}

/**
 * The repo-IDENTITY ledger (repo-identity.ts): the sticky map that keeps a
 * project's salted repoId STABLE across a git rename/transfer/protocol change, a
 * folder move, or a transient git-config read failure (iCloud eviction). It
 * anchors each repoId to its salted git root-commit key plus every origin url /
 * toplevel path seen, so a later change to any one of those resolves back to the
 * SAME id instead of silently minting a new one (the fragmentation bug).
 *
 * LOCAL ONLY (honors SEORAK_DIR): it holds normalized origin urls + absolute
 * toplevel paths as lookup anchors — none of which ship; only the opaque salted
 * repoId + basename label ever leave the machine. Versioned, and written atomically
 * (tmp + rename), like ledger.json.
 *
 * It is NOT a throwaway cache. Deleting it re-mints the LEGACY seed (origin else
 * path), which preserves the id of any repo still at its recorded origin/path — but
 * an entry that was disambiguated onto the `root:<rootKey>` seed, or a repo whose
 * origin url has changed since it was recorded, comes back with a DIFFERENT id and
 * its history splits. repo-identity.ts therefore quarantines an unusable file
 * (`repo-identity.json.unusable-<timestamp>`) instead of replacing it.
 */
export function repoIdentityLedgerPath(): string {
  return join(collectorDir(), "repo-identity.json");
}

/**
 * Local cache of the worker-served capture settings (Settings → Data &
 * capture). The daemon refreshes it on a slow poll (syncCaptureSettings); the
 * short-lived hook processes read it synchronously so a toggle flipped on the
 * web reaches every capture site without per-hook network calls. Absent /
 * corrupt reads as defaults-on (capture-settings.ts) — the cache can never
 * take capture down with it. Honors SEORAK_DIR.
 */
export function captureSettingsPath(
  directory: string = collectorDir(),
): string {
  return join(directory, "capture.json");
}

/**
 * The non-capture `/settings` families the local plane serves and the dashboard
 * writes (notifications, Live Activity, project themes, merges, archive). The
 * capture family deliberately stays in `capture.json` above, because the hook
 * processes already read that file on every event and a second copy of it would
 * be a second authority to drift. Local-only, honors SEORAK_DIR.
 */
export function localSettingsPath(
  directory: string = collectorDir(),
): string {
  return join(directory, "settings.json");
}

/**
 * Persisted terminal session preference (the `seorak` interactive session): the
 * overview window, versioned. It used to carry an ordered widget layout too;
 * that went with the widget grid. Local-only, honors SEORAK_DIR. Absent or
 * corrupt reads as the default (terminal/layout.ts), so a bad file can never
 * wedge the session.
 */
export function terminalLayoutPath(): string {
  return join(collectorDir(), "terminal-layout.json");
}

/**
 * The collector version whose release notes this machine has already been shown.
 * A bare version string, rewritten whenever the entry card is displayed, so a
 * note is shown ONCE per upgrade and never again.
 *
 * Its absence is also how the session tells a genuinely new install from one that
 * simply predates this file: absent AND nothing being captured is a first run,
 * absent WITH hooks already installed is an existing user, who gets the version
 * recorded silently rather than being welcomed to a product they already use.
 * Local-only, honors SEORAK_DIR.
 */
export function lastSeenVersionPath(): string {
  return join(collectorDir(), "last-seen-version");
}

/**
 * Local registry of git repos the daemon has observed (repoId → absolute
 * toplevel + label + lastSeen). Used ONLY by the local daemon to sweep momentum
 * across repos on a timer. The absolute paths live HERE and never leave the
 * machine — only counts + salted repoId + basename label ship. Honors SEORAK_DIR.
 */
export function reposRegistryPath(): string {
  return join(collectorDir(), "repos.json");
}

/**
 * User-maintained list of absolute repo toplevels to include in portfolio
 * momentum even when NO instrumented session ever ran there — closing the gap
 * where the registry was bootstrapped only from observed session.start cwds.
 * LOCAL ONLY (honors SEORAK_DIR): the paths live here and are used solely as a
 * git `cwd` by the daemon sweep; only counts + the salted repoId + the basename
 * label ever ship. Kept SEPARATE from repos.json (the daemon-managed observed
 * registry) so a user edit never collides with the daemon's auto-prune writes.
 */
export function reposConfigPath(): string {
  return join(collectorDir(), "repos.config.json");
}

/**
 * Per-session "survival-pending" cursor: the list of commit SHAs a session
 * landed, plus the repo identity + toplevel + branch + touched files + endedAt,
 * written at session.end so the daemon sweep can measure on-branch LINE survival
 * after a maturation window and emit a `session.linesurvival` COUNTS-only event.
 * Local-only (under collectorDir(), honors SEORAK_DIR): the SHAs, branch, and
 * absolute toplevel/paths live ONLY here and are NEVER emitted — only the COUNTS +
 * fate enum ship. Kept in a `survival/` subdir so the sweep can enumerate pending
 * entries cheaply. Pruned (by the daemon) AFTER the event is durably appended.
 */
export function survivalPendingDir(): string {
  return join(collectorDir(), "survival");
}

/**
 * The Codex tailer's persisted state (codex-tailer.ts): a `version` stamp plus
 * the activation timestamp plus, per rollout file, the byte cursor AND the
 * per-file session state (sessionId / startOffset / startEmitted / skip / the
 * token walk / the held tool calls). Cursor and state persist TOGETHER because
 * session.start idempotency across restarts depends on both. The version is
 * what keeps a future shape change from having to
 * choose between guessing and resetting, and a reset here loses real capture
 * (readState explains why). LOCAL ONLY — it holds absolute rollout paths as
 * keys; nothing in it ships. Written atomically (tmp + rename), the writeOffset
 * crash-safety move. Honors SEORAK_DIR.
 */
export function codexTailStatePath(): string {
  return join(collectorDir(), "codex-tail.json");
}

export function survivalPendingPath(sessionId: string): string {
  return join(survivalPendingDir(), `${sessionId}.json`);
}

/**
 * The daemon's FILE-TOUCH LEDGER (ledger.ts, HEAD-TO-HEAD ADR-H2): salted fileId →
 * the sessions that edited it and when, plus sessionId → agent, plus its own byte
 * cursor into the active events.jsonl generation.
 *
 * LOCAL ONLY, and local by construction rather than by policy: it holds nothing the
 * event log did not already hold, and the only identifiers in it are the salted
 * fileIds that already ship. Current and previous atomic checkpoints preserve the
 * projection after an acknowledged raw generation is reclaimed. Its cursor is
 * deliberately separate from the ship offset, so a failed ship cannot stall
 * attribution and vice versa. Honors SEORAK_DIR.
 */
export function ledgerPath(): string {
  return join(collectorDir(), "ledger.json");
}

/** Previous durable attribution checkpoint, used if the newest is torn/corrupt. */
export function ledgerBackupPath(): string {
  return join(collectorDir(), "ledger.previous.json");
}

/**
 * The commit watcher's per-repo state (commit-watcher.ts): the last attributed
 * commit sha, and each file's most recent observed commit time (which bounds the
 * touch window that decides who authored the next commit's lines).
 *
 * LOCAL ONLY — repo-relative paths and shas live here and NEVER ship; only the
 * derived counts + salted ids do. Written atomically. Honors SEORAK_DIR.
 */
export function commitWatchStatePath(): string {
  return join(collectorDir(), "commit-watch.json");
}

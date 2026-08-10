/**
 * git/identity.ts — the per-machine salt and every salted id derived from it.
 *
 * PRIVACY: the absolute path and the origin url are consumed ONLY as ledger anchors
 * and hash input. What leaves this module is the opaque `repoId` hash and the
 * basename-only `repoLabel` — never the absolute path, never the origin url.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { repoSaltPath } from "../paths.ts";
import {
  loadRepoIdentityLedger,
  type RepoDiscriminators,
  resolveIdentityPure,
  saveRepoIdentityLedger,
} from "../repo-identity.ts";
import { git } from "./runner.ts";

/**
 * Per-machine salt for repoId. Read-or-create 32 random bytes (hex) at
 * `repoSaltPath()` (under the collector dir, which honors SEORAK_DIR so tests
 * get a sandboxed salt). TRADEOFF: the salt is single-machine — the same repo
 * hashes to the SAME id across sessions on this machine, but to a DIFFERENT id
 * on another machine. That is intentional: it makes repoId stable for this
 * user's longitudinal view while keeping it non-correlatable across machines
 * and non-reversible to a path/origin. If the salt file is lost, ids rotate.
 */
export function readOrCreateSalt(): string {
  const path = repoSaltPath();
  try {
    if (existsSync(path)) {
      const existing = readFileSync(path, "utf8").trim();
      if (existing.length > 0) return existing;
    }
  } catch {
    // fall through to create
  }
  const salt = randomBytes(32).toString("hex");
  try {
    mkdirSync(dirname(path), { recursive: true });
    // Exclusive create ("wx" throws if the file already exists). Two processes
    // that both see no salt on a cold start would otherwise each generate one
    // and last-write-wins, so the loser would return a salt that is NOT the one
    // on disk and its ids would not survive a re-tail. With "wx", the first
    // writer wins and every loser falls through to read the winner's value, so
    // all processes on this machine converge on one salt and ids stay
    // deterministic across concurrent first runs. Machine-wide side-by-side
    // Codex + Claude capture is exactly this multi-process cold start.
    writeFileSync(path, salt, { encoding: "utf8", flag: "wx" });
    return salt;
  } catch {
    // Either another process won the create race between our existsSync and our
    // write, or we genuinely cannot persist. Prefer the persisted value if one
    // is now there; only fall back to the ephemeral salt if we cannot read it.
    try {
      const existing = readFileSync(path, "utf8").trim();
      if (existing.length > 0) return existing;
    } catch {
      // Cannot read back: fall back to an ephemeral salt for this process only.
      // repoId stays internally consistent within the run; it just will not be
      // stable across runs. Honest degradation, never a throw.
    }
  }
  return salt;
}

/**
 * saltedHash(seed) — a deterministic, machine-salted, non-reversible id for an
 * arbitrary seed, same salt + recipe as `repoId`. Used for DETERMINISTIC outcome
 * event ids (`saltedHash(sessionId|rung)`) so a re-emitted sweep collapses on the
 * D1 `event_id` PK for free (idempotent re-check). Stable across runs on this
 * machine, non-correlatable across machines, non-reversible.
 */
export function saltedHash(seed: string): string {
  return createHash("sha256").update(readOrCreateSalt()).update("\0").update(seed).digest("hex");
}

/** Normalize an origin url before hashing. Only case, a trailing ".git", and a
 *  trailing slash collapse; the scheme does NOT: https://, ssh://, and git@ scp
 *  forms of the same remote hash to three different repoIds, so changing a
 *  remote's transport ROTATES the id and silently splits the project history.
 *  Unifying the forms would rotate every existing repoId, which makes it a
 *  migration decision, not an edit here. */
function normalizeOriginUrl(url: string): string {
  let u = url.trim().toLowerCase();
  if (u.endsWith(".git")) u = u.slice(0, -4);
  if (u.endsWith("/")) u = u.slice(0, -1);
  return u;
}

/**
 * repoRootKey(cwd, salt) — the SALTED git root-commit key, the stable anchor that
 * survives a rename/transfer/transport change and a folder move (the root commit
 * is identical across every clone and every path). null when it cannot be trusted:
 *   - not readable / empty repo (no commits yet): `git()` returns null/"",
 *   - SHALLOW clone: the reachable "root" is the oldest FETCHED commit, not the
 *     true root, so it would differ full-vs-shallow — never key off a false root.
 * Multi-root repos (merged histories) sort their roots and take the min, so the
 * key is deterministic regardless of git's emit order.
 *
 * The raw SHA is salted immediately (same recipe as repoId) and NEVER persisted or
 * emitted raw — only the salted key lives in the local ledger.
 */
function repoRootKey(cwd: string, salt: string): string | null {
  if (git(cwd, ["rev-parse", "--is-shallow-repository"]) === "true") return null;
  const out = git(cwd, ["rev-list", "--max-parents=0", "HEAD"]);
  if (out === null || out.length === 0) return null;
  const roots = out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{7,40}$/.test(s));
  roots.sort();
  const root = roots[0];
  if (root === undefined) return null;
  return createHash("sha256").update(salt).update("\0").update("root:").update(root).digest("hex");
}

/** Read the git discriminators for a cwd (impure: runs git). `isRepo` is false for
 *  a non-git cwd, in which case the caller uses the cwd itself as the path anchor. */
function readDiscriminators(cwd: string, salt: string): RepoDiscriminators {
  const toplevel = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (toplevel === null || toplevel.length === 0) {
    return { isRepo: false, toplevel: null, origin: null, rootKey: null };
  }
  const originRaw = git(cwd, ["config", "--get", "remote.origin.url"]);
  const origin = originRaw !== null && originRaw.length > 0 ? normalizeOriginUrl(originRaw) : null;
  return { isRepo: true, toplevel, origin, rootKey: repoRootKey(cwd, salt) };
}

/** Resolve discriminators against the sticky ledger, persist any newly-learned
 *  anchor, and (when debugging) surface a degraded read rather than let it pass
 *  silently. The ledger is what makes the id survive rename/move/transient-failure
 *  instead of fragmenting. */
function resolveViaLedger(
  disc: RepoDiscriminators,
  cwd: string,
  salt: string,
): { repoId: string; repoLabel: string } {
  const loaded = loadRepoIdentityLedger();
  const res = resolveIdentityPure(disc, cwd, salt, loaded.ledger, Date.now());
  // `persistable` is false only when an UNUSABLE ledger could not be moved
  // aside, and writing over it would destroy the sole record of the old ids.
  if (loaded.persistable && res.changed) {
    saveRepoIdentityLedger(res.ledger);
  }
  if (res.degraded && process.env.SEORAK_DEBUG === "1") {
    // NOT-SILENT guard: a git repo whose stable root key was unreadable (iCloud
    // eviction / shallow clone) resolved via a weaker anchor. The ledger prevents
    // the old silent origin→path downgrade; this just makes the degraded read
    // visible when debugging. Gated so normal shallow/empty repos stay quiet.
    console.warn(
      `[seorak] repo-identity: root key unreadable for ${disc.toplevel ?? cwd}; resolved via ledger/legacy anchor`,
    );
  }
  return { repoId: res.repoId, repoLabel: res.repoLabel };
}

/**
 * repoIdentity(cwd) — { repoId, repoLabel } or null when cwd is not a git repo.
 *
 * The id is anchored to the salted git ROOT-COMMIT key via a per-machine ledger
 * (repo-identity.ts), so it stays STABLE across a GitHub rename/transfer, an
 * https↔ssh change, a folder move, or a transient unreadable `.git/config` — the
 * fragmentation the origin-else-path seed used to cause. On a repo's FIRST sighting
 * the id is minted from the LEGACY seed (origin else toplevel), byte-identical to
 * the pre-fix behavior, so upgrading rotates no existing id.
 *
 * The absolute path / origin url are consumed ONLY as ledger anchors + hash input
 * and are NEVER returned or emitted. repoLabel is the last path segment only.
 */
export function repoIdentity(cwd: string): { repoId: string; repoLabel: string } | null {
  const salt = readOrCreateSalt();
  const disc = readDiscriminators(cwd, salt);
  if (!disc.isRepo) return null;
  return resolveViaLedger(disc, cwd, salt);
}

/**
 * repoIdentityOrCwd(cwd) — ALWAYS resolves to { repoId, repoLabel } so a
 * session.start can identify its repo without ever emitting the absolute path.
 *
 * - In a git repo: identical to `repoIdentity` (ledger-anchored, root-key stable).
 * - In a NON-git cwd: the cwd is the path anchor; the id is minted from it (salted)
 *   and made sticky in the ledger so repeated access from the same cwd is stable.
 *
 * The absolute cwd / origin url are consumed ONLY as anchors + hash input; only the
 * opaque repoId and the basename-only repoLabel ever leave the machine. Never
 * returns null — the absolute path stays LOCAL but the event always carries both.
 */
export function repoIdentityOrCwd(cwd: string): { repoId: string; repoLabel: string } {
  const salt = readOrCreateSalt();
  const disc = readDiscriminators(cwd, salt);
  return resolveViaLedger(disc, cwd, salt);
}

/**
 * repo-identity.ts — the sticky, rename/move/iCloud-proof resolver for a repo's
 * salted `repoId`.
 *
 * THE BUG THIS FIXES: `repoIdentity` used to seed the id from the git origin url
 * (else the toplevel path). A GitHub rename/transfer or an https↔ssh change
 * rotates the origin, a folder move rotates the toplevel, and — worst — an
 * unreadable `.git/config` (iCloud "Optimize Storage" eviction) makes the origin
 * read come back empty, silently DOWNGRADING an origin-seeded id to a path-seeded
 * one. Every one of those mints a NEW id, fragmenting one project into multiple
 * cards.
 *
 * THE FIX: anchor the id to a STABLE fingerprint — the salted git ROOT-COMMIT key
 * — recorded in a per-machine ledger alongside every origin url and toplevel path
 * the repo has been seen at. Resolution consults the ledger by root key first,
 * then origin, then path, so a change to any single anchor resolves back to the
 * SAME repoId. There is NO silent downgrade: a repo whose origin (or even root
 * key) momentarily can't be read still resolves via its other recorded anchors.
 *
 * ZERO-ROTATION MIGRATION: on the FIRST sighting of a repo (empty ledger), the id
 * is minted from the LEGACY seed (origin if present, else path) — byte-identical
 * to the pre-fix `repoIdentity`. So upgrading rotates NOTHING; it only records the
 * anchors that keep the id stable from here on. That is only true of a ledger that
 * was never written: once entries exist, LOSING the ledger is NOT free (see the load
 * paragraph below).
 *
 * PRIVACY: origin urls and toplevel paths are stored ONLY in this local ledger as
 * lookup anchors and are NEVER emitted — only the opaque salted repoId + basename
 * label ship, exactly as before. The root SHA is salted before it is ever used as
 * a key; the raw SHA is never persisted or emitted.
 *
 * A LOAD FAULT IS NOT THE SAME AS A NEW INSTALL, and the difference is load-bearing.
 * An ABSENT ledger is a genuine new install: every repo re-mints its LEGACY id, so
 * nothing rotates (the paragraph above). A ledger that is PRESENT but unreadable,
 * unparseable, or of an unrecognized version is different in kind — an entry that
 * was disambiguated onto the `root:<rootKey>` seed, and any repo whose origin url
 * changed since it was first recorded, resolve to DIFFERENT ids against an empty
 * ledger. Treating those two cases alike would rotate ids AND then overwrite the
 * only file that could have recovered them. So an unusable file is moved aside to a
 * timestamped quarantine name (never deleted, never overwritten in place), the loss
 * is logged once, and when the move itself fails the caller is told not to persist
 * at all. `loadRepoIdentityLedger` reports which case happened; it still never
 * throws, because capture must survive a bad ledger.
 *
 * PROVENANCE (v2): an entry minted by this build records WHICH seed produced its id
 * and when it was first recorded, so a later maintainer can tell which ids are
 * re-derivable — a `path`- or `origin`-seeded id can be recomputed from the anchors
 * the ledger already holds, while a `root-key` one exists ONLY because the reuse
 * guard below fired and can never be re-derived from an origin or a path. Entries
 * created before provenance existed may omit it; inferring a scheme after the fact
 * would be a fabricated measurement.
 *
 * The core (`resolveIdentityPure`) is a PURE function of (discriminators, cwd, salt,
 * ledger, now) with no fs/git/clock, so it is exhaustively unit-testable; `git.ts`
 * supplies the discriminators and the clock, and this module supplies the fault-soft
 * load/save.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { repoIdentityLedgerPath } from "./paths.ts";

/** Current and only accepted on-disk schema. */
export const REPO_IDENTITY_LEDGER_VERSION = 2 as const;

/** Which seed `mint()` was given for an entry's repoId. Recorded so the reuse-guard
 *  decision below stays legible after the fact; NEVER an input to `mint()`, so it
 *  cannot change any id. */
export type RepoIdentityMintScheme = "origin" | "path" | "root-key";

/** One resolved project identity + the anchors that keep it stable. */
export interface RepoIdentityEntry {
  repoId: string;
  repoLabel: string;
  /** Salted git root-commit key — the strongest, rename/move-proof anchor. Absent
   *  for a repo whose root could not be read (empty/shallow/evicted) or a non-git
   *  dir. */
  rootKey?: string;
  /** Normalized origin urls this repo has been seen with (transport/rename change
   *  appends a new one; all resolve to this same id). */
  origins: string[];
  /** Toplevel (git) or cwd (non-git) paths this repo has been seen at (a move
   *  appends a new one). */
  toplevels: string[];
  /** Seed that minted `repoId`. Absent on a pre-provenance entry: unknown, not
   *  inferred. */
  mintScheme?: RepoIdentityMintScheme;
  /** Epoch ms this entry was first recorded. Absent on a pre-provenance entry for the same
   *  reason. */
  firstSeenAt?: number;
}

export interface RepoIdentityLedger {
  version: typeof REPO_IDENTITY_LEDGER_VERSION;
  entries: RepoIdentityEntry[];
}

/**
 * What the load found, so the caller can tell a NEW INSTALL from LOST HISTORY:
 *  - `absent`   — no file: genuine new install, the empty ledger is correct,
 *  - `loaded`   — a current-version file parsed,
 *  - `unusable` — present but corrupt/unparseable/unrecognized-version/wrong shape;
 *                 the bytes were quarantined (see `quarantinePath`) and resolution
 *                 continues from an empty ledger so capture keeps working.
 */
export type RepoIdentityLoadOutcome = "absent" | "loaded" | "unusable";

export interface RepoIdentityLedgerLoad {
  ledger: RepoIdentityLedger;
  outcome: RepoIdentityLoadOutcome;
  /** Malformed ENTRIES dropped from an otherwise usable ledger. Each one is a repo
   *  whose id may re-mint, so it is counted and warned about, not swallowed. */
  dropped: number;
  /** Where an unusable file's original bytes were preserved. Set only when
   *  `outcome` is `unusable` AND the move succeeded. */
  quarantinePath?: string;
  /** False ONLY when an unusable file could not be moved aside. Writing then would
   *  destroy the sole record of the historical ids, so the caller must not save. */
  persistable: boolean;
}

/** The git facts read from a cwd, or their absence. `isRepo` distinguishes "not a
 *  git repo" from "git repo whose root key we couldn't read" (the second is a
 *  degraded read, not a clean negative). */
export interface RepoDiscriminators {
  isRepo: boolean;
  /** git toplevel for a repo; null for a non-git cwd (the caller passes the cwd
   *  itself as the path anchor in that case). */
  toplevel: string | null;
  /** normalized origin url, or null when there is no remote / it was unreadable. */
  origin: string | null;
  /** salted root-commit key, or null when unreadable / empty / shallow. */
  rootKey: string | null;
}

export interface ResolvedIdentity {
  repoId: string;
  repoLabel: string;
  /** The ledger after resolution (same ref, possibly mutated, on a match; a new
   *  entries array on a mint). */
  ledger: RepoIdentityLedger;
  /** Whether the ledger changed and should be persisted. */
  changed: boolean;
  /** True when this is a git repo whose stable root key could not be read, so the
   *  resolution leaned on a weaker anchor (origin/path). The caller may surface
   *  this rather than let a degraded read pass silently. */
  degraded: boolean;
}

export function emptyRepoIdentityLedger(): RepoIdentityLedger {
  return { version: REPO_IDENTITY_LEDGER_VERSION, entries: [] };
}

function mint(salt: string, seed: string): string {
  return createHash("sha256").update(salt).update("\0").update(seed).digest("hex");
}

/**
 * Resolve a repo's identity against the ledger — PURE (no fs, no git). Priority:
 *   1. root key (stable across rename/move/transport) — strongest,
 *   2. origin url (guarded: never adopt an entry whose KNOWN root key differs from
 *      ours — that is a different repo that merely reused an origin/path),
 *   3. toplevel/cwd path (same root-key guard).
 * On a match, the entry adopts any newly-learned anchors (new origin/path, a root
 * key it lacked) and the freshest label. On no match, mint from the LEGACY seed
 * (origin else path) so existing ids never rotate, and record the anchors.
 *
 * A MATCHED entry is never given provenance it did not already have: back-filling a
 * scheme onto a pre-provenance entry would be a guess presented as a record. `nowMs` is passed
 * in rather than read from the clock so this stays pure and testable.
 */
export function resolveIdentityPure(
  disc: RepoDiscriminators,
  cwd: string,
  salt: string,
  ledger: RepoIdentityLedger,
  nowMs: number,
): ResolvedIdentity {
  const anchorPath = disc.toplevel ?? cwd;
  const label = basename(anchorPath);
  const degraded = disc.isRepo && disc.rootKey === null;

  // A candidate matched by a WEAK anchor is rejected when both sides know a root
  // key and they disagree — that is path/origin reuse by a genuinely different
  // repo, and merging them would be the inverse of the fragmentation bug.
  const rootConflicts = (e: RepoIdentityEntry): boolean =>
    disc.rootKey !== null && e.rootKey !== undefined && e.rootKey !== disc.rootKey;

  let match: RepoIdentityEntry | undefined;
  if (disc.rootKey !== null) {
    match = ledger.entries.find((e) => e.rootKey === disc.rootKey);
  }
  if (match === undefined && disc.origin !== null) {
    match = ledger.entries.find((e) => e.origins.includes(disc.origin as string) && !rootConflicts(e));
  }
  if (match === undefined) {
    match = ledger.entries.find((e) => e.toplevels.includes(anchorPath) && !rootConflicts(e));
  }

  if (match !== undefined) {
    let changed = false;
    if (disc.rootKey !== null && match.rootKey === undefined) {
      match.rootKey = disc.rootKey;
      changed = true;
    }
    if (disc.origin !== null && !match.origins.includes(disc.origin)) {
      match.origins.push(disc.origin);
      changed = true;
    }
    if (!match.toplevels.includes(anchorPath)) {
      match.toplevels.push(anchorPath);
      changed = true;
    }
    if (match.repoLabel !== label) {
      match.repoLabel = label;
      changed = true;
    }
    return { repoId: match.repoId, repoLabel: match.repoLabel, ledger, changed, degraded };
  }

  // No match — mint from the LEGACY seed (origin else path) for zero-rotation:
  // on a repo's first sighting (empty/clean ledger) this is byte-identical to the
  // pre-fix id, so upgrading rotates nothing.
  let repoId = mint(salt, disc.origin ?? anchorPath);
  let mintScheme: RepoIdentityMintScheme = disc.origin !== null ? "origin" : "path";
  // Path/origin REUSE guard: if that legacy id is already held by a DIFFERENT repo
  // (an entry with a conflicting root key — e.g. the old repo was deleted and a new
  // one cloned at the same path with no remote), disambiguate off our stable root
  // key so the two repos stay distinct instead of colliding on the shared seed.
  if (disc.rootKey !== null) {
    const clash = ledger.entries.find(
      (e) => e.repoId === repoId && e.rootKey !== undefined && e.rootKey !== disc.rootKey,
    );
    if (clash !== undefined) {
      repoId = mint(salt, `root:${disc.rootKey}`);
      mintScheme = "root-key";
    }
  }
  const entry: RepoIdentityEntry = {
    repoId,
    repoLabel: label,
    origins: disc.origin !== null ? [disc.origin] : [],
    toplevels: [anchorPath],
    mintScheme,
    firstSeenAt: nowMs,
  };
  if (disc.rootKey !== null) entry.rootKey = disc.rootKey;
  return {
    repoId,
    repoLabel: label,
    ledger: { version: REPO_IDENTITY_LEDGER_VERSION, entries: [...ledger.entries, entry] },
    changed: true,
    degraded,
  };
}

function isMintScheme(value: unknown): value is RepoIdentityMintScheme {
  return value === "origin" || value === "path" || value === "root-key";
}

/** Coerce raw entries defensively — a malformed entry is DROPPED, never trusted,
 *  and counted so the caller can say how many repos may re-mint. */
function coerceEntries(raw: unknown[]): {
  entries: RepoIdentityEntry[];
  dropped: number;
} {
  const entries: RepoIdentityEntry[] = [];
  let dropped = 0;
  for (const e of raw) {
    if (!e || typeof e !== "object") {
      dropped += 1;
      continue;
    }
    const r = e as Record<string, unknown>;
    if (typeof r.repoId !== "string" || typeof r.repoLabel !== "string") {
      dropped += 1;
      continue;
    }
    const scheme = isMintScheme(r.mintScheme) ? r.mintScheme : undefined;
    const firstSeenAt =
      typeof r.firstSeenAt === "number" && Number.isFinite(r.firstSeenAt)
        ? r.firstSeenAt
        : undefined;
    entries.push({
      repoId: r.repoId,
      repoLabel: r.repoLabel,
      ...(typeof r.rootKey === "string" ? { rootKey: r.rootKey } : {}),
      origins: Array.isArray(r.origins) ? r.origins.filter((x): x is string => typeof x === "string") : [],
      toplevels: Array.isArray(r.toplevels)
        ? r.toplevels.filter((x): x is string => typeof x === "string")
        : [],
      ...(scheme !== undefined ? { mintScheme: scheme } : {}),
      ...(firstSeenAt !== undefined ? { firstSeenAt } : {}),
    });
  }
  return { entries, dropped };
}

/** One loud line, once per load, when history may have been lost. Deliberately
 *  ungated (unlike the degraded-read warning in git.ts): a re-minted id splits a
 *  project on the dashboard and the user cannot see that from the outside. Names NO
 *  repo path, origin url, or id — only the quarantine file, which the user needs. */
function warnIdentityLoss(detail: string): void {
  console.warn(
    `[seorak] repo-identity: ${detail} Historical repo identities may be re-minted, which can split one project into a second dashboard card.`,
  );
}

/** Move an unusable ledger aside, preserving its bytes under a timestamped sibling
 *  name; returns that path, or null when the move failed. The suffix counter only
 *  guards against two processes quarantining within the same millisecond — an
 *  existing quarantine file is never overwritten, since it may hold the only
 *  recoverable copy of the ids. */
function quarantineUnusableLedger(path: string): string | null {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const dest = `${path}.unusable-${stamp}${attempt === 0 ? "" : `-${attempt}`}`;
    if (existsSync(dest)) continue;
    try {
      renameSync(path, dest);
      return dest;
    } catch {
      return null;
    }
  }
  return null;
}

function unusableLoad(path: string, reason: string): RepoIdentityLedgerLoad {
  const quarantinePath = quarantineUnusableLedger(path);
  warnIdentityLoss(
    quarantinePath === null
      ? `the identity ledger is unusable (${reason}) and could not be moved aside, so it is left exactly as it is rather than overwritten.`
      : `the identity ledger is unusable (${reason}); its original bytes are preserved at ${quarantinePath}.`,
  );
  return {
    ledger: emptyRepoIdentityLedger(),
    outcome: "unusable",
    dropped: 0,
    ...(quarantinePath !== null ? { quarantinePath } : {}),
    // A FAILED quarantine is the one case where writing would destroy the only
    // recoverable copy of the historical ids, so the caller must not save at all.
    persistable: quarantinePath !== null,
  };
}

/** Load the ledger and REPORT WHICH CASE happened (see RepoIdentityLoadOutcome) —
 *  never throws into a hook or the daemon loop. Absent is a new install and stays
 *  quiet; present-but-unusable is quarantined and warned about, because only that
 *  case can rotate ids. */
export function loadRepoIdentityLedger(): RepoIdentityLedgerLoad {
  const path = repoIdentityLedgerPath();
  let raw: string;
  try {
    if (!existsSync(path)) {
      return {
        ledger: emptyRepoIdentityLedger(),
        outcome: "absent",
        dropped: 0,
        persistable: true,
      };
    }
    raw = readFileSync(path, "utf8");
  } catch {
    return unusableLoad(path, "unreadable");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unusableLoad(path, "unparseable JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return unusableLoad(path, "unexpected top-level shape");
  }
  const shape = parsed as { version?: unknown; entries?: unknown };
  if (!Array.isArray(shape.entries)) return unusableLoad(path, "unexpected top-level shape");

  if (shape.version === REPO_IDENTITY_LEDGER_VERSION) {
    const { entries, dropped } = coerceEntries(shape.entries);
    if (dropped > 0) {
      warnIdentityLoss(`dropped ${dropped} malformed ledger ${dropped === 1 ? "entry" : "entries"}.`);
    }
    return {
      ledger: { version: REPO_IDENTITY_LEDGER_VERSION, entries },
      outcome: "loaded",
      dropped,
      persistable: true,
    };
  }
  return unusableLoad(path, "unrecognized schema version");
}

/** Persist the ledger atomically (tmp + rename), swallowing write errors so a
 *  failed write never throws into capture (mirrors ledger.ts saveLedger). Writes
 *  are RARE (only on first-seen / a newly-learned anchor), so the registry-style
 *  last-writer-wins across concurrent hooks is tolerable: entries are additive
 *  and idempotent. */
export function saveRepoIdentityLedger(ledger: RepoIdentityLedger): void {
  try {
    const path = repoIdentityLedgerPath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(ledger), "utf8");
    renameSync(tmp, path);
  } catch {
    // never throws into the capture path.
  }
}

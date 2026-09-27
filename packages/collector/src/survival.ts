/**
 * survival.ts — the LINE-SURVIVAL emitter. "Did the work LAST?", the deepest honest
 * outcome signal, now derived from GIT ATTRIBUTION rather than from a session's window
 * (HEAD-TO-HEAD, Tier 2).
 *
 * WHAT CHANGED, AND WHY IT MATTERS:
 *
 *   BEFORE  session.end (a CLAUDE HOOK) recorded EVERY commit landed between the
 *           session's start HEAD and its end HEAD, plus EVERY file in them, and blamed
 *           the session's remembered branch. Two things were wrong with that. It was
 *           only correct while exactly ONE agent existed — a session got credit for the
 *           human's files and for the other agent's files, because it credited everything
 *           in its time window. And it required a session END, which Codex does not have,
 *           so Codex could have no outcomes at all.
 *
 *   NOW     the daemon's commit watcher attributes each (commit × file) to whichever
 *           agent's tool.call touched that file since the file's previous commit
 *           (attribution.ts), and THAT is what a session is credited with. The clock
 *           starts when the work LANDED, not when a chat ended (ADR-H3).
 *
 *   Result: survival is tool-independent. Git does not care which tool wrote a line, and
 *   neither does this file any more.
 *
 * PRIVACY (CAPTURE-PRINCIPLE): shas, branch names, the toplevel, and repo-relative paths
 * live ONLY in the pending cursor. The event carries the salted repoId, COUNTS, a closed
 * fate/rung enum, SALTED commit ids (never shas), and the basename label only under the
 * default-OFF `repoLabels` opt-in.
 *
 * Honest-empty / no-fabrication:
 *   - A session with no attributed lines gets no record, so no event.
 *   - A TRANSIENT git failure at sweep time leaves the record for a retry — never a
 *     guessed value. A determinable-but-unknown outcome emits `fate: "unknown"`, which is
 *     EXCLUDED from the rate rather than counted as a death.
 *   - A repo that is gone at sweep time emits nothing and prunes.
 *   - The record OUTLIVES its emit (see `emittedEventId`), because a session's attributed
 *     set can still grow after it has been graded once.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { type LineSurvivalCommit, type LineSurvivalRung, type SessionLineSurvivalEvent } from "@seorak/types";
import { EVENT_LINE_SURVIVAL_COMMIT_LIMIT } from "@seorak/types/event-validation";
import type { SessionAttribution } from "./attribution.ts";
import { captureSettings } from "./capture-settings.ts";
import { captureAttributedSurvival, gitContext, saltedHash } from "./git.ts";
import { LEDGER_RETENTION_DAYS } from "./ledger.ts";
import { survivalPendingDir, survivalPendingPath } from "./paths.ts";

/** The single maturation rung. A FIXED discrete ladder index (never a wall-clock value)
 *  so the deterministic eventId and the worker's (sessionId, rung) read-dedup stay
 *  idempotent. The 8d/30d curve is foundation-gated (OUTCOME-ATTRIBUTION ADR-OA2). */
const LINE_SURVIVAL_RUNG: LineSurvivalRung = "3d";

/** Bounds `commits[]` on the wire; mirrors the shared event contract's cap. Observed
 *  maximum on real data is 14 commits for one session, so this is far past reality. */
const PENDING_COMMIT_CAP = EVENT_LINE_SURVIVAL_COMMIT_LIMIT;

/**
 * How long an emitted record is KEPT so a late commit can still merge into it. Tied to the
 * ledger's touch horizon on purpose, not coincidence: a commit can only attribute to a
 * session while that session's file touches are still IN the ledger, so once a record's
 * newest commit is older than the horizon, its attributed set can never grow again and
 * there is nothing left to say about it. Pruning earlier would risk a late commit forming a
 * thin second record that latest-wins would let REPLACE the full one.
 */
const PENDING_RETENTION_DAYS = LEDGER_RETENTION_DAYS;

const DEFAULT_SURVIVAL_AGE_DAYS = 3;

/**
 * How much MAIN-THREAD time one sweep may spend blaming, in milliseconds.
 *
 * Blame is `spawnSync`, so every call fully blocks the daemon's event loop and
 * the local plane answers nothing for its duration. Measured on this repository
 * (2026-09-09): `git blame --line-porcelain -M -C -w` costs 380ms on a large
 * source file and 170ms on a medium one, and a matured record blames EVERY file
 * it attributed. Nothing bounded how many records one tick took, so a batch that
 * matured together could block the loop for tens of seconds; the sweep runs
 * hourly, which is exactly often enough for that to be noticed and rare enough
 * for it to look like something else.
 *
 * A time budget rather than a record count, because the cost per record is not
 * knowable in advance: it depends on file size, repository age and how many
 * files that session touched. The budget is checked BEFORE starting a record, so
 * one slow record can overrun it but a second cannot begin.
 *
 * Nothing is lost when the budget runs out. An unblamed record stays on disk as
 * pending and the next sweep reaches it, and records that finish set
 * `emittedEventId` and are skipped from then on, so the frontier advances rather
 * than re-blaming the same head every hour.
 */
const DEFAULT_SURVIVAL_BLAME_BUDGET_MS = 2_000;

export function survivalBlameBudgetMs(): number {
  const raw = process.env.SEORAK_SURVIVAL_BLAME_BUDGET_MS;
  if (!raw) return DEFAULT_SURVIVAL_BLAME_BUDGET_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SURVIVAL_BLAME_BUDGET_MS;
}
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One commit a session's attributed work landed in. LOCAL ONLY — the sha and the paths
 *  never leave this machine; only counts and the SALTED commit id ship. */
export interface PendingCommit {
  sha: string;
  /** Total non-ignored added lines in the commit (every file). Coverage denominator. */
  added: number;
  /** Of those, lines in files 2+ agents edited — owned by nobody. */
  contested: number;
  /** THIS session's attributed files in this commit. */
  files: { path: string; added: number }[];
}

/**
 * The per-session attribution-pending record. LOCAL ONLY: `toplevel`, `branch`, the
 * `sha`s and the `path`s NEVER leave the machine — only the derived COUNTS, enums, and
 * salted ids do.
 */
export interface AttributionPending {
  /** Bumped from the retired session-window shape. A v1 record fails to parse and is
   *  pruned on the first new sweep — its session is re-derived from the commit walk. */
  version: 2;
  sessionId: string;
  /** LOCAL. The worker joins agent via the KV session map (ADR-H5), never off this. */
  agent: string;
  repoId: string;
  repoLabel: string;
  toplevel: string;
  /** The branch HEAD was on when the work was observed — the PREFERRED blame ref. Null is
   *  fine: ADR-H0's precedence then resolves the ref by CONTAINMENT, which is the honest
   *  question anyway ("does this work still exist?"). */
  branch: string | null;
  commits: PendingCommit[];
  /** Newest attributed commit time (epoch ms). The maturation clock starts HERE (ADR-H3),
   *  which is precisely what decouples survival from `session.end`. */
  lastCommitAt: number;
  /** The eventId of the last sweep this record emitted, or absent if it never has.
   *
   *  This is what lets the record OUTLIVE its emit, and it has to: a file a session
   *  touched can be committed days later, so its attributed set GROWS. Pruning on emit
   *  would make that late commit form a fresh record holding ONLY the late commits — and
   *  since the worker dedups latest-wins on (sessionId, rung), the thin row would REPLACE
   *  the full one and the session's earlier lines would vanish. Keeping the record means
   *  the late commit merges into the whole set and re-emits the union.
   *
   *  It is also the "already said this" guard: an unchanged set re-derives the SAME
   *  eventId, so the sweep skips it and never re-blames a session it has already graded. */
  emittedEventId?: string;
}

/** Maturation window in days (SEORAK_SURVIVAL_AGE_DAYS, default 3). A bad value falls back
 *  to the default rather than throwing. The rung LABEL stays "3d" regardless — the window
 *  is WHEN the first check fires; the rung is its stable identity. */
export function survivalAgeDays(): number {
  const raw = process.env.SEORAK_SURVIVAL_AGE_DAYS;
  if (!raw) return DEFAULT_SURVIVAL_AGE_DAYS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SURVIVAL_AGE_DAYS;
}

/** Sum of a record's attributed lines — the survival DENOMINATOR. */
export function pendingLinesAuthored(pending: AttributionPending): number {
  let total = 0;
  for (const commit of pending.commits) {
    for (const file of commit.files) total += file.added;
  }
  return total;
}

/** Read one pending record, or null on a missing/corrupt/OLD-VERSION file. A v1 record
 *  (the retired session-window shape) returns null here and the caller prunes it — its
 *  session is re-derived, more accurately, by the commit walk. */
export function readPending(path: string): AttributionPending | null {
  try {
    if (!existsSync(path)) return null;
    const p = JSON.parse(readFileSync(path, "utf8")) as Partial<AttributionPending>;
    if (
      p.version !== 2 ||
      typeof p.sessionId !== "string" ||
      typeof p.agent !== "string" ||
      typeof p.repoId !== "string" ||
      typeof p.repoLabel !== "string" ||
      typeof p.toplevel !== "string" ||
      typeof p.lastCommitAt !== "number" ||
      !Array.isArray(p.commits)
    ) {
      return null;
    }
    const commits: PendingCommit[] = [];
    for (const raw of p.commits) {
      if (
        typeof raw?.sha !== "string" ||
        typeof raw.added !== "number" ||
        typeof raw.contested !== "number" ||
        !Array.isArray(raw.files)
      ) {
        continue;
      }
      const files = raw.files.filter(
        (f): f is { path: string; added: number } =>
          typeof f?.path === "string" && typeof f.added === "number",
      );
      commits.push({ sha: raw.sha, added: raw.added, contested: raw.contested, files });
    }
    return {
      version: 2,
      sessionId: p.sessionId,
      agent: p.agent,
      repoId: p.repoId,
      repoLabel: p.repoLabel,
      toplevel: p.toplevel,
      branch: typeof p.branch === "string" ? p.branch : null,
      commits,
      lastCommitAt: p.lastCommitAt,
      ...(typeof p.emittedEventId === "string" ? { emittedEventId: p.emittedEventId } : {}),
    };
  } catch {
    return null;
  }
}

/** Persist a record atomically (tmp + rename) — a torn write would reset a whole session's
 *  attribution. Best-effort: a write failure just means the commit walk re-derives it. */
function writePending(pending: AttributionPending): void {
  try {
    const path = survivalPendingPath(pending.sessionId);
    mkdirSync(survivalPendingDir(), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(pending), "utf8");
    renameSync(tmp, path);
  } catch {
    // best-effort; the commit walk re-derives this session next tick.
  }
}

/**
 * Upsert a session's attribution, MERGING with whatever is already pending for it.
 *
 * Merging is the correctness requirement, not an optimisation: a session's attributed
 * commit set legitimately GROWS, because a file it touched can be committed days after the
 * session ended. Each tick unions the new commits in and bumps the maturation clock to the
 * newest, so a matured record emits under an eventId keyed on the WHOLE sha set — a grown
 * attribution therefore lands as a new row that the worker's latest-wins dedup picks up,
 * rather than being swallowed by `INSERT OR IGNORE` (ADR-H10).
 *
 * `emittedEventId` carries over from the existing record (the walk has no idea what was
 * already emitted). If the merge changed the sha set, the next sweep derives a different
 * id, sees the mismatch, and re-emits the union.
 */
export function recordAttributionPending(pending: AttributionPending): void {
  const existing = readPending(survivalPendingPath(pending.sessionId));

  const bySha = new Map<string, PendingCommit>();
  for (const commit of existing?.commits ?? []) bySha.set(commit.sha, commit);
  for (const commit of pending.commits) bySha.set(commit.sha, commit); // newest wins

  // Overflow drops the OLDEST commits: `commits` is oldest-first, so the freshest evidence
  // is what a capped session keeps.
  const commits = [...bySha.values()].slice(-PENDING_COMMIT_CAP);

  writePending({
    ...pending,
    commits,
    lastCommitAt: Math.max(pending.lastCommitAt, existing?.lastCommitAt ?? 0),
    ...(existing?.emittedEventId ? { emittedEventId: existing.emittedEventId } : {}),
  });
}

/**
 * Mark a record as emitted under `eventId`. Called by the daemon AFTER the event is
 * durably appended, so a crash in between just re-emits next sweep — under the same
 * deterministic id, which the D1 PK collapses.
 *
 * Re-reads rather than mutating a stale in-memory copy: the commit walk runs in the same
 * tick and may have merged a new commit into this record since the sweep read it.
 */
export function markPendingEmitted(path: string, eventId: string): void {
  const pending = readPending(path);
  if (pending === null) return;
  writePending({ ...pending, emittedEventId: eventId });
}

/**
 * Turn one credited session from a commit walk into an attribution-pending record. PURE
 * (no I/O) so the mapping is unit-testable without a repo, and so the daemon's job stays a
 * loop rather than a translation layer.
 *
 * The commit cap bites HERE as well as at merge time: a session that landed more than
 * `PENDING_COMMIT_CAP` commits keeps its newest ones (the walk hands them oldest-first), so
 * an overflow loses the OLDEST evidence rather than the freshest.
 */
export function pendingFromAttribution(
  repo: { repoId: string; repoLabel: string; toplevel: string; branch: string | null },
  session: SessionAttribution,
): AttributionPending {
  const commits = session.commits.slice(-PENDING_COMMIT_CAP).map((c) => ({
    sha: c.sha,
    added: c.added,
    contested: c.contested,
    files: c.files.map((f) => ({ path: f.path, added: f.added })),
  }));
  return {
    version: 2,
    sessionId: session.sessionId,
    agent: session.agent,
    repoId: repo.repoId,
    repoLabel: repo.repoLabel,
    toplevel: repo.toplevel,
    branch: repo.branch,
    commits,
    lastCommitAt: session.lastCommitAt,
  };
}

/** Prune a pending cursor. Exported so the DAEMON prunes AFTER a durable append — a crash
 *  between emit and disk then loses nothing (the entry stays pending, and the
 *  deterministic eventId dedups the re-emit on the D1 PK). */
export function prunePending(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // a leftover pending file is harmless; it is re-evaluated next sweep.
  }
}

/** Whole days between two epoch-ms instants (floored, never negative). */
function ageDays(fromMs: number, nowMs: number): number {
  const days = Math.floor((nowMs - fromMs) / MS_PER_DAY);
  return days > 0 ? days : 0;
}

/** A matured entry's emittable event paired with the record path the daemon marks emitted
 *  AFTER it durably appends the event. */
export interface SweptLineSurvival {
  event: SessionLineSurvivalEvent;
  pendingPath: string;
}

/**
 * The deterministic eventId (ADR-H10). Versioned `v2` so it is DISTINCT from the retired
 * session-window mechanism's id: D1 is `INSERT OR IGNORE`, so re-emitting under the OLD
 * id would be silently dropped and the old, session-window-attributed counts would win
 * forever. The SHA SET is in the seed so a GROWN attribution produces a new row (which
 * latest-wins picks up) while an unchanged one collapses on the PK.
 *
 * Do NOT "fix" the collision by changing the RUNG instead: `(sessionId, rung)` is the
 * worker's read-dedup key, so a new rung makes the old and new rows DIFFERENT keys and the
 * session is COUNTED TWICE.
 */
export function survivalEventId(sessionId: string, shas: string[]): string {
  const set = [...new Set(shas)].sort().join(",");
  return saltedHash(`linesurvival\0v2\0${sessionId}\0${LINE_SURVIVAL_RUNG}\0${set}`);
}

/** The salted, non-reversible commit id that ships (never the sha). Namespaced so it
 *  cannot collide with a repoId/fileId hash of the same input. */
export function saltedCommitId(sha: string): string {
  return saltedHash(`commit\0${sha}`);
}

/**
 * sweepAttributedSurvival(nowIso) — the daemon sweep step. For each record matured past the
 * window (measured from its NEWEST attributed commit, ADR-H3) whose sha set has changed
 * since it was last emitted, blame each attributed file against the commit it was
 * attributed to and build ONE `session.linesurvival` (counts + enums + salted ids only),
 * returned WITH its record path so the daemon marks it emitted only AFTER a durable append.
 *
 * Four ways a record does no git work here, each deliberate:
 *   - not matured           → left alone; more of its work may still be landing
 *   - already emitted       → the sha set is unchanged, so the answer is unchanged
 *   - past retention        → pruned; its touches are gone from the ledger, so it can
 *                             never grow again and nothing more will ever be said about it
 *   - unreadable / v1       → pruned; the commit walk re-derives the session, better
 */
export function sweepAttributedSurvival(nowIso: string): SweptLineSurvival[] {
  const dir = survivalPendingDir();
  let names: string[];
  try {
    if (!existsSync(dir)) return [];
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }

  const nowMs = Date.parse(nowIso);
  const minAge = survivalAgeDays();
  const repoLabels = captureSettings().repoLabels;
  const swept: SweptLineSurvival[] = [];
  // Measured against a monotonic clock, not `nowMs`: the caller's instant is the
  // event timestamp and may be minutes old by the time the sweep runs.
  const blameDeadline = performance.now() + survivalBlameBudgetMs();

  for (const name of names) {
    const path = survivalPendingPath(name.replace(/\.json$/, ""));
    const pending = readPending(path);
    if (!pending) {
      // Corrupt, or a v1 record from the retired session-window mechanism. Prune so it
      // stops being scanned; the commit walk re-derives the session more accurately.
      prunePending(path);
      continue;
    }

    const age = ageDays(pending.lastCommitAt, nowMs);
    if (age > PENDING_RETENTION_DAYS) {
      prunePending(path);
      continue;
    }
    if (age < minAge) continue; // not matured — more of its work may still be landing

    const eventId = survivalEventId(
      pending.sessionId,
      pending.commits.map((c) => c.sha),
    );
    if (eventId === pending.emittedEventId) continue; // same set, same answer — no re-blame

    // Everything above is a file read and a comparison; everything below spawns
    // git. Stop at the boundary rather than mid-record, so the work already done
    // is never wasted and the record is left exactly as it was found.
    if (performance.now() >= blameDeadline) break;

    // Honest-empty gate: a repo that is genuinely gone emits nothing.
    const ctx = gitContext(pending.toplevel);
    if (ctx === "no-repo") {
      prunePending(path);
      continue;
    }

    // Blame each attributed file against the commit it was attributed to — NOT against a
    // flat set of the session's shas, which would credit it for lines in a file that
    // commit touched but that was attributed to someone else (git.blameAttributedLines).
    const byFile = new Map<string, Set<string>>();
    for (const commit of pending.commits) {
      for (const file of commit.files) {
        const set = byFile.get(file.path) ?? new Set<string>();
        set.add(commit.sha);
        byFile.set(file.path, set);
      }
    }

    const linesAuthored = pendingLinesAuthored(pending);
    const result = captureAttributedSurvival(
      pending.toplevel,
      pending.branch,
      byFile,
      linesAuthored,
    );
    if (result === null) continue; // TRANSIENT git failure → retry next sweep

    const commits: LineSurvivalCommit[] = pending.commits.map((c) => ({
      id: saltedCommitId(c.sha),
      added: c.added,
      contested: c.contested,
      authored: c.files.reduce((sum, f) => sum + f.added, 0),
    }));

    const event: SessionLineSurvivalEvent = {
      kind: "session.linesurvival",
      eventId,
      sessionId: pending.sessionId,
      at: nowIso,
      repoId: pending.repoId,
      ...(repoLabels ? { repoLabel: pending.repoLabel } : {}),
      gitContext: ctx,
      rung: LINE_SURVIVAL_RUNG,
      fate: result.fate,
      commitsChecked: pending.commits.length,
      linesAuthored,
      linesSurviving: result.linesSurviving,
      commits,
      filesGoneFromTip: result.filesGoneFromTip,
    };
    swept.push({ event, pendingPath: path });
  }

  return swept;
}

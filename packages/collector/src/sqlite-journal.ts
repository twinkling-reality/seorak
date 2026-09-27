import type { DatabaseSync } from "node:sqlite";

/**
 * Put a local database into WAL and prove it took.
 *
 * Why this exists. Both local databases opened in `journal_mode = DELETE` with
 * `synchronous = FULL`, which is the slowest safe combination SQLite offers: a
 * write transaction creates a rollback journal, fsyncs it, modifies the database,
 * fsyncs that, then deletes the journal. Under DELETE a writer also takes an
 * EXCLUSIVE lock, so every concurrent reader blocks until it finishes or the
 * 5s `busy_timeout` expires and the read fails outright.
 *
 * That is what wedged the daemon. The local plane serves the dashboard from the
 * same process that writes capture, so a write burst against a 243 MB history
 * (344,363 rows, measured 2026-09-09) starved the HTTP server of both the lock
 * and the disk: readers parked in `pread` while the writer fsynced, and the
 * plane answered nothing for minutes at a time. The same contention is what
 * surfaced in the terminal as a raw `database is locked` (`ERR_SQLITE_ERROR`
 * errcode 5) out of the local read commands.
 *
 * WAL fixes the contention rather than the query cost, which is the right target:
 * measured warm, a full scan of that history is 706ms and a per-session tool-call
 * sweep across all 5,586 sessions is 310ms, so no single statement was ever slow
 * enough to explain a five-minute stall. Readers no longer block on the writer,
 * and a commit appends to one file instead of the write/fsync/delete cycle.
 *
 * `synchronous = FULL` is deliberately kept by the callers. WAL with FULL still
 * fsyncs on every commit, so the durability contract does not change; the win
 * here is concurrency and write amplification, not a relaxed guarantee.
 *
 * The journal mode is a persistent property of the file, so this converts an
 * existing database on first open and is a no-op afterwards. It is also the one
 * pragma that can silently refuse: SQLite falls back when the file lives on a
 * filesystem without shared-memory support, and a caller that assumed WAL and
 * got DELETE would carry exactly the bug this removes. So the mode is read back
 * and returned rather than assumed.
 */
export function applyWalJournal(database: DatabaseSync): string {
  const row = database.prepare("PRAGMA journal_mode = WAL").get() as
    | { journal_mode?: unknown }
    | undefined;
  const mode = String(row?.journal_mode ?? "").toLowerCase();
  return mode;
}

/**
 * True when a database is running the journal mode above. Callers that want to
 * report the fallback (status output, tests) ask with this rather than parsing
 * the pragma a second time.
 */
export function isWalJournal(mode: string): boolean {
  return mode === "wal";
}

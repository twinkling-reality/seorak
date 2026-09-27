import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { collectorDir, sessionCursorDatabasePath } from "./paths.ts";
import { applyWalJournal } from "./sqlite-journal.ts";

const SESSION_CURSOR_SCHEMA_VERSION = 1;
const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const LEGACY_CURSOR_MAX_BYTES = 64 * 1024;

export type SessionCursorKind = "transcript" | "git";

interface StoredCursor {
  value: string;
  updatedAtMs: number;
}

interface LegacyCursorCandidate extends StoredCursor {
  kind: SessionCursorKind;
  sessionId: string;
  path: string;
  raw: string;
}

export interface LegacySessionCursorMigration {
  discovered: number;
  imported: number;
  removed: number;
  retained: number;
  skipped: number;
}

export interface TranscriptCursorUpdate<T> {
  result: T;
  nextValue?: string;
}

function cursorPrefix(kind: SessionCursorKind): string {
  return kind === "transcript" ? "cursor-" : "gitcursor-";
}

function legacyCursorPath(
  stateDir: string,
  kind: SessionCursorKind,
  sessionId: string,
): string | null {
  const name = `${cursorPrefix(kind)}${sessionId}`;
  return basename(name) === name ? join(stateDir, name) : null;
}

function readLegacyCandidate(
  path: string,
  kind: SessionCursorKind,
  sessionId: string,
): LegacyCursorCandidate | null {
  try {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size <= 0 ||
      stat.size > LEGACY_CURSOR_MAX_BYTES
    ) {
      return null;
    }
    const raw = readFileSync(path, "utf8");
    const value = raw.trim();
    if (!value) return null;
    return {
      kind,
      sessionId,
      path,
      raw,
      value,
      updatedAtMs: Math.max(1, Math.floor(stat.mtimeMs)),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function exactLegacyCandidate(
  stateDir: string,
  kind: SessionCursorKind,
  sessionId: string,
): LegacyCursorCandidate | null {
  const path = legacyCursorPath(stateDir, kind, sessionId);
  return path ? readLegacyCandidate(path, kind, sessionId) : null;
}

function listLegacyCandidates(stateDir: string): {
  candidates: LegacyCursorCandidate[];
  skipped: number;
} {
  if (!existsSync(stateDir)) return { candidates: [], skipped: 0 };
  const candidates: LegacyCursorCandidate[] = [];
  let skipped = 0;
  for (const entry of readdirSync(stateDir, { withFileTypes: true })) {
    const match =
      entry.name.startsWith("gitcursor-")
        ? { kind: "git" as const, prefix: "gitcursor-" }
        : entry.name.startsWith("cursor-")
          ? { kind: "transcript" as const, prefix: "cursor-" }
          : null;
    if (!match) continue;
    const sessionId = entry.name.slice(match.prefix.length);
    if (!entry.isFile() || entry.isSymbolicLink() || !sessionId) {
      skipped += 1;
      continue;
    }
    const candidate = readLegacyCandidate(
      join(stateDir, entry.name),
      match.kind,
      sessionId,
    );
    if (candidate) candidates.push(candidate);
    else skipped += 1;
  }
  return { candidates, skipped };
}

function openCursorDatabase(): DatabaseSync {
  const path = sessionCursorDatabasePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const existed = existsSync(path);
  if (existed) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`session cursor database is not a regular file: ${path}`);
    }
  }

  const database = new DatabaseSync(path);
  try {
    database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
    applyWalJournal(database);
    database.exec(`PRAGMA synchronous = FULL;`);
    const readVersion = (): number => {
      const row = database.prepare("PRAGMA user_version").get() as
        | { user_version?: unknown }
        | undefined;
      return Number(row?.user_version);
    };
    const version = readVersion();
    if (version === 0) {
      transaction(database, () => {
        // Another first hook may have initialized the file while this
        // connection waited for BEGIN IMMEDIATE. Re-read under the write lock.
        const lockedVersion = readVersion();
        if (lockedVersion === SESSION_CURSOR_SCHEMA_VERSION) return;
        if (lockedVersion !== 0) {
          throw new Error(
            `unsupported session cursor database version ${String(lockedVersion)}`,
          );
        }
        const tables = database
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .all();
        if (tables.length > 0) {
          throw new Error("session cursor database has an unversioned schema");
        }
        database.exec(`
          CREATE TABLE session_cursor (
            kind TEXT NOT NULL CHECK (kind IN ('transcript', 'git')),
            session_id TEXT NOT NULL,
            value TEXT NOT NULL CHECK (length(value) > 0),
            updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms > 0),
            PRIMARY KEY (kind, session_id)
          ) STRICT, WITHOUT ROWID;
          PRAGMA user_version = ${SESSION_CURSOR_SCHEMA_VERSION};
        `);
      });
    } else if (version !== SESSION_CURSOR_SCHEMA_VERSION) {
      throw new Error(
        `unsupported session cursor database version ${String(version)}`,
      );
    }
    if (!existed) chmodSync(path, 0o600);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the operation error. Closing the connection releases any lock.
    }
    throw error;
  }
}

function storedCursor(
  database: DatabaseSync,
  kind: SessionCursorKind,
  sessionId: string,
): StoredCursor | null {
  const row = database
    .prepare(
      "SELECT value, updated_at_ms FROM session_cursor WHERE kind = ? AND session_id = ?",
    )
    .get(kind, sessionId) as
    | { value?: unknown; updated_at_ms?: unknown }
    | undefined;
  return typeof row?.value === "string" &&
    Number.isSafeInteger(Number(row.updated_at_ms)) &&
    Number(row.updated_at_ms) > 0
    ? { value: row.value, updatedAtMs: Number(row.updated_at_ms) }
    : null;
}

function importLegacyCursor(
  database: DatabaseSync,
  candidate: LegacyCursorCandidate,
): number {
  const result = database
    .prepare(`
      INSERT INTO session_cursor (kind, session_id, value, updated_at_ms)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (kind, session_id) DO UPDATE SET
        value = excluded.value,
        updated_at_ms = excluded.updated_at_ms
      WHERE excluded.updated_at_ms > session_cursor.updated_at_ms
    `)
    .run(
      candidate.kind,
      candidate.sessionId,
      candidate.value,
      candidate.updatedAtMs,
    ) as StatementResultingChanges;
  return Number(result.changes);
}

function upsertCursor(
  database: DatabaseSync,
  kind: SessionCursorKind,
  sessionId: string,
  value: string,
  previousUpdatedAtMs: number,
): void {
  if (!value) throw new Error("session cursor value must not be empty");
  const updatedAtMs = Math.max(Date.now(), previousUpdatedAtMs + 1);
  database
    .prepare(`
      INSERT INTO session_cursor (kind, session_id, value, updated_at_ms)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (kind, session_id) DO UPDATE SET
        value = excluded.value,
        updated_at_ms = excluded.updated_at_ms
    `)
    .run(kind, sessionId, value, updatedAtMs);
}

function removeLegacyCandidate(candidate: LegacyCursorCandidate): boolean {
  try {
    if (readFileSync(candidate.path, "utf8") !== candidate.raw) return false;
    rmSync(candidate.path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    return false;
  }
}

function closeAfter<T>(database: DatabaseSync, operation: () => T): T {
  try {
    return operation();
  } finally {
    database.close();
  }
}

/**
 * Serialize one transcript read/advance transaction. Cursor state remains after
 * session.end because Claude can resume the same transcript and session id.
 */
export function withTranscriptSessionCursor<T>(
  sessionId: string,
  operation: (lastValue: string) => TranscriptCursorUpdate<T>,
): T {
  const stateDir = collectorDir();
  const legacy = exactLegacyCandidate(stateDir, "transcript", sessionId);
  const database = openCursorDatabase();
  const result = closeAfter(database, () =>
    transaction(database, () => {
      if (legacy) importLegacyCursor(database, legacy);
      const previous = storedCursor(database, "transcript", sessionId);
      const update = operation(previous?.value ?? "");
      if (update.nextValue && update.nextValue !== previous?.value) {
        upsertCursor(
          database,
          "transcript",
          sessionId,
          update.nextValue,
          previous?.updatedAtMs ?? 0,
        );
      }
      return update.result;
    }),
  );
  if (legacy) removeLegacyCandidate(legacy);
  return result;
}

export function writeSessionCursor(
  kind: SessionCursorKind,
  sessionId: string,
  value: string,
): void {
  const stateDir = collectorDir();
  const legacy = exactLegacyCandidate(stateDir, kind, sessionId);
  const database = openCursorDatabase();
  closeAfter(database, () =>
    transaction(database, () => {
      if (legacy) importLegacyCursor(database, legacy);
      const previous = storedCursor(database, kind, sessionId);
      upsertCursor(
        database,
        kind,
        sessionId,
        value,
        previous?.updatedAtMs ?? 0,
      );
    }),
  );
  if (legacy) removeLegacyCandidate(legacy);
}

export function readSessionCursor(
  kind: SessionCursorKind,
  sessionId: string,
): string | null {
  const stateDir = collectorDir();
  const legacy = exactLegacyCandidate(stateDir, kind, sessionId);
  const database = openCursorDatabase();
  const value = closeAfter(database, () =>
    transaction(database, () => {
      if (legacy) importLegacyCursor(database, legacy);
      return storedCursor(database, kind, sessionId)?.value ?? null;
    }),
  );
  if (legacy) removeLegacyCandidate(legacy);
  return value;
}

export function deleteSessionCursor(
  kind: SessionCursorKind,
  sessionId: string,
): void {
  const stateDir = collectorDir();
  const legacy = exactLegacyCandidate(stateDir, kind, sessionId);
  const database = openCursorDatabase();
  closeAfter(database, () =>
    transaction(database, () => {
      database
        .prepare("DELETE FROM session_cursor WHERE kind = ? AND session_id = ?")
        .run(kind, sessionId);
    }),
  );
  if (legacy) removeLegacyCandidate(legacy);
}

/**
 * Losslessly imports the old inode-per-session layout. Database commit happens
 * before any source file is removed; an interrupted cleanup is idempotent.
 * Removal condition: delete this importer once the first published collector
 * release containing session-cursors.sqlite is the minimum supported version.
 */
export function migrateLegacySessionCursors(): LegacySessionCursorMigration {
  const stateDir = collectorDir();
  const { candidates, skipped } = listLegacyCandidates(stateDir);
  if (candidates.length === 0) {
    return {
      discovered: skipped,
      imported: 0,
      removed: 0,
      retained: 0,
      skipped,
    };
  }

  const database = openCursorDatabase();
  const imported = closeAfter(database, () =>
    transaction(database, () =>
      candidates.reduce(
        (count, candidate) => count + importLegacyCursor(database, candidate),
        0,
      ),
    ),
  );

  let removed = 0;
  for (const candidate of candidates) {
    if (removeLegacyCandidate(candidate)) removed += 1;
  }
  return {
    discovered: candidates.length + skipped,
    imported,
    removed,
    retained: candidates.length - removed,
    skipped,
  };
}

/**
 * Managed compact-sync persistence against the local history database.
 *
 * Schema ownership stays in `local-store.ts` (sync tables, archive checkpoints,
 * dirty flags). This module owns the candidate / backlog / rebaseline / pending
 * batch write path that `compact-sync.ts` drives over HTTP. Coverage bounds
 * (`localHistoryFrom` / `localHistoryThrough`) live here because they answer
 * managed-copy reach questions, not raw append.
 *
 * Same sibling-store shape as `local-integration-store.ts`: open the shared
 * history database through `openLocalHistory`, never import the worker.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  mapLocalSessionRow,
  openLocalHistory,
  type LocalHourRow,
  type LocalSessionRow,
  type LocalTransitionRow,
} from "./local-store.ts";

export interface LocalSyncCandidate {
  batchId: string;
  sessions: LocalSessionRow[];
  hours: LocalHourRow[];
  hourSessionCounts: Array<{
    bucket: string;
    sessionsStarted: number;
    sessionsEnded: number;
  }>;
  transitions: LocalTransitionRow[];
  archives: Array<{
    sessionId: string;
    contentDigest: string;
    eventCount: number;
    firstLocalSequence: number;
    lastLocalSequence: number;
    jsonl: string;
  }>;
}

export interface LocalManagedSyncState {
  mode: "inactive" | "compact-v1";
  installationId: string | null;
  nextSequence: number;
  previousBatchSha256: string | null;
  pendingBatchJson: string | null;
  pendingCandidateJson: string | null;
  cachedEntitlementJson: string | null;
  entitlementExpiresAt: string | null;
  /** Newest local instant a receipt has covered. Null before the first one. */
  synchronizedThrough: string | null;
  lastAcceptedAt: string | null;
  lastAttemptAt: string | null;
  lastErrorReason: string | null;
  lastErrorAt: string | null;
  lastErrorRetriable: boolean | null;
  /** Highest rebaseline epoch this installation has acknowledged. */
  baselineEpoch: number;
  cachedDataPlaneJson: string | null;
  cachedDataPlaneAt: string | null;
}

/**
 * What the local record still owes the managed copy.
 *
 * This is the authoritative backlog, and it is authoritative for a structural
 * reason rather than a convenient one: dirtiness lives in the local projection
 * tables, so the machine holding the raw history is the only party that can
 * count what has not been sent. A remote answer would be a guess.
 */
export interface LocalManagedBacklog {
  sessions: number;
  hours: number;
  archives: number;
  /** Oldest local instant not yet acknowledged, or null when nothing is due. */
  pendingFrom: string | null;
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
      // Preserve the operation failure. Closing the connection releases locks.
    }
    throw error;
  }
}

function mapHour(row: Record<string, unknown>): LocalHourRow {
  return {
    bucket: String(row.bucket),
    sessionId: String(row.session_id),
    revision: Number(row.revision),
    agent: String(row.agent),
    eventCount: Number(row.event_count),
    toolCallCount: Number(row.tool_call_count),
    erroredToolCallCount: Number(row.errored_tool_call_count),
    promptCount: Number(row.prompt_count),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheReadTokens: Number(row.cache_read_tokens),
    cacheWriteTokens: Number(row.cache_write_tokens),
    costUsd: Number(row.cost_known) === 1 ? Number(row.cost_usd) : null,
  };
}

const LOCAL_ARCHIVE_RAW_CHUNK_BYTES = 400 * 1024;

function archiveForSession(
  database: DatabaseSync,
  sessionId: string,
): LocalSyncCandidate["archives"][number] | null {
  const checkpoint = database
    .prepare(
      "SELECT last_local_sequence FROM local_archive_checkpoint WHERE session_id = ?",
    )
    .get(sessionId) as { last_local_sequence?: unknown } | undefined;
  const rows = database
    .prepare(
      `SELECT local_seq, payload_json
         FROM local_event
        WHERE session_id = ? AND local_seq > ?
        ORDER BY local_seq`,
    )
    .all(sessionId, Number(checkpoint?.last_local_sequence ?? 0)) as Array<{
    local_seq?: unknown;
    payload_json?: unknown;
  }>;
  if (rows.length === 0) return null;
  const selected: typeof rows = [];
  let bytes = 0;
  for (const row of rows) {
    const lineBytes = Buffer.byteLength(String(row.payload_json)) + 1;
    if (
      selected.length > 0 &&
      bytes + lineBytes > LOCAL_ARCHIVE_RAW_CHUNK_BYTES
    )
      break;
    selected.push(row);
    bytes += lineBytes;
  }
  const jsonl = `${selected.map((row) => String(row.payload_json)).join("\n")}\n`;
  return {
    sessionId,
    contentDigest: createHash("sha256").update(jsonl).digest("hex"),
    eventCount: selected.length,
    firstLocalSequence: Number(selected[0]!.local_seq),
    lastLocalSequence: Number(selected.at(-1)!.local_seq),
    jsonl,
  };
}

export function buildLocalSyncCandidate(
  options: { nowMs?: number; limit?: number; directory?: string } = {},
): LocalSyncCandidate | null {
  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(8, options.limit ?? 8));
  const database = openLocalHistory(options.directory);
  try {
    const sessions = database
      .prepare(
        `
        SELECT * FROM local_session
         WHERE dirty = 1 AND next_sync_at_ms <= ?
         ORDER BY next_sync_at_ms, session_id
         LIMIT ?
      `,
      )
      .all(nowMs, limit)
      .map((row) => mapLocalSessionRow(row as Record<string, unknown>));
    const dirtyBuckets = database
      .prepare(
        `
        SELECT DISTINCT bucket FROM local_hour
         WHERE dirty = 1
           AND (
             bucket < ?
             OR EXISTS (
               SELECT 1 FROM local_session AS session
                WHERE session.session_id = local_hour.session_id
                  AND session.ended_at IS NOT NULL
             )
           )
         ORDER BY bucket
         LIMIT ?
      `,
      )
      .all(new Date(nowMs).toISOString().slice(0, 13), limit)
      .map((row) => String((row as { bucket?: unknown }).bucket));
    const hours =
      dirtyBuckets.length === 0
        ? []
        : database
            .prepare(
              `SELECT * FROM local_hour
              WHERE bucket IN (${dirtyBuckets.map(() => "?").join(", ")})
              ORDER BY bucket, session_id`,
            )
            .all(...dirtyBuckets)
            .map((row) => mapHour(row as Record<string, unknown>));
    const hourSessionCounts = dirtyBuckets.map((bucket) => {
      const row = database
        .prepare(
          `
          SELECT
            SUM(CASE WHEN substr(started_at, 1, 13) = ? THEN 1 ELSE 0 END) AS started,
            SUM(CASE WHEN ended_at IS NOT NULL AND substr(ended_at, 1, 13) = ?
                     THEN 1 ELSE 0 END) AS ended
            FROM local_session
           WHERE substr(started_at, 1, 13) = ?
              OR (ended_at IS NOT NULL AND substr(ended_at, 1, 13) = ?)
        `,
        )
        .get(bucket, bucket, bucket, bucket) as
        { started?: unknown; ended?: unknown } | undefined;
      return {
        bucket,
        sessionsStarted: Number(row?.started ?? 0),
        sessionsEnded: Number(row?.ended ?? 0),
      };
    });
    const transitions = database
      .prepare(
        `
        SELECT event_id, session_id, at, transition
          FROM local_transition
         WHERE synced = 0
         ORDER BY at, event_id
         LIMIT ?
      `,
      )
      .all(limit)
      .map((row) => ({
        eventId: String((row as Record<string, unknown>).event_id),
        sessionId: String((row as Record<string, unknown>).session_id),
        at: String((row as Record<string, unknown>).at),
        transition: String(
          (row as Record<string, unknown>).transition,
        ) as LocalTransitionRow["transition"],
      }));
    const archiveSessions = database
      .prepare(
        `
        SELECT session_id
          FROM local_session
         WHERE ended_at IS NOT NULL AND archive_synced = 0
         ORDER BY ended_at, session_id
         LIMIT 2
      `,
      )
      .all()
      .map((row) => String((row as { session_id?: unknown }).session_id));
    const archives = archiveSessions.flatMap((sessionId) => {
      const archive = archiveForSession(database, sessionId);
      return archive === null ? [] : [archive];
    });
    if (
      sessions.length === 0 &&
      hours.length === 0 &&
      transitions.length === 0 &&
      archives.length === 0
    ) {
      return null;
    }
    const canonical = JSON.stringify({
      sessions,
      hours,
      hourSessionCounts,
      transitions,
      archives: archives.map(({ sessionId, contentDigest, eventCount }) => ({
        sessionId,
        contentDigest,
        eventCount,
      })),
    });
    return {
      batchId: createHash("sha256").update(canonical).digest("hex"),
      sessions,
      hours,
      hourSessionCounts,
      transitions,
      archives,
    };
  } finally {
    database.close();
  }
}

export function acknowledgeLocalSyncCandidate(
  candidate: LocalSyncCandidate,
  directory?: string,
): void {
  const database = openLocalHistory(directory);
  try {
    transaction(database, () => {
      const now = new Date().toISOString();
      acknowledgeCandidateOnDatabase(database, candidate);
      database
        .prepare(
          `
          UPDATE local_sync_state
             SET mode = 'compact-v1',
                 activated_at = COALESCE(activated_at, ?)
           WHERE scope = 'managed'
        `,
        )
        .run(now);
      recordCandidateCoverage(database, candidate, now);
    });
  } finally {
    database.close();
  }
}

export function readLocalManagedSyncState(
  directory?: string,
): LocalManagedSyncState {
  const database = openLocalHistory(directory);
  try {
    const row = database
      .prepare("SELECT * FROM local_sync_state WHERE scope = 'managed'")
      .get() as Record<string, unknown>;
    return {
      mode: row.mode === "compact-v1" ? "compact-v1" : "inactive",
      installationId:
        typeof row.installation_id === "string" ? row.installation_id : null,
      nextSequence: Number(row.next_sequence ?? 1),
      previousBatchSha256:
        typeof row.previous_batch_sha256 === "string"
          ? row.previous_batch_sha256
          : null,
      pendingBatchJson:
        typeof row.pending_batch_json === "string"
          ? row.pending_batch_json
          : null,
      pendingCandidateJson:
        typeof row.pending_candidate_json === "string"
          ? row.pending_candidate_json
          : null,
      cachedEntitlementJson:
        typeof row.cached_entitlement_json === "string"
          ? row.cached_entitlement_json
          : null,
      entitlementExpiresAt:
        typeof row.entitlement_expires_at === "string"
          ? row.entitlement_expires_at
          : null,
      synchronizedThrough:
        typeof row.synchronized_through === "string"
          ? row.synchronized_through
          : null,
      lastAcceptedAt:
        typeof row.last_accepted_at === "string" ? row.last_accepted_at : null,
      lastAttemptAt:
        typeof row.last_attempt_at === "string" ? row.last_attempt_at : null,
      lastErrorReason:
        typeof row.last_error_reason === "string"
          ? row.last_error_reason
          : null,
      lastErrorAt:
        typeof row.last_error_at === "string" ? row.last_error_at : null,
      lastErrorRetriable:
        row.last_error_retriable === null ||
        row.last_error_retriable === undefined
          ? null
          : Number(row.last_error_retriable) === 1,
      baselineEpoch: Number(row.baseline_epoch ?? 0),
      cachedDataPlaneJson:
        typeof row.cached_data_plane_json === "string"
          ? row.cached_data_plane_json
          : null,
      cachedDataPlaneAt:
        typeof row.cached_data_plane_at === "string"
          ? row.cached_data_plane_at
          : null,
    };
  } finally {
    database.close();
  }
}

/**
 * Count what is still owed, and find the oldest instant that owes it.
 *
 * A dirty session or hour is one whose revision the managed copy has not
 * acknowledged; an unsynced archive is an ended session whose raw chunk has not
 * been accepted. All three are counted from the same snapshot so a surface never
 * shows an empty backlog beside a pending instant.
 */
export function readLocalManagedBacklog(
  directory?: string,
): LocalManagedBacklog {
  const database = openLocalHistory(directory);
  try {
    const counts = database
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM local_session WHERE dirty = 1) AS sessions,
          (SELECT COUNT(*) FROM local_hour WHERE dirty = 1) AS hours,
          (SELECT COUNT(*) FROM local_session
            WHERE ended_at IS NOT NULL AND archive_synced = 0) AS archives,
          (SELECT MIN(started_at) FROM local_session
            WHERE dirty = 1 OR (ended_at IS NOT NULL AND archive_synced = 0))
            AS pending_session_from,
          (SELECT MIN(bucket) FROM local_hour WHERE dirty = 1) AS pending_hour_from
      `,
      )
      .get() as Record<string, unknown>;
    const sessionFrom = toStrictIso(counts.pending_session_from);
    const hourFrom =
      typeof counts.pending_hour_from === "string"
        ? `${counts.pending_hour_from}:00:00.000Z`
        : null;
    // Both sides are strict UTC by the time they are compared, so this is a
    // chronological comparison and not a lexicographic accident.
    const pendingFrom =
      sessionFrom === null
        ? hourFrom
        : hourFrom === null
          ? sessionFrom
          : Date.parse(sessionFrom) <= Date.parse(hourFrom)
            ? sessionFrom
            : hourFrom;
    return {
      sessions: Number(counts.sessions ?? 0),
      hours: Number(counts.hours ?? 0),
      archives: Number(counts.archives ?? 0),
      pendingFrom,
    };
  } finally {
    database.close();
  }
}

/**
 * Normalize a stored instant to the strict UTC form the shared parsers demand.
 *
 * WHY THIS IS NEEDED. `event-validation.ts` accepts `z.iso.datetime({ offset:
 * true })`, so a stored `at` may legitimately read `2026-08-01T10:00:00+02:00`.
 * Every parser in `@seorak/types/data-plane` instead requires
 * `new Date(value).toISOString() === value`, which that form fails. Handing one
 * through unchanged makes a `RebaselineAcknowledgement` or a
 * `ManagedSyncCoverage` unparseable, and both fail SILENTLY: the handshake
 * simply never completes and the coverage read is discarded, with nothing
 * saying why. Normalizing at this boundary removes that whole class.
 *
 * Seorak's own hooks always write `Z` (`hooks.ts`, `new Date().toISOString()`),
 * so this is reachable only through an imported log or a future third-party
 * adapter. It is cheap enough to do unconditionally rather than to rely on that.
 *
 * A malformed value returns null rather than a guess, because a fabricated
 * instant is worse than an absent one.
 */
function toStrictIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * The oldest instant local history reaches, or null when it holds nothing.
 *
 * `MIN` over TEXT is a lexicographic comparison, which equals chronological
 * order for the `Z`-normalized instants Seorak writes. A log that mixed UTC
 * offsets can order two rows wrongly and name an instant later than the true
 * oldest.
 *
 * THE ERROR HAS ONE DIRECTION, AND IT IS THE SAFE ONE. `MIN` returns some row's
 * ACTUAL stored value, and the chronologically earliest value is by definition
 * no later than every value in the set. So whichever row the lexicographic
 * comparison picks, its instant is always at or after the true earliest, never
 * before it. This answers "how far back can a rebuild reach", so erring later
 * UNDERSTATES the reach: it promises less than will actually be rebuilt. That is
 * the opposite of the overclaim a remembered `acknowledged_history_from` would
 * have produced, which is why this value is the one worth serving.
 *
 * Left bounded rather than exact because closing it means scanning every event
 * row to answer a one-line UI claim, and the bound already rules out the only
 * dangerous direction. `managed-coverage.test.ts` pins it.
 */
export function localHistoryFrom(directory?: string): string | null {
  const database = openLocalHistory(directory);
  try {
    const row = database
      .prepare("SELECT MIN(at) AS first_at FROM local_event")
      .get() as { first_at?: unknown } | undefined;
    return toStrictIso(row?.first_at);
  } finally {
    database.close();
  }
}

/**
 * The newest instant local history reaches, or null when it holds nothing.
 *
 * The mirror of `localHistoryFrom`, and it inherits the same lexicographic
 * caveat with the same safe direction. `MAX` over TEXT returns some row's ACTUAL
 * stored value, and the chronologically latest value is by definition no earlier
 * than every value in the set, so a mixed-offset log can make this land at or
 * BEFORE the true newest, never after it.
 *
 * This answers "how far does what this plane serves actually reach", so erring
 * earlier UNDERSTATES the coverage: it claims less of the record than is really
 * there. That is the direction a completeness claim must err in, which is why
 * `selfHostedDataPlaneStatus` can build `synchronizedThrough` from it.
 */
export function localHistoryThrough(directory?: string): string | null {
  const database = openLocalHistory(directory);
  try {
    const row = database
      .prepare("SELECT MAX(at) AS last_at FROM local_event")
      .get() as { last_at?: unknown } | undefined;
    return toStrictIso(row?.last_at);
  } finally {
    database.close();
  }
}

/** Record that an upload was attempted. Separate from the result so a surface
 *  can tell "we have not tried since" from "we tried and it failed". */
export function recordLocalSyncAttempt(at: string, directory?: string): void {
  const database = openLocalHistory(directory);
  try {
    database
      .prepare(
        "UPDATE local_sync_state SET last_attempt_at = ? WHERE scope = 'managed'",
      )
      .run(at);
  } finally {
    database.close();
  }
}

export function recordLocalSyncError(
  input: { reason: string; at: string; retriable: boolean },
  directory?: string,
): void {
  const database = openLocalHistory(directory);
  try {
    database
      .prepare(
        `
        UPDATE local_sync_state
           SET last_error_reason = ?, last_error_at = ?, last_error_retriable = ?
         WHERE scope = 'managed'
      `,
      )
      .run(input.reason, input.at, input.retriable ? 1 : 0);
  } finally {
    database.close();
  }
}

export function cacheLocalDataPlaneStatus(
  statusJson: string,
  at: string,
  directory?: string,
): void {
  const database = openLocalHistory(directory);
  try {
    database
      .prepare(
        `
        UPDATE local_sync_state
           SET cached_data_plane_json = ?, cached_data_plane_at = ?
         WHERE scope = 'managed'
      `,
      )
      .run(statusJson, at);
  } finally {
    database.close();
  }
}

export function readLocalBaselineEpoch(directory?: string): number {
  const database = openLocalHistory(directory);
  try {
    const row = database
      .prepare(
        "SELECT baseline_epoch FROM local_sync_state WHERE scope = 'managed'",
      )
      .get() as { baseline_epoch?: unknown } | undefined;
    return Number(row?.baseline_epoch ?? 0);
  } finally {
    database.close();
  }
}

export interface LocalRebaselineResult {
  /** False when the directive was replayed, reordered, or already applied. */
  applied: boolean;
  baselineEpoch: number;
  /** Honest-null when local history no longer reaches back at all. */
  localHistoryFrom: string | null;
  /** Rows this installation can now resend. */
  resendable: { sessions: number; hours: number; archives: number };
}

/**
 * Rebuild the managed copy from authoritative local history.
 *
 * Every acknowledged projection and archive checkpoint is reset in ONE
 * transaction, and the epoch moves in that same transaction. That is what lets
 * the managed side distinguish a collector that genuinely restarted from one
 * that merely saw the directive: there is no interleaving in which the epoch has
 * advanced but the checkpoints have not.
 *
 * A lower or equal epoch is inert. This is the guard that makes a replayed or
 * reordered directive harmless rather than a silent discard of a healthy install
 * chain, so it is checked INSIDE the transaction against the durable value.
 *
 * Nothing local is deleted. `local_event` is untouched, which is why the answer
 * to "can you reconstruct it?" is a count rather than a hope.
 */
export function applyLocalRebaseline(
  baselineEpoch: number,
  directory?: string,
  now: string = new Date().toISOString(),
): LocalRebaselineResult {
  const database = openLocalHistory(directory);
  try {
    return transaction(database, () => {
      const current = Number(
        (
          database
            .prepare(
              "SELECT baseline_epoch FROM local_sync_state WHERE scope = 'managed'",
            )
            .get() as { baseline_epoch?: unknown } | undefined
        )?.baseline_epoch ?? 0,
      );
      const first = database
        .prepare("SELECT MIN(at) AS first_at FROM local_event")
        .get() as { first_at?: unknown } | undefined;
      // Normalized for the same reason `localHistoryFrom` is: this value goes
      // straight into a `RebaselineAcknowledgement`, whose parser demands strict
      // UTC and whose rejection is silent.
      const history = toStrictIso(first?.first_at);
      if (!Number.isSafeInteger(baselineEpoch) || baselineEpoch <= current) {
        const counts = database
          .prepare(
            `
            SELECT
              (SELECT COUNT(*) FROM local_session WHERE dirty = 1) AS sessions,
              (SELECT COUNT(*) FROM local_hour WHERE dirty = 1) AS hours,
              (SELECT COUNT(*) FROM local_session
                WHERE ended_at IS NOT NULL AND archive_synced = 0) AS archives
          `,
          )
          .get() as Record<string, unknown>;
        return {
          applied: false,
          baselineEpoch: current,
          localHistoryFrom: history,
          resendable: {
            sessions: Number(counts.sessions ?? 0),
            hours: Number(counts.hours ?? 0),
            archives: Number(counts.archives ?? 0),
          },
        };
      }
      database.exec(`
        DELETE FROM local_archive_checkpoint;
        UPDATE local_session
           SET synced_revision = 0,
               dirty = 1,
               archive_synced = 0,
               archive_digest = NULL,
               next_sync_at_ms = 0;
        UPDATE local_hour SET synced_revision = 0, dirty = 1;
        UPDATE local_transition SET synced = 0;
      `);
      database
        .prepare(
          `
          UPDATE local_sync_state
             SET baseline_epoch = ?,
                 next_sequence = 1,
                 previous_batch_sha256 = NULL,
                 pending_batch_json = NULL,
                 pending_candidate_json = NULL,
                 synchronized_through = NULL,
                 last_accepted_at = NULL,
                 last_error_reason = NULL,
                 last_error_at = NULL,
                 last_error_retriable = NULL,
                 activated_at = COALESCE(activated_at, ?)
           WHERE scope = 'managed'
        `,
        )
        .run(baselineEpoch, now);
      const counts = database
        .prepare(
          `
          SELECT
            (SELECT COUNT(*) FROM local_session) AS sessions,
            (SELECT COUNT(*) FROM local_hour) AS hours,
            (SELECT COUNT(*) FROM local_session WHERE ended_at IS NOT NULL) AS archives
        `,
        )
        .get() as Record<string, unknown>;
      return {
        applied: true,
        baselineEpoch,
        localHistoryFrom: history,
        resendable: {
          sessions: Number(counts.sessions ?? 0),
          hours: Number(counts.hours ?? 0),
          archives: Number(counts.archives ?? 0),
        },
      };
    });
  } finally {
    database.close();
  }
}

export function cacheLocalEntitlement(
  entitlementJson: string,
  expiresAt: string,
  directory?: string,
): void {
  const database = openLocalHistory(directory);
  try {
    database
      .prepare(
        `
        UPDATE local_sync_state
           SET cached_entitlement_json = ?, entitlement_expires_at = ?
         WHERE scope = 'managed'
      `,
      )
      .run(entitlementJson, expiresAt);
  } finally {
    database.close();
  }
}

export function persistPendingCompactSync(
  input: {
    installationId: string;
    batchJson: string;
    candidateJson: string;
  },
  directory?: string,
): void {
  const database = openLocalHistory(directory);
  try {
    transaction(database, () => {
      const state = database
        .prepare(
          "SELECT installation_id, pending_batch_json FROM local_sync_state WHERE scope = 'managed'",
        )
        .get() as { installation_id?: unknown; pending_batch_json?: unknown };
      if (typeof state.pending_batch_json === "string") {
        if (state.pending_batch_json !== input.batchJson) {
          throw new Error("a different compact sync batch is already pending");
        }
        return;
      }
      if (
        typeof state.installation_id === "string" &&
        state.installation_id !== input.installationId
      ) {
        throw new Error("compact sync installation identity changed");
      }
      database
        .prepare(
          `
          UPDATE local_sync_state
             SET installation_id = COALESCE(installation_id, ?),
                 pending_batch_json = ?, pending_candidate_json = ?
           WHERE scope = 'managed'
        `,
        )
        .run(input.installationId, input.batchJson, input.candidateJson);
    });
  } finally {
    database.close();
  }
}

/**
 * The newest local instant this candidate covered.
 *
 * Sessions carry their own last event instant; an hour bucket covers everything
 * up to the end of that hour, so its close is the instant it acknowledges. A
 * candidate carrying only archives or transitions covers no new instant, which
 * is why this returns null rather than reaching for "now".
 */
function candidateCoversThrough(candidate: LocalSyncCandidate): string | null {
  let covered: string | null = null;
  for (const session of candidate.sessions) {
    if (covered === null || session.lastEventAt > covered) {
      covered = session.lastEventAt;
    }
  }
  for (const hour of candidate.hours) {
    const close = `${hour.bucket}:59:59.999Z`;
    if (covered === null || close > covered) covered = close;
  }
  return covered;
}

function recordCandidateCoverage(
  database: DatabaseSync,
  candidate: LocalSyncCandidate,
  now: string,
): void {
  const covered = candidateCoversThrough(candidate);
  database
    .prepare(
      `
      UPDATE local_sync_state
         SET synchronized_through = CASE
               WHEN ?1 IS NULL THEN synchronized_through
               WHEN synchronized_through IS NULL OR ?1 > synchronized_through THEN ?1
               ELSE synchronized_through
             END,
             last_accepted_at = ?2,
             last_error_reason = NULL,
             last_error_at = NULL,
             last_error_retriable = NULL
       WHERE scope = 'managed'
    `,
    )
    .run(covered, now);
}

function acknowledgeCandidateOnDatabase(
  database: DatabaseSync,
  candidate: LocalSyncCandidate,
): void {
  for (const session of candidate.sessions) {
    database
      .prepare(
        `
        UPDATE local_session
           SET synced_revision = MAX(synced_revision, ?),
               dirty = CASE WHEN revision <= ? THEN 0 ELSE 1 END
         WHERE session_id = ?
      `,
      )
      .run(session.revision, session.revision, session.sessionId);
  }
  for (const hour of candidate.hours) {
    database
      .prepare(
        `
        UPDATE local_hour
           SET synced_revision = MAX(synced_revision, ?),
               dirty = CASE WHEN revision <= ? THEN 0 ELSE 1 END
         WHERE bucket = ? AND session_id = ?
      `,
      )
      .run(hour.revision, hour.revision, hour.bucket, hour.sessionId);
  }
  for (const transition of candidate.transitions) {
    database
      .prepare("UPDATE local_transition SET synced = 1 WHERE event_id = ?")
      .run(transition.eventId);
  }
  for (const archive of candidate.archives) {
    database
      .prepare(
        `
        INSERT INTO local_archive_checkpoint (
          session_id, last_local_sequence, updated_at
        ) VALUES (?, ?, ?)
        ON CONFLICT (session_id) DO UPDATE SET
          last_local_sequence = MAX(
            local_archive_checkpoint.last_local_sequence,
            excluded.last_local_sequence
          ),
          updated_at = excluded.updated_at
      `,
      )
      .run(
        archive.sessionId,
        archive.lastLocalSequence,
        new Date().toISOString(),
      );
    database
      .prepare(
        `
        UPDATE local_session
           SET archive_digest = ?,
               archive_synced = CASE WHEN NOT EXISTS (
                 SELECT 1 FROM local_event
                  WHERE session_id = ? AND local_seq > ?
               ) THEN 1 ELSE 0 END
         WHERE session_id = ?
      `,
      )
      .run(
        archive.contentDigest,
        archive.sessionId,
        archive.lastLocalSequence,
        archive.sessionId,
      );
  }
}

export function acknowledgePendingCompactSync(
  input: {
    batchId: string;
    batchSha256: string;
    candidate: LocalSyncCandidate;
  },
  directory?: string,
): void {
  const database = openLocalHistory(directory);
  try {
    transaction(database, () => {
      const state = database
        .prepare(
          "SELECT pending_batch_json FROM local_sync_state WHERE scope = 'managed'",
        )
        .get() as { pending_batch_json?: unknown };
      if (typeof state.pending_batch_json !== "string") {
        throw new Error("compact sync acknowledgement has no pending batch");
      }
      const pending = JSON.parse(state.pending_batch_json) as {
        batchId?: unknown;
        batchSha256?: unknown;
      };
      if (
        pending.batchId !== input.batchId ||
        pending.batchSha256 !== input.batchSha256
      ) {
        throw new Error(
          "compact sync acknowledgement does not match pending batch",
        );
      }
      const now = new Date().toISOString();
      acknowledgeCandidateOnDatabase(database, input.candidate);
      database
        .prepare(
          `
          UPDATE local_sync_state
             SET mode = 'compact-v1',
                 activated_at = COALESCE(activated_at, ?),
                 next_sequence = next_sequence + 1,
                 previous_batch_sha256 = ?,
                 pending_batch_json = NULL,
                 pending_candidate_json = NULL
           WHERE scope = 'managed'
        `,
        )
        .run(now, input.batchSha256);
      // Coverage advances in the same transaction as the checkpoints it
      // describes, so a surface can never read a synchronized-through instant
      // for rows that are still dirty.
      recordCandidateCoverage(database, input.candidate, now);
    });
  } finally {
    database.close();
  }
}

export function compactSyncActivated(directory?: string): boolean {
  const database = openLocalHistory(directory);
  try {
    const row = database
      .prepare("SELECT mode FROM local_sync_state WHERE scope = 'managed'")
      .get() as { mode?: unknown } | undefined;
    return row?.mode === "compact-v1";
  } finally {
    database.close();
  }
}

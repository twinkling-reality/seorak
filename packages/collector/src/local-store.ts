import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import type { SessionEvent } from "@seorak/types";
import { priceModels } from "@seorak/types";
import { parseSessionEvent } from "@seorak/types/event-validation";
import { localHistoryDatabasePath } from "./paths.ts";

export const LOCAL_HISTORY_SCHEMA_VERSION = 5;
export const LOCAL_SESSION_SYNC_CADENCE_MS = 5 * 60 * 1000;
const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export interface LocalHistoryCounts {
  events: number;
  sessions: number;
  completedSessions: number;
  pendingSessions: number;
  pendingTransitions: number;
  pendingHours: number;
}

export interface LocalSessionRow {
  sessionId: string;
  revision: number;
  startedAt: string;
  lastEventAt: string;
  endedAt: string | null;
  repoId: string;
  repoLabel: string;
  agent: string;
  status: "active" | "needs-you" | "ended";
  eventCount: number;
  toolCallCount: number;
  erroredToolCallCount: number;
  promptCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
}

export interface LocalHourRow {
  bucket: string;
  sessionId: string;
  revision: number;
  agent: string;
  eventCount: number;
  toolCallCount: number;
  erroredToolCallCount: number;
  promptCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
}

export interface LocalTransitionRow {
  eventId: string;
  sessionId: string;
  at: string;
  transition: "started" | "needs-you" | "resumed" | "completed";
}

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

/** v1 -> v2: compact-sync install chain, pending batch, and archive checkpoints. */
const UPGRADE_TO_V2 = `
  ALTER TABLE local_sync_state ADD COLUMN installation_id TEXT;
  ALTER TABLE local_sync_state ADD COLUMN next_sequence INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE local_sync_state ADD COLUMN previous_batch_sha256 TEXT;
  ALTER TABLE local_sync_state ADD COLUMN pending_batch_json TEXT;
  ALTER TABLE local_sync_state ADD COLUMN pending_candidate_json TEXT;
  ALTER TABLE local_sync_state ADD COLUMN cached_entitlement_json TEXT;
  ALTER TABLE local_sync_state ADD COLUMN entitlement_expires_at TEXT;
  CREATE TABLE local_archive_checkpoint (
    session_id TEXT PRIMARY KEY,
    last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
    updated_at TEXT NOT NULL
  ) STRICT, WITHOUT ROWID;
`;

/**
 * v2 -> v3: the coverage a surface can actually show, and the rebaseline epoch.
 *
 * `synchronized_through` is recorded at acknowledgement rather than recomputed,
 * because the honest answer to "what does the remote copy hold?" is the newest
 * instant a RECEIPT covered, not the newest instant that happens to look clean.
 * `baseline_epoch` is the monotonic guard that makes a replayed rebaseline
 * directive inert.
 */
const UPGRADE_TO_V3 = `
  ALTER TABLE local_sync_state ADD COLUMN synchronized_through TEXT;
  ALTER TABLE local_sync_state ADD COLUMN last_accepted_at TEXT;
  ALTER TABLE local_sync_state ADD COLUMN last_attempt_at TEXT;
  ALTER TABLE local_sync_state ADD COLUMN last_error_reason TEXT;
  ALTER TABLE local_sync_state ADD COLUMN last_error_at TEXT;
  ALTER TABLE local_sync_state ADD COLUMN last_error_retriable INTEGER;
  ALTER TABLE local_sync_state ADD COLUMN baseline_epoch INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE local_sync_state ADD COLUMN cached_data_plane_json TEXT;
  ALTER TABLE local_sync_state ADD COLUMN cached_data_plane_at TEXT;
`;

/**
 * v3 -> v4: the local intervention ledger.
 *
 * A fire is RECORDED here whether or not it was delivered, because the history
 * view and the delivery decision are different questions: a fire held by quiet
 * hours still happened, and a plane with no delivery path at all still measured
 * the crossing. `dedupe_key` carries the rolling-window identity so the same
 * crossing cannot be recorded twice by two ticks.
 */
const UPGRADE_TO_V4 = `
  CREATE TABLE local_intervention_fire (
    fire_id TEXT PRIMARY KEY,
    dedupe_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    session_id TEXT NOT NULL,
    repo_id TEXT NOT NULL,
    intervention_json TEXT NOT NULL CHECK (json_valid(intervention_json)),
    held INTEGER NOT NULL CHECK (held IN (0, 1)),
    triggered_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX idx_local_intervention_fire_dedupe
    ON local_intervention_fire (dedupe_key, triggered_at);
  CREATE INDEX idx_local_intervention_fire_triggered
    ON local_intervention_fire (triggered_at);
`;

/**
 * v4 -> v5: account-free private integration authority and opaque query state.
 *
 * Raw integration secrets and cursors never enter this database. Credentials
 * retain only the secret half's SHA-256 digest; cursors retain only the whole
 * opaque token's digest. External project/session references are random stored
 * mappings rather than encodings of the local identifiers they name.
 *
 * `local_integration_projection_epoch` is advanced by every visible-session
 * mutation. A cursor therefore resumes only the exact snapshot it was minted
 * against, or fails and asks the caller to restart instead of returning a
 * plausible partial traversal.
 */
const UPGRADE_TO_V5 = `
  CREATE TABLE local_integration_credential (
    credential_id TEXT PRIMARY KEY CHECK (
      length(credential_id) = 32
      AND credential_id NOT GLOB '*[^0-9a-f]*'
    ),
    secret_hash TEXT NOT NULL CHECK (
      length(secret_hash) = 64
      AND secret_hash NOT GLOB '*[^0-9a-f]*'
    ),
    audience TEXT NOT NULL CHECK (length(audience) BETWEEN 1 AND 512),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT,
    repo_id TEXT CHECK (
      repo_id IS NULL OR (
        length(repo_id) = 64
        AND repo_id NOT GLOB '*[^0-9a-f]*'
      )
    ),
    data_not_before TEXT,
    data_not_after TEXT
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX idx_local_integration_credential_active
    ON local_integration_credential (revoked_at, expires_at, created_at);

  CREATE TABLE local_integration_credential_scope (
    credential_id TEXT NOT NULL
      REFERENCES local_integration_credential(credential_id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (
      scope IN ('period:read', 'sessions:read', 'replay:read')
    ),
    PRIMARY KEY (credential_id, scope)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE local_integration_denial_state (
    credential_id TEXT NOT NULL
      REFERENCES local_integration_credential(credential_id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (
      reason IN ('expired', 'revoked', 'audience', 'scope', 'rate_limited', 'route_rate_limited')
    ),
    at TEXT NOT NULL,
    PRIMARY KEY (credential_id, reason)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE local_integration_credential_budget (
    credential_id TEXT PRIMARY KEY
      REFERENCES local_integration_credential(credential_id) ON DELETE CASCADE,
    tokens REAL NOT NULL CHECK (tokens >= 0 AND tokens <= 60),
    updated_at TEXT NOT NULL,
    limited INTEGER NOT NULL DEFAULT 0 CHECK (limited IN (0, 1))
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE local_integration_route_budget (
    route_class TEXT PRIMARY KEY CHECK (route_class IN ('read', 'aggregate')),
    tokens REAL NOT NULL CHECK (tokens >= 0 AND tokens <= 600),
    updated_at TEXT NOT NULL,
    limited INTEGER NOT NULL DEFAULT 0 CHECK (limited IN (0, 1))
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE local_integration_clock (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    last_seen_ms INTEGER NOT NULL CHECK (last_seen_ms >= 0)
  ) STRICT, WITHOUT ROWID;
  INSERT INTO local_integration_clock (singleton, last_seen_ms) VALUES (1, 0);

  CREATE TABLE local_integration_authorization_audit (
    audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    credential_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (
      action IN ('issued', 'revoked', 'authorized', 'denied', 'rate_limited')
    ),
    scope TEXT CHECK (
      scope IS NULL OR scope IN ('period:read', 'sessions:read', 'replay:read')
    ),
    reason TEXT CHECK (
      reason IS NULL OR reason IN (
        'expired', 'revoked', 'audience', 'scope', 'rate_limited',
        'route_rate_limited'
      )
    ),
    at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX idx_local_integration_audit_credential
    ON local_integration_authorization_audit (credential_id, at DESC);

  CREATE TRIGGER local_integration_audit_bound
  AFTER INSERT ON local_integration_authorization_audit
  BEGIN
    DELETE FROM local_integration_authorization_audit
     WHERE credential_id = NEW.credential_id
       AND audit_id NOT IN (
         SELECT audit_id FROM local_integration_authorization_audit
          WHERE credential_id = NEW.credential_id
          ORDER BY audit_id DESC
          LIMIT 500
       );
    DELETE FROM local_integration_authorization_audit
     WHERE audit_id <= NEW.audit_id - 5000;
  END;

  CREATE TABLE local_integration_query_audit (
    audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    credential_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (
      operation IN ('period_summary', 'list_sessions', 'get_session_outcome', 'replay_lens')
    ),
    result TEXT NOT NULL CHECK (
      result IN ('ok', 'unavailable', 'refused', 'protocol_error', 'internal_error', 'oversized')
    ),
    http_status INTEGER NOT NULL CHECK (http_status BETWEEN 100 AND 599),
    returned_count INTEGER CHECK (returned_count IS NULL OR returned_count >= 0),
    response_bytes INTEGER CHECK (response_bytes IS NULL OR response_bytes >= 0),
    at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX idx_local_integration_query_audit_credential
    ON local_integration_query_audit (credential_id, at DESC);

  CREATE TRIGGER local_integration_query_audit_bound
  AFTER INSERT ON local_integration_query_audit
  BEGIN
    DELETE FROM local_integration_query_audit
     WHERE credential_id = NEW.credential_id
       AND audit_id NOT IN (
         SELECT audit_id FROM local_integration_query_audit
          WHERE credential_id = NEW.credential_id
          ORDER BY audit_id DESC
          LIMIT 500
       );
    DELETE FROM local_integration_query_audit
     WHERE audit_id <= NEW.audit_id - 5000;
  END;

  CREATE TABLE local_integration_project_ref (
    external_ref TEXT PRIMARY KEY CHECK (
      length(external_ref) = 36
      AND substr(external_ref, 1, 4) = 'prj_'
      AND substr(external_ref, 5) NOT GLOB '*[^0-9a-f]*'
    ),
    repo_id TEXT NOT NULL UNIQUE CHECK (
      length(repo_id) = 64
      AND repo_id NOT GLOB '*[^0-9a-f]*'
    ),
    created_at TEXT NOT NULL
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE local_integration_session_ref (
    external_ref TEXT PRIMARY KEY CHECK (
      length(external_ref) = 36
      AND substr(external_ref, 1, 4) = 'ses_'
      AND substr(external_ref, 5) NOT GLOB '*[^0-9a-f]*'
    ),
    session_id TEXT NOT NULL UNIQUE
      REFERENCES local_session(session_id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE local_integration_projection_epoch (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    value INTEGER NOT NULL CHECK (value >= 0)
  ) STRICT, WITHOUT ROWID;
  INSERT INTO local_integration_projection_epoch (singleton, value)
  VALUES (1, 1);

  CREATE TABLE local_integration_cursor (
    cursor_hash TEXT PRIMARY KEY CHECK (
      length(cursor_hash) = 64
      AND cursor_hash NOT GLOB '*[^0-9a-f]*'
    ),
    credential_id TEXT NOT NULL
      REFERENCES local_integration_credential(credential_id) ON DELETE CASCADE,
    projection_epoch INTEGER NOT NULL CHECK (projection_epoch >= 0),
    last_event_at TEXT NOT NULL,
    session_id TEXT NOT NULL
      REFERENCES local_session(session_id) ON DELETE CASCADE,
    repo_id TEXT CHECK (
      repo_id IS NULL OR (
        length(repo_id) = 64
        AND repo_id NOT GLOB '*[^0-9a-f]*'
      )
    ),
    requested_since TEXT NOT NULL,
    requested_until TEXT NOT NULL,
    confidential_since TEXT,
    confidential_until TEXT,
    total_matched INTEGER NOT NULL CHECK (total_matched >= 0),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX idx_local_integration_cursor_expiry
    ON local_integration_cursor (expires_at);
`;

const LOCAL_INTEGRATION_EPOCH_TRIGGERS = `
  CREATE TRIGGER local_integration_epoch_insert
  AFTER INSERT ON local_session
  BEGIN
    UPDATE local_integration_projection_epoch SET value = value + 1 WHERE singleton = 1;
  END;

  CREATE TRIGGER local_integration_epoch_update
  AFTER UPDATE ON local_session
  BEGIN
    UPDATE local_integration_projection_epoch SET value = value + 1 WHERE singleton = 1;
  END;

  CREATE TRIGGER local_integration_epoch_delete
  AFTER DELETE ON local_session
  BEGIN
    UPDATE local_integration_projection_epoch SET value = value + 1 WHERE singleton = 1;
  END;
`;

function ensureSchema(database: DatabaseSync): void {
  const version = Number(
    (
      database.prepare("PRAGMA user_version").get() as
        { user_version?: unknown } | undefined
    )?.user_version,
  );
  if (version === LOCAL_HISTORY_SCHEMA_VERSION) return;
  if (version === 1 || version === 2 || version === 3 || version === 4) {
    transaction(database, () => {
      database.exec(`
        ${version === 1 ? UPGRADE_TO_V2 : ""}
        ${version === 1 || version === 2 ? UPGRADE_TO_V3 : ""}
        ${version === 1 || version === 2 || version === 3 ? UPGRADE_TO_V4 : ""}
        ${UPGRADE_TO_V5}
      `);
      const hasSessions = database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_session'",
        )
        .get();
      if (hasSessions !== undefined)
        database.exec(LOCAL_INTEGRATION_EPOCH_TRIGGERS);
      database.exec(`PRAGMA user_version = ${LOCAL_HISTORY_SCHEMA_VERSION}`);
    });
    return;
  }
  if (version !== 0) {
    throw new Error(
      `unsupported local history database version ${String(version)}`,
    );
  }
  transaction(database, () => {
    const lockedVersion = Number(
      (
        database.prepare("PRAGMA user_version").get() as
          { user_version?: unknown } | undefined
      )?.user_version,
    );
    if (lockedVersion === LOCAL_HISTORY_SCHEMA_VERSION) return;
    if (lockedVersion !== 0) {
      throw new Error(
        `unsupported local history database version ${String(lockedVersion)}`,
      );
    }
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    if (tables.length > 0) {
      throw new Error("local history database has an unversioned schema");
    }
    database.exec(`
      CREATE TABLE local_event (
        local_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        at TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
        captured_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_local_event_session_seq
        ON local_event (session_id, local_seq);
      CREATE INDEX idx_local_event_at
        ON local_event (at, local_seq);

      CREATE TABLE local_session (
        session_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        started_at TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        ended_at TEXT,
        repo_id TEXT NOT NULL,
        repo_label TEXT NOT NULL,
        agent TEXT NOT NULL,
        awaiting_input INTEGER NOT NULL CHECK (awaiting_input IN (0, 1)),
        event_count INTEGER NOT NULL CHECK (event_count >= 0),
        tool_call_count INTEGER NOT NULL CHECK (tool_call_count >= 0),
        errored_tool_call_count INTEGER NOT NULL CHECK (errored_tool_call_count >= 0),
        prompt_count INTEGER NOT NULL CHECK (prompt_count >= 0),
        input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
        output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
        cache_read_tokens INTEGER NOT NULL CHECK (cache_read_tokens >= 0),
        cache_write_tokens INTEGER NOT NULL CHECK (cache_write_tokens >= 0),
        cost_usd REAL NOT NULL CHECK (cost_usd >= 0),
        cost_known INTEGER NOT NULL CHECK (cost_known IN (0, 1)),
        dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
        next_sync_at_ms INTEGER NOT NULL CHECK (next_sync_at_ms >= 0),
        synced_revision INTEGER NOT NULL DEFAULT 0 CHECK (synced_revision >= 0),
        archive_digest TEXT,
        archive_synced INTEGER NOT NULL DEFAULT 0 CHECK (archive_synced IN (0, 1))
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX idx_local_session_sync_due
        ON local_session (dirty, next_sync_at_ms, session_id);

      CREATE TABLE local_hour (
        bucket TEXT NOT NULL,
        session_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        agent TEXT NOT NULL,
        event_count INTEGER NOT NULL CHECK (event_count >= 0),
        tool_call_count INTEGER NOT NULL CHECK (tool_call_count >= 0),
        errored_tool_call_count INTEGER NOT NULL CHECK (errored_tool_call_count >= 0),
        prompt_count INTEGER NOT NULL CHECK (prompt_count >= 0),
        input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
        output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
        cache_read_tokens INTEGER NOT NULL CHECK (cache_read_tokens >= 0),
        cache_write_tokens INTEGER NOT NULL CHECK (cache_write_tokens >= 0),
        cost_usd REAL NOT NULL CHECK (cost_usd >= 0),
        cost_known INTEGER NOT NULL CHECK (cost_known IN (0, 1)),
        dirty INTEGER NOT NULL CHECK (dirty IN (0, 1)),
        synced_revision INTEGER NOT NULL DEFAULT 0 CHECK (synced_revision >= 0),
        PRIMARY KEY (bucket, session_id)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX idx_local_hour_dirty
        ON local_hour (dirty, bucket, session_id);

      CREATE TABLE local_transition (
        event_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        at TEXT NOT NULL,
        transition TEXT NOT NULL CHECK (
          transition IN ('started', 'needs-you', 'resumed', 'completed')
        ),
        synced INTEGER NOT NULL DEFAULT 0 CHECK (synced IN (0, 1))
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX idx_local_transition_pending
        ON local_transition (synced, at, event_id);

      CREATE TABLE local_import_state (
        source TEXT PRIMARY KEY CHECK (source = 'events.jsonl'),
        digest TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        accepted INTEGER NOT NULL CHECK (accepted >= 0),
        rejected INTEGER NOT NULL CHECK (rejected >= 0)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE local_archive_checkpoint (
        session_id TEXT PRIMARY KEY,
        last_local_sequence INTEGER NOT NULL CHECK (last_local_sequence >= 0),
        updated_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE local_sync_state (
        scope TEXT PRIMARY KEY CHECK (scope = 'managed'),
        mode TEXT NOT NULL CHECK (mode IN ('inactive', 'compact-v1')),
        activated_at TEXT,
        installation_id TEXT,
        next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_sequence >= 1),
        previous_batch_sha256 TEXT,
        pending_batch_json TEXT CHECK (
          pending_batch_json IS NULL OR json_valid(pending_batch_json)
        ),
        pending_candidate_json TEXT CHECK (
          pending_candidate_json IS NULL OR json_valid(pending_candidate_json)
        ),
        cached_entitlement_json TEXT CHECK (
          cached_entitlement_json IS NULL OR json_valid(cached_entitlement_json)
        ),
        entitlement_expires_at TEXT,
        -- Column definitions below match UPGRADE_TO_V3 exactly. SQLite cannot
        -- add a CHECK through ALTER TABLE, so a constraint written only here
        -- would make a fresh database and an upgraded one different schemas.
        synchronized_through TEXT,
        last_accepted_at TEXT,
        last_attempt_at TEXT,
        last_error_reason TEXT,
        last_error_at TEXT,
        last_error_retriable INTEGER,
        baseline_epoch INTEGER NOT NULL DEFAULT 0,
        cached_data_plane_json TEXT,
        cached_data_plane_at TEXT
      ) STRICT, WITHOUT ROWID;
      INSERT INTO local_sync_state (scope, mode, activated_at)
      VALUES ('managed', 'inactive', NULL);

      ${UPGRADE_TO_V4}

      ${UPGRADE_TO_V5}

      ${LOCAL_INTEGRATION_EPOCH_TRIGGERS}

      PRAGMA user_version = ${LOCAL_HISTORY_SCHEMA_VERSION};
    `);
  });
}

/* -------------------------------------------------------------------------- */
/* Intervention ledger                                                         */
/* -------------------------------------------------------------------------- */

/** The rolling window a fire both dedupes against and is listed from. */
export const LOCAL_INTERVENTION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Bound on one history read, so a pathological log cannot return unboundedly. */
export const LOCAL_INTERVENTION_HISTORY_LIMIT = 500;

/**
 * Record one fire unless the same identity already fired inside the rolling
 * window. Returns false when it was deduped, so only the caller that actually
 * inserted the row may go on to deliver it.
 *
 * The existence check and the insert are ONE statement: the plane's read path
 * and the daemon's sweep are separate processes against the same file, and two
 * of them evaluating the same crossing a millisecond apart must not both win.
 */
export function recordLocalInterventionFire(
  fire: {
    kind: string;
    sessionId: string;
    repoId: string;
    triggeredAt: string;
  },
  interventionJson: string,
  dedupeKey: string,
  held: boolean,
  options: { directory?: string; nowMs?: number } = {},
): boolean {
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(
    nowMs - LOCAL_INTERVENTION_WINDOW_MS,
  ).toISOString();
  const database = openLocalHistory(options.directory);
  try {
    const changes = database
      .prepare(
        `INSERT INTO local_intervention_fire (
           fire_id, dedupe_key, kind, session_id, repo_id,
           intervention_json, held, triggered_at, created_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM local_intervention_fire
             WHERE dedupe_key = ?
               AND triggered_at > ?
               AND triggered_at <= ?
          )`,
      )
      .run(
        createHash("sha256")
          // `\u0000` as an ESCAPE, never a literal NUL. One raw NUL byte makes
          // this entire 1,900-line file read as BINARY to grep, file, and every
          // other text tool, which silently hides every symbol in it from anyone
          // auditing the module. `CURSOR_SEPARATOR` below documents the same rule;
          // the two are the same decision and must stay spelled the same way.
          .update(`${dedupeKey}\u0000${fire.triggeredAt}`)
          .digest("hex"),
        dedupeKey,
        fire.kind,
        fire.sessionId,
        fire.repoId,
        interventionJson,
        held ? 1 : 0,
        fire.triggeredAt,
        nowIso,
        dedupeKey,
        cutoffIso,
        nowIso,
      );
    if (Number(changes.changes) === 0) return false;
    // Prune past the window in the same call. The ledger answers one rolling
    // day, so anything older is unreadable by every caller and only grows the
    // file; the retention rule and the read bound stay the same number.
    database
      .prepare("DELETE FROM local_intervention_fire WHERE triggered_at <= ?")
      .run(cutoffIso);
    return true;
  } finally {
    database.close();
  }
}

/**
 * Fires inside the rolling window, newest first, as stored JSON strings.
 *
 * The caller decodes: this module owns the table, not the `Intervention`
 * contract, and a row that no longer parses must be dropped by the layer that
 * knows the shape rather than half-read here.
 */
export function listLocalInterventionFires(
  options: { directory?: string; nowMs?: number; limit?: number } = {},
): string[] {
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(
    nowMs - LOCAL_INTERVENTION_WINDOW_MS,
  ).toISOString();
  const limit = Math.max(
    1,
    Math.min(
      LOCAL_INTERVENTION_HISTORY_LIMIT,
      options.limit ?? LOCAL_INTERVENTION_HISTORY_LIMIT,
    ),
  );
  const database = openLocalHistory(options.directory);
  try {
    return database
      .prepare(
        `SELECT intervention_json FROM local_intervention_fire
          WHERE triggered_at > ? AND triggered_at <= ?
          ORDER BY triggered_at DESC, created_at DESC, fire_id DESC
          LIMIT ?`,
      )
      .all(cutoffIso, nowIso, limit)
      .map((row) =>
        String((row as { intervention_json?: unknown }).intervention_json),
      );
  } finally {
    database.close();
  }
}

export function openLocalHistory(directory?: string): DatabaseSync {
  const path = localHistoryDatabasePath(directory);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const existed = existsSync(path);
  if (existed) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`local history database is not a regular file: ${path}`);
    }
  }
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
    `);
    ensureSchema(database);
    if (!existed) chmodSync(path, 0o600);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function hourBucket(at: string): string {
  return at.slice(0, 13);
}

function eventCounters(event: SessionEvent): {
  toolCalls: number;
  erroredCalls: number;
  prompts: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
} {
  if (event.kind === "tool.call") {
    const priced = event.models === undefined ? null : priceModels(event.models);
    return {
      toolCalls: 1,
      erroredCalls: event.errored === true ? 1 : 0,
      prompts: 0,
      input: event.inputTokens,
      output: event.outputTokens,
      cacheRead: event.cacheReadTokens,
      cacheWrite: event.cacheWriteTokens,
      // The worker's canonical SessionSummary reprices model carriers from the
      // shared table. Persist that same derived figure here: the top-level
      // `costUsd` is a legacy fallback and current collectors commonly stamp 0
      // beside a complete models[] carrier.
      cost: priced?.priced ? priced.costUsd : event.costUsd,
    };
  }
  return {
    toolCalls: 0,
    erroredCalls: 0,
    prompts: event.kind === "session.prompt" ? 1 : 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };
}

function transitionOf(
  event: SessionEvent,
  wasAwaitingInput: boolean,
): LocalTransitionRow["transition"] | null {
  if (event.kind === "session.start") return "started";
  if (event.kind === "session.end") return "completed";
  if (
    event.kind === "session.notification" &&
    event.notificationType === "permission_prompt"
  ) {
    return "needs-you";
  }
  if (event.kind === "tool.call" && wasAwaitingInput) return "resumed";
  return null;
}

function eventCostKnown(event: SessionEvent): boolean {
  if (event.kind === "session.tokens") return priceModels(event.models).priced;
  if (event.kind !== "tool.call") return true;
  if (event.models) return priceModels(event.models).priced;
  const tokens =
    event.inputTokens +
    event.outputTokens +
    event.cacheReadTokens +
    event.cacheWriteTokens;
  return tokens === 0 || event.costUsd > 0;
}

function insertEvent(
  database: DatabaseSync,
  event: SessionEvent,
  payload: string,
): boolean {
  const result = database
    .prepare(
      `
      INSERT OR IGNORE INTO local_event (
        event_id, session_id, kind, at, payload_json, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      event.eventId,
      event.sessionId,
      event.kind,
      event.at,
      payload,
      new Date().toISOString(),
    ) as StatementResultingChanges;
  return Number(result.changes) === 1;
}

/**
 * Whether an event moves a session's LIVENESS, or only carries data about it.
 *
 * The worker's `applyBatch` skips every non-lifecycle kind before the reducer
 * runs, and says why: `git.momentum` "carries a session's originating id but is
 * a cumulative per-repo snapshot", and reducing it "would bump liveness off a
 * repo metric". `session.tokens`, `session.delta` and `session.linesurvival`
 * ride the same skip — a cumulative snapshot, a git rollup and a survival check
 * are all facts ABOUT a session, none of them the session doing anything.
 *
 * This plane advanced `last_event_at` on all of them, and `last_event_at` is
 * what decides both windows the read model asks about: which sessions the
 * period HOLDS (`usage.totals.sessions` and every resident sum under it) and
 * how long a session has been silent (`statusFromSilence`, the live board). A
 * Codex session that stopped a week ago whose cumulative carrier was re-shipped
 * yesterday therefore counted as a session of THIS period and read as still
 * active — the "dead session shown as in flight" hole the reaper exists to
 * close, reopened one row lower down.
 */
function advancesLiveness(event: SessionEvent): boolean {
  return (
    event.kind === "session.start" ||
    event.kind === "tool.call" ||
    event.kind === "session.end" ||
    event.kind === "session.notification"
  );
}

function projectEvent(database: DatabaseSync, event: SessionEvent): void {
  const counters = eventCounters(event);
  const costKnown = eventCostKnown(event);
  const now = Date.now();
  const prior = database
    .prepare("SELECT awaiting_input FROM local_session WHERE session_id = ?")
    .get(event.sessionId) as { awaiting_input?: unknown } | undefined;
  const transition = transitionOf(event, Number(prior?.awaiting_input) === 1);
  const immediate = transition !== null;
  if (event.kind === "session.start") {
    database
      .prepare(
        `
        INSERT INTO local_session (
          session_id, revision, started_at, last_event_at, ended_at,
          repo_id, repo_label, agent, awaiting_input, event_count,
          tool_call_count, errored_tool_call_count, prompt_count,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
          cost_usd, cost_known, dirty, next_sync_at_ms
        ) VALUES (?, 1, ?, ?, NULL, ?, ?, ?, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, ?)
        ON CONFLICT (session_id) DO UPDATE SET
          revision = local_session.revision + 1,
          started_at = MIN(local_session.started_at, excluded.started_at),
          last_event_at = MAX(local_session.last_event_at, excluded.last_event_at),
          repo_id = excluded.repo_id,
          repo_label = excluded.repo_label,
          agent = excluded.agent,
          event_count = local_session.event_count + 1,
          dirty = 1,
          next_sync_at_ms = MIN(local_session.next_sync_at_ms, excluded.next_sync_at_ms)
      `,
      )
      .run(
        event.sessionId,
        event.at,
        event.at,
        event.repoId,
        event.repoLabel,
        event.agent,
        now,
      );
  } else {
    database
      .prepare(
        `
        INSERT INTO local_session (
          session_id, revision, started_at, last_event_at, ended_at,
          repo_id, repo_label, agent, awaiting_input, event_count,
          tool_call_count, errored_tool_call_count, prompt_count,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
          cost_usd, cost_known, dirty, next_sync_at_ms
        ) VALUES (?, 1, ?, ?, ?, '', '', 'unknown', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT (session_id) DO UPDATE SET
          revision = local_session.revision + 1,
          last_event_at = CASE
            WHEN ? = 1 THEN MAX(local_session.last_event_at, excluded.last_event_at)
            ELSE local_session.last_event_at
          END,
          ended_at = COALESCE(excluded.ended_at, local_session.ended_at),
          awaiting_input = CASE
            WHEN excluded.ended_at IS NOT NULL THEN 0
            WHEN ? = 'needs-you' THEN 1
            WHEN ? = 'resumed' THEN 0
            ELSE local_session.awaiting_input
          END,
          event_count = local_session.event_count + 1,
          tool_call_count = local_session.tool_call_count + excluded.tool_call_count,
          errored_tool_call_count = local_session.errored_tool_call_count + excluded.errored_tool_call_count,
          prompt_count = local_session.prompt_count + excluded.prompt_count,
          input_tokens = local_session.input_tokens + excluded.input_tokens,
          output_tokens = local_session.output_tokens + excluded.output_tokens,
          cache_read_tokens = local_session.cache_read_tokens + excluded.cache_read_tokens,
          cache_write_tokens = local_session.cache_write_tokens + excluded.cache_write_tokens,
          cost_usd = local_session.cost_usd + excluded.cost_usd,
          cost_known = local_session.cost_known * excluded.cost_known,
          dirty = 1,
          next_sync_at_ms = CASE
            WHEN ? = 1 THEN ?
            WHEN local_session.dirty = 0 THEN ?
            ELSE MIN(local_session.next_sync_at_ms, ?)
          END
      `,
      )
      .run(
        event.sessionId,
        event.at,
        event.at,
        event.kind === "session.end" ? event.at : null,
        transition === "needs-you" ? 1 : 0,
        counters.toolCalls,
        counters.erroredCalls,
        counters.prompts,
        counters.input,
        counters.output,
        counters.cacheRead,
        counters.cacheWrite,
        counters.cost,
        costKnown ? 1 : 0,
        immediate ? now : now + LOCAL_SESSION_SYNC_CADENCE_MS,
        // The `last_event_at` guard above — first bind of the ON CONFLICT clause.
        advancesLiveness(event) ? 1 : 0,
        transition ?? "",
        transition ?? "",
        immediate ? 1 : 0,
        now,
        now + LOCAL_SESSION_SYNC_CADENCE_MS,
        now + LOCAL_SESSION_SYNC_CADENCE_MS,
      );
  }

  // Codex reports session-level cumulative token snapshots rather than
  // per-call deltas. Latest-wins through MAX keeps retries and repeated
  // snapshots idempotent while preserving the complete local total.
  if (event.kind === "session.tokens") {
    const totals = event.models.reduce(
      (sum, model) => ({
        input: sum.input + model.inputTokens,
        output: sum.output + model.outputTokens,
        cacheRead: sum.cacheRead + model.cacheReadTokens,
        cacheWrite: sum.cacheWrite + model.cacheWriteTokens,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
    const priced = priceModels(event.models);
    database
      .prepare(
        `
        UPDATE local_session
           SET input_tokens = MAX(input_tokens, ?),
               output_tokens = MAX(output_tokens, ?),
               cache_read_tokens = MAX(cache_read_tokens, ?),
               cache_write_tokens = MAX(cache_write_tokens, ?),
               cost_usd = MAX(cost_usd, ?)
         WHERE session_id = ?
      `,
      )
      .run(
        totals.input,
        totals.output,
        totals.cacheRead,
        totals.cacheWrite,
        priced.priced ? priced.costUsd : 0,
        event.sessionId,
      );
  }

  const session = database
    .prepare("SELECT agent FROM local_session WHERE session_id = ?")
    .get(event.sessionId) as { agent?: unknown } | undefined;
  const agent = typeof session?.agent === "string" ? session.agent : "unknown";
  database
    .prepare(
      `
      INSERT INTO local_hour (
        bucket, session_id, revision, agent, event_count, tool_call_count,
        errored_tool_call_count, prompt_count, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, cost_usd, cost_known, dirty
      ) VALUES (?, ?, 1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT (bucket, session_id) DO UPDATE SET
        revision = local_hour.revision + 1,
        agent = CASE WHEN local_hour.agent = 'unknown' THEN excluded.agent ELSE local_hour.agent END,
        event_count = local_hour.event_count + 1,
        tool_call_count = local_hour.tool_call_count + excluded.tool_call_count,
        errored_tool_call_count = local_hour.errored_tool_call_count + excluded.errored_tool_call_count,
        prompt_count = local_hour.prompt_count + excluded.prompt_count,
        input_tokens = local_hour.input_tokens + excluded.input_tokens,
        output_tokens = local_hour.output_tokens + excluded.output_tokens,
        cache_read_tokens = local_hour.cache_read_tokens + excluded.cache_read_tokens,
        cache_write_tokens = local_hour.cache_write_tokens + excluded.cache_write_tokens,
        cost_usd = local_hour.cost_usd + excluded.cost_usd,
        cost_known = local_hour.cost_known * excluded.cost_known,
        dirty = 1
    `,
    )
    .run(
      hourBucket(event.at),
      event.sessionId,
      agent,
      counters.toolCalls,
      counters.erroredCalls,
      counters.prompts,
      counters.input,
      counters.output,
      counters.cacheRead,
      counters.cacheWrite,
      counters.cost,
      costKnown ? 1 : 0,
    );

  if (event.kind === "session.tokens") {
    const totals = event.models.reduce(
      (sum, model) => ({
        input: sum.input + model.inputTokens,
        output: sum.output + model.outputTokens,
        cacheRead: sum.cacheRead + model.cacheReadTokens,
        cacheWrite: sum.cacheWrite + model.cacheWriteTokens,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
    const priced = priceModels(event.models);
    database
      .prepare(
        `
        UPDATE local_hour
           SET input_tokens = MAX(input_tokens, ?),
               output_tokens = MAX(output_tokens, ?),
               cache_read_tokens = MAX(cache_read_tokens, ?),
               cache_write_tokens = MAX(cache_write_tokens, ?),
               cost_usd = MAX(cost_usd, ?)
         WHERE bucket = ? AND session_id = ?
      `,
      )
      .run(
        totals.input,
        totals.output,
        totals.cacheRead,
        totals.cacheWrite,
        priced.priced ? priced.costUsd : 0,
        hourBucket(event.at),
        event.sessionId,
      );
  }

  if (transition !== null) {
    database
      .prepare(
        `
        INSERT OR IGNORE INTO local_transition (
          event_id, session_id, at, transition, synced
        ) VALUES (?, ?, ?, ?, 0)
      `,
      )
      .run(event.eventId, event.sessionId, event.at, transition);
  }
}

export function appendLocalEvent(
  event: SessionEvent,
  directory?: string,
): boolean {
  const database = openLocalHistory(directory);
  try {
    return transaction(database, () => {
      const payload = JSON.stringify(event);
      if (!insertEvent(database, event, payload)) return false;
      projectEvent(database, event);
      return true;
    });
  } finally {
    database.close();
  }
}

export interface LegacyHistoryImport {
  accepted: number;
  rejected: number;
  skipped: boolean;
  digest: string | null;
}

/**
 * Import the bounded compatibility JSONL before it can be reclaimed. Inserts
 * are event-id idempotent, so an interrupted upgrade can safely restart.
 */
export function importLegacyEventLog(
  eventLogPath: string,
  directory?: string,
): LegacyHistoryImport {
  if (!existsSync(eventLogPath)) {
    return { accepted: 0, rejected: 0, skipped: true, digest: null };
  }
  const raw = readFileSync(eventLogPath, "utf8");
  const digest = createHash("sha256").update(raw).digest("hex");
  const database = openLocalHistory(directory);
  try {
    const prior = database
      .prepare(
        "SELECT digest FROM local_import_state WHERE source = 'events.jsonl'",
      )
      .get() as { digest?: unknown } | undefined;
    if (prior?.digest === digest) {
      return { accepted: 0, rejected: 0, skipped: true, digest };
    }
    return transaction(database, () => {
      let accepted = 0;
      let rejected = 0;
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        let event: SessionEvent | null = null;
        try {
          event = parseSessionEvent(JSON.parse(line));
        } catch {
          event = null;
        }
        if (event === null) {
          rejected += 1;
          continue;
        }
        if (insertEvent(database, event, JSON.stringify(event))) {
          projectEvent(database, event);
          accepted += 1;
        }
      }
      database
        .prepare(
          `
          INSERT INTO local_import_state (
            source, digest, imported_at, accepted, rejected
          ) VALUES ('events.jsonl', ?, ?, ?, ?)
          ON CONFLICT (source) DO UPDATE SET
            digest = excluded.digest,
            imported_at = excluded.imported_at,
            accepted = local_import_state.accepted + excluded.accepted,
            rejected = local_import_state.rejected + excluded.rejected
        `,
        )
        .run(digest, new Date().toISOString(), accepted, rejected);
      return { accepted, rejected, skipped: false, digest };
    });
  } finally {
    database.close();
  }
}

/**
 * The SQL form of "this row is a real session a person had".
 *
 * `projectEvent` opens a `local_session` row for ANY event whose session it has
 * not seen, filling `repo_id`/`repo_label` with empty strings — because a
 * non-`session.start` event carries no repo identity. The daemon's momentum
 * sweep emits `git.momentum` under the synthetic id `daemon-momentum`
 * (registry.ts), so that sweep manufactures a session row nobody ever ran, and
 * it renders as "Unlabelled project" with a zero-filled everything.
 *
 * The worker refuses exactly these rows: `isDisplayableSession` tests the
 * repoId against a 64-hex salted id (worker/src/sessions.ts). Local reads
 * carried no such test, so `seorak local report` and the local session list
 * over-counted sessions against the hosted answer — the two halves of one
 * product disagreeing about how many sessions the user ran, with the local half
 * wrong.
 *
 * Applied in the READ path, deliberately: the raw rows stay in the database
 * because history.sqlite is the permanent authority and pruning it to fix a
 * presentation rule would be the wrong direction of loss.
 */
export const DISPLAYABLE_SESSION_SQL =
  "length(repo_id) = 64 AND repo_id NOT GLOB '*[^0-9a-f]*'";

/** The predicate above, for rows already in memory. */
export function isDisplayableLocalSession(repoId: string): boolean {
  return /^[0-9a-f]{64}$/.test(repoId);
}

/** The ONE place a `local_session` row becomes a typed row. Exported so the
 *  local read models project from the same mapping the store's own queries do,
 *  rather than each re-deriving column names and the cost-known rule. */
export function mapLocalSessionRow(
  row: Record<string, unknown>,
): LocalSessionRow {
  return mapSession(row);
}

function mapSession(row: Record<string, unknown>): LocalSessionRow {
  return {
    sessionId: String(row.session_id),
    revision: Number(row.revision),
    startedAt: String(row.started_at),
    lastEventAt: String(row.last_event_at),
    endedAt: row.ended_at === null ? null : String(row.ended_at),
    repoId: String(row.repo_id),
    repoLabel: String(row.repo_label),
    agent: String(row.agent),
    status:
      row.ended_at !== null
        ? "ended"
        : Number(row.awaiting_input) === 1
          ? "needs-you"
          : "active",
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

export function localHistoryCounts(directory?: string): LocalHistoryCounts {
  const database = openLocalHistory(directory);
  try {
    const scalar = (sql: string): number =>
      Number(
        (database.prepare(sql).get() as { count?: unknown } | undefined)
          ?.count ?? 0,
      );
    return {
      events: scalar("SELECT COUNT(*) AS count FROM local_event"),
      // The two USER-FACING session counts refuse the manufactured rows the
      // daemon sweep opens; the sync-pending counts below deliberately do not,
      // because they describe work the delivery path still owes.
      sessions: scalar(
        `SELECT COUNT(*) AS count FROM local_session WHERE ${DISPLAYABLE_SESSION_SQL}`,
      ),
      completedSessions: scalar(
        `SELECT COUNT(*) AS count FROM local_session
          WHERE ended_at IS NOT NULL AND ${DISPLAYABLE_SESSION_SQL}`,
      ),
      pendingSessions: scalar(
        "SELECT COUNT(*) AS count FROM local_session WHERE dirty = 1",
      ),
      pendingTransitions: scalar(
        "SELECT COUNT(*) AS count FROM local_transition WHERE synced = 0",
      ),
      pendingHours: scalar(
        "SELECT COUNT(*) AS count FROM local_hour WHERE dirty = 1",
      ),
    };
  } finally {
    database.close();
  }
}

/**
 * The keyset a local session page resumes from. Opaque to callers, and
 * deliberately carrying only the `(last_event_at, session_id)` pair the
 * ordering already exposes — a cursor is not a place to smuggle state.
 */
/**
 * NUL joins the two halves because no timestamp or session id can contain it,
 * and it is written as an ESCAPE rather than a literal: a raw NUL byte in the
 * source makes this whole file binary to `grep` and `file`, which silently
 * hides every symbol in it from anyone auditing the module.
 */
const CURSOR_SEPARATOR = "\u0000";

export function encodeLocalSessionCursor(
  lastEventAt: string,
  sessionId: string,
): string {
  return Buffer.from(
    `${lastEventAt}${CURSOR_SEPARATOR}${sessionId}`,
    "utf8",
  ).toString("base64url");
}

export function decodeLocalSessionCursor(
  cursor: string | null | undefined,
): { lastEventAt: string; sessionId: string } | null {
  if (!cursor) return null;
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const separator = decoded.indexOf(CURSOR_SEPARATOR);
  if (separator <= 0) return null;
  return {
    lastEventAt: decoded.slice(0, separator),
    sessionId: decoded.slice(separator + 1),
  };
}

export interface LocalSessionQuery {
  limit?: number;
  /** Resume point from a previous page. Omit for the first page. */
  cursor?: string | null;
  repoId?: string | null;
  directory?: string;
}

/**
 * One bounded, deterministic page of local sessions, newest activity first.
 *
 * It used to take a `limit` capped at 500 and offer no way to ask for the next
 * page, which quietly contradicted the promise that a user can read the
 * COMPLETE local history their device holds (docs/specs/pricing.md). The cap is
 * still here — an unbounded read of years of history is not a kindness — but it
 * is now a page size rather than a ceiling, and `nextCursor` is the rest.
 */
export function listLocalSessionPage(options: LocalSessionQuery = {}): {
  sessions: LocalSessionRow[];
  nextCursor: string | null;
} {
  const database = openLocalHistory(options.directory);
  try {
    const limit = Math.max(1, Math.min(500, options.limit ?? 100));
    const conditions = [DISPLAYABLE_SESSION_SQL];
    const params: Array<string | number> = [];
    if (options.repoId) {
      conditions.push("repo_id = ?");
      params.push(options.repoId);
    }
    const from = decodeLocalSessionCursor(options.cursor);
    if (from !== null) {
      conditions.push(
        "(last_event_at < ? OR (last_event_at = ? AND session_id > ?))",
      );
      params.push(from.lastEventAt, from.lastEventAt, from.sessionId);
    }
    const rows = database
      .prepare(
        `SELECT * FROM local_session
          WHERE ${conditions.join(" AND ")}
          ORDER BY last_event_at DESC, session_id
          LIMIT ?`,
      )
      .all(...params, limit + 1) as Array<Record<string, unknown>>;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      sessions: page.map((row) => mapSession(row)),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeLocalSessionCursor(
              String(last.last_event_at),
              String(last.session_id),
            )
          : null,
    };
  } finally {
    database.close();
  }
}

/** The first page only. Kept for the report and the terminal, which want a
 *  recent slice rather than a traversal. */
export function listLocalSessions(
  options: { limit?: number; directory?: string } = {},
): LocalSessionRow[] {
  return listLocalSessionPage(options).sessions;
}

export function replayLocalSession(
  sessionId: string,
  directory?: string,
): SessionEvent[] {
  const database = openLocalHistory(directory);
  try {
    return database
      .prepare(
        "SELECT payload_json FROM local_event WHERE session_id = ? ORDER BY at, local_seq",
      )
      .all(sessionId)
      .flatMap((row) => {
        try {
          const event = parseSessionEvent(
            JSON.parse(
              String((row as { payload_json?: unknown }).payload_json),
            ),
          );
          return event === null ? [] : [event];
        } catch {
          return [];
        }
      });
  } finally {
    database.close();
  }
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
      .map((row) => mapSession(row as Record<string, unknown>));
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

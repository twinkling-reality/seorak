/**
 * Persistent authority and opaque reference storage for the collector plane's
 * private integration boundary.
 *
 * The self-hosted operator credential never enters this module. Every read
 * presented here is an `srkx_` principal with its own exact audience, scopes,
 * mandatory expiry, request budget, and revocation lifecycle.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  INTEGRATION_API_VERSION,
  INTEGRATION_SCOPES,
  type ExternalCursor,
  type ExternalProjectRef,
  type ExternalSessionRef,
  type IntegrationCredentialList,
  type IntegrationCredentialSummary,
  type IntegrationProjectList,
  type IntegrationScope,
  type SessionCapabilities,
} from "@seorak/types";
import { parseSessionEvent } from "@seorak/types/event-validation";
import {
  DISPLAYABLE_SESSION_SQL,
  mapLocalSessionRow,
  openLocalHistory,
  type LocalSessionRow,
} from "./local-store.ts";

export const LOCAL_INTEGRATION_REQUESTS_PER_MINUTE = 60;
export const LOCAL_INTEGRATION_ROUTE_REQUESTS_PER_MINUTE = 600;
export const LOCAL_INTEGRATION_MAX_LIFETIME_DAYS = 366;
export const LOCAL_INTEGRATION_ACTIVE_CREDENTIAL_LIMIT = 100;
export const LOCAL_INTEGRATION_CURSOR_TTL_MS = 15 * 60_000;
export const LOCAL_INTEGRATION_AUDIT_ROWS_PER_CREDENTIAL = 500;
export const LOCAL_INTEGRATION_INACTIVE_CREDENTIAL_LIMIT = 500;
export const LOCAL_INTEGRATION_CURSOR_LIMIT =
  LOCAL_INTEGRATION_ROUTE_REQUESTS_PER_MINUTE +
  (LOCAL_INTEGRATION_ROUTE_REQUESTS_PER_MINUTE / 60) *
    (LOCAL_INTEGRATION_CURSOR_TTL_MS / 1_000);

const DAY_MS = 24 * 60 * 60 * 1_000;
const TOKEN_PATTERN = /^srkx_([0-9a-f]{32})_([0-9a-f]{64})$/;
const PROJECT_REF_PATTERN = /^prj_[0-9a-f]{32}$/;
const SESSION_REF_PATTERN = /^ses_[0-9a-f]{32}$/;
const CURSOR_PATTERN = /^cur_[0-9a-f]{32}_[0-9a-f]{64}$/;
const REPO_ID_PATTERN = /^[0-9a-f]{64}$/;

const EXPECTED_LOCAL_SESSION_AUTHORITY_COLUMNS = [
  "session_id",
  "revision",
  "started_at",
  "last_event_at",
  "ended_at",
  "repo_id",
  "repo_label",
  "agent",
  "awaiting_input",
  "event_count",
  "tool_call_count",
  "errored_tool_call_count",
  "prompt_count",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "cost_usd",
  "cost_known",
  "dirty",
  "next_sync_at_ms",
  "synced_revision",
  "archive_digest",
  "archive_synced",
] as const;

export type LocalIntegrationRouteClass = "read" | "aggregate";

export interface LocalIntegrationRestrictions {
  repoId: string | null;
  dataNotBefore: string | null;
  dataNotAfter: string | null;
}

export interface LocalIntegrationPrincipal {
  credentialId: string;
  audience: string;
  scopes: readonly IntegrationScope[];
  expiresAt: string;
  restrictions: LocalIntegrationRestrictions;
  authorizedAt: string;
}

export type LocalIntegrationDenialReason =
  | "invalid"
  | "expired"
  | "revoked"
  | "audience"
  | "scope"
  | "rate_limited"
  | "route_rate_limited";

export type LocalIntegrationAuthorization =
  | { ok: true; principal: LocalIntegrationPrincipal }
  | { ok: false; reason: LocalIntegrationDenialReason };

export interface CreateLocalIntegrationCredentialInput {
  audience: string;
  scopes: readonly IntegrationScope[];
  expiresAt: string;
  repoId?: string;
  dataNotBefore?: string;
  dataNotAfter?: string;
  directory?: string;
  nowMs?: number;
}

export interface CreatedLocalIntegrationCredential {
  credentialId: string;
  token: string;
  audience: string;
  scopes: readonly IntegrationScope[];
  createdAt: string;
  expiresAt: string;
  restrictions: LocalIntegrationRestrictions;
}

interface CredentialRow {
  credential_id: string;
  secret_hash: string;
  audience: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  repo_id: string | null;
  data_not_before: string | null;
  data_not_after: string | null;
  scopes_csv: string;
}

export interface LocalIntegrationReadBoundary {
  credentialId: string;
  repoId: string | null;
  requestedSince: string;
  requestedUntil: string;
  confidentialSince: string | null;
  confidentialUntil: string | null;
}

export interface LocalIntegrationSessionPage {
  rows: Array<{
    sessionRef: ExternalSessionRef;
    projectRef: ExternalProjectRef;
    session: LocalSessionRow;
    declaredCapabilities: SessionCapabilities | undefined;
  }>;
  nextCursor: ExternalCursor | null;
  boundary: LocalIntegrationReadBoundary;
  totalMatched: number;
  /** Monotonic authority time used by the page transaction. */
  queryTime: string;
}

export class InvalidLocalIntegrationCursorError extends Error {
  constructor() {
    super("invalid local integration cursor");
    this.name = "InvalidLocalIntegrationCursorError";
  }
}

export class LocalIntegrationPageChangedError extends Error {
  constructor() {
    super("local integration session collection changed");
    this.name = "LocalIntegrationPageChangedError";
  }
}

export class LocalIntegrationCursorCapacityError extends Error {
  constructor() {
    super("local integration cursor capacity temporarily unavailable");
    this.name = "LocalIntegrationCursorCapacityError";
  }
}

export class LocalIntegrationCredentialLimitError extends Error {
  constructor() {
    super("active integration credential limit reached");
    this.name = "LocalIntegrationCredentialLimitError";
  }
}

export class LocalIntegrationAuthorityChangedError extends Error {
  constructor() {
    super(
      "local history authority changed; integration access requires review",
    );
    this.name = "LocalIntegrationAuthorityChangedError";
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
      // Preserve the original failure; closing releases the lock.
    }
    throw error;
  }
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function secretMatches(expectedHash: string, secret: string): boolean {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(sha256(secret), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function canonicalTimestamp(
  value: string | number | Date,
  field: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError(`${field} must be valid`);
  return date.toISOString();
}

function validateAudience(audience: string): void {
  if (
    audience.length < 1 ||
    audience.length > 512 ||
    /[\u0000-\u0020\u007f]/.test(audience)
  ) {
    throw new TypeError("integration audience invalid");
  }
  const parsed = new URL(audience);
  if (
    (parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
      )) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (parsed.pathname !== "/api/v1" && parsed.pathname !== "/mcp/private") ||
    parsed.href !== audience
  ) {
    throw new TypeError(
      "integration audience must be canonical HTTPS or loopback HTTP",
    );
  }
}

function advanceIntegrationClock(
  database: DatabaseSync,
  proposedMs: number,
): number {
  if (!Number.isFinite(proposedMs) || proposedMs < 0) {
    throw new TypeError("integration time invalid");
  }
  const row = database
    .prepare(
      `UPDATE local_integration_clock
          SET last_seen_ms = MAX(last_seen_ms, ?)
        WHERE singleton = 1
      RETURNING last_seen_ms`,
    )
    .get(Math.trunc(proposedMs)) as { last_seen_ms?: unknown } | undefined;
  if (!row) throw new Error("integration clock is unavailable");
  return Number(row.last_seen_ms);
}

function integrationClock(database: DatabaseSync): number {
  const row = database
    .prepare(
      "SELECT last_seen_ms FROM local_integration_clock WHERE singleton = 1",
    )
    .get() as { last_seen_ms?: unknown } | undefined;
  if (!row || !Number.isSafeInteger(Number(row.last_seen_ms))) {
    throw new Error("integration clock is unavailable");
  }
  return Number(row.last_seen_ms);
}

function validateScopes(
  scopes: readonly IntegrationScope[],
): IntegrationScope[] {
  if (
    scopes.length === 0 ||
    scopes.some(
      (scope) => !(INTEGRATION_SCOPES as readonly string[]).includes(scope),
    )
  ) {
    throw new TypeError("integration scope invalid");
  }
  return INTEGRATION_SCOPES.filter((scope) => scopes.includes(scope));
}

function scopesFrom(row: CredentialRow): IntegrationScope[] {
  const present = new Set(row.scopes_csv.split(","));
  return INTEGRATION_SCOPES.filter((scope) => present.has(scope));
}

/**
 * Collector history is one machine owner's append-only capture today. Treat the
 * exact local-session schema as that proof. A future inbound/shared provenance
 * column must make issuance and authorization fail closed until a consent model
 * is designed; it must not silently widen an existing grant.
 */
export function assertLocalIntegrationPersonalAuthority(
  database: DatabaseSync,
): void {
  const columns = database
    .prepare("PRAGMA table_info(local_session)")
    .all()
    .map((row) => String((row as { name?: unknown }).name));
  if (
    columns.length !== EXPECTED_LOCAL_SESSION_AUTHORITY_COLUMNS.length ||
    columns.some(
      (column, index) =>
        column !== EXPECTED_LOCAL_SESSION_AUTHORITY_COLUMNS[index],
    )
  ) {
    throw new LocalIntegrationAuthorityChangedError();
  }
}

interface BudgetPlan {
  state: "spent" | "first_limited" | "limited";
  tokens: number;
  updatedAt: string;
}

function planBudget(
  database: DatabaseSync,
  table:
    "local_integration_credential_budget" | "local_integration_route_budget",
  keyColumn: "credential_id" | "route_class",
  key: string,
  now: string,
): BudgetPlan {
  const capacity =
    table === "local_integration_credential_budget"
      ? LOCAL_INTEGRATION_REQUESTS_PER_MINUTE
      : LOCAL_INTEGRATION_ROUTE_REQUESTS_PER_MINUTE;
  const refillPerSecond = capacity / 60;
  const existing = database
    .prepare(
      `SELECT tokens, updated_at, limited FROM ${table} WHERE ${keyColumn} = ?`,
    )
    .get(key) as
    { tokens?: unknown; updated_at?: unknown; limited?: unknown } | undefined;
  const nowMs = Date.parse(now);
  const previousMs =
    existing === undefined ? nowMs : Date.parse(String(existing.updated_at));
  const effectiveNowMs = Math.max(nowMs, previousMs);
  const available =
    existing === undefined
      ? capacity
      : Math.min(
          capacity,
          Number(existing.tokens) +
            ((effectiveNowMs - previousMs) / 1_000) * refillPerSecond,
        );
  if (available < 1) {
    return {
      state: Number(existing?.limited ?? 0) === 1 ? "limited" : "first_limited",
      tokens: Math.max(0, available),
      updatedAt: canonicalTimestamp(effectiveNowMs, "budget time"),
    };
  }
  return {
    state: "spent",
    tokens: available - 1,
    updatedAt: canonicalTimestamp(effectiveNowMs, "budget time"),
  };
}

function applyBudgetPlan(
  database: DatabaseSync,
  table:
    "local_integration_credential_budget" | "local_integration_route_budget",
  keyColumn: "credential_id" | "route_class",
  key: string,
  plan: BudgetPlan,
): void {
  if (plan.state !== "spent") {
    if (plan.state === "first_limited") {
      database
        .prepare(
          `UPDATE ${table} SET limited = 1 WHERE ${keyColumn} = ? AND limited = 0`,
        )
        .run(key);
    }
    return;
  }
  database
    .prepare(
      `INSERT INTO ${table} (${keyColumn}, tokens, updated_at, limited)
       VALUES (?, ?, ?, 0)
       ON CONFLICT (${keyColumn}) DO UPDATE SET
         tokens = excluded.tokens, updated_at = excluded.updated_at, limited = 0`,
    )
    .run(key, plan.tokens, plan.updatedAt);
}

function pruneInactiveCredentials(database: DatabaseSync, now: string): void {
  database
    .prepare(
      `DELETE FROM local_integration_credential
        WHERE credential_id IN (
          SELECT credential_id FROM local_integration_credential
           WHERE revoked_at IS NOT NULL OR expires_at <= ?
           ORDER BY COALESCE(revoked_at, expires_at) DESC, credential_id DESC
           LIMIT -1 OFFSET ?
        )`,
    )
    .run(now, LOCAL_INTEGRATION_INACTIVE_CREDENTIAL_LIMIT);
}

function recordAuthorization(
  database: DatabaseSync,
  credentialId: string,
  action: "issued" | "revoked" | "authorized" | "denied" | "rate_limited",
  scope: IntegrationScope | null,
  reason: Exclude<LocalIntegrationDenialReason, "invalid"> | null,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO local_integration_authorization_audit (
         credential_id, action, scope, reason, at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(credentialId, action, scope, reason, now);
}

export function createLocalIntegrationCredential(
  input: CreateLocalIntegrationCredentialInput,
): CreatedLocalIntegrationCredential {
  validateAudience(input.audience);
  const scopes = validateScopes(input.scopes);
  const expiresAt = canonicalTimestamp(input.expiresAt, "expiresAt");
  const repoId = input.repoId ?? null;
  if (repoId !== null && !REPO_ID_PATTERN.test(repoId)) {
    throw new TypeError("integration repository restriction invalid");
  }
  const dataNotBefore =
    input.dataNotBefore === undefined
      ? null
      : canonicalTimestamp(input.dataNotBefore, "dataNotBefore");
  const dataNotAfter =
    input.dataNotAfter === undefined
      ? null
      : canonicalTimestamp(input.dataNotAfter, "dataNotAfter");
  if (
    (dataNotBefore === null) !== (dataNotAfter === null) ||
    (dataNotBefore !== null &&
      dataNotAfter !== null &&
      dataNotBefore >= dataNotAfter)
  ) {
    throw new TypeError("integration date restriction invalid");
  }

  const database = openLocalHistory(input.directory);
  try {
    assertLocalIntegrationPersonalAuthority(database);
    // Time is authority state, not part of issuance. Commit the observation
    // before any fallible expiry/cap validation so a rejected request cannot
    // roll time back and resurrect an older credential.
    const proposedNowMs = input.nowMs ?? Date.now();
    transaction(database, () =>
      advanceIntegrationClock(database, proposedNowMs),
    );
    return transaction(database, () => {
      assertLocalIntegrationPersonalAuthority(database);
      const createdAt = canonicalTimestamp(
        advanceIntegrationClock(database, proposedNowMs),
        "creation time",
      );
      if (
        expiresAt <= createdAt ||
        Date.parse(expiresAt) - Date.parse(createdAt) >
          LOCAL_INTEGRATION_MAX_LIFETIME_DAYS * DAY_MS
      ) {
        throw new TypeError("integration expiry invalid");
      }
      pruneInactiveCredentials(database, createdAt);
      const active = database
        .prepare(
          `SELECT COUNT(*) AS count FROM local_integration_credential
            WHERE revoked_at IS NULL AND expires_at > ?`,
        )
        .get(createdAt) as { count?: unknown } | undefined;
      if (
        Number(active?.count ?? 0) >= LOCAL_INTEGRATION_ACTIVE_CREDENTIAL_LIMIT
      ) {
        throw new LocalIntegrationCredentialLimitError();
      }
      const credentialId = randomHex(16);
      const secret = randomHex(32);
      database
        .prepare(
          `INSERT INTO local_integration_credential (
             credential_id, secret_hash, audience, created_at, expires_at,
             last_used_at, revoked_at, repo_id, data_not_before, data_not_after
           ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
        )
        .run(
          credentialId,
          sha256(secret),
          input.audience,
          createdAt,
          expiresAt,
          repoId,
          dataNotBefore,
          dataNotAfter,
        );
      const insertScope = database.prepare(
        `INSERT INTO local_integration_credential_scope (credential_id, scope)
         VALUES (?, ?)`,
      );
      for (const scope of scopes) insertScope.run(credentialId, scope);
      recordAuthorization(
        database,
        credentialId,
        "issued",
        null,
        null,
        createdAt,
      );
      return {
        credentialId,
        token: `srkx_${credentialId}_${secret}`,
        audience: input.audience,
        scopes,
        createdAt,
        expiresAt,
        restrictions: { repoId, dataNotBefore, dataNotAfter },
      };
    });
  } finally {
    database.close();
  }
}

function presentedToken(
  authorization: string | undefined,
): RegExpMatchArray | null {
  if (authorization === undefined) return null;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(authorization.trim());
  return match?.[1]?.match(TOKEN_PATTERN) ?? null;
}

export function authorizeLocalIntegrationCredential(
  authorization: string | undefined,
  request: {
    audience: string;
    scope: IntegrationScope | null;
    routeClass: LocalIntegrationRouteClass;
    directory?: string;
    nowMs?: number;
  },
): LocalIntegrationAuthorization {
  const token = presentedToken(authorization);
  if (
    !token ||
    (request.scope !== null && !INTEGRATION_SCOPES.includes(request.scope))
  ) {
    return { ok: false, reason: "invalid" };
  }
  const database = openLocalHistory(request.directory);
  try {
    return transaction(database, () => {
      assertLocalIntegrationPersonalAuthority(database);
      const row = database
        .prepare(
          `SELECT credential.credential_id, credential.secret_hash,
                  credential.audience, credential.created_at,
                  credential.expires_at, credential.last_used_at,
                  credential.revoked_at, credential.repo_id,
                  credential.data_not_before, credential.data_not_after,
                  COALESCE(group_concat(scope.scope, ','), '') AS scopes_csv
             FROM local_integration_credential AS credential
             LEFT JOIN local_integration_credential_scope AS scope
               ON scope.credential_id = credential.credential_id
            WHERE credential.credential_id = ?
            GROUP BY credential.credential_id`,
        )
        .get(token[1]!) as CredentialRow | undefined;
      if (!row || !secretMatches(row.secret_hash, token[2]!)) {
        return { ok: false, reason: "invalid" } as const;
      }
      const persistedNowMs = integrationClock(database);
      const effectiveNowMs = Math.max(
        persistedNowMs,
        Math.trunc(request.nowMs ?? Date.now()),
      );
      const now = canonicalTimestamp(effectiveNowMs, "authorization time");
      const deny = (reason: "expired" | "revoked" | "audience" | "scope") => {
        const observed = database
          .prepare(
            `SELECT 1 AS present FROM local_integration_denial_state
              WHERE credential_id = ? AND reason = ?`,
          )
          .get(row.credential_id, reason) as { present?: unknown } | undefined;
        if (!observed) {
          advanceIntegrationClock(database, effectiveNowMs);
          const inserted = database
            .prepare(
              `INSERT OR IGNORE INTO local_integration_denial_state (
                 credential_id, reason, at
               ) VALUES (?, ?, ?)`,
            )
            .run(row.credential_id, reason, now);
          if (Number(inserted.changes) > 0) {
            recordAuthorization(
              database,
              row.credential_id,
              "denied",
              request.scope,
              reason,
              now,
            );
          }
        }
        return { ok: false, reason } as const;
      };
      if (row.revoked_at !== null) return deny("revoked");
      if (row.expires_at <= now) return deny("expired");
      if (row.audience !== request.audience) {
        return deny("audience");
      }
      const scopes = scopesFrom(row);
      if (request.scope !== null && !scopes.includes(request.scope)) {
        return deny("scope");
      }

      const tokenBudget = planBudget(
        database,
        "local_integration_credential_budget",
        "credential_id",
        row.credential_id,
        now,
      );
      if (tokenBudget.state !== "spent") {
        applyBudgetPlan(
          database,
          "local_integration_credential_budget",
          "credential_id",
          row.credential_id,
          tokenBudget,
        );
        if (tokenBudget.state === "first_limited") {
          advanceIntegrationClock(database, effectiveNowMs);
          recordAuthorization(
            database,
            row.credential_id,
            "rate_limited",
            request.scope,
            "rate_limited",
            now,
          );
        }
        return { ok: false, reason: "rate_limited" } as const;
      }
      const routeBudget = planBudget(
        database,
        "local_integration_route_budget",
        "route_class",
        request.routeClass,
        now,
      );
      if (routeBudget.state !== "spent") {
        applyBudgetPlan(
          database,
          "local_integration_route_budget",
          "route_class",
          request.routeClass,
          routeBudget,
        );
        if (routeBudget.state === "first_limited") {
          advanceIntegrationClock(database, effectiveNowMs);
          recordAuthorization(
            database,
            row.credential_id,
            "rate_limited",
            request.scope,
            "route_rate_limited",
            now,
          );
        }
        return { ok: false, reason: "route_rate_limited" } as const;
      }

      advanceIntegrationClock(database, effectiveNowMs);
      applyBudgetPlan(
        database,
        "local_integration_credential_budget",
        "credential_id",
        row.credential_id,
        tokenBudget,
      );
      applyBudgetPlan(
        database,
        "local_integration_route_budget",
        "route_class",
        request.routeClass,
        routeBudget,
      );

      // Re-check mutable lifecycle and record success in the same write
      // transaction. A revoke that commits first makes this update change zero;
      // a revoke that commits after it is allowed to linearize after this request.
      const used = database
        .prepare(
          `UPDATE local_integration_credential
              SET last_used_at = ?
            WHERE credential_id = ?
              AND revoked_at IS NULL
              AND expires_at > ?`,
        )
        .run(now, row.credential_id, now);
      if (Number(used.changes) === 0) {
        return { ok: false, reason: "revoked" } as const;
      }
      recordAuthorization(
        database,
        row.credential_id,
        "authorized",
        request.scope,
        null,
        now,
      );
      return {
        ok: true,
        principal: {
          credentialId: row.credential_id,
          audience: row.audience,
          scopes,
          expiresAt: row.expires_at,
          restrictions: {
            repoId: row.repo_id,
            dataNotBefore: row.data_not_before,
            dataNotAfter: row.data_not_after,
          },
          authorizedAt: now,
        },
      } as const;
    });
  } finally {
    database.close();
  }
}

export function revokeLocalIntegrationCredential(
  credentialId: string,
  options: { directory?: string; nowMs?: number } = {},
): boolean {
  if (!/^[0-9a-f]{32}$/.test(credentialId)) return false;
  const database = openLocalHistory(options.directory);
  try {
    return transaction(database, () => {
      const at = canonicalTimestamp(
        advanceIntegrationClock(database, options.nowMs ?? Date.now()),
        "revocation time",
      );
      const result = database
        .prepare(
          `UPDATE local_integration_credential
              SET revoked_at = ?
            WHERE credential_id = ? AND revoked_at IS NULL`,
        )
        .run(at, credentialId);
      if (Number(result.changes) > 0) {
        recordAuthorization(database, credentialId, "revoked", null, null, at);
        pruneInactiveCredentials(database, at);
      }
      return Number(result.changes) > 0;
    });
  } finally {
    database.close();
  }
}

export function ensureLocalIntegrationProjectRefIn(
  database: DatabaseSync,
  repoId: string,
  now: string,
): ExternalProjectRef {
  database
    .prepare(
      `INSERT OR IGNORE INTO local_integration_project_ref (
         external_ref, repo_id, created_at
       ) VALUES (?, ?, ?)`,
    )
    .run(`prj_${randomHex(16)}`, repoId, now);
  const row = database
    .prepare(
      "SELECT external_ref FROM local_integration_project_ref WHERE repo_id = ?",
    )
    .get(repoId) as { external_ref?: unknown } | undefined;
  if (!row)
    throw new Error("local integration project reference allocation failed");
  return String(row.external_ref) as ExternalProjectRef;
}

export function ensureLocalIntegrationProjectRef(
  repoId: string,
  options: { directory?: string; nowMs?: number } = {},
): ExternalProjectRef {
  if (!REPO_ID_PATTERN.test(repoId))
    throw new TypeError("invalid repository id");
  const database = openLocalHistory(options.directory);
  try {
    return ensureLocalIntegrationProjectRefIn(
      database,
      repoId,
      canonicalTimestamp(options.nowMs ?? Date.now(), "reference time"),
    );
  } finally {
    database.close();
  }
}

export function resolveLocalIntegrationProjectRef(
  projectRef: string,
  directory?: string,
): string | null {
  if (!PROJECT_REF_PATTERN.test(projectRef)) return null;
  const database = openLocalHistory(directory);
  try {
    const row = database
      .prepare(
        "SELECT repo_id FROM local_integration_project_ref WHERE external_ref = ?",
      )
      .get(projectRef) as { repo_id?: unknown } | undefined;
    return row ? String(row.repo_id) : null;
  } finally {
    database.close();
  }
}

export function listLocalIntegrationProjects(
  options: { directory?: string; nowMs?: number } = {},
): IntegrationProjectList {
  const database = openLocalHistory(options.directory);
  try {
    const now = canonicalTimestamp(
      options.nowMs ?? Date.now(),
      "reference time",
    );
    const rows = database
      .prepare(
        `SELECT repo_id, MAX(repo_label) AS repo_label
           FROM local_session
          WHERE ${DISPLAYABLE_SESSION_SQL}
          GROUP BY repo_id
          ORDER BY lower(MAX(repo_label)), repo_id
          LIMIT 500`,
      )
      .all() as Array<{ repo_id?: unknown; repo_label?: unknown }>;
    return {
      apiVersion: INTEGRATION_API_VERSION,
      projects: rows.map((row) => ({
        projectRef: ensureLocalIntegrationProjectRefIn(database, String(row.repo_id), now),
        label: String(row.repo_label),
      })),
    };
  } finally {
    database.close();
  }
}

export function listLocalIntegrationCredentials(
  options: { directory?: string; nowMs?: number } = {},
): IntegrationCredentialList {
  const database = openLocalHistory(options.directory);
  try {
    return transaction(database, () => {
      const now = canonicalTimestamp(
        advanceIntegrationClock(database, options.nowMs ?? Date.now()),
        "inventory time",
      );
      const rows = database
        .prepare(
          `WITH selected AS (
           SELECT * FROM local_integration_credential
            WHERE revoked_at IS NULL AND expires_at > ?
           UNION ALL
           SELECT * FROM (
             SELECT * FROM local_integration_credential
              WHERE revoked_at IS NOT NULL OR expires_at <= ?
              ORDER BY created_at DESC, credential_id DESC
              LIMIT ?
           )
         )
         SELECT credential.credential_id, credential.secret_hash,
                credential.audience, credential.created_at,
                credential.expires_at, credential.last_used_at,
                credential.revoked_at, credential.repo_id,
                credential.data_not_before, credential.data_not_after,
                COALESCE(group_concat(scope.scope, ','), '') AS scopes_csv
           FROM selected AS credential
           LEFT JOIN local_integration_credential_scope AS scope
             ON scope.credential_id = credential.credential_id
          GROUP BY credential.credential_id
          ORDER BY credential.created_at DESC, credential.credential_id DESC
          `,
        )
        .all(
          now,
          now,
          LOCAL_INTEGRATION_INACTIVE_CREDENTIAL_LIMIT,
        ) as unknown as CredentialRow[];
      const credentials: IntegrationCredentialSummary[] = rows.map((row) => {
        const projectRefs =
          row.repo_id === null
            ? undefined
            : [ensureLocalIntegrationProjectRefIn(database, row.repo_id, row.created_at)];
        const dateRange =
          row.data_not_before === null || row.data_not_after === null
            ? undefined
            : {
                from: row.data_not_before.slice(0, 10),
                through: row.data_not_after.slice(0, 10),
              };
        return {
          apiVersion: INTEGRATION_API_VERSION,
          credentialRef: `icr_${row.credential_id}`,
          audience: row.audience,
          scopes: scopesFrom(row),
          issuedAt: row.created_at,
          expiresAt: row.expires_at,
          lastUsedAt: row.last_used_at,
          revokedAt: row.revoked_at,
          ...(projectRefs === undefined && dateRange === undefined
            ? {}
            : {
                restrictions: {
                  ...(projectRefs === undefined ? {} : { projectRefs }),
                  ...(dateRange === undefined ? {} : { dateRange }),
                },
              }),
          rateLimit: {
            requestsPerMinute: LOCAL_INTEGRATION_REQUESTS_PER_MINUTE,
            burst: LOCAL_INTEGRATION_REQUESTS_PER_MINUTE,
          },
        };
      });
      return { apiVersion: INTEGRATION_API_VERSION, credentials };
    });
  } finally {
    database.close();
  }
}

export function ensureLocalIntegrationSessionRefIn(
  database: DatabaseSync,
  sessionId: string,
  now: string,
): ExternalSessionRef {
  database
    .prepare(
      `INSERT OR IGNORE INTO local_integration_session_ref (
         external_ref, session_id, created_at
       ) VALUES (?, ?, ?)`,
    )
    .run(`ses_${randomHex(16)}`, sessionId, now);
  const row = database
    .prepare(
      "SELECT external_ref FROM local_integration_session_ref WHERE session_id = ?",
    )
    .get(sessionId) as { external_ref?: unknown } | undefined;
  if (!row)
    throw new Error("local integration session reference allocation failed");
  return String(row.external_ref) as ExternalSessionRef;
}

export function resolveLocalIntegrationSessionRef(
  sessionRef: string,
  directory?: string,
): string | null {
  if (!SESSION_REF_PATTERN.test(sessionRef)) return null;
  const database = openLocalHistory(directory);
  try {
    return resolveLocalIntegrationSessionRefIn(database, sessionRef);
  } finally {
    database.close();
  }
}

export function resolveLocalIntegrationSessionRefIn(
  database: DatabaseSync,
  sessionRef: string,
): string | null {
  if (!SESSION_REF_PATTERN.test(sessionRef)) return null;
  const row = database
    .prepare(
      "SELECT session_id FROM local_integration_session_ref WHERE external_ref = ?",
    )
    .get(sessionRef) as { session_id?: unknown } | undefined;
  return row ? String(row.session_id) : null;
}

interface CursorRow {
  credential_id: string;
  projection_epoch: number;
  last_event_at: string;
  session_id: string;
  repo_id: string | null;
  requested_since: string;
  requested_until: string;
  confidential_since: string | null;
  confidential_until: string | null;
  total_matched: number;
}

function cursorFor(
  database: DatabaseSync,
  cursor: string,
  boundary: LocalIntegrationReadBoundary,
  now: string,
): CursorRow {
  database
    .prepare("DELETE FROM local_integration_cursor WHERE expires_at <= ?")
    .run(now);
  if (!CURSOR_PATTERN.test(cursor))
    throw new InvalidLocalIntegrationCursorError();
  const row = database
    .prepare(
      `SELECT credential_id, projection_epoch, last_event_at, session_id,
              repo_id, requested_since, requested_until,
              confidential_since, confidential_until, total_matched
         FROM local_integration_cursor
        WHERE cursor_hash = ? AND credential_id = ? AND expires_at > ?`,
    )
    .get(sha256(cursor), boundary.credentialId, now) as CursorRow | undefined;
  if (
    !row ||
    row.repo_id !== boundary.repoId ||
    row.confidential_since !== boundary.confidentialSince ||
    row.confidential_until !== boundary.confidentialUntil
  ) {
    throw new InvalidLocalIntegrationCursorError();
  }
  if (
    row.confidential_until !== null &&
    row.confidential_until >= row.requested_until &&
    row.confidential_until < now
  ) {
    throw new InvalidLocalIntegrationCursorError();
  }
  const epoch = database
    .prepare(
      "SELECT value FROM local_integration_projection_epoch WHERE singleton = 1",
    )
    .get() as { value?: unknown } | undefined;
  if (Number(epoch?.value) !== Number(row.projection_epoch)) {
    throw new LocalIntegrationPageChangedError();
  }
  return row;
}

function createCursorIn(
  database: DatabaseSync,
  boundary: LocalIntegrationReadBoundary,
  last: LocalSessionRow,
  totalMatched: number,
  nowMs: number,
): ExternalCursor {
  const cursor = `cur_${randomHex(16)}_${randomHex(32)}` as ExternalCursor;
  const epoch = database
    .prepare(
      "SELECT value FROM local_integration_projection_epoch WHERE singleton = 1",
    )
    .get() as { value?: unknown } | undefined;
  const now = canonicalTimestamp(nowMs, "cursor time");
  database
    .prepare("DELETE FROM local_integration_cursor WHERE expires_at <= ?")
    .run(now);
  const live = database
    .prepare("SELECT COUNT(*) AS count FROM local_integration_cursor")
    .get() as { count?: unknown } | undefined;
  if (Number(live?.count ?? 0) >= LOCAL_INTEGRATION_CURSOR_LIMIT) {
    throw new LocalIntegrationCursorCapacityError();
  }
  database
    .prepare(
      `INSERT INTO local_integration_cursor (
         cursor_hash, credential_id, projection_epoch, last_event_at,
         session_id, repo_id, requested_since, requested_until,
         confidential_since, confidential_until, total_matched, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sha256(cursor),
      boundary.credentialId,
      Number(epoch?.value ?? 0),
      last.lastEventAt,
      last.sessionId,
      boundary.repoId,
      boundary.requestedSince,
      boundary.requestedUntil,
      boundary.confidentialSince,
      boundary.confidentialUntil,
      totalMatched,
      now,
      canonicalTimestamp(
        nowMs + LOCAL_INTEGRATION_CURSOR_TTL_MS,
        "cursor expiry",
      ),
    );
  return cursor;
}

/**
 * Bounded keyset page with stored opaque references and cursor state. Date
 * restrictions contain the whole observed span. A still-active session cannot
 * prove containment beneath an upper bound that is already in the past.
 */
export function listLocalIntegrationSessionPage(
  boundary: LocalIntegrationReadBoundary,
  options: {
    limit: number;
    cursor: ExternalCursor | null;
    directory?: string;
    nowMs?: number;
  },
): LocalIntegrationSessionPage {
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 100
  ) {
    throw new RangeError("integration page limit invalid");
  }
  const proposedNowMs = options.nowMs ?? Date.now();
  const database = openLocalHistory(options.directory);
  try {
    // Commit the monotonic authority clock independently. Cursor refusal rolls
    // back the page snapshot, but must not roll back time and resurrect an
    // expired cursor on the caller's next request.
    transaction(database, () =>
      advanceIntegrationClock(database, proposedNowMs),
    );
    return transaction(database, () => {
      assertLocalIntegrationPersonalAuthority(database);
      const nowMs = advanceIntegrationClock(database, proposedNowMs);
      const now = canonicalTimestamp(nowMs, "query time");
      const cursor =
        options.cursor === null
          ? null
          : cursorFor(database, options.cursor, boundary, now);
      const effectiveBoundary: LocalIntegrationReadBoundary =
        cursor === null
          ? boundary
          : {
              ...boundary,
              requestedSince: cursor.requested_since,
              requestedUntil: cursor.requested_until,
            };
      const conditions = [
        DISPLAYABLE_SESSION_SQL,
        "last_event_at >= ?",
        "last_event_at <= ?",
      ];
      const values: Array<string | number> = [
        effectiveBoundary.requestedSince,
        effectiveBoundary.requestedUntil,
      ];
      if (effectiveBoundary.repoId !== null) {
        conditions.push("repo_id = ?");
        values.push(effectiveBoundary.repoId);
      }
      if (effectiveBoundary.confidentialSince !== null) {
        conditions.push("started_at >= ?");
        values.push(effectiveBoundary.confidentialSince);
      }
      if (effectiveBoundary.confidentialUntil !== null) {
        conditions.push("last_event_at <= ?");
        values.push(effectiveBoundary.confidentialUntil);
        if (effectiveBoundary.confidentialUntil < now) {
          conditions.push("ended_at IS NOT NULL");
        }
      }
      if (cursor !== null) {
        conditions.push(
          "(last_event_at < ? OR (last_event_at = ? AND session_id > ?))",
        );
        values.push(
          cursor.last_event_at,
          cursor.last_event_at,
          cursor.session_id,
        );
      }
      const totalMatched =
        cursor?.total_matched ??
        Number(
          (
            database
              .prepare(
                `SELECT COUNT(*) AS count FROM local_session
            WHERE ${conditions.slice(0, cursor === null ? conditions.length : -1).join(" AND ")}`,
              )
              .get(...values.slice(0, cursor === null ? values.length : -3)) as
              { count?: unknown } | undefined
          )?.count ?? 0,
        );
      const raw = database
        .prepare(
          `SELECT * FROM local_session
          WHERE ${conditions.join(" AND ")}
          ORDER BY last_event_at DESC, session_id ASC
          LIMIT ?`,
        )
        .all(...values, options.limit + 1) as Array<Record<string, unknown>>;
      const selected = raw.slice(0, options.limit).map(mapLocalSessionRow);
      const declaredBySession = new Map<string, SessionCapabilities | undefined>();
      if (selected.length > 0) {
        const placeholders = selected.map(() => "?").join(", ");
        const starts = database
          .prepare(
            `SELECT event.session_id, event.payload_json
               FROM local_event AS event
              WHERE event.kind = 'session.start'
                AND event.session_id IN (${placeholders})
                AND event.local_seq = (
                  SELECT MIN(first.local_seq)
                    FROM local_event AS first
                   WHERE first.session_id = event.session_id
                     AND first.kind = 'session.start'
                )`,
          )
          .all(...selected.map((session) => session.sessionId)) as Array<{
            session_id?: unknown;
            payload_json?: unknown;
          }>;
        for (const start of starts) {
          try {
            const event = parseSessionEvent(JSON.parse(String(start.payload_json)));
            if (event?.kind === "session.start") {
              declaredBySession.set(String(start.session_id), event.capabilities);
            }
          } catch {
            // A malformed retained start cannot authorize a reporting claim.
          }
        }
      }
      const rows = selected.map((session) => {
        return {
          sessionRef: ensureLocalIntegrationSessionRefIn(database, session.sessionId, now),
          projectRef: ensureLocalIntegrationProjectRefIn(database, session.repoId, now),
          session,
          declaredCapabilities: declaredBySession.get(session.sessionId),
        };
      });
      return {
        rows,
        boundary: effectiveBoundary,
        totalMatched,
        queryTime: now,
        nextCursor:
          raw.length > options.limit && selected.length > 0
            ? createCursorIn(
                database,
                effectiveBoundary,
                selected.at(-1)!,
                totalMatched,
                nowMs,
              )
            : null,
      };
    });
  } finally {
    database.close();
  }
}

export function readLocalIntegrationSession(
  sessionId: string,
  directory?: string,
): LocalSessionRow | null {
  const database = openLocalHistory(directory);
  try {
    return readLocalIntegrationSessionIn(database, sessionId);
  } finally {
    database.close();
  }
}

export function readLocalIntegrationSessionIn(
  database: DatabaseSync,
  sessionId: string,
): LocalSessionRow | null {
  const row = database
    .prepare(
      `SELECT * FROM local_session
        WHERE session_id = ? AND ${DISPLAYABLE_SESSION_SQL}`,
    )
    .get(sessionId) as Record<string, unknown> | undefined;
  return row ? mapLocalSessionRow(row) : null;
}

export function localIntegrationObservedWindow(
  boundary: LocalIntegrationReadBoundary,
  options: { directory?: string; nowMs?: number } = {},
): { count: number; first: string | null; last: string | null } {
  const database = openLocalHistory(options.directory);
  try {
    return localIntegrationObservedWindowIn(
      database,
      boundary,
      options.nowMs ?? Date.now(),
    );
  } finally {
    database.close();
  }
}

export function localIntegrationObservedWindowIn(
  database: DatabaseSync,
  boundary: LocalIntegrationReadBoundary,
  nowMs: number,
): { count: number; first: string | null; last: string | null } {
  const now = canonicalTimestamp(nowMs, "query time");
  const conditions = [
    DISPLAYABLE_SESSION_SQL,
    "last_event_at >= ?",
    "last_event_at <= ?",
  ];
  const values: string[] = [boundary.requestedSince, boundary.requestedUntil];
  if (boundary.repoId !== null) {
    conditions.push("repo_id = ?");
    values.push(boundary.repoId);
  }
  if (boundary.confidentialSince !== null) {
    conditions.push("started_at >= ?");
    values.push(boundary.confidentialSince);
  }
  if (boundary.confidentialUntil !== null) {
    conditions.push("last_event_at <= ?");
    values.push(boundary.confidentialUntil);
    if (boundary.confidentialUntil < now)
      conditions.push("ended_at IS NOT NULL");
  }
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count, MIN(last_event_at) AS first,
              MAX(last_event_at) AS last
         FROM local_session
        WHERE ${conditions.join(" AND ")}`,
    )
    .get(...values) as
    { count?: unknown; first?: unknown; last?: unknown } | undefined;
  return {
    count: Number(row?.count ?? 0),
    first:
      row?.first === null || row?.first === undefined
        ? null
        : String(row.first),
    last:
      row?.last === null || row?.last === undefined ? null : String(row.last),
  };
}

export function recordLocalIntegrationQueryAudit(
  principal: LocalIntegrationPrincipal,
  entry: {
    operation:
      | "period_summary"
      | "list_sessions"
      | "get_session_outcome"
      | "replay_lens";
    result:
      | "ok"
      | "unavailable"
      | "refused"
      | "protocol_error"
      | "internal_error"
      | "oversized";
    httpStatus: number;
    returnedCount: number | null;
    responseBytes: number | null;
    directory?: string;
    nowMs?: number;
  },
): void {
  const database = openLocalHistory(entry.directory);
  try {
    transaction(database, () => {
      const at = canonicalTimestamp(
        advanceIntegrationClock(database, entry.nowMs ?? Date.now()),
        "audit time",
      );
      database
        .prepare(
          `INSERT INTO local_integration_query_audit (
           credential_id, operation, result, http_status,
           returned_count, response_bytes, at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          principal.credentialId,
          entry.operation,
          entry.result,
          entry.httpStatus,
          entry.returnedCount,
          entry.responseBytes,
          at,
        );
    });
  } finally {
    database.close();
  }
}

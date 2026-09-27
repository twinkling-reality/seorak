import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionEvent } from "@seorak/types";
import {
  InvalidLocalIntegrationCursorError,
  LocalIntegrationAuthorityChangedError,
  LocalIntegrationPageChangedError,
  LocalIntegrationCredentialLimitError,
  LOCAL_INTEGRATION_ACTIVE_CREDENTIAL_LIMIT,
  LOCAL_INTEGRATION_CURSOR_TTL_MS,
  LOCAL_INTEGRATION_CURSOR_LIMIT,
  authorizeLocalIntegrationCredential,
  createLocalIntegrationCredential,
  listLocalIntegrationCredentials,
  listLocalIntegrationSessionPage,
  recordLocalIntegrationQueryAudit,
  revokeLocalIntegrationCredential,
} from "../src/local-integration-store.ts";
import {
  LOCAL_HISTORY_SCHEMA_VERSION,
  appendLocalEvent,
  openLocalHistory,
} from "../src/local-store.ts";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const API_AUDIENCE = "http://127.0.0.1:4318/api/v1";
const REPO = "a".repeat(64);
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "seorak-local-integration-"));
  temporary.push(path);
  return path;
}

function issue(dir: string, audience = API_AUDIENCE) {
  return createLocalIntegrationCredential({
    directory: dir,
    audience,
    scopes: ["period:read", "sessions:read", "replay:read"],
    expiresAt: new Date(NOW + 24 * 60 * 60_000).toISOString(),
    nowMs: NOW,
  });
}

function start(sessionId: string, at: string, ended = true): SessionEvent[] {
  const events: SessionEvent[] = [
    {
      kind: "session.start",
      eventId: `${sessionId}-start`,
      sessionId,
      at,
      repoId: REPO,
      repoLabel: "seorak",
      agent: "claude-code",
      agentVersion: "1.0.0",
    },
  ];
  if (ended) {
    events.push({
      kind: "session.end",
      eventId: `${sessionId}-end`,
      sessionId,
      at: new Date(Date.parse(at) + 60_000).toISOString(),
      reason: "clear",
    });
  }
  return events;
}

function principal(dir: string, token: string, nowMs = NOW) {
  const auth = authorizeLocalIntegrationCredential(`Bearer ${token}`, {
    directory: dir,
    audience: API_AUDIENCE,
    scope: "sessions:read",
    routeClass: "read",
    nowMs,
  });
  if (!auth.ok) throw new Error(`authorization failed: ${auth.reason}`);
  return auth.principal;
}

describe("local integration authority foundation", () => {
  it("upgrades a real v4-shaped database identically and preserves private file mode", () => {
    const freshDir = directory();
    const migratedDir = directory();
    const fresh = openLocalHistory(freshDir);
    fresh.close();
    const legacy = openLocalHistory(migratedDir);
    legacy.exec(`
      DROP TRIGGER local_integration_epoch_insert;
      DROP TRIGGER local_integration_epoch_update;
      DROP TRIGGER local_integration_epoch_delete;
      DROP TABLE local_integration_cursor;
      DROP TABLE local_integration_session_ref;
      DROP TABLE local_integration_project_ref;
      DROP TABLE local_integration_projection_epoch;
      DROP TABLE local_integration_query_audit;
      DROP TABLE local_integration_authorization_audit;
      DROP TABLE local_integration_route_budget;
      DROP TABLE local_integration_credential_budget;
      DROP TABLE local_integration_denial_state;
      DROP TABLE local_integration_credential_scope;
      DROP TABLE local_integration_credential;
      DROP TABLE local_integration_clock;
      DROP TABLE local_session_launcher;
      PRAGMA user_version = 4;
    `);
    legacy.close();
    const upgraded = openLocalHistory(migratedDir);
    upgraded.close();

    const signature = (dir: string) => {
      const database = openLocalHistory(dir);
      try {
        return database
          .prepare(
            `SELECT type, name, sql FROM sqlite_master
            WHERE name LIKE 'local_integration_%'
            ORDER BY type, name`,
          )
          .all();
      } finally {
        database.close();
      }
    };
    expect(signature(migratedDir)).toEqual(signature(freshDir));
    expect(statSync(join(migratedDir, "history.sqlite")).mode & 0o777).toBe(
      0o600,
    );
  });

  it("upgrades v7 to v8 in place, keeping every audit row and matching a fresh schema", () => {
    const freshDir = directory();
    const migratedDir = directory();
    openLocalHistory(freshDir).close();
    const legacy = openLocalHistory(migratedDir);
    // Rebuild the v7 shape: the four-operation audit CHECK and no launcher table.
    legacy.exec(`
      DROP TABLE local_session_launcher;
      DROP TABLE local_integration_query_audit;
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
      INSERT INTO local_integration_query_audit (
        credential_id, operation, result, http_status, returned_count, response_bytes, at
      ) VALUES ('${"a".repeat(32)}', 'list_sessions', 'ok', 200, 3, 512, '2026-09-01T00:00:00.000Z');
      PRAGMA user_version = 7;
    `);
    expect(() =>
      legacy.exec(`INSERT INTO local_integration_query_audit (
        credential_id, operation, result, http_status, at
      ) VALUES ('x', 'resolve_session', 'ok', 200, 'now')`),
    ).toThrow();
    legacy.close();

    const upgraded = openLocalHistory(migratedDir);
    try {
      expect(upgraded.prepare("PRAGMA user_version").get()).toEqual({
        user_version: LOCAL_HISTORY_SCHEMA_VERSION,
      });
      expect(
        upgraded
          .prepare("SELECT audit_id, operation, returned_count FROM local_integration_query_audit")
          .all(),
      ).toEqual([{ audit_id: 1, operation: "list_sessions", returned_count: 3 }]);
      upgraded.exec(`INSERT INTO local_integration_query_audit (
        credential_id, operation, result, http_status, at
      ) VALUES ('${"a".repeat(32)}', 'resolve_session', 'ok', 200, '2026-09-02T00:00:00.000Z')`);
    } finally {
      upgraded.close();
    }

    const signature = (dir: string) => {
      const database = openLocalHistory(dir);
      try {
        return database
          .prepare(
            `SELECT type, name, sql FROM sqlite_master
            WHERE name LIKE 'local_integration_query_audit%'
               OR name LIKE 'idx_local_integration_query_audit%'
               OR name = 'local_session_launcher'
            ORDER BY type, name`,
          )
          .all();
      } finally {
        database.close();
      }
    };
    expect(signature(migratedDir)).toEqual(signature(freshDir));
  });

  it("migrates v5 and persists only hashes for secrets and cursors", () => {
    const dir = directory();
    for (const event of start("session-one", "2026-08-08T10:00:00.000Z")) {
      appendLocalEvent(event, dir);
    }
    for (const event of start("session-two", "2026-08-08T11:00:00.000Z")) {
      appendLocalEvent(event, dir);
    }
    const created = issue(dir);
    const actor = principal(dir, created.token);
    const page = listLocalIntegrationSessionPage(
      {
        credentialId: actor.credentialId,
        repoId: null,
        requestedSince: "2026-05-01T00:00:00.000Z",
        requestedUntil: "2026-08-09T12:00:00.000Z",
        confidentialSince: null,
        confidentialUntil: null,
      },
      { directory: dir, limit: 1, cursor: null, nowMs: NOW },
    );
    expect(page.nextCursor).toMatch(/^cur_[0-9a-f]{32}_[0-9a-f]{64}$/);

    const database = openLocalHistory(dir);
    try {
      expect(database.prepare("PRAGMA user_version").get()).toEqual({
        user_version: LOCAL_HISTORY_SCHEMA_VERSION,
      });
      const credential = database
        .prepare("SELECT secret_hash FROM local_integration_credential")
        .get() as {
        secret_hash?: unknown;
      };
      expect(String(credential.secret_hash)).toMatch(/^[0-9a-f]{64}$/);
      expect(String(credential.secret_hash)).not.toContain(created.token);
      const cursor = database
        .prepare("SELECT cursor_hash FROM local_integration_cursor")
        .get() as {
        cursor_hash?: unknown;
      };
      expect(String(cursor.cursor_hash)).toMatch(/^[0-9a-f]{64}$/);
      expect(String(cursor.cursor_hash)).not.toBe(page.nextCursor);
    } finally {
      database.close();
    }
  });

  it("keeps principals distinct, exact-audience, scoped, expiring, and independently revocable", () => {
    const dir = directory();
    const created = issue(dir);
    expect(
      authorizeLocalIntegrationCredential("Bearer operator-key", {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
        directory: dir,
        audience: "http://127.0.0.1:4318/mcp/private",
        scope: "sessions:read",
        routeClass: "read",
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: "audience" });
    expect(
      revokeLocalIntegrationCredential(created.credentialId, {
        directory: dir,
        nowMs: NOW + 1,
      }),
    ).toBe(true);
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: NOW + 2,
      }),
    ).toEqual({ ok: false, reason: "revoked" });
  });

  it("enforces a persistent token bucket across minute edges and clock rollback", () => {
    const dir = directory();
    const created = issue(dir);
    const edge = Date.parse("2026-08-09T12:00:59.999Z");
    for (let call = 0; call < 60; call += 1) {
      expect(
        authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
          directory: dir,
          audience: API_AUDIENCE,
          scope: "sessions:read",
          routeClass: "read",
          nowMs: edge,
        }).ok,
      ).toBe(true);
    }
    const limitedObserver = openLocalHistory(dir);
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: edge + 1,
      }),
    ).toEqual({ ok: false, reason: "rate_limited" });
    const limitedVersion = limitedObserver.prepare("PRAGMA data_version").get();
    const limitedState = {
      clock: limitedObserver
        .prepare("SELECT * FROM local_integration_clock")
        .get(),
      budget: limitedObserver
        .prepare(
          `SELECT tokens, updated_at, limited FROM local_integration_credential_budget
          WHERE credential_id = ?`,
        )
        .get(created.credentialId),
    };
    expect(limitedState.clock).toEqual({ singleton: 1, last_seen_ms: edge + 1 });
    for (let call = 0; call < 10_000; call += 1) {
      expect(
        authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
          directory: dir,
          audience: API_AUDIENCE,
          scope: "sessions:read",
          routeClass: "read",
          nowMs: edge + 1,
        }),
      ).toEqual({ ok: false, reason: "rate_limited" });
    }
    try {
      expect(limitedObserver.prepare("PRAGMA data_version").get()).toEqual(
        limitedVersion,
      );
      expect({
        clock: limitedObserver
          .prepare("SELECT * FROM local_integration_clock")
          .get(),
        budget: limitedObserver
          .prepare(
            `SELECT tokens, updated_at, limited FROM local_integration_credential_budget
            WHERE credential_id = ?`,
          )
          .get(created.credentialId),
      }).toEqual(limitedState);
      expect(
        limitedObserver
          .prepare(
            `SELECT COUNT(*) AS count FROM local_integration_authorization_audit
          WHERE credential_id = ? AND reason = 'rate_limited'`,
          )
          .get(created.credentialId),
      ).toEqual({ count: 1 });
    } finally {
      limitedObserver.close();
    }
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: edge - 30_000,
      }),
    ).toEqual({ ok: false, reason: "rate_limited" });
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: edge + 1_000,
      }).ok,
    ).toBe(true);
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: edge + 1_000,
      }),
    ).toEqual({ ok: false, reason: "rate_limited" });

    const partial = issue(dir);
    const future = edge + 60 * 60_000;
    for (let call = 0; call < 30; call += 1) {
      expect(
        authorizeLocalIntegrationCredential(`Bearer ${partial.token}`, {
          directory: dir,
          audience: API_AUDIENCE,
          scope: "sessions:read",
          routeClass: "read",
          nowMs: future,
        }).ok,
      ).toBe(true);
    }
    for (let call = 0; call < 30; call += 1) {
      expect(
        authorizeLocalIntegrationCredential(`Bearer ${partial.token}`, {
          directory: dir,
          audience: API_AUDIENCE,
          scope: "sessions:read",
          routeClass: "read",
          nowMs: future - 60 * 60_000,
        }).ok,
      ).toBe(true);
    }
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${partial.token}`, {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: future - 60 * 60_000,
      }),
    ).toEqual({ ok: false, reason: "rate_limited" });
    expect(LOCAL_INTEGRATION_CURSOR_LIMIT).toBeGreaterThanOrEqual(9_600);
  });

  it("does not let invalid lifecycle credentials spend the plane backstop", () => {
    const dir = directory();
    const created = issue(dir);
    principal(dir, created.token);
    revokeLocalIntegrationCredential(created.credentialId, {
      directory: dir,
      nowMs: NOW + 1,
    });
    const before = openLocalHistory(dir);
    const tokens = Number(
      (
        before
          .prepare(
            "SELECT tokens FROM local_integration_route_budget WHERE route_class = 'read'",
          )
          .get() as { tokens?: unknown }
      ).tokens,
    );
    before.close();
    authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
      directory: dir,
      audience: API_AUDIENCE,
      scope: "sessions:read",
      routeClass: "read",
      nowMs: NOW + 2,
    });
    const after = openLocalHistory(dir);
    try {
      expect(
        Number(
          (
            after
              .prepare(
                "SELECT tokens FROM local_integration_route_budget WHERE route_class = 'read'",
              )
              .get() as { tokens?: unknown }
          ).tokens,
        ),
      ).toBe(tokens);
    } finally {
      after.close();
    }
  });

  it("does not commit token spend when the route backstop is exhausted", () => {
    const dir = directory();
    const created = issue(dir);
    const seeded = openLocalHistory(dir);
    seeded
      .prepare(
        `INSERT INTO local_integration_route_budget (
         route_class, tokens, updated_at, limited
       ) VALUES ('aggregate', 0, ?, 0)`,
      )
      .run(new Date(NOW).toISOString());
    seeded.close();
    const observer = openLocalHistory(dir);
    try {
      expect(
        authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
          directory: dir,
          audience: API_AUDIENCE,
          scope: "period:read",
          routeClass: "aggregate",
          nowMs: NOW + 1,
        }),
      ).toEqual({ ok: false, reason: "route_rate_limited" });
      const version = observer.prepare("PRAGMA data_version").get();
      const state = {
        clock: observer.prepare("SELECT * FROM local_integration_clock").get(),
        route: observer
          .prepare(
            "SELECT * FROM local_integration_route_budget WHERE route_class = 'aggregate'",
          )
          .get(),
        token: observer
          .prepare(
            "SELECT * FROM local_integration_credential_budget WHERE credential_id = ?",
          )
          .get(created.credentialId),
        audit: observer
          .prepare(
            `SELECT action, reason, at FROM local_integration_authorization_audit
            WHERE credential_id = ? ORDER BY audit_id`,
          )
          .all(created.credentialId),
      };
      expect(state.clock).toEqual({ singleton: 1, last_seen_ms: NOW + 1 });
      expect(state.token).toBeUndefined();
      for (let call = 0; call < 100; call += 1) {
        expect(
          authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
            directory: dir,
            audience: API_AUDIENCE,
            scope: "period:read",
            routeClass: "aggregate",
            nowMs: NOW + 1,
          }),
        ).toEqual({ ok: false, reason: "route_rate_limited" });
      }
      expect(observer.prepare("PRAGMA data_version").get()).toEqual(version);
      expect({
        clock: observer.prepare("SELECT * FROM local_integration_clock").get(),
        route: observer
          .prepare(
            "SELECT * FROM local_integration_route_budget WHERE route_class = 'aggregate'",
          )
          .get(),
        token: observer
          .prepare(
            "SELECT * FROM local_integration_credential_budget WHERE credential_id = ?",
          )
          .get(created.credentialId),
        audit: observer
          .prepare(
            `SELECT action, reason, at FROM local_integration_authorization_audit
            WHERE credential_id = ? ORDER BY audit_id`,
          )
          .all(created.credentialId),
      }).toEqual(state);
    } finally {
      observer.close();
    }
  });

  it("keeps repeated static denials read-only after the first authority transition", () => {
    const dir = directory();
    const created = issue(dir);
    const expiring = createLocalIntegrationCredential({
      directory: dir,
      audience: API_AUDIENCE,
      scopes: ["sessions:read"],
      expiresAt: new Date(NOW + 1_000).toISOString(),
      nowMs: NOW,
    });
    const observer = openLocalHistory(dir);
    const state = (credentialId = created.credentialId) => {
      return {
        dataVersion: observer.prepare("PRAGMA data_version").get(),
        clock: observer.prepare("SELECT * FROM local_integration_clock").get(),
        audit: observer
          .prepare(
            `SELECT action, reason, at FROM local_integration_authorization_audit
              WHERE credential_id = ? ORDER BY audit_id`,
          )
          .all(credentialId),
        budgets: observer
          .prepare(
            `SELECT tokens, updated_at, limited FROM local_integration_credential_budget
              WHERE credential_id = ?`,
          )
          .all(credentialId),
        denials: observer
          .prepare(
            `SELECT reason, at FROM local_integration_denial_state
              WHERE credential_id = ? ORDER BY reason`,
          )
          .all(credentialId),
      };
    };
    try {
      expect(
        authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
          directory: dir,
          audience: "http://127.0.0.1:4318/mcp/private",
          scope: "sessions:read",
          routeClass: "read",
          nowMs: NOW,
        }),
      ).toEqual({ ok: false, reason: "audience" });
      const beforeAudience = state();
      for (let call = 0; call < 100; call += 1) {
        expect(
          authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
            directory: dir,
            audience: "http://127.0.0.1:4318/mcp/private",
            scope: "sessions:read",
            routeClass: "read",
            nowMs: NOW,
          }),
        ).toEqual({ ok: false, reason: "audience" });
      }
      expect(state()).toEqual(beforeAudience);

      expect(
        authorizeLocalIntegrationCredential(`Bearer ${expiring.token}`, {
          directory: dir,
          audience: API_AUDIENCE,
          scope: "sessions:read",
          routeClass: "read",
          nowMs: NOW + 2_000,
        }),
      ).toEqual({ ok: false, reason: "expired" });
      const beforeExpired = state(expiring.credentialId);
      for (let call = 0; call < 100; call += 1) {
        expect(
          authorizeLocalIntegrationCredential(`Bearer ${expiring.token}`, {
            directory: dir,
            audience: API_AUDIENCE,
            scope: "sessions:read",
            routeClass: "read",
            nowMs: NOW,
          }),
        ).toEqual({ ok: false, reason: "expired" });
      }
      expect(state(expiring.credentialId)).toEqual(beforeExpired);

      revokeLocalIntegrationCredential(created.credentialId, {
        directory: dir,
        nowMs: NOW + 3_000,
      });
      expect(
        authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
          directory: dir,
          audience: API_AUDIENCE,
          scope: "sessions:read",
          routeClass: "read",
          nowMs: NOW + 4_000,
        }),
      ).toEqual({ ok: false, reason: "revoked" });
      const beforeRevoked = state();
      for (let call = 0; call < 100; call += 1) {
        expect(
          authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
            directory: dir,
            audience: API_AUDIENCE,
            scope: "sessions:read",
            routeClass: "read",
            nowMs: NOW + 4_000,
          }),
        ).toEqual({ ok: false, reason: "revoked" });
      }
      expect(state()).toEqual(beforeRevoked);
    } finally {
      observer.close();
    }
  });

  it("restores cursor snapshots across real clock drift and refuses epoch or authority drift", () => {
    const dir = directory();
    for (const [index, hour] of [9, 10, 11].entries()) {
      for (const event of start(
        `session-${index}`,
        `2026-08-08T${String(hour).padStart(2, "0")}:00:00.000Z`,
      )) {
        appendLocalEvent(event, dir);
      }
    }
    const created = issue(dir);
    const actor = principal(dir, created.token);
    const boundary = {
      credentialId: actor.credentialId,
      repoId: null,
      requestedSince: "2026-05-11T12:00:00.000Z",
      requestedUntil: "2026-08-09T12:00:00.000Z",
      confidentialSince: null,
      confidentialUntil: null,
    };
    const first = listLocalIntegrationSessionPage(boundary, {
      directory: dir,
      limit: 2,
      cursor: null,
      nowMs: NOW,
    });
    expect(first.totalMatched).toBe(3);
    const second = listLocalIntegrationSessionPage(
      {
        ...boundary,
        requestedSince: "2026-05-11T12:00:01.000Z",
        requestedUntil: "2026-08-09T12:00:01.000Z",
      },
      {
        directory: dir,
        limit: 2,
        cursor: first.nextCursor,
        nowMs: NOW + 1_000,
      },
    );
    expect(second.totalMatched).toBe(3);
    expect(second.boundary.requestedUntil).toBe(boundary.requestedUntil);
    expect(second.rows).toHaveLength(1);
    expect(() =>
      listLocalIntegrationSessionPage(
        {
          ...boundary,
          confidentialSince: "2026-08-01T00:00:00.000Z",
        },
        {
          directory: dir,
          limit: 2,
          cursor: first.nextCursor,
          nowMs: NOW + 1_500,
        },
      ),
    ).toThrow(InvalidLocalIntegrationCursorError);

    const changed = listLocalIntegrationSessionPage(boundary, {
      directory: dir,
      limit: 1,
      cursor: null,
      nowMs: NOW + 2_000,
    });
    for (const event of start("session-new", "2026-08-08T12:00:00.000Z")) {
      appendLocalEvent(event, dir);
    }
    expect(() =>
      listLocalIntegrationSessionPage(boundary, {
        directory: dir,
        limit: 1,
        cursor: changed.nextCursor,
        nowMs: NOW + 3_000,
      }),
    ).toThrow(LocalIntegrationPageChangedError);
    const other = issue(dir);
    expect(() =>
      listLocalIntegrationSessionPage(
        { ...boundary, credentialId: other.credentialId },
        {
          directory: dir,
          limit: 1,
          cursor: first.nextCursor,
          nowMs: NOW + 4_000,
        },
      ),
    ).toThrow(InvalidLocalIntegrationCursorError);
    expect(() =>
      listLocalIntegrationSessionPage(boundary, {
        directory: dir,
        limit: 2,
        cursor: first.nextCursor,
        nowMs: NOW + LOCAL_INTEGRATION_CURSOR_TTL_MS + 1,
      }),
    ).toThrow(InvalidLocalIntegrationCursorError);
    expect(() =>
      listLocalIntegrationSessionPage(boundary, {
        directory: dir,
        limit: 2,
        cursor: first.nextCursor,
        nowMs: NOW,
      }),
    ).toThrow(InvalidLocalIntegrationCursorError);
  });

  it("contains whole session spans and refuses an active session below a past upper bound", () => {
    const dir = directory();
    for (const event of start("straddled", "2026-08-01T09:00:00.000Z"))
      appendLocalEvent(event, dir);
    for (const event of start("active", "2026-08-02T09:00:00.000Z", false))
      appendLocalEvent(event, dir);
    const created = issue(dir);
    const actor = principal(dir, created.token);
    const page = listLocalIntegrationSessionPage(
      {
        credentialId: actor.credentialId,
        repoId: null,
        requestedSince: "2026-07-01T00:00:00.000Z",
        requestedUntil: "2026-08-09T12:00:00.000Z",
        confidentialSince: "2026-08-01T10:00:00.000Z",
        confidentialUntil: "2026-08-03T00:00:00.000Z",
      },
      { directory: dir, limit: 10, cursor: null, nowMs: NOW },
    );
    expect(page.rows).toEqual([]);
  });

  it("invalidates an active upper-bound crossing without breaking an already-ended page", () => {
    const dir = directory();
    for (const event of start(
      "active-one",
      "2026-08-09T11:58:00.000Z",
      false,
    )) {
      appendLocalEvent(event, dir);
    }
    for (const event of start(
      "active-two",
      "2026-08-09T11:59:00.000Z",
      false,
    )) {
      appendLocalEvent(event, dir);
    }
    const actor = principal(dir, issue(dir).token);
    const crossing = {
      credentialId: actor.credentialId,
      repoId: null,
      requestedSince: "2026-08-08T12:00:00.000Z",
      requestedUntil: new Date(NOW).toISOString(),
      confidentialSince: null,
      confidentialUntil: new Date(NOW).toISOString(),
    };
    const first = listLocalIntegrationSessionPage(crossing, {
      directory: dir,
      limit: 1,
      cursor: null,
      nowMs: NOW,
    });
    expect(first.nextCursor).not.toBeNull();
    expect(() =>
      listLocalIntegrationSessionPage(crossing, {
        directory: dir,
        limit: 1,
        cursor: first.nextCursor,
        nowMs: NOW + 1,
      }),
    ).toThrow(InvalidLocalIntegrationCursorError);

    for (const event of start("ended-one", "2026-08-08T10:00:00.000Z")) {
      appendLocalEvent(event, dir);
    }
    for (const event of start("ended-two", "2026-08-08T11:00:00.000Z")) {
      appendLocalEvent(event, dir);
    }
    const alreadyPast = {
      ...crossing,
      requestedSince: "2026-08-08T00:00:00.000Z",
      requestedUntil: new Date(NOW).toISOString(),
      confidentialUntil: "2026-08-08T12:00:00.000Z",
    };
    const endedFirst = listLocalIntegrationSessionPage(alreadyPast, {
      directory: dir,
      limit: 1,
      cursor: null,
      nowMs: NOW,
    });
    expect(() =>
      listLocalIntegrationSessionPage(alreadyPast, {
        directory: dir,
        limit: 1,
        cursor: endedFirst.nextCursor,
        nowMs: NOW + 1_500,
      }),
    ).not.toThrow();
  });

  it("keeps active inventory visible and bounds inactive authority plus content-free audit", () => {
    const dir = directory();
    const active = issue(dir);
    const database = openLocalHistory(dir);
    try {
      const insert = database.prepare(
        `INSERT INTO local_integration_credential (
           credential_id, secret_hash, audience, created_at, expires_at,
           last_used_at, revoked_at, repo_id, data_not_before, data_not_after
         ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL)`,
      );
      for (let index = 0; index < 501; index += 1) {
        const id = index.toString(16).padStart(32, "0");
        const at = new Date(NOW + index + 1).toISOString();
        insert.run(id, "f".repeat(64), API_AUDIENCE, at, at, at);
      }
    } finally {
      database.close();
    }
    const triggerPrune = issue(dir);
    expect(
      listLocalIntegrationCredentials({
        directory: dir,
        nowMs: NOW,
      }).credentials.map((credential) => credential.credentialRef),
    ).toContain(`icr_${active.credentialId}`);
    const actor = principal(dir, triggerPrune.token);
    for (let index = 0; index < 550; index += 1) {
      recordLocalIntegrationQueryAudit(actor, {
        directory: dir,
        operation: "list_sessions",
        result: "ok",
        httpStatus: 200,
        returnedCount: 0,
        responseBytes: 100,
        nowMs: NOW + index,
      });
    }
    const bounded = openLocalHistory(dir);
    try {
      expect(
        (
          bounded
            .prepare(
              "SELECT COUNT(*) AS count FROM local_integration_credential",
            )
            .get() as { count: number }
        ).count,
      ).toBeLessThanOrEqual(502);
      expect(
        (
          bounded
            .prepare(
              "SELECT COUNT(*) AS count FROM local_integration_query_audit WHERE credential_id = ?",
            )
            .get(actor.credentialId) as { count: number }
        ).count,
      ).toBe(500);
      expect(
        bounded
          .prepare("PRAGMA table_info(local_integration_query_audit)")
          .all()
          .map((row) => String((row as { name?: unknown }).name)),
      ).not.toEqual(
        expect.arrayContaining(["request_body", "response_body", "cursor"]),
      );
    } finally {
      bounded.close();
    }
  });

  it("fails closed if local history gains shared provenance", () => {
    const dir = directory();
    const created = issue(dir);
    const database = openLocalHistory(dir);
    database.exec("ALTER TABLE local_session ADD COLUMN member_id TEXT");
    database.close();
    expect(() =>
      authorizeLocalIntegrationCredential(`Bearer ${created.token}`, {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: NOW,
      }),
    ).toThrow(LocalIntegrationAuthorityChangedError);
  });

  it("refuses permanent or overlong grants", () => {
    const dir = directory();
    expect(() =>
      createLocalIntegrationCredential({
        directory: dir,
        audience: API_AUDIENCE,
        scopes: ["sessions:read"],
        expiresAt: new Date(NOW + 367 * 24 * 60 * 60_000).toISOString(),
        nowMs: NOW,
      }),
    ).toThrow("integration expiry invalid");

    const short = createLocalIntegrationCredential({
      directory: dir,
      audience: API_AUDIENCE,
      scopes: ["sessions:read"],
      expiresAt: new Date(NOW + 1_000).toISOString(),
      nowMs: NOW,
    });
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${short.token}`, {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: NOW + 2_000,
      }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${short.token}`, {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("does not roll authority time back when issuance validation or the active cap fails", () => {
    const invalidDir = directory();
    const old = createLocalIntegrationCredential({
      directory: invalidDir,
      audience: API_AUDIENCE,
      scopes: ["sessions:read"],
      expiresAt: new Date(NOW + 1_000).toISOString(),
      nowMs: NOW,
    });
    expect(() =>
      createLocalIntegrationCredential({
        directory: invalidDir,
        audience: API_AUDIENCE,
        scopes: ["sessions:read"],
        expiresAt: new Date(NOW + 1_000).toISOString(),
        nowMs: NOW + 2_000,
      }),
    ).toThrow("integration expiry invalid");
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${old.token}`, {
        directory: invalidDir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: "expired" });

    const capDir = directory();
    const short = createLocalIntegrationCredential({
      directory: capDir,
      audience: API_AUDIENCE,
      scopes: ["sessions:read"],
      expiresAt: new Date(NOW + 1_000).toISOString(),
      nowMs: NOW,
    });
    const seeded = openLocalHistory(capDir);
    try {
      const insert = seeded.prepare(
        `INSERT INTO local_integration_credential (
           credential_id, secret_hash, audience, created_at, expires_at,
           last_used_at, revoked_at, repo_id, data_not_before, data_not_after
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
      );
      for (
        let index = 0;
        index < LOCAL_INTEGRATION_ACTIVE_CREDENTIAL_LIMIT;
        index += 1
      ) {
        insert.run(
          index.toString(16).padStart(32, "0"),
          index.toString(16).padStart(64, "0"),
          API_AUDIENCE,
          new Date(NOW).toISOString(),
          new Date(NOW + 24 * 60 * 60_000).toISOString(),
        );
      }
    } finally {
      seeded.close();
    }
    expect(() =>
      createLocalIntegrationCredential({
        directory: capDir,
        audience: API_AUDIENCE,
        scopes: ["sessions:read"],
        expiresAt: new Date(NOW + 24 * 60 * 60_000).toISOString(),
        nowMs: NOW + 2_000,
      }),
    ).toThrow(LocalIntegrationCredentialLimitError);
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${short.token}`, {
        directory: capDir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts only canonical API or MCP resource audiences", () => {
    const dir = directory();
    expect(issue(dir, "https://example.com/api/v1").audience).toBe(
      "https://example.com/api/v1",
    );
    expect(issue(dir, "http://127.0.0.1:4318/mcp/private").audience).toBe(
      "http://127.0.0.1:4318/mcp/private",
    );
    for (const audience of [
      "https://example.com/api/v1/",
      "https://EXAMPLE.com/api/v1",
      "https://example.com:443/api/v1",
      "https://example.com/other",
      "http://example.com/api/v1",
    ]) {
      expect(() => issue(dir, audience), audience).toThrow(
        "integration audience",
      );
    }
  });

  it("refuses a hidden one-sided date restriction", () => {
    const dir = directory();
    expect(() =>
      createLocalIntegrationCredential({
        directory: dir,
        audience: API_AUDIENCE,
        scopes: ["sessions:read"],
        expiresAt: new Date(NOW + 60_000).toISOString(),
        dataNotBefore: "2026-08-01T00:00:00.000Z",
        nowMs: NOW,
      }),
    ).toThrow("integration date restriction invalid");
  });

  it("enforces the active cap and closed scope set", () => {
    const dir = directory();
    let firstToken = "";
    for (
      let index = 0;
      index < LOCAL_INTEGRATION_ACTIVE_CREDENTIAL_LIMIT;
      index += 1
    ) {
      const created = createLocalIntegrationCredential({
        directory: dir,
        audience: API_AUDIENCE,
        scopes: ["sessions:read"],
        expiresAt: new Date(NOW + 60_000).toISOString(),
        nowMs: NOW,
      });
      if (index === 0) firstToken = created.token;
    }
    expect(() =>
      createLocalIntegrationCredential({
        directory: dir,
        audience: API_AUDIENCE,
        scopes: ["sessions:read"],
        expiresAt: new Date(NOW + 60_000).toISOString(),
        nowMs: NOW,
      }),
    ).toThrow(LocalIntegrationCredentialLimitError);
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${firstToken}`, {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "period:read",
        routeClass: "aggregate",
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: "scope" });
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalIntegrationCredential,
  revokeLocalIntegrationCredential,
} from "../src/local-integration-store.ts";
import { classifyLocalPlaneRequestTarget } from "../src/local-plane-routes.ts";
import { handleLocalPrivateApi } from "../src/local-private-http.ts";
import { appendLocalEvent, openLocalHistory } from "../src/local-store.ts";
import {
  FIXTURE_NOW,
  localHistoryFixture,
} from "./support/local-history-fixture.ts";

const ORIGIN = "http://127.0.0.1:4318";
const API_AUDIENCE = `${ORIGIN}/api/v1`;
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function seeded(): string {
  const directory = mkdtempSync(join(tmpdir(), "seorak-private-http-"));
  temporary.push(directory);
  for (const event of localHistoryFixture()) appendLocalEvent(event, directory);
  return directory;
}

function issue(
  directory: string,
  audience = API_AUDIENCE,
  scopes = ["period:read", "sessions:read", "replay:read"] as const,
) {
  return createLocalIntegrationCredential({
    directory,
    audience,
    scopes,
    expiresAt: new Date(FIXTURE_NOW + 24 * 60 * 60_000).toISOString(),
    nowMs: FIXTURE_NOW,
  });
}

function route(target: string) {
  const classified = classifyLocalPlaneRequestTarget(target, "GET");
  if (classified.authority !== "api") throw new Error("expected API route");
  return classified;
}

describe("local private HTTP resource", () => {
  it("dispatches every read through the canonical query DTOs and audits no content", () => {
    const directory = seeded();
    const credential = issue(directory);
    const authorization = `Bearer ${credential.token}`;
    const options = { directory, now: () => new Date(FIXTURE_NOW) };

    const period = handleLocalPrivateApi(
      route("/api/v1/period-summary?days=7"),
      authorization,
      API_AUDIENCE,
      options,
    );
    expect(period).toMatchObject({
      status: 200,
      value: { apiVersion: "v1", period: expect.any(Object) },
    });
    const sessions = handleLocalPrivateApi(
      route("/api/v1/sessions?limit=2"),
      authorization,
      API_AUDIENCE,
      options,
    );
    expect(sessions).toMatchObject({
      status: 200,
      value: { apiVersion: "v1", items: expect.any(Array) },
    });
    const sessionRef = (sessions.value as { items: Array<{ sessionRef: string }> })
      .items[0]!.sessionRef;
    const outcome = handleLocalPrivateApi(
      route(`/api/v1/sessions/${sessionRef}/outcome`),
      authorization,
      API_AUDIENCE,
      options,
    );
    const replay = handleLocalPrivateApi(
      route(`/api/v1/sessions/${sessionRef}/replay/tool-mix`),
      authorization,
      API_AUDIENCE,
      options,
    );
    expect(outcome).toMatchObject({ status: 200, value: { sessionRef } });
    expect(replay).toMatchObject({ status: 200, value: { result: expect.anything() } });

    const database = openLocalHistory(directory);
    try {
      const rows = database.prepare(
        `SELECT operation, result, returned_count, response_bytes
           FROM local_integration_query_audit
          ORDER BY audit_id`,
      ).all();
      expect(rows).toHaveLength(4);
      expect(rows.map((row) => (row as { operation: string }).operation)).toEqual([
        "period_summary",
        "list_sessions",
        "get_session_outcome",
        "replay_lens",
      ]);
      expect(JSON.stringify(rows)).not.toContain(sessionRef);
    } finally {
      database.close();
    }
  });

  it("keeps API, MCP, scope, expiry, and revocation authority separate", () => {
    const directory = seeded();
    const api = issue(directory);
    const mcp = issue(directory, `${ORIGIN}/mcp/private`);
    const period = route("/api/v1/period-summary?days=7");
    const options = { directory, now: () => new Date(FIXTURE_NOW) };
    expect(handleLocalPrivateApi(period, `Bearer ${mcp.token}`, API_AUDIENCE, options).status)
      .toBe(401);

    const sessionsOnly = issue(directory, API_AUDIENCE, ["sessions:read"]);
    expect(handleLocalPrivateApi(
      period,
      `Bearer ${sessionsOnly.token}`,
      API_AUDIENCE,
      options,
    ).status).toBe(403);

    expect(revokeLocalIntegrationCredential(api.credentialId, {
      directory,
      nowMs: FIXTURE_NOW + 1,
    })).toBe(true);
    expect(handleLocalPrivateApi(
      period,
      `Bearer ${api.token}`,
      API_AUDIENCE,
      { directory, now: () => new Date(FIXTURE_NOW + 2) },
    ).status).toBe(401);

    const expired = createLocalIntegrationCredential({
      directory,
      audience: API_AUDIENCE,
      scopes: ["period:read"],
      expiresAt: new Date(FIXTURE_NOW + 10).toISOString(),
      nowMs: FIXTURE_NOW + 3,
    });
    expect(handleLocalPrivateApi(
      period,
      `Bearer ${expired.token}`,
      API_AUDIENCE,
      { directory, now: () => new Date(FIXTURE_NOW + 11) },
    ).status).toBe(401);
  });

  it("audits admitted validation failures and refuses invalid cursors", () => {
    const directory = seeded();
    const credential = issue(directory);
    const authorization = `Bearer ${credential.token}`;
    const options = { directory, now: () => new Date(FIXTURE_NOW) };
    expect(handleLocalPrivateApi(
      route("/api/v1/period-summary?days=1"),
      authorization,
      API_AUDIENCE,
      options,
    )).toMatchObject({ status: 400 });
    expect(handleLocalPrivateApi(
      route("/api/v1/sessions?cursor=cur_bad"),
      authorization,
      API_AUDIENCE,
      options,
    )).toMatchObject({ status: 409 });

    const database = openLocalHistory(directory);
    try {
      expect(database.prepare(
        `SELECT operation, result FROM local_integration_query_audit ORDER BY audit_id`,
      ).all()).toEqual([
        { operation: "period_summary", result: "protocol_error" },
        { operation: "list_sessions", result: "refused" },
      ]);
    } finally {
      database.close();
    }
  });
});

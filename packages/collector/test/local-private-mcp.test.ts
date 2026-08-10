import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  INTEGRATION_REPLAY_LENSES,
  PRIVATE_MCP_TOOL_NAMES,
  type IntegrationScope,
  type SessionEvent,
} from "@seorak/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeLocalIntegrationCredential,
  createLocalIntegrationCredential,
  revokeLocalIntegrationCredential,
  type CreatedLocalIntegrationCredential,
  type LocalIntegrationPrincipal,
} from "../src/local-integration-store.ts";
import {
  LOCAL_PRIVATE_MCP_MAX_REQUEST_BYTES,
  LOCAL_PRIVATE_MCP_MAX_RESPONSE_BYTES,
  canonicalLocalPrivateMcpResource,
  createLocalPrivateMcpResourceServer,
  type LocalPrivateMcpResourceServer,
} from "../src/local-private-mcp-resource.ts";
import {
  LOCAL_PRIVATE_MCP_LEGACY_POLICY,
  isLocalPrivateMcpQueryRefusal,
} from "../src/local-private-mcp.ts";
import {
  queryLocalPrivateOutcome,
  queryLocalPrivatePeriod,
  queryLocalPrivateReplayLens,
  queryLocalPrivateSessions,
} from "../src/local-private-queries.ts";
import {
  LocalReplayTooLargeError,
  LocalSessionOutcomeTooLargeError,
} from "../src/local-projection.ts";
import { appendLocalEvent, openLocalHistory } from "../src/local-store.ts";
import {
  FIXTURE_NOW,
  localHistoryFixture,
} from "./support/local-history-fixture.ts";

const MCP_RESOURCE = "http://127.0.0.1:4318/mcp/private";
const API_RESOURCE = "http://127.0.0.1:4318/api/v1";
const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-11-25";
const temporary: string[] = [];
const servers: LocalPrivateMcpResourceServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "seorak-local-private-mcp-"));
  temporary.push(path);
  return path;
}

function issue(
  dir: string,
  options: {
    audience?: string;
    scopes?: readonly IntegrationScope[];
    nowMs?: number;
  } = {},
): CreatedLocalIntegrationCredential {
  const nowMs = options.nowMs ?? FIXTURE_NOW;
  return createLocalIntegrationCredential({
    directory: dir,
    audience: options.audience ?? MCP_RESOURCE,
    scopes: options.scopes ?? ["period:read", "sessions:read", "replay:read"],
    expiresAt: new Date(nowMs + 24 * 60 * 60_000).toISOString(),
    nowMs,
  });
}

function append(dir: string, events: readonly SessionEvent[]): void {
  for (const event of events) appendLocalEvent(event, dir);
}

function admittedPrincipal(
  dir: string,
  token: string,
  scope: IntegrationScope = "period:read",
): LocalIntegrationPrincipal {
  const authorized = authorizeLocalIntegrationCredential(`Bearer ${token}`, {
    directory: dir,
    audience: MCP_RESOURCE,
    scope,
    routeClass: scope === "period:read" ? "aggregate" : "read",
    nowMs: FIXTURE_NOW,
  });
  if (!authorized.ok) {
    throw new Error(`authorization failed: ${authorized.reason}`);
  }
  return authorized.principal;
}

function resource(
  dir: string,
  options: { maxRequestBytes?: number; maxResponseBytes?: number } = {},
): LocalPrivateMcpResourceServer {
  const server = createLocalPrivateMcpResourceServer({
    resourceServerUrl: MCP_RESOURCE,
    directory: dir,
    now: () => new Date(FIXTURE_NOW),
    ...options,
  });
  servers.push(server);
  return server;
}

function requestBody(
  id: number,
  method: string,
  params: Record<string, unknown>,
): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function modernRequest(
  token: string | null,
  method: string,
  params: Record<string, unknown> = {},
  options: {
    id?: number;
    name?: string;
    origin?: string;
    url?: string;
    accept?: string;
    version?: string;
  } = {},
): Request {
  const version = options.version ?? MODERN_VERSION;
  const headers = new Headers({
    accept: options.accept ?? "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": version,
    "mcp-method": method,
  });
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  if (options.name !== undefined) headers.set("mcp-name", options.name);
  if (options.origin !== undefined) headers.set("origin", options.origin);
  return new Request(options.url ?? MCP_RESOURCE, {
    method: "POST",
    headers,
    body: requestBody(options.id ?? 1, method, {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": version,
        "io.modelcontextprotocol/clientInfo": {
          name: "seorak-local-private-mcp-test",
          version: "1.0.0",
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    }),
  });
}

function toolRequest(
  token: string,
  name: (typeof PRIVATE_MCP_TOOL_NAMES)[number],
  args: Record<string, unknown>,
): Request {
  return modernRequest(
    token,
    "tools/call",
    { name, arguments: args },
    { name },
  );
}

function legacyRequest(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Request {
  return new Request(MCP_RESOURCE, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: requestBody(1, method, params),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function jsonRpc(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return JSON.parse(body) as Record<string, unknown>;
  }
  const message = body
    .split(/\r?\n/)
    .find((line) => line.startsWith("data:"));
  if (message === undefined) throw new Error(`missing SSE JSON-RPC data: ${body}`);
  return JSON.parse(message.slice("data:".length).trim()) as Record<string, unknown>;
}

function structuredContent(
  result: Awaited<ReturnType<Client["callTool"]>>,
): Record<string, unknown> {
  const value = result.structuredContent;
  if (value === undefined) throw new Error("missing MCP structuredContent");
  return value;
}

describe("local private MCP resource foundation", () => {
  it("uses the official current client for all four canonical queries and revokes linearly", async () => {
    const dir = directory();
    append(dir, localHistoryFixture());
    const created = issue(dir);
    const principal = admittedPrincipal(dir, created.token);
    const now = new Date(FIXTURE_NOW);
    const expectedPeriod = queryLocalPrivatePeriod(principal, 7, {
      directory: dir,
      now,
    });
    const expectedSessions = queryLocalPrivateSessions(principal, {
      directory: dir,
      cursor: null,
      limit: 100,
      now,
    });
    const claudeStartedAt = localHistoryFixture().find(
      (event) => event.kind === "session.start" &&
        event.sessionId === "claude-session",
    )!.at;
    const sessionRef = expectedSessions.items.find(
      (item) => item.startedAt === claudeStartedAt,
    )?.sessionRef;
    if (sessionRef === undefined) throw new Error("fixture session was not listed");
    const expectedOutcome = queryLocalPrivateOutcome(principal, sessionRef, {
      directory: dir,
      now,
    });
    const expectedReplay = queryLocalPrivateReplayLens(
      principal,
      sessionRef,
      "session-detail",
      { directory: dir, now },
    );

    const server = resource(dir);
    const client = new Client(
      { name: "seorak-local-private-verifier", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: MODERN_VERSION } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL(MCP_RESOURCE), {
      authProvider: { token: async () => created.token },
      fetch: (input, init) => server.fetch(new Request(input, init)),
      onInsufficientScope: "throw",
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map(({ name }) => name)).toEqual(PRIVATE_MCP_TOOL_NAMES);
      expect(listed.tools.every((tool) =>
        tool.annotations?.readOnlyHint === true &&
        tool.annotations.destructiveHint === false &&
        tool.annotations.idempotentHint === true
      )).toBe(true);

      const calls = [
        ["period_summary", { rangeDays: 7 }, expectedPeriod],
        ["list_sessions", { limit: 100 }, expectedSessions],
        ["get_session_outcome", { sessionRef }, expectedOutcome],
        [
          "replay_lens",
          { sessionRef, lens: "session-detail" },
          expectedReplay,
        ],
      ] as const;
      for (const [name, args, expected] of calls) {
        const called = await client.callTool({ name, arguments: args });
        expect(called.isError).not.toBe(true);
        expect(structuredContent(called)).toEqual(expected);
        expect(called.content).toEqual([
          { type: "text", text: JSON.stringify(expected) },
        ]);
      }
    } finally {
      await client.close();
    }

    const database = openLocalHistory(dir);
    try {
      expect(
        database
          .prepare(
            `SELECT operation, result, http_status,
                    returned_count, response_bytes > 0 AS has_response_bytes
               FROM local_integration_query_audit
              WHERE credential_id = ?
              ORDER BY audit_id`,
          )
          .all(created.credentialId),
      ).toEqual([
        {
          operation: "period_summary",
          result: "ok",
          http_status: 200,
          returned_count: expectedPeriod.coverage.includedSessionCount,
          has_response_bytes: 1,
        },
        {
          operation: "list_sessions",
          result: "ok",
          http_status: 200,
          returned_count: expectedSessions.coverage.includedSessionCount,
          has_response_bytes: 1,
        },
        {
          operation: "get_session_outcome",
          result: "ok",
          http_status: 200,
          returned_count: expectedOutcome.coverage.includedSessionCount,
          has_response_bytes: 1,
        },
        {
          operation: "replay_lens",
          result: "ok",
          http_status: 200,
          returned_count: expectedReplay.coverage.includedSessionCount,
          has_response_bytes: 1,
        },
      ]);
    } finally {
      database.close();
    }

    expect(
      revokeLocalIntegrationCredential(created.credentialId, {
        directory: dir,
        nowMs: FIXTURE_NOW + 1,
      }),
    ).toBe(true);
    const revoked = await server.fetch(
      toolRequest(created.token, "period_summary", { rangeDays: 7 }),
    );
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toBe(
      'Bearer error="invalid_token"',
    );
  });

  it("keeps API and MCP static bearer audiences distinct in both directions", async () => {
    const dir = directory();
    const server = resource(dir);
    const apiCredential = issue(dir, { audience: API_RESOURCE });
    const rejected = await server.fetch(
      modernRequest(apiCredential.token, "tools/list"),
    );
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("www-authenticate")).not.toContain(
      "resource_metadata",
    );

    const mcpCredential = issue(dir);
    expect(
      authorizeLocalIntegrationCredential(`Bearer ${mcpCredential.token}`, {
        directory: dir,
        audience: API_RESOURCE,
        scope: "period:read",
        routeClass: "aggregate",
        nowMs: FIXTURE_NOW,
      }),
    ).toEqual({ ok: false, reason: "audience" });
    expect(
      await server.fetch(modernRequest("operator-key", "tools/list")),
    ).toMatchObject({ status: 401 });
  });

  it("enforces the exact per-tool scope before spending a request budget", async () => {
    const dir = directory();
    const server = resource(dir);
    const created = issue(dir, { scopes: ["period:read"] });
    const refused = await server.fetch(
      toolRequest(created.token, "list_sessions", { limit: 10 }),
    );
    expect(refused.status).toBe(403);
    expect(refused.headers.get("www-authenticate")).toBe(
      'Bearer error="insufficient_scope", scope="sessions:read"',
    );

    const database = openLocalHistory(dir);
    try {
      expect(
        database
          .prepare(
            `SELECT * FROM local_integration_credential_budget
              WHERE credential_id = ?`,
          )
          .get(created.credentialId),
      ).toBeUndefined();
    } finally {
      database.close();
    }

    const allowed = await server.fetch(
      toolRequest(created.token, "period_summary", { rangeDays: 7 }),
    );
    expect(allowed.status).toBe(200);
  });

  it("uses persistent token and route-class backstops", async () => {
    const tokenDir = directory();
    const tokenServer = resource(tokenDir);
    const tokenCredential = issue(tokenDir);
    for (let request = 0; request < 60; request += 1) {
      expect(
        (await tokenServer.fetch(
          modernRequest(tokenCredential.token, "tools/list"),
        )).status,
      ).toBe(200);
    }
    const limited = await tokenServer.fetch(
      modernRequest(tokenCredential.token, "tools/list"),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");

    const routeDir = directory();
    append(routeDir, localHistoryFixture());
    const routeServer = resource(routeDir);
    const routeCredential = issue(routeDir);
    const routePrincipal = admittedPrincipal(
      routeDir,
      routeCredential.token,
      "sessions:read",
    );
    const routePage = queryLocalPrivateSessions(routePrincipal, {
      directory: routeDir,
      cursor: null,
      limit: 1,
      now: new Date(FIXTURE_NOW),
    });
    const routeSessionRef = routePage.items[0]!.sessionRef;
    const database = openLocalHistory(routeDir);
    database
      .prepare(
        `INSERT INTO local_integration_route_budget (
           route_class, tokens, updated_at, limited
         ) VALUES ('aggregate', 0, ?, 0)`,
      )
      .run(new Date(FIXTURE_NOW).toISOString());
    database.close();
    expect(
      (await routeServer.fetch(
        toolRequest(routeCredential.token, "period_summary", { rangeDays: 7 }),
      )).status,
    ).toBe(429);
    expect(
      (await routeServer.fetch(
        toolRequest(routeCredential.token, "get_session_outcome", {
          sessionRef: routeSessionRef,
        }),
      )).status,
    ).toBe(429);
    expect(
      (await routeServer.fetch(
        toolRequest(routeCredential.token, "replay_lens", {
          sessionRef: routeSessionRef,
          lens: "tool-mix",
        }),
      )).status,
    ).toBe(429);
    expect(
      (await routeServer.fetch(
        toolRequest(routeCredential.token, "list_sessions", { limit: 1 }),
      )).status,
    ).toBe(200);
  });

  it("distinguishes bounded query refusals from malformed MCP protocol", async () => {
    const dir = directory();
    const server = resource(dir);
    const created = issue(dir);
    expect(
      isLocalPrivateMcpQueryRefusal(
        new LocalSessionOutcomeTooLargeError(10_001, 10_000),
      ),
    ).toBe(true);
    expect(
      isLocalPrivateMcpQueryRefusal(
        new LocalReplayTooLargeError(10_001, 10_000),
      ),
    ).toBe(true);
    expect(isLocalPrivateMcpQueryRefusal(new TypeError("bad input"))).toBe(false);

    const refused = await server.fetch(
      toolRequest(created.token, "list_sessions", {
        limit: 10,
        cursor: `cur_${"a".repeat(32)}_${"b".repeat(64)}`,
      }),
    );
    expect(refused.status).toBe(200);
    expect((await responseJson(refused)).result).toMatchObject({ isError: true });
    const database = openLocalHistory(dir);
    try {
      expect(
        database
          .prepare(
            `SELECT operation, result, returned_count
               FROM local_integration_query_audit
              WHERE credential_id = ?`,
          )
          .get(created.credentialId),
      ).toEqual({
        operation: "list_sessions",
        result: "refused",
        returned_count: null,
      });
    } finally {
      database.close();
    }
  });

  it("enforces current headers and body equality with explicit stateless legacy compatibility", async () => {
    const dir = directory();
    const server = resource(dir);
    const created = issue(dir);
    expect(LOCAL_PRIVATE_MCP_LEGACY_POLICY).toBe("stateless");

    const current = await server.fetch(
      modernRequest(created.token, "tools/list", {}, {
        origin: new URL(MCP_RESOURCE).origin,
      }),
    );
    expect(current.status).toBe(200);
    expect(current.headers.get("content-type")).toContain("application/json");
    expect(current.headers.get("content-type")).not.toContain("text/event-stream");

    const modernCall = await server.fetch(
      toolRequest(created.token, "period_summary", { rangeDays: 7 }),
    );
    expect(modernCall.status).toBe(200);
    const modernMessage = await jsonRpc(modernCall);

    const mismatch = toolRequest(
      created.token,
      "period_summary",
      { rangeDays: 7 },
    );
    mismatch.headers.set("mcp-name", "list_sessions");
    expect((await server.fetch(mismatch)).status).toBeGreaterThanOrEqual(400);

    const initialized = await server.fetch(
      legacyRequest(created.token, "initialize", {
        protocolVersion: LEGACY_VERSION,
        capabilities: {},
        clientInfo: { name: "legacy-test", version: "1.0.0" },
      }),
    );
    expect(initialized.status).toBe(200);
    expect((await jsonRpc(initialized)).result).toMatchObject({
      protocolVersion: LEGACY_VERSION,
    });
    const legacy = await server.fetch(
      legacyRequest(created.token, "tools/call", {
        name: "period_summary",
        arguments: { rangeDays: 7 },
      }),
    );
    expect(legacy.status).toBe(200);
    const legacyMessage = await jsonRpc(legacy);
    expect(legacyMessage.error).toBeUndefined();
    expect(
      (legacyMessage.result as Record<string, unknown>).structuredContent,
    ).toEqual(
      (modernMessage.result as Record<string, unknown>).structuredContent,
    );
  });

  it("rejects every current-envelope header mutation before a query runs", async () => {
    const dir = directory();
    const server = resource(dir);
    const created = issue(dir);
    const mutations: Array<[string, (request: Request) => void]> = [
      ["missing protocol version", (request) =>
        request.headers.delete("mcp-protocol-version")],
      ["mismatched protocol version", (request) =>
        request.headers.set("mcp-protocol-version", LEGACY_VERSION)],
      ["missing method", (request) => request.headers.delete("mcp-method")],
      ["mismatched method", (request) =>
        request.headers.set("mcp-method", "tools/list")],
      ["missing name", (request) => request.headers.delete("mcp-name")],
      ["mismatched name", (request) =>
        request.headers.set("mcp-name", "list_sessions")],
    ];
    for (const [label, mutate] of mutations) {
      const request = toolRequest(
        created.token,
        "period_summary",
        { rangeDays: 7 },
      );
      mutate(request);
      const response = await server.fetch(request);
      expect(response.status, label).toBe(400);
      expect(await jsonRpc(response), label).toMatchObject({
        id: 1,
        error: { code: -32020 },
      });
    }

    const unsupported = await server.fetch(
      modernRequest(created.token, "resources/list"),
    );
    expect(unsupported.status).toBe(404);
    expect(await responseJson(unsupported)).toMatchObject({
      error: { code: -32601 },
    });
    const nullOrigin = modernRequest(created.token, "tools/list", {}, {
      origin: "null",
    });
    expect((await server.fetch(nullOrigin)).status).toBe(403);

    const database = openLocalHistory(dir);
    try {
      expect(
        database
          .prepare(
            `SELECT operation, result
               FROM local_integration_query_audit
              WHERE credential_id = ?`,
          )
          .all(created.credentialId),
      ).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("preserves official modern errors and accepts every standard MCP-Name source", async () => {
    const dir = directory();
    const server = resource(dir);
    const created = issue(dir);

    const missingProtocol = modernRequest(
      created.token,
      "tools/list",
      {},
      { id: 40 },
    );
    missingProtocol.headers.delete("mcp-protocol-version");
    const missing = await server.fetch(missingProtocol);
    expect(missing.status).toBe(400);
    expect(await jsonRpc(missing)).toMatchObject({
      id: 40,
      error: { code: -32020 },
    });

    const missingFutureProtocol = modernRequest(
      created.token,
      "tools/list",
      {},
      { id: 39, version: "2027-01-01" },
    );
    missingFutureProtocol.headers.delete("mcp-protocol-version");
    const missingFuture = await server.fetch(missingFutureProtocol);
    expect(missingFuture.status).toBe(400);
    expect(await jsonRpc(missingFuture)).toMatchObject({
      id: 39,
      error: { code: -32020 },
    });

    const mismatch = modernRequest(
      created.token,
      "tools/call",
      { name: "period_summary", arguments: { rangeDays: 7 } },
      { id: 41, name: "period_summary" },
    );
    mismatch.headers.set("mcp-method", "tools/list");
    const mismatched = await server.fetch(mismatch);
    expect(mismatched.status).toBe(400);
    expect(await jsonRpc(mismatched.clone())).toMatchObject({
      id: 41,
      error: { code: -32020 },
    });
    expect((await mismatched.arrayBuffer()).byteLength).toBeLessThanOrEqual(
      LOCAL_PRIVATE_MCP_MAX_RESPONSE_BYTES,
    );

    const future = await server.fetch(
      modernRequest(created.token, "tools/list", {}, {
        id: 42,
        version: "2027-01-01",
      }),
    );
    expect(future.status).toBe(400);
    expect(await jsonRpc(future.clone())).toMatchObject({
      id: 42,
      error: {
        code: -32022,
        data: {
          supported: [MODERN_VERSION],
          requested: "2027-01-01",
        },
      },
    });
    expect((await future.arrayBuffer()).byteLength).toBeLessThanOrEqual(
      LOCAL_PRIVATE_MCP_MAX_RESPONSE_BYTES,
    );

    for (const [id, method, params, name] of [
      [43, "resources/read", { uri: "seorak://not-exposed" }, "seorak://not-exposed"],
      [44, "prompts/get", { name: "not-exposed", arguments: {} }, "not-exposed"],
    ] as const) {
      const omitted = await server.fetch(
        modernRequest(created.token, method, params, { id, name }),
      );
      expect(omitted.status).toBe(404);
      expect(await jsonRpc(omitted)).toMatchObject({
        id,
        error: { code: -32601 },
      });
    }

    const database = openLocalHistory(dir);
    try {
      expect(
        database
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM local_integration_credential_budget) AS credentials,
               (SELECT COUNT(*) FROM local_integration_route_budget) AS routes,
               (SELECT COUNT(*) FROM local_integration_query_audit) AS queries`,
          )
          .get(),
      ).toEqual({ credentials: 1, routes: 1, queries: 0 });
    } finally {
      database.close();
    }
  });

  it("does not spend authority budgets while the official SDK rejects modern envelopes", async () => {
    const dir = directory();
    const server = resource(dir);
    const created = issue(dir);
    const database = openLocalHistory(dir);
    try {
      const state = () =>
        database
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM local_integration_credential_budget) AS credentials,
               (SELECT COUNT(*) FROM local_integration_route_budget) AS routes,
               (SELECT COUNT(*) FROM local_integration_query_audit) AS queries`,
          )
          .get();
      expect(state()).toEqual({ credentials: 0, routes: 0, queries: 0 });

      const mismatch = modernRequest(
        created.token,
        "tools/call",
        { name: "period_summary", arguments: { rangeDays: 7 } },
        { id: 51, name: "period_summary" },
      );
      mismatch.headers.set("mcp-name", "list_sessions");
      expect((await server.fetch(mismatch)).status).toBe(400);
      const missingProtocol = modernRequest(
        created.token,
        "tools/list",
        {},
        { id: 50 },
      );
      missingProtocol.headers.delete("mcp-protocol-version");
      expect((await server.fetch(missingProtocol)).status).toBe(400);
      expect(
        (await server.fetch(
          modernRequest(created.token, "tools/list", {}, {
            id: 52,
            version: "2027-01-01",
          }),
        )).status,
      ).toBe(400);
      expect(state()).toEqual({ credentials: 0, routes: 0, queries: 0 });
    } finally {
      database.close();
    }
  });

  it("refuses aliases, browser-origin confusion, SSE, and OAuth discovery without minting sessions", async () => {
    const dir = directory();
    const server = resource(dir);
    const created = issue(dir);
    expect(() => canonicalLocalPrivateMcpResource(`${MCP_RESOURCE}/`)).toThrow();
    expect(() => canonicalLocalPrivateMcpResource(`${MCP_RESOURCE}?x=1`)).toThrow();
    expect(() => canonicalLocalPrivateMcpResource(API_RESOURCE)).toThrow();
    expect(() =>
      canonicalLocalPrivateMcpResource("HTTP://LOCALHOST:80/mcp/private")
    ).toThrow();

    const alias = await server.fetch(
      modernRequest(created.token, "tools/list", {}, {
        url: "http://localhost:4318/mcp/private",
      }),
    );
    expect(alias.status).toBe(421);
    const origin = await server.fetch(
      modernRequest(created.token, "tools/list", {}, {
        origin: "https://evil.test",
      }),
    );
    expect(origin.status).toBe(403);
    expect(origin.headers.get("www-authenticate")).toBeNull();

    for (const method of ["GET", "DELETE"]) {
      const refused = await server.fetch(
        new Request(MCP_RESOURCE, {
          method,
          headers: { authorization: `Bearer ${created.token}` },
        }),
      );
      expect(refused.status).toBe(405);
      expect(refused.headers.get("allow")).toBe("POST");
    }
    const session = modernRequest(created.token, "tools/list");
    session.headers.set("mcp-session-id", "not-supported");
    const sessionIgnored = await server.fetch(session);
    expect(sessionIgnored.status).toBe(200);
    expect(sessionIgnored.headers.get("mcp-session-id")).toBeNull();
    expect(
      (await server.fetch(
        modernRequest(created.token, "tools/list", {}, {
          accept: "text/event-stream",
        }),
      )).status,
    ).toBe(406);
    expect(
      (await server.fetch(
        modernRequest(created.token, "tools/list", {}, {
          accept: "application/json;q=0, text/event-stream",
        }),
      )).status,
    ).toBe(406);

    for (const path of [
      "/.well-known/oauth-protected-resource/mcp/private",
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
    ]) {
      const discovery = await server.fetch(
        new Request(`${new URL(MCP_RESOURCE).origin}${path}`),
      );
      expect(discovery.status).toBe(404);
      expect(await discovery.text()).not.toMatch(/authorization_server|oauth/i);
    }
    const missing = await server.fetch(modernRequest(null, "tools/list"));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).not.toContain(
      "resource_metadata",
    );
  });

  it("bounds malformed requests and refuses oversized results with content-free audit", async () => {
    const dir = directory();
    const server = resource(dir);
    const created = issue(dir);
    expect(LOCAL_PRIVATE_MCP_MAX_REQUEST_BYTES).toBe(64 * 1_024);
    expect(LOCAL_PRIVATE_MCP_MAX_RESPONSE_BYTES).toBe(256 * 1_024);
    expect(() =>
      resource(dir, {
        maxRequestBytes: LOCAL_PRIVATE_MCP_MAX_REQUEST_BYTES + 1,
      })
    ).toThrow(/maxRequestBytes/);
    expect(() =>
      resource(dir, {
        maxResponseBytes: LOCAL_PRIVATE_MCP_MAX_RESPONSE_BYTES + 1,
      })
    ).toThrow(/maxResponseBytes/);

    const tinyResponseServer = resource(dir, { maxResponseBytes: 32 });
    const boundedProtocolError = await tinyResponseServer.fetch(
      modernRequest(
        created.token,
        "resources/read",
        { uri: "seorak://" + "x".repeat(1_024) },
        { name: "seorak://" + "x".repeat(1_024) },
      ),
    );
    expect(boundedProtocolError.status).toBeGreaterThanOrEqual(400);
    expect(
      (await boundedProtocolError.arrayBuffer()).byteLength,
    ).toBeLessThanOrEqual(32);

    const invalidJson = modernRequest(created.token, "tools/list");
    const invalid = new Request(invalidJson.url, {
      method: "POST",
      headers: invalidJson.headers,
      body: "{",
    });
    expect((await server.fetch(invalid)).status).toBe(400);
    const arrayBody = new Request(MCP_RESOURCE, {
      method: "POST",
      headers: invalidJson.headers,
      body: "[]",
    });
    expect((await server.fetch(arrayBody)).status).toBe(400);
    const oversized = new Request(MCP_RESOURCE, {
      method: "POST",
      headers: invalidJson.headers,
      body: JSON.stringify({ padding: "x".repeat(LOCAL_PRIVATE_MCP_MAX_REQUEST_BYTES) }),
    });
    expect((await server.fetch(oversized)).status).toBe(413);

    const smallServer = resource(dir, { maxResponseBytes: 128 });
    const response = await smallServer.fetch(
      toolRequest(created.token, "period_summary", { rangeDays: 7 }),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("metrics");

    const database = openLocalHistory(dir);
    try {
      expect(
        database
          .prepare(
            `SELECT operation, result, http_status,
                    returned_count, response_bytes > 128 AS oversized
               FROM local_integration_query_audit
              WHERE credential_id = ?`,
          )
          .all(created.credentialId),
      ).toEqual([
        {
          operation: "period_summary",
          result: "oversized",
          http_status: 500,
          returned_count: null,
          oversized: 1,
        },
      ]);
      expect(
        database
          .prepare("PRAGMA table_info(local_integration_query_audit)")
          .all()
          .map((row) => String((row as { name?: unknown }).name)),
      ).not.toEqual(
        expect.arrayContaining([
          "authorization",
          "request_body",
          "response_body",
          "arguments",
          "cursor",
        ]),
      );
    } finally {
      database.close();
    }
  });

  it("records honest unavailable results without retaining opaque query inputs", async () => {
    const dir = directory();
    const server = resource(dir);
    const created = issue(dir);
    const missingRef = `ses_${"f".repeat(32)}`;
    const response = await server.fetch(
      toolRequest(created.token, "get_session_outcome", {
        sessionRef: missingRef,
      }),
    );
    expect(response.status).toBe(200);
    const database = openLocalHistory(dir);
    try {
      expect(
        database
          .prepare(
            `SELECT operation, result, returned_count
               FROM local_integration_query_audit
              WHERE credential_id = ?`,
          )
          .get(created.credentialId),
      ).toEqual({
        operation: "get_session_outcome",
        result: "unavailable",
        returned_count: 0,
      });
      expect(JSON.stringify(
        database
          .prepare("SELECT * FROM local_integration_query_audit")
          .all(),
      )).not.toContain(missingRef);
    } finally {
      database.close();
    }
  });

  it("keeps every replay lens in the closed input schema", async () => {
    const dir = directory();
    const server = resource(dir);
    const created = issue(dir);
    const listed = await responseJson(
      await server.fetch(modernRequest(created.token, "tools/list")),
    );
    const result = listed.result as { tools?: Array<Record<string, unknown>> };
    const replay = result.tools?.find((tool) => tool.name === "replay_lens");
    const schema = replay?.inputSchema as {
      properties?: { lens?: { enum?: readonly string[] } };
    };
    expect(schema.properties?.lens?.enum).toEqual(INTEGRATION_REPLAY_LENSES);
  });
});

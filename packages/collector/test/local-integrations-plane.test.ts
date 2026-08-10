import { mkdtempSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { request as httpRequest, ServerResponse, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  INTEGRATION_API_VERSION,
  PRIVATE_MCP_TOOL_NAMES,
  type IntegrationCredentialIssueResult,
} from "@seorak/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalPlaneServer,
  LocalIntegrationRuntime,
} from "../src/local-plane.ts";
import { appendLocalEvent, openLocalHistory } from "../src/local-store.ts";
import {
  createLocalIntegrationCredential,
  listLocalIntegrationCredentials,
  revokeLocalIntegrationCredential,
} from "../src/local-integration-store.ts";
import {
  FIXTURE_NOW,
  localHistoryFixture,
} from "./support/local-history-fixture.ts";

const temporary: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "seorak-integrations-plane-"));
  temporary.push(path);
  for (const event of localHistoryFixture()) appendLocalEvent(event, path);
  return path;
}

async function serve(dir: string, clock: { value: number }): Promise<string> {
  const server = createLocalPlaneServer({
    directory: dir,
    assetsDirectory: null,
    integrationNow: () => new Date(clock.value),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("listener absent");
  return `http://127.0.0.1:${address.port}`;
}

async function issue(
  base: string,
  target: "api" | "mcp",
  overrides: Record<string, unknown> = {},
): Promise<IntegrationCredentialIssueResult> {
  const audience = `${base}${target === "api" ? "/api/v1" : "/mcp/private"}`;
  const response = await fetch(`${base}/integrations`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({
      apiVersion: INTEGRATION_API_VERSION,
      audience,
      scopes: ["period:read", "sessions:read", "replay:read"],
      expiresAt: new Date(FIXTURE_NOW + 24 * 60 * 60_000).toISOString(),
      rateLimit: { requestsPerMinute: 60, burst: 60 },
      ...overrides,
    }),
  });
  expect(response.status).toBe(201);
  return await response.json() as IntegrationCredentialIssueResult;
}

function structured(value: Awaited<ReturnType<Client["callTool"]>>): unknown {
  if (value.structuredContent === undefined) throw new Error("structured content absent");
  return value.structuredContent;
}

async function api(base: string, token: string, path: string): Promise<Response> {
  return await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("mounted loopback private integrations", () => {
  it("issues owner credentials and keeps HTTP and official MCP DTOs identical", async () => {
    const dir = directory();
    const clock = { value: FIXTURE_NOW };
    const base = await serve(dir, clock);
    const apiCredential = await issue(base, "api");
    const mcpCredential = await issue(base, "mcp");

    const inventory = await (await fetch(`${base}/integrations`)).json() as {
      credentials: Array<{ audience: string; secret?: string }>;
    };
    expect(inventory.credentials.map(({ audience }) => audience).sort()).toEqual([
      `${base}/api/v1`,
      `${base}/mcp/private`,
    ]);
    expect(JSON.stringify(inventory)).not.toContain(apiCredential.secret);
    expect(JSON.stringify(inventory)).not.toContain(mcpCredential.secret);

    const period = await (await api(
      base,
      apiCredential.secret,
      "/api/v1/period-summary?days=7",
    )).json();
    const sessions = await (await api(
      base,
      apiCredential.secret,
      "/api/v1/sessions?limit=100",
    )).json() as { items: Array<{ sessionRef: string }> };
    const sessionRef = sessions.items[0]!.sessionRef;
    const outcome = await (await api(
      base,
      apiCredential.secret,
      `/api/v1/sessions/${sessionRef}/outcome`,
    )).json();
    const replay = await (await api(
      base,
      apiCredential.secret,
      `/api/v1/sessions/${sessionRef}/replay/session-detail`,
    )).json();

    const client = new Client(
      { name: "seorak-mounted-loopback-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`${base}/mcp/private`),
      {
        authProvider: { token: async () => mcpCredential.secret },
        onInsufficientScope: "throw",
      },
    );
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(
        PRIVATE_MCP_TOOL_NAMES,
      );
      expect(structured(await client.callTool({
        name: "period_summary",
        arguments: { rangeDays: 7 },
      }))).toEqual(period);
      expect(structured(await client.callTool({
        name: "list_sessions",
        arguments: { limit: 100 },
      }))).toEqual(sessions);
      expect(structured(await client.callTool({
        name: "get_session_outcome",
        arguments: { sessionRef },
      }))).toEqual(outcome);
      expect(structured(await client.callTool({
        name: "replay_lens",
        arguments: { sessionRef, lens: "session-detail" },
      }))).toEqual(replay);
    } finally {
      await client.close();
    }
  });

  it("revokes a one-time secret when its response closes before delivery", async () => {
    const dir = directory();
    const created = createLocalIntegrationCredential({
      directory: dir,
      audience: "http://127.0.0.1:4318/api/v1",
      scopes: ["period:read"],
      expiresAt: new Date(FIXTURE_NOW + 24 * 60 * 60_000).toISOString(),
      nowMs: FIXTURE_NOW,
    });
    const runtime = new LocalIntegrationRuntime({ directory: dir });
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      closed: false,
    });
    runtime.guardIssuedCredentialResponse(
      response as unknown as import("node:http").ServerResponse,
      () => {
        revokeLocalIntegrationCredential(created.credentialId, {
          directory: dir,
          nowMs: FIXTURE_NOW + 1,
        });
      },
    );
    response.emit("close");
    await runtime.close();

    const inventory = listLocalIntegrationCredentials({
      directory: dir,
      nowMs: FIXTURE_NOW + 1,
    });
    expect(inventory.credentials).toContainEqual(expect.objectContaining({
      credentialRef: `icr_${created.credentialId}`,
      revokedAt: new Date(FIXTURE_NOW + 1).toISOString(),
    }));

    const concurrentlyRevoked = new LocalIntegrationRuntime({ directory: dir });
    concurrentlyRevoked.guardIssuedCredentialResponse(
      Object.assign(new EventEmitter(), {
        destroyed: true,
        closed: true,
      }) as unknown as import("node:http").ServerResponse,
      () => {
        expect(revokeLocalIntegrationCredential(created.credentialId, {
          directory: dir,
          nowMs: FIXTURE_NOW + 2,
        })).toBe(false);
      },
    );
    await expect(concurrentlyRevoked.close()).resolves.toBeUndefined();

    const failedRuntime = new LocalIntegrationRuntime({ directory: dir });
    const alreadyClosed = Object.assign(new EventEmitter(), {
      destroyed: true,
      closed: true,
    });
    failedRuntime.guardIssuedCredentialResponse(
      alreadyClosed as unknown as import("node:http").ServerResponse,
      () => {
        throw new Error("undelivered integration credential could not be revoked");
      },
    );
    await expect(failedRuntime.close()).rejects.toThrow(
      "undelivered integration credential could not be revoked",
    );
  });

  it("revokes the credential issued by the owner handler when its 201 is cut", async () => {
    const dir = directory();
    const clock = { value: FIXTURE_NOW };
    const base = await serve(dir, clock);
    let issued: IntegrationCredentialIssueResult | undefined;
    const originalEnd = ServerResponse.prototype.end;
    const cutIssuedResponse = function(
      this: ServerResponse,
      ...args: unknown[]
    ): ServerResponse {
      if (this.statusCode === 201 && issued === undefined) {
        const body = args[0];
        if (typeof body !== "string" && !Buffer.isBuffer(body)) {
          throw new Error("issued credential response body absent");
        }
        issued = JSON.parse(body.toString()) as IntegrationCredentialIssueResult;
        this.destroy();
        return this;
      }
      return Reflect.apply(originalEnd, this, args) as ServerResponse;
    } as ServerResponse["end"];
    const end = vi.spyOn(ServerResponse.prototype, "end").mockImplementation(cutIssuedResponse);

    try {
      const url = new URL(base);
      await new Promise<void>((resolveRequest) => {
        const request = httpRequest({
          host: url.hostname,
          port: Number(url.port),
          path: "/integrations",
          method: "POST",
          headers: {
            host: url.host,
            origin: base,
            "content-type": "application/json",
          },
        }, (response) => {
          response.resume();
          response.once("end", resolveRequest);
        });
        request.once("error", () => resolveRequest());
        request.end(JSON.stringify({
          apiVersion: INTEGRATION_API_VERSION,
          audience: `${base}/api/v1`,
          scopes: ["period:read"],
          expiresAt: new Date(FIXTURE_NOW + 24 * 60 * 60_000).toISOString(),
          rateLimit: { requestsPerMinute: 60, burst: 60 },
        }));
      });
    } finally {
      end.mockRestore();
    }

    expect(issued).toBeDefined();
    const credential = listLocalIntegrationCredentials({
      directory: dir,
      nowMs: FIXTURE_NOW,
    }).credentials.find((candidate) => candidate.credentialRef === issued!.credentialRef);
    expect(credential?.revokedAt).toBe(new Date(FIXTURE_NOW).toISOString());
    expect((await api(
      base,
      issued!.secret,
      "/api/v1/period-summary?days=7",
    )).status).toBe(401);
  });

  it("separates owner, API, and MCP authority and revokes independently", async () => {
    const dir = directory();
    const clock = { value: FIXTURE_NOW };
    const base = await serve(dir, clock);
    const apiCredential = await issue(base, "api");
    const mcpCredential = await issue(base, "mcp");

    expect((await api(base, mcpCredential.secret, "/api/v1/period-summary?days=7")).status)
      .toBe(401);
    expect((await fetch(`${base}/settings`, {
      headers: { authorization: `Bearer ${apiCredential.secret}` },
    })).status).toBe(401);
    expect((await fetch(`${base}/integrations`, {
      headers: { authorization: `Bearer ${mcpCredential.secret}` },
    })).status).toBe(401);

    const crossover = new Client(
      { name: "seorak-api-crossover-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const crossoverTransport = new StreamableHTTPClientTransport(
      new URL(`${base}/mcp/private`),
      { authProvider: { token: async () => apiCredential.secret } },
    );
    await expect(crossover.connect(crossoverTransport)).rejects.toThrow();
    await crossover.close().catch(() => undefined);

    const revoked = await fetch(`${base}/integrations/${apiCredential.credentialRef}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", origin: base },
      body: "{}",
    });
    expect(revoked.status).toBe(200);
    expect((await api(base, apiCredential.secret, "/api/v1/period-summary?days=7")).status)
      .toBe(401);
    expect((await api(base, mcpCredential.secret, "/api/v1/period-summary?days=7")).status)
      .toBe(401);
  });

  it("preserves scopes, restrictions, opaque pagination, and honest-empty reads on the wire", async () => {
    const dir = directory();
    const clock = { value: FIXTURE_NOW };
    const base = await serve(dir, clock);

    const periodOnly = await issue(base, "api", {
      scopes: ["period:read"],
      expiresAt: new Date(FIXTURE_NOW + 10).toISOString(),
    });
    expect((await api(base, periodOnly.secret, "/api/v1/sessions?limit=1")).status)
      .toBe(403);
    clock.value = FIXTURE_NOW + 11;
    expect((await api(base, periodOnly.secret, "/api/v1/period-summary?days=7")).status)
      .toBe(401);
    clock.value = FIXTURE_NOW + 11;

    const projects = await (await fetch(`${base}/integrations/projects`)).json() as {
      projects: Array<{ projectRef: string; label: string }>;
    };
    expect(projects.projects.length).toBeGreaterThanOrEqual(2);
    expect(projects.projects.every(({ projectRef }) => /^prj_[0-9a-f]{32}$/.test(projectRef)))
      .toBe(true);

    const full = await issue(base, "api");
    const firstResponse = await api(base, full.secret, "/api/v1/sessions?limit=1");
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as {
      items: Array<{ sessionRef: string; projectRef: string }>;
      nextCursor: string | null;
      coverage: { requested: unknown };
      freshness: { generatedAt: string };
    };
    expect(first.items).toHaveLength(1);
    expect(first.items[0]!.sessionRef).toMatch(/^ses_[0-9a-f]{32}$/);
    expect(first.items[0]!.projectRef).toMatch(/^prj_[0-9a-f]{32}$/);
    expect(first.nextCursor).toMatch(/^cur_[0-9a-f]{32}_[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toContain("claude-session");
    expect(JSON.stringify(first)).not.toContain("a".repeat(64));

    clock.value += 1_500;
    const later = await api(
      base,
      full.secret,
      `/api/v1/sessions?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(later.status).toBe(200);
    const second = await later.json() as {
      coverage: { requested: unknown };
      freshness: { generatedAt: string };
    };
    expect(second.coverage.requested).toEqual(first.coverage.requested);

    clock.value -= 60_000;
    const rollback = await api(
      base,
      full.secret,
      `/api/v1/sessions?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(rollback.status).toBe(200);
    expect(Date.parse((await rollback.json()).freshness.generatedAt))
      .toBeGreaterThanOrEqual(Date.parse(second.freshness.generatedAt));

    const other = await issue(base, "api");
    expect((await api(
      base,
      other.secret,
      `/api/v1/sessions?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )).status).toBe(409);

    const projectCredential = await issue(base, "api", {
      restrictions: { projectRefs: [first.items[0]!.projectRef] },
    });
    const restricted = await (await api(
      base,
      projectCredential.secret,
      "/api/v1/sessions?limit=100",
    )).json() as { items: Array<{ projectRef: string }> };
    expect(restricted.items.length).toBeGreaterThan(0);
    expect(restricted.items.every(({ projectRef }) => projectRef === first.items[0]!.projectRef))
      .toBe(true);

    const empty = await issue(base, "api", {
      restrictions: { dateRange: { from: "2026-01-01", through: "2026-01-01" } },
    });
    const emptyPeriod = await (await api(
      base,
      empty.secret,
      "/api/v1/period-summary?days=7",
    )).json();
    expect(emptyPeriod).toMatchObject({
      availability: { state: "unavailable", reason: "outside-credential-restriction" },
      metrics: null,
    });
    const unknown = await (await api(
      base,
      full.secret,
      `/api/v1/sessions/ses_${"f".repeat(32)}/outcome`,
    )).json();
    expect(unknown).toMatchObject({
      availability: { state: "unavailable", reason: "not-retained" },
      outcome: null,
    });

    const freshPage = await (await api(base, full.secret, "/api/v1/sessions?limit=1"))
      .json() as { nextCursor: string };
    appendLocalEvent({
      kind: "session.start",
      eventId: "mounted-epoch-start",
      sessionId: "mounted-epoch-session",
      at: new Date(FIXTURE_NOW - 30_000).toISOString(),
      repoId: "a".repeat(64),
      repoLabel: "seorak",
      agent: "claude-code",
      agentVersion: "1.0.0",
    }, dir);
    clock.value = FIXTURE_NOW + 2_000;
    expect((await api(
      base,
      full.secret,
      `/api/v1/sessions?limit=1&cursor=${encodeURIComponent(freshPage.nextCursor)}`,
    )).status).toBe(409);
  });

  it("rejects positional and reserved requests before integration authority writes", async () => {
    const dir = directory();
    const clock = { value: FIXTURE_NOW };
    const base = await serve(dir, clock);
    await issue(base, "api");
    const database = openLocalHistory(dir);
    const before = database.prepare(
      `SELECT
         (SELECT last_seen_ms FROM local_integration_clock WHERE singleton = 1) AS clock,
         (SELECT COUNT(*) FROM local_integration_authorization_audit) AS auth,
         (SELECT COUNT(*) FROM local_integration_query_audit) AS queries`,
    ).get();
    database.close();

    const port = Number(new URL(base).port);
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        host: "127.0.0.1",
        port,
        path: "/integrations",
        method: "POST",
        headers: {
          host: `attacker.example:${port}`,
          "content-type": "application/json",
        },
      }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on("error", reject);
      request.end("{}");
    });
    expect(wrongHost).toBe(403);
    expect((await fetch(`${base}/integrations`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: base },
      body: "audience=forged",
    })).status).toBe(415);
    for (const origin of ["null", "https://evil.example"]) {
      expect((await fetch(`${base}/integrations`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: "{}",
      })).status).toBe(403);
    }
    expect((await fetch(`${base}/api/v1/period-summary?days=7`, {
      headers: { cookie: `authorization=Bearer srkx_${"a".repeat(32)}_${"b".repeat(64)}` },
    })).status).toBe(401);
    expect((await fetch(`${base}/api/v1/unknown`)).status).toBe(404);
    expect((await fetch(`${base}/.well-known/oauth-protected-resource/mcp/private`)).status)
      .toBe(404);
    expect((await fetch(`${base}/.well-known/openid-configuration`)).status).toBe(404);

    const afterDatabase = openLocalHistory(dir);
    const after = afterDatabase.prepare(
      `SELECT
         (SELECT last_seen_ms FROM local_integration_clock WHERE singleton = 1) AS clock,
         (SELECT COUNT(*) FROM local_integration_authorization_audit) AS auth,
         (SELECT COUNT(*) FROM local_integration_query_audit) AS queries`,
    ).get();
    afterDatabase.close();
    expect(after).toEqual(before);
  });
});

/**
 * self-hosted-plane.test.ts — the plane's non-loopback binding.
 *
 * `local-plane.test.ts` pins the positional hardening that makes the loopback
 * plane safe WITHOUT an operator credential. This file pins the argument that
 * replaces it when the socket becomes routable, and the two invariants that
 * must hold at the same time:
 *
 *   1. the loopback path still needs no operator credential. Its positional
 *      gate is stricter about canonical Host and Origin spellings so the
 *      integration audience can come from one trusted listener origin;
 *   2. after position and closed route classification, the routable path
 *      refuses an absent or wrong operator credential on ordinary and owner
 *      management routes.
 *
 * The requests are made over real TLS against a real listener, with a
 * self-signed certificate generated at test time, because the whole point of the
 * stage is transport the plane terminates itself.
 *
 * Reasoning: docs/reference/self-hosted-plane-hardening.md
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  DATA_PLANE_PROTOCOL_VERSION,
  parseDataPlaneStatus,
  planeReadsAreComplete,
  planeServes,
  type DataPlaneSurface,
} from "@seorak/types/data-plane";
import {
  INTEGRATION_API_VERSION,
  PRIVATE_MCP_TOOL_NAMES,
  SESSION_OUTCOME_MAX_ROWS,
  type IntegrationCredentialIssueResult,
} from "@seorak/types";
import { appendLocalEvent, openLocalHistory } from "../src/local-store.ts";
import {
  buildLocalSessionOutcome,
  LocalSessionOutcomeTooLargeError,
} from "../src/local-projection.ts";
import {
  createLocalPlaneServer,
  readLocalSettings,
  selfHostedDataPlaneStatus,
  startSelfHostedPlane,
  type StartedLocalPlane,
} from "../src/local-plane.ts";
import {
  mintSelfHostedCredential,
  readSelfHostedCredential,
  resolveSelfHostedBinding,
  type SelfHostedBinding,
} from "../src/plane-binding.ts";
import {
  FIXTURE_NOW,
  localHistoryFixture,
  REPO_A,
} from "./support/local-history-fixture.ts";

const temporary: string[] = [];
const planes: StartedLocalPlane[] = [];

/** One self-signed certificate for the whole file; generating it is the slow
 *  part and nothing in these tests depends on a fresh one. */
let certificate: { certPath: string; keyPath: string };
const HOSTNAME = "seorak.test";

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "seorak-plane-tls-"));
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  // P-256 rather than RSA-2048, deliberately. Every request in this file is a
  // fresh TLS handshake, and the suite already has timing-sensitive tests that
  // spawn concurrent hook processes; RSA key generation plus RSA handshakes add
  // enough CPU to push those over their timeouts on a loaded machine.
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-nodes",
      "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
      "-keyout", keyPath, "-out", certPath, "-days", "1",
      "-subj", `/CN=${HOSTNAME}`,
      "-addext", `subjectAltName=DNS:${HOSTNAME}`,
    ],
    { stdio: "ignore" },
  );
  certificate = { certPath, keyPath };
});

afterEach(async () => {
  for (const plane of planes.splice(0)) await plane.close();
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

afterAll(() => {
  rmSync(join(certificate.certPath, ".."), { recursive: true, force: true });
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "seorak-self-hosted-"));
  temporary.push(path);
  return path;
}

function seeded(): string {
  const dir = directory();
  for (const event of localHistoryFixture()) appendLocalEvent(event, dir);
  return dir;
}

/** A port the OS is very unlikely to have in use, chosen per binding so parallel
 *  test files do not collide. The origin's port IS the listen port by design. */
let nextPort = 44_310;

function bindingFor(
  stateDirectory: string,
  overrides: Partial<Record<string, string>> = {},
): { binding: SelfHostedBinding; credential: string; origin: string } {
  const credentialPath = join(stateDirectory, "self-hosted-credential");
  const credential = mintSelfHostedCredential(credentialPath);
  const port = nextPort++;
  const origin = `https://${HOSTNAME}:${port}`;
  const binding = resolveSelfHostedBinding(
    {
      SEORAK_SELF_HOSTED_ORIGIN: origin,
      SEORAK_SELF_HOSTED_BIND: "127.0.0.1",
      SEORAK_SELF_HOSTED_TLS_CERT: certificate.certPath,
      SEORAK_SELF_HOSTED_TLS_KEY: certificate.keyPath,
      ...overrides,
    },
    { credentialPath, loopbackPort: 4317 },
  );
  if (binding === null) throw new Error("expected a self-hosted binding");
  return { binding, credential, origin };
}

async function serve(stateDirectory: string, now?: () => Date): Promise<{
  binding: SelfHostedBinding;
  credential: string;
  origin: string;
}> {
  const resolved = bindingFor(stateDirectory);
  planes.push(
    await startSelfHostedPlane(resolved.binding, {
      directory: stateDirectory,
      assetsDirectory: null,
      ...(now === undefined ? {} : { integrationNow: now }),
    }),
  );
  return resolved;
}

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/**
 * A real TLS request. `fetch` cannot be used here: it will not let a test pin
 * `Host` to a name that is not the connect address, and the `Host` check IS the
 * DNS-rebinding guard being tested. The certificate is self-signed and the
 * connection is to 127.0.0.1 under the certificate's own name, so the CA is
 * supplied explicitly rather than by disabling verification.
 */
async function ask(
  binding: SelfHostedBinding,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Answer> {
  return await new Promise<Answer>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port: binding.port,
        servername: HOSTNAME,
        ca: readFileSync(certificate.certPath),
        path,
        method: options.method ?? "GET",
        headers: { host: `${HOSTNAME}:${binding.port}`, ...options.headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

/** Fetch adapter for the official MCP client. It connects to loopback while
 * preserving the configured TLS name, exact Host, and pinned test CA. */
async function tlsFetch(
  binding: SelfHostedBinding,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const body = request.body === null
    ? undefined
    : Buffer.from(await request.arrayBuffer()).toString("utf8");
  const answer = await ask(binding, `${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(answer.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) responseHeaders.append(name, item);
    } else {
      responseHeaders.set(name, value);
    }
  }
  return new Response(answer.body, {
    status: answer.status,
    headers: responseHeaders,
  });
}

function bearer(credential: string): Record<string, string> {
  return { authorization: `Bearer ${credential}` };
}

/** Ordinary and owner-management routes selected for operator authority after
 *  the unavoidable positional gate. API and MCP use distinct srkx_ grants. */
const OPERATOR_ROUTES = [
  "/data-plane",
  "/health",
  "/auth/check",
  "/workspace",
  "/live",
  "/overview?days=7",
  "/sessions",
  "/sessions/claude-session",
  "/sessions/claude-session/outcome",
  "/replay/claude-session",
  "/settings",
  "/developer-model",
  "/interventions",
  "/delivery-health",
  "/public-presence/manifest",
  "/integrations",
  "/nothing-here",
];

/**
 * Every surface the descriptor DECLARES, with a request that exercises it.
 *
 * This exists because a descriptor is a promise. Stage A4 closed
 * `sessionOutcome`, `developerModel`, and `interventions` and asserted they flow
 * into the self-hosted descriptor through `LOCAL_PLANE_SURFACES` — an assertion
 * made against a merge that did not compile. Declaring a surface the routable
 * binding cannot actually answer is the exact failure the honest-surfaces
 * contract exists to prevent, so it is checked over the wire rather than
 * inferred from the array.
 */
const DECLARED_SURFACE_ROUTES: ReadonlyArray<[DataPlaneSurface, string]> = [
  ["live", "/live"],
  ["overview", "/overview?days=7"],
  ["sessions", "/sessions"],
  ["session", "/sessions/claude-session"],
  ["sessionOutcome", "/sessions/claude-session/outcome"],
  ["replay", "/replay/claude-session"],
  ["settings", "/settings"],
  ["developerModel", "/developer-model?days=7"],
  ["interventions", "/interventions"],
  ["integrations", "/integrations"],
];

/** The two the plane does NOT declare, and the route that must say so. */
const ABSENT_SURFACE_ROUTES: ReadonlyArray<[DataPlaneSurface, string]> = [
  ["deliveryHealth", "/delivery-health"],
  ["publication", "/public-presence/manifest"],
];

describe("the credential gate", () => {
  it("requires operator authority on ordinary and owner-management routes", async () => {
    const { binding } = await serve(seeded());
    for (const path of OPERATOR_ROUTES) {
      const res = await ask(binding, path);
      expect(`${path} ${res.status}`).toBe(`${path} 401`);
      expect(res.headers["www-authenticate"]).toBe("Bearer");
    }
  });

  it("quarantines reserved routes and selects integration authority only on exact families", async () => {
    const { binding } = await serve(seeded());
    expect((await ask(binding, "/api/v1/period-summary?days=7")).status).toBe(401);
    expect((await ask(binding, "/mcp/private", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    })).status).toBe(401);
    for (const path of [
      "/api/v1/unknown",
      "/mcp/private/child",
      "/.well-known/oauth-protected-resource/mcp/private",
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
    ]) {
      const response = await ask(binding, path);
      expect(`${path} ${response.status}`).toBe(`${path} 404`);
      expect(response.headers["www-authenticate"]).toBeUndefined();
    }
  });

  it("refuses a wrong credential the same way it refuses an absent one", async () => {
    const { binding, credential } = await serve(seeded());
    for (const wrong of [
      "not-the-credential",
      // Same length and alphabet as a real one: the refusal is the comparison,
      // never the shape.
      "A".repeat(credential.length),
      credential.slice(0, -1),
      `${credential}x`,
    ]) {
      const res = await ask(binding, "/overview?days=7", { headers: bearer(wrong) });
      expect(res.status).toBe(401);
    }
  });

  it("admits the minted credential and answers the route contract", async () => {
    const { binding, credential } = await serve(seeded());
    const live = await ask(binding, "/live", { headers: bearer(credential) });
    expect(live.status).toBe(200);
    expect(JSON.parse(live.body)).toMatchObject({ live: expect.any(Array) });

    const overview = await ask(binding, "/overview?days=7", {
      headers: bearer(credential),
    });
    expect(overview.status).toBe(200);
    expect(JSON.parse(overview.body)).toMatchObject({ rangeDays: 7 });

    const one = await ask(binding, "/sessions/claude-session", {
      headers: bearer(credential),
    });
    expect(one.status).toBe(200);
    expect(JSON.parse(one.body)).toMatchObject({ sessionId: "claude-session" });
  });

  it("never accepts the credential from a cookie", async () => {
    // Load-bearing, not defensive. The plane skips CSRF verification on its one
    // write because a cross-site request cannot set `Authorization` without a
    // CORS preflight the plane never answers. A cookie WOULD ride along on its
    // own, so accepting one here would quietly reintroduce CSRF on a routable
    // socket.
    const { binding, credential } = await serve(seeded());
    for (const header of [
      { cookie: `authorization=Bearer ${credential}` },
      { cookie: `seorak_credential=${credential}` },
      { cookie: `session=${credential}` },
    ]) {
      const res = await ask(binding, "/live", { headers: header });
      expect(res.status).toBe(401);
      const management = await ask(binding, "/integrations", {
        method: "POST",
        headers: { ...header, origin: binding.origin, "content-type": "application/json" },
        body: "{}",
      });
      expect(management.status).toBe(401);
    }
  });

  it("refuses a credential offered under a different scheme", async () => {
    const { binding, credential } = await serve(seeded());
    for (const header of [
      { authorization: credential },
      { authorization: `Basic ${credential}` },
      { authorization: `Token ${credential}` },
      { "x-seorak-credential": credential },
    ]) {
      expect((await ask(binding, "/live", { headers: header })).status).toBe(401);
    }
  });
});

function mcpMessage(answer: Answer): Record<string, unknown> {
  if (!String(answer.headers["content-type"]).includes("text/event-stream")) {
    return JSON.parse(answer.body) as Record<string, unknown>;
  }
  const data = answer.body.split(/\r?\n/).find((line) => line.startsWith("data: "));
  if (data === undefined) throw new Error("MCP event-stream message absent");
  return JSON.parse(data.slice("data: ".length)) as Record<string, unknown>;
}

describe("mounted self-hosted private integrations", () => {
  it("issues exact-origin grants and serves HTTP and official MCP under distinct authority", async () => {
    const dir = seeded();
    const { binding, credential, origin } = await serve(
      dir,
      () => new Date(FIXTURE_NOW),
    );
    const issue = async (target: "api" | "mcp"): Promise<IntegrationCredentialIssueResult> => {
      const answer = await ask(binding, "/integrations", {
        method: "POST",
        headers: {
          ...bearer(credential),
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          apiVersion: INTEGRATION_API_VERSION,
          audience: `${origin}${target === "api" ? "/api/v1" : "/mcp/private"}`,
          scopes: ["period:read", "sessions:read", "replay:read"],
          expiresAt: new Date(FIXTURE_NOW + 24 * 60 * 60_000).toISOString(),
          rateLimit: { requestsPerMinute: 60, burst: 60 },
        }),
      });
      expect(answer.status).toBe(201);
      return JSON.parse(answer.body) as IntegrationCredentialIssueResult;
    };
    const apiCredential = await issue("api");
    const mcpCredential = await issue("mcp");
    expect(apiCredential.audience).toBe(`${origin}/api/v1`);
    expect(mcpCredential.audience).toBe(`${origin}/mcp/private`);

    const apiGet = async (path: string, token = apiCredential.secret): Promise<Answer> =>
      await ask(binding, path, { headers: bearer(token) });
    const periodAnswer = await apiGet("/api/v1/period-summary?days=7");
    const sessionsAnswer = await apiGet("/api/v1/sessions?limit=100");
    expect(periodAnswer.status).toBe(200);
    expect(sessionsAnswer.status).toBe(200);
    const period = JSON.parse(periodAnswer.body);
    const sessions = JSON.parse(sessionsAnswer.body) as {
      items: Array<{ sessionRef: string }>;
    };
    const sessionRef = sessions.items[0]!.sessionRef;
    const outcome = JSON.parse((await apiGet(
      `/api/v1/sessions/${sessionRef}/outcome`,
    )).body);
    const replay = JSON.parse((await apiGet(
      `/api/v1/sessions/${sessionRef}/replay/session-detail`,
    )).body);

    expect((await apiGet("/api/v1/period-summary?days=7", credential)).status).toBe(401);
    expect((await apiGet("/api/v1/period-summary?days=7", mcpCredential.secret)).status)
      .toBe(401);
    expect((await ask(binding, "/integrations", {
      headers: bearer(apiCredential.secret),
    })).status).toBe(401);
    for (const token of [credential, apiCredential.secret]) {
      const crossover = await ask(binding, "/mcp/private", {
        method: "POST",
        headers: {
          ...bearer(token),
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });
      expect(crossover.status).toBe(401);
    }

    const client = new Client(
      { name: "seorak-mounted-self-hosted-test", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`${origin}/mcp/private`),
      {
        authProvider: { token: async () => mcpCredential.secret },
        fetch: (input, init) => tlsFetch(binding, input, init),
        onInsufficientScope: "throw",
      },
    );
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(
        PRIVATE_MCP_TOOL_NAMES,
      );
      expect((await client.callTool({
        name: "period_summary",
        arguments: { rangeDays: 7 },
      })).structuredContent).toEqual(period);
      expect((await client.callTool({
        name: "list_sessions",
        arguments: { limit: 100 },
      })).structuredContent).toEqual(sessions);
      expect((await client.callTool({
        name: "get_session_outcome",
        arguments: { sessionRef },
      })).structuredContent).toEqual(outcome);
      expect((await client.callTool({
        name: "replay_lens",
        arguments: { sessionRef, lens: "session-detail" },
      })).structuredContent).toEqual(replay);
    } finally {
      await client.close();
    }

    const legacy = await ask(binding, "/mcp/private", {
      method: "POST",
      headers: {
        authorization: `Bearer ${mcpCredential.secret}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "period_summary", arguments: { rangeDays: 7 } },
      }),
    });
    expect(legacy.status).toBe(200);
    expect((mcpMessage(legacy).result as Record<string, unknown>).structuredContent)
      .toEqual(period);
  });

  it("keeps MCP methods and local discovery closed without managed metadata", async () => {
    const { binding, credential } = await serve(seeded());
    for (const method of ["GET", "DELETE"]) {
      const response = await ask(binding, "/mcp/private", {
        method,
        headers: bearer(credential),
      });
      expect(`${method} ${response.status}`).toBe(`${method} 405`);
      expect(response.headers.allow).toBe("POST");
    }
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp/private",
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
    ]) {
      const response = await ask(binding, path, { headers: bearer(credential) });
      expect(response.status).toBe(404);
      expect(response.body).not.toContain("resource_metadata");
      expect(response.body).not.toContain("authorization_servers");
    }
  });

  it("rejects position before integration authority or audit writes", async () => {
    const dir = seeded();
    const { binding, credential, origin } = await serve(
      dir,
      () => new Date(FIXTURE_NOW),
    );
    const issuedAnswer = await ask(binding, "/integrations", {
      method: "POST",
      headers: {
        ...bearer(credential),
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        apiVersion: INTEGRATION_API_VERSION,
        audience: `${origin}/api/v1`,
        scopes: ["period:read"],
        expiresAt: new Date(FIXTURE_NOW + 24 * 60 * 60_000).toISOString(),
        rateLimit: { requestsPerMinute: 60, burst: 60 },
      }),
    });
    const issued = JSON.parse(issuedAnswer.body) as IntegrationCredentialIssueResult;
    const authorityState = (): unknown => {
      const database = openLocalHistory(dir);
      try {
        return database.prepare(
          `SELECT
             (SELECT last_seen_ms FROM local_integration_clock WHERE singleton = 1) AS clock,
             (SELECT COUNT(*) FROM local_integration_authorization_audit) AS auth,
             (SELECT COUNT(*) FROM local_integration_query_audit) AS queries,
             (SELECT COUNT(*) FROM local_integration_credential_budget) AS token_budgets,
             (SELECT COUNT(*) FROM local_integration_route_budget) AS route_budgets`,
        ).get();
      } finally {
        database.close();
      }
    };
    const before = authorityState();

    expect((await ask(binding, "/api/v1/period-summary?days=7", {
      headers: { host: `attacker.example:${binding.port}`, ...bearer(issued.secret) },
    })).status).toBe(403);
    expect((await ask(binding, "/api/v1/period-summary?days=7", {
      headers: { origin: "null", ...bearer(issued.secret) },
    })).status).toBe(403);
    expect(authorityState()).toEqual(before);
  });
});

describe("positional hardening, re-anchored to the declared origin", () => {
  it("refuses a Host that is not the declared origin, credential or not", async () => {
    // The DNS-rebinding guard survives the move: an attacker who points their
    // own name at this address arrives with an authority the operator never
    // declared. 403 rather than 401, because nothing about the credential was
    // reached.
    const { binding, credential } = await serve(seeded());
    for (const host of ["attacker.example", `attacker.example:${binding.port}`, HOSTNAME]) {
      const res = await ask(binding, "/live", {
        headers: { host, ...bearer(credential) },
      });
      expect(`${host} ${res.status}`).toBe(`${host} 403`);
    }
  });

  it("refuses a cross-origin request and never sends a CORS header", async () => {
    const { binding, credential } = await serve(seeded());
    const cross = await ask(binding, "/live", {
      headers: { origin: "https://evil.example", ...bearer(credential) },
    });
    expect(cross.status).toBe(403);

    const same = await ask(binding, "/live", {
      headers: { origin: binding.origin, ...bearer(credential) },
    });
    expect(same.status).toBe(200);
    expect(same.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("refuses an opaque Origin before inspecting the operator credential", async () => {
    const { binding, credential } = await serve(seeded());
    const withCredential = await ask(binding, "/live", {
      headers: { origin: "null", ...bearer(credential) },
    });
    const withoutCredential = await ask(binding, "/live", {
      headers: { origin: "null" },
    });
    expect(withCredential.status).toBe(403);
    expect(withoutCredential.status).toBe(403);
    expect(withCredential.body).toBe(withoutCredential.body);
  });

  it("requires a canonical Origin, not only the declared authority", async () => {
    const { binding, credential } = await serve(seeded());
    for (const origin of [
      `${binding.origin}/path`,
      `${binding.origin}?query=1`,
      `${binding.origin}#fragment`,
      binding.origin.replace("https://", "https://user:pass@"),
      `${binding.origin}/`,
    ]) {
      const response = await ask(binding, "/live", {
        headers: { origin, ...bearer(credential) },
      });
      expect(`${origin} ${response.status}`).toBe(`${origin} 403`);
    }
  });

  it("keeps ordinary first-party writes at the one PUT /settings", async () => {
    // Integration owner POST/DELETE live in a separately classified management
    // family and do not widen ordinary route methods.
    const dir = directory();
    const { binding, credential } = await serve(dir);
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const res = await ask(binding, "/live", { method, headers: bearer(credential) });
      expect(`${method} ${res.status}`).toBe(`${method} 405`);
    }
    expect(
      (
        await ask(binding, "/live", {
          method: "PUT",
          headers: { "content-type": "application/json", ...bearer(credential) },
          body: "{}",
        })
      ).status,
    ).toBe(405);

    const write = await ask(binding, "/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", ...bearer(credential) },
      body: JSON.stringify({ capture: { fileLabels: true } }),
    });
    expect(write.status).toBe(200);

    expect((await ask(binding, "/integrations", {
      method: "POST",
      headers: {
        ...bearer(credential),
        origin: binding.origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "audience=forged",
    })).status).toBe(415);
    expect((await ask(binding, "/integrations", {
      method: "POST",
      headers: {
        ...bearer(credential),
        origin: "null",
        "content-type": "application/json",
      },
      body: "{}",
    })).status).toBe(403);
  });

  it("pins the transport it terminates", async () => {
    const { binding, credential } = await serve(seeded());
    const res = await ask(binding, "/health", { headers: bearer(credential) });
    expect(res.status).toBe(200);
    expect(res.headers["strict-transport-security"]).toContain("max-age=");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("what the self-hosted plane says about itself", () => {
  it("is a remote, self-hosted, credentialed authority the shared parser accepts", async () => {
    const { binding, credential } = await serve(seeded());
    const res = await ask(binding, "/data-plane", { headers: bearer(credential) });
    expect(res.status).toBe(200);
    const status = parseDataPlaneStatus(JSON.parse(res.body));
    expect(status).not.toBeNull();
    expect(status!.descriptor.authority).toBe("remote");
    expect(status!.descriptor.operator).toBe("self-hosted");
    expect(status!.descriptor.credentialRequired).toBe(true);
  });

  it("can never describe a billing window", async () => {
    // The structural half of "Seorak never meters a service you run". The shared
    // parser refuses a lifecycle window on a self-hosted operator, so a status
    // that carried one would not merely be impolite, it would fail to parse.
    const status = selfHostedDataPlaneStatus({ directory: seeded() });
    expect(status.lifecycle).toBeNull();
    expect(status.rebaseline).toBeNull();
    // A window that is valid ON ITS OWN, so the refusal below is about the
    // operator rather than about a malformed body.
    const window = {
      schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
      phase: "none",
      paidThroughAt: null,
      remoteServiceEndsAt: null,
      hostedDeletionAt: null,
      recoveryExportAvailable: false,
      resumesExistingCopy: false,
      observedAt: new Date(0).toISOString(),
    };
    expect(
      parseDataPlaneStatus({
        ...JSON.parse(JSON.stringify(status)),
        lifecycle: window,
      }),
    ).toBeNull();
  });

  it("reports the record complete because it measured it, not because it is local", async () => {
    // The plane serves the same history.sqlite the loopback binding serves, so
    // every clause the parser demands for completeness is answered from that
    // fact: caught up, empty backlog, nothing pending, and a real acknowledged
    // instant from local history.
    const dir = seeded();
    const status = selfHostedDataPlaneStatus({ directory: dir });
    const parsed = parseDataPlaneStatus(JSON.parse(JSON.stringify(status)));
    expect(parsed).not.toBeNull();
    expect(parsed!.coverage!.state).toBe("current");
    expect(parsed!.coverage!.backlog).toEqual({ sessions: 0, hours: 0, archives: 0 });
    expect(parsed!.coverage!.synchronizedThrough).not.toBeNull();
    expect(parsed!.coverage!.managedCopyComplete).toBe(true);
    expect(planeReadsAreComplete(parsed!, "overview")).toBe(true);
    // A surface it does not serve is still not complete, whatever the coverage
    // says. `deliveryHealth` rather than `developerModel`: stage A4 closed the
    // portrait, so the plane now both declares AND answers it, and asserting it
    // incomplete would pin the pre-A4 world.
    expect(planeReadsAreComplete(parsed!, "deliveryHealth")).toBe(false);
    expect(planeReadsAreComplete(parsed!, "publication")).toBe(false);
  });

  it("claims nothing on an install with no history", async () => {
    // Honest-empty in the direction that matters: with nothing acknowledged
    // there is no completeness to assert, and the parser would refuse the claim
    // anyway.
    const status = selfHostedDataPlaneStatus({ directory: directory() });
    expect(status.coverage!.synchronizedThrough).toBeNull();
    expect(status.coverage!.managedCopyComplete).toBe(false);
    expect(parseDataPlaneStatus(JSON.parse(JSON.stringify(status)))).not.toBeNull();
  });

  it("answers EVERY surface it declares, over the routable socket", async () => {
    // A descriptor is a promise, and this is the evidence for it. Stage A4
    // asserted its three newly closed surfaces flow through
    // `LOCAL_PLANE_SURFACES` into this descriptor, but asserted it against a
    // merge that did not compile, so the claim is re-earned here rather than
    // inherited: every declared surface is fetched on the routable binding and
    // must answer, not 501.
    const { binding, credential } = await serve(seeded());
    const status = parseDataPlaneStatus(
      JSON.parse((await ask(binding, "/data-plane", { headers: bearer(credential) })).body),
    );
    expect(status).not.toBeNull();

    for (const [surface, path] of DECLARED_SURFACE_ROUTES) {
      expect(planeServes(status!, surface)).toBe(true);
      const res = await ask(binding, path, { headers: bearer(credential) });
      expect(`${surface} ${res.status}`).toBe(`${surface} 200`);
    }
    // And the declaration is exactly the set that answers: nothing extra.
    expect([...status!.descriptor.surfaces].sort()).toEqual(
      DECLARED_SURFACE_ROUTES.map(([surface]) => surface).sort(),
    );
  });

  it("names ITSELF on the surfaces it does NOT declare", async () => {
    const { binding, credential } = await serve(seeded());
    const status = parseDataPlaneStatus(
      JSON.parse((await ask(binding, "/data-plane", { headers: bearer(credential) })).body),
    );
    for (const [surface, path] of ABSENT_SURFACE_ROUTES) {
      expect(planeServes(status!, surface)).toBe(false);
      const res = await ask(binding, path, { headers: bearer(credential) });
      expect(`${surface} ${res.status}`).toBe(`${surface} 501`);
      // The body names the binding the request actually arrived on, not the
      // loopback plane it shares a database with.
      expect(JSON.parse(res.body)).toMatchObject({
        surface,
        authority: "remote",
        operator: "self-hosted",
      });
    }
  });
});

describe("binding refuses rather than degrading", () => {
  function env(overrides: Record<string, string | undefined>): Record<string, string> {
    const base: Record<string, string> = {
      SEORAK_SELF_HOSTED_ORIGIN: "https://seorak.test:44999",
      SEORAK_SELF_HOSTED_BIND: "0.0.0.0",
      SEORAK_SELF_HOSTED_TLS_CERT: certificate.certPath,
      SEORAK_SELF_HOSTED_TLS_KEY: certificate.keyPath,
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete base[key];
      else base[key] = value;
    }
    return base;
  }

  it("is off when nothing was configured", () => {
    const dir = directory();
    expect(
      resolveSelfHostedBinding(
        {},
        { credentialPath: join(dir, "self-hosted-credential"), loopbackPort: 4317 },
      ),
    ).toBeNull();
  });

  it.each([
    ["SEORAK_SELF_HOSTED_ORIGIN"],
    ["SEORAK_SELF_HOSTED_BIND"],
    ["SEORAK_SELF_HOSTED_TLS_CERT"],
    ["SEORAK_SELF_HOSTED_TLS_KEY"],
  ])("throws rather than binding when %s alone is missing", (missing) => {
    // A partially configured remote plane is the one outcome this stage must not
    // produce. There is no "bind anyway and warn".
    const dir = directory();
    mintSelfHostedCredential(join(dir, "self-hosted-credential"));
    expect(() =>
      resolveSelfHostedBinding(env({ [missing]: undefined }), {
        credentialPath: join(dir, "self-hosted-credential"),
        loopbackPort: 4317,
      }),
    ).toThrow(/partially configured/);
  });

  it("refuses a plaintext origin outright", () => {
    const dir = directory();
    mintSelfHostedCredential(join(dir, "self-hosted-credential"));
    expect(() =>
      resolveSelfHostedBinding(
        env({ SEORAK_SELF_HOSTED_ORIGIN: "http://seorak.test:44999" }),
        { credentialPath: join(dir, "self-hosted-credential"), loopbackPort: 4317 },
      ),
    ).toThrow(/https/);
  });

  it("refuses to bind with no operator credential minted", () => {
    const dir = directory();
    expect(() =>
      resolveSelfHostedBinding(env({}), {
        credentialPath: join(dir, "self-hosted-credential"),
        loopbackPort: 4317,
      }),
    ).toThrow(/seorak remote credential/);
  });

  it("refuses a credential anyone else on the machine can read", () => {
    const dir = directory();
    const path = join(dir, "self-hosted-credential");
    mintSelfHostedCredential(path);
    chmodSync(path, 0o644);
    expect(() => readSelfHostedCredential(path)).toThrow(/beyond its owner/);
  });

  it("refuses a hand-written credential in place of a minted one", () => {
    // The plane mints its own because a chosen secret is only as good as the
    // operator's imagination and fails silently.
    const dir = directory();
    const path = join(dir, "self-hosted-credential");
    writeFileSync(path, "hunter2\n", { encoding: "utf8", mode: 0o600 });
    expect(() => readSelfHostedCredential(path)).toThrow(/not a minted credential/);
  });

  it("mints 256 bits at mode 0600", () => {
    const dir = directory();
    const path = join(dir, "self-hosted-credential");
    const first = mintSelfHostedCredential(path);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readSelfHostedCredential(path)).toBe(first);
    // Rotation replaces it, which is the mitigation the design claims for a
    // leaked credential rather than merely hopes for.
    const second = mintSelfHostedCredential(path);
    expect(second).not.toBe(first);
    expect(readSelfHostedCredential(path)).toBe(second);
  });

  it("refuses a remote port that collides with the loopback plane", () => {
    const dir = directory();
    mintSelfHostedCredential(join(dir, "self-hosted-credential"));
    expect(() =>
      resolveSelfHostedBinding(
        env({ SEORAK_SELF_HOSTED_ORIGIN: "https://seorak.test:4317" }),
        { credentialPath: join(dir, "self-hosted-credential"), loopbackPort: 4317 },
      ),
    ).toThrow(/collides/);
  });
});


describe("the per-session outcome row budget", () => {
  /**
   * A session with `rows` outcome-kind events.
   *
   * Inserted through one prepared statement in a single transaction rather than
   * through `appendLocalEvent`, because ten thousand hook-shaped appends would
   * dominate this file's runtime and the projection under test reads
   * `local_event` directly. The `session.start` still goes through the real
   * append so the `local_session` row, and with it the displayability gate, is
   * built the way the product builds it.
   */
  function seededWithOutcomeRows(rows: number): string {
    const dir = directory();
    appendLocalEvent(
      {
        kind: "session.start",
        eventId: "big-start",
        sessionId: "big-session",
        at: "2026-08-01T10:00:00.000Z",
        repoId: REPO_A,
        repoLabel: "seorak",
        agent: "claude-code",
        agentVersion: "1.0.0",
      },
      dir,
    );
    const database = openLocalHistory(dir);
    try {
      database.exec("BEGIN");
      const insert = database.prepare(
        `INSERT INTO local_event
           (event_id, session_id, kind, at, payload_json, captured_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (let index = 0; index < rows; index += 1) {
        const at = "2026-08-01T10:00:01.000Z";
        insert.run(
          `big-call-${index}`,
          "big-session",
          "tool.call",
          at,
          JSON.stringify({
            kind: "tool.call",
            eventId: `big-call-${index}`,
            sessionId: "big-session",
            at,
            toolName: "Edit",
            errored: false,
          }),
          at,
        );
      }
      database.exec("COMMIT");
    } finally {
      database.close();
    }
    return dir;
  }

  /** A loopback listener, so the two bindings are compared on one oversized
   *  session rather than on two different fixtures. */
  async function listenLoopback(directoryPath: string): Promise<string> {
    const server = createLocalPlaneServer({
      directory: directoryPath,
      assetsDirectory: null,
    });
    planes.push({
      server,
      url: "",
      dashboardUrl: null,
      close: () => new Promise<void>((done) => server.close(() => done())),
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("loopback plane did not bind");
    }
    return `http://127.0.0.1:${address.port}`;
  }

  it("refuses an oversized outcome on the routable binding", async () => {
    // Stage A4 waived this refusal because the caller owns the file it reads.
    // On a routable socket the caller is whoever holds the credential, the scan
    // is unbounded per session, and the response is a fixed handful of counts
    // either way, so a cheap request buys arbitrary work on the host.
    const dir = seededWithOutcomeRows(SESSION_OUTCOME_MAX_ROWS + 1);
    const { binding, credential } = await serve(dir);
    const res = await ask(binding, "/sessions/big-session/outcome", {
      headers: bearer(credential),
    });
    expect(res.status).toBe(413);
    // The SHARED refusal shape, so a client that already handles the hosted
    // plane's 413 needs no second dialect for this one.
    expect(JSON.parse(res.body)).toMatchObject({
      error: "session outcome too large",
      code: "session_outcome_limit",
      maxRows: SESSION_OUTCOME_MAX_ROWS,
      projectedRows: SESSION_OUTCOME_MAX_ROWS + 1,
    });
  });

  it("serves that SAME session in full on loopback", async () => {
    // The load-bearing half. A4's reasoning holds wherever position proves the
    // caller is the person at the keyboard, so the budget must not follow the
    // plane, only the binding. A refusal here would withhold the user's own
    // history from them on their own machine.
    const dir = seededWithOutcomeRows(SESSION_OUTCOME_MAX_ROWS + 1);
    const base = await listenLoopback(dir);
    const res = await fetch(`${base}/sessions/big-session/outcome`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sessionId: "big-session" });
  });

  it("counts to the budget without paying for the scan it avoids", () => {
    // The preflight is bounded at budget + 1, so "is this too big?" never costs
    // the read it exists to refuse. Asserted at the projection so the numbers on
    // the wire are the numbers measured.
    const dir = seededWithOutcomeRows(12);
    let thrown: unknown;
    try {
      buildLocalSessionOutcome("big-session", { directory: dir, rowBudget: 5 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LocalSessionOutcomeTooLargeError);
    const refusal = thrown as LocalSessionOutcomeTooLargeError;
    expect(refusal.rowBudget).toBe(5);
    // Six, not twelve: the count stopped one past the budget.
    expect(refusal.projectedRows).toBe(6);
  });

  it("answers a session at exactly the budget rather than refusing it", () => {
    const dir = seededWithOutcomeRows(8);
    expect(
      buildLocalSessionOutcome("big-session", { directory: dir, rowBudget: 8 }),
    ).toMatchObject({ sessionId: "big-session" });
  });

  it("defaults to no budget, which is what the loopback caller gets", () => {
    const dir = seededWithOutcomeRows(20);
    expect(
      buildLocalSessionOutcome("big-session", { directory: dir }),
    ).toMatchObject({ sessionId: "big-session" });
  });
});


describe("what a credentialed remote caller CANNOT reach", () => {
  const planeSource = readFileSync(
    new URL("../src/local-plane.ts", import.meta.url),
    "utf8",
  );

  it("never reaches the desktop notifier or the watch engine from a request", () => {
    // Stage A4 added local delivery: the daemon sweeps, records what crossed a
    // threshold, and posts an `osascript` banner on the host machine. Making the
    // plane routable must not turn a network request into a notification on
    // somebody's screen.
    //
    // It does not, and the reason is structural rather than careful: the two
    // functions that can fire and deliver have exactly one caller each, a daemon
    // TIMER, and neither is reachable from the request handler. The plane's
    // `/interventions` route reads the recorded ledger and evaluates nothing. So
    // the guarantee is asserted where it can actually be broken — an import.
    expect(planeSource).not.toContain("local-notify");
    expect(planeSource).not.toContain("deliverLocalIntervention");
    expect(planeSource).not.toContain("sweepLocalInterventions");
    expect(planeSource).toContain("listLocalInterventions");
  });

  it("reads the intervention ledger without writing to it", async () => {
    // The read is idempotent: asking twice records nothing and fires nothing,
    // so a poller on the routable binding cannot manufacture history.
    const { binding, credential } = await serve(seeded());
    const first = await ask(binding, "/interventions", { headers: bearer(credential) });
    const second = await ask(binding, "/interventions", { headers: bearer(credential) });
    expect(first.status).toBe(200);
    expect(second.body).toBe(first.body);
  });

  it("can still change WHICH watches are armed, which is stated rather than denied", async () => {
    // The honest limit of the claim above. `PUT /settings` is a declared write
    // surface on both bindings, and the daemon sweep reads the notification
    // family it writes. So a credential holder cannot cause a banner NOW, but
    // can change the configuration a later daemon tick evaluates. That is the
    // same authority the loopback dashboard has over the same file, and it is
    // the authority the credential is meant to carry, not a hole in it.
    const dir = directory();
    const { binding, credential } = await serve(dir);
    const write = await ask(binding, "/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", ...bearer(credential) },
      body: JSON.stringify({
        notifications: { signals: { cost_spike: { enabled: false } } },
      }),
    });
    expect(write.status).toBe(200);
    const stored = readLocalSettings(dir).notifications as {
      signals: Record<string, { enabled: boolean }>;
    };
    expect(stored.signals.cost_spike!.enabled).toBe(false);
  });
});

/**
 * local-plane.test.ts — the loopback data plane the primary UI reads.
 *
 * Two things are load-bearing here and both are asserted over real HTTP rather
 * than by calling the handler:
 *
 *   1. HONESTY. `GET /data-plane` must parse through the SHARED parser in
 *      `@seorak/types/data-plane`, and a surface it does not list must refuse
 *      rather than answer with an empty measured body.
 *   2. POSITIONAL HARDENING. The plane requires no operator credential, so
 *      loopback binding, exact Host/Origin admission, the closed route
 *      classifier, and static-asset containment ARE the owner boundary.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seorakRoutes } from "@seorak/types";
import {
  DATA_PLANE_PROTOCOL_VERSION,
  parseDataPlaneStatus,
  planeReadsAreComplete,
} from "@seorak/types/data-plane";
import { appendLocalEvent } from "../src/local-store.ts";
import {
  createLocalPlaneServer,
  dashboardBundleRefusal,
  localDataPlaneStatus,
  LOCAL_PLANE_SURFACES,
  readLocalSettings,
  resolveDashboardAssets,
  resolveDashboardBundle,
  startLocalPlane,
  writeLocalSettings,
} from "../src/local-plane.ts";
import { admitRequestPosition, LOOPBACK_BINDING } from "../src/plane-binding.ts";
import { liveFixture, localHistoryFixture } from "./support/local-history-fixture.ts";

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
  const path = mkdtempSync(join(tmpdir(), "seorak-local-plane-"));
  temporary.push(path);
  return path;
}

function seeded(): string {
  const dir = directory();
  for (const event of localHistoryFixture()) appendLocalEvent(event, dir);
  for (const event of liveFixture()) appendLocalEvent(event, dir);
  return dir;
}

async function listen(
  directoryPath: string,
  assetsDirectory?: string | null,
): Promise<string> {
  const server = createLocalPlaneServer({
    directory: directoryPath,
    ...(assetsDirectory === undefined ? {} : { assetsDirectory }),
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("local plane did not bind a port");
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("GET /data-plane", () => {
  it("declares a local, credential-free authority the shared parser accepts", async () => {
    const base = await listen(seeded(), null);
    // The path comes from the shared catalog, not from a literal. The dashboard
    // builds its probe from the same entry, so a rename that reached only one of
    // them fails here instead of leaving a surface reading an unanswered route.
    const res = await fetch(`${base}${seorakRoutes.localDataPlane()}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // No CORS header, ever: another origin must not be able to read this.
    expect(res.headers.get("access-control-allow-origin")).toBeNull();

    const status = parseDataPlaneStatus(await res.json());
    expect(status).not.toBeNull();
    expect(status!.descriptor.authority).toBe("local");
    expect(status!.descriptor.operator).toBe("local-machine");
    expect(status!.descriptor.credentialRequired).toBe(false);
    // The local plane owns the authoritative raw history for what it serves…
    expect(planeReadsAreComplete(status!, "overview")).toBe(true);
    // …and cannot be complete for a surface it does not serve at all.
    expect(planeReadsAreComplete(status!, "deliveryHealth")).toBe(false);
    // Nothing about billing or a managed copy can be asserted from here.
    expect(status!.coverage).toBeNull();
    expect(status!.lifecycle).toBeNull();
    expect(status!.rebaseline).toBeNull();
  });

  it("lists ONLY the surfaces it serves", async () => {
    const status = localDataPlaneStatus();
    expect([...status.descriptor.surfaces].sort()).toEqual(
      [...LOCAL_PLANE_SURFACES].sort(),
    );
    for (const absent of [
      "deliveryHealth",
      "publication",
    ] as const) {
      expect(status.descriptor.surfaces).not.toContain(absent);
    }
    // Declared because they are derived from local rows, not because the routes
    // exist: a surface on this list promises a measured answer.
    for (const served of [
      "sessionOutcome",
      "developerModel",
      "interventions",
      "integrations",
    ] as const) {
      expect(status.descriptor.surfaces).toContain(served);
    }
  });
});

describe("the boot gate", () => {
  it("answers /auth/check with the session shape the dashboard requires", async () => {
    // DashboardApp will not render until restoreSession() sees `mode: 'session'`
    // plus a csrfToken of at least 32 characters (web/src/lib/api.ts). A body it
    // does not recognise drops the user on the sign-in screen.
    const base = await listen(seeded(), null);
    const res = await fetch(`${base}/auth/check`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode?: string; csrfToken?: string };
    expect(body.mode).toBe("session");
    expect(body.csrfToken?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it("never answers 401 on the first-party poller routes", async () => {
    // polling.ts calls authActions.expireSession() on any 401 and bounces the
    // user to the entry screen mid-session. These operator-credential-free
    // first-party routes have no reason to emit one; private integration routes
    // deliberately use their own exact-audience principal.
    const base = await listen(seeded(), null);
    for (const path of [
      "/auth/check",
      "/live",
      "/overview?days=7",
      "/sessions",
      "/settings",
      "/workspace",
      "/interventions",
      "/replay/nope",
      "/nothing-here",
    ]) {
      expect((await fetch(`${base}${path}`)).status).not.toBe(401);
    }
  });

  it("lets sign-out succeed instead of throwing on 405", async () => {
    // The web client throws on any status but 2xx/400/401, and logout() awaits
    // it. There is no session to destroy, but the call must not reject.
    const base = await listen(seeded(), null);
    const res = await fetch(`${base}/auth/session`, { method: "DELETE" });
    expect([200, 400, 401]).toContain(res.status);
  });

  it("accepts the CSRF proof on a write rather than refusing it", async () => {
    const base = await listen(directory(), null);
    const res = await fetch(`${base}/settings`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-seorak-csrf": "whatever-the-app-happens-to-hold",
      },
      body: JSON.stringify({ capture: { fileLabels: true } }),
    });
    expect(res.status).toBe(200);
  });
});

describe("the managed relationship, seen from the local plane", () => {
  it("reports no managed copy on an account-free install", async () => {
    // Not a fabricated `none` phase: this machine has never observed one.
    const base = await listen(seeded(), null);
    const status = parseDataPlaneStatus(await (await fetch(`${base}/data-plane`)).json());
    expect(status!.lifecycle).toBeNull();
    expect(status!.coverage).toBeNull();
  });

  it("reads the lifecycle and the coverage at ONE instant", () => {
    // Both helpers default to Date.now() independently, so an unpinned call
    // would compute the phase and the sync state microseconds apart — and those
    // two are exactly the pair the contract requires to agree.
    const dir = seeded();
    const observed: number[] = [];
    const status = localDataPlaneStatus({
      directory: dir,
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
    });
    if (status.coverage !== null) observed.push(Date.parse(status.coverage.observedAt));
    if (status.lifecycle !== null) observed.push(Date.parse(status.lifecycle.observedAt));
    expect(new Set(observed).size).toBeLessThanOrEqual(1);
  });

  it("keeps lifecycle and coverage travelling together", () => {
    // The contract refuses a phase past `none` with no coverage beside it, so a
    // local plane that relays one must relay both or the parser rejects it.
    const status = localDataPlaneStatus({ directory: seeded() });
    expect(parseDataPlaneStatus(JSON.parse(JSON.stringify(status)))).not.toBeNull();
    if (status.lifecycle !== null && status.lifecycle.phase !== "none") {
      expect(status.coverage).not.toBeNull();
    }
  });
});

describe("route contract", () => {
  it("answers /live, /overview, /sessions, /sessions/:id, and /replay/:id", async () => {
    const base = await listen(seeded(), null);

    const live = await fetch(`${base}/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ live: expect.any(Array) });

    const overview = await fetch(`${base}/overview?days=7`);
    expect(overview.status).toBe(200);
    const snapshot = (await overview.json()) as { rangeDays: number };
    expect(snapshot.rangeDays).toBe(7);

    const sessions = await fetch(`${base}/sessions?limit=2`);
    expect(sessions.status).toBe(200);
    const page = (await sessions.json()) as {
      sessions: Array<{ sessionId: string }>;
      nextCursor: string | null;
    };
    expect(page.sessions).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();

    const one = await fetch(`${base}/sessions/claude-session`);
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({ sessionId: "claude-session" });
    const encodedOne = await fetch(`${base}/sessions/claude%2Dsession`);
    expect(encodedOne.status).toBe(200);
    expect(await encodedOne.json()).toMatchObject({ sessionId: "claude-session" });

    const replay = await fetch(`${base}/replay/claude-session`);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ sessionId: "claude-session" });
  });

  it("falls back to the narrowest window rather than refusing a bad ?days", async () => {
    const base = await listen(seeded(), null);
    const res = await fetch(`${base}/overview?days=nonsense`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { rangeDays: number }).toMatchObject({
      rangeDays: 7,
    });
  });

  it("answers /interventions with the recorded history, and records nothing itself", async () => {
    // Reading the history must never evaluate: opening a surface that fires a
    // watch would make the act of looking change what is there.
    const base = await listen(seeded(), null);
    const res = await fetch(`${base}/interventions`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("answers /developer-model from local rows, with the window it was asked for", async () => {
    const base = await listen(seeded(), null);
    const res = await fetch(`${base}/developer-model?days=30`);
    expect(res.status).toBe(200);
    const model = await res.json();
    expect(model.scope).toMatchObject({ rangeDays: 30, repoId: null });
    expect(model.outcomes.shipped).toBeGreaterThan(0);
    // A repo scope narrows the same read rather than opening a second one.
    const scoped = await fetch(`${base}/developer-model?days=30&repoId=${"b".repeat(64)}`);
    expect((await scoped.json()).scope.repoId).toBe("b".repeat(64));
  });

  it("answers /sessions/:id/outcome from local rows", async () => {
    const base = await listen(seeded(), null);
    const res = await fetch(`${base}/sessions/claude-session/outcome`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sessionId: "claude-session",
      // Every number here traces to a fixture row: the delta's commits and
      // uncommitted churn, the survival sweep's counts, the two errored calls.
      commitsLanded: 2,
      uncommitted: { filesTouched: 3, linesAdded: 20, linesRemoved: 5 },
      lineSurvival: { rung: "3d", fate: "retained", commitsChecked: 4 },
      errorCount: 2,
      endReason: "clear",
    });
  });

  it("is honestly 404 for a session local history never saw", async () => {
    const base = await listen(seeded(), null);
    expect((await fetch(`${base}/sessions/nope`)).status).toBe(404);
    expect((await fetch(`${base}/sessions/nope/outcome`)).status).toBe(404);
    expect((await fetch(`${base}/replay/nope`)).status).toBe(404);
  });

  it("refuses an undeclared surface instead of serving measured emptiness", async () => {
    const base = await listen(seeded(), null);
    for (const [path, surface] of [
      ["/delivery-health", "deliveryHealth"],
      ["/public-presence/manifest", "publication"],
    ] as const) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(501);
      expect(await res.json()).toMatchObject({
        surface,
        authority: "local",
      });
    }
  });

  it("keeps integration namespaces and local OAuth discovery closed", async () => {
    const base = await listen(seeded(), null);
    // A surface refusal claims the route contract KNOWS this path and that this
    // plane is not where it lives. Saying that about a path the contract has
    // never heard of would be a different fabrication from the one the 501
    // fixes, so the match has to stay exactly as wide as the surface.
    for (const path of [
      "/.well-known/openid-configuration",
      "/.well-known/oauth-protected-resource/mcp/private",
      "/.well-known/oauth-authorization-server",
      "/api/v2/period-summary",
      "/mcp/public",
      "/integrations-elsewhere",
    ]) {
      expect((await fetch(`${base}${path}`)).status).toBe(404);
    }
  });
});

describe("settings", () => {
  it("round-trips a sparse family patch without clobbering a sibling", async () => {
    const dir = directory();
    const base = await listen(dir, null);

    const initial = await (await fetch(`${base}/settings`)).json();
    expect(Object.keys(initial as object).sort()).toEqual(
      [
        "capture",
        "liveActivity",
        "notifications",
        "projectArchive",
        "projectMerges",
        "projectThemes",
      ].sort(),
    );

    const write = await fetch(`${base}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capture: { fileLabels: true } }),
    });
    expect(write.status).toBe(200);
    // The capture family is written where the hook processes already read it,
    // so a dashboard toggle reaches capture with no second authority.
    expect(readLocalSettings(dir).capture).toMatchObject({ fileLabels: true });

    writeLocalSettings({ notifications: { quietHours: { enabled: true } } }, dir);
    const merged = readLocalSettings(dir);
    expect(merged.capture).toMatchObject({ fileLabels: true });
    expect(merged.notifications).toMatchObject({
      quietHours: expect.objectContaining({ enabled: true }),
    });
  });

  it("refuses a non-object body rather than storing it", async () => {
    const base = await listen(directory(), null);
    const res = await fetch(`${base}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(["not", "a", "document"]),
    });
    expect(res.status).toBe(400);
  });
});

describe("positional hardening", () => {
  it("refuses a Host that does not name loopback (DNS rebinding)", async () => {
    const base = await listen(seeded(), null);
    // `fetch` forbids setting Host, and a rebinding attacker is not using
    // fetch's rules — the request has to be made at the socket level to prove
    // the guard is real.
    const port = Number(new URL(base).port);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/overview?days=7",
          method: "GET",
          headers: { host: "attacker.example" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("requires the raw Host to be the canonical actual listener authority", async () => {
    const base = await listen(seeded(), null);
    const port = Number(new URL(base).port);
    for (const host of [`127.0.0.1:${port}/`, `LOCALHOST:${port}`]) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: "127.0.0.1",
            port,
            path: "/live",
            method: "GET",
            headers: { host },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(`${host} ${status}`).toBe(`${host} 403`);
    }

    const direct = admitRequestPosition(LOOPBACK_BINDING, {
      headers: { host: ` 127.0.0.1:${port}` },
      socket: { localPort: port },
    } as never);
    expect(direct).toEqual({ admitted: false });
  });

  it("refuses a cross-origin request outright", async () => {
    const base = await listen(seeded(), null);
    const res = await fetch(`${base}/live`, {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("refuses an opaque Origin before treating loopback position as ownership", async () => {
    const base = await listen(seeded(), null);
    const res = await fetch(`${base}/live`, { headers: { origin: "null" } });
    expect(res.status).toBe(403);
  });

  it("does not let one loopback alias authorize another", async () => {
    const base = await listen(seeded(), null);
    const alias = new URL(base);
    alias.hostname = "localhost";
    const res = await fetch(`${base}/live`, { headers: { origin: alias.origin } });
    expect(res.status).toBe(403);
  });

  it("requires a canonical same-origin header, not only a matching authority", async () => {
    const base = await listen(seeded(), null);
    const parsed = new URL(base);
    for (const origin of [
      `${base}/path`,
      `${base}?query=1`,
      `${base}#fragment`,
      `http://user:pass@${parsed.host}`,
      `${base}/`,
    ]) {
      expect((await fetch(`${base}/live`, { headers: { origin } })).status, origin)
        .toBe(403);
    }
  });

  it("accepts a same-origin loopback Origin", async () => {
    const base = await listen(seeded(), null);
    const res = await fetch(`${base}/live`, { headers: { origin: base } });
    expect(res.status).toBe(200);
  });

  it("still needs no operator credential, now that a credentialed binding exists", async () => {
    // The invariant the self-hosted binding must not disturb. A credential gate
    // in front of the Free product would be a login by another name, so the
    // loopback path answers every ordinary route with no `Authorization` header
    // at all, and its descriptor says so through the shared parser.
    const base = await listen(seeded(), null);
    for (const path of [
      "/data-plane",
      "/health",
      "/auth/check",
      "/workspace",
      "/live",
      "/overview?days=7",
      "/sessions",
      "/sessions/claude-session",
      "/replay/claude-session",
      "/settings",
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(`${path} ${res.status}`).toBe(`${path} 200`);
    }
    const status = parseDataPlaneStatus(
      await (await fetch(`${base}/data-plane`)).json(),
    );
    expect(status!.descriptor.credentialRequired).toBe(false);
    expect(status!.descriptor.authority).toBe("local");

    // An unrelated non-integration bearer is ignored on ordinary routes. A
    // syntactically valid srkx_ integration bearer is refused there by the
    // closed authority classifier and is covered by the integration wire test.
    const withToken = await fetch(`${base}/live`, {
      headers: { authorization: "Bearer irrelevant-on-loopback" },
    });
    expect(withToken.status).toBe(200);

    // The ordinary settings write is still operator-credential-free too.
    const write = await fetch(`${base}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capture: { fileLabels: true } }),
    });
    expect(write.status).toBe(200);
  });

  it("sends no HSTS, which would strand the http loopback dashboard", async () => {
    // Only the self-hosted binding terminates TLS. Pinning `127.0.0.1` to https
    // in the browser that saw the header would make the local dashboard
    // unreachable, so the header is bound to the binding, not to the plane.
    const base = await listen(seeded(), null);
    const res = await fetch(`${base}/health`);
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });

  it("allows only GET, plus the one PUT /settings accepts", async () => {
    const base = await listen(seeded(), null);
    expect((await fetch(`${base}/live`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/live`, { method: "DELETE" })).status).toBe(405);
    expect(
      (
        await fetch(`${base}/live`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(405);
  });

  it("answers an unserved surface 501 on a write, not 405", async () => {
    // The method allowlist would answer 405 for the publication POSTs, which
    // reads as "wrong verb for a route that lives here". The route does not
    // live here at all, so the surface answer has to win over the verb answer.
    const base = await listen(seeded(), null);
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await fetch(`${base}/public-presence/publish`, { method });
      expect(`${method} ${res.status}`).toBe(`${method} 501`);
      expect((await res.json()).surface).toBe("publication");
    }
  });

  it("keeps integration methods on their exact closed routes", async () => {
    const base = await listen(seeded(), null);
    expect((await fetch(`${base}/integrations`, { method: "PUT" })).status).toBe(405);
    const mcpGet = await fetch(`${base}/mcp/private`);
    expect(mcpGet.status).toBe(405);
    expect(mcpGet.headers.get("allow")).toBe("POST");
    expect((await fetch(`${base}/api/v1/sessions`, { method: "PATCH" })).status).toBe(405);
    expect((await fetch(`${base}/integrations/not-a-ref`, { method: "DELETE" })).status)
      .toBe(404);
  });
});

describe("dashboard assets", () => {
  function assets(protocolVersion: unknown = DATA_PLANE_PROTOCOL_VERSION): string {
    const root = directory();
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "index.html"), "<!doctype html><title>x</title>", "utf8");
    writeFileSync(join(root, "assets", "app.js"), "export const a = 1;\n", "utf8");
    // A real artifact declares the protocol it was built against; the plane
    // refuses one that does not, so the fixture has to be a real artifact.
    if (protocolVersion !== undefined) {
      writeFileSync(
        join(root, "data-plane-protocol.json"),
        JSON.stringify({ dataPlaneProtocolVersion: protocolVersion }),
        "utf8",
      );
    }
    return root;
  }

  it("serves the SPA document for an in-app path and the real file for an asset", async () => {
    const root = assets();
    const base = await listen(seeded(), root);

    const document = await fetch(`${base}/dashboard`);
    expect(document.status).toBe(200);
    expect(document.headers.get("content-type")).toContain("text/html");
    expect(document.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(await document.text()).toContain("<!doctype html>");

    const script = await fetch(`${base}/assets/app.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
  });

  it("sends the root to the dashboard, not the marketing tree", async () => {
    const base = await listen(seeded(), assets());
    const res = await fetch(`${base}/`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
  });

  it("404s a missing chunk instead of answering it with HTML", async () => {
    // An HTML body under a .js request is the "expected a JavaScript module"
    // failure that reads as a bundler bug and is really an eager SPA fallback.
    const base = await listen(seeded(), assets());
    const res = await fetch(`${base}/assets/gone.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("cannot be walked out of its root", async () => {
    const root = assets();
    const secret = directory();
    writeFileSync(join(secret, "secret.txt"), "do not serve me", "utf8");
    const base = await listen(seeded(), root);
    // A traversal resolves back inside the root (or not at all), so the worst
    // case is the SPA document, never a file outside the bundle.
    const res = await fetch(`${base}/assets/../../../../etc/hosts`);
    expect(await res.text()).not.toContain("do not serve me");
    const encoded = await fetch(`${base}/%2e%2e%2f%2e%2e%2fsecret.txt`);
    expect(await encoded.text()).not.toContain("do not serve me");
  });

  it("still answers the route contract with no bundle installed", async () => {
    const base = await listen(seeded(), null);
    expect((await fetch(`${base}/data-plane`)).status).toBe(200);
    expect((await fetch(`${base}/dashboard`)).status).toBe(404);
  });

  it("never answers an unimplemented route with the SPA document", async () => {
    // The whole point of installing a bundle must not be that unimplemented
    // routes start succeeding. Before the fallback was bounded, every one of
    // these returned `200 text/html` once assets were present, which is a
    // fabricated success for a route this plane has never had. The list is the
    // worker-owned surface a bundled dashboard would otherwise swallow.
    const base = await listen(seeded(), assets());
    for (const path of ["/entitlements", "/devices", "/auth/handoff", "/recovery/v1/manifest"]) {
      const res = await fetch(`${base}${path}`);
      expect(`${path} ${res.status}`).toBe(`${path} 404`);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
    // Publication remains absent and is refused before assets are considered.
    // Mounted integration families are likewise classified before the SPA,
    // but answer with their own owner/API/MCP authority below.
    const publication = await fetch(`${base}/public-presence/manifest`);
    expect(publication.status).toBe(501);
  });

  it("keeps every surface it does not serve at 501 with a bundle installed", async () => {
    // A surface the plane declares absent must stay absent when a bundle is
    // present. 501 and 404 are different answers on purpose: these are all in
    // DATA_PLANE_SURFACES, so "unavailable here" is the truthful one.
    const base = await listen(seeded(), assets());
    for (const path of [
      "/delivery-health",
      "/public-presence/manifest",
      "/public-presence/status",
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(`${path} ${res.status}`).toBe(`${path} 501`);
      expect((await res.json()).authority).toBe("local");
      expect(res.headers.get("content-type")).toContain("application/json");
    }
    expect((await fetch(`${base}/integrations`)).status).toBe(200);
    expect((await fetch(`${base}/api/v1/period-summary?days=7`)).status).toBe(401);
    expect((await fetch(`${base}/mcp/private`)).status).toBe(405);
  });

  it("serves the SPA document for every dashboard view, not only the root", async () => {
    const base = await listen(seeded(), assets());
    for (const path of [
      "/dashboard",
      "/dashboard/",
      "/dashboard/compare",
      "/dashboard/model",
      "/dashboard/settings",
      "/dashboard/project/abc",
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(`${path} ${res.status}`).toBe(`${path} 200`);
      expect(res.headers.get("content-type")).toContain("text/html");
    }

    // `/dashboard.html` names a FILE, so it resolves directly or not at all and
    // never reaches the document fallback. That was already true before the
    // fallback was bounded; it is pinned here so the next reader does not take
    // `isDashboardAppPath` accepting the spelling as a promise that the plane
    // serves it.
    expect((await fetch(`${base}/dashboard.html`)).status).toBe(404);
  });
});

describe("dashboard bundle resolution", () => {
  function bundle(protocolVersion: unknown): string {
    const root = directory();
    writeFileSync(join(root, "index.html"), "<!doctype html><title>x</title>", "utf8");
    if (protocolVersion !== undefined) {
      writeFileSync(
        join(root, "data-plane-protocol.json"),
        JSON.stringify({ dataPlaneProtocolVersion: protocolVersion }),
        "utf8",
      );
    }
    return root;
  }

  it("resolves the installed package by name rather than by sibling path", () => {
    // ADR 005 decision 3. `require.resolve` answers which copy THIS module gets,
    // which is the question a sibling probe only appears to answer: npm nests on
    // a version conflict, and Yarn PnP has no directory layout to walk at all.
    // In this checkout the workspace symlink is what it finds, and the assertion
    // is that it found the PACKAGE, not a path someone computed.
    const resolved = createRequire(import.meta.url).resolve(
      "@seorak/dashboard/package.json",
    );
    expect(JSON.parse(readFileSync(resolved, "utf8")).name).toBe(
      "@seorak/dashboard",
    );
    // And the collector depends on it exactly, which is what makes the protocol
    // check below a guarantee rather than a hope.
    const collector = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
    );
    expect(collector.dependencies["@seorak/dashboard"]).toBe(
      JSON.parse(readFileSync(resolved, "utf8")).version,
    );
  });

  it("serves a bundle built against this collector's protocol", () => {
    const root = bundle(DATA_PLANE_PROTOCOL_VERSION);
    expect(resolveDashboardBundle(root)).toEqual({ state: "ready", root });
    expect(resolveDashboardAssets(root)).toBe(root);
  });

  it("refuses a bundle built against a different protocol, by name", () => {
    // THE FAILURE THIS PREVENTS. `parseDataPlaneStatus` compares the two
    // constants with a strict `!==`, so a mismatched bundle does not degrade: it
    // reads the descriptor as unparseable, concludes the authority is unknown,
    // and renders the sign-in path. The account-free product would become a
    // sign-in wall over the user's own history with nothing saying why.
    const root = bundle(DATA_PLANE_PROTOCOL_VERSION + 1);
    const resolved = resolveDashboardBundle(root);
    expect(resolved.state).toBe("protocol-mismatch");
    expect(resolveDashboardAssets(root)).toBeNull();

    const refusal = dashboardBundleRefusal(resolved);
    expect(refusal).toContain(root);
    expect(refusal).toContain(`declares data-plane protocol ${DATA_PLANE_PROTOCOL_VERSION + 1}`);
    expect(refusal).toContain(`this collector speaks ${DATA_PLANE_PROTOCOL_VERSION}`);
    expect(refusal).toContain("sign-in screen");
    expect(refusal).toContain("@seorak/dashboard");
  });

  it("refuses a directory that declares no protocol at all", () => {
    // A directory with an index.html is not evidence of a Seorak dashboard.
    // SEORAK_WEB_DIST points wherever an operator says, and a stale build from
    // before this contract existed is exactly the case worth naming.
    const root = bundle(undefined);
    const resolved = resolveDashboardBundle(root);
    expect(resolved.state).toBe("protocol-mismatch");
    expect(dashboardBundleRefusal(resolved)).toContain(
      "declares no data-plane protocol version",
    );
  });

  it("says nothing when there is nothing to say", () => {
    expect(dashboardBundleRefusal({ state: "absent" })).toBeNull();
    expect(dashboardBundleRefusal({ state: "ready", root: "/x" })).toBeNull();
    expect(resolveDashboardBundle(null)).toEqual({ state: "absent" });
  });

  /** `startLocalPlane` refuses port 0, so ask the OS for one and hand it over. */
  async function ephemeralPort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((ready) => probe.listen(0, "127.0.0.1", ready));
    const address = probe.address();
    if (address === null || typeof address === "string") {
      throw new Error("probe did not bind a port");
    }
    await new Promise<void>((closed) => probe.close(() => closed()));
    return address.port;
  }

  it("a started plane carries the refusal beside the missing url", async () => {
    const root = bundle(DATA_PLANE_PROTOCOL_VERSION + 1);
    const plane = await startLocalPlane({
      port: await ephemeralPort(),
      directory: seeded(),
      assetsDirectory: root,
    });
    try {
      expect(plane.dashboardUrl).toBeNull();
      expect(plane.dashboardRefusal).toContain("dashboard bundle refused");
      // The route contract is untouched: refusing a UI must not refuse the data.
      expect((await fetch(`${plane.url}/data-plane`)).status).toBe(200);
      expect((await fetch(`${plane.url}/dashboard`)).status).toBe(404);
    } finally {
      await plane.close();
    }
  });
});

import { lstatSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_SCHEMA_VERSION,
  hostedCapabilitiesForAuthority,
  LOCAL_CAPABILITIES,
  type CompactSyncBatch,
  type ServerEntitlement,
  type SessionEvent,
} from "@seorak/types";
import {
  acknowledgeLocalEventMirror,
  buildCompactSyncBatch,
  drainManagedCompactSync,
} from "../src/compact-sync.ts";
import { appendLocalEvent, localHistoryCounts } from "../src/local-store.ts";
import {
  buildLocalSyncCandidate,
  readLocalManagedSyncState,
} from "../src/local-sync-store.ts";
import { localArchiveKeyPath } from "../src/paths.ts";

function directory(): string {
  return mkdtempSync(join(tmpdir(), "seorak-compact-sync-"));
}

function event(kind: "start" | "end"): SessionEvent {
  return kind === "start"
    ? {
        kind: "session.start",
        eventId: "event-start",
        sessionId: "session-1",
        at: "2026-08-01T12:00:00.000Z",
        repoId: "a".repeat(64),
        repoLabel: "seorak",
        agent: "codex",
        agentVersion: "1.0.0",
      }
    : {
        kind: "session.end",
        eventId: "event-end",
        sessionId: "session-1",
        at: "2026-08-01T12:02:00.000Z",
        reason: "other",
      };
}

const TEST_NOW_MS = Date.now() + 60 * 60 * 1000;

function entitlement(plan: "free" | "pro"): ServerEntitlement {
  return {
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    authority: "server",
    subject: { kind: "personal", id: "owner-1" },
    plan,
    state: "active",
    revision: 1,
    issuedAt: new Date(TEST_NOW_MS).toISOString(),
    refreshAfter: new Date(TEST_NOW_MS + 6 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(TEST_NOW_MS + 24 * 60 * 60 * 1000).toISOString(),
    local: { ...LOCAL_CAPABILITIES },
    hosted: hostedCapabilitiesForAuthority(plan, "active"),
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const health = {
  ok: true,
  compactSync: {
    currentProtocolVersion: 1,
    acceptedProtocolVersions: [1],
    limits: {
      batchBytes: 2 * 1024 * 1024,
      sessionsPerBatch: 64,
      hoursPerBatch: 24,
      archivesPerBatch: 8,
      transitionsPerBatch: 64,
      archiveCiphertextBytes: 1024 * 1024,
      modelsPerSession: 16,
      idCharacters: 256,
      labelCharacters: 255,
    },
  },
};

/** A managed plane with nothing outstanding: entitled, no window, no rebaseline. */
const dataPlane = {
  schemaVersion: 1,
  descriptor: {
    protocolVersion: 1,
    authority: "remote",
    operator: "seorak-managed",
    surfaces: ["live", "overview", "sessions"],
    credentialRequired: true,
  },
  coverage: null,
  lifecycle: null,
  rebaseline: {
    schemaVersion: 1,
    required: false,
    baselineEpoch: 0,
    reason: null,
    managedCopyEmptySince: null,
    issuedAt: "2026-08-01T12:00:00.000Z",
  },
};

describe("collector compact sync", () => {
  it("keeps legacy delivery available only before compact activation", async () => {
    const dir = directory();
    const result = await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect(result).toEqual({ kind: "legacy" });
  });

  it("reads its entitlement with the READ key, not the ingest key", async () => {
    // A hosted worker sets a read key distinct from its ingest key, and gates
    // /entitlements on the read guard. Sending the ingest key there 401s, and
    // the swallowed failure used to resolve an entitled Pro install as
    // unentitled — which routes it into the downgraded branch, where the daemon
    // acknowledges the local mirror and the shipping cursor runs to the end of
    // the log with nothing posted. Silent, total delivery loss from one header.
    const dir = directory();
    const seen: Array<string | null> = [];
    const result = await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      ingestKey: "ingest-token",
      readKey: "read-token",
      directory: dir,
      nowMs: TEST_NOW_MS,
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === "/sync/health") return json(health);
        if (path === "/entitlements") {
          const authorization = new Headers(init?.headers).get("authorization");
          seen.push(authorization);
          return authorization === "Bearer read-token"
            ? json(entitlement("pro"))
            : json({ error: "unauthorized" }, 401);
        }
        return json(null, 500);
      },
    });

    expect(seen).toEqual(["Bearer read-token"]);
    // The grant was accepted and parsed, so the install reads as entitled
    // rather than resolving against the null grant a 401 leaves behind. Caching
    // it is the observable proof: the downgraded path never gets this far.
    const cached = readLocalManagedSyncState(dir).cachedEntitlementJson;
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toMatchObject({
      plan: "pro",
      hosted: { managedSync: true },
    });
    expect(result.kind).toBe("handled");
  });

  it("falls back to the ingest key when no read key is configured", async () => {
    // The one-token model: SEORAK_READ_KEY unset means reads authenticate with
    // the ingest key, so a single-token install must keep working unchanged.
    const dir = directory();
    const seen: Array<string | null> = [];
    await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      ingestKey: "ingest-token",
      directory: dir,
      nowMs: TEST_NOW_MS,
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === "/sync/health") return json(health);
        if (path === "/entitlements") {
          seen.push(new Headers(init?.headers).get("authorization"));
          return json(entitlement("free"));
        }
        return json(null, 500);
      },
    });

    expect(seen).toEqual(["Bearer ingest-token"]);
  });

  it("keeps complete local work Free and never posts it to hosted storage", async () => {
    const dir = directory();
    appendLocalEvent(event("start"), dir);
    let posts = 0;
    const result = await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: TEST_NOW_MS,
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === "/sync/health") return json(health);
        if (path === "/entitlements") return json(entitlement("free"));
        if (init?.method === "POST") posts += 1;
        return json(null, 500);
      },
    });
    expect(result).toMatchObject({ kind: "handled", result: { blocked: false } });
    expect(posts).toBe(0);
    expect(localHistoryCounts(dir)).toMatchObject({ events: 1, pendingSessions: 1 });
  });

  it("uses a fresh Free grant without scheduled hosted requests", async () => {
    const dir = directory();
    let requests = 0;
    const fetchImpl: typeof fetch = async (url) => {
      requests += 1;
      const path = new URL(String(url)).pathname;
      return path === "/sync/health"
        ? json(health)
        : json(entitlement("free"));
    };
    const options = {
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: TEST_NOW_MS,
      fetchImpl,
    };
    await drainManagedCompactSync(options);
    expect(requests).toBe(2);
    await drainManagedCompactSync(options);
    expect(requests).toBe(2);
  });

  it("encrypts archives locally and advances only on a matching receipt", async () => {
    const dir = directory();
    appendLocalEvent(event("start"), dir);
    appendLocalEvent(event("end"), dir);
    let uploaded: CompactSyncBatch | null = null;
    const result = await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: TEST_NOW_MS,
      fetchImpl: async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === "/sync/health") return json(health);
        if (path === "/entitlements") return json(entitlement("pro"));
        uploaded = JSON.parse(String(init?.body)) as CompactSyncBatch;
        return json({
          protocolVersion: 1,
          accepted: true,
          installationId: uploaded.installationId,
          sequence: uploaded.sequence,
          batchId: uploaded.batchId,
          batchSha256: uploaded.batchSha256,
          receivedAt: "2026-08-01T12:05:01.000Z",
          entitlementRevision: 1,
        });
      },
    });
    expect(result).toMatchObject({ kind: "handled", result: { blocked: false, acceptedChunks: 1 } });
    expect(uploaded).not.toBeNull();
    expect(uploaded!.archives).toHaveLength(1);
    expect(Buffer.from(uploaded!.archives[0]!.ciphertextBase64, "base64").toString("utf8")).not.toContain("session.start");
    expect(lstatSync(localArchiveKeyPath(dir)).mode & 0o777).toBe(0o600);
    expect(readLocalManagedSyncState(dir)).toMatchObject({
      mode: "compact-v1",
      nextSequence: 2,
      pendingBatchJson: null,
    });
    expect(localHistoryCounts(dir)).toMatchObject({ events: 2, pendingSessions: 0 });
  });

  it("retries the exact persisted ciphertext and never falls back after activation", async () => {
    const dir = directory();
    appendLocalEvent(event("start"), dir);
    appendLocalEvent(event("end"), dir);
    const bodies: string[] = [];
    let accept = false;
    const fetchImpl: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/sync/health") return json(health);
      if (path === "/entitlements") return json(entitlement("pro"));
      if (path === "/sync/v1/data-plane") return json(dataPlane);
      const body = String(init?.body);
      bodies.push(body);
      if (!accept) return json({ error: "compact sync rejected", code: "sync_unavailable" }, 503);
      const uploaded = JSON.parse(body) as CompactSyncBatch;
      return json({
        protocolVersion: 1,
        accepted: true,
        installationId: uploaded.installationId,
        sequence: uploaded.sequence,
        batchId: uploaded.batchId,
        batchSha256: uploaded.batchSha256,
        receivedAt: "2026-08-01T12:05:01.000Z",
        entitlementRevision: 1,
      });
    };
    const options = {
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: TEST_NOW_MS,
      fetchImpl,
    };
    expect(await drainManagedCompactSync(options)).toMatchObject({
      kind: "handled",
      result: { blocked: true, retriable: true },
    });
    accept = true;
    expect(await drainManagedCompactSync(options)).toMatchObject({
      kind: "handled",
      result: { blocked: false },
    });
    expect(bodies[1]).toBe(bodies[0]);

    const offline = await drainManagedCompactSync({
      ...options,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect(offline).toMatchObject({
      kind: "handled",
      result: { blocked: true, retriable: true },
    });
  });

  it("builds a contract-valid aggregate without exposing plaintext or owner selectors", () => {
    const dir = directory();
    appendLocalEvent(event("start"), dir);
    appendLocalEvent(event("end"), dir);
    const candidate = buildLocalSyncCandidate({
      directory: dir,
      nowMs: TEST_NOW_MS,
    })!;
    const batch = buildCompactSyncBatch(candidate, {
      installationId: "install-1",
      sequence: 1,
      previousBatchSha256: null,
      createdAt: "2026-08-01T12:05:00.000Z",
      directory: dir,
    });
    expect(JSON.stringify(batch)).not.toMatch(/ownerId|memberId|workspaceId/);
    expect(batch.hours).toEqual([
      expect.objectContaining({ sessionsStarted: 1, sessionsEnded: 1 }),
    ]);
  });

  it("acknowledges only the compatibility mirror while SQLite remains permanent", async () => {
    const dir = directory();
    appendLocalEvent(event("start"), dir);
    const raw = `${JSON.stringify(event("start"))}\n`;
    writeFileSync(join(dir, "events.jsonl"), raw, "utf8");
    await acknowledgeLocalEventMirror(dir);
    expect(JSON.parse(readFileSync(join(dir, "events.offset"), "utf8"))).toEqual({
      version: 1,
      generation: 0,
      offset: Buffer.byteLength(raw),
    });
    expect(localHistoryCounts(dir).events).toBe(1);
  });
});

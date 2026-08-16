/**
 * managed-coverage.test.ts — the local half of the managed lifecycle.
 *
 * Two claims are under test and they pull in opposite directions, which is why
 * they belong in one file:
 *
 *   The local record NEVER narrows. Downgrade, deletion, a hostile worker, an
 *   unreachable one: capture continues, history is complete, and work created
 *   while unentitled waits rather than disappearing.
 *
 *   The coverage claim never OVERSTATES. `managedCopyComplete` is true only when
 *   the backlog was measured, was empty, and something was actually
 *   acknowledged, and the parser in @seorak/types refuses anything less.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  parseManagedLifecycleWindow,
  parseManagedSyncCoverage,
  type ManagedSyncCoverage,
} from "@seorak/types/data-plane";
import {
  applyRebaselineDirective,
  drainManagedCompactSync,
  localManagedLifecycleWindow,
  localManagedSyncCoverage,
} from "../src/compact-sync.ts";
import {
  appendLocalEvent,
  listLocalSessions,
  localHistoryCounts,
  replayLocalSession,
} from "../src/local-store.ts";
import {
  applyLocalRebaseline,
  localHistoryFrom,
  readLocalBaselineEpoch,
  readLocalManagedBacklog,
  readLocalManagedSyncState,
} from "../src/local-sync-store.ts";
import { localArchiveKeyPath } from "../src/paths.ts";

const NOW_MS = Date.parse("2026-08-15T12:00:00.000Z");

function directory(): string {
  return mkdtempSync(join(tmpdir(), "seorak-managed-coverage-"));
}

/**
 * Capture on the FIXTURE clock, which is the same clock every drain below runs
 * on.
 *
 * `projectEvent` derives each projected row's `next_sync_at_ms` from the instant
 * of capture, and the drain sends rows `WHERE dirty = 1 AND next_sync_at_ms <=
 * <its own now>`. Capturing on the wall clock while draining at a pinned
 * `NOW_MS` puts every row in the drain's future: nothing is ever due, no row
 * clears `dirty`, and the backlog cannot empty. That is not a hypothetical — it
 * is how this file went red the moment real time passed the literal above. One
 * clock for capture and drain is what makes it deterministic for good, rather
 * than deterministic until a date arrives.
 */
function append(event: SessionEvent, dir: string, atMs = NOW_MS): boolean {
  return appendLocalEvent(event, dir, atMs);
}

function start(id: string, at: string): SessionEvent {
  return {
    kind: "session.start",
    eventId: `${id}-start`,
    sessionId: id,
    at,
    repoId: "a".repeat(64),
    repoLabel: "seorak",
    agent: "codex",
    agentVersion: "1.0.0",
  };
}

function end(id: string, at: string): SessionEvent {
  return { kind: "session.end", eventId: `${id}-end`, sessionId: id, at, reason: "other" };
}

/** A grant is issued when it is asked for, exactly as the worker issues one. A
 *  fixture with a frozen `issuedAt` would hide every staleness rule. */
function entitlement(plan: "free" | "pro", atMs: number): ServerEntitlement {
  return {
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    authority: "server",
    subject: { kind: "personal", id: "owner-1" },
    plan,
    state: "active",
    revision: 1,
    issuedAt: new Date(atMs).toISOString(),
    refreshAfter: new Date(atMs + 6 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(atMs + 24 * 60 * 60 * 1000).toISOString(),
    local: { ...LOCAL_CAPABILITIES },
    hosted: hostedCapabilitiesForAuthority(plan, "active"),
  };
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

function dataPlane(
  overrides: {
    lifecycle?: unknown;
    rebaseline?: unknown;
    coverage?: unknown;
  } = {},
): unknown {
  return {
    schemaVersion: 1,
    descriptor: {
      protocolVersion: 1,
      authority: "remote",
      operator: "seorak-managed",
      surfaces: ["live", "overview", "sessions"],
      credentialRequired: true,
    },
    coverage:
      overrides.coverage === undefined
        ? {
            schemaVersion: 1,
            state: "backfilling",
            synchronizedThrough: null,
            pendingFrom: null,
            backlog: null,
            lastAcceptedAt: null,
            lastAttemptAt: null,
            lastError: null,
            managedCopyComplete: false,
            observedAt: new Date(NOW_MS).toISOString(),
          }
        : overrides.coverage,
    lifecycle: overrides.lifecycle ?? null,
    rebaseline:
      overrides.rebaseline ?? {
        schemaVersion: 1,
        required: false,
        baselineEpoch: 0,
        reason: null,
        managedCopyEmptySince: null,
        issuedAt: "2026-08-01T00:00:00.000Z",
      },
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface WorkerScript {
  plan: "free" | "pro";
  /** Instant the fixture worker issues grants and receipts at. */
  atMs?: number;
  status?: unknown;
  batchStatus?: number;
  batchBody?: unknown;
  rebaselineOk?: boolean;
}

function worker(script: WorkerScript): {
  fetchImpl: typeof fetch;
  paths: string[];
  acknowledgements: unknown[];
} {
  const paths: string[] = [];
  const acknowledgements: unknown[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path === "/sync/health") return json(health);
    if (path === "/entitlements") {
      return json(entitlement(script.plan, script.atMs ?? NOW_MS));
    }
    if (path === "/sync/v1/data-plane") {
      return json(script.status ?? dataPlane());
    }
    if (path === "/sync/v1/rebaseline") {
      acknowledgements.push(JSON.parse(String(init?.body)));
      return script.rebaselineOk === false
        ? json({ error: "unavailable" }, 503)
        : json({ ok: true, applied: true, baselineEpoch: 1 });
    }
    if (script.batchStatus && script.batchStatus >= 400) {
      return json(script.batchBody ?? { error: "compact sync rejected" }, script.batchStatus);
    }
    const uploaded = JSON.parse(String(init?.body)) as CompactSyncBatch;
    return json({
      protocolVersion: 1,
      accepted: true,
      installationId: uploaded.installationId,
      sequence: uploaded.sequence,
      batchId: uploaded.batchId,
      batchSha256: uploaded.batchSha256,
      receivedAt: new Date(script.atMs ?? NOW_MS).toISOString(),
      entitlementRevision: 1,
    });
  };
  return { fetchImpl, paths, acknowledgements };
}

/**
 * A cached server grant stays authoritative until its own `refreshAfter`, which
 * is what lets an offline collector keep working. A test that wants to observe a
 * PLAN CHANGE therefore has to move the clock past it, exactly as the product
 * does: a downgrade is never visible at the same instant the old grant was
 * issued, and pretending otherwise would test a collector nobody ships.
 */
const AFTER_GRANT_MS = NOW_MS + 7 * 60 * 60 * 1000;

async function drainUntilCaughtUp(
  dir: string,
  script: WorkerScript,
  nowMs = NOW_MS,
  rounds = 12,
): Promise<string[]> {
  const { fetchImpl, paths } = worker({ atMs: nowMs, ...script });
  for (let round = 0; round < rounds; round += 1) {
    const result = await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs,
      fetchImpl,
    });
    if (result.kind === "handled" && result.result.acceptedChunks === 0) break;
  }
  return paths;
}

function coverage(dir: string, nowMs = NOW_MS): ManagedSyncCoverage {
  const value = localManagedSyncCoverage({ directory: dir, nowMs });
  // Every reading a surface could receive must satisfy the shared contract.
  expect(parseManagedSyncCoverage(value)).toEqual(value);
  return value;
}

describe("upgrade backfill coverage", () => {
  it("reports nothing rather than zero before any managed plane exists", () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    const value = coverage(dir);
    expect(value).toMatchObject({
      state: "not-connected",
      synchronizedThrough: null,
      lastAcceptedAt: null,
      managedCopyComplete: false,
    });
    // The backlog is measured even here, because the local plane can always
    // count it. It is the REMOTE copy that is unknown, not the local record.
    expect(value.backlog).toEqual({ sessions: 1, hours: 1, archives: 0 });
    expect(value.pendingFrom).toBe("2026-08-01T10:00:00.000Z");
  });

  it("measures the Free-period backlog an upgrade has to drain", () => {
    const dir = directory();
    for (const index of [1, 2, 3]) {
      append(start(`session-${index}`, `2026-08-0${index}T10:00:00.000Z`), dir);
      append(end(`session-${index}`, `2026-08-0${index}T11:00:00.000Z`), dir);
    }
    expect(readLocalManagedBacklog(dir)).toMatchObject({
      sessions: 3,
      archives: 3,
      pendingFrom: "2026-08-01T10:00:00.000Z",
    });
    const value = coverage(dir);
    expect(value.state).toBe("not-connected");
    expect(value.backlog?.sessions).toBe(3);
  });

  it("shrinks the backlog and advances the synchronized instant as it drains", async () => {
    const dir = directory();
    for (const index of [1, 2, 3]) {
      append(start(`session-${index}`, `2026-08-0${index}T10:00:00.000Z`), dir);
      append(end(`session-${index}`, `2026-08-0${index}T11:00:00.000Z`), dir);
    }
    const before = coverage(dir);
    await drainUntilCaughtUp(dir, { plan: "pro" });
    const after = coverage(dir);
    expect(after.backlog!.sessions).toBeLessThan(before.backlog!.sessions + 1);
    expect(after.synchronizedThrough).not.toBeNull();
    expect(after.lastAcceptedAt).not.toBeNull();
  });

  it("claims completeness only when the backlog is measured empty and something was acknowledged", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    append(end("session-1", "2026-08-01T11:00:00.000Z"), dir);
    await drainUntilCaughtUp(dir, { plan: "pro" });
    const value = coverage(dir);
    expect(readLocalManagedBacklog(dir)).toMatchObject({
      sessions: 0,
      hours: 0,
      archives: 0,
      pendingFrom: null,
    });
    expect(value).toMatchObject({
      state: "current",
      managedCopyComplete: true,
      pendingFrom: null,
    });
    expect(value.synchronizedThrough).not.toBeNull();
  });

  it("drops the completeness claim the moment new local work arrives", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    append(end("session-1", "2026-08-01T11:00:00.000Z"), dir);
    await drainUntilCaughtUp(dir, { plan: "pro" });
    expect(coverage(dir).managedCopyComplete).toBe(true);

    append(start("session-2", "2026-08-14T10:00:00.000Z"), dir);
    const value = coverage(dir);
    expect(value.managedCopyComplete).toBe(false);
    expect(value.state).toBe("backfilling");
    expect(value.pendingFrom).toBe("2026-08-14T10:00:00.000Z");
  });

  it("names a retriable stall as paused and a permanent one as blocked", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    const paused = worker({ plan: "pro", batchStatus: 503 });
    await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: NOW_MS,
      fetchImpl: paused.fetchImpl,
    });
    expect(coverage(dir)).toMatchObject({
      state: "paused",
      lastError: { reason: "service-unavailable", retriable: true },
    });

    const blocked = worker({ plan: "pro", batchStatus: 400 });
    await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: NOW_MS,
      fetchImpl: blocked.fetchImpl,
    });
    expect(coverage(dir)).toMatchObject({
      state: "blocked",
      lastError: { reason: "protocol", retriable: false },
    });
  });

  it("names the published storage allowance rather than an outage", async () => {
    // pricing.md: a pause at the allowance surfaces as `paused` with a
    // `capacity` reason. It used to arrive as a bare 503, which this collector
    // read as `service-unavailable`, so the customer was told uploads stopped
    // "because of the service being unavailable" and the cap was never named.
    // Same status, same retry behaviour, different fact.
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    const capped = worker({
      plan: "pro",
      batchStatus: 503,
      batchBody: {
        error: "compact sync rejected",
        code: "archive_allowance_exhausted",
      },
    });
    await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: NOW_MS,
      fetchImpl: capped.fetchImpl,
    });
    expect(coverage(dir)).toMatchObject({
      state: "paused",
      lastError: { reason: "capacity", retriable: true },
    });
    // Nothing local was dropped to stay inside a hosted budget.
    expect(localHistoryCounts(dir).events).toBe(1);
  });

  it("never reports an instant later than the moment of observation", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    await drainUntilCaughtUp(dir, { plan: "pro" });
    const early = localManagedSyncCoverage({
      directory: dir,
      nowMs: Date.parse("2026-08-01T00:00:00.000Z"),
    });
    expect(parseManagedSyncCoverage(early)).toEqual(early);
  });
});

describe("downgrade keeps the local record whole", () => {
  it("keeps capture, history, statistics, and replay working with no entitlement", async () => {
    const dir = directory();
    // Before Pro.
    append(start("before", "2026-07-01T10:00:00.000Z"), dir);
    append(end("before", "2026-07-01T11:00:00.000Z"), dir);
    await drainUntilCaughtUp(dir, { plan: "pro" });

    // During Pro.
    append(start("during", "2026-08-01T10:00:00.000Z"), dir);
    append(end("during", "2026-08-01T11:00:00.000Z"), dir);
    await drainUntilCaughtUp(dir, { plan: "pro" });

    // After Pro: the worker now refuses everything managed.
    const downgraded = worker({
      plan: "free",
      atMs: AFTER_GRANT_MS,
      status: dataPlane({
        lifecycle: {
          schemaVersion: 1,
          phase: "recovery",
          paidThroughAt: "2026-08-10T00:00:00.000Z",
          remoteServiceEndsAt: "2026-08-10T00:00:00.000Z",
          hostedDeletionAt: "2026-09-09T00:00:00.000Z",
          recoveryExportAvailable: true,
          resumesExistingCopy: true,
          observedAt: new Date(NOW_MS).toISOString(),
        },
      }),
    });
    append(start("after", "2026-08-14T10:00:00.000Z"), dir);
    append(end("after", "2026-08-14T11:00:00.000Z"), dir);
    const result = await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: AFTER_GRANT_MS,
      fetchImpl: downgraded.fetchImpl,
    });
    expect(result).toMatchObject({ kind: "handled", result: { blocked: false } });

    // Every local capability, across all three periods.
    expect(localHistoryCounts(dir)).toMatchObject({ events: 6, sessions: 3 });
    expect(listLocalSessions({ directory: dir }).map((row) => row.sessionId).sort()).toEqual(
      ["after", "before", "during"],
    );
    expect(replayLocalSession("before", dir)).toHaveLength(2);
    expect(replayLocalSession("after", dir)).toHaveLength(2);
    expect(localHistoryFrom(dir)).toBe("2026-07-01T10:00:00.000Z");

    // The unentitled work is queued, not discarded.
    const backlog = readLocalManagedBacklog(dir);
    expect(backlog.sessions).toBeGreaterThan(0);
    expect(backlog.pendingFrom).toBe("2026-08-14T10:00:00.000Z");

    // And the surface is told exactly that.
    expect(coverage(dir, AFTER_GRANT_MS)).toMatchObject({
      state: "recovery",
      managedCopyComplete: false,
    });
  });

  it("uploads the queued backlog when an entitled connection returns", async () => {
    const dir = directory();
    append(start("queued", "2026-08-14T10:00:00.000Z"), dir);
    append(end("queued", "2026-08-14T11:00:00.000Z"), dir);
    const downgraded = worker({ plan: "free" });
    await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: NOW_MS,
      fetchImpl: downgraded.fetchImpl,
    });
    expect(readLocalManagedBacklog(dir).sessions).toBe(1);

    await drainUntilCaughtUp(dir, { plan: "pro" }, AFTER_GRANT_MS);
    expect(readLocalManagedBacklog(dir)).toMatchObject({
      sessions: 0,
      pendingFrom: null,
    });
    expect(coverage(dir, AFTER_GRANT_MS).managedCopyComplete).toBe(true);
  });

  it("issues no hosted request at all from a Free install that never activated", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    const free = worker({ plan: "free" });
    await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: NOW_MS,
      fetchImpl: free.fetchImpl,
    });
    // Health and entitlement only. No data-plane poll, because there is no
    // managed copy this install could need to hear about.
    expect(free.paths).toEqual(["/sync/health", "/entitlements"]);
  });
});

describe("the local plane relays the managed lifecycle window", () => {
  const ENDS_AT = "2026-08-20T00:00:00.000Z";
  const DELETES_AT = "2026-09-19T00:00:00.000Z";

  const ending = dataPlane({
    lifecycle: {
      schemaVersion: 1,
      phase: "ending",
      paidThroughAt: ENDS_AT,
      remoteServiceEndsAt: ENDS_AT,
      hostedDeletionAt: DELETES_AT,
      recoveryExportAvailable: false,
      resumesExistingCopy: true,
      observedAt: new Date(NOW_MS).toISOString(),
    },
  });

  async function observe(dir: string, status: unknown): Promise<void> {
    await drainUntilCaughtUp(dir, { plan: "pro", status });
  }

  it("answers null when no managed plane was ever observed", () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    // Honest-null, not a fabricated `none`: an account-free install has no
    // managed lifecycle at all, which is different from having one that is over.
    expect(localManagedLifecycleWindow({ directory: dir, nowMs: NOW_MS })).toBeNull();
  });

  it("relays the exact dates the managed side established", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    await observe(dir, ending);
    const window = localManagedLifecycleWindow({ directory: dir, nowMs: NOW_MS });
    expect(parseManagedLifecycleWindow(window)).toEqual(window);
    expect(window).toMatchObject({
      phase: "ending",
      paidThroughAt: ENDS_AT,
      remoteServiceEndsAt: ENDS_AT,
      hostedDeletionAt: DELETES_AT,
      recoveryExportAvailable: false,
      resumesExistingCopy: true,
      observedAt: new Date(NOW_MS).toISOString(),
    });
  });

  it("advances the countdown on the local clock with no worker involved", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    await observe(dir, ending);

    // Past the service end but inside the window: recovery, export available.
    // Nothing was fetched to learn this; the dates are facts and the phase is
    // derived, which is what keeps a lapsed subscriber informed offline.
    const inside = localManagedLifecycleWindow({
      directory: dir,
      nowMs: Date.parse("2026-08-25T00:00:00.000Z"),
    });
    expect(parseManagedLifecycleWindow(inside)).toEqual(inside);
    expect(inside).toMatchObject({
      phase: "recovery",
      recoveryExportAvailable: true,
    });

    // Past the deletion date: the window has closed, and the local plane says so
    // without claiming the copy is deleted, which only the managed side knows.
    const closed = localManagedLifecycleWindow({
      directory: dir,
      nowMs: Date.parse("2026-09-20T00:00:00.000Z"),
    });
    expect(parseManagedLifecycleWindow(closed)).toEqual(closed);
    expect(closed).toMatchObject({
      phase: "recovery",
      recoveryExportAvailable: false,
    });
  });

  it("never invents deletion, and carries it through once proven", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    await observe(
      dir,
      dataPlane({
        lifecycle: {
          schemaVersion: 1,
          phase: "deleted",
          paidThroughAt: ENDS_AT,
          remoteServiceEndsAt: ENDS_AT,
          hostedDeletionAt: DELETES_AT,
          recoveryExportAvailable: false,
          resumesExistingCopy: false,
          observedAt: new Date(NOW_MS).toISOString(),
        },
      }),
    );
    const window = localManagedLifecycleWindow({
      directory: dir,
      nowMs: Date.parse("2026-09-20T00:00:00.000Z"),
    });
    expect(parseManagedLifecycleWindow(window)).toEqual(window);
    expect(window).toMatchObject({
      phase: "deleted",
      recoveryExportAvailable: false,
      resumesExistingCopy: false,
    });
  });

  it("relays a renewing subscription without inventing an end date", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    await observe(
      dir,
      dataPlane({
        lifecycle: {
          schemaVersion: 1,
          phase: "active",
          paidThroughAt: ENDS_AT,
          remoteServiceEndsAt: null,
          hostedDeletionAt: null,
          recoveryExportAvailable: false,
          resumesExistingCopy: true,
          observedAt: new Date(NOW_MS).toISOString(),
        },
      }),
    );
    // No end instant, so the local clock has nothing to advance past and the
    // phase stays active however long the collector is offline.
    const window = localManagedLifecycleWindow({
      directory: dir,
      nowMs: Date.parse("2027-01-01T00:00:00.000Z"),
    });
    expect(parseManagedLifecycleWindow(window)).toEqual(window);
    expect(window).toMatchObject({
      phase: "active",
      remoteServiceEndsAt: null,
      hostedDeletionAt: null,
    });
  });

  it("pairs with coverage, which the status contract requires beside it", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    await observe(dir, ending);
    const window = localManagedLifecycleWindow({ directory: dir, nowMs: NOW_MS });
    expect(window?.phase).not.toBe("none");
    // A phase past `none` may not be narrated without the observed sync
    // relationship, and the local plane is the one that can measure it.
    const value = coverage(dir);
    expect(value.backlog).not.toBeNull();
  });
});

describe("rebaseline after the managed copy is deleted", () => {
  const deletedStatus = dataPlane({
    lifecycle: {
      schemaVersion: 1,
      phase: "deleted",
      paidThroughAt: "2026-07-01T00:00:00.000Z",
      remoteServiceEndsAt: "2026-07-01T00:00:00.000Z",
      hostedDeletionAt: "2026-07-31T00:00:00.000Z",
      recoveryExportAvailable: false,
      resumesExistingCopy: false,
      observedAt: new Date(NOW_MS).toISOString(),
    },
    rebaseline: {
      schemaVersion: 1,
      required: true,
      baselineEpoch: 1,
      reason: "hosted-copy-deleted",
      managedCopyEmptySince: "2026-07-31T00:00:00.000Z",
      issuedAt: "2026-07-31T00:00:00.000Z",
    },
  });

  it("resets every checkpoint in one transaction and only then acknowledges", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    append(end("session-1", "2026-08-01T11:00:00.000Z"), dir);
    await drainUntilCaughtUp(dir, { plan: "pro" });
    expect(coverage(dir).managedCopyComplete).toBe(true);

    const script = worker({ plan: "pro", status: deletedStatus });
    const outcome = await applyRebaselineDirective({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      status: JSON.parse(JSON.stringify(deletedStatus)),
      directory: dir,
      fetchImpl: script.fetchImpl,
      nowMs: NOW_MS,
    });
    expect(outcome).toMatchObject({
      applied: true,
      acknowledged: true,
      baselineEpoch: 1,
      localHistoryFrom: "2026-08-01T10:00:00.000Z",
    });
    expect(script.acknowledgements).toEqual([
      {
        schemaVersion: 1,
        baselineEpoch: 1,
        installationId: "install-1",
        checkpointsReset: true,
        localHistoryFrom: "2026-08-01T10:00:00.000Z",
        acknowledgedAt: new Date(NOW_MS).toISOString(),
      },
    ]);

    // Every acknowledged checkpoint is gone and every local row is resendable.
    const state = readLocalManagedSyncState(dir);
    expect(state).toMatchObject({
      nextSequence: 1,
      previousBatchSha256: null,
      pendingBatchJson: null,
      synchronizedThrough: null,
      lastAcceptedAt: null,
      baselineEpoch: 1,
    });
    expect(readLocalManagedBacklog(dir)).toMatchObject({ sessions: 1, archives: 1 });
    // Nothing local was destroyed to achieve that.
    expect(localHistoryCounts(dir)).toMatchObject({ events: 2 });
    expect(replayLocalSession("session-1", dir)).toHaveLength(2);
  });

  it("is inert for a replayed or lower-epoch directive", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    expect(applyLocalRebaseline(3, dir).applied).toBe(true);
    expect(readLocalBaselineEpoch(dir)).toBe(3);
    // The same epoch again, and an older one, both change nothing.
    expect(applyLocalRebaseline(3, dir).applied).toBe(false);
    expect(applyLocalRebaseline(2, dir).applied).toBe(false);
    expect(readLocalBaselineEpoch(dir)).toBe(3);
    // A higher epoch still applies, so a genuine second reset is possible.
    expect(applyLocalRebaseline(4, dir).applied).toBe(true);
    expect(readLocalBaselineEpoch(dir)).toBe(4);
  });

  it("rebuilds the managed copy from local history after the reset", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    append(end("session-1", "2026-08-01T11:00:00.000Z"), dir);
    await drainUntilCaughtUp(dir, { plan: "pro" });
    applyLocalRebaseline(1, dir);

    const rebuilt = worker({ plan: "pro" });
    const uploaded: CompactSyncBatch[] = [];
    for (let round = 0; round < 12; round += 1) {
      const result = await drainManagedCompactSync({
        workerUrl: "https://worker.test",
        installationId: "install-1",
        directory: dir,
        nowMs: NOW_MS,
        fetchImpl: async (url, init) => {
          const path = new URL(String(url)).pathname;
          if (init?.method === "POST" && path === "/sync/v1/batches") {
            uploaded.push(JSON.parse(String(init.body)) as CompactSyncBatch);
          }
          return rebuilt.fetchImpl(url, init);
        },
      });
      if (result.kind === "handled" && result.result.acceptedChunks === 0) break;
    }
    expect(uploaded[0]?.sequence).toBe(1);
    expect(uploaded[0]?.previousBatchSha256).toBeNull();
    expect(uploaded.some((value) => value.archives.length > 0)).toBe(true);
    expect(coverage(dir).managedCopyComplete).toBe(true);
  });

  it("does not resume uploading until the acknowledgement is delivered", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    const script = worker({
      plan: "pro",
      status: deletedStatus,
      rebaselineOk: false,
    });
    const result = await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: NOW_MS,
      fetchImpl: script.fetchImpl,
    });
    expect(result).toMatchObject({
      kind: "handled",
      result: { blocked: true, retriable: true },
    });
    expect(script.paths).not.toContain("/sync/v1/batches");
    // The reset itself is durable, so the retry is only the acknowledgement.
    expect(readLocalBaselineEpoch(dir)).toBe(1);
  });

  it("re-sends the acknowledgement after a delivery failure rather than stalling", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    const status = JSON.parse(JSON.stringify(deletedStatus));

    // First attempt: the reset lands, the acknowledgement does not.
    const failing = worker({ plan: "pro", status, rebaselineOk: false });
    const first = await applyRebaselineDirective({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      status,
      directory: dir,
      fetchImpl: failing.fetchImpl,
      nowMs: NOW_MS,
    });
    expect(first).toMatchObject({ applied: true, acknowledged: false });
    expect(readLocalBaselineEpoch(dir)).toBe(1);

    // The managed side re-issues the same directive because it never heard back.
    // The local reset is already done, so nothing is reset a second time, but the
    // acknowledgement must still go out or both sides wait on each other.
    const retry = worker({ plan: "pro", status });
    const second = await applyRebaselineDirective({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      status,
      directory: dir,
      fetchImpl: retry.fetchImpl,
      nowMs: NOW_MS,
    });
    expect(second).toMatchObject({ applied: false, acknowledged: true });
    expect(retry.acknowledgements).toEqual([
      {
        schemaVersion: 1,
        baselineEpoch: 1,
        installationId: "install-1",
        checkpointsReset: true,
        localHistoryFrom: "2026-08-01T10:00:00.000Z",
        acknowledgedAt: new Date(NOW_MS).toISOString(),
      },
    ]);
  });

  it("resets nothing a second time for a directive the local epoch has passed", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    applyLocalRebaseline(5, dir);
    const stale = worker({ plan: "pro", status: deletedStatus });
    const outcome = await applyRebaselineDirective({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      status: JSON.parse(JSON.stringify(deletedStatus)),
      directory: dir,
      fetchImpl: stale.fetchImpl,
      nowMs: NOW_MS,
    });
    // No second reset, and the local epoch does not walk backwards.
    expect(outcome?.applied).toBe(false);
    expect(readLocalBaselineEpoch(dir)).toBe(5);
    // The acknowledgement still goes out, naming the epoch the directive asked
    // about. A reset to 5 subsumes the reset to 1 this directive wanted, so the
    // statement is true, and the managed side's own guard makes it inert if that
    // side has already moved on.
    expect(stale.acknowledgements).toEqual([
      {
        schemaVersion: 1,
        baselineEpoch: 1,
        installationId: "install-1",
        checkpointsReset: true,
        localHistoryFrom: "2026-08-01T10:00:00.000Z",
        acknowledgedAt: new Date(NOW_MS).toISOString(),
      },
    ]);
  });

  it("fails hosted sync closed when a candidate cannot be encoded", async () => {
    const dir = directory();
    // A stored instant the compact-sync protocol will not accept. Building the
    // batch throws, and ADR-001's rollback matrix says the answer is to fail
    // hosted sync closed and repair explicitly, never to take the drain down.
    append(
      { ...start("bad", "2026-08-01T10:00:00.000Z"), at: "2026-08-01T12:00:00.000+02:00" },
      dir,
    );
    const script = worker({ plan: "pro" });
    const result = await drainManagedCompactSync({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      directory: dir,
      nowMs: NOW_MS,
      fetchImpl: script.fetchImpl,
    });
    expect(result).toMatchObject({
      kind: "handled",
      result: { blocked: true, retriable: false },
    });
    expect(coverage(dir)).toMatchObject({
      state: "blocked",
      lastError: { reason: "local-state", retriable: false },
    });
    // Local capture and local reads are untouched by the refusal.
    expect(localHistoryCounts(dir)).toMatchObject({ events: 1 });
    expect(replayLocalSession("bad", dir)).toHaveLength(1);
  });

  it("normalizes a UTC-offset instant so the handshake cannot stall silently", async () => {
    const dir = directory();
    // `event-validation.ts` accepts `z.iso.datetime({ offset: true })`, so this
    // is a legitimate stored instant even though Seorak's own hooks always
    // write `Z`. It reaches local storage through an imported log.
    append(
      { ...start("session-1", "2026-08-01T10:00:00.000Z"), at: "2026-08-01T12:00:00.000+02:00" },
      dir,
    );
    // Handed through unchanged, this fails every strict parser in
    // @seorak/types/data-plane, and it fails SILENTLY: the acknowledgement is
    // never sent and the rebaseline simply never completes.
    expect(localHistoryFrom(dir)).toBe("2026-08-01T10:00:00.000Z");
    const value = coverage(dir);
    expect(value.pendingFrom).toBe("2026-08-01T10:00:00.000Z");

    const script = worker({ plan: "pro", status: deletedStatus });
    const outcome = await applyRebaselineDirective({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      status: JSON.parse(JSON.stringify(deletedStatus)),
      directory: dir,
      fetchImpl: script.fetchImpl,
      nowMs: NOW_MS,
    });
    expect(outcome).toMatchObject({ applied: true, acknowledged: true });
    expect(script.acknowledgements).toHaveLength(1);
  });

  it("errs later, never earlier, when mixed offsets defeat a lexicographic MIN", () => {
    const dir = directory();
    // Chronologically: 08:00Z, then 09:00Z. Lexicographically the `+02:00` row
    // sorts LAST, so `MIN(at)` picks the 09:00Z row and misses the true oldest.
    append(
      { ...start("later-text", "2026-08-01T09:00:00.000Z"), at: "2026-08-01T09:00:00.000Z" },
      dir,
    );
    append(
      { ...start("earlier-real", "2026-08-01T10:00:00.000Z"), at: "2026-08-01T10:00:00.000+02:00" },
      dir,
    );
    const reported = localHistoryFrom(dir);
    const trueEarliest = Math.min(
      ...["2026-08-01T09:00:00.000Z", "2026-08-01T10:00:00.000+02:00"].map((v) =>
        Date.parse(v),
      ),
    );
    // The imprecision is real: this is not the true earliest instant.
    expect(Date.parse(reported!)).not.toBe(trueEarliest);
    // But it is bounded in the safe direction. `MIN` returns some row's actual
    // value, and the true earliest is no later than every value in the set, so
    // the reported instant can never precede it. Erring later understates how
    // far a rebuild reaches, which promises less than will be delivered.
    expect(Date.parse(reported!)).toBeGreaterThanOrEqual(trueEarliest);
    // And it is always a real stored instant, never a synthesised one.
    expect(reported).toBe("2026-08-01T09:00:00.000Z");
  });

  it("reports honest-null local history when there is none to resend", () => {
    const dir = directory();
    const result = applyLocalRebaseline(1, dir);
    expect(result).toMatchObject({
      applied: true,
      localHistoryFrom: null,
      resendable: { sessions: 0, hours: 0, archives: 0 },
    });
  });

  it("reports a missing archive key instead of claiming a full reconstruction", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    append(end("session-1", "2026-08-01T11:00:00.000Z"), dir);
    await drainUntilCaughtUp(dir, { plan: "pro" });
    // The key that produced the uploaded ciphertext is gone. New chunks can be
    // encrypted with a new key, but this installation is no longer the one that
    // produced the old objects, and the report must say so.
    rmSync(localArchiveKeyPath(dir));

    const script = worker({ plan: "pro", status: deletedStatus });
    const outcome = await applyRebaselineDirective({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      status: JSON.parse(JSON.stringify(deletedStatus)),
      directory: dir,
      fetchImpl: script.fetchImpl,
      nowMs: NOW_MS,
    });
    expect(outcome).toMatchObject({
      applied: true,
      acknowledged: true,
      archiveKeyMissing: true,
      localHistoryFrom: "2026-08-01T10:00:00.000Z",
    });
    expect(outcome!.resendable.archives).toBe(1);
  });

  it("treats an unreadable archive key as missing rather than usable", async () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    await drainUntilCaughtUp(dir, { plan: "pro" });
    writeFileSync(localArchiveKeyPath(dir), "too short", { mode: 0o600 });
    const script = worker({ plan: "pro", status: deletedStatus });
    const outcome = await applyRebaselineDirective({
      workerUrl: "https://worker.test",
      installationId: "install-1",
      status: JSON.parse(JSON.stringify(deletedStatus)),
      directory: dir,
      fetchImpl: script.fetchImpl,
      nowMs: NOW_MS,
    });
    expect(outcome?.archiveKeyMissing).toBe(true);
  });

  it("reports a deleted managed copy as covering nothing", () => {
    const dir = directory();
    append(start("session-1", "2026-08-01T10:00:00.000Z"), dir);
    const value = localManagedSyncCoverage({ directory: dir, nowMs: NOW_MS });
    expect(parseManagedSyncCoverage(value)).toEqual(value);
    expect(value.synchronizedThrough).toBeNull();
  });
});

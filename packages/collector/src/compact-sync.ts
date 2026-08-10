import {
  createCipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import {
  canonicalCompactSyncBatchJson,
  type CompactSyncArchive,
  type CompactSyncBatch,
  type CompactSyncErrorCode,
  type CompactSyncHour,
  type CompactSyncLiveTransition,
  type CompactSyncReceipt,
  type CompactSyncSession,
  type ServerEntitlement,
  parseCompactSyncBatch,
  parseCompactSyncErrorResponse,
  parseCompactSyncHealthResponse,
  parseCompactSyncReceipt,
  parseServerEntitlement,
  resolveEffectiveEntitlements,
  seorakRoutes,
} from "@seorak/types";
import {
  backlogIsEmpty,
  DATA_PLANE_PROTOCOL_VERSION,
  parseDataPlaneStatus,
  parseRebaselineAcknowledgement,
  type DataPlaneStatus,
  type ManagedLifecyclePhase,
  type ManagedLifecycleWindow,
  type ManagedSyncCoverage,
  type ManagedSyncError,
  type ManagedSyncErrorReason,
  type ManagedSyncState,
  type RebaselineAcknowledgement,
} from "@seorak/types/data-plane";
import { readBoundedJsonResponse } from "./bounded-json-response.ts";
import { withEventLogLock, readEventLogGeneration } from "./event-log.ts";
import type { DrainEventQueueResult } from "./ingest-queue.ts";
import {
  acknowledgePendingCompactSync,
  applyLocalRebaseline,
  buildLocalSyncCandidate,
  cacheLocalDataPlaneStatus,
  cacheLocalEntitlement,
  compactSyncActivated,
  type LocalHourRow,
  type LocalRebaselineResult,
  type LocalSyncCandidate,
  persistPendingCompactSync,
  readLocalManagedBacklog,
  readLocalManagedSyncState,
  recordLocalSyncAttempt,
  recordLocalSyncError,
} from "./local-store.ts";
import {
  localArchiveKeyPath,
  resolveEventLogPathContext,
} from "./paths.ts";

const HEALTH_RESPONSE_BYTES = 8 * 1024;
const ENTITLEMENT_RESPONSE_BYTES = 32 * 1024;
const RECEIPT_RESPONSE_BYTES = 16 * 1024;
const DATA_PLANE_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Managed paths, from the shared builders rather than from literals here.
 *
 * The builders have landed, so the removal condition the previous note named is
 * met and the literals are gone. The route contract now pins these in both
 * directions, which is the same drift that let the dashboard probe a path no
 * worker serves for as long as it did.
 */
const DATA_PLANE_PATH = seorakRoutes.compactSyncDataPlane();
const REBASELINE_PATH = seorakRoutes.compactSyncRebaseline();

/**
 * How stale a cached data-plane status may get on an installation that is no
 * longer entitled.
 *
 * A downgraded install still has to learn two things it cannot learn locally:
 * that the recovery window is running, and that the managed copy was deleted.
 * Twelve hours keeps that within the twice-daily hosted-read bound Free already
 * observes, and an install that was NEVER activated makes this request zero
 * times, so an account-free local user still creates no hosted work at all.
 */
const DOWNGRADED_DATA_PLANE_REFRESH_MS = 12 * 60 * 60 * 1000;

export type ManagedCompactSyncDrain =
  | { kind: "legacy" }
  | { kind: "handled"; result: DrainEventQueueResult };

function normalizedWorkerUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  return fetchImpl(url, { ...init, signal });
}

function authorization(ingestKey: string | undefined): Record<string, string> {
  return ingestKey ? { authorization: `Bearer ${ingestKey}` } : {};
}

function loadArchiveKey(directory?: string): Buffer {
  const path = localArchiveKeyPath(directory);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!existsSync(path)) {
    const key = randomBytes(32);
    try {
      const descriptor = openSync(path, "wx", 0o600);
      try {
        writeSync(descriptor, key);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("local archive key is not a regular file");
  }
  const key = readFileSync(path);
  if (key.byteLength !== 32) throw new Error("local archive key is invalid");
  chmodSync(path, 0o600);
  return key;
}

function encryptedArchive(
  input: LocalSyncCandidate["archives"][number],
  key: Buffer,
): CompactSyncArchive {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(gzipSync(Buffer.from(input.jsonl, "utf8"))),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    archiveId: createHash("sha256")
      .update(
        `${input.sessionId}:${input.firstLocalSequence}:${input.lastLocalSequence}:${input.contentDigest}`,
      )
      .digest("hex"),
    streamIds: [input.sessionId],
    firstLocalSequence: input.firstLocalSequence,
    lastLocalSequence: input.lastLocalSequence,
    eventCount: input.eventCount,
    compression: "gzip",
    algorithm: "aes-256-gcm",
    keyVersion: 1,
    nonceBase64: nonce.toString("base64"),
    ciphertextDigest: createHash("sha256").update(ciphertext).digest("hex"),
    ciphertextBase64: ciphertext.toString("base64"),
  };
}

function compactSessions(candidate: LocalSyncCandidate): CompactSyncSession[] {
  return candidate.sessions.map((session) => ({
    streamId: session.sessionId,
    revision: session.revision,
    startedAt: session.startedAt,
    lastEventAt: session.lastEventAt,
    endedAt: session.endedAt,
    status: session.endedAt === null ? "active" : "ended",
    awaitingInput: session.status === "needs-you",
    repoId: session.repoId,
    repoLabel: session.repoLabel,
    agent: session.agent,
    toolCallCount: session.toolCallCount,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cacheReadTokens: session.cacheReadTokens,
    cacheWriteTokens: session.cacheWriteTokens,
    costUsd: session.costUsd,
    models: [],
  }));
}

function sum(rows: readonly LocalHourRow[], field: keyof LocalHourRow): number {
  return rows.reduce((total, row) => total + Number(row[field]), 0);
}

function compactHours(candidate: LocalSyncCandidate): CompactSyncHour[] {
  const buckets = [...new Set(candidate.hours.map((hour) => hour.bucket))].sort();
  return buckets.map((bucket) => {
    const rows = candidate.hours.filter((hour) => hour.bucket === bucket);
    const counts = candidate.hourSessionCounts.find((item) => item.bucket === bucket);
    return {
      hour: `${bucket}:00:00.000Z`,
      revision: Math.max(1, sum(rows, "revision")),
      sessionsStarted: counts?.sessionsStarted ?? 0,
      sessionsEnded: counts?.sessionsEnded ?? 0,
      toolCalls: sum(rows, "toolCallCount"),
      erroredCalls: sum(rows, "erroredToolCallCount"),
      inputTokens: sum(rows, "inputTokens"),
      outputTokens: sum(rows, "outputTokens"),
      cacheReadTokens: sum(rows, "cacheReadTokens"),
      cacheWriteTokens: sum(rows, "cacheWriteTokens"),
      costUsd: rows.every((row) => row.costUsd !== null)
        ? sum(rows, "costUsd")
        : null,
    };
  });
}

function compactTransitions(
  candidate: LocalSyncCandidate,
): CompactSyncLiveTransition[] {
  const sessions = new Map(
    candidate.sessions.map((session) => [session.sessionId, session]),
  );
  return candidate.transitions.map((transition) => {
    const session = sessions.get(transition.sessionId);
    const completed = transition.transition === "completed";
    const needsInput = transition.transition === "needs-you";
    return {
      transitionId: transition.eventId,
      streamId: transition.sessionId,
      revision: Math.max(1, session?.revision ?? 1),
      kind:
        transition.transition === "started"
          ? "session_started"
          : needsInput
            ? "needs_input"
            : transition.transition === "resumed"
              ? "resumed"
              : "completed",
      at: transition.at,
      status: completed ? "ended" : "active",
      awaitingInput: needsInput,
      costUsd: session?.costUsd ?? null,
    };
  });
}

export function buildCompactSyncBatch(
  candidate: LocalSyncCandidate,
  input: {
    installationId: string;
    sequence: number;
    previousBatchSha256: string | null;
    createdAt?: string;
    directory?: string;
  },
): CompactSyncBatch {
  const archives = candidate.archives.map((archive) =>
    encryptedArchive(archive, loadArchiveKey(input.directory)),
  );
  const batch: CompactSyncBatch = {
    protocolVersion: 1,
    installationId: input.installationId,
    sequence: input.sequence,
    batchId: candidate.batchId,
    batchSha256: "0".repeat(64),
    previousBatchSha256: input.previousBatchSha256,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sessions: compactSessions(candidate),
    hours: compactHours(candidate),
    archives,
    liveTransitions: compactTransitions(candidate),
  };
  batch.batchSha256 = createHash("sha256")
    .update(canonicalCompactSyncBatchJson(batch))
    .digest("hex");
  const parsed = parseCompactSyncBatch(batch);
  if (!parsed) throw new Error("local compact sync candidate exceeds protocol limits");
  return parsed;
}

async function compactHealthAvailable(
  workerUrl: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await timedFetch(
      fetchImpl,
      `${workerUrl}${seorakRoutes.compactSyncHealth()}`,
      signal ? { signal } : {},
    );
    return response.ok &&
      parseCompactSyncHealthResponse(
        await readBoundedJsonResponse(response, HEALTH_RESPONSE_BYTES),
      ) !== null;
  } catch {
    return false;
  }
}

async function effectiveEntitlement(
  input: {
    workerUrl: string;
    ingestKey?: string;
    directory?: string;
    fetchImpl: typeof fetch;
    nowMs: number;
    signal?: AbortSignal;
  },
) {
  const cached = cachedServerEntitlement(input.directory);
  if (cached && input.nowMs < Date.parse(cached.refreshAfter)) {
    return resolveEffectiveEntitlements(cached, input.nowMs);
  }
  try {
    const response = await timedFetch(
      input.fetchImpl,
      `${input.workerUrl}${seorakRoutes.entitlements()}`,
      {
        headers: authorization(input.ingestKey),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    if (response.ok) {
      const entitlement = parseServerEntitlement(
        await readBoundedJsonResponse(response, ENTITLEMENT_RESPONSE_BYTES),
      );
      if (entitlement) {
        cacheLocalEntitlement(
          JSON.stringify(entitlement),
          entitlement.expiresAt,
          input.directory,
        );
        return resolveEffectiveEntitlements(entitlement, input.nowMs);
      }
    }
  } catch {
    // A still-valid server grant below may bridge a short outage.
  }
  return resolveEffectiveEntitlements(cached, input.nowMs);
}

function cachedServerEntitlement(directory?: string): ServerEntitlement | null {
  const cached = readLocalManagedSyncState(directory).cachedEntitlementJson;
  try {
    return cached ? parseServerEntitlement(JSON.parse(cached)) : null;
  } catch {
    return null;
  }
}

/**
 * The coarse reason a surface may show.
 *
 * The status carries it, with ONE exception, and the exception is the point.
 * Every 503 used to read as `service-unavailable`, which is true of a service
 * that could not do the work and false of the published archive allowance: there
 * the service is working and the home has reached a number Seorak publishes.
 * pricing.md requires that pause to surface as `paused` with a `capacity`
 * reason, so the one code that means it is read here.
 *
 * This is still not a surface branching on protocol detail. The translation
 * happens once, at the transport edge, into the same coarse enum every surface
 * already consumes, and an unrecognised code falls back to the status.
 */
function syncErrorReasonFor(
  status: number | undefined,
  code?: CompactSyncErrorCode,
): ManagedSyncErrorReason {
  if (code === "archive_allowance_exhausted") return "capacity";
  if (status === undefined) return "network";
  if (status === 402) return "authority";
  if (status === 429) return "capacity";
  if (status === 503 || status >= 500) return "service-unavailable";
  return "protocol";
}

function blocked(
  retriable: boolean,
  status?: number,
): DrainEventQueueResult {
  return {
    acceptedEvents: 0,
    acceptedChunks: 0,
    rejectedLocalRecords: 0,
    blocked: true,
    retriable,
    ...(status !== undefined ? { status } : {}),
  };
}

function refused(
  input: {
    reason: ManagedSyncErrorReason;
    retriable: boolean;
    status?: number;
    directory?: string;
    nowMs: number;
  },
): DrainEventQueueResult {
  recordLocalSyncError(
    {
      reason: input.reason,
      at: new Date(input.nowMs).toISOString(),
      retriable: input.retriable,
    },
    input.directory,
  );
  return blocked(input.retriable, input.status);
}

function cachedDataPlaneStatus(directory?: string): DataPlaneStatus | null {
  const cached = readLocalManagedSyncState(directory).cachedDataPlaneJson;
  try {
    return cached ? parseDataPlaneStatus(JSON.parse(cached)) : null;
  } catch {
    return null;
  }
}

async function refreshDataPlaneStatus(input: {
  workerUrl: string;
  ingestKey?: string;
  directory?: string;
  fetchImpl: typeof fetch;
  nowMs: number;
  signal?: AbortSignal;
}): Promise<DataPlaneStatus | null> {
  try {
    const response = await timedFetch(
      input.fetchImpl,
      `${input.workerUrl}${DATA_PLANE_PATH}`,
      {
        headers: authorization(input.ingestKey),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    if (!response.ok) return cachedDataPlaneStatus(input.directory);
    const status = parseDataPlaneStatus(
      await readBoundedJsonResponse(response, DATA_PLANE_RESPONSE_BYTES),
    );
    if (!status) return cachedDataPlaneStatus(input.directory);
    cacheLocalDataPlaneStatus(
      JSON.stringify(status),
      new Date(input.nowMs).toISOString(),
      input.directory,
    );
    return status;
  } catch {
    // A managed read failure never narrows local work. The last known status
    // stays, clearly stamped with when it was observed.
    return cachedDataPlaneStatus(input.directory);
  }
}

/**
 * Whether an unentitled installation should read the managed status again.
 *
 * Two triggers, and the first is the one that matters. A grant NEWER than the
 * last observation means the entitlement just changed, and the change is exactly
 * the moment the customer needs to be told why: their window has started, or
 * their copy is gone. Converging on one poll is what makes the answer timely.
 * The twelve-hour floor is the fallback for a plane that says nothing new.
 *
 * Both are bounded by the entitlement refresh cadence Free already declares, so
 * neither turns a downgraded install into a poller.
 */
function dataPlaneRefreshDue(
  state: { cachedDataPlaneAt: string | null },
  entitlementIssuedAt: string | null,
  nowMs: number,
): boolean {
  if (state.cachedDataPlaneAt === null) return true;
  const observed = Date.parse(state.cachedDataPlaneAt);
  if (!Number.isFinite(observed)) return true;
  if (
    entitlementIssuedAt !== null &&
    Date.parse(entitlementIssuedAt) > observed
  ) {
    return true;
  }
  return nowMs - observed >= DOWNGRADED_DATA_PLANE_REFRESH_MS;
}

export interface LocalRebaselineOutcome extends LocalRebaselineResult {
  /** Whether the managed side recorded this installation's acknowledgement. */
  acknowledged: boolean;
  /**
   * True when the local archive key file is missing or unreadable. Reported
   * rather than repaired: a new key can encrypt new chunks, but it cannot make
   * this installation the one that produced the old ciphertext, so a
   * reconstruction claim would be false.
   */
  archiveKeyMissing: boolean;
}

function archiveKeyReadable(directory?: string): boolean {
  try {
    const path = localArchiveKeyPath(directory);
    if (!existsSync(path)) return false;
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size === 32;
  } catch {
    return false;
  }
}

/**
 * The collector's half of the rebaseline handshake.
 *
 * Order is the whole contract: reset first, in one local transaction, and only
 * then acknowledge. Acknowledging first would let the managed side believe a
 * restart happened that a crash then prevented, and it would have no way to find
 * out. A directive whose epoch does not exceed the acknowledged one is inert and
 * sends nothing.
 */
export async function applyRebaselineDirective(input: {
  workerUrl: string;
  installationId: string;
  status: DataPlaneStatus;
  ingestKey?: string;
  directory?: string;
  fetchImpl: typeof fetch;
  nowMs: number;
  signal?: AbortSignal;
}): Promise<LocalRebaselineOutcome | null> {
  const directive = input.status.rebaseline;
  if (!directive?.required) return null;
  const result = applyLocalRebaseline(
    directive.baselineEpoch,
    input.directory,
    new Date(input.nowMs).toISOString(),
  );
  const outcome: LocalRebaselineOutcome = {
    ...result,
    acknowledged: false,
    archiveKeyMissing: !archiveKeyReadable(input.directory),
  };
  // Acknowledge whenever the reset for this epoch HAS happened, not only when it
  // happened just now, which is why there is no `if (result.applied)` here.
  // `applyLocalRebaseline` returns false when the local epoch already equals or
  // exceeds the directive's, and both of those mean the checkpoints this
  // directive asked about are already gone. A collector that reset and then
  // failed to deliver the acknowledgement sees the same directive again;
  // refusing to re-send it because the local work was already done would leave
  // both sides waiting on each other forever.
  const state = readLocalManagedSyncState(input.directory);
  const acknowledgement: RebaselineAcknowledgement = {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    // The epoch the managed side is waiting to hear about, which is the one it
    // named. Its own guard refuses anything that is not its current epoch.
    baselineEpoch: directive.baselineEpoch,
    installationId: state.installationId ?? input.installationId,
    checkpointsReset: true,
    // Honest-null when local history no longer reaches back at all, so the
    // managed side never reports a reconstruction it will not receive.
    localHistoryFrom: result.localHistoryFrom,
    acknowledgedAt: new Date(input.nowMs).toISOString(),
  };
  if (!parseRebaselineAcknowledgement(acknowledgement)) return outcome;
  try {
    const response = await timedFetch(
      input.fetchImpl,
      `${input.workerUrl}${REBASELINE_PATH}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authorization(input.ingestKey),
        },
        body: JSON.stringify(acknowledgement),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    // A failed acknowledgement is safe to retry: the local reset is already
    // durable, and a repeated acknowledgement of the same epoch is inert.
    return { ...outcome, acknowledged: response.ok };
  } catch {
    return outcome;
  }
}

/**
 * Learn the managed lifecycle on an installation that is no longer entitled.
 *
 * Bounded to twice a day and skipped entirely when compact sync was never
 * activated, so an account-free Free install still issues zero hosted requests
 * and a downgraded one stays inside the declared entitlement-refresh envelope.
 * A rebaseline directive found here is NOT applied: resetting checkpoints while
 * unentitled would discard a healthy chain for a copy that may still exist. It
 * is applied on the first entitled drain, which is the only moment the
 * acknowledgement can also be delivered.
 */
async function observeDowngradedDataPlane(input: {
  workerUrl: string;
  ingestKey?: string;
  directory?: string;
  fetchImpl: typeof fetch;
  nowMs: number;
  signal?: AbortSignal;
}): Promise<void> {
  if (!compactSyncActivated(input.directory)) return;
  const state = readLocalManagedSyncState(input.directory);
  const issuedAt = cachedServerEntitlement(input.directory)?.issuedAt ?? null;
  if (!dataPlaneRefreshDue(state, issuedAt, input.nowMs)) return;
  await refreshDataPlaneStatus(input);
}

/**
 * The managed lifecycle window as the LOCAL plane can honestly state it.
 *
 * The local plane is the default authority for every install including Pro, so a
 * lapsed subscriber is reading locally at exactly the moment the deletion
 * countdown matters most. Relaying the window is what makes that countdown
 * representable on the surface they are actually looking at.
 *
 * The DATES are relayed verbatim, because they are facts the managed side
 * established and they do not drift. The PHASE is re-derived against the local
 * clock, so the countdown keeps advancing through an outage, an expired
 * subscription, and a worker that has stopped answering. What is never derived
 * locally is `deleted`: only the managed side can prove its own copy is gone, so
 * that phase is carried through and never invented.
 *
 * Returns null when no managed plane was ever observed, which is the honest
 * answer for an account-free install rather than a fabricated `none`.
 */
export function localManagedLifecycleWindow(
  options: { directory?: string; nowMs?: number } = {},
): ManagedLifecycleWindow | null {
  const nowMs = options.nowMs ?? Date.now();
  const observed = cachedDataPlaneStatus(options.directory)?.lifecycle ?? null;
  if (observed === null) return null;
  const phase: ManagedLifecyclePhase =
    observed.phase === "deleted" || observed.phase === "none"
      ? observed.phase
      : observed.remoteServiceEndsAt !== null &&
          nowMs >= Date.parse(observed.remoteServiceEndsAt)
        ? "recovery"
        : observed.phase;
  const windowOpen =
    observed.hostedDeletionAt !== null &&
    nowMs < Date.parse(observed.hostedDeletionAt);
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    phase,
    paidThroughAt: observed.paidThroughAt,
    remoteServiceEndsAt: observed.remoteServiceEndsAt,
    hostedDeletionAt: observed.hostedDeletionAt,
    recoveryExportAvailable:
      phase === "recovery" &&
      observed.remoteServiceEndsAt !== null &&
      observed.hostedDeletionAt !== null &&
      windowOpen,
    resumesExistingCopy: phase !== "none" && phase !== "deleted",
    observedAt: new Date(nowMs).toISOString(),
  };
}

function lastErrorOf(state: {
  lastErrorReason: string | null;
  lastErrorAt: string | null;
  lastErrorRetriable: boolean | null;
}): ManagedSyncError | null {
  const reasons: readonly string[] = [
    "network",
    "authority",
    "service-unavailable",
    "capacity",
    "protocol",
    "local-state",
  ];
  if (
    state.lastErrorReason === null ||
    state.lastErrorAt === null ||
    state.lastErrorRetriable === null ||
    !reasons.includes(state.lastErrorReason)
  ) {
    return null;
  }
  return {
    reason: state.lastErrorReason as ManagedSyncErrorReason,
    at: state.lastErrorAt,
    retriable: state.lastErrorRetriable,
  };
}

/**
 * How much of the local record the managed copy holds, answered locally.
 *
 * The division of labour is the point. The BACKLOG is measured here, because
 * only this machine can count what is still dirty. The LIFECYCLE comes from the
 * last observed managed status, because only the managed side knows when its own
 * copy was deleted. Composing them here is what lets `managedCopyComplete` ever
 * be true: it needs a measured empty backlog AND an acknowledged instant, and
 * nothing but the local plane can supply the first.
 *
 * Every branch below either produces a payload `parseManagedSyncCoverage`
 * accepts or produces a strictly more conservative one. Nothing is zero-filled:
 * an installation that has never connected reports nulls, not zeroes.
 */
export function localManagedSyncCoverage(
  options: { directory?: string; nowMs?: number } = {},
): ManagedSyncCoverage {
  const nowMs = options.nowMs ?? Date.now();
  const state = readLocalManagedSyncState(options.directory);
  const measured = readLocalManagedBacklog(options.directory);
  const status = cachedDataPlaneStatus(options.directory);
  const entitled = (() => {
    const cached = cachedServerEntitlement(options.directory);
    return cached === null
      ? false
      : resolveEffectiveEntitlements(cached, nowMs).hosted.managedSync;
  })();
  const backlog = {
    sessions: measured.sessions,
    hours: measured.hours,
    archives: measured.archives,
  };
  const empty = backlogIsEmpty(backlog);
  const lastError = lastErrorOf(state);
  const phase = status?.lifecycle?.phase ?? null;
  const rebaselinePending =
    status?.rebaseline?.required === true &&
    status.rebaseline.baselineEpoch > state.baselineEpoch;

  const resolved = ((): ManagedSyncState => {
    if (phase === "deleted" || rebaselinePending) return "deleted";
    if (phase === "recovery") return "recovery";
    if (!entitled) {
      return state.lastAcceptedAt === null ? "not-connected" : "blocked";
    }
    if (lastError !== null) return lastError.retriable ? "paused" : "blocked";
    return empty ? "current" : "backfilling";
  })();

  const connected = resolved !== "not-connected";
  const deleted = resolved === "deleted";
  const observedAt = new Date(nowMs).toISOString();
  // Nothing can have been observed after the moment of observation. A local
  // clock that disagrees is a reason to report less, never to report ahead.
  const notAfter = (instant: string | null): string | null =>
    instant === null || Date.parse(instant) <= nowMs ? instant : observedAt;
  const synchronizedThrough =
    deleted || !connected ? null : notAfter(state.synchronizedThrough);
  const pendingFrom = deleted ? null : notAfter(measured.pendingFrom);
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    state: resolved,
    synchronizedThrough,
    pendingFrom,
    // A deleted managed copy holds nothing, so a backlog against it is not a
    // measurement of anything; every local row is owed and none is pending
    // against a copy that no longer exists.
    backlog: deleted ? null : backlog,
    lastAcceptedAt:
      connected && !deleted ? notAfter(state.lastAcceptedAt) : null,
    lastAttemptAt: notAfter(state.lastAttemptAt),
    // `paused` and `blocked` each owe a cause. When the cause is simply that
    // this installation is no longer entitled, say that rather than leaving a
    // surface with "stopped" and no remedy.
    lastError:
      lastError ??
      (resolved === "paused" || resolved === "blocked"
        ? {
            reason: "authority" as const,
            at: notAfter(state.lastAttemptAt) ?? observedAt,
            retriable: false,
          }
        : null),
    managedCopyComplete:
      resolved === "current" &&
      empty &&
      synchronizedThrough !== null &&
      pendingFrom === null,
    observedAt,
  };
}

export async function drainManagedCompactSync(input: {
  workerUrl: string;
  installationId: string;
  ingestKey?: string;
  directory?: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  signal?: AbortSignal;
  onAccepted?: () => Promise<void>;
}): Promise<ManagedCompactSyncDrain> {
  const workerUrl = normalizedWorkerUrl(input.workerUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const nowMs = input.nowMs ?? Date.now();
  const cached = cachedServerEntitlement(input.directory);
  if (cached && nowMs < Date.parse(cached.refreshAfter)) {
    const effective = resolveEffectiveEntitlements(cached, nowMs);
    if (!effective.hosted.managedSync) {
      await observeDowngradedDataPlane({
        workerUrl,
        ...(input.ingestKey ? { ingestKey: input.ingestKey } : {}),
        ...(input.directory ? { directory: input.directory } : {}),
        fetchImpl,
        nowMs,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return {
        kind: "handled",
        result: {
          acceptedEvents: 0,
          acceptedChunks: 0,
          rejectedLocalRecords: 0,
          blocked: false,
        },
      };
    }
  }
  if (!(await compactHealthAvailable(workerUrl, fetchImpl, input.signal))) {
    return compactSyncActivated(input.directory)
      ? {
          kind: "handled",
          result: refused({
            reason: "network",
            retriable: true,
            ...(input.directory ? { directory: input.directory } : {}),
            nowMs,
          }),
        }
      : { kind: "legacy" };
  }

  const entitlement = await effectiveEntitlement({
    workerUrl,
    ...(input.ingestKey ? { ingestKey: input.ingestKey } : {}),
    ...(input.directory ? { directory: input.directory } : {}),
    fetchImpl,
    nowMs,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!entitlement.hosted.managedSync) {
    await observeDowngradedDataPlane({
      workerUrl,
      ...(input.ingestKey ? { ingestKey: input.ingestKey } : {}),
      ...(input.directory ? { directory: input.directory } : {}),
      fetchImpl,
      nowMs,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return {
      kind: "handled",
      result: {
        acceptedEvents: 0,
        acceptedChunks: 0,
        rejectedLocalRecords: 0,
        blocked: false,
      },
    };
  }

  // Entitled: read the managed status every drain, because it carries the
  // rebaseline directive and a directive that arrives late is a directive that
  // lets the collector keep uploading against a copy that no longer exists.
  const dataPlane = await refreshDataPlaneStatus({
    workerUrl,
    ...(input.ingestKey ? { ingestKey: input.ingestKey } : {}),
    ...(input.directory ? { directory: input.directory } : {}),
    fetchImpl,
    nowMs,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (dataPlane?.rebaseline?.required) {
    const outcome = await applyRebaselineDirective({
      workerUrl,
      installationId: input.installationId,
      status: dataPlane,
      ...(input.ingestKey ? { ingestKey: input.ingestKey } : {}),
      ...(input.directory ? { directory: input.directory } : {}),
      fetchImpl,
      nowMs,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    // A reset that has not been acknowledged must not start uploading against
    // the new baseline yet: the managed side would receive a chain it has not
    // agreed to restart. The next drain retries the acknowledgement.
    if (outcome && !outcome.acknowledged) {
      return {
        kind: "handled",
        result: refused({
          reason: "local-state",
          retriable: true,
          ...(input.directory ? { directory: input.directory } : {}),
          nowMs,
        }),
      };
    }
  }

  let state = readLocalManagedSyncState(input.directory);
  let batchValue: CompactSyncBatch | null = null;
  let candidate: LocalSyncCandidate | null = null;
  if (state.pendingBatchJson && state.pendingCandidateJson) {
    try {
      batchValue = parseCompactSyncBatch(JSON.parse(state.pendingBatchJson));
      candidate = JSON.parse(state.pendingCandidateJson) as LocalSyncCandidate;
    } catch {
      batchValue = null;
      candidate = null;
    }
    if (!batchValue || !candidate) {
      return {
        kind: "handled",
        result: refused({
          reason: "local-state",
          retriable: false,
          ...(input.directory ? { directory: input.directory } : {}),
          nowMs,
        }),
      };
    }
  } else {
    candidate = buildLocalSyncCandidate({
      nowMs,
      ...(input.directory ? { directory: input.directory } : {}),
    });
    if (!candidate) {
      return {
        kind: "handled",
        result: {
          acceptedEvents: 0,
          acceptedChunks: 0,
          rejectedLocalRecords: 0,
          blocked: false,
        },
      };
    }
    // A candidate that cannot be encoded is corrupt local compact state, and
    // ADR-001's rollback matrix already names the behaviour: fail hosted sync
    // closed, preserve SQLite and the compatibility mirror, and repair
    // explicitly. Letting the throw escape instead would take the whole drain
    // down on one unencodable row, so a single bad instant would stop managed
    // sync for the install rather than blocking one batch. Local capture and
    // every local read continue either way.
    let built: CompactSyncBatch;
    try {
      built = buildCompactSyncBatch(candidate, {
        installationId: state.installationId ?? input.installationId,
        sequence: state.nextSequence,
        previousBatchSha256: state.previousBatchSha256,
        createdAt: new Date(nowMs).toISOString(),
        ...(input.directory ? { directory: input.directory } : {}),
      });
    } catch {
      return {
        kind: "handled",
        result: refused({
          reason: "local-state",
          retriable: false,
          ...(input.directory ? { directory: input.directory } : {}),
          nowMs,
        }),
      };
    }
    batchValue = built;
    persistPendingCompactSync(
      {
        installationId: batchValue.installationId,
        batchJson: JSON.stringify(batchValue),
        candidateJson: JSON.stringify(candidate),
      },
      input.directory,
    );
    state = readLocalManagedSyncState(input.directory);
  }

  recordLocalSyncAttempt(new Date(nowMs).toISOString(), input.directory);
  let response: Response;
  try {
    response = await timedFetch(
      fetchImpl,
      `${workerUrl}${seorakRoutes.compactSyncBatches()}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authorization(input.ingestKey),
        },
        body: state.pendingBatchJson ?? JSON.stringify(batchValue),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
  } catch {
    return {
      kind: "handled",
      result: refused({
        reason: "network",
        retriable: true,
        ...(input.directory ? { directory: input.directory } : {}),
        nowMs,
      }),
    };
  }
  if (!response.ok) {
    const error = parseCompactSyncErrorResponse(
      await readBoundedJsonResponse(response, RECEIPT_RESPONSE_BYTES),
    );
    const retriable =
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500 ||
      error?.code === "sync_unavailable" ||
      error?.code === "archive_allowance_exhausted";
    return {
      kind: "handled",
      result: refused({
        reason: syncErrorReasonFor(response.status, error?.code),
        retriable,
        status: response.status,
        ...(input.directory ? { directory: input.directory } : {}),
        nowMs,
      }),
    };
  }
  const receipt = parseCompactSyncReceipt(
    await readBoundedJsonResponse(response, RECEIPT_RESPONSE_BYTES),
  );
  if (
    !receipt ||
    receipt.batchId !== batchValue.batchId ||
    receipt.batchSha256 !== batchValue.batchSha256 ||
    receipt.installationId !== batchValue.installationId ||
    receipt.sequence !== batchValue.sequence
  ) {
    return {
      kind: "handled",
      result: refused({
        reason: "protocol",
        retriable: false,
        status: response.status,
        ...(input.directory ? { directory: input.directory } : {}),
        nowMs,
      }),
    };
  }
  acknowledgePendingCompactSync(
    {
      batchId: receipt.batchId,
      batchSha256: receipt.batchSha256,
      candidate,
    },
    input.directory,
  );
  await input.onAccepted?.();
  return {
    kind: "handled",
    result: {
      acceptedEvents:
        candidate.sessions.length +
        candidate.hours.length +
        candidate.archives.length +
        candidate.transitions.length,
      acceptedChunks: 1,
      rejectedLocalRecords: 0,
      blocked: false,
    },
  };
}

/** Once the compact endpoint is authoritative, events.jsonl is only a bounded
 * compatibility mirror. SQLite already holds every record before append, so
 * advancing this cursor cannot discard local history or pending compact work. */
export async function acknowledgeLocalEventMirror(
  directory?: string,
): Promise<void> {
  const paths = resolveEventLogPathContext(directory);
  await withEventLogLock(paths, async () => {
    let size = 0;
    try {
      size = statSync(paths.events).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const generation = await readEventLogGeneration(paths);
    const temporary = `${paths.offset}.tmp`;
    const descriptor = openSync(temporary, "w", 0o600);
    try {
      writeSync(
        descriptor,
        JSON.stringify({ version: 1, generation, offset: size }),
      );
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, paths.offset);
  });
}

export function receiptMatchesBatch(
  receipt: CompactSyncReceipt,
  batch: CompactSyncBatch,
): boolean {
  return (
    receipt.batchId === batch.batchId &&
    receipt.batchSha256 === batch.batchSha256 &&
    receipt.installationId === batch.installationId &&
    receipt.sequence === batch.sequence
  );
}

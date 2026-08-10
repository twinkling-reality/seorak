/**
 * Compact sync v1 public wire contract.
 *
 * The request intentionally carries no owner, account, workspace, member, or
 * plan selector. Hosted code derives that scope from authenticated authority.
 * Immutable batch ids, digests, installation sequence numbers, and per-record
 * revisions give storage adapters enough information to make retries exact.
 * This module performs no transport, authentication, encryption, or storage.
 */

export const COMPACT_SYNC_PROTOCOL_VERSION = 1 as const;
export const COMPACT_SYNC_ACCEPTED_PROTOCOL_VERSIONS = [
  COMPACT_SYNC_PROTOCOL_VERSION,
] as const;

export const COMPACT_SYNC_LIMITS = Object.freeze({
  batchBytes: 2 * 1024 * 1024,
  // Together with one receipt and eight archive pointers, these caps keep one
  // accepted request at no more than 97 D1 writes.
  sessionsPerBatch: 64,
  hoursPerBatch: 24,
  archivesPerBatch: 8,
  transitionsPerBatch: 64,
  archiveCiphertextBytes: 1024 * 1024,
  modelsPerSession: 16,
  idCharacters: 256,
  labelCharacters: 255,
});

export const COMPACT_SYNC_LIVE_TRANSITIONS = [
  "session_started",
  "active",
  "needs_input",
  "resumed",
  "stuck",
  "cost_spike",
  "completed",
] as const;
export type CompactSyncLiveTransitionKind =
  (typeof COMPACT_SYNC_LIVE_TRANSITIONS)[number];

export interface CompactSyncModelTotals {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CompactSyncSession {
  streamId: string;
  revision: number;
  startedAt: string;
  lastEventAt: string;
  endedAt: string | null;
  status: "active" | "idle" | "stuck" | "ended";
  awaitingInput: boolean;
  repoId: string;
  repoLabel: string;
  agent: string;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  models: CompactSyncModelTotals[];
}

export interface CompactSyncHour {
  hour: string;
  revision: number;
  sessionsStarted: number;
  sessionsEnded: number;
  toolCalls: number;
  erroredCalls: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
}

export interface CompactSyncArchive {
  archiveId: string;
  streamIds: string[];
  firstLocalSequence: number;
  lastLocalSequence: number;
  eventCount: number;
  compression: "gzip";
  algorithm: "aes-256-gcm";
  keyVersion: number;
  /** Twelve-byte GCM nonce. It must never repeat for one key version. */
  nonceBase64: string;
  /** SHA-256 of the encrypted bytes, including the appended GCM tag. */
  ciphertextDigest: string;
  /** Opaque ciphertext with its sixteen-byte GCM authentication tag appended. */
  ciphertextBase64: string;
}

export interface CompactSyncLiveTransition {
  transitionId: string;
  streamId: string;
  revision: number;
  kind: CompactSyncLiveTransitionKind;
  at: string;
  status: "active" | "idle" | "stuck" | "ended";
  awaitingInput: boolean;
  costUsd: number | null;
}

export interface CompactSyncBatch {
  protocolVersion: typeof COMPACT_SYNC_PROTOCOL_VERSION;
  installationId: string;
  sequence: number;
  batchId: string;
  batchSha256: string;
  previousBatchSha256: string | null;
  createdAt: string;
  sessions: CompactSyncSession[];
  hours: CompactSyncHour[];
  archives: CompactSyncArchive[];
  liveTransitions: CompactSyncLiveTransition[];
}

export interface CompactSyncReceipt {
  protocolVersion: typeof COMPACT_SYNC_PROTOCOL_VERSION;
  accepted: true;
  installationId: string;
  sequence: number;
  batchId: string;
  batchSha256: string;
  receivedAt: string;
  entitlementRevision: number;
}

export const COMPACT_SYNC_ERROR_CODES = [
  "unsupported_protocol_version",
  "invalid_batch",
  "batch_too_large",
  "batch_conflict",
  "sequence_conflict",
  "archive_conflict",
  "hosted_sync_not_entitled",
  "sync_unavailable",
  /**
   * The published per-home archive allowance is spent for now.
   *
   * Distinct from `sync_unavailable` because it is a different fact told to a
   * different person. `sync_unavailable` means the service could not do the
   * work; this means the service is working and the home has reached a number
   * Seorak publishes. Both travel as `503` and both mean keep the batch and
   * retry, so a collector that does not know this code still behaves correctly.
   * What the code buys is the REASON the customer reads: without it, a paused
   * upload at the cap was reported as "the service being unavailable" and the
   * cap was never named.
   */
  "archive_allowance_exhausted",
] as const;
export type CompactSyncErrorCode =
  (typeof COMPACT_SYNC_ERROR_CODES)[number];

export interface CompactSyncErrorResponse {
  error: "compact sync rejected";
  code: CompactSyncErrorCode;
  acceptedProtocolVersions?: readonly number[];
}

export interface CompactSyncHealthMetadata {
  currentProtocolVersion: typeof COMPACT_SYNC_PROTOCOL_VERSION;
  acceptedProtocolVersions: readonly number[];
  limits: typeof COMPACT_SYNC_LIMITS;
}

export interface CompactSyncHealthResponse {
  ok: true;
  compactSync: CompactSyncHealthMetadata;
}

/** Stable digest input shared by collector and service. The transport hash is
 * the SHA-256 of this UTF-8 JSON string. Excluding the hash field itself avoids
 * a self-referential digest while still covering every semantic field. */
export function canonicalCompactSyncBatchJson(
  batch: Omit<CompactSyncBatch, "batchSha256"> | CompactSyncBatch,
): string {
  const value = { ...batch, batchSha256: undefined } as Record<string, unknown>;
  delete value.batchSha256;
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          // Canonical cryptographic input cannot depend on the host locale.
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableFinite(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isBoundedString(value: unknown, maximum: number, minimum = 1): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    !/[\u0000-\u001f]/.test(value)
  );
}

function isId(value: unknown): value is string {
  return isBoundedString(value, COMPACT_SYNC_LIMITS.idCharacters);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 35) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function jsonByteLength(value: unknown): number | null {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return null;
    let bytes = 0;
    for (const character of json) {
      const codePoint = character.codePointAt(0)!;
      bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    }
    return bytes;
  } catch {
    return null;
  }
}

function parseModel(value: unknown): CompactSyncModelTotals | null {
  const keys = [
    "model",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (
    !isBoundedString(value.model, 64) ||
    !isSafeInteger(value.inputTokens) ||
    !isSafeInteger(value.outputTokens) ||
    !isSafeInteger(value.cacheReadTokens) ||
    !isSafeInteger(value.cacheWriteTokens)
  ) return null;
  return value as unknown as CompactSyncModelTotals;
}

function parseSession(value: unknown): CompactSyncSession | null {
  const keys = [
    "streamId", "revision", "startedAt", "lastEventAt", "endedAt", "status",
    "awaitingInput", "repoId", "repoLabel", "agent", "toolCallCount",
    "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens",
    "costUsd", "models",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (
    !isId(value.streamId) || !isSafeInteger(value.revision, 1) ||
    !isIso(value.startedAt) || !isIso(value.lastEventAt) ||
    !(value.endedAt === null || isIso(value.endedAt)) ||
    !["active", "idle", "stuck", "ended"].includes(String(value.status)) ||
    typeof value.awaitingInput !== "boolean" ||
    !isBoundedString(value.repoId, 128, 0) ||
    !isBoundedString(value.repoLabel, COMPACT_SYNC_LIMITS.labelCharacters, 0) ||
    !isBoundedString(value.agent, 64) ||
    !isSafeInteger(value.toolCallCount) || !isSafeInteger(value.inputTokens) ||
    !isSafeInteger(value.outputTokens) || !isSafeInteger(value.cacheReadTokens) ||
    !isSafeInteger(value.cacheWriteTokens) || !isNullableFinite(value.costUsd) ||
    !Array.isArray(value.models) || value.models.length > COMPACT_SYNC_LIMITS.modelsPerSession
  ) return null;
  const models = value.models.map(parseModel);
  if (models.some((model) => model === null)) return null;
  if (new Set(models.map((model) => model!.model)).size !== models.length) return null;
  if (Date.parse(value.startedAt) > Date.parse(value.lastEventAt)) return null;
  if ((value.status === "ended") !== (value.endedAt !== null)) return null;
  if (value.endedAt !== null && Date.parse(value.endedAt) < Date.parse(value.lastEventAt)) return null;
  return { ...(value as unknown as CompactSyncSession), models: models as CompactSyncModelTotals[] };
}

function parseHour(value: unknown): CompactSyncHour | null {
  const keys = [
    "hour", "revision", "sessionsStarted", "sessionsEnded", "toolCalls",
    "erroredCalls", "inputTokens", "outputTokens", "cacheReadTokens",
    "cacheWriteTokens", "costUsd",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (
    typeof value.hour !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(value.hour) ||
    !isIso(value.hour) || !isSafeInteger(value.revision, 1) ||
    !isSafeInteger(value.sessionsStarted) || !isSafeInteger(value.sessionsEnded) ||
    !isSafeInteger(value.toolCalls) ||
    !(value.erroredCalls === null || isSafeInteger(value.erroredCalls)) ||
    (typeof value.erroredCalls === "number" && value.erroredCalls > Number(value.toolCalls)) ||
    !isSafeInteger(value.inputTokens) || !isSafeInteger(value.outputTokens) ||
    !isSafeInteger(value.cacheReadTokens) || !isSafeInteger(value.cacheWriteTokens) ||
    !isNullableFinite(value.costUsd)
  ) return null;
  return value as unknown as CompactSyncHour;
}

function decodedBase64Bytes(value: string): number | null {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function parseArchive(value: unknown): CompactSyncArchive | null {
  const keys = [
    "archiveId", "streamIds", "firstLocalSequence", "lastLocalSequence",
    "eventCount", "compression", "algorithm", "keyVersion", "nonceBase64",
    "ciphertextDigest", "ciphertextBase64",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (
    !isId(value.archiveId) || !Array.isArray(value.streamIds) ||
    value.streamIds.length < 1 || value.streamIds.length > COMPACT_SYNC_LIMITS.sessionsPerBatch ||
    !value.streamIds.every(isId) || new Set(value.streamIds).size !== value.streamIds.length ||
    !isSafeInteger(value.firstLocalSequence, 1) || !isSafeInteger(value.lastLocalSequence, 1) ||
    Number(value.lastLocalSequence) < Number(value.firstLocalSequence) ||
    !isSafeInteger(value.eventCount, 1) || value.compression !== "gzip" ||
    value.algorithm !== "aes-256-gcm" || !isSafeInteger(value.keyVersion, 1) ||
    typeof value.nonceBase64 !== "string" || !isHash(value.ciphertextDigest) ||
    typeof value.ciphertextBase64 !== "string"
  ) return null;
  const nonceBytes = decodedBase64Bytes(value.nonceBase64);
  const ciphertextBytes = decodedBase64Bytes(value.ciphertextBase64);
  if (
    nonceBytes !== 12 ||
    ciphertextBytes === null ||
    ciphertextBytes <= 16 ||
    ciphertextBytes > COMPACT_SYNC_LIMITS.archiveCiphertextBytes
  ) return null;
  // A per-session archive can span a global local sequence range containing
  // interleaved records from other sessions. It may not claim more records than
  // fit in that range, but equality is neither required nor generally true.
  if (value.eventCount > value.lastLocalSequence - value.firstLocalSequence + 1) return null;
  return value as unknown as CompactSyncArchive;
}

function parseTransition(value: unknown): CompactSyncLiveTransition | null {
  const keys = [
    "transitionId", "streamId", "revision", "kind", "at", "status",
    "awaitingInput", "costUsd",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (
    !isId(value.transitionId) || !isId(value.streamId) ||
    !isSafeInteger(value.revision, 1) ||
    !(COMPACT_SYNC_LIVE_TRANSITIONS as readonly unknown[]).includes(value.kind) ||
    !isIso(value.at) || !["active", "idle", "stuck", "ended"].includes(String(value.status)) ||
    typeof value.awaitingInput !== "boolean" || !isNullableFinite(value.costUsd) ||
    (value.kind === "completed" && value.status !== "ended")
  ) return null;
  return value as unknown as CompactSyncLiveTransition;
}

/** Strict parser. Unknown owner/member fields fail because every key is closed. */
export function parseCompactSyncBatch(value: unknown): CompactSyncBatch | null {
  const keys = [
    "protocolVersion", "installationId", "sequence", "batchId", "batchSha256",
    "previousBatchSha256", "createdAt", "sessions", "hours", "archives",
    "liveTransitions",
  ] as const;
  const batchBytes = jsonByteLength(value);
  if (
    batchBytes === null ||
    batchBytes > COMPACT_SYNC_LIMITS.batchBytes ||
    !isRecord(value) ||
    !hasOnlyKeys(value, keys)
  ) return null;
  if (
    value.protocolVersion !== COMPACT_SYNC_PROTOCOL_VERSION ||
    !isId(value.installationId) || !isSafeInteger(value.sequence, 1) ||
    !isId(value.batchId) || !isHash(value.batchSha256) ||
    !(value.previousBatchSha256 === null || isHash(value.previousBatchSha256)) ||
    (value.sequence === 1) !== (value.previousBatchSha256 === null) ||
    !isIso(value.createdAt) || !Array.isArray(value.sessions) ||
    value.sessions.length > COMPACT_SYNC_LIMITS.sessionsPerBatch ||
    !Array.isArray(value.hours) || value.hours.length > COMPACT_SYNC_LIMITS.hoursPerBatch ||
    !Array.isArray(value.archives) || value.archives.length > COMPACT_SYNC_LIMITS.archivesPerBatch ||
    !Array.isArray(value.liveTransitions) || value.liveTransitions.length > COMPACT_SYNC_LIMITS.transitionsPerBatch
  ) return null;
  if (
    value.sessions.length + value.hours.length + value.archives.length +
      value.liveTransitions.length === 0
  ) return null;
  const sessions = value.sessions.map(parseSession);
  const hours = value.hours.map(parseHour);
  const archives = value.archives.map(parseArchive);
  const liveTransitions = value.liveTransitions.map(parseTransition);
  if ([...sessions, ...hours, ...archives, ...liveTransitions].some((item) => item === null)) return null;
  if (new Set(sessions.map((item) => item!.streamId)).size !== sessions.length) return null;
  if (new Set(hours.map((item) => item!.hour)).size !== hours.length) return null;
  if (new Set(archives.map((item) => item!.archiveId)).size !== archives.length) return null;
  if (
    new Set(archives.map((item) => `${item!.keyVersion}:${item!.nonceBase64}`)).size !==
    archives.length
  ) return null;
  if (new Set(liveTransitions.map((item) => item!.transitionId)).size !== liveTransitions.length) return null;
  return {
    ...(value as unknown as CompactSyncBatch),
    sessions: sessions as CompactSyncSession[],
    hours: hours as CompactSyncHour[],
    archives: archives as CompactSyncArchive[],
    liveTransitions: liveTransitions as CompactSyncLiveTransition[],
  };
}

export function parseCompactSyncReceipt(value: unknown): CompactSyncReceipt | null {
  const keys = [
    "protocolVersion", "accepted", "installationId", "sequence", "batchId",
    "batchSha256", "receivedAt", "entitlementRevision",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  return value.protocolVersion === COMPACT_SYNC_PROTOCOL_VERSION && value.accepted === true &&
    isId(value.installationId) && isSafeInteger(value.sequence, 1) && isId(value.batchId) &&
    isHash(value.batchSha256) && isIso(value.receivedAt) && isSafeInteger(value.entitlementRevision, 1)
    ? value as unknown as CompactSyncReceipt
    : null;
}

export function parseCompactSyncErrorResponse(value: unknown): CompactSyncErrorResponse | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["error", "code"], ["acceptedProtocolVersions"])) return null;
  if (value.error !== "compact sync rejected" ||
    !(COMPACT_SYNC_ERROR_CODES as readonly unknown[]).includes(value.code)) return null;
  if (value.acceptedProtocolVersions === undefined) {
    return { error: "compact sync rejected", code: value.code as CompactSyncErrorCode };
  }
  if (value.code !== "unsupported_protocol_version" || !Array.isArray(value.acceptedProtocolVersions) ||
    value.acceptedProtocolVersions.length < 1 || value.acceptedProtocolVersions.length > 2 ||
    !value.acceptedProtocolVersions.every((version) => isSafeInteger(version, 1)) ||
    new Set(value.acceptedProtocolVersions).size !== value.acceptedProtocolVersions.length) return null;
  return {
    error: "compact sync rejected",
    code: "unsupported_protocol_version",
    acceptedProtocolVersions: [...value.acceptedProtocolVersions].sort((a, b) => Number(a) - Number(b)) as number[],
  };
}

export function compactSyncHealthMetadata(): CompactSyncHealthMetadata {
  return {
    currentProtocolVersion: COMPACT_SYNC_PROTOCOL_VERSION,
    acceptedProtocolVersions: [...COMPACT_SYNC_ACCEPTED_PROTOCOL_VERSIONS],
    limits: { ...COMPACT_SYNC_LIMITS },
  };
}

export function parseCompactSyncHealthResponse(value: unknown): CompactSyncHealthResponse | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["ok", "compactSync"]) || value.ok !== true ||
    !isRecord(value.compactSync) || !hasOnlyKeys(value.compactSync, ["currentProtocolVersion", "acceptedProtocolVersions", "limits"]) ||
    value.compactSync.currentProtocolVersion !== COMPACT_SYNC_PROTOCOL_VERSION ||
    !Array.isArray(value.compactSync.acceptedProtocolVersions) ||
    value.compactSync.acceptedProtocolVersions.length < 1 || value.compactSync.acceptedProtocolVersions.length > 2 ||
    !value.compactSync.acceptedProtocolVersions.every((version) => isSafeInteger(version, 1)) ||
    !value.compactSync.acceptedProtocolVersions.includes(value.compactSync.currentProtocolVersion) ||
    !isRecord(value.compactSync.limits) ||
    !hasOnlyKeys(value.compactSync.limits, Object.keys(COMPACT_SYNC_LIMITS)) ||
    !Object.entries(COMPACT_SYNC_LIMITS).every(([key, expected]) => value.compactSync &&
      isRecord(value.compactSync) && isRecord(value.compactSync.limits) && value.compactSync.limits[key] === expected)
  ) return null;
  return {
    ok: true,
    compactSync: {
      currentProtocolVersion: COMPACT_SYNC_PROTOCOL_VERSION,
      acceptedProtocolVersions: [...value.compactSync.acceptedProtocolVersions] as number[],
      limits: { ...COMPACT_SYNC_LIMITS },
    },
  };
}

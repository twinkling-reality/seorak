import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_SYNC_LIMITS,
  compactSyncHealthMetadata,
  parseCompactSyncBatch,
  parseCompactSyncErrorResponse,
  parseCompactSyncHealthResponse,
  parseCompactSyncReceipt,
  seorakRoutes,
  type CompactSyncBatch,
} from "../src/index.ts";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function batch(): CompactSyncBatch {
  return {
    protocolVersion: 1,
    installationId: "install_01",
    sequence: 1,
    batchId: "batch_01",
    batchSha256: SHA_A,
    previousBatchSha256: null,
    createdAt: "2026-08-01T12:06:00.000Z",
    sessions: [{
      streamId: "stream_01",
      revision: 3,
      startedAt: "2026-08-01T12:00:00.000Z",
      lastEventAt: "2026-08-01T12:05:00.000Z",
      endedAt: null,
      status: "active",
      awaitingInput: false,
      repoId: "repo_01",
      repoLabel: "seorak",
      agent: "codex",
      toolCallCount: 2,
      inputTokens: 100,
      outputTokens: 80,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      costUsd: 0.04,
      models: [{
        model: "gpt-5",
        inputTokens: 100,
        outputTokens: 80,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
      }],
    }],
    hours: [{
      hour: "2026-08-01T12:00:00.000Z",
      revision: 2,
      sessionsStarted: 1,
      sessionsEnded: 0,
      toolCalls: 2,
      erroredCalls: 0,
      inputTokens: 100,
      outputTokens: 80,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      costUsd: 0.04,
    }],
    archives: [{
      archiveId: "archive_01",
      streamIds: ["stream_01"],
      firstLocalSequence: 41,
      lastLocalSequence: 42,
      eventCount: 2,
      compression: "gzip",
      algorithm: "aes-256-gcm",
      keyVersion: 1,
      nonceBase64: "AAAAAAAAAAAAAAAA",
      ciphertextDigest: SHA_B,
      ciphertextBase64: "A".repeat(48),
    }],
    liveTransitions: [{
      transitionId: "transition_01",
      streamId: "stream_01",
      revision: 3,
      kind: "active",
      at: "2026-08-01T12:05:00.000Z",
      status: "active",
      awaitingInput: false,
      costUsd: 0.04,
    }],
  };
}

test("compact sync accepts a bounded owner-free idempotent batch", () => {
  assert.deepEqual(parseCompactSyncBatch(batch()), batch());
  assert.equal(COMPACT_SYNC_LIMITS.sessionsPerBatch, 64);
  assert.equal(
    1 +
      COMPACT_SYNC_LIMITS.sessionsPerBatch +
      COMPACT_SYNC_LIMITS.hoursPerBatch +
      COMPACT_SYNC_LIMITS.archivesPerBatch,
    97,
  );
  assert.equal(COMPACT_SYNC_LIMITS.archiveCiphertextBytes, 1024 * 1024);
});

test("owner and membership selectors are never accepted from a client batch", () => {
  const valid = batch();
  assert.equal(parseCompactSyncBatch({ ...valid, ownerId: "home_other" }), null);
  assert.equal(parseCompactSyncBatch({ ...valid, memberId: "member_other" }), null);
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      sessions: [{ ...valid.sessions[0]!, workspaceId: "workspace_other" }],
    }),
    null,
  );
});

test("batch identity, sequence chain, revisions, and record ids are strict", () => {
  const valid = batch();
  assert.equal(parseCompactSyncBatch({ ...valid, sequence: 2 }), null);
  assert.equal(
    parseCompactSyncBatch({ ...valid, previousBatchSha256: SHA_B }),
    null,
  );
  assert.equal(
    parseCompactSyncBatch({ ...valid, sessions: [valid.sessions[0]!, valid.sessions[0]!] }),
    null,
  );
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      sessions: [{ ...valid.sessions[0]!, revision: 0 }],
    }),
    null,
  );
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      archives: [{ ...valid.archives[0]!, eventCount: 3 }],
    }),
    null,
  );
});

test("archive content is opaque authenticated ciphertext with unique nonces", () => {
  const valid = batch();
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      archives: [{ ...valid.archives[0]!, algorithm: "none" }],
    }),
    null,
  );
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      archives: [{ ...valid.archives[0]!, nonceBase64: "AAAA" }],
    }),
    null,
  );
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      archives: [
        valid.archives[0]!,
        { ...valid.archives[0]!, archiveId: "archive_02" },
      ],
    }),
    null,
  );
  const { algorithm: _algorithm, ...unencrypted } = valid.archives[0]!;
  assert.equal(parseCompactSyncBatch({ ...valid, archives: [unencrypted] }), null);
});

test("status, timestamps, hour buckets, and transitions reject contradictions", () => {
  const valid = batch();
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      sessions: [{ ...valid.sessions[0]!, status: "ended" }],
    }),
    null,
  );
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      hours: [{ ...valid.hours[0]!, hour: "2026-08-01T12:30:00.000Z" }],
    }),
    null,
  );
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      liveTransitions: [{
        ...valid.liveTransitions[0]!,
        kind: "completed",
        status: "active",
      }],
    }),
    null,
  );
});

test("empty and oversized batches are rejected before hosted work", () => {
  const valid = batch();
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      sessions: [],
      hours: [],
      archives: [],
      liveTransitions: [],
    }),
    null,
  );
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      sessions: Array.from(
        { length: COMPACT_SYNC_LIMITS.sessionsPerBatch + 1 },
        (_, index) => ({ ...valid.sessions[0]!, streamId: `stream_${index}` }),
      ),
    }),
    null,
  );
  assert.equal(
    parseCompactSyncBatch({
      ...valid,
      archives: [{
        ...valid.archives[0]!,
        ciphertextBase64: "A".repeat(
          Math.ceil((COMPACT_SYNC_LIMITS.archiveCiphertextBytes + 1) / 3) * 4,
        ),
      }],
    }),
    null,
  );
});

test("health compatibility, receipts, and protocol errors are closed contracts", () => {
  const health = { ok: true, compactSync: compactSyncHealthMetadata() };
  assert.deepEqual(parseCompactSyncHealthResponse(health), health);
  assert.equal(
    parseCompactSyncHealthResponse({
      ...health,
      compactSync: { ...health.compactSync, acceptedProtocolVersions: [2] },
    }),
    null,
  );

  const receipt = {
    protocolVersion: 1,
    accepted: true,
    installationId: "install_01",
    sequence: 1,
    batchId: "batch_01",
    batchSha256: SHA_A,
    receivedAt: "2026-08-01T12:07:00.000Z",
    entitlementRevision: 7,
  };
  assert.deepEqual(parseCompactSyncReceipt(receipt), receipt);
  assert.equal(parseCompactSyncReceipt({ ...receipt, accepted: false }), null);
  assert.deepEqual(
    parseCompactSyncErrorResponse({
      error: "compact sync rejected",
      code: "unsupported_protocol_version",
      acceptedProtocolVersions: [1],
    }),
    {
      error: "compact sync rejected",
      code: "unsupported_protocol_version",
      acceptedProtocolVersions: [1],
    },
  );
});

test("entitlement and sync route builders encode opaque ids", () => {
  assert.equal(seorakRoutes.entitlements(), "/entitlements");
  assert.equal(seorakRoutes.compactSyncHealth(), "/sync/health");
  assert.equal(seorakRoutes.compactSyncBatches(), "/sync/v1/batches");
  assert.equal(
    seorakRoutes.compactSyncBatch("batch/a?b"),
    "/sync/v1/batches/batch%2Fa%3Fb",
  );
});

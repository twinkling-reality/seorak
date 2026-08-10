import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  PUBLICATION_ACTIVITY_RANGE_DAYS,
  PUBLICATION_EVIDENCE_RANGE_DAYS,
  PUBLICATION_MANAGEMENT_VERSION,
  PUBLIC_ACTIVITY_FIELDS,
  type OwnerPublicationManifest,
  type PublicActivityPublicationDto,
  type OwnerPublicationStatus,
  type PublicPublicationApplyDelivery,
  type PublicPublicationApplyReceipt,
} from "../src/index.ts";

const disabled = { enabled: false, fields: [] } as const;

test("publication management vocabularies are closed and versioned", () => {
  assert.equal(PUBLICATION_MANAGEMENT_VERSION, "v1");
  assert.deepEqual([...PUBLICATION_EVIDENCE_RANGE_DAYS], [7, 30, 90]);
  assert.deepEqual([...PUBLICATION_ACTIVITY_RANGE_DAYS], [30, 90, 365]);
  assert.deepEqual([...PUBLIC_ACTIVITY_FIELDS], ["calendar", "streak"]);
});

test("the private owner manifest carries selections but no measured values", () => {
  const manifest: OwnerPublicationManifest = {
    apiVersion: "v1",
    commandId: `cmd_${"a".repeat(32)}`,
    expectedRevision: 0,
    profileSlug: "ada",
    profile: { displayName: "Ada" },
    grants: {
      web: { enabled: true, fields: ["displayName"] },
      search: { enabled: true, fields: ["displayName"] },
      api: disabled,
      mcp: disabled,
    },
    activity: null,
    projects: [{
      sourceProjectId: "b".repeat(64),
      projectSlug: "compiler",
      project: { name: "Compiler" },
      grants: {
        web: { enabled: true, fields: ["name"], evidence: ["sessionCount"] },
        search: { enabled: true, fields: ["name"], evidence: [] },
        api: { enabled: false, fields: [], evidence: [] },
        mcp: { enabled: false, fields: [], evidence: [] },
      },
      evidence: {
        fields: ["sessionCount"],
        rangeDays: 30,
        unavailable: "publish-unavailable",
      },
    }],
  };
  assert.equal(manifest.projects[0]?.sourceProjectId.length, 64);
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /"(?:value|sampleSize|generatedAt|freshness|distinctSessionCount)"/,
  );
});

test("activity freezes timezone days and makes an interrupted streak unknown", () => {
  const activity: PublicActivityPublicationDto = {
    apiVersion: "v1",
    publicationVersion: 2,
    publishedAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
    revokedAt: null,
    profileSlug: "ada",
    timeZone: "America/New_York",
    period: { from: "2026-08-01", through: "2026-08-02" },
    grants: { web: { enabled: true, fields: ["calendar", "streak"] }, search: disabled, api: disabled, mcp: disabled },
    days: [
      {
        date: "2026-08-01",
        distinctSessionCount: null,
        active: null,
        coverage: "partial",
        availability: { state: "partial", reason: "not-captured" },
      },
      {
        date: "2026-08-02",
        distinctSessionCount: 1,
        active: true,
        coverage: "complete",
        availability: { state: "available", reason: null },
      },
    ],
    streak: {
      status: "unknown",
      days: null,
      start: null,
      through: "2026-08-02",
      blockedAt: "2026-08-01",
      completeActiveDaysSinceBoundary: 1,
    },
    generatedAt: "2026-08-02T12:00:00.000Z",
    freshness: {
      state: "fresh",
      generatedAt: "2026-08-02T12:00:00.000Z",
      dataThrough: "2026-08-02T11:59:00.000Z",
      staleAt: "2026-08-02T12:05:00.000Z",
    },
  };
  assert.equal(activity.streak.status, "unknown");
  assert.equal(activity.days[0]?.distinctSessionCount, null);
});

test("one full bundle is acknowledged by generation and digest", () => {
  const delivery = {
    apiVersion: "v1",
    operation: "apply",
    deliveryId: `pdl_${"c".repeat(32)}`,
    generation: 1,
    contentDigest: "d".repeat(64),
  } as Pick<PublicPublicationApplyDelivery,
    "apiVersion" | "operation" | "deliveryId" | "generation" | "contentDigest">;
  const receipt: PublicPublicationApplyReceipt = {
    ...delivery,
    disposition: "already-applied",
    appliedAt: "2026-08-02T12:00:01.000Z",
  };
  assert.equal(receipt.contentDigest, delivery.contentDigest);
  assert.equal(receipt.disposition, "already-applied");
});

test("owner delivery status names the actual blocking generation", () => {
  const status: OwnerPublicationStatus = {
    apiVersion: "v1",
    savedRevision: 3,
    generatedVersion: 7,
    appliedVersion: 3,
    blockingGeneration: 4,
    state: "failed",
    operation: "apply",
    attemptCount: 2,
    nextAttemptAt: null,
    lastErrorCode: "publisher_unauthorized",
    appliedAt: null,
  };
  assert.equal(status.blockingGeneration, 4);
  assert.notEqual(status.blockingGeneration, status.generatedVersion);
});

test("only the private command names an internal source project identifier", () => {
  const source = readFileSync(
    new URL("../src/publication-management.ts", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/sourceProjectId:/g) ?? []).length, 1);
  const publicHalf = source.slice(source.indexOf("export interface PublicActivityCalendarDay"));
  assert.doesNotMatch(publicHalf, /sourceProjectId|repoId|ownerId|sessionId|memberId/);
});

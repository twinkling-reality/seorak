import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT_BATCH_SCHEMA_VERSION,
  EVENT_INGEST_ACCEPTED_SCHEMA_VERSIONS,
  EVENT_INGEST_ERROR_CODES,
  isEventIngestErrorCode,
  parseEventIngestErrorResponse,
  parseWorkerHealthResponse,
} from "../src/event-protocol.ts";
import {
  EVENT_BATCH_SCHEMA_VERSION as VALIDATION_SCHEMA_VERSION,
} from "../src/event-validation.ts";

test("event protocol exposes one real parser and a closed error vocabulary", () => {
  assert.equal(EVENT_BATCH_SCHEMA_VERSION, 1);
  assert.equal(VALIDATION_SCHEMA_VERSION, EVENT_BATCH_SCHEMA_VERSION);
  assert.deepEqual(EVENT_INGEST_ACCEPTED_SCHEMA_VERSIONS, [1]);
  assert.deepEqual([...EVENT_INGEST_ERROR_CODES], [
    "unsupported_content_encoding",
    "invalid_json",
    "invalid_batch",
    "unsupported_schema_version",
    "batch_too_large",
    "event_count_limit",
    "invalid_event",
    "session_owner_conflict",
  ]);
  for (const code of EVENT_INGEST_ERROR_CODES) {
    assert.equal(isEventIngestErrorCode(code), true);
  }
  assert.equal(isEventIngestErrorCode("private parser detail"), false);
  assert.equal(isEventIngestErrorCode(null), false);
});

test("health parser accepts only a consistent bounded compatibility shape", () => {
  assert.deepEqual(
    parseWorkerHealthResponse({
      ok: true,
      eventIngest: {
        currentSchemaVersion: 2,
        acceptedSchemaVersions: [2, 1],
      },
    }),
    {
      ok: true,
      eventIngest: {
        currentSchemaVersion: 2,
        acceptedSchemaVersions: [1, 2],
      },
    },
  );
  assert.deepEqual(
    parseWorkerHealthResponse({
      ok: true,
      eventIngest: {
        currentSchemaVersion: 1,
        acceptedSchemaVersions: [1],
      },
      schemaReady: false,
    }),
    {
      ok: true,
      eventIngest: {
        currentSchemaVersion: 1,
        acceptedSchemaVersions: [1],
      },
      schemaReady: false,
    },
  );

  const invalid = [
    { ok: true },
    {
      ok: true,
      eventIngest: { currentSchemaVersion: 1, acceptedSchemaVersions: [] },
    },
    {
      ok: true,
      eventIngest: { currentSchemaVersion: 1, acceptedSchemaVersions: [1, 1] },
    },
    {
      ok: true,
      eventIngest: { currentSchemaVersion: 3, acceptedSchemaVersions: [1, 2, 3] },
    },
    {
      ok: true,
      eventIngest: { currentSchemaVersion: 2, acceptedSchemaVersions: [1] },
    },
    {
      ok: true,
      eventIngest: { currentSchemaVersion: 1.5, acceptedSchemaVersions: [1.5] },
    },
    {
      ok: true,
      eventIngest: {
        currentSchemaVersion: 1,
        acceptedSchemaVersions: [1],
        extra: true,
      },
    },
    {
      ok: true,
      eventIngest: { currentSchemaVersion: 1, acceptedSchemaVersions: [1] },
      extra: true,
    },
    {
      ok: true,
      eventIngest: { currentSchemaVersion: 1, acceptedSchemaVersions: [1] },
      schemaReady: "yes",
    },
  ];
  for (const value of invalid) {
    assert.equal(parseWorkerHealthResponse(value), null);
  }
});

test("ingest error parser preserves only closed bounded failure detail", () => {
  assert.deepEqual(
    parseEventIngestErrorResponse({
      error: "event batch rejected",
      code: "unsupported_schema_version",
      acceptedSchemaVersions: [2],
    }),
    {
      error: "event batch rejected",
      code: "unsupported_schema_version",
      acceptedSchemaVersions: [2],
    },
  );
  assert.deepEqual(
    parseEventIngestErrorResponse({
      error: "event batch rejected",
      code: "unsupported_schema_version",
    }),
    {
      error: "event batch rejected",
      code: "unsupported_schema_version",
    },
  );
  for (const value of [
    { error: "private detail", code: "invalid_batch" },
    { error: "event batch rejected", code: "private_detail" },
    {
      error: "event batch rejected",
      code: "invalid_batch",
      acceptedSchemaVersions: [1],
    },
    {
      error: "event batch rejected",
      code: "unsupported_schema_version",
      acceptedSchemaVersions: [1, 1],
    },
    {
      error: "event batch rejected",
      code: "unsupported_schema_version",
      acceptedSchemaVersions: [1],
      raw: "secret",
    },
  ]) {
    assert.equal(parseEventIngestErrorResponse(value), null);
  }
});

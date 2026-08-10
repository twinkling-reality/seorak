import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shippingStatusPath } from "../src/paths.ts";
import {
  parseShippingStatus,
  readShippingStatus,
  SHIPPING_STATUS_SCHEMA_VERSION,
  writeShippingStatus,
  type ShippingStatusSnapshot,
} from "../src/shipping-status.ts";

let directory: string;
let previousDirectory: string | undefined;

beforeEach(() => {
  previousDirectory = process.env.SEORAK_DIR;
  directory = mkdtempSync(join(tmpdir(), "seorak-shipping-status-"));
  process.env.SEORAK_DIR = directory;
});

afterEach(() => {
  if (previousDirectory === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = previousDirectory;
  rmSync(directory, { recursive: true, force: true });
});

const caughtUp: ShippingStatusSnapshot = {
  schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
  state: "caught-up",
  updatedAt: "2026-07-27T12:00:00.000Z",
  consecutiveFailures: 0,
};

describe("shipping status current contract", () => {
  it("round-trips atomically without leaving a temporary file", async () => {
    await writeShippingStatus(caughtUp);
    expect(readShippingStatus()).toEqual({
      kind: "current",
      snapshot: caughtUp,
    });
    expect(existsSync(`${shippingStatusPath()}.tmp`)).toBe(false);
  });

  it("distinguishes missing from invalid state", () => {
    expect(readShippingStatus()).toEqual({ kind: "missing" });
    writeFileSync(shippingStatusPath(), '{"schemaVersion":0}\n', "utf8");
    expect(readShippingStatus()).toEqual({ kind: "invalid" });
  });

  it("rejects superseded versions, unknown keys, and inconsistent variants", () => {
    expect(parseShippingStatus({ ...caughtUp, schemaVersion: 0 })).toBeNull();
    expect(parseShippingStatus({ ...caughtUp, extra: true })).toBeNull();
    expect(
      parseShippingStatus({ ...caughtUp, consecutiveFailures: 1 }),
    ).toBeNull();
    expect(
      parseShippingStatus({
        ...caughtUp,
        state: "retrying",
        consecutiveFailures: 1,
      }),
    ).toBeNull();
    expect(
      parseShippingStatus({
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "retrying",
        updatedAt: "2026-07-27T12:00:01.000Z",
        consecutiveFailures: 1,
        nextRetryAt: "2026-07-27T12:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      parseShippingStatus({
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "blocked",
        updatedAt: "2026-07-27T12:00:01.000Z",
        consecutiveFailures: 1,
        nextRetryAt: "2026-07-27T12:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      parseShippingStatus({
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "blocked",
        updatedAt: "2026-07-27T12:00:00.000Z",
        consecutiveFailures: 1,
        nextRetryAt: "2026-07-27T12:15:00.000Z",
        httpStatus: 422,
      }),
    ).toMatchObject({
      state: "blocked",
      nextRetryAt: "2026-07-27T12:15:00.000Z",
    });

    expect(
      parseShippingStatus({
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "blocked",
        updatedAt: "2026-07-27T12:00:00.000Z",
        consecutiveFailures: 1,
        protocol: {
          code: "unsupported_schema_version",
          emittedSchemaVersion: 1,
          workerAcceptedSchemaVersions: [2],
        },
      }),
    ).toMatchObject({
      state: "blocked",
      protocol: {
        code: "unsupported_schema_version",
        emittedSchemaVersion: 1,
        workerAcceptedSchemaVersions: [2],
      },
    });
    for (const protocol of [
      {
        code: "private_parser_detail",
        emittedSchemaVersion: 1,
      },
      {
        code: "unsupported_schema_version",
        emittedSchemaVersion: 1,
        workerAcceptedSchemaVersions: [2, 2],
      },
      {
        code: "invalid_batch",
        emittedSchemaVersion: 1,
        workerAcceptedSchemaVersions: [1],
      },
    ]) {
      expect(
        parseShippingStatus({
          schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
          state: "blocked",
          updatedAt: "2026-07-27T12:00:00.000Z",
          consecutiveFailures: 1,
          protocol,
        }),
      ).toBeNull();
    }
  });
});

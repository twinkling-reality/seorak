import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  EVENT_INGEST_ACCEPTED_VERSION_LIMIT,
  isEventIngestErrorCode,
  type EventIngestErrorCode,
} from "@seorak/types";
import type { DeliveryRoute } from "./ingest-queue.ts";
import { shippingStatusPath } from "./paths.ts";

export const SHIPPING_STATUS_SCHEMA_VERSION = 2 as const;

export interface ShippingProtocolFailure {
  code: EventIngestErrorCode;
  emittedSchemaVersion: number;
  /** Absent when the rejecting worker did not publish compatibility metadata. */
  workerAcceptedSchemaVersions?: number[];
}

export type ShippingStatusSnapshot =
  | {
      schemaVersion: typeof SHIPPING_STATUS_SCHEMA_VERSION;
      state: "caught-up";
      updatedAt: string;
      consecutiveFailures: 0;
      /**
       * Where the acknowledged bytes went. OPTIONAL on purpose: a status file
       * written before this field existed stays readable, and an absent route
       * renders as the old wording rather than inventing a claim about a drain
       * nobody recorded. "caught-up" alone never meant delivered.
       */
      route?: DeliveryRoute;
    }
  | {
      schemaVersion: typeof SHIPPING_STATUS_SCHEMA_VERSION;
      state: "retrying";
      updatedAt: string;
      consecutiveFailures: number;
      nextRetryAt: string;
      httpStatus?: number;
    }
  | {
      schemaVersion: typeof SHIPPING_STATUS_SCHEMA_VERSION;
      state: "blocked";
      updatedAt: string;
      consecutiveFailures: number;
      /** Slow self-healing probe for a permanent rejection, absent after stop. */
      nextRetryAt?: string;
      httpStatus?: number;
      protocol?: ShippingProtocolFailure;
    };

export type ShippingStatusRead =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "current"; snapshot: ShippingStatusSnapshot };

const DELIVERY_ROUTES: readonly DeliveryRoute[] = ["worker", "managed", "local"];

function isDeliveryRoute(value: unknown): value is DeliveryRoute {
  return DELIVERY_ROUTES.includes(value as DeliveryRoute);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isFailureCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isHttpStatus(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function isSchemaVersion(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 2_147_483_647
  );
}

function parseProtocolFailure(value: unknown): ShippingProtocolFailure | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      ["code", "emittedSchemaVersion"],
      ["workerAcceptedSchemaVersions"],
    ) ||
    !isEventIngestErrorCode(value.code) ||
    !isSchemaVersion(value.emittedSchemaVersion)
  ) {
    return null;
  }
  if (value.workerAcceptedSchemaVersions === undefined) {
    return {
      code: value.code,
      emittedSchemaVersion: value.emittedSchemaVersion,
    };
  }
  if (
    value.code !== "unsupported_schema_version" ||
    !Array.isArray(value.workerAcceptedSchemaVersions) ||
    value.workerAcceptedSchemaVersions.length === 0 ||
    value.workerAcceptedSchemaVersions.length >
      EVENT_INGEST_ACCEPTED_VERSION_LIMIT ||
    !value.workerAcceptedSchemaVersions.every(isSchemaVersion) ||
    value.workerAcceptedSchemaVersions.some(
      (version, index, versions) =>
        index > 0 && versions[index - 1]! >= version,
    )
  ) {
    return null;
  }
  return {
    code: value.code,
    emittedSchemaVersion: value.emittedSchemaVersion,
    workerAcceptedSchemaVersions: value.workerAcceptedSchemaVersions,
  };
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

/** Strict current local status contract. Unknown or superseded shapes are invalid. */
export function parseShippingStatus(value: unknown): ShippingStatusSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== SHIPPING_STATUS_SCHEMA_VERSION) {
    return null;
  }
  if (!isTimestamp(value.updatedAt)) return null;

  if (value.state === "caught-up") {
    if (
      !hasOnlyKeys(
        value,
        ["schemaVersion", "state", "updatedAt", "consecutiveFailures"],
        ["route"],
      ) ||
      value.consecutiveFailures !== 0 ||
      // Absent is valid and means unknown. A PRESENT route has to be one this
      // build understands: an unrecognised one would otherwise fall through the
      // renderer's cases and print the reassuring wording by default.
      (value.route !== undefined && !isDeliveryRoute(value.route))
    ) {
      return null;
    }
    return value as ShippingStatusSnapshot;
  }

  if (value.state === "retrying") {
    if (
      !hasOnlyKeys(
        value,
        [
          "schemaVersion",
          "state",
          "updatedAt",
          "consecutiveFailures",
          "nextRetryAt",
        ],
        ["httpStatus"],
      ) ||
      !isFailureCount(value.consecutiveFailures) ||
      !isTimestamp(value.nextRetryAt) ||
      Date.parse(value.nextRetryAt) < Date.parse(value.updatedAt) ||
      (value.httpStatus !== undefined && !isHttpStatus(value.httpStatus))
    ) {
      return null;
    }
    return value as ShippingStatusSnapshot;
  }

  if (value.state === "blocked") {
    if (
      !hasOnlyKeys(
        value,
        ["schemaVersion", "state", "updatedAt", "consecutiveFailures"],
        ["nextRetryAt", "httpStatus", "protocol"],
      ) ||
      !isFailureCount(value.consecutiveFailures) ||
      (value.nextRetryAt !== undefined &&
        (!isTimestamp(value.nextRetryAt) ||
          Date.parse(value.nextRetryAt) < Date.parse(value.updatedAt))) ||
      (value.httpStatus !== undefined && !isHttpStatus(value.httpStatus)) ||
      (value.protocol !== undefined &&
        parseProtocolFailure(value.protocol) === null)
    ) {
      return null;
    }
    return value as ShippingStatusSnapshot;
  }

  return null;
}

export function readShippingStatus(): ShippingStatusRead {
  const path = shippingStatusPath();
  if (!existsSync(path)) return { kind: "missing" };
  try {
    const snapshot = parseShippingStatus(JSON.parse(readFileSync(path, "utf8")));
    return snapshot === null
      ? { kind: "invalid" }
      : { kind: "current", snapshot };
  } catch {
    return { kind: "invalid" };
  }
}

/** Atomically replace the content-free local delivery state. */
export async function writeShippingStatus(
  snapshot: ShippingStatusSnapshot,
): Promise<void> {
  const path = shippingStatusPath();
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(snapshot)}\n`, "utf8");
  await rename(temporaryPath, path);
}

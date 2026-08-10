import {
  EVENT_BATCH_SCHEMA_VERSION,
  parseWorkerHealthResponse,
  seorakRoutes,
} from "@seorak/types";
import { readBoundedJsonResponse } from "./bounded-json-response.ts";
import type { DrainEventQueueResult } from "./ingest-queue.ts";

const HEALTH_BODY_LIMIT = 4_096;
const HEALTH_TIMEOUT_MS = 3_000;
const COMPATIBILITY_TTL_MS = 5 * 60_000;

export type WorkerIngestCompatibility =
  | {
      kind: "compatible";
      emittedSchemaVersion: number;
      workerCurrentSchemaVersion: number;
      workerAcceptedSchemaVersions: number[];
    }
  | {
      kind: "incompatible";
      emittedSchemaVersion: number;
      workerCurrentSchemaVersion: number;
      workerAcceptedSchemaVersions: number[];
    }
  | { kind: "unknown" };

function parseCompatibility(
  value: unknown,
  emittedSchemaVersion: number,
): WorkerIngestCompatibility {
  const parsed = parseWorkerHealthResponse(value);
  if (parsed === null) return { kind: "unknown" };
  const workerCurrentSchemaVersion =
    parsed.eventIngest.currentSchemaVersion;
  const workerAcceptedSchemaVersions = [
    ...parsed.eventIngest.acceptedSchemaVersions,
  ];
  const result = {
    emittedSchemaVersion,
    workerCurrentSchemaVersion,
    workerAcceptedSchemaVersions,
  };
  return workerAcceptedSchemaVersions.includes(emittedSchemaVersion)
    ? { kind: "compatible", ...result }
    : { kind: "incompatible", ...result };
}

function normalizedWorkerUrl(workerUrl: string): string {
  const url = new URL(workerUrl);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

/**
 * Probe the worker's open compatibility metadata. Unknown is deliberately
 * permissive: an older worker has no eventIngest field, so POST /events remains
 * the backwards-compatible authority and returns a closed rejection code if
 * the versions truly disagree.
 */
export async function probeWorkerIngestCompatibility(
  workerUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = HEALTH_TIMEOUT_MS,
  emittedSchemaVersion: number = EVENT_BATCH_SCHEMA_VERSION,
  shutdownSignal?: AbortSignal,
): Promise<WorkerIngestCompatibility> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("timeoutMs must be a positive integer");
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = shutdownSignal
    ? AbortSignal.any([shutdownSignal, timeout])
    : timeout;
  try {
    const requestInit = {
      signal,
      cache: "no-store" as const,
    };
    const response = await fetchImpl(
      `${normalizedWorkerUrl(workerUrl)}${seorakRoutes.health()}`,
      requestInit,
    );
    if (!response.ok) return { kind: "unknown" };
    return parseCompatibility(
      await readBoundedJsonResponse(response, HEALTH_BODY_LIMIT),
      emittedSchemaVersion,
    );
  } catch {
    return { kind: "unknown" };
  }
}

/** Delivery-loop-owned, URL-and-schema-keyed compatibility cache. */
export class WorkerIngestCompatibilityGate {
  readonly #workerUrl: string;
  readonly #emittedSchemaVersion: number;
  readonly #cacheKey: string;
  readonly #fetchImpl: typeof fetch;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #signal: (() => AbortSignal | undefined) | undefined;
  #cached:
    | {
        key: string;
        expiresAt: number;
        value: WorkerIngestCompatibility;
      }
    | undefined;
  #pending: Promise<WorkerIngestCompatibility> | undefined;

  constructor(options: {
    workerUrl: string;
    emittedSchemaVersion?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
    ttlMs?: number;
    signal?: () => AbortSignal | undefined;
  }) {
    this.#workerUrl = normalizedWorkerUrl(options.workerUrl);
    this.#emittedSchemaVersion =
      options.emittedSchemaVersion ?? EVENT_BATCH_SCHEMA_VERSION;
    if (
      !Number.isSafeInteger(this.#emittedSchemaVersion) ||
      this.#emittedSchemaVersion < 1
    ) {
      throw new Error("emittedSchemaVersion must be a positive integer");
    }
    this.#cacheKey = `${this.#workerUrl}|${this.#emittedSchemaVersion}`;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => performance.now());
    this.#ttlMs = options.ttlMs ?? COMPATIBILITY_TTL_MS;
    this.#signal = options.signal;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs < 1) {
      throw new Error("ttlMs must be a positive integer");
    }
  }

  async check(): Promise<WorkerIngestCompatibility> {
    const now = this.#now();
    if (
      this.#cached?.key === this.#cacheKey &&
      now < this.#cached.expiresAt
    ) {
      return this.#cached.value;
    }
    if (this.#pending) return this.#pending;
    this.#pending = (async () => {
      const value = await probeWorkerIngestCompatibility(
        this.#workerUrl,
        this.#fetchImpl,
        HEALTH_TIMEOUT_MS,
        this.#emittedSchemaVersion,
        this.#signal?.(),
      );
      this.#cached = {
        key: this.#cacheKey,
        expiresAt: this.#now() + this.#ttlMs,
        value,
      };
      return value;
    })();
    try {
      return await this.#pending;
    } finally {
      this.#pending = undefined;
    }
  }

  invalidate(): void {
    this.#cached = undefined;
  }
}

export interface IngestCompatibilityGate {
  check(): Promise<WorkerIngestCompatibility>;
  invalidate(): void;
}

/**
 * Build the drain function owned by EventDeliveryLoop. A proven empty schema
 * intersection stops before the queue reader; unknown legacy health metadata
 * still lets POST /events act as the final authority.
 */
export function createCompatibilityCheckedDrain(options: {
  gate: IngestCompatibilityGate;
  drain: () => Promise<DrainEventQueueResult>;
  log?: (message: string) => void;
}): () => Promise<DrainEventQueueResult> {
  const log = options.log ?? console.error;
  return async () => {
    const compatibility = await options.gate.check();
    if (compatibility.kind === "incompatible") {
      log(
        `[seorak/collector] emitted event schema ${compatibility.emittedSchemaVersion} is not accepted by worker (accepts ${compatibility.workerAcceptedSchemaVersions.join(", ")}); queue retained`,
      );
      return {
        acceptedEvents: 0,
        acceptedChunks: 0,
        rejectedLocalRecords: 0,
        blocked: true,
        retriable: false,
        protocol: {
          code: "unsupported_schema_version",
          emittedSchemaVersion: compatibility.emittedSchemaVersion,
          workerAcceptedSchemaVersions:
            compatibility.workerAcceptedSchemaVersions,
        },
      };
    }

    const result = await options.drain();
    if (
      result.blocked &&
      result.protocol?.code === "unsupported_schema_version"
    ) {
      options.gate.invalidate();
    }
    return result;
  };
}

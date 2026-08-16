import {
  seorakRoutes,
  type EventIngestErrorCode,
} from "@seorak/types";
import {
  readNextEventChunk,
  writeOffset,
  type EventLogChunk,
} from "./log-reader.ts";
import { shipBatch, type ShipOptions, type ShipResult } from "./ship.ts";

export interface DrainEventQueueOptions {
  workerUrl: string;
  collectorVersion: string;
  deviceId: string;
  ingestKey?: string;
  signal?: AbortSignal;
  onAccepted?: () => Promise<void>;
}

/**
 * Where a drain's acknowledged bytes actually went.
 *
 * `acceptedEvents: 0` cannot answer this on its own, and that ambiguity is what
 * hid an eight-day delivery outage: a drain with nothing new to ship and a drain
 * that shipped nothing because it had nowhere to ship BOTH return zero without
 * erroring. Only the caller knows which, so it says so rather than leaving the
 * status to infer health from the absence of a failure.
 */
export type DeliveryRoute =
  /** Posted to the worker's `/events`. */
  | "worker"
  /** Handed to an activated managed compact-sync cell. */
  | "managed"
  /** Acknowledged against local history, which is the authority. Nothing left
   *  this machine, so it is never a delivery and must not read as one. */
  | "local";

interface DrainEventQueueSummary {
  acceptedEvents: number;
  acceptedChunks: number;
  rejectedLocalRecords: number;
  /** Absent on a result from before this field existed; readers treat that as
   *  unknown rather than assuming a delivery happened. */
  route?: DeliveryRoute;
}

export interface IngestProtocolFailure {
  code: EventIngestErrorCode;
  emittedSchemaVersion: number;
  /** Absent when a legacy worker rejected the schema without advertising. */
  workerAcceptedSchemaVersions?: number[];
}

export type DrainEventQueueResult = DrainEventQueueSummary &
  (
    | { blocked: false }
    | {
        blocked: true;
        status?: number;
        retriable: boolean;
        retryAfterMs?: number;
        protocol?: IngestProtocolFailure;
      }
  );

export interface DrainEventQueueDependencies {
  readChunk: (options: {
    collectorVersion: string;
    deviceId: string;
  }) => Promise<EventLogChunk>;
  ship: (options: ShipOptions) => Promise<ShipResult>;
  persistOffset: (offset: number, generation: number) => Promise<void>;
}

const productionDependencies: DrainEventQueueDependencies = {
  readChunk: readNextEventChunk,
  ship: shipBatch,
  persistOffset: writeOffset,
};

/**
 * Drain the active log generation in sequential, independently acknowledged chunks.
 * A 2xx advances exactly one chunk. Network/5xx behavior remains owned by
 * shipBatch; every failed response retains the valid record offset. Permanent
 * 4xx stops, 429 remains retriable, and 413/422 is called out as protocol drift.
 */
export async function drainEventQueue(
  options: DrainEventQueueOptions,
  dependencies: DrainEventQueueDependencies = productionDependencies,
): Promise<DrainEventQueueResult> {
  let acceptedEvents = 0;
  let acceptedChunks = 0;
  let rejectedLocalRecords = 0;

  while (true) {
    const chunk = await dependencies.readChunk({
      collectorVersion: options.collectorVersion,
      deviceId: options.deviceId,
    });
    rejectedLocalRecords += chunk.rejected;

    if (chunk.batch.events.length === 0) {
      if (chunk.nextOffset > chunk.startOffset) {
        // Every skipped record was fsynced to the rejection checkpoint first.
        await dependencies.persistOffset(chunk.nextOffset, chunk.generation);
        continue;
      }
      return {
        acceptedEvents,
        acceptedChunks,
        rejectedLocalRecords,
        route: "worker",
        blocked: false,
      };
    }

    const result = await dependencies.ship({
      url: `${options.workerUrl}${seorakRoutes.events()}`,
      body: chunk.body,
      ...(options.ingestKey ? { ingestKey: options.ingestKey } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!result.ok) {
      const protocol = result.rejection
        ? {
            code: result.rejection.code,
            emittedSchemaVersion: chunk.batch.schemaVersion,
            ...(result.rejection.workerAcceptedSchemaVersions
              ? {
                  workerAcceptedSchemaVersions:
                    result.rejection.workerAcceptedSchemaVersions,
                }
              : {}),
          }
        : undefined;
      if (protocol?.code === "unsupported_schema_version") {
        const accepted =
          protocol.workerAcceptedSchemaVersions === undefined
            ? "worker did not advertise accepted versions"
            : `worker accepts ${protocol.workerAcceptedSchemaVersions.join(", ")}`;
        console.error(
          `[seorak/collector] worker rejected emitted event schema ${protocol.emittedSchemaVersion} (${accepted}); offset retained`,
        );
      } else if (protocol) {
        console.error(
          `[seorak/collector] worker rejected a locally valid event chunk (${protocol.code}, HTTP ${result.status}); protocol drift, offset retained`,
        );
      } else if (result.status === 413 || result.status === 422) {
        console.error(
          `[seorak/collector] worker rejected a locally valid event chunk (HTTP ${result.status}); protocol drift, offset retained`,
        );
      } else {
        const detail = result.retriable
          ? `transient delivery failure after ${result.attempts} attempt(s) (${result.error ?? `HTTP ${result.status}`})`
          : `worker rejected the batch (HTTP ${result.status})`;
        console.error(
          `[seorak/collector] flush failed; offset retained - ${detail}`,
        );
      }
      return {
        acceptedEvents,
        acceptedChunks,
        rejectedLocalRecords,
        route: "worker",
        blocked: true,
        ...(result.status !== undefined ? { status: result.status } : {}),
        retriable: result.retriable,
        ...(result.retryAfterMs !== undefined
          ? { retryAfterMs: result.retryAfterMs }
          : {}),
        ...(protocol ? { protocol } : {}),
      };
    }

    await dependencies.persistOffset(chunk.nextOffset, chunk.generation);
    acceptedEvents += chunk.batch.events.length;
    acceptedChunks += 1;
    await options.onAccepted?.();
    console.log(
      `[seorak/collector] shipped ${chunk.batch.events.length} events`,
    );
  }
}

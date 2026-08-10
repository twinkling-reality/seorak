import { type EventBatch, type SessionEvent } from "@seorak/types";
import { EVENT_BATCH_SCHEMA_VERSION } from "@seorak/types/event-validation";
import { describe, expect, it, vi } from "vitest";
import {
  drainEventQueue,
  type DrainEventQueueDependencies,
} from "../src/ingest-queue.ts";
import type { EventLogChunk } from "../src/log-reader.ts";

function prompt(id: string): SessionEvent {
  return {
    kind: "session.prompt",
    eventId: id,
    sessionId: "session-1",
    at: "2026-07-27T12:00:00.000Z",
  };
}

function chunk(
  startOffset: number,
  nextOffset: number,
  events: SessionEvent[],
  rejected = 0,
): EventLogChunk {
  const batch: EventBatch = {
    schemaVersion: EVENT_BATCH_SCHEMA_VERSION,
    collectorVersion: "0.0.0",
    deviceId: "device-1",
    events,
  };
  return {
    generation: 0,
    batch,
    body: JSON.stringify(batch),
    startOffset,
    nextOffset,
    rejected,
  };
}

function dependencies(options: {
  chunks: EventLogChunk[];
  statuses?: number[];
  rejection?: {
    code: "unsupported_schema_version";
    workerAcceptedSchemaVersions?: number[];
  };
  rejections?: Array<
    | {
        code: "unsupported_schema_version";
        workerAcceptedSchemaVersions?: number[];
      }
    | undefined
  >;
}) {
  const queue = [...options.chunks];
  const statuses = [...(options.statuses ?? [])];
  const rejections = [...(options.rejections ?? [])];
  const offsets: number[] = [];
  const bodies: string[] = [];
  const deps: DrainEventQueueDependencies = {
    readChunk: async () =>
      queue.shift() ?? chunk(offsets.at(-1) ?? 0, offsets.at(-1) ?? 0, []),
    ship: async (request) => {
      bodies.push(request.body);
      const status = statuses.shift() ?? 200;
      const rejection =
        rejections.length > 0 ? rejections.shift() : options.rejection;
      return {
        ok: status >= 200 && status < 300,
        status,
        attempts: 1,
        retriable: status >= 500 || status === 429,
        ...(rejection ? { rejection } : {}),
      };
    },
    persistOffset: async (offset) => {
      offsets.push(offset);
    },
  };
  return { deps, offsets, bodies };
}

const options = {
  workerUrl: "http://worker",
  collectorVersion: "0.0.0",
  deviceId: "device-1",
};

describe("sequential event queue drain", () => {
  it("acknowledges each chunk independently and drains until empty", async () => {
    const { deps, offsets, bodies } = dependencies({
      chunks: [
        chunk(0, 100, [prompt("e1")]),
        chunk(100, 200, [prompt("e2")]),
        chunk(200, 200, []),
      ],
    });

    const result = await drainEventQueue(options, deps);
    expect(result).toEqual({
      acceptedEvents: 2,
      acceptedChunks: 2,
      rejectedLocalRecords: 0,
      blocked: false,
    });
    expect(offsets).toEqual([100, 200]);
    expect(
      bodies.map(
        (body) => (JSON.parse(body) as EventBatch).schemaVersion,
      ),
    ).toEqual([1, 1]);
  });

  it("retains the failed chunk offset after an earlier chunk was acknowledged", async () => {
    const { deps, offsets } = dependencies({
      chunks: [
        chunk(0, 100, [prompt("e1")]),
        chunk(100, 200, [prompt("e2")]),
      ],
      statuses: [200, 500],
    });

    const result = await drainEventQueue(options, deps);
    expect(result.blocked).toBe(true);
    expect(result.status).toBe(500);
    expect(result.retriable).toBe(true);
    expect(offsets).toEqual([100]);
  });

  it("preserves a 429 as retriable without advancing the offset", async () => {
    const { deps, offsets } = dependencies({
      chunks: [chunk(0, 100, [prompt("e1")])],
      statuses: [429],
    });
    const result = await drainEventQueue(options, deps);
    expect(result).toMatchObject({
      blocked: true,
      status: 429,
      retriable: true,
    });
    expect(offsets).toEqual([]);
  });

  it.each([413, 422])(
    "treats a locally valid server %s as protocol drift and retains the offset",
    async (status) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { deps, offsets } = dependencies({
          chunks: [chunk(0, 100, [prompt("e1")])],
          statuses: [status],
        });
        const result = await drainEventQueue(options, deps);
        expect(result).toMatchObject({
          blocked: true,
          status,
          retriable: false,
        });
        expect(offsets).toEqual([]);
        expect(error).toHaveBeenCalledWith(
          expect.stringContaining("protocol drift"),
        );
      } finally {
        error.mockRestore();
      }
    },
  );

  it("retains exact advertised schema incompatibility without moving the offset", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { deps, offsets } = dependencies({
        chunks: [chunk(0, 100, [prompt("e1")])],
        statuses: [400],
        rejection: {
          code: "unsupported_schema_version",
          workerAcceptedSchemaVersions: [2],
        },
      });
      const result = await drainEventQueue(options, deps);
      expect(result).toMatchObject({
        blocked: true,
        status: 400,
        retriable: false,
        protocol: {
          code: "unsupported_schema_version",
          emittedSchemaVersion: 1,
          workerAcceptedSchemaVersions: [2],
        },
      });
      expect(offsets).toEqual([]);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(
          "rejected emitted event schema 1 (worker accepts 2)",
        ),
      );
    } finally {
      error.mockRestore();
    }
  });

  it("does not invent accepted versions for a legacy schema rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { deps } = dependencies({
        chunks: [chunk(0, 100, [prompt("e1")])],
        statuses: [400],
        rejection: { code: "unsupported_schema_version" },
      });
      const result = await drainEventQueue(options, deps);
      expect(result).toMatchObject({
        blocked: true,
        protocol: {
          code: "unsupported_schema_version",
          emittedSchemaVersion: 1,
        },
      });
      if (result.blocked) {
        expect(result.protocol?.workerAcceptedSchemaVersions).toBeUndefined();
      }
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("worker did not advertise accepted versions"),
      );
    } finally {
      error.mockRestore();
    }
  });

  it("advances accepted chunks but pins the first chunk rejected after a worker change", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { deps, offsets } = dependencies({
        chunks: [
          chunk(0, 100, [prompt("e1")]),
          chunk(100, 200, [prompt("e2")]),
        ],
        statuses: [200, 400],
        rejections: [
          undefined,
          {
            code: "unsupported_schema_version",
            workerAcceptedSchemaVersions: [2],
          },
        ],
      });
      const result = await drainEventQueue(options, deps);
      expect(offsets).toEqual([100]);
      expect(result).toMatchObject({
        acceptedEvents: 1,
        acceptedChunks: 1,
        blocked: true,
        protocol: {
          code: "unsupported_schema_version",
          emittedSchemaVersion: 1,
          workerAcceptedSchemaVersions: [2],
        },
      });
    } finally {
      error.mockRestore();
    }
  });

  it("advances past a journaled-only prefix before draining later valid data", async () => {
    const { deps, offsets } = dependencies({
      chunks: [
        chunk(0, 50, [], 1),
        chunk(50, 100, [prompt("e1")]),
        chunk(100, 100, []),
      ],
    });
    const result = await drainEventQueue(options, deps);
    expect(result.rejectedLocalRecords).toBe(1);
    expect(offsets).toEqual([50, 100]);
  });
});

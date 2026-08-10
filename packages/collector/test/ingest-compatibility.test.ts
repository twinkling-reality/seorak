import { EVENT_BATCH_SCHEMA_VERSION } from "@seorak/types";
import { describe, expect, it, vi } from "vitest";
import {
  createCompatibilityCheckedDrain,
  WorkerIngestCompatibilityGate,
  probeWorkerIngestCompatibility,
} from "../src/ingest-compatibility.ts";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("worker event ingest compatibility probe", () => {
  it("accepts an advertised intersection and normalized worker URL", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        ok: true,
        eventIngest: {
          currentSchemaVersion: 2,
          acceptedSchemaVersions: [2, EVENT_BATCH_SCHEMA_VERSION],
        },
      }),
    );
    await expect(
      probeWorkerIngestCompatibility(
        "https://worker.test/",
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toEqual({
      kind: "compatible",
      emittedSchemaVersion: EVENT_BATCH_SCHEMA_VERSION,
      workerCurrentSchemaVersion: 2,
      workerAcceptedSchemaVersions: [1, 2],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://worker.test/health",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        cache: "no-store",
      }),
    );
  });

  it("blocks only a proven version mismatch", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        ok: true,
        eventIngest: {
          currentSchemaVersion: 2,
          acceptedSchemaVersions: [2],
        },
      }),
    );
    await expect(
      probeWorkerIngestCompatibility(
        "https://worker.test",
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toEqual({
      kind: "incompatible",
      emittedSchemaVersion: EVENT_BATCH_SCHEMA_VERSION,
      workerCurrentSchemaVersion: 2,
      workerAcceptedSchemaVersions: [2],
    });
  });

  it("leaves old, malformed, oversized, and unavailable health responses unknown", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => json({ ok: true }),
      async () =>
        json({
          ok: true,
          eventIngest: {
            currentSchemaVersion: 2,
            acceptedSchemaVersions: [1],
          },
        }),
      async () =>
        json({
          ok: true,
          eventIngest: {
            currentSchemaVersion: 1,
            acceptedSchemaVersions: [1, 1],
          },
        }),
      async () => new Response("x".repeat(4_097), { status: 200 }),
      async () => json({ error: "not ready" }, 503),
      async () => {
        throw new Error("offline");
      },
    ];
    for (const response of cases) {
      await expect(
        probeWorkerIngestCompatibility(
          "https://worker.test",
          response as unknown as typeof fetch,
        ),
      ).resolves.toEqual({ kind: "unknown" });
    }
  });

  it("bounds a stalled health probe with the fetch deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        async (_url: string, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      const pending = probeWorkerIngestCompatibility(
        "https://worker.test",
        fetchImpl as unknown as typeof fetch,
        10,
      );
      await vi.advanceTimersByTimeAsync(10);
      await expect(pending).resolves.toEqual({ kind: "unknown" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WorkerIngestCompatibilityGate", () => {
  it("caches one probe for the TTL and supports rejection-driven invalidation", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn(async () =>
      json({
        ok: true,
        eventIngest: {
          currentSchemaVersion: EVENT_BATCH_SCHEMA_VERSION,
          acceptedSchemaVersions: [EVENT_BATCH_SCHEMA_VERSION],
        },
      }),
    );
    const gate = new WorkerIngestCompatibilityGate({
      workerUrl: "https://worker.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      ttlMs: 5_000,
    });

    expect((await gate.check()).kind).toBe("compatible");
    expect((await gate.check()).kind).toBe("compatible");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 5_000;
    await gate.check();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    gate.invalidate();
    await gate.check();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("coalesces concurrent probes and keys the verdict to the emitted schema", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await waiting;
      return json({
        ok: true,
        eventIngest: {
          currentSchemaVersion: 2,
          acceptedSchemaVersions: [1, 2],
        },
      });
    });
    const gate = new WorkerIngestCompatibilityGate({
      workerUrl: "https://worker.test/",
      emittedSchemaVersion: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const first = gate.check();
    const second = gate.check();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        kind: "compatible",
        emittedSchemaVersion: 2,
        workerCurrentSchemaVersion: 2,
        workerAcceptedSchemaVersions: [1, 2],
      },
      {
        kind: "compatible",
        emittedSchemaVersion: 2,
        workerCurrentSchemaVersion: 2,
        workerAcceptedSchemaVersions: [1, 2],
      },
    ]);
  });

  it("rejects a non-positive cache TTL", () => {
    expect(
      () =>
        new WorkerIngestCompatibilityGate({
          workerUrl: "https://worker.test",
          ttlMs: 0,
        }),
    ).toThrow(/positive integer/);
  });
});

describe("compatibility-checked event drain", () => {
  const caughtUp = {
    acceptedEvents: 0,
    acceptedChunks: 0,
    rejectedLocalRecords: 0,
    blocked: false as const,
  };

  it("performs zero queue work on a proven empty intersection", async () => {
    const drain = vi.fn(async () => caughtUp);
    const log = vi.fn();
    const checked = createCompatibilityCheckedDrain({
      gate: {
        check: async () => ({
          kind: "incompatible",
          emittedSchemaVersion: 1,
          workerCurrentSchemaVersion: 2,
          workerAcceptedSchemaVersions: [2],
        }),
        invalidate: vi.fn(),
      },
      drain,
      log,
    });

    await expect(checked()).resolves.toEqual({
      acceptedEvents: 0,
      acceptedChunks: 0,
      rejectedLocalRecords: 0,
      blocked: true,
      retriable: false,
      protocol: {
        code: "unsupported_schema_version",
        emittedSchemaVersion: 1,
        workerAcceptedSchemaVersions: [2],
      },
    });
    expect(drain).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("schema 1 is not accepted"),
    );
  });

  it("lets unknown legacy health defer to POST and invalidates after rejection", async () => {
    const invalidate = vi.fn();
    const result = {
      acceptedEvents: 0,
      acceptedChunks: 0,
      rejectedLocalRecords: 0,
      blocked: true as const,
      status: 400,
      retriable: false,
      protocol: {
        code: "unsupported_schema_version" as const,
        emittedSchemaVersion: 1,
      },
    };
    const drain = vi.fn(async () => result);
    const checked = createCompatibilityCheckedDrain({
      gate: {
        check: async () => ({ kind: "unknown" }),
        invalidate,
      },
      drain,
    });

    await expect(checked()).resolves.toBe(result);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("invalidates cached compatibility when the authoritative POST sees rollback", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          ok: true,
          eventIngest: {
            currentSchemaVersion: 1,
            acceptedSchemaVersions: [1],
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          ok: true,
          eventIngest: {
            currentSchemaVersion: 2,
            acceptedSchemaVersions: [2],
          },
        }),
      );
    const gate = new WorkerIngestCompatibilityGate({
      workerUrl: "https://worker.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const rejected = {
      acceptedEvents: 0,
      acceptedChunks: 0,
      rejectedLocalRecords: 0,
      blocked: true as const,
      retriable: false,
      protocol: {
        code: "unsupported_schema_version" as const,
        emittedSchemaVersion: 1,
        workerAcceptedSchemaVersions: [2],
      },
    };
    const drain = vi.fn(async () => rejected);
    const checked = createCompatibilityCheckedDrain({
      gate,
      drain,
      log: vi.fn(),
    });

    await expect(checked()).resolves.toBe(rejected);
    await expect(checked()).resolves.toMatchObject({
      blocked: true,
      protocol: {
        code: "unsupported_schema_version",
        workerAcceptedSchemaVersions: [2],
      },
    });
    expect(drain).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rechecks a cached incompatibility after expiry and resumes after expansion", async () => {
    let now = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          ok: true,
          eventIngest: {
            currentSchemaVersion: 2,
            acceptedSchemaVersions: [2],
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          ok: true,
          eventIngest: {
            currentSchemaVersion: 2,
            acceptedSchemaVersions: [1, 2],
          },
        }),
      );
    const gate = new WorkerIngestCompatibilityGate({
      workerUrl: "https://worker.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
      ttlMs: 5_000,
    });
    const drain = vi.fn(async () => caughtUp);
    const checked = createCompatibilityCheckedDrain({
      gate,
      drain,
      log: vi.fn(),
    });

    expect((await checked()).blocked).toBe(true);
    expect(drain).not.toHaveBeenCalled();
    now = 5_000;
    await expect(checked()).resolves.toBe(caughtUp);
    expect(drain).toHaveBeenCalledTimes(1);
  });
});

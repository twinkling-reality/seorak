import { describe, expect, it, vi } from "vitest";
import {
  BacklogRetryController,
  retryDelayMs,
} from "../src/backlog-retry.ts";
import type { DrainEventQueueResult } from "../src/ingest-queue.ts";
import type { ShippingStatusSnapshot } from "../src/shipping-status.ts";

const caughtUp: DrainEventQueueResult = {
  acceptedEvents: 0,
  acceptedChunks: 0,
  rejectedLocalRecords: 0,
  blocked: false,
};

function blocked(
  retriable: boolean,
  status?: number,
  retryAfterMs?: number,
): DrainEventQueueResult {
  return {
    acceptedEvents: 0,
    acceptedChunks: 0,
    rejectedLocalRecords: 0,
    blocked: true,
    retriable,
    ...(status !== undefined ? { status } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

function harness() {
  const statuses: ShippingStatusSnapshot[] = [];
  const timers: Array<{
    callback: () => void;
    delayMs: number;
    cleared: boolean;
  }> = [];
  const attempt = vi.fn(async () => {});
  const controller = new BacklogRetryController({
    attempt,
    persistStatus: async (status) => {
      statuses.push(status);
    },
    baseDelayMs: 1_000,
    maxDelayMs: 8_000,
    now: () => Date.parse("2026-07-27T12:00:00.000Z"),
    random: () => 0,
    setTimer: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as (typeof timers)[number]).cleared = true;
    },
  });
  return { controller, statuses, timers, attempt };
}

describe("BacklogRetryController", () => {
  it("schedules one jittered retry for a transient failure", async () => {
    const { controller, statuses, timers, attempt } = harness();
    await controller.observe(blocked(true, 503));

    expect(timers).toHaveLength(1);
    expect(timers[0]!.delayMs).toBe(500);
    expect(statuses.at(-1)).toMatchObject({
      state: "retrying",
      consecutiveFailures: 1,
      httpStatus: 503,
      nextRetryAt: "2026-07-27T12:00:00.500Z",
    });

    timers[0]!.callback();
    await Promise.resolve();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("backs off across failures and resets only after catching up", async () => {
    const { controller, statuses, timers } = harness();
    await controller.observe(blocked(true));
    await controller.observe(blocked(true));
    expect(timers.map((timer) => timer.delayMs)).toEqual([500, 1_000]);
    expect(timers[0]!.cleared).toBe(true);

    await controller.observe(caughtUp);
    expect(statuses.at(-1)).toMatchObject({
      state: "caught-up",
      consecutiveFailures: 0,
    });

    await controller.observe(blocked(true));
    expect(timers.at(-1)!.delayMs).toBe(500);
  });

  it("honors a bounded server retry delay over local jitter", async () => {
    const { controller, timers } = harness();
    await controller.observe(blocked(true, 429, 60_000));
    expect(timers[0]!.delayMs).toBe(60_000);
  });

  it("persists a permanent 4xx as blocked and probes it at the slow ceiling", async () => {
    const { controller, statuses, timers } = harness();
    await controller.observe(blocked(false, 401));
    expect(timers).toHaveLength(1);
    expect(timers[0]!.delayMs).toBe(8_000);
    expect(statuses.at(-1)).toMatchObject({
      state: "blocked",
      consecutiveFailures: 1,
      httpStatus: 401,
      nextRetryAt: "2026-07-27T12:00:08.000Z",
    });
  });

  it("persists closed protocol detail and clears it after recovery", async () => {
    const { controller, statuses } = harness();
    await controller.observe({
      ...blocked(false, 400),
      protocol: {
        code: "unsupported_schema_version",
        emittedSchemaVersion: 1,
        workerAcceptedSchemaVersions: [2],
      },
    });
    expect(statuses.at(-1)).toMatchObject({
      state: "blocked",
      protocol: {
        code: "unsupported_schema_version",
        emittedSchemaVersion: 1,
        workerAcceptedSchemaVersions: [2],
      },
    });

    await controller.observe(caughtUp);
    expect(statuses.at(-1)).toEqual({
      schemaVersion: 2,
      state: "caught-up",
      updatedAt: "2026-07-27T12:00:00.000Z",
      consecutiveFailures: 0,
    });
  });

  it("cancels a pending retry on an earlier attempt or shutdown", async () => {
    const { controller, timers } = harness();
    await controller.observe(blocked(true));
    controller.beginAttempt();
    expect(timers[0]!.cleared).toBe(true);

    await controller.observe(blocked(true));
    controller.stop();
    expect(timers[1]!.cleared).toBe(true);
  });
});

describe("retryDelayMs", () => {
  it("uses half-to-full jitter and caps exponential growth", () => {
    expect(
      retryDelayMs({
        consecutiveFailures: 1,
        baseDelayMs: 1_000,
        maxDelayMs: 8_000,
        random: 0,
      }),
    ).toBe(500);
    expect(
      retryDelayMs({
        consecutiveFailures: 20,
        baseDelayMs: 1_000,
        maxDelayMs: 8_000,
        random: 1,
      }),
    ).toBe(8_000);
  });
});

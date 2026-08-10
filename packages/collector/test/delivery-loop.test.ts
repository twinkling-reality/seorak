import { describe, expect, it, vi } from "vitest";
import { EventDeliveryLoop } from "../src/delivery-loop.ts";
import type { DrainEventQueueResult } from "../src/ingest-queue.ts";
import type { ShippingStatusSnapshot } from "../src/shipping-status.ts";

const caughtUp: DrainEventQueueResult = {
  acceptedEvents: 0,
  acceptedChunks: 0,
  rejectedLocalRecords: 0,
  blocked: false,
};

const transientFailure: DrainEventQueueResult = {
  acceptedEvents: 0,
  acceptedChunks: 0,
  rejectedLocalRecords: 0,
  blocked: true,
  status: 503,
  retriable: true,
};

function harness(results: DrainEventQueueResult[]) {
  const queue = [...results];
  const statuses: ShippingStatusSnapshot[] = [];
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  const drain = vi.fn(async () => queue.shift() ?? caughtUp);
  const loop = new EventDeliveryLoop({
    drain,
    persistStatus: async (status) => {
      statuses.push(status);
    },
    retry: {
      baseDelayMs: 1_000,
      maxDelayMs: 8_000,
      now: () => Date.parse("2026-07-27T12:00:00.000Z"),
      random: () => 0,
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs };
        timers.push(timer);
        return timer;
      },
      clearTimer: () => {},
    },
  });
  return { loop, drain, statuses, timers };
}

describe("EventDeliveryLoop", () => {
  it("retries a final transient failure without another file event", async () => {
    const { loop, drain, statuses, timers } = harness([
      transientFailure,
      caughtUp,
    ]);
    await loop.trigger();
    expect(drain).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
    expect(statuses.at(-1)?.state).toBe("retrying");

    timers[0]!.callback();
    await vi.waitFor(() => {
      expect(drain).toHaveBeenCalledTimes(2);
      expect(statuses.at(-1)?.state).toBe("caught-up");
    });
  });

  it("keeps a permanent 4xx blocked while scheduling a slow recovery probe", async () => {
    const { loop, drain, statuses, timers } = harness([
      { ...transientFailure, status: 401, retriable: false },
      caughtUp,
    ]);
    await loop.trigger();
    expect(timers).toHaveLength(1);
    expect(timers[0]!.delayMs).toBe(8_000);
    expect(statuses.at(-1)).toMatchObject({
      state: "blocked",
      httpStatus: 401,
      nextRetryAt: "2026-07-27T12:00:08.000Z",
    });

    await Promise.all([loop.trigger(), loop.trigger()]);
    expect(drain).toHaveBeenCalledTimes(1);

    timers[0]!.callback();
    await vi.waitFor(() => {
      expect(drain).toHaveBeenCalledTimes(2);
      expect(statuses.at(-1)?.state).toBe("caught-up");
    });
  });

  it("drops a trigger queued behind a drain that opens the permanent circuit", async () => {
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const timers: Array<{ callback: () => void; delayMs: number }> = [];
    const drain = vi.fn(async (): Promise<DrainEventQueueResult> => {
      await first;
      return { ...transientFailure, status: 422, retriable: false };
    });
    const loop = new EventDeliveryLoop({
      drain,
      persistStatus: async () => {},
      retry: {
        baseDelayMs: 1_000,
        maxDelayMs: 8_000,
        setTimer: (callback, delayMs) => {
          const timer = { callback, delayMs };
          timers.push(timer);
          return timer;
        },
        clearTimer: () => {},
      },
    });

    const active = loop.trigger();
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1));
    const queued = loop.trigger();
    release!();
    await Promise.all([active, queued]);

    expect(drain).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.delayMs).toBe(8_000);
  });

  it("reopens the circuit with one slow timer after a repeated permanent probe", async () => {
    const permanent = {
      ...transientFailure,
      status: 422,
      retriable: false,
    };
    const { loop, drain, statuses, timers } = harness([
      permanent,
      permanent,
    ]);

    await loop.trigger();
    expect(timers).toHaveLength(1);
    timers[0]!.callback();
    await vi.waitFor(() => {
      expect(drain).toHaveBeenCalledTimes(2);
      expect(timers).toHaveLength(2);
    });
    expect(timers[1]!.delayMs).toBe(8_000);
    expect(statuses.at(-1)).toMatchObject({
      state: "blocked",
      consecutiveFailures: 2,
      httpStatus: 422,
    });

    await loop.trigger();
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent triggers into one follow-up drain", async () => {
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const drain = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await first;
      return caughtUp;
    });
    const loop = new EventDeliveryLoop({
      drain,
      persistStatus: async () => {},
    });

    const running = loop.trigger();
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1));
    const queued = loop.trigger();
    expect(drain).toHaveBeenCalledTimes(1);
    release!();
    await Promise.all([running, queued]);
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("lets shutdown queue and await a final pass during an active drain", async () => {
    let release: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const drain = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await first;
      return caughtUp;
    });
    const loop = new EventDeliveryLoop({
      drain,
      persistStatus: async () => {},
    });

    const active = loop.trigger();
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1));
    let shutdownResolved = false;
    const shutdown = loop.trigger().then(() => {
      shutdownResolved = true;
      loop.stop();
    });
    await Promise.resolve();
    expect(shutdownResolved).toBe(false);

    release!();
    await Promise.all([active, shutdown]);
    expect(drain).toHaveBeenCalledTimes(2);
    expect(shutdownResolved).toBe(true);
  });

  it("turns a pre-network drain exception into a scheduled retry", async () => {
    const timers: Array<{ callback: () => void; delayMs: number }> = [];
    const statuses: ShippingStatusSnapshot[] = [];
    const onDrainError = vi.fn();
    const loop = new EventDeliveryLoop({
      drain: async () => {
        throw new Error("local read failed");
      },
      persistStatus: async (status) => {
        statuses.push(status);
      },
      onDrainError,
      retry: {
        baseDelayMs: 1_000,
        maxDelayMs: 8_000,
        random: () => 0,
        setTimer: (callback, delayMs) => {
          const timer = { callback, delayMs };
          timers.push(timer);
          return timer;
        },
        clearTimer: () => {},
      },
    });

    await loop.trigger();
    expect(onDrainError).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)?.state).toBe("retrying");
    expect(timers).toHaveLength(1);
  });
});

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  advanceEventRejectionCheckpoint,
  EVENT_REJECTION_CHECKPOINT_MAX_BYTES,
  EventRejectionCheckpointError,
  journalEventRejection,
  readCurrentEventRejections,
  type EventRejectionCheckpointV1,
  type LocalEventRejection,
} from "../src/event-rejections.ts";
import {
  eventRejectionCheckpointPath,
  eventsLogGenerationPath,
  offsetPath,
} from "../src/paths.ts";

let directory: string;
let previousDirectory: string | undefined;

beforeEach(() => {
  previousDirectory = process.env.SEORAK_DIR;
  directory = mkdtempSync(join(tmpdir(), "seorak-event-rejections-"));
  process.env.SEORAK_DIR = directory;
});

afterEach(() => {
  if (previousDirectory === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = previousDirectory;
  rmSync(directory, { recursive: true, force: true });
});

function checkpoint(): EventRejectionCheckpointV1 {
  return JSON.parse(
    readFileSync(eventRejectionCheckpointPath(), "utf8"),
  ) as EventRejectionCheckpointV1;
}

function rejection(
  offset: number,
  bytes: number,
  reason: LocalEventRejection["reason"] = "invalid-event",
  chunkStartOffset = 0,
  generation = 0,
): LocalEventRejection {
  return {
    generation,
    chunkStartOffset,
    offset,
    nextOffset: offset + bytes + 1,
    bytes,
    reason,
  };
}

describe("bounded event rejection checkpoint", () => {
  it("creates an honest empty checkpoint for a new collector", async () => {
    await expect(readCurrentEventRejections()).resolves.toEqual({
      kind: "current",
      generation: 0,
      count: 0,
    });
    expect(checkpoint()).toEqual({
      schemaVersion: 1,
      current: {
        generation: 0,
        byReason: {
          "empty-record": { count: 0, bytes: 0 },
          "invalid-json": { count: 0, bytes: 0 },
          "invalid-event": { count: 0, bytes: 0 },
          "oversize-record": { count: 0, bytes: 0 },
        },
        replay: null,
      },
      history: {
        throughGeneration: null,
        byReason: {
          "empty-record": { count: 0, bytes: 0 },
          "invalid-json": { count: 0, bytes: 0 },
          "invalid-event": { count: 0, bytes: 0 },
          "oversize-record": { count: 0, bytes: 0 },
        },
      },
    });
  });

  it("deduplicates exact retries and records counts and bytes by reason", async () => {
    const invalid = rejection(10, 4, "invalid-json");
    const empty = rejection(30, 0, "empty-record");
    await journalEventRejection(invalid);
    await journalEventRejection(empty);
    await journalEventRejection(invalid);

    await expect(readCurrentEventRejections()).resolves.toEqual({
      kind: "current",
      generation: 0,
      count: 2,
    });
    expect(checkpoint().current).toMatchObject({
      byReason: {
        "empty-record": { count: 1, bytes: 0 },
        "invalid-json": { count: 1, bytes: 4 },
      },
      replay: {
        startOffset: 0,
        rejections: [
          { offset: 10, nextOffset: 15, bytes: 4, reason: "invalid-json" },
          { offset: 30, nextOffset: 31, bytes: 0, reason: "empty-record" },
        ],
      },
    });
  });

  it("counts a newly rejected earlier record instead of trusting a high-water mark", async () => {
    await journalEventRejection(rejection(50, 5));
    await journalEventRejection(rejection(10, 3, "invalid-json"));
    expect(checkpoint().current.byReason).toMatchObject({
      "invalid-event": { count: 1, bytes: 5 },
      "invalid-json": { count: 1, bytes: 3 },
    });
  });

  it("fails closed when classification changes at a replayed offset", async () => {
    await journalEventRejection(rejection(10, 3, "invalid-json"));
    await expect(
      journalEventRejection(rejection(10, 3, "invalid-event")),
    ).rejects.toThrow(EventRejectionCheckpointError);
    expect(checkpoint().current.byReason).toMatchObject({
      "invalid-json": { count: 1, bytes: 3 },
      "invalid-event": { count: 0, bytes: 0 },
    });
  });

  it("rejects generation and shipping-cursor races", async () => {
    writeFileSync(eventsLogGenerationPath(), "1", "utf8");
    writeFileSync(
      offsetPath(),
      JSON.stringify({ version: 1, generation: 1, offset: 20 }),
      "utf8",
    );
    await expect(
      journalEventRejection(rejection(20, 3, "invalid-json", 0, 0)),
    ).rejects.toThrow(/generation changed/);
    await expect(
      journalEventRejection(rejection(20, 3, "invalid-json", 0, 1)),
    ).rejects.toThrow(/shipping cursor changed/);
    expect(existsSync(eventRejectionCheckpointPath())).toBe(false);
  });

  it("folds current evidence exactly once across hundreds of generations", async () => {
    await journalEventRejection(rejection(5, 7, "oversize-record"));
    for (let generation = 1; generation <= 500; generation += 1) {
      writeFileSync(eventsLogGenerationPath(), String(generation), "utf8");
      await advanceEventRejectionCheckpoint(generation);
      await advanceEventRejectionCheckpoint(generation);
    }
    const value = checkpoint();
    expect(value.current).toMatchObject({
      generation: 500,
      replay: null,
    });
    expect(value.history).toMatchObject({
      throughGeneration: 499,
      byReason: {
        "oversize-record": { count: 1, bytes: 7 },
      },
    });
    expect(readFileSync(eventRejectionCheckpointPath(), "utf8").length).toBeLessThan(
      1_500,
    );
    // 180s against a body measured on 2026-08-05 at 19.9s alone and 22s inside
    // the full suite: 1,000 awaited atomic checkpoint writes, which is the test.
    // The 500 generations stay as they are on purpose. The bound asserted above
    // is what catches a checkpoint that grows per generation instead of folding,
    // and the size of a leak it can detect is proportional to that count, so
    // trading generations for seconds would quietly weaken the assertion rather
    // than just speed it up. 180s is 9x the measured runtime.
  }, 180_000);

  it("fails status closed and preserves corrupt or future checkpoints", async () => {
    writeFileSync(eventRejectionCheckpointPath(), "{torn", "utf8");
    await expect(readCurrentEventRejections()).resolves.toEqual({
      kind: "unreadable",
      generation: 0,
    });
    expect(readFileSync(eventRejectionCheckpointPath(), "utf8")).toBe("{torn");

    rmSync(eventRejectionCheckpointPath());
    await readCurrentEventRejections();
    const future = checkpoint();
    future.current.generation = 2;
    future.history.throughGeneration = 1;
    writeFileSync(
      eventRejectionCheckpointPath(),
      JSON.stringify(future),
      "utf8",
    );
    await expect(readCurrentEventRejections()).resolves.toEqual({
      kind: "unreadable",
      generation: 0,
    });
    expect(
      JSON.parse(readFileSync(eventRejectionCheckpointPath(), "utf8")).current
        .generation,
    ).toBe(2);
  });

  it("fails closed when an existing checkpoint path cannot be read as a file", async () => {
    mkdirSync(eventRejectionCheckpointPath());
    await expect(readCurrentEventRejections()).resolves.toEqual({
      kind: "unreadable",
      generation: 0,
    });
  });

  it("rejects an oversized checkpoint without reading or replacing it", async () => {
    const oversized = "x".repeat(EVENT_REJECTION_CHECKPOINT_MAX_BYTES + 1);
    writeFileSync(eventRejectionCheckpointPath(), oversized, "utf8");

    await expect(readCurrentEventRejections()).resolves.toEqual({
      kind: "unreadable",
      generation: 0,
    });
    expect(readFileSync(eventRejectionCheckpointPath(), "utf8")).toBe(oversized);
  });
});

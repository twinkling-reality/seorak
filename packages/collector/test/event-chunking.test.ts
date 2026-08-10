import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionEvent } from "@seorak/types";
import { EVENT_BATCH_BYTE_LIMIT, EVENT_BATCH_EVENT_LIMIT, EVENT_BATCH_SCHEMA_VERSION } from "@seorak/types/event-validation";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readNextEventChunk, writeOffset } from "../src/log-reader.ts";
import {
  eventRejectionCheckpointPath,
  eventsLogPath,
  offsetPath,
} from "../src/paths.ts";
import { appendEvent } from "../src/append.ts";

let dir: string;
let savedDir: string | undefined;

beforeEach(() => {
  savedDir = process.env.SEORAK_DIR;
  dir = mkdtempSync(join(tmpdir(), "seorak-event-chunk-"));
  process.env.SEORAK_DIR = dir;
});

afterEach(() => {
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
  rmSync(dir, { recursive: true, force: true });
});

function prompt(index: number): SessionEvent {
  return {
    kind: "session.prompt",
    eventId: `event-${index}`,
    sessionId: "session-1",
    at: "2026-07-27T12:00:00.000Z",
  };
}

function heavyLineSurvival(index: number): SessionEvent {
  const largest = Number.MAX_SAFE_INTEGER;
  return {
    kind: "session.linesurvival",
    eventId: `survival-${index}`,
    sessionId: `session-${index}`,
    at: "2026-07-27T12:00:00.000Z",
    repoId: "a".repeat(64),
    gitContext: "clean",
    rung: "3d",
    fate: "retained",
    commitsChecked: 100,
    linesAuthored: largest,
    linesSurviving: largest,
    commits: Array.from({ length: 100 }, (_, commit) => ({
      id: commit.toString(16).padStart(64, "0"),
      added: largest,
      contested: 0,
      authored: largest,
    })),
    filesGoneFromTip: largest,
  };
}

function appendLine(value: unknown): void {
  appendFileSync(eventsLogPath(), `${JSON.stringify(value)}\n`, "utf8");
}

const readChunk = () =>
  readNextEventChunk({
    collectorVersion: "0.0.0",
    deviceId: "device-1",
  });

describe("bounded shipping chunks", () => {
  it("fails new invalid emissions with a content-free error before disk", async () => {
    const sentinel = "SENTINEL_PRIVATE_VALUE";
    await expect(
      appendEvent({
        ...prompt(0),
        superSecretUnknownKey: sentinel,
      } as SessionEvent),
    ).rejects.toThrow("event failed shared protocol validation");
    expect(() => readFileSync(eventsLogPath(), "utf8")).toThrow();
  });

  it("splits a backlog at 128 events and advances each acknowledged prefix", async () => {
    for (let i = 0; i < 300; i += 1) appendLine(prompt(i));

    const first = await readChunk();
    expect(first.batch.schemaVersion).toBe(EVENT_BATCH_SCHEMA_VERSION);
    expect(first.batch.events).toHaveLength(EVENT_BATCH_EVENT_LIMIT);
    expect(Buffer.byteLength(first.body, "utf8")).toBeLessThanOrEqual(
      EVENT_BATCH_BYTE_LIMIT,
    );

    await writeOffset(first.nextOffset);
    const second = await readChunk();
    expect(second.batch.events).toHaveLength(EVENT_BATCH_EVENT_LIMIT);

    await writeOffset(second.nextOffset);
    const third = await readChunk();
    expect(third.batch.events).toHaveLength(44);
  });

  it("uses exact serialized batch bytes as the second chunk boundary", async () => {
    for (let i = 0; i < 50; i += 1) appendLine(heavyLineSurvival(i));

    const chunk = await readChunk();
    expect(chunk.batch.events.length).toBeGreaterThan(0);
    expect(chunk.batch.events.length).toBeLessThan(50);
    expect(Buffer.byteLength(chunk.body, "utf8")).toBeLessThanOrEqual(
      EVENT_BATCH_BYTE_LIMIT,
    );

    const withNext = JSON.stringify({
      ...chunk.batch,
      events: [
        ...chunk.batch.events,
        heavyLineSurvival(chunk.batch.events.length),
      ],
    });
    expect(Buffer.byteLength(withNext, "utf8")).toBeGreaterThan(
      EVENT_BATCH_BYTE_LIMIT,
    );
  });

  it("journals malformed and schema-invalid records without copying their content", async () => {
    appendFileSync(eventsLogPath(), '{"kind":not-json}\n', "utf8");
    appendLine({
      ...prompt(1),
      superSecretUnknownKey: "SENTINEL_PRIVATE_VALUE",
    });
    appendLine(prompt(2));

    const chunk = await readChunk();
    expect(chunk.batch.events.map((event) => event.eventId)).toEqual(["event-2"]);
    expect(chunk.rejected).toBe(2);

    const checkpoint = readFileSync(eventRejectionCheckpointPath(), "utf8");
    expect(checkpoint).toContain('"invalid-json":{"count":1');
    expect(checkpoint).toContain('"invalid-event":{"count":1');
    expect(checkpoint).toContain('"generation":0');
    expect(checkpoint).not.toContain("superSecretUnknownKey");
    expect(checkpoint).not.toContain("SENTINEL_PRIVATE_VALUE");
    expect(checkpoint).not.toContain("not-json");

    // Simulate a valid-chunk ship failure: the durable offset stays put, but
    // rescanning the poison prefix must not grow the journal with duplicates.
    await readChunk();
    const retried = JSON.parse(
      readFileSync(eventRejectionCheckpointPath(), "utf8"),
    ) as {
      current: { replay: { rejections: unknown[] } };
    };
    expect(retried.current.replay.rejections).toHaveLength(2);
  });

  it("durably quarantines one oversized record and continues with the next valid event", async () => {
    appendFileSync(
      eventsLogPath(),
      `${JSON.stringify({
        kind: "session.prompt",
        payload: "x".repeat(EVENT_BATCH_BYTE_LIMIT),
      })}\n`,
      "utf8",
    );
    appendLine(prompt(9));

    const chunk = await readChunk();
    expect(chunk.batch.events.map((event) => event.eventId)).toEqual(["event-9"]);
    expect(chunk.rejected).toBe(1);
    expect(readFileSync(eventRejectionCheckpointPath(), "utf8")).toContain(
      '"oversize-record":{"count":1',
    );
  });

  it("bounds an all-rejection chunk so its exact retry window stays constant", async () => {
    for (let index = 0; index < EVENT_BATCH_EVENT_LIMIT + 1; index += 1) {
      appendFileSync(eventsLogPath(), "not-json\n", "utf8");
    }

    const first = await readChunk();
    expect(first.rejected).toBe(EVENT_BATCH_EVENT_LIMIT);
    expect(first.batch.events).toEqual([]);
    await writeOffset(first.nextOffset, first.generation);

    const second = await readChunk();
    expect(second.rejected).toBe(1);
    const value = JSON.parse(
      readFileSync(eventRejectionCheckpointPath(), "utf8"),
    ) as {
      current: {
        byReason: { "invalid-json": { count: number } };
        replay: { startOffset: number; rejections: unknown[] };
      };
    };
    expect(value.current.byReason["invalid-json"].count).toBe(
      EVENT_BATCH_EVENT_LIMIT + 1,
    );
    expect(value.current.replay).toEqual({
      startOffset: first.nextOffset,
      rejections: [
        {
          offset: first.nextOffset,
          nextOffset: second.nextOffset,
          bytes: 8,
          reason: "invalid-json",
        },
      ],
    });
  });

  it("does not expose an advanced cursor when checkpoint persistence fails", async () => {
    appendFileSync(eventsLogPath(), "not-json\n", "utf8");
    mkdirSync(eventRejectionCheckpointPath());

    await expect(readChunk()).rejects.toThrow(/checkpoint/);
    expect(() => readFileSync(offsetPath(), "utf8")).toThrow();
  });
});

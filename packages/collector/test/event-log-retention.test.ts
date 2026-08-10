import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent } from "../src/append.ts";
import {
  appendEventLine,
  compactAcknowledgedEventLog,
  EventLogLockTimeoutError,
  readEventLogGeneration,
  recoverAcknowledgedEventLogs,
  withEventLogLock,
} from "../src/event-log.ts";
import {
  journalEventRejection,
  readCurrentEventRejections,
} from "../src/event-rejections.ts";
import {
  emptyLedger,
  loadLedger,
  saveLedger,
  syncLedger,
} from "../src/ledger.ts";
import {
  readNextEventChunk,
  writeOffset,
} from "../src/log-reader.ts";
import {
  acknowledgedEventsLogPath,
  eventRejectionCheckpointPath,
  eventsLogPath,
  ledgerPath,
  resolveEventLogPathContext,
} from "../src/paths.ts";

let directory: string;
let savedDirectory: string | undefined;

beforeEach(() => {
  savedDirectory = process.env.SEORAK_DIR;
  directory = mkdtempSync(join(tmpdir(), "seorak-event-retention-"));
  process.env.SEORAK_DIR = directory;
});

afterEach(() => {
  if (savedDirectory === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDirectory;
  rmSync(directory, { recursive: true, force: true });
});

function prompt(index: number) {
  return {
    kind: "session.prompt" as const,
    eventId: `event-${index}`,
    sessionId: "session-1",
    at: "2026-07-27T12:00:00.000Z",
  };
}

function eventIdsOnDisk(): string[] {
  if (!existsSync(eventsLogPath())) return [];
  return readFileSync(eventsLogPath(), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { eventId: string }).eventId);
}

describe("acknowledged event-log rollover", () => {
  it("serializes concurrent hook appends without torn or missing records", async () => {
    await Promise.all(
      Array.from({ length: 100 }, (_, index) => appendEvent(prompt(index))),
    );
    const ids = eventIdsOnDisk();
    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
  });

  it("refuses rollover while either durable consumer is behind", async () => {
    await appendEvent(prompt(1));
    const size = statSync(eventsLogPath()).size;

    const shippingBehind = await compactAcknowledgedEventLog({
      shippingOffset: size - 1,
      attributionOffset: size,
      minimumBytes: 1,
    });
    expect(shippingBehind).toMatchObject({
      compacted: false,
      reason: "shipping-behind",
    });

    const attributionBehind = await compactAcknowledgedEventLog({
      shippingOffset: size,
      attributionOffset: size - 1,
      minimumBytes: 1,
    });
    expect(attributionBehind).toMatchObject({
      compacted: false,
      reason: "attribution-behind",
    });
    expect(eventIdsOnDisk()).toEqual(["event-1"]);
  });

  it("binds both cursors to a generation even when the new file has the same size", async () => {
    await appendEvent(prompt(1));
    const acknowledgedOffset = statSync(eventsLogPath()).size;
    await writeOffset(acknowledgedOffset);
    const firstLedger = await syncLedger(Date.parse("2026-07-27T13:00:00.000Z"));
    expect(firstLedger).toMatchObject({
      generation: 0,
      offset: acknowledgedOffset,
    });

    const result = await compactAcknowledgedEventLog({
      shippingOffset: acknowledgedOffset,
      attributionOffset: firstLedger.offset,
      minimumBytes: 1,
    });
    expect(result).toEqual({
      compacted: true,
      bytesReclaimed: acknowledgedOffset,
      generation: 1,
    });
    expect(statSync(eventsLogPath()).size).toBe(0);
    expect(await readEventLogGeneration()).toBe(1);
    await expect(writeOffset(acknowledgedOffset, 0)).rejects.toThrow(
      /generation changed/,
    );
    expect(
      readdirSync(directory).filter((name) =>
        name.startsWith("events.acknowledged."),
      ),
    ).toEqual([]);

    await appendEvent(prompt(2));
    expect(statSync(eventsLogPath()).size).toBe(acknowledgedOffset);
    const shipping = await readNextEventChunk({
      collectorVersion: "0.0.0",
      deviceId: "device-1",
    });
    expect(shipping.batch.events.map((event) => event.eventId)).toEqual([
      "event-2",
    ]);

    const attribution = await syncLedger(
      Date.parse("2026-07-27T13:01:00.000Z"),
    );
    expect(attribution).toMatchObject({
      generation: 1,
      offset: acknowledgedOffset,
    });
  });

  it("never drops appends racing an eligible rollover", async () => {
    await appendEvent(prompt(0));
    const acknowledgedOffset = statSync(eventsLogPath()).size;
    await Promise.all([
      compactAcknowledgedEventLog({
        shippingOffset: acknowledgedOffset,
        attributionOffset: acknowledgedOffset,
        minimumBytes: 1,
      }),
      ...Array.from({ length: 50 }, (_, index) =>
        appendEvent(prompt(index + 1)),
      ),
    ]);
    const ids = new Set(eventIdsOnDisk());
    for (let index = 1; index <= 50; index += 1) {
      expect(ids.has(`event-${index}`)).toBe(true);
    }
  });

  it("recovers a lock whose recorded owner is dead", async () => {
    const paths = resolveEventLogPathContext();
    mkdirSync(paths.lock, { mode: 0o700 });
    writeFileSync(
      join(paths.lock, "owner-dead.json"),
      JSON.stringify({
        version: 1,
        pid: 2_147_483_647,
        token: "dead",
        at: Date.now(),
      }),
      "utf8",
    );

    await appendEvent(prompt(7));
    expect(eventIdsOnDisk()).toEqual(["event-7"]);
    expect(existsSync(paths.lock)).toBe(false);
  });

  it("times out without stealing an old lock from a live owner", async () => {
    const paths = resolveEventLogPathContext();
    mkdirSync(paths.lock, { mode: 0o700 });
    const ownerPath = join(paths.lock, "owner-live.json");
    writeFileSync(
      ownerPath,
      JSON.stringify({
        version: 1,
        pid: process.pid,
        token: "live",
        at: 0,
      }),
      "utf8",
    );

    await expect(
      appendEventLine(`${JSON.stringify(prompt(8))}\n`, paths, {
        waitMs: 20,
        retryMs: 1,
        staleMs: 0,
      }),
    ).rejects.toBeInstanceOf(EventLogLockTimeoutError);
    expect(existsSync(ownerPath)).toBe(true);
    expect(existsSync(paths.events)).toBe(false);
  });

  it("does not let a superseded owner remove its replacement lock", async () => {
    const paths = resolveEventLogPathContext();
    const replacement = join(paths.lock, "owner-replacement.json");
    await withEventLogLock(paths, async () => {
      const original = readdirSync(paths.lock)[0]!;
      unlinkSync(join(paths.lock, original));
      rmdirSync(paths.lock);
      mkdirSync(paths.lock, { mode: 0o700 });
      writeFileSync(
        replacement,
        JSON.stringify({
          version: 1,
          pid: process.pid,
          token: "replacement",
          at: Date.now(),
        }),
        "utf8",
      );
    });

    expect(existsSync(replacement)).toBe(true);
  });

  it("keeps a waiting append bound to its entry directory", async () => {
    const firstDirectory = directory;
    const firstPaths = resolveEventLogPathContext();
    mkdirSync(firstPaths.lock, { mode: 0o700 });
    const ownerPath = join(firstPaths.lock, "owner-live.json");
    writeFileSync(
      ownerPath,
      JSON.stringify({
        version: 1,
        pid: process.pid,
        token: "live",
        at: Date.now(),
      }),
      "utf8",
    );
    const pending = appendEvent(prompt(9));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondDirectory = mkdtempSync(
      join(tmpdir(), "seorak-event-retention-next-"),
    );
    process.env.SEORAK_DIR = secondDirectory;
    unlinkSync(ownerPath);
    rmdirSync(firstPaths.lock);
    await pending;

    expect(
      readFileSync(join(firstDirectory, "events.jsonl"), "utf8"),
    ).toContain('"eventId":"event-9"');
    expect(existsSync(join(secondDirectory, "events.jsonl"))).toBe(false);
    rmSync(secondDirectory, { recursive: true, force: true });
    process.env.SEORAK_DIR = firstDirectory;
  });

  it("leaves no timed-out append that can bleed into the next fixture", async () => {
    const firstPaths = resolveEventLogPathContext();
    mkdirSync(firstPaths.lock, { mode: 0o700 });
    const ownerPath = join(firstPaths.lock, "owner-live.json");
    writeFileSync(
      ownerPath,
      JSON.stringify({
        version: 1,
        pid: process.pid,
        token: "live",
        at: Date.now(),
      }),
      "utf8",
    );
    await expect(
      appendEventLine(`${JSON.stringify(prompt(10))}\n`, firstPaths, {
        waitMs: 20,
        retryMs: 1,
      }),
    ).rejects.toBeInstanceOf(EventLogLockTimeoutError);

    const secondDirectory = mkdtempSync(
      join(tmpdir(), "seorak-event-retention-following-"),
    );
    process.env.SEORAK_DIR = secondDirectory;
    unlinkSync(ownerPath);
    rmdirSync(firstPaths.lock);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(existsSync(join(secondDirectory, "events.jsonl"))).toBe(false);
    rmSync(secondDirectory, { recursive: true, force: true });
    process.env.SEORAK_DIR = firstPaths.directory;
  });

  it("finishes a crashed acknowledged-generation cleanup without replay", async () => {
    await journalEventRejection({
      generation: 0,
      chunkStartOffset: 0,
      offset: 0,
      nextOffset: 4,
      bytes: 3,
      reason: "invalid-json",
    });
    writeFileSync(acknowledgedEventsLogPath(4), "already consumed\n", "utf8");
    expect(await recoverAcknowledgedEventLogs()).toBe(1);
    expect(await readEventLogGeneration()).toBe(4);
    expect(existsSync(acknowledgedEventsLogPath(4))).toBe(false);
    await expect(readCurrentEventRejections()).resolves.toEqual({
      kind: "current",
      generation: 4,
      count: 0,
    });
    expect(
      JSON.parse(readFileSync(eventRejectionCheckpointPath(), "utf8")).history
        .byReason["invalid-json"],
    ).toEqual({ count: 1, bytes: 3 });
  });

  it("cannot classify a record across a generation change while waiting for the lock", async () => {
    const paths = resolveEventLogPathContext();
    writeFileSync(eventsLogPath(), "not-json\n", "utf8");
    let pending!: ReturnType<typeof readNextEventChunk>;
    await withEventLogLock(paths, async () => {
      pending = readNextEventChunk({
        collectorVersion: "0.0.0",
        deviceId: "device-1",
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      writeFileSync(paths.generation, "1", "utf8");
    });

    await expect(pending).rejects.toThrow(/generation changed/);
    expect(existsSync(eventRejectionCheckpointPath())).toBe(false);
  });

  it("falls back to the previous durable attribution checkpoint", () => {
    const first = emptyLedger();
    first.offset = 10;
    first.agents["session-1"] = "claude-code";
    expect(saveLedger(first)).toBe(true);

    const second = emptyLedger();
    second.offset = 20;
    second.agents["session-2"] = "codex";
    expect(saveLedger(second)).toBe(true);
    writeFileSync(ledgerPath(), "{torn", "utf8");

    expect(loadLedger()).toEqual(first);
  });
});

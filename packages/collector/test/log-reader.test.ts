/**
 * log-reader.test.ts — the daemon's offset / crash-recovery semantics.
 *
 * Exercises the durable read position over the active event-log generation
 * (no daemon boot): full read + offset advance, resume-after-ship (the offset
 * gates re-reads), partial-last-line safety (a half-written append is re-read
 * intact), atomic offset write, corrupt offset fallback, and the shrunken-log
 * (truncated/recreated) re-read from the top.
 *
 * fs-sandboxed: SEORAK_DIR points at a fresh temp dir per test so the log +
 * offset files never collide.
 */
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readNextEventChunk,
  readOffset,
  writeOffset,
} from "../src/log-reader.ts";
import { eventsLogPath, offsetPath } from "../src/paths.ts";

let dir: string;
let savedDir: string | undefined;

beforeEach(() => {
  savedDir = process.env.SEORAK_DIR;
  dir = mkdtempSync(join(tmpdir(), "seorak-log-"));
  process.env.SEORAK_DIR = dir;
});

afterEach(() => {
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
  rmSync(dir, { recursive: true, force: true });
});

/** Append a complete JSONL event line (with the terminating newline). */
function appendLine(obj: unknown): void {
  appendFileSync(eventsLogPath(), JSON.stringify(obj) + "\n", "utf8");
}

function prompt(eventId: string): Record<string, string> {
  return {
    kind: "session.prompt",
    eventId,
    sessionId: "s1",
    at: "2026-07-27T12:00:00.000Z",
  };
}

const readChunk = () =>
  readNextEventChunk({
    collectorVersion: "0.0.0",
    deviceId: "device-1",
  });

describe("current event chunk reader — offset + crash recovery", () => {
  it("reads all complete events and advances the offset past them", async () => {
    appendLine(prompt("e1"));
    appendLine(prompt("e2"));

    const { batch, nextOffset } = await readChunk();
    expect(batch.events).toHaveLength(2);
    expect(batch.events.map((event) => event.eventId)).toEqual(["e1", "e2"]);
    expect(nextOffset).toBeGreaterThan(0);
  });

  it("does not re-read events once the offset is persisted; resumes from new ones", async () => {
    appendLine(prompt("e1"));
    const first = await readChunk();
    await writeOffset(first.nextOffset); // simulate a successful ship + ack

    // Nothing new yet → empty, offset unchanged (no double-ship).
    const stable = await readChunk();
    expect(stable.batch.events).toHaveLength(0);
    expect(stable.nextOffset).toBe(first.nextOffset);

    // A new event after the offset is the only thing returned.
    appendLine(prompt("e2"));
    const resumed = await readChunk();
    expect(resumed.batch.events.map((event) => event.eventId)).toEqual(["e2"]);
  });

  it("leaves a partial trailing line unconsumed, then re-reads it intact once completed", async () => {
    appendLine(prompt("e1"));
    // A crash mid-append: a JSON fragment with NO terminating newline.
    appendFileSync(eventsLogPath(), '{"kind":"session.prompt","eventId":"e2"', "utf8");

    const partial = await readChunk();
    // Only the one complete line is consumed; the fragment is not counted.
    expect(partial.batch.events.map((event) => event.eventId)).toEqual(["e1"]);
    await writeOffset(partial.nextOffset);

    // The hook finishes writing the line (the rest + newline).
    appendFileSync(
      eventsLogPath(),
      ',"sessionId":"s1","at":"2026-07-27T12:00:00.000Z"}\n',
      "utf8",
    );
    const completed = await readChunk();
    expect(completed.batch.events.map((event) => event.eventId)).toEqual(["e2"]);
  });

  it("writes the offset atomically (round-trips, no .tmp left behind)", async () => {
    await writeOffset(4096);
    expect(await readOffset()).toBe(4096);
    // The temp file used for the atomic rename must not linger.
    expect(existsSync(`${offsetPath()}.tmp`)).toBe(false);
    const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("falls back to 0 on a corrupt/negative offset", async () => {
    // A torn/garbage offset file coerces to 0 (re-read whole log) rather than NaN.
    writeFileSync(offsetPath(), "not-a-number", "utf8");
    expect(await readOffset()).toBe(0);
  });

  it("does not retain the retired generationless numeric cursor format", async () => {
    writeFileSync(offsetPath(), "4096", "utf8");
    expect(await readOffset()).toBe(0);
  });

  it("re-reads from the top when the log shrank below the offset (truncated/recreated)", async () => {
    // The old behavior read a shrunken log as nothing-new FOREVER, silently
    // stranding every row below the stale offset. The recovery is a full
    // re-read: worker ingest is idempotent by eventId, so a re-ship never
    // double-counts. One warning line marks the reset.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      appendLine(prompt("e1"));
      await writeOffset(10_000); // stale: far past the recreated file's size
      const { batch, nextOffset } = await readChunk();
      expect(batch.events.map((event) => event.eventId)).toEqual(["e1"]);
      expect(nextOffset).toBeGreaterThan(0);
      expect(nextOffset).toBeLessThan(10_000);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("shrank below the read offset"));
    } finally {
      warn.mockRestore();
    }
  });

  it("returns empty (not a throw) when the log file does not exist yet", async () => {
    const { batch, nextOffset } = await readChunk();
    expect(batch.events).toEqual([]);
    expect(nextOffset).toBe(0);
  });
});

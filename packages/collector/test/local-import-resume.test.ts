import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importLegacyEventLog, openLocalHistory } from "../src/local-store.ts";

let dir: string;
let log: string;

function event(id: string, sessionId = "s1"): string {
  return `${JSON.stringify({
    kind: "tool.call",
    eventId: id.padEnd(64, "0"),
    sessionId,
    at: "2026-09-09T12:00:00.000Z",
    toolName: "other",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  })}\n`;
}

function countEvents(): number {
  const database = openLocalHistory(dir);
  try {
    const row = database
      .prepare("SELECT COUNT(*) AS n FROM local_event")
      .get() as { n: number };
    return row.n;
  } finally {
    database.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seorak-import-resume-"));
  log = join(dir, "events.jsonl");
  writeFileSync(join(dir, "events.generation"), "3");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("importLegacyEventLog resume", () => {
  it("imports the log once, then skips it entirely", () => {
    writeFileSync(log, event("a") + event("b"));
    const first = importLegacyEventLog(log, dir);
    expect(first.accepted).toBe(2);
    expect(first.skipped).toBe(false);

    const second = importLegacyEventLog(log, dir);
    expect(second.skipped).toBe(true);
    expect(second.accepted).toBe(0);
    expect(countEvents()).toBe(2);
  });

  it("imports only what was appended since the last run", () => {
    writeFileSync(log, event("a"));
    expect(importLegacyEventLog(log, dir).accepted).toBe(1);
    appendFileSync(log, event("b"));
    const resumed = importLegacyEventLog(log, dir);
    expect(resumed.accepted).toBe(1);
    expect(countEvents()).toBe(2);
  });

  it("leaves a partial trailing line for the next run rather than losing it", () => {
    writeFileSync(log, event("a"));
    importLegacyEventLog(log, dir);
    // A hook mid-append: bytes with no terminating newline yet.
    appendFileSync(log, '{"kind":"tool.call","eventId":"bb');
    const partial = importLegacyEventLog(log, dir);
    expect(partial.accepted).toBe(0);
    expect(partial.rejected).toBe(0);

    // The rest of that line arrives; now it must be imported, not skipped.
    const rest = event("bb").slice('{"kind":"tool.call","eventId":"bb'.length);
    appendFileSync(log, rest);
    expect(importLegacyEventLog(log, dir).accepted).toBe(1);
    expect(countEvents()).toBe(2);
  });

  it("re-reads from zero when the generation changes, because the bytes are new", () => {
    writeFileSync(log, event("a") + event("b"));
    expect(importLegacyEventLog(log, dir).accepted).toBe(2);

    // A compaction renames the log away, writes an empty one and bumps the
    // generation. The replacement here holds DIFFERENT events at offsets the
    // old cursor already covered.
    writeFileSync(join(dir, "events.generation"), "4");
    writeFileSync(log, event("c") + event("d"));
    const after = importLegacyEventLog(log, dir);
    expect(after.accepted).toBe(2);
    expect(countEvents()).toBe(4);
  });

  it("re-reads from zero when the log is shorter than the recorded offset", () => {
    writeFileSync(log, event("a") + event("b"));
    expect(importLegacyEventLog(log, dir).accepted).toBe(2);
    // Truncated in place without a generation bump: the offset is no longer
    // meaningful, so resuming from it would skip real rows.
    writeFileSync(log, event("c"));
    expect(importLegacyEventLog(log, dir).accepted).toBe(1);
  });

  it("counts an unparseable line as rejected and still advances past it", () => {
    writeFileSync(log, "not json\n" + event("a"));
    const result = importLegacyEventLog(log, dir);
    expect(result.rejected).toBe(1);
    expect(result.accepted).toBe(1);
    // The bad line must not be re-read forever.
    expect(importLegacyEventLog(log, dir).skipped).toBe(true);
  });

  it("reports a missing log as skipped rather than failing", () => {
    expect(importLegacyEventLog(join(dir, "absent.jsonl"), dir)).toMatchObject({
      skipped: true,
      accepted: 0,
    });
  });
});

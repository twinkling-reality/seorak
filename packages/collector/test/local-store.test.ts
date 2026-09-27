import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionEvent } from "@seorak/types";
import {
  appendLocalEvent,
  DISPLAYABLE_SESSION_SQL,
  importLegacyEventLog,
  listLocalSessions,
  localHistoryCounts,
  LOCAL_HISTORY_SCHEMA_VERSION,
  MEASURED_SESSION_SQL,
  openLocalHistory,
  replayLocalSession,
} from "../src/local-store.ts";
import {
  acknowledgeLocalSyncCandidate,
  buildLocalSyncCandidate,
  compactSyncActivated,
} from "../src/local-sync-store.ts";
import { buildLocalReport, exportLocalHistory } from "../src/local-dashboard.ts";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "seorak-local-history-"));
  temporary.push(path);
  return path;
}

function start(at = "2026-08-01T12:00:00.000Z"): SessionEvent {
  return {
    kind: "session.start",
    eventId: "event-start",
    sessionId: "session-1",
    at,
    repoId: "a".repeat(64),
    repoLabel: "seorak",
    agent: "claude-code",
    agentVersion: "1.0.0",
  };
}

function tool(
  eventId: string,
  at = "2026-08-01T12:01:00.000Z",
  errored = false,
): SessionEvent {
  return {
    kind: "tool.call",
    eventId,
    sessionId: "session-1",
    at,
    toolName: "Read",
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
    costUsd: 0.01,
    errored,
  };
}

function end(): SessionEvent {
  return {
    kind: "session.end",
    eventId: "event-end",
    sessionId: "session-1",
    at: "2026-08-01T12:02:00.000Z",
    reason: "other",
  };
}

describe("permanent local history", () => {
  it("upgrades the v1 sync checkpoint without touching product history", () => {
    const dir = directory();
    const database = new DatabaseSync(join(dir, "history.sqlite"));
    database.exec(`
      CREATE TABLE local_sync_state (
        scope TEXT PRIMARY KEY CHECK (scope = 'managed'),
        mode TEXT NOT NULL CHECK (mode IN ('inactive', 'compact-v1')),
        activated_at TEXT
      ) STRICT, WITHOUT ROWID;
      INSERT INTO local_sync_state VALUES ('managed', 'inactive', NULL);
      PRAGMA user_version = 1;
    `);
    database.close();

    const upgraded = openLocalHistory(dir);
    try {
      // Read the current version from the module rather than a copied literal:
      // this assertion is about the v1 UPGRADE landing, and a hand-copied number
      // turns every later schema addition into a false failure here.
      expect(upgraded.prepare("PRAGMA user_version").get()).toEqual({
        user_version: LOCAL_HISTORY_SCHEMA_VERSION,
      });
      expect(
        upgraded
          .prepare("PRAGMA table_info(local_sync_state)")
          .all()
          .map((row) => String((row as { name?: unknown }).name)),
      ).toContain("pending_batch_json");
    } finally {
      upgraded.close();
    }
  });

  it("keeps raw events idempotently and projects truthful local statistics", () => {
    const dir = directory();
    expect(appendLocalEvent(start(), dir)).toBe(true);
    expect(appendLocalEvent(tool("event-tool", undefined, true), dir)).toBe(true);
    expect(appendLocalEvent(tool("event-tool", undefined, true), dir)).toBe(false);
    expect(appendLocalEvent(end(), dir)).toBe(true);

    expect(localHistoryCounts(dir)).toMatchObject({
      events: 3,
      sessions: 1,
      completedSessions: 1,
    });
    expect(listLocalSessions({ directory: dir })).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        status: "ended",
        eventCount: 3,
        toolCallCount: 1,
        erroredToolCallCount: 1,
        inputTokens: 10,
        costUsd: 0.01,
      }),
    ]);
    expect(replayLocalSession("session-1", dir).map((event) => event.kind)).toEqual([
      "session.start",
      "tool.call",
      "session.end",
    ]);
  });

  it("does not present unpriced model work as zero cost", () => {
    const dir = directory();
    appendLocalEvent(start(), dir);
    appendLocalEvent(
      {
        kind: "session.tokens",
        eventId: "event-unpriced-tokens",
        sessionId: "session-1",
        at: "2026-08-01T12:01:00.000Z",
        models: [
          {
            model: "future-model-without-published-price",
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        ],
      },
      dir,
    );
    expect(listLocalSessions({ directory: dir })[0]?.costUsd).toBeNull();
    expect(buildLocalReport(dir).totals.costUsd).toBeNull();
    const candidate = buildLocalSyncCandidate({
      directory: dir,
      nowMs: Date.now() + 60 * 60 * 1000,
    });
    expect(candidate?.sessions[0]?.costUsd).toBeNull();
    expect(candidate?.hours[0]?.costUsd).toBeNull();
  });

  it("keeps shared-price cost across a later schema-zero call", () => {
    const dir = directory();
    appendLocalEvent(start(), dir);
    appendLocalEvent(
      {
        ...tool("event-priced-model"),
        costUsd: 0,
        models: [{
          model: "claude-opus-4-5",
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        }],
      },
      dir,
    );
    appendLocalEvent(
      {
        ...tool("event-schema-zero", "2026-08-01T12:01:01.000Z"),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      },
      dir,
    );

    expect(listLocalSessions({ directory: dir })[0]?.costUsd).toBeCloseTo(0.001);
  });

  it("computes totals over all history rather than only recent cards", () => {
    const dir = directory();
    for (let index = 0; index < 30; index += 1) {
      const sessionId = `session-${index}`;
      appendLocalEvent(
        {
          ...start(),
          eventId: `start-${index}`,
          sessionId,
        },
        dir,
      );
      appendLocalEvent(
        {
          ...tool(`tool-${index}`),
          sessionId,
        },
        dir,
      );
    }
    const report = buildLocalReport(dir);
    expect(report.recentSessions).toHaveLength(25);
    expect(report.totals).toMatchObject({ sessions: 30, toolCalls: 30 });
  });

  it("imports the compatibility JSONL idempotently without truncating it", () => {
    const dir = directory();
    const path = join(dir, "events.jsonl");
    const raw = `${JSON.stringify(start())}\nnot-json\n${JSON.stringify(end())}\n`;
    writeFileSync(path, raw, "utf8");

    expect(importLegacyEventLog(path, dir)).toMatchObject({
      accepted: 2,
      rejected: 1,
      skipped: false,
    });
    expect(importLegacyEventLog(path, dir)).toMatchObject({ skipped: true });
    expect(readFileSync(path, "utf8")).toBe(raw);
    expect(localHistoryCounts(dir).events).toBe(2);
  });

  it("builds one idempotent compact candidate independent of raw event count", () => {
    const dir = directory();
    appendLocalEvent(start(), dir);
    for (let index = 0; index < 100; index += 1) {
      appendLocalEvent(
        tool(`event-tool-${index}`, `2026-08-01T12:01:${String(index % 60).padStart(2, "0")}.000Z`),
        dir,
      );
    }
    appendLocalEvent(end(), dir);

    const nowMs = Date.now() + 60 * 60 * 1000;
    const candidate = buildLocalSyncCandidate({
      directory: dir,
      nowMs,
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.sessions).toHaveLength(1);
    expect(candidate!.hours).toHaveLength(1);
    expect(candidate!.archives).toHaveLength(1);
    expect(candidate!.archives[0]?.eventCount).toBe(102);
    expect(candidate!.transitions.map((row) => row.transition)).toEqual([
      "started",
      "completed",
    ]);
    expect(buildLocalSyncCandidate({
      directory: dir,
      nowMs,
    })?.batchId).toBe(candidate!.batchId);

    acknowledgeLocalSyncCandidate(candidate!, dir);
    expect(compactSyncActivated(dir)).toBe(true);
    expect(buildLocalSyncCandidate({
      directory: dir,
      nowMs,
    })).toBeNull();
    expect(localHistoryCounts(dir).events).toBe(102);
  });

  it("exports a complete private local artifact and refuses overwrite", () => {
    const dir = directory();
    appendLocalEvent(start(), dir);
    const output = join(dir, "export.json");
    expect(exportLocalHistory(output, dir)).toEqual({ path: output, events: 1 });
    const parsed = JSON.parse(readFileSync(output, "utf8"));
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      completeness: "complete-local-history",
      report: { totals: { events: 1, sessions: 1 } },
    });
    expect(() => exportLocalHistory(output, dir)).toThrow();
  });

  it("keeps the report and replay as local reads, with no second UI behind them", () => {
    // The bespoke loopback HTML page is gone (the primary dashboard reads the
    // real route contract from local-plane.ts). These two remain because they
    // are the report and export contract, not a parallel product.
    const dir = directory();
    appendLocalEvent(start(), dir);
    expect(buildLocalReport(dir).totals.events).toBe(1);
    expect(replayLocalSession("session-1", dir)).toMatchObject([
      { kind: "session.start" },
    ]);
  });

  it("cuts measured sessions on an axis ORTHOGONAL to displayable ones", () => {
    // Two predicates, two different jobs, and the whole point is that neither
    // implies the other. `DISPLAYABLE_SESSION_SQL` refuses a row nobody ever
    // ran: `projectEvent` opens a `local_session` for ANY unseen session id and
    // fills `repo_id` with an empty string, so an event that arrives without a
    // `session.start` manufactures a row. `MEASURED_SESSION_SQL` refuses a real
    // session that did nothing — the Claude Desktop spawn that starts, calls no
    // tool, and stops.
    //
    // All four corners exist below, because a fixture holding only the diagonal
    // passes with the two folded into one.
    const dir = directory();
    const events: SessionEvent[] = [
      // displayable AND measured: an ordinary session.
      {
        kind: "session.start",
        eventId: "both-start",
        sessionId: "b-both",
        at: "2026-08-01T12:00:00.000Z",
        repoId: "a".repeat(64),
        repoLabel: "seorak",
        agent: "claude-code",
        agentVersion: "1.0.0",
      },
      {
        kind: "tool.call",
        eventId: "both-call",
        sessionId: "b-both",
        at: "2026-08-01T12:01:00.000Z",
        toolName: "Read",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        costUsd: 0.01,
        errored: false,
      },
      // displayable, NOT measured: started, called nothing, ended.
      {
        kind: "session.start",
        eventId: "idle-start",
        sessionId: "c-displayable-only",
        at: "2026-08-01T12:02:00.000Z",
        repoId: "b".repeat(64),
        repoLabel: "atlas",
        agent: "claude-code",
        agentVersion: "1.0.0",
      },
      {
        kind: "session.end",
        eventId: "idle-end",
        sessionId: "c-displayable-only",
        at: "2026-08-01T12:03:00.000Z",
        reason: "other",
      },
      // measured, NOT displayable: a call whose `session.start` never arrived,
      // so the row it opened carries an empty `repo_id`.
      {
        kind: "tool.call",
        eventId: "orphan-call",
        sessionId: "d-measured-only",
        at: "2026-08-01T12:04:00.000Z",
        toolName: "Read",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        costUsd: 0.01,
        errored: false,
      },
      // neither.
      {
        kind: "session.end",
        eventId: "orphan-end",
        sessionId: "e-neither",
        at: "2026-08-01T12:05:00.000Z",
        reason: "other",
      },
    ];
    for (const event of events) appendLocalEvent(event, dir);

    const database = openLocalHistory(dir);
    try {
      const ids = (sql: string): string[] =>
        database
          .prepare(
            `SELECT session_id FROM local_session WHERE ${sql} ORDER BY session_id`,
          )
          .all()
          .map((row) => String((row as { session_id?: unknown }).session_id));

      expect(ids(MEASURED_SESSION_SQL)).toEqual(["b-both", "d-measured-only"]);
      expect(ids(DISPLAYABLE_SESSION_SQL)).toEqual([
        "b-both",
        "c-displayable-only",
      ]);
      // Each predicate keeps a row the other throws away. Fold one into the
      // other and one of these two lists goes empty.
      expect(
        ids(`${MEASURED_SESSION_SQL} AND NOT (${DISPLAYABLE_SESSION_SQL})`),
      ).toEqual(["d-measured-only"]);
      expect(
        ids(`${DISPLAYABLE_SESSION_SQL} AND NOT (${MEASURED_SESSION_SQL})`),
      ).toEqual(["c-displayable-only"]);
    } finally {
      database.close();
    }

    // And the ROW COUNT is untouched by any of it: `localHistoryCounts`
    // describes the database, not the work, so the session that measured
    // nothing is still one of its sessions and still one of its completed ones.
    expect(localHistoryCounts(dir)).toMatchObject({
      sessions: 2,
      completedSessions: 1,
    });
  });
});

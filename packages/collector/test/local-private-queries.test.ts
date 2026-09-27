import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  INTEGRATION_REPLAY_LENSES,
  type IntegrationScope,
  type SessionEvent,
} from "@seorak/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalIntegrationAuthorityChangedError,
  authorizeLocalIntegrationCredential,
  createLocalIntegrationCredential,
  type LocalIntegrationPrincipal,
} from "../src/local-integration-store.ts";
import {
  queryLocalPrivateOutcome,
  queryLocalPrivatePeriod,
  queryLocalPrivateReplayLens,
  queryLocalPrivateSessions,
} from "../src/local-private-queries.ts";
import {
  LocalReplayTooLargeError,
  LocalSessionOutcomeTooLargeError,
  buildLocalReplay,
  buildLocalReplayOnDatabase,
  buildLocalSessionOutcomeOnDatabase,
} from "../src/local-projection.ts";
import { appendLocalEvent, openLocalHistory } from "../src/local-store.ts";
import {
  FIXTURE_NOW,
  REPO_A,
  localHistoryFixture,
} from "./support/local-history-fixture.ts";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const API_AUDIENCE = "http://127.0.0.1:4318/api/v1";
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "seorak-local-private-"));
  temporary.push(path);
  return path;
}

function issue(
  dir: string,
  scope: IntegrationScope = "sessions:read",
  nowMs = NOW,
): LocalIntegrationPrincipal {
  const created = createLocalIntegrationCredential({
    directory: dir,
    audience: API_AUDIENCE,
    scopes: ["period:read", "sessions:read", "replay:read"],
    expiresAt: new Date(nowMs + 24 * 60 * 60_000).toISOString(),
    nowMs,
  });
  const authorized = authorizeLocalIntegrationCredential(
    `Bearer ${created.token}`,
    {
      directory: dir,
      audience: API_AUDIENCE,
      scope,
      routeClass: scope === "period:read" ? "aggregate" : "read",
      nowMs,
    },
  );
  if (!authorized.ok) throw new Error(`authorization failed: ${authorized.reason}`);
  return authorized.principal;
}

function append(dir: string, events: readonly SessionEvent[]): void {
  for (const event of events) appendLocalEvent(event, dir);
}

function start(
  sessionId: string,
  at: string,
  options: { agent?: string; repoId?: string } = {},
): SessionEvent {
  return {
    kind: "session.start",
    eventId: `${sessionId}-start`,
    sessionId,
    at,
    repoId: options.repoId ?? REPO_A,
    repoLabel: "private-project-label",
    agent: options.agent ?? "claude-code",
    agentVersion: "1.0.0",
    capabilities: {
      hasTokens: true,
      hasCacheTokens: true,
      cost: "estimated",
      toolResult: "both",
      endReason: true,
      duration: "measured",
      verification: "both",
      costScope: options.agent === "codex" ? "session" : "call",
      usageWindow: "count",
    },
  };
}

function call(
  sessionId: string,
  at: string,
  overrides: Partial<Extract<SessionEvent, { kind: "tool.call" }>> = {},
): Extract<SessionEvent, { kind: "tool.call" }> {
  return {
    kind: "tool.call",
    eventId: `${sessionId}-call-${at}-${overrides.toolName ?? "Read"}`,
    sessionId,
    at,
    toolName: "Read",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    ...overrides,
  };
}

function end(
  sessionId: string,
  at: string,
  reason: Extract<SessionEvent, { kind: "session.end" }>["reason"] = "clear",
): SessionEvent {
  return {
    kind: "session.end",
    eventId: `${sessionId}-end`,
    sessionId,
    at,
    reason,
  };
}

function rawEvent(
  database: DatabaseSync,
  input: {
    eventId: string;
    sessionId: string;
    kind: string;
    at: string;
    payload: unknown;
  },
): void {
  database
    .prepare(
      `INSERT INTO local_event (
         event_id, session_id, kind, at, payload_json, captured_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.eventId,
      input.sessionId,
      input.kind,
      input.at,
      JSON.stringify(input.payload),
      input.at,
    );
}

function sessionRefFor(
  principal: LocalIntegrationPrincipal,
  dir: string,
  startedAt: string,
  nowMs = NOW,
): string {
  const page = queryLocalPrivateSessions(principal, {
    directory: dir,
    limit: 100,
    cursor: null,
    now: new Date(nowMs),
  });
  const item = page.items.find((candidate) => candidate.startedAt === startedAt);
  if (item === undefined) throw new Error(`session at ${startedAt} was not listed`);
  return item.sessionRef;
}

function metric(
  result: NonNullable<ReturnType<typeof queryLocalPrivateReplayLens>["result"]>,
  row: string,
  key: string,
): number | boolean | null {
  const found = result.rows.find((candidate) => candidate.label === row)
    ?.metrics.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`missing ${row}/${key}`);
  return found.value;
}

describe("local private canonical queries", () => {
  it("keeps private period token legs window-accurate for a resident straddling session", () => {
    const dir = directory();
    const preWindow = new Date(NOW - 8 * 24 * 60 * 60_000).toISOString();
    const inWindow = new Date(NOW - 24 * 60 * 60_000).toISOString();
    append(dir, [
      start("straddling-token-period", preWindow),
      call("straddling-token-period", new Date(Date.parse(preWindow) + 1_000).toISOString(), {
        inputTokens: 900,
        outputTokens: 90,
        models: [{
          model: "claude-opus-4-5",
          inputTokens: 900,
          outputTokens: 90,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        }],
      }),
      call("straddling-token-period", inWindow, {
        inputTokens: 10,
        outputTokens: 2,
        models: [{
          model: "claude-opus-4-5",
          inputTokens: 10,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        }],
      }),
      end(
        "straddling-token-period",
        new Date(Date.parse(inWindow) + 1_000).toISOString(),
      ),
    ]);

    const period = queryLocalPrivatePeriod(issue(dir, "period:read"), 7, {
      directory: dir,
      now: new Date(NOW),
    });
    expect(period.metrics).toMatchObject({
      inputTokens: 10,
      outputTokens: 2,
    });
  });

  it("returns all four versioned DTO families with opaque references", () => {
    const dir = directory();
    append(dir, localHistoryFixture());
    const principal = issue(dir, "period:read", FIXTURE_NOW);
    const now = new Date(FIXTURE_NOW);

    const period = queryLocalPrivatePeriod(principal, 7, { directory: dir, now });
    expect(period.metrics).toMatchObject({
      sessionCount: expect.any(Number),
      toolCallCount: expect.any(Number),
      promptCount: null,
      inputTokens: null,
      outputTokens: null,
    });
    expect(period.coverage.matchedSessionCount).toBeGreaterThan(0);

    const sessions = queryLocalPrivateSessions(principal, {
      directory: dir,
      limit: 100,
      cursor: null,
      now,
    });
    expect(sessions.items.length).toBeGreaterThan(1);
    expect(sessions.items[0]).toMatchObject({
      sessionRef: expect.stringMatching(/^ses_[0-9a-f]{32}$/),
      projectRef: expect.stringMatching(/^prj_[0-9a-f]{32}$/),
    });
    const claudeStartedAt = localHistoryFixture().find(
      (event) => event.kind === "session.start" && event.sessionId === "claude-session",
    )!.at;
    const claudeRef = sessionRefFor(principal, dir, claudeStartedAt, FIXTURE_NOW);
    const outcome = queryLocalPrivateOutcome(principal, claudeRef, {
      directory: dir,
      now,
    });
    expect(outcome.outcome).toMatchObject({
      commitsLanded: expect.any(Number),
      endReason: "clear",
      lineSurvival: { rung: "3d" },
    });

    for (const lens of INTEGRATION_REPLAY_LENSES) {
      const projected = queryLocalPrivateReplayLens(principal, claudeRef, lens, {
        directory: dir,
        now,
      });
      expect(projected.result).toMatchObject({ lens, loadedSessionCount: 1 });
      const serialized = JSON.stringify(projected);
      expect(serialized).not.toContain("claude-session");
      expect(serialized).not.toContain(REPO_A);
      expect(serialized).not.toContain("private-project-label");
      expect(serialized).not.toMatch(/payload_json|promptText|command|filePath|diff|toolOutput/i);
    }
  });

  it("pins total matches and the requested window across a later-clock terminal page", () => {
    const dir = directory();
    for (const [index, hour] of [9, 10, 11].entries()) {
      const began = `2026-08-08T${hour.toString().padStart(2, "0")}:00:00.000Z`;
      append(dir, [
        start(`page-${index}`, began),
        call(`page-${index}`, new Date(Date.parse(began) + 500).toISOString(), {
          errored: false,
        }),
        end(`page-${index}`, new Date(Date.parse(began) + 1_500).toISOString()),
      ]);
    }
    const principal = issue(dir);
    const first = queryLocalPrivateSessions(principal, {
      directory: dir,
      limit: 2,
      cursor: null,
      now: new Date(NOW),
    });
    expect(first.coverage).toMatchObject({
      matchedSessionCount: 3,
      includedSessionCount: 2,
      complete: false,
      omissions: ["result-limit"],
    });
    expect(first.items.every((item) => item.elapsedSeconds === 1)).toBe(true);
    const second = queryLocalPrivateSessions(principal, {
      directory: dir,
      limit: 2,
      cursor: first.nextCursor,
      now: new Date(NOW + 1_500),
    });
    expect(second.coverage).toMatchObject({
      requested: first.coverage.requested,
      matchedSessionCount: 3,
      includedSessionCount: 1,
      complete: false,
      omissions: ["result-limit"],
    });
    expect(second.nextCursor).toBeNull();
    expect(second.items[0]!.elapsedSeconds).toBe(1);
  });

  it("uses persisted authority time when wall time rolls back between pages", () => {
    const dir = directory();
    append(dir, [
      start("rollback-old", "2026-08-09T13:29:00.000Z"),
      start("rollback-new", "2026-08-09T13:58:00.000Z"),
      end("rollback-new", "2026-08-09T13:59:00.000Z"),
    ]);
    const principal = issue(dir);
    const first = queryLocalPrivateSessions(principal, {
      directory: dir,
      limit: 1,
      cursor: null,
      now: new Date("2026-08-09T14:00:00.000Z"),
    });
    expect(first.nextCursor).not.toBeNull();
    const second = queryLocalPrivateSessions(principal, {
      directory: dir,
      limit: 1,
      cursor: first.nextCursor,
      now: new Date("2026-08-09T13:00:00.000Z"),
    });
    expect(second.freshness).toMatchObject({
      generatedAt: "2026-08-09T14:00:00.000Z",
      staleAt: "2026-08-09T14:05:00.000Z",
    });
    expect(second.items[0]).toMatchObject({
      startedAt: "2026-08-09T13:29:00.000Z",
      endedAt: null,
      status: "ended",
    });
  });

  it("uses lifecycle elapsed and silence status without clipping an unrestricted lifetime", () => {
    const dir = directory();
    const oldStart = "2026-04-01T10:00:00.000Z";
    const recent = "2026-08-09T11:00:00.000Z";
    append(dir, [
      start("straddled-request", oldStart),
      call("straddled-request", recent, { errored: false }),
      end("straddled-request", "2026-08-09T11:00:01.500Z"),
      start("stale-active", "2026-08-08T10:00:00.000Z", { agent: "codex" }),
    ]);
    const principal = issue(dir);
    const page = queryLocalPrivateSessions(principal, {
      directory: dir,
      limit: 10,
      cursor: null,
      now: new Date(NOW),
    });
    const straddled = page.items.find((item) => item.startedAt === oldStart)!;
    expect(straddled.elapsedSeconds).toBe(
      Math.floor((Date.parse("2026-08-09T11:00:01.500Z") - Date.parse(oldStart)) / 1_000),
    );
    expect(straddled.startedAt).toBe(oldStart);
    const stale = page.items.find(
      (item) => item.startedAt === "2026-08-08T10:00:00.000Z",
    )!;
    expect(stale).toMatchObject({ status: "ended", endedAt: null, elapsedSeconds: 0 });
  });

  it("matches canonical call-grain and session-grain summary cost", () => {
    const dir = directory();
    append(dir, [
      start("summary-claude", "2026-08-09T10:00:00.000Z"),
      call("summary-claude", "2026-08-09T10:00:00.500Z", {
        eventId: "summary-claude-priced",
        models: [{
          model: "claude-opus-4-5",
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        }],
      }),
      call("summary-claude", "2026-08-09T10:00:01.000Z", {
        eventId: "summary-claude-schema-zero",
      }),
      end("summary-claude", "2026-08-09T10:00:01.500Z"),
      start("summary-codex", "2026-08-09T09:00:00.000Z", { agent: "codex" }),
      call("summary-codex", "2026-08-09T09:00:00.500Z"),
      {
        kind: "session.tokens",
        eventId: "summary-codex-tokens",
        sessionId: "summary-codex",
        at: "2026-08-09T09:00:01.000Z",
        models: [{
          model: "gpt-5-codex",
          inputTokens: 200,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }],
      },
      end("summary-codex", "2026-08-09T09:00:02.500Z"),
    ]);
    const page = queryLocalPrivateSessions(issue(dir), {
      directory: dir,
      limit: 10,
      cursor: null,
      now: new Date(NOW),
    });

    expect(
      page.items.find((item) => item.startedAt === "2026-08-09T10:00:00.000Z")
        ?.costUsd,
    ).toBeCloseTo(0.001);
    expect(
      page.items.find((item) => item.startedAt === "2026-08-09T09:00:00.000Z")
        ?.costUsd,
    ).toBeNull();
  });

  it("keeps retrospective maturation while bounding lifecycle evidence", () => {
    const dir = directory();
    const startedAt = "2026-08-05T11:59:00.000Z";
    const endedAt = "2026-08-05T12:00:00.000Z";
    append(dir, [
      start("matured", startedAt),
      call("matured", "2026-08-05T11:59:30.000Z", { errored: false }),
      {
        kind: "session.delta",
        eventId: "matured-delta",
        sessionId: "matured",
        at: endedAt,
        repoId: REPO_A,
        repoLabel: "private-project-label",
        gitContext: "clean",
        startGitContext: "clean",
        headMoved: true,
        commitsLanded: 4,
        filesTouchedUncommitted: 0,
        linesAddedUncommitted: 0,
        linesDeletedUncommitted: 0,
        generatedLinesExcludedUncommitted: 0,
      },
      end("matured", endedAt, "clear"),
      {
        kind: "session.linesurvival",
        eventId: "matured-survival",
        sessionId: "matured",
        at: new Date(NOW).toISOString(),
        repoId: REPO_A,
        gitContext: "clean",
        rung: "3d",
        fate: "retained",
        commitsChecked: 4,
        linesAuthored: 20,
        linesSurviving: 15,
      },
    ]);
    const principal = issue(dir);
    const sessionRef = sessionRefFor(principal, dir, startedAt);
    expect(
      queryLocalPrivateOutcome(principal, sessionRef, {
        directory: dir,
        now: new Date(NOW),
      }).outcome,
    ).toMatchObject({
      commitsLanded: 4,
      errorCount: 0,
      endReason: "clear",
      lineSurvival: { rung: "3d", fate: "retained", rate: 0.75 },
    });
  });

  it("fails closed on malformed stored calls at call grain", () => {
    const dir = directory();
    const startedAt = "2026-08-09T10:00:00.000Z";
    append(dir, [
      start("corrupt-call", startedAt),
      call("corrupt-call", "2026-08-09T10:00:01.000Z", {
        toolName: "Read",
        errored: false,
        models: [{
          model: "claude-opus-4-5",
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        }],
      }),
      call("corrupt-call", "2026-08-09T10:00:01.500Z", {
        toolName: "Read",
        models: [{
          model: "claude-opus-4-5",
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        }],
      }),
      end("corrupt-call", "2026-08-09T10:00:03.000Z"),
    ]);
    const database = openLocalHistory(dir);
    rawEvent(database, {
      eventId: "corrupt-call-row",
      sessionId: "corrupt-call",
      kind: "tool.call",
      at: "2026-08-09T10:00:02.000Z",
      payload: { kind: "tool.call", models: "not-an-array" },
    });
    rawEvent(database, {
      eventId: "mismatched-call-row",
      sessionId: "corrupt-call",
      kind: "tool.call",
      at: "2026-08-09T10:00:02.500Z",
      payload: {
        kind: "session.prompt",
        eventId: "mismatched-call-row",
        sessionId: "corrupt-call",
        at: "2026-08-09T10:00:02.500Z",
      },
    });
    database.close();
    const principal = issue(dir);
    const sessionRef = sessionRefFor(principal, dir, startedAt);
    const outcome = queryLocalPrivateOutcome(principal, sessionRef, {
      directory: dir,
      now: new Date(NOW),
    });
    expect(outcome.outcome).toMatchObject({ errorCount: null, firstErrorAt: null });

    const detail = queryLocalPrivateReplayLens(principal, sessionRef, "session-detail", {
      directory: dir,
      now: new Date(NOW),
    }).result!;
    expect(metric(detail, "Measured totals", "toolCalls")).toBe(4);
    expect(metric(detail, "Measured totals", "prompts")).toBeNull();
    expect(metric(detail, "Measured totals", "tokens")).toBeNull();
    expect(metric(detail, "Measured totals", "costUsd")).toBeNull();
    const mix = queryLocalPrivateReplayLens(principal, sessionRef, "tool-mix", {
      directory: dir,
      now: new Date(NOW),
    }).result!;
    expect(metric(mix, "Read", "errors")).toBeNull();
    expect(metric(mix, "Unknown tool", "errors")).toBeNull();
    expect(metric(mix, "Unknown tool", "costUsd")).toBeNull();
  });

  it("keeps session-grain token snapshots authoritative despite a malformed call", () => {
    const dir = directory();
    const startedAt = "2026-08-09T09:00:00.000Z";
    append(dir, [
      start("codex-corrupt", startedAt, { agent: "codex" }),
      call("codex-corrupt", "2026-08-09T09:00:01.000Z", { errored: false }),
      {
        kind: "session.tokens",
        eventId: "codex-tokens",
        sessionId: "codex-corrupt",
        at: "2026-08-09T09:00:02.000Z",
        models: [{
          model: "gpt-5-codex",
          inputTokens: 200,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }],
      },
      end("codex-corrupt", "2026-08-09T09:00:04.000Z"),
    ]);
    const database = openLocalHistory(dir);
    rawEvent(database, {
      eventId: "codex-corrupt-row",
      sessionId: "codex-corrupt",
      kind: "tool.call",
      at: "2026-08-09T09:00:03.000Z",
      payload: {},
    });
    database.close();
    const principal = issue(dir);
    const sessionRef = sessionRefFor(principal, dir, startedAt);
    const detail = queryLocalPrivateReplayLens(principal, sessionRef, "session-detail", {
      directory: dir,
      now: new Date(NOW),
    }).result!;
    expect(metric(detail, "Measured totals", "toolCalls")).toBe(2);
    expect(metric(detail, "Measured totals", "tokens")).toBe(250);
    expect(metric(detail, "Measured totals", "costUsd")).toEqual(expect.any(Number));
    const mix = queryLocalPrivateReplayLens(principal, sessionRef, "tool-mix", {
      directory: dir,
      now: new Date(NOW),
    }).result!;
    expect(metric(mix, "Unknown tool", "errors")).toBeNull();
  });

  it("pins bounded evidence to a nonreusable local sequence high-water", () => {
    const dir = directory();
    const startedAt = "2026-08-09T08:00:00.000Z";
    append(dir, [
      start("snapshot", startedAt),
      call("snapshot", "2026-08-09T08:00:01.000Z", { errored: false }),
      end("snapshot", "2026-08-09T08:00:02.000Z"),
    ]);
    const database = openLocalHistory(dir);
    const originalPrepare = database.prepare.bind(database);
    let appendedOutcome = false;
    const wrapped = new Proxy(database, {
      get(target, property) {
        if (property !== "prepare") {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (sql: string) => {
          const statement = originalPrepare(sql);
          if (!sql.includes("COUNT(*) AS outcome_rows")) return statement;
          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              if (statementProperty !== "get") {
                const value = Reflect.get(
                  statementTarget,
                  statementProperty,
                  statementTarget,
                );
                return typeof value === "function" ? value.bind(statementTarget) : value;
              }
              return (...args: unknown[]) => {
                const result = statementTarget.get(...(args as never[]));
                if (!appendedOutcome) {
                  appendedOutcome = true;
                  rawEvent(database, {
                    eventId: "snapshot-late-call",
                    sessionId: "snapshot",
                    kind: "tool.call",
                    at: "2026-08-09T08:00:01.500Z",
                    payload: call("snapshot", "2026-08-09T08:00:01.500Z", {
                      eventId: "snapshot-late-call",
                      errored: true,
                    }),
                  });
                }
                return result;
              };
            },
          });
        };
      },
    }) as unknown as DatabaseSync;
    try {
      expect(
        buildLocalSessionOutcomeOnDatabase(wrapped, "snapshot", {
          nowMs: NOW,
          rowBudget: 10,
          window: {
            startedAt,
            lastEventAt: "2026-08-09T08:00:02.000Z",
          },
        }),
      ).toMatchObject({ errorCount: 0, firstErrorAt: null });
    } finally {
      database.close();
    }
  });

  it("does not admit a replay row appended between its preflight and payload read", () => {
    const dir = directory();
    const startedAt = "2026-08-09T07:30:00.000Z";
    append(dir, [
      start("replay-snapshot", startedAt),
      call("replay-snapshot", "2026-08-09T07:30:01.000Z", { errored: false }),
      end("replay-snapshot", "2026-08-09T07:30:02.000Z"),
    ]);
    const database = openLocalHistory(dir);
    const originalPrepare = database.prepare.bind(database);
    let appended = false;
    const wrapped = new Proxy(database, {
      get(target, property) {
        if (property !== "prepare") {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (sql: string) => {
          const statement = originalPrepare(sql);
          if (!sql.includes("COUNT(*) AS replay_rows")) return statement;
          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              if (statementProperty !== "get") {
                const value = Reflect.get(
                  statementTarget,
                  statementProperty,
                  statementTarget,
                );
                return typeof value === "function" ? value.bind(statementTarget) : value;
              }
              return (...args: unknown[]) => {
                const result = statementTarget.get(...(args as never[]));
                if (!appended) {
                  appended = true;
                  rawEvent(database, {
                    eventId: "replay-snapshot-late",
                    sessionId: "replay-snapshot",
                    kind: "tool.call",
                    at: "2026-08-09T07:30:01.500Z",
                    payload: call("replay-snapshot", "2026-08-09T07:30:01.500Z", {
                      eventId: "replay-snapshot-late",
                      errored: true,
                    }),
                  });
                }
                return result;
              };
            },
          });
        };
      },
    }) as unknown as DatabaseSync;
    try {
      const replay = buildLocalReplayOnDatabase(wrapped, "replay-snapshot", {
        rowBudget: 10,
        integrationMeasurements: true,
        window: {
          startedAt,
          lastEventAt: "2026-08-09T07:30:02.000Z",
        },
      });
      expect(replay?.totals).toMatchObject({
        toolCallCount: 1,
        measured: { errors: true },
      });
    } finally {
      database.close();
    }
  });

  it("counts only the seven replay kinds under a bounded external row budget", () => {
    // `kinds: "replay"` is the EXTERNAL lens and is now said rather than
    // implied. It used to ride along with `rowBudget` being non-null, which
    // meant the first-party plane could not bound its own read without also
    // narrowing what a replay contains. The 9,999 `session.linesurvival` rows
    // below are exactly the rows that separate the two answers.
    const dir = directory();
    const startedAt = "2026-08-09T07:00:00.000Z";
    append(dir, [
      start("budget", startedAt),
      call("budget", "2026-08-09T07:00:01.000Z", { errored: false }),
      call("budget", "2026-08-09T07:00:02.000Z", { errored: false }),
    ]);
    const database = openLocalHistory(dir);
    database.exec(`
      WITH RECURSIVE numbers(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM numbers WHERE value < 9999
      )
      INSERT INTO local_event (
        event_id, session_id, kind, at, payload_json, captured_at
      )
      SELECT
        'irrelevant-' || value,
        'budget',
        'session.linesurvival',
        '2026-08-09T07:00:01.500Z',
        '{"kind":"session.linesurvival"}',
        '2026-08-09T07:00:01.500Z'
      FROM numbers
    `);
    try {
      expect(
        buildLocalReplayOnDatabase(database, "budget", {
          kinds: "replay",
          rowBudget: 3,
          integrationMeasurements: true,
          window: {
            startedAt,
            lastEventAt: "2026-08-09T07:00:02.000Z",
          },
        })?.totals.toolCallCount,
      ).toBe(2);
      expect(() =>
        buildLocalReplayOnDatabase(database, "budget", {
          kinds: "replay",
          rowBudget: 2,
          integrationMeasurements: true,
          window: {
            startedAt,
            lastEventAt: "2026-08-09T07:00:02.000Z",
          },
        }),
      ).toThrow(LocalReplayTooLargeError);
      expect(() =>
        buildLocalSessionOutcomeOnDatabase(database, "budget", {
          kinds: "replay",
          rowBudget: 1,
          window: {
            startedAt,
            lastEventAt: "2026-08-09T07:00:02.000Z",
          },
        }),
      ).toThrow(LocalSessionOutcomeTooLargeError);
    } finally {
      database.close();
    }
  });

  it("preserves the first-party all-event replay sequence", () => {
    const dir = directory();
    const startedAt = "2026-08-09T06:00:00.000Z";
    append(dir, [
      start("first-party", startedAt),
      call("first-party", "2026-08-09T06:00:01.000Z", { errored: false }),
      {
        kind: "session.linesurvival",
        eventId: "first-party-ignored",
        sessionId: "first-party",
        at: "2026-08-09T06:00:02.000Z",
        repoId: REPO_A,
        gitContext: "clean",
        rung: "3d",
        fate: "unknown",
        commitsChecked: 1,
        linesAuthored: 0,
        linesSurviving: 0,
      },
      call("first-party", "2026-08-09T06:00:03.000Z", { errored: false }),
    ]);
    expect(
      buildLocalReplay("first-party", { directory: dir })?.moments.map(
        (moment) => moment.seq,
      ),
    ).toEqual([2, 4]);
  });

  it("folds the period window WITHOUT holding the write lock", () => {
    // The whole of offender 1, as a behavioural assertion rather than a comment.
    //
    // `querySnapshot` used to wrap both the project-reference allocation and the
    // overview fold in ONE `BEGIN IMMEDIATE`, so a read held SQLite's write lock
    // for the length of the fold: measured at 2,312 ms over the author's
    // 345,764-row history, against the 5,000 ms `busy_timeout` the collector's
    // own capture appends are waiting on.
    //
    // Here a second connection holds the write lock for the duration. Under the
    // old shape this call could not begin: it would block on BEGIN IMMEDIATE and
    // throw SQLITE_BUSY after five seconds. Under the split it is a
    // `BEGIN DEFERRED` read snapshot, which in WAL mode does not contend with a
    // writer at all, and an unrestricted principal allocates nothing so it never
    // asks for the lock.
    const dir = directory();
    append(dir, [
      start("lockheld", "2026-08-09T05:00:00.000Z"),
      end("lockheld", "2026-08-09T05:01:00.000Z"),
    ]);
    const principal = issue(dir, "period:read");
    expect(principal.restrictions.repoId).toBeNull();

    const writer = openLocalHistory(dir);
    try {
      writer.exec("BEGIN IMMEDIATE");
      const period = queryLocalPrivatePeriod(principal, 7, {
        directory: dir,
        now: new Date(NOW),
      });
      expect(period.metrics).not.toBeNull();
      writer.exec("ROLLBACK");
    } finally {
      writer.close();
    }
  });

  it("refuses a changed authority shape BEFORE it allocates anything", () => {
    // The ordering the split had to preserve. With one transaction the
    // provenance assertion ran first and a failure rolled the allocation back;
    // with two, the assertion is hoisted out of both so nothing is written on a
    // history whose authority shape has changed. Asserting the throw alone would
    // not pin that, because the throw came from a different statement.
    const dir = directory();
    append(dir, [
      start("restricted", "2026-08-09T05:00:00.000Z"),
      end("restricted", "2026-08-09T05:01:00.000Z"),
    ]);
    const unrestricted = issue(dir, "period:read");
    const principal = {
      ...unrestricted,
      restrictions: { ...unrestricted.restrictions, repoId: REPO_A },
    };

    const altered = openLocalHistory(dir);
    altered.exec("ALTER TABLE local_session ADD COLUMN member_id TEXT");
    altered.close();

    expect(() =>
      queryLocalPrivatePeriod(principal, 7, { directory: dir, now: new Date(NOW) }),
    ).toThrow(LocalIntegrationAuthorityChangedError);

    const database = openLocalHistory(dir);
    try {
      const allocated = database
        .prepare("SELECT COUNT(*) AS n FROM local_integration_project_ref")
        .get() as { n?: unknown };
      expect(Number(allocated?.n ?? -1)).toBe(0);
    } finally {
      database.close();
    }
  });

  it("reasserts Personal authority at every canonical query entrypoint", () => {
    const dir = directory();
    const startedAt = "2026-08-09T05:00:00.000Z";
    append(dir, [start("authority", startedAt), end("authority", "2026-08-09T05:01:00.000Z")]);
    const principal = issue(dir);
    const sessionRef = sessionRefFor(principal, dir, startedAt);
    const database = openLocalHistory(dir);
    database.exec("ALTER TABLE local_session ADD COLUMN member_id TEXT");
    database.close();

    expect(() => queryLocalPrivatePeriod(principal, 7, { directory: dir, now: new Date(NOW) }))
      .toThrow(LocalIntegrationAuthorityChangedError);
    expect(() => queryLocalPrivateSessions(principal, {
      directory: dir,
      limit: 10,
      cursor: null,
      now: new Date(NOW),
    })).toThrow(LocalIntegrationAuthorityChangedError);
    expect(() => queryLocalPrivateOutcome(principal, sessionRef, {
      directory: dir,
      now: new Date(NOW),
    })).toThrow(LocalIntegrationAuthorityChangedError);
    expect(() => queryLocalPrivateReplayLens(principal, sessionRef, "tool-mix", {
      directory: dir,
      now: new Date(NOW),
    })).toThrow(LocalIntegrationAuthorityChangedError);
  });

  it("does not let a narrower principal reuse a wider opaque session reference", () => {
    const dir = directory();
    const startedAt = "2026-08-09T04:00:00.000Z";
    append(dir, [
      start("restricted-ref", startedAt),
      end("restricted-ref", "2026-08-09T04:01:00.000Z"),
      start("active-upper", "2026-08-09T10:00:00.000Z"),
    ]);
    const wide = issue(dir);
    const endedRef = sessionRefFor(wide, dir, startedAt);
    const activeRef = sessionRefFor(wide, dir, "2026-08-09T10:00:00.000Z");
    const created = createLocalIntegrationCredential({
      directory: dir,
      audience: API_AUDIENCE,
      scopes: ["sessions:read", "replay:read"],
      expiresAt: new Date(NOW + 24 * 60 * 60_000).toISOString(),
      dataNotBefore: "2026-08-09T05:00:00.000Z",
      dataNotAfter: "2026-08-09T11:00:00.000Z",
      nowMs: NOW,
    });
    const authorized = authorizeLocalIntegrationCredential(
      `Bearer ${created.token}`,
      {
        directory: dir,
        audience: API_AUDIENCE,
        scope: "sessions:read",
        routeClass: "read",
        nowMs: NOW,
      },
    );
    if (!authorized.ok) throw new Error(authorized.reason);

    for (const sessionRef of [endedRef, activeRef]) {
      expect(
        queryLocalPrivateOutcome(authorized.principal, sessionRef, {
          directory: dir,
          now: new Date(NOW),
        }),
      ).toMatchObject({
        availability: {
          state: "unavailable",
          reason: "outside-credential-restriction",
        },
        outcome: null,
      });
    }
  });
});

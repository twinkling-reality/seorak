import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  EVENT_BATCH_EVENT_LIMIT,
  EVENT_BATCH_SCHEMA_VERSION,
  EVENT_LINE_SURVIVAL_COMMIT_LIMIT,
  EVENT_MODEL_LIMIT,
  EventBatchSchema,
  SESSION_EVENT_KINDS,
  SESSION_EVENT_SCHEMAS,
  SessionEventSchema,
  parseEventBatch,
  parseSessionEvent,
} from "../src/event-validation.ts";
import type { SessionEvent } from "../src/events.ts";

const at = "2026-07-27T12:00:00.000Z";
const repoId = "a".repeat(64);
const fileId = "b".repeat(64);
const dirId = "c".repeat(64);
const eventsSource = readFileSync(new URL("../src/events.ts", import.meta.url), "utf8");
const validationSource = readFileSync(
  new URL("../src/event-validation.ts", import.meta.url),
  "utf8",
);
const envelope = <Kind extends SessionEvent["kind"]>(kind: Kind) => ({
  kind,
  eventId: `event-${kind}`,
  sessionId: "session-1",
  at,
});
const tokens = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
};

const events = [
  {
    ...envelope("session.start"),
    repoId,
    repoLabel: "seorak",
    agent: "claude-code",
    agentVersion: "1.2.3",
    capabilities: {
      hasTokens: true,
      hasCacheTokens: true,
      cost: "billed",
      toolResult: "both",
    },
  },
  {
    ...envelope("tool.call"),
    toolName: "Read",
    ...tokens,
    costUsd: 0.01,
    models: [{ model: "gpt-5.6-sol", ...tokens, costUsd: 0.01 }],
  },
  { ...envelope("session.end"), reason: "clear" },
  {
    ...envelope("session.notification"),
    notificationType: "permission_prompt",
  },
  {
    ...envelope("git.momentum"),
    repoId,
    repoLabel: "seorak",
    gitContext: "clean",
    windowDays: 7,
    commits: 1,
    filesTouched: 2,
    linesAdded: 3,
    linesDeleted: 1,
    generatedLinesExcluded: 0,
    repoShape: { monorepo: true, sizeBand: "m", ageBand: "mature" },
  },
  {
    ...envelope("session.delta"),
    repoId,
    repoLabel: "seorak",
    gitContext: "clean",
    startGitContext: "clean",
    commitsLanded: 1,
    headMoved: true,
    filesTouchedUncommitted: 0,
    linesAddedUncommitted: 0,
    linesDeletedUncommitted: 0,
    generatedLinesExcludedUncommitted: 0,
  },
  {
    ...envelope("session.linesurvival"),
    repoId,
    gitContext: "clean",
    rung: "3d",
    fate: "retained",
    commitsChecked: 1,
    linesAuthored: 10,
    linesSurviving: 8,
    commits: [
      { id: "a".repeat(64), added: 12, contested: 2, authored: 10 },
    ],
  },
  {
    ...envelope("repo.toolchain"),
    repoId,
    gitContext: "clean",
    packageManager: "npm",
    framework: "react",
  },
  envelope("session.prompt"),
  {
    ...envelope("session.tokens"),
    models: [{ model: "gpt-5.6-sol", ...tokens }],
  },
  {
    ...envelope("agent.quota"),
    tool: "codex",
    windows: [{ windowMinutes: 300, usedPercent: 12.5, resetsAt: at }],
  },
] as const;

describe("shared event runtime contract", () => {
  it("accepts all 11 strict event variants", () => {
    const fixtureKinds = events.map((event) => event.kind);
    assert.deepEqual(
      [...fixtureKinds].sort(),
      [...SESSION_EVENT_KINDS].sort(),
    );
    assert.equal(new Set(fixtureKinds).size, SESSION_EVENT_KINDS.length);
    for (const event of events) {
      assert.equal(
        SESSION_EVENT_SCHEMAS[event.kind].safeParse(event).success,
        true,
        event.kind,
      );
      assert.equal(SessionEventSchema.safeParse(event).success, true, event.kind);
      assert.notEqual(parseSessionEvent(event), null, event.kind);
    }
  });

  it("keeps AgentId open while enforcing current salted identity shapes", () => {
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[10],
        tool: "future-agent",
      }).success,
      true,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[10],
        tool: "future agent",
      }).success,
      false,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[1],
        fileId,
        dirId,
      }).success,
      true,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[0],
        repoId: "opaque-repo-id",
      }).success,
      false,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[1],
        fileId: "opaque-file-id",
      }).success,
      false,
    );
  });

  it("rejects unknown top-level and nested keys", () => {
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[8],
        promptText: "must never travel",
      }).success,
      false,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[1],
        models: [{ ...events[1].models[0], rawResponse: "private" }],
      }).success,
      false,
    );
  });

  it("bounds ids, labels, model arrays, and line-survival commits", () => {
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[0],
        repoLabel: "x".repeat(256),
      }).success,
      false,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[0],
        repoLabel: "private/path",
      }).success,
      false,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[9],
        models: Array.from({ length: EVENT_MODEL_LIMIT + 1 }, () =>
          events[9].models[0],
        ),
      }).success,
      false,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[6],
        commits: Array.from(
          { length: EVENT_LINE_SURVIVAL_COMMIT_LIMIT + 1 },
          () => events[6].commits[0],
        ),
      }).success,
      false,
    );
  });

  it("enforces current line-survival and quota invariants", () => {
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[8],
        at: "next Tuesday",
      }).success,
      false,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[6],
        linesSurviving: 11,
      }).success,
      false,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[6],
        commits: [
          { id: "a".repeat(64), added: 3, contested: 2, authored: 2 },
        ],
      }).success,
      false,
    );
    assert.equal(
      SessionEventSchema.safeParse({
        ...events[10],
        windows: [{ windowMinutes: 300, usedPercent: 101, resetsAt: at }],
      }).success,
      false,
    );
  });

  it("rejects the retired reachability event kind", () => {
    const retiredKind = ["session", "survival"].join(".");
    const retiredType = ["Session", "Survival", "Event"].join("");
    const retired = {
      kind: retiredKind,
      eventId: "retired-event",
      sessionId: "session-1",
      at,
      repoId,
      repoLabel: "seorak",
      gitContext: "clean",
    };
    assert.equal((SESSION_EVENT_KINDS as readonly string[]).includes(retiredKind), false);
    assert.equal(retiredKind in SESSION_EVENT_SCHEMAS, false);
    assert.equal(SessionEventSchema.safeParse(retired).success, false);
    assert.equal(parseSessionEvent(retired), null);
    assert.equal(eventsSource.includes(retiredKind), false);
    assert.equal(eventsSource.includes(`interface ${retiredType}`), false);
    assert.equal(validationSource.includes(retiredKind), false);
    assert.equal(validationSource.includes(`export const ${retiredType}Schema`), false);
  });
});

describe("versioned event batch contract", () => {
  const current = {
    schemaVersion: EVENT_BATCH_SCHEMA_VERSION,
    collectorVersion: "0.0.0",
    deviceId: "device-1",
    events: [events[8]],
  };

  it("accepts exactly the required current schemaVersion", () => {
    assert.notEqual(parseEventBatch(current), null);
    const { schemaVersion: _removed, ...missingVersion } = current;
    assert.equal(parseEventBatch(missingVersion), null);
  });

  it("rejects unsupported versions, unknown envelope keys, and oversized counts", () => {
    assert.equal(parseEventBatch({ ...current, schemaVersion: 2 }), null);
    assert.equal(parseEventBatch({ ...current, extra: true }), null);
    assert.equal(
      EventBatchSchema.safeParse({
        ...current,
        events: Array.from(
          { length: EVENT_BATCH_EVENT_LIMIT + 1 },
          () => events[8],
        ),
      }).success,
      false,
    );
  });
});

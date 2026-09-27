/**
 * measured-sessions.test.ts — the session count is a count of WORK.
 *
 * `usage.totals.sessions` counted every session that opened. A `session.start`
 * with no `tool.call` between it and its `session.end` is not a rare shape:
 * Claude Desktop spawns short-lived Claude Code processes, and on one real
 * machine 93% of a day's sessions looked exactly like that: the week read 2930
 * where 1202 sessions had measured anything, and the Compare delta divides one
 * such count by another.
 *
 * The rule is `sessionMeasuredWork` (@seorak/types): `toolCallCount > 0` OR the
 * carrier priced it. The carrier leg is not decoration — Codex reports money at
 * SESSION scope, so a carrier-priced session with zero tool calls is real spend,
 * and dropping it would put `cost.sessionsWithCost` above the count above it.
 *
 * The fixtures here are deliberately NOT the shared one in `support/`: that
 * fixture gives every session a tool call, which is the exact shape that cannot
 * tell "sessions that started" from "sessions that measured something" apart.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionEvent } from "@seorak/types";
import { appendLocalEvent } from "../src/local-store.ts";
import { buildLocalOverview } from "../src/local-projection.ts";
import {
  FIXTURE_PRICED_MODEL,
  FIXTURE_UNPRICED_MODEL,
} from "./support/local-history-fixture.ts";

const NOW = Date.parse("2026-08-02T12:00:00.000Z");
const REPO = "a".repeat(64);

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

/** Day offsets are back from `NOW`, so 0-6 is the window and 7-13 is the prior
 *  leg of the delta. */
function at(dayOffset: number, hour: number, minute = 0): string {
  return new Date(
    NOW -
      dayOffset * 24 * 60 * 60 * 1000 +
      (hour - 12) * 3_600_000 +
      minute * 60_000,
  ).toISOString();
}

/** THE SHAPE UNDER TEST: a process that started, measured nothing, and stopped. */
function measureless(id: string, dayOffset: number, hour: number): SessionEvent[] {
  return [
    {
      kind: "session.start",
      eventId: `${id}-start`,
      sessionId: id,
      at: at(dayOffset, hour),
      repoId: REPO,
      repoLabel: "seorak",
      agent: "claude-code",
      agentVersion: "1.0.0",
    },
    {
      kind: "session.end",
      eventId: `${id}-end`,
      sessionId: id,
      at: at(dayOffset, hour, 1),
      reason: "other",
    },
  ];
}

function working(
  id: string,
  dayOffset: number,
  hour: number,
  model = FIXTURE_PRICED_MODEL,
): SessionEvent[] {
  return [
    {
      kind: "session.start",
      eventId: `${id}-start`,
      sessionId: id,
      at: at(dayOffset, hour),
      repoId: REPO,
      repoLabel: "seorak",
      agent: "claude-code",
      agentVersion: "1.0.0",
    },
    {
      kind: "tool.call",
      eventId: `${id}-call`,
      sessionId: id,
      at: at(dayOffset, hour, 1),
      toolName: "Edit",
      inputTokens: 1_000,
      outputTokens: 200,
      cacheReadTokens: 500,
      cacheWriteTokens: 100,
      costUsd: 0,
      errored: false,
      linesAdded: 10,
      linesRemoved: 2,
      models: [
        {
          model,
          inputTokens: 1_000,
          outputTokens: 200,
          cacheReadTokens: 500,
          cacheWriteTokens: 100,
          costUsd: 0,
        },
      ],
    },
    {
      kind: "session.end",
      eventId: `${id}-end`,
      sessionId: id,
      at: at(dayOffset, hour, 2),
      reason: "clear",
    },
  ];
}

/** Codex: money at SESSION scope, on a cumulative carrier, and NO tool call at
 *  all. The one session that measured work without a `tool.call` to show for it. */
function carrierPriced(id: string, dayOffset: number, hour: number): SessionEvent[] {
  return [
    {
      kind: "session.start",
      eventId: `${id}-start`,
      sessionId: id,
      at: at(dayOffset, hour),
      repoId: REPO,
      repoLabel: "seorak",
      agent: "codex",
      agentVersion: "0.144.3",
    },
    {
      kind: "session.tokens",
      eventId: `${id}-tokens`,
      sessionId: id,
      at: at(dayOffset, hour, 1),
      models: [
        {
          model: "gpt-5.1-codex",
          inputTokens: 12_000,
          outputTokens: 2_500,
          cacheReadTokens: 5_000,
          cacheWriteTokens: 0,
        },
      ],
    },
  ];
}

function seededWith(...groups: SessionEvent[][]): string {
  const dir = mkdtempSync(join(tmpdir(), "seorak-measured-"));
  temporary.push(dir);
  for (const group of groups) {
    for (const event of group) appendLocalEvent(event, dir);
  }
  return dir;
}

function overview(dir: string, rangeDays = 7) {
  return buildLocalOverview({ directory: dir, rangeDays, nowMs: NOW });
}

describe("the session count counts sessions that measured something", () => {
  it("drops a start-and-end-only session and leaves the work beside it alone", () => {
    const alone = overview(seededWith(working("real", 2, 9)));
    const crowded = overview(
      seededWith(
        working("real", 2, 9),
        measureless("idle-a", 2, 10),
        measureless("idle-b", 2, 11),
        measureless("idle-c", 1, 9),
      ),
    );

    expect(crowded.usage.totals.sessions).toBe(1);
    expect(crowded.usage.totals.sessions).toBe(alone.usage.totals.sessions);
    // The count moved and NOTHING ELSE did. A count correction that also moved
    // the money or the calls would be a different change wearing this one's name.
    expect(crowded.usage.totals.toolCalls).toBe(alone.usage.totals.toolCalls);
    expect(crowded.usage.totals.toolCalls).toBe(1);
    expect(crowded.usage.cost.totalUsd).toBe(alone.usage.cost.totalUsd);
    expect(crowded.usage.cost.totalUsd).not.toBeNull();
    expect(crowded.usage.cost.sessionsWithCost).toBe(
      alone.usage.cost.sessionsWithCost,
    );
    // The invariant a web surface renders as a sentence.
    expect(crowded.usage.cost.sessionsWithCost).toBeLessThanOrEqual(
      crowded.usage.totals.sessions,
    );
  });

  it("moves the whole `session.start` branch, not the headline alone", () => {
    // One block feeds four members. A guard on the delta leg alone would leave
    // the daily series and the day/hour heatmap counting processes while the
    // headline above them counted work — the same sessions in two counts at once.
    const snapshot = overview(
      seededWith(
        working("real", 2, 9),
        measureless("idle-a", 2, 10),
        measureless("idle-b", 4, 10),
      ),
    );
    expect(snapshot.usage.dailyTrends.reduce((sum, day) => sum + day.sessions, 0)).toBe(1);
    // Day 4 held nothing but a measureless session, so it is not a zero-filled
    // row on the series either — it is not a row.
    expect(snapshot.usage.dailyTrends.map((day) => day.sessions)).toEqual([1]);
    expect(
      snapshot.activity.hourlyDistribution.reduce(
        (sum, bucket) => sum + bucket.sessions,
        0,
      ),
    ).toBe(1);
    // The per-project card reads the same accumulators as the headline, so it
    // inherits both halves rather than re-deriving them.
    expect(snapshot.usage.projects).toHaveLength(1);
    expect(snapshot.usage.projects[0]!.sessions).toBe(1);
    expect(snapshot.usage.projects[0]!.sessionsDelta).toEqual({
      current: 1,
      previous: null,
    });
  });

  it("filters BOTH legs of `sessionsDelta`, not just the current one", () => {
    // The tempting wrong fix. Filtering the current window alone turns an
    // overstatement into a comparison between two different questions — measured
    // work this week against processes started last week — which is a NEW wrong
    // number rather than the old one made smaller.
    const snapshot = overview(
      seededWith(
        working("current-real", 2, 9),
        measureless("current-idle-a", 2, 10),
        measureless("current-idle-b", 3, 10),
        measureless("current-idle-c", 4, 10),
        working("prior-real", 9, 9),
        measureless("prior-idle-a", 9, 10),
        measureless("prior-idle-b", 10, 10),
        measureless("prior-idle-c", 11, 10),
        measureless("prior-idle-d", 12, 10),
        measureless("prior-idle-e", 13, 10),
      ),
    );
    // Guarding neither leg reads { current: 4, previous: 6 }; guarding the
    // current leg alone reads { current: 1, previous: 6 }; guarding the prior leg
    // alone reads { current: 4, previous: 1 }.
    expect(snapshot.usage.totals.sessionsDelta).toEqual({
      current: 1,
      previous: 1,
    });
    expect(snapshot.usage.totals.sessions).toBe(1);
  });

  it("counts a carrier-priced session that never made a tool call", () => {
    // Codex reports money at SESSION scope and writes no per-call dollars, so
    // `toolCallCount > 0` alone would drop a session that really did spend. The
    // count would then sit BELOW `cost.sessionsWithCost`, which is the one
    // direction that breaks a sentence a surface renders.
    const snapshot = overview(seededWith(carrierPriced("codex-real", 1, 14)));
    expect(snapshot.usage.totals.sessions).toBe(1);
    expect(snapshot.usage.totals.toolCalls).toBe(0);
    expect(snapshot.usage.cost.totalUsd).not.toBeNull();
    expect(snapshot.usage.cost.totalUsd!).toBeGreaterThan(0);
    expect(snapshot.usage.cost.sessionsWithCost).toBe(1);
    expect(snapshot.usage.cost.sessionsWithCost).toBeLessThanOrEqual(
      snapshot.usage.totals.sessions,
    );
    // The start-counted leg agrees with the headline about the same session, so
    // the delta cannot report a session the count above it refuses.
    expect(snapshot.usage.totals.sessionsDelta.current).toBe(1);
  });

  it("keeps a carrier-priced session in the count beside measureless ones", () => {
    const snapshot = overview(
      seededWith(
        carrierPriced("codex-real", 1, 14),
        measureless("idle-a", 1, 15),
        measureless("idle-b", 2, 15),
      ),
    );
    expect(snapshot.usage.totals.sessions).toBe(1);
    expect(snapshot.usage.totals.sessionsDelta.current).toBe(1);
  });

  it("does not let the skip flip `costPartial` in either direction", () => {
    // `costPartial` says a session that COULD price its work was dropped from
    // the total. A session that did no work has no dollars to drop, so the
    // measureless crowd must not manufacture the flag...
    const priced = overview(
      seededWith(
        working("real", 2, 9),
        measureless("idle-a", 2, 10),
        measureless("idle-b", 3, 10),
      ),
    );
    expect(priced.usage.cost.totalUsd).not.toBeNull();
    expect(priced.usage.cost.costPartial).toBeUndefined();

    // ...and it must not SUPPRESS the flag either. This session made a real call
    // against a model the price table has no row for: it could price its work,
    // it yielded no dollars, and the total is genuinely missing it.
    const partial = overview(
      seededWith(
        working("real", 2, 9),
        working("unpriced", 3, 9, FIXTURE_UNPRICED_MODEL),
        measureless("idle-a", 2, 10),
      ),
    );
    expect(partial.usage.cost.costPartial).toBe(true);
    expect(partial.usage.totals.sessions).toBe(2);
  });
});

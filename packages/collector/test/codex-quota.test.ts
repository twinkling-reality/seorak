import { describe, expect, it } from "vitest";
import { parseRolloutLine, initialCodexFileState } from "../src/adapters/codex.ts";
import { codexQuotaEventId, codexRolloutEventId } from "../src/codex-event-id.ts";
import { assertEmitSafe, EmitAllowlistError } from "../src/emit.ts";
import type { AgentQuotaEvent, SessionEvent } from "@seorak/types";

/**
 * Codex quota capture (CODEX-CAPTURE ADR-C15).
 *
 * EVERY payload below is a shape MEASURED in the real 8,704-row corpus, copied field for
 * field. The corpus is what caught three design errors the handoff doc stated as fact, and
 * these are the shapes the adapter actually has to survive — not the tidy ones a doc
 * describes.
 *
 * Two of those shapes are now REGRESSIONS rather than pins. The `resets_in_seconds` reset
 * and the 299/10079 window pair are real, and a 2026-07-27 re-survey (410 files, 259,332
 * rows, 22 versions) found every occurrence of both on CLI 0.46.0, below the adapter's
 * supported floor. Their readers are deleted, so the tests that used to prove they were
 * read now prove they yield NO window — honest absence, not a guessed instant or a
 * nearest-bucket guess.
 */

const FILE = "rollout-2026-07-12T21-51-21-019f592b-f5ed-7583-a446-e6d3f84676ca.jsonl";

function state() {
  const s = initialCodexFileState();
  s.sessionId = "sess-1";
  s.activeModel = "gpt-5.5";
  return s;
}

/** A real `token_count` row: `info` + `rate_limits`, exactly as Codex writes it. */
function tokenCountRow(opts: {
  at: string;
  rateLimits: unknown;
  totals?: { input: number; cached: number; output: number };
}): string {
  const t = opts.totals ?? { input: 12725, cached: 9984, output: 114 };
  return JSON.stringify({
    timestamp: opts.at,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: t.input,
          cached_input_tokens: t.cached,
          output_tokens: t.output,
          reasoning_output_tokens: 0,
          total_tokens: t.input + t.output,
        },
      },
      rate_limits: opts.rateLimits,
    },
  });
}

function quotaOf(events: SessionEvent[]): AgentQuotaEvent | undefined {
  return events.find((e): e is AgentQuotaEvent => e.kind === "agent.quota");
}

describe("V1 — the slots are a LIST, not a schema", () => {
  it("reads the WEEKLY window out of `primary` (10.6% of real 0.144.1 rows)", () => {
    // THE HEADLINE TRAP. On CLI 0.144.1 `primary` holds the weekly window on 41 of 385
    // rows and the 5-hour one on the rest, and `secondary` is null. An adapter that
    // hardcodes "primary = rolling-5h" labels a WEEKLY 2% as a 5-HOURLY 2% on a ninth of
    // recent rows. Verbatim from the newest file in the corpus.
    const line = tokenCountRow({
      at: "2026-07-13T01:51:26.018Z",
      rateLimits: {
        limit_id: "codex",
        limit_name: null,
        primary: { used_percent: 2.0, window_minutes: 10080, resets_at: 1784489092 },
        secondary: null,
        credits: null,
        individual_limit: null,
        plan_type: "plus",
        rate_limit_reached_type: null,
      },
    });
    const quota = quotaOf(parseRolloutLine(line, 0, FILE, state()));

    expect(quota).toBeDefined();
    expect(quota!.windows).toHaveLength(1);
    // The weekly window, correctly named, even though it arrived in the `primary` slot.
    expect(quota!.windows[0]!.windowMinutes).toBe(10080);
    expect(quota!.windows[0]!.usedPercent).toBe(2);
  });

  it("the RETIRED 299/10079 pair now yields NO window; exact 300/10080 still does", () => {
    // The tolerance was there for 0.46.0, which emits 299 and 10079. Measured 2026-07-27
    // over 410 files and 259,332 rows: those are the ONLY non-exact window lengths in the
    // corpus (2,140 slots, every one on 0.46.0, below the supported floor), plus a single
    // nonsense `0` on 0.144.5 that both a tolerant and an exact rule drop. So the tolerance
    // bought nothing at or above the floor and only widened what a future limit could be
    // silently filed under.
    const retired = tokenCountRow({
      at: "2025-11-18T00:47:46.000Z",
      rateLimits: {
        primary: { used_percent: 7.0, window_minutes: 299, resets_at: 1763426866 },
        secondary: { used_percent: 40.0, window_minutes: 10079, resets_at: 1763512866 },
      },
    });
    expect(quotaOf(parseRolloutLine(retired, 0, FILE, state()))).toBeUndefined();

    // …and the exact lengths every supported version writes are read exactly as before.
    const exact = tokenCountRow({
      at: "2026-07-13T01:51:26.018Z",
      rateLimits: {
        primary: { used_percent: 7.0, window_minutes: 300, resets_at: 1784489092 },
        secondary: { used_percent: 40.0, window_minutes: 10080, resets_at: 1784489092 },
      },
    });
    const quota = quotaOf(parseRolloutLine(exact, 0, FILE, state()));
    expect(quota!.windows.map((w) => w.windowMinutes)).toEqual([300, 10080]);
  });

  it("a `0` window length is not a window: dropped by the exact rule, as it was by the tolerant one", () => {
    // Exactly one slot in the whole corpus carries it (0.144.5). It is nonsense either way,
    // and this pins that tightening the rule did not accidentally start reading it.
    const line = tokenCountRow({
      at: "2026-07-13T01:00:00.000Z",
      rateLimits: {
        primary: { used_percent: 7.0, window_minutes: 0, resets_at: 1784489092 },
        secondary: null,
      },
    });
    expect(quotaOf(parseRolloutLine(line, 0, FILE, state()))).toBeUndefined();
  });

  it("the RETIRED `resets_in_seconds` now yields NO window: a window we cannot date is dropped", () => {
    // 3,580 slots in the corpus carry this RELATIVE field, and measured 2026-07-27 every one
    // of them is on 0.46.0 — below the supported floor, with no later version emitting it.
    // The reader is gone, so such a slot is simply a window with no `resets_at`, which the
    // existing "a window we cannot date is DROPPED" rule already refuses. Honest absence: a
    // percentage with no reset time cannot be told apart from the same percentage a week
    // stale, so it is not emitted with a guessed instant.
    const line = tokenCountRow({
      at: "2025-11-18T00:00:00.000Z",
      rateLimits: {
        primary: { used_percent: 7.0, window_minutes: 300, resets_in_seconds: 3600 },
        secondary: null,
      },
    });
    expect(quotaOf(parseRolloutLine(line, 0, FILE, state()))).toBeUndefined();

    // The SAME row with an absolute `resets_at` still reads, so the drop is about the reset
    // field and not about the row, the window, or the percentage.
    const dated = tokenCountRow({
      at: "2025-11-18T00:00:00.000Z",
      rateLimits: {
        primary: { used_percent: 7.0, window_minutes: 300, resets_at: 1763427600 },
        secondary: null,
      },
    });
    expect(quotaOf(parseRolloutLine(dated, 0, FILE, state()))!.windows[0]!.resetsAt).toBe(
      "2025-11-18T01:00:00.000Z",
    );
  });

  it("an out-of-range used_percent still yields nothing, alongside an absent one", () => {
    // The provider contradicting itself is not a reading. Both legs of the guard are pinned
    // here because no corpus row has either shape: the test is the only thing standing
    // between a future `?? 0` (or a dropped bounds check) and a fabricated gauge.
    for (const usedPercent of [-1, 101, 140]) {
      const line = tokenCountRow({
        at: "2026-07-13T01:00:00.000Z",
        rateLimits: {
          primary: { used_percent: usedPercent, window_minutes: 10080, resets_at: 1784489092 },
          secondary: null,
        },
      });
      expect(quotaOf(parseRolloutLine(line, 0, FILE, state()))).toBeUndefined();
    }
  });

  it("converts `resets_at` from UNIX SECONDS, not milliseconds", () => {
    // 1784489092 is 2026-07-19, not 1970. Treating it as ms would date the reset to
    // 1970-01-21 and the liveness gate would kill every reading forever.
    const line = tokenCountRow({
      at: "2026-07-13T01:51:26.018Z",
      rateLimits: {
        primary: { used_percent: 2.0, window_minutes: 10080, resets_at: 1784489092 },
        secondary: null,
      },
    });
    const quota = quotaOf(parseRolloutLine(line, 0, FILE, state()));

    expect(quota!.windows[0]!.resetsAt).toBe("2026-07-19T19:24:52.000Z");
  });

  it("survives a null `primary` (the real `limit_id: premium` rows)", () => {
    // Four rows in the corpus, two on the CURRENT version, carry BOTH slots null. One of
    // them lands minutes AFTER that day's last good reading, so "take the newest row"
    // would pick it and blank a perfectly good snapshot. It must not throw and must not
    // emit an empty event.
    const line = tokenCountRow({
      at: "2026-07-11T23:49:11.244Z",
      rateLimits: {
        limit_id: "premium",
        limit_name: null,
        primary: null,
        secondary: null,
        credits: { has_credits: false, unlimited: false, balance: "0" },
        individual_limit: null,
        plan_type: "plus",
        rate_limit_reached_type: null,
      },
    });
    const events = parseRolloutLine(line, 0, FILE, state());
    expect(quotaOf(events)).toBeUndefined();
  });

  it("treats an ABSENT window as absent, NEVER as 0%", () => {
    // The decisive corpus fact: in ONE real payload OpenAI reports the weekly window's
    // emptiness as `0.0%` and the 5-hour window's emptiness by OMITTING it. Both encodings
    // coexist, so absence is unexplained and `?? 0` would fabricate a measurement.
    const line = tokenCountRow({
      at: "2026-07-12T19:24:53.055Z",
      rateLimits: {
        limit_id: "codex",
        primary: { used_percent: 0.0, window_minutes: 10080, resets_at: 1784489087 },
        secondary: null,
      },
    });
    const quota = quotaOf(parseRolloutLine(line, 0, FILE, state()));

    // The weekly's REAL, MEASURED zero survives...
    expect(quota!.windows).toHaveLength(1);
    expect(quota!.windows[0]!.windowMinutes).toBe(10080);
    expect(quota!.windows[0]!.usedPercent).toBe(0);
    // ...and the 5-hour window is simply not there. Not 0. Not stale. Absent.
    expect(quota!.windows.some((w) => w.windowMinutes === 300)).toBe(false);
  });

  it("drops a window length it cannot name, rather than coercing it to the nearest", () => {
    const line = tokenCountRow({
      at: "2026-07-13T01:00:00.000Z",
      rateLimits: {
        primary: { used_percent: 40, window_minutes: 60, resets_at: 1784489092 },
        secondary: null,
      },
    });
    expect(quotaOf(parseRolloutLine(line, 0, FILE, state()))).toBeUndefined();
  });

  it("drops a window with NO used_percent, rather than reading it as 0%", () => {
    // Found by MUTATION TESTING, not by review: the guard was written correctly and was
    // completely untested, so a later "simplification" to `?? 0` would have passed every
    // test while fabricating a 0% reading — a gauge showing an empty bar for a window the
    // provider never gave a number for.
    //
    // No row in the corpus has this shape (all 17,359 slots carry `used_percent`), which
    // is exactly why the test has to exist: there is no real data to catch the regression,
    // so this assertion is the only thing standing in its way.
    const line = tokenCountRow({
      at: "2026-07-13T01:00:00.000Z",
      rateLimits: {
        primary: { window_minutes: 10080, resets_at: 1784489092 },
        secondary: null,
      },
    });
    expect(quotaOf(parseRolloutLine(line, 0, FILE, state()))).toBeUndefined();
  });

  it("drops a window it cannot DATE", () => {
    // A percentage with no reset time cannot be told apart from the same percentage a week
    // stale. Unusable, not merely weaker.
    const line = tokenCountRow({
      at: "2026-07-13T01:00:00.000Z",
      rateLimits: {
        primary: { used_percent: 2, window_minutes: 10080 },
        secondary: null,
      },
    });
    expect(quotaOf(parseRolloutLine(line, 0, FILE, state()))).toBeUndefined();
  });
});

describe("V2 — the quota must NOT be gated behind the token guards", () => {
  it("emits the quota on a row with NO TOKEN MOVEMENT (26% of real rows)", () => {
    // THE MEASUREMENT THAT PICKED THE CARRIER. Codex re-emits `token_count` with unchanged
    // cumulative totals, and `handleTokenCount` refuses to emit a session.tokens snapshot
    // on those rows. The ACCOUNT quota is fresh on every one of them. Riding session.tokens
    // would have silently dropped 2,272 of 8,718 readings (26.1%) — measured, not feared.
    const s = state();
    const totals = { input: 12725, cached: 9984, output: 114 };

    // First row: real token movement, so BOTH events fire.
    const first = parseRolloutLine(
      tokenCountRow({
        at: "2026-07-13T01:00:00.000Z",
        totals,
        rateLimits: { primary: { used_percent: 1, window_minutes: 10080, resets_at: 1784489092 }, secondary: null },
      }),
      0,
      FILE,
      s,
    );
    expect(first.map((e) => e.kind).sort()).toEqual(["agent.quota", "session.tokens"]);

    // Second row: IDENTICAL cumulative totals (no movement) but a FRESH quota.
    const second = parseRolloutLine(
      tokenCountRow({
        at: "2026-07-13T02:00:00.000Z",
        totals, // unchanged
        rateLimits: { primary: { used_percent: 3, window_minutes: 10080, resets_at: 1784489092 }, secondary: null },
      }),
      100,
      FILE,
      s,
    );

    // No token snapshot (correctly — nothing was spent)...
    expect(second.some((e) => e.kind === "session.tokens")).toBe(false);
    // ...but the quota reading SURVIVES, and it is the fresh one.
    const quota = quotaOf(second);
    expect(quota).toBeDefined();
    expect(quota!.windows[0]!.usedPercent).toBe(3);
  });

  it("emits the quota on a row with an EMPTY `info` (26 real rows)", () => {
    const line = JSON.stringify({
      timestamp: "2026-07-13T01:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: null, // the real shape of those rows
        rate_limits: {
          primary: { used_percent: 5, window_minutes: 10080, resets_at: 1784489092 },
          secondary: null,
        },
      },
    });
    const events = parseRolloutLine(line, 0, FILE, state());
    expect(events.some((e) => e.kind === "session.tokens")).toBe(false);
    expect(quotaOf(events)!.windows[0]!.usedPercent).toBe(5);
  });
});

describe("the event-id collision that would have silently dropped one of the two events", () => {
  it("gives the quota event a DIFFERENT id from the token event at the same byte offset", () => {
    // Both events come from the SAME `token_count` row, so they share (session, file,
    // byteOffset). `codexRolloutEventId` puts no kind in its seed, so a shared id would
    // make the worker's `INSERT OR IGNORE` drop whichever lost the race — one of the two
    // facts would simply never exist, with nothing failing anywhere.
    const tokenId = codexRolloutEventId("sess-1", FILE, 4096);
    const quotaId = codexQuotaEventId("sess-1", FILE, 4096);
    expect(quotaId).not.toBe(tokenId);
  });

  it("is deterministic, so a re-tail collapses on the PK instead of double-counting", () => {
    expect(codexQuotaEventId("sess-1", FILE, 4096)).toBe(codexQuotaEventId("sess-1", FILE, 4096));
  });

  it("emits two DISTINCT ids from one real row, end to end", () => {
    const events = parseRolloutLine(
      tokenCountRow({
        at: "2026-07-13T01:00:00.000Z",
        rateLimits: { primary: { used_percent: 2, window_minutes: 10080, resets_at: 1784489092 }, secondary: null },
      }),
      512,
      FILE,
      state(),
    );
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(2);
  });
});

describe("the emit tripwire", () => {
  it("passes a real quota event", () => {
    const events = parseRolloutLine(
      tokenCountRow({
        at: "2026-07-13T01:00:00.000Z",
        rateLimits: { primary: { used_percent: 2, window_minutes: 10080, resets_at: 1784489092 }, secondary: null },
      }),
      0,
      FILE,
      state(),
    );
    for (const event of events) expect(() => assertEmitSafe(event)).not.toThrow();
  });

  it("BLOCKS a smuggled key on a window item", () => {
    // `rate_limits` is the densest un-audited surface Codex hands us: it carries
    // `plan_type`, a `credits.balance`, a `limit_id`. None of it may travel.
    const event = {
      kind: "agent.quota",
      eventId: "e1",
      sessionId: "s1",
      at: "2026-07-13T01:00:00.000Z",
      tool: "codex",
      windows: [
        { windowMinutes: 10080, usedPercent: 2, resetsAt: "2026-07-19T19:24:52.000Z", planType: "plus" },
      ],
    } as unknown as SessionEvent;
    expect(() => assertEmitSafe(event)).toThrow(EmitAllowlistError);
  });

  it("BLOCKS an unknown tool id (an un-pinned agent id is a free-text channel)", () => {
    const event = {
      kind: "agent.quota",
      eventId: "e1",
      sessionId: "s1",
      at: "2026-07-13T01:00:00.000Z",
      tool: "/Users/someone/secret",
      windows: [{ windowMinutes: 10080, usedPercent: 2, resetsAt: "2026-07-19T19:24:52.000Z" }],
    } as unknown as SessionEvent;
    expect(() => assertEmitSafe(event)).toThrow(EmitAllowlistError);
  });

  it("BLOCKS a percentage outside 0..100", () => {
    const event = {
      kind: "agent.quota",
      eventId: "e1",
      sessionId: "s1",
      at: "2026-07-13T01:00:00.000Z",
      tool: "codex",
      windows: [{ windowMinutes: 10080, usedPercent: 140, resetsAt: "2026-07-19T19:24:52.000Z" }],
    } as unknown as SessionEvent;
    expect(() => assertEmitSafe(event)).toThrow(EmitAllowlistError);
  });

  it("BLOCKS an event carrying no windows", () => {
    // An empty reading would still win "newest snapshot" against a real one.
    const event = {
      kind: "agent.quota",
      eventId: "e1",
      sessionId: "s1",
      at: "2026-07-13T01:00:00.000Z",
      tool: "codex",
      windows: [],
    } as unknown as SessionEvent;
    expect(() => assertEmitSafe(event)).toThrow(EmitAllowlistError);
  });
});

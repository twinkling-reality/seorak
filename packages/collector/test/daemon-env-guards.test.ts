/**
 * daemon-env-guards.test.ts — the numeric-env guard (env-numbers.ts) and the
 * daemon cadences + tokens resolved through it.
 *
 * The failure being pinned is a HOT LOOP, not a wrong number: `Number("")` is 0,
 * `Number("garbage")` is NaN, and a timer handed either fires at ~1ms, so one
 * mistyped env var used to turn a background cadence into a spin against the
 * worker. Anything out of band must read as the DOCUMENTED default, since that
 * is the only value the README lets a reader predict.
 *
 * Both pure functions take an env object, so no test here mutates process.env.
 */
import { describe, expect, it } from "vitest";
import { daemonCadences, daemonTokens } from "../src/daemon.ts";
import { boundedIntOr, MAX_TIMER_MS, positiveIntOr } from "../src/env-numbers.ts";

/** Every way a numeric env var arrives unusable. `1e400` is Infinity, which is
 *  finite-check bait; a bare unit suffix ("30s") is the likeliest real typo. */
const MALFORMED = [undefined, "", "   ", "garbage", "30s", "0", "-1", "-30000", "NaN", "1e400"] as const;
/** Finite, parseable, and still unusable as a timer: past MAX_TIMER_MS the delay
 *  overflows the signed-32-bit field and Node substitutes 1ms — the same hot loop
 *  a NaN produces, reached from the other direction. */
const ABSURD = [String(MAX_TIMER_MS + 1), "999999999999", "9007199254740993"] as const;

describe("positiveIntOr", () => {
  it("falls back on every malformed value", () => {
    for (const raw of MALFORMED) {
      expect(positiveIntOr(raw, 500), JSON.stringify(raw)).toBe(500);
    }
  });
  it("accepts a positive integer and floors a fractional one", () => {
    expect(positiveIntOr("1", 500)).toBe(1);
    expect(positiveIntOr("750", 500)).toBe(750);
    expect(positiveIntOr("750.9", 500)).toBe(750);
  });
});

describe("boundedIntOr", () => {
  it("falls back below the floor and above the ceiling, keeping the band inclusive", () => {
    expect(boundedIntOr("999", 30_000, 1_000, MAX_TIMER_MS)).toBe(30_000);
    expect(boundedIntOr("1000", 30_000, 1_000, MAX_TIMER_MS)).toBe(1_000);
    expect(boundedIntOr(String(MAX_TIMER_MS), 30_000, 1_000, MAX_TIMER_MS)).toBe(MAX_TIMER_MS);
    expect(boundedIntOr(String(MAX_TIMER_MS + 1), 30_000, 1_000, MAX_TIMER_MS)).toBe(30_000);
  });
});

describe("daemonCadences — defaults, floors, ceilings", () => {
  const DEFAULTS = {
    batchDelayMs: 250,
    momentumSweepMs: 3_600_000,
    settingsSyncMs: 300_000,
    codexPollMs: 30_000,
    compactSyncMs: 300_000,
    interventionSweepMs: 300_000,
  } as const;

  /** Variable → the key it resolves, and the floor below which it reads as the
   *  default. The defaults are the values the README documents and this change
   *  did not touch. */
  const VARS = [
    { env: "SEORAK_BATCH_DELAY_MS", key: "batchDelayMs", floor: 1 },
    { env: "SEORAK_MOMENTUM_SWEEP_MS", key: "momentumSweepMs", floor: 1_000 },
    { env: "SEORAK_SETTINGS_SYNC_MS", key: "settingsSyncMs", floor: 1_000 },
    { env: "SEORAK_CODEX_POLL_MS", key: "codexPollMs", floor: 1_000 },
    { env: "SEORAK_COMPACT_SYNC_MS", key: "compactSyncMs", floor: 10_000 },
    {
      env: "SEORAK_INTERVENTION_SWEEP_MS",
      key: "interventionSweepMs",
      floor: 10_000,
    },
  ] as const;

  it("resolves the documented defaults from an empty environment", () => {
    expect(daemonCadences({})).toEqual(DEFAULTS);
  });

  for (const { env, key, floor } of VARS) {
    it(`${env}: every malformed or absurd value falls back to ${DEFAULTS[key]}, never a fast timer`, () => {
      for (const raw of [...MALFORMED, ...ABSURD]) {
        const resolved = daemonCadences(raw === undefined ? {} : { [env]: raw })[key];
        expect(resolved, `${env}=${JSON.stringify(raw)}`).toBe(DEFAULTS[key]);
      }
    });

    it(`${env}: honors a value at or above its ${floor}ms floor, rejects below it`, () => {
      expect(daemonCadences({ [env]: String(floor) })[key]).toBe(floor);
      expect(daemonCadences({ [env]: String(floor + 500) })[key]).toBe(floor + 500);
      if (floor > 1) {
        expect(daemonCadences({ [env]: String(floor - 1) })[key]).toBe(DEFAULTS[key]);
      }
    });

    it(`${env}: accepts the signed-32-bit timer ceiling exactly, rejects one past it`, () => {
      expect(daemonCadences({ [env]: String(MAX_TIMER_MS) })[key]).toBe(MAX_TIMER_MS);
      expect(daemonCadences({ [env]: String(MAX_TIMER_MS + 1) })[key]).toBe(DEFAULTS[key]);
    });
  }

  it("resolves each variable independently — one typo cannot move the others", () => {
    expect(daemonCadences({ SEORAK_CODEX_POLL_MS: "garbage", SEORAK_SETTINGS_SYNC_MS: "60000" })).toEqual({
      ...DEFAULTS,
      settingsSyncMs: 60_000,
    });
  });
});

describe("daemonTokens — which Bearer token each daemon call site sends", () => {
  it("sends the ingest key on /events and the same key on the settings sync (one-token model)", () => {
    expect(daemonTokens({ SEORAK_INGEST_KEY: "ingest" })).toEqual({
      ingestKey: "ingest",
      readKey: "ingest",
    });
  });

  it("keeps a read-only token off /events: only the settings sync switches", () => {
    expect(daemonTokens({ SEORAK_INGEST_KEY: "ingest", SEORAK_READ_KEY: "read" })).toEqual({
      ingestKey: "ingest",
      readKey: "read",
    });
  });

  it("a read key alone leaves /events unauthenticated rather than borrowing it", () => {
    expect(daemonTokens({ SEORAK_READ_KEY: "read" })).toEqual({ ingestKey: "", readKey: "read" });
  });

  it("sends no token at all against an open/local worker", () => {
    expect(daemonTokens({})).toEqual({ ingestKey: "", readKey: "" });
  });

  it("reads a set-but-blank read key as no read token, not as the ingest key", () => {
    expect(daemonTokens({ SEORAK_INGEST_KEY: "ingest", SEORAK_READ_KEY: "" })).toEqual({
      ingestKey: "ingest",
      readKey: "",
    });
  });

  it("trims a token that arrived with surrounding whitespace", () => {
    expect(daemonTokens({ SEORAK_READ_KEY: "  read  " }).readKey).toBe("read");
  });
});

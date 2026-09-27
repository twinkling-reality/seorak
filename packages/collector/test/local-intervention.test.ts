/**
 * local-intervention.test.ts — the honesty rules of the local watch engine.
 *
 * The engine is a deliberate second implementation of the worker's, so what is
 * pinned here is the set of rules that decide whether a fire is HONEST: a null
 * reading never crosses a threshold, an agent that cannot supply a signal's
 * evidence never fires it, the cadence fallback stays agent-gated, a held fire
 * is still recorded, and one crossing fires once per rolling day.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_THRESHOLDS,
  type NotificationSettings,
  type SessionEvent,
  type SessionSummary,
  type SettingsDocument,
} from "@seorak/types";
import { appendLocalEvent, openLocalHistory } from "../src/local-store.ts";
import {
  evaluateLocalScalars,
  evaluateLocalStuckLoop,
  evaluateLocalWentCold,
  listLocalInterventions,
  localStuckLoopRuns,
  resolveLocalSignalConfig,
  sweepLocalInterventions,
  withinLocalQuietHours,
} from "../src/local-intervention.ts";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

const NOW = Date.parse("2026-08-02T12:00:00.000Z");
const REPO = "a".repeat(64);

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), "seorak-intervention-"));
  temporary.push(dir);
  return dir;
}

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "s-1",
    project: "seorak",
    repoId: REPO,
    agent: "claude-code",
    status: "active",
    startedAt: new Date(NOW - 30 * 60_000).toISOString(),
    lastEventAt: new Date(NOW - 60_000).toISOString(),
    elapsedSeconds: 30 * 60,
    toolCallCount: 4,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    costUsd: 1,
    burnRateUsdPerMin: 0.01,
    ...overrides,
  };
}

/** A live claude-code session with the given tool calls, ready to sweep. */
function seedLiveSession(
  dir: string,
  calls: Array<{ tool: string; errored?: boolean }>,
  overrides: { costUsd?: number; startedMinutesAgo?: number } = {},
): void {
  const startedAt = new Date(
    NOW - (overrides.startedMinutesAgo ?? 30) * 60_000,
  ).toISOString();
  const events: SessionEvent[] = [
    {
      kind: "session.start",
      eventId: "start",
      sessionId: "s-1",
      at: startedAt,
      repoId: REPO,
      repoLabel: "seorak",
      agent: "claude-code",
      agentVersion: "1.0.0",
      capabilities: {
        hasTokens: true,
        hasCacheTokens: true,
        cost: "estimated",
        toolResult: "both",
        endReason: true,
        duration: "measured",
        verification: "both",
        costScope: "call",
        usageWindow: "count",
      },
    },
  ];
  calls.forEach((call, index) => {
    events.push({
      kind: "tool.call",
      eventId: `call-${index}`,
      sessionId: "s-1",
      at: new Date(NOW - (calls.length - index) * 60_000).toISOString(),
      toolName: call.tool,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: (overrides.costUsd ?? 0) / calls.length,
      ...(call.errored === undefined ? {} : { errored: call.errored }),
      // A nonzero top-level amount is explicit legacy evidence only when no
      // models[] carrier exists. A known model with zero usage is measured $0,
      // regardless of an advisory top-level value.
      ...((overrides.costUsd ?? 0) > 0
        ? {}
        : {
            models: [
              {
                model: "claude-opus-4-5",
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                costUsd: 0,
              },
            ],
          }),
    });
  });
  for (const event of events) appendLocalEvent(event, dir);
}

/**
 * A session carrying nothing but its own start, which is what the SessionStart
 * hook records when an agent process boots and exits without the developer ever
 * typing. It sits on the live board (not ended, inside the abandoned horizon)
 * and has no work to have fallen silent from.
 */
function seedPhantomSession(dir: string, startedMinutesAgo = 12): void {
  appendLocalEvent(
    {
      kind: "session.start",
      eventId: "start",
      sessionId: "s-1",
      at: new Date(NOW - startedMinutesAgo * 60_000).toISOString(),
      repoId: REPO,
      repoLabel: "seorak",
      agent: "claude-code",
      agentVersion: "1.0.0",
      capabilities: {
        hasTokens: true,
        hasCacheTokens: true,
        cost: "estimated",
        toolResult: "both",
        endReason: true,
        duration: "measured",
        verification: "both",
        costScope: "call",
        usageWindow: "count",
      },
    } satisfies SessionEvent,
    dir,
  );
}

function settingsWith(
  notifications: Partial<NotificationSettings> = {},
): SettingsDocument {
  return {
    notifications: { ...DEFAULT_NOTIFICATION_SETTINGS, ...notifications },
    capture: {},
    liveActivity: {},
    projectThemes: {},
    projectMerges: {},
    projectArchive: {},
  } as unknown as SettingsDocument;
}

describe("what may cross a threshold", () => {
  it("never reads an unknown value as a crossing", () => {
    // A tool that cannot price its work reports null. Null is unknown, and a
    // spike alarm on an unknown cost is a fabricated measurement.
    // Every bound is set where a fabricated zero WOULD cross it. Only the leg
    // that was actually measured — elapsed time — fires.
    const fires = evaluateLocalScalars(
      summary({ costUsd: null, burnRateUsdPerMin: null }),
      {
        ...DEFAULT_THRESHOLDS,
        costSpikeUsd: 0,
        highBurnRateUsdPerMinute: 0,
        longSessionMinutes: 1,
      },
      NOW,
    );
    expect(fires.map((fire) => fire.kind)).toEqual(["long_session"]);
  });

  it("fires each scalar on its own measured leg", () => {
    const fires = evaluateLocalScalars(
      summary({ costUsd: 12, burnRateUsdPerMin: 2 }),
      DEFAULT_THRESHOLDS,
      NOW,
    );
    expect(fires.map((fire) => fire.kind).sort()).toEqual([
      "cost_spike",
      "high_burn_rate",
    ]);
    // Project-as-title: the repo is the notification title, the catalog label
    // the subtitle, and the body one warm sentence.
    expect(fires[0]).toMatchObject({ project: "seorak", repoId: REPO });
    expect(fires[0]!.body.length).toBeGreaterThan(0);
  });

  it("never fires on an ended session", () => {
    expect(
      evaluateLocalScalars(
        summary({ status: "ended", costUsd: 999 }),
        DEFAULT_THRESHOLDS,
        NOW,
      ),
    ).toEqual([]);
    expect(
      evaluateLocalWentCold(summary({ status: "ended" }), 1, NOW),
    ).toBeNull();
  });

  // Silence is only a measurement when something once made noise. The start hook
  // runs when the agent boots, before the developer has typed, so a session
  // carrying nothing but its own start never began and there is nothing to step
  // back into.
  it("never fires went_cold on a session that only ever started", () => {
    const started = new Date(NOW - 12 * 60_000).toISOString();
    expect(
      evaluateLocalWentCold(
        summary({ toolCallCount: 0, startedAt: started, lastEventAt: started }),
        10,
        NOW,
      ),
    ).toBeNull();
  });

  // The guard must not over-suppress: an agent blocked on a permission prompt is
  // the most actionable live state there is, and tool.call comes from PostToolUse
  // so the prompt precedes the first call.
  it("still fires went_cold on a session stalled at a permission prompt", () => {
    const started = new Date(NOW - 12 * 60_000).toISOString();
    expect(
      evaluateLocalWentCold(
        summary({
          toolCallCount: 0,
          awaitingInput: true,
          startedAt: started,
          lastEventAt: started,
        }),
        10,
        NOW,
      ),
    ).toMatchObject({ kind: "went_cold" });
  });
});

describe("the retry loop", () => {
  function runsFor(calls: Array<{ tool: string; errored?: boolean }>) {
    const dir = directory();
    seedLiveSession(dir, calls);
    const database = openLocalHistory(dir);
    try {
      return localStuckLoopRuns(database, "s-1");
    } finally {
      database.close();
    }
  }

  it("breaks a failing run on a success", () => {
    const runs = runsFor([
      { tool: "Bash", errored: true },
      { tool: "Bash", errored: true },
      { tool: "Bash", errored: false },
      { tool: "Bash", errored: true },
    ]);
    expect(runs.errored).toEqual({ tool: "Bash", count: 2 });
    // Cadence counts the repetition regardless of outcome.
    expect(runs.cadence).toEqual({ tool: "Bash", count: 4 });
    expect(runs.erroredPresent).toBe(true);
    expect(runs.firstErrored).toEqual({ tool: "Bash" });
  });

  it("does not fall back to cadence when a failure signal exists", () => {
    // Twelve successful repeats of one tool is productive work, not a wedge.
    const runs = runsFor(
      Array.from({ length: 12 }, () => ({ tool: "Edit", errored: false })),
    );
    expect(
      evaluateLocalStuckLoop(summary(), runs, DEFAULT_THRESHOLDS, NOW),
    ).toBeNull();
  });

  it("keeps the cadence fallback gated to claude-code", () => {
    // No call carries a boolean, so there is no failure leg at all.
    const runs = runsFor(Array.from({ length: 8 }, () => ({ tool: "Shell" })));
    expect(runs.erroredPresent).toBe(false);
    expect(
      evaluateLocalStuckLoop(summary(), runs, DEFAULT_THRESHOLDS, NOW)?.kind,
    ).toBe("stuck_loop");
    // Codex's closed three-name tool vocabulary makes long identical runs
    // near-certain, so a cadence guess there would page about a loop that is
    // not happening.
    expect(
      evaluateLocalStuckLoop(
        summary({ agent: "codex" }),
        runs,
        DEFAULT_THRESHOLDS,
        NOW,
      ),
    ).toBeNull();
  });

  it("says 'ran' rather than 'failed' when it only has cadence", () => {
    const runs = runsFor(Array.from({ length: 8 }, () => ({ tool: "Shell" })));
    const fire = evaluateLocalStuckLoop(summary(), runs, DEFAULT_THRESHOLDS, NOW);
    expect(fire?.body).not.toMatch(/fail/i);
  });
});

describe("configuration precedence", () => {
  it("lets a muted project silence every signal", () => {
    const settings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      perProject: { [REPO]: { muted: true } },
    } as NotificationSettings;
    expect(resolveLocalSignalConfig(settings, REPO, "cost_spike").enabled).toBe(
      false,
    );
    // A different project is untouched.
    expect(resolveLocalSignalConfig(settings, "b".repeat(64), "cost_spike").enabled)
      .toBe(true);
  });

  it("overlays only the thresholds a signal owns", () => {
    const settings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      signals: {
        ...DEFAULT_NOTIFICATION_SETTINGS.signals,
        cost_spike: { enabled: true, thresholds: { costSpikeUsd: 99 } },
      },
    } as NotificationSettings;
    const cost = resolveLocalSignalConfig(settings, REPO, "cost_spike");
    expect(cost.thresholds.costSpikeUsd).toBe(99);
    // A per-signal override must not move a bound it does not own.
    const long = resolveLocalSignalConfig(settings, REPO, "long_session");
    expect(long.thresholds.costSpikeUsd).toBe(DEFAULT_THRESHOLDS.costSpikeUsd);
  });
});

describe("quiet hours", () => {
  it("handles a window that wraps midnight", () => {
    const quiet = { enabled: true, start: "22:00", end: "08:00", tz: "UTC" };
    expect(withinLocalQuietHours(quiet, Date.parse("2026-08-02T23:30:00Z"))).toBe(true);
    expect(withinLocalQuietHours(quiet, Date.parse("2026-08-02T03:30:00Z"))).toBe(true);
    expect(withinLocalQuietHours(quiet, Date.parse("2026-08-02T12:00:00Z"))).toBe(false);
  });

  it("is off entirely when the window is disabled", () => {
    expect(
      withinLocalQuietHours(
        { enabled: false, start: "00:00", end: "23:59", tz: "UTC" },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("the sweep and the ledger", () => {
  it("records a crossing once per rolling day", () => {
    const dir = directory();
    seedLiveSession(dir, [{ tool: "Edit", errored: false }], {
      costUsd: 50,
      startedMinutesAgo: 30,
    });
    const settings = settingsWith();

    const first = sweepLocalInterventions(settings, { directory: dir, nowMs: NOW });
    expect(first.map((fire) => fire.kind)).toContain("cost_spike");

    // The same crossing a minute later is the same crossing.
    const second = sweepLocalInterventions(settings, {
      directory: dir,
      nowMs: NOW + 60_000,
    });
    expect(second.map((fire) => fire.kind)).not.toContain("cost_spike");

    const history = listLocalInterventions({ directory: dir, nowMs: NOW + 60_000 });
    expect(history.filter((fire) => fire.kind === "cost_spike")).toHaveLength(1);
  });

  it("records a held fire without delivering it, and lets an urgent one through", () => {
    const dir = directory();
    seedLiveSession(dir, [{ tool: "Edit", errored: false }], {
      costUsd: 50,
      startedMinutesAgo: 90,
    });
    const settings = settingsWith({
      quietHours: { enabled: true, start: "00:00", end: "23:59", tz: "UTC" },
    });

    const delivered = sweepLocalInterventions(settings, {
      directory: dir,
      nowMs: NOW,
    });
    // `cost_spike` is always-notify in the catalog: money leaving is the one
    // thing quiet hours do not sit on.
    expect(delivered.map((fire) => fire.kind)).toEqual(["cost_spike"]);

    const history = listLocalInterventions({ directory: dir, nowMs: NOW });
    // The long session was held — not delivered, but still recorded, because a
    // held fire is a thing that happened.
    expect(history.find((fire) => fire.kind === "long_session")?.held).toBe(true);
    expect(history.find((fire) => fire.kind === "cost_spike")?.held).toBeUndefined();
  });

  it("fires nothing when the user has switched a watch off", () => {
    const dir = directory();
    seedLiveSession(dir, [{ tool: "Edit", errored: false }], { costUsd: 50 });
    const settings = settingsWith({
      signals: {
        ...DEFAULT_NOTIFICATION_SETTINGS.signals,
        cost_spike: { enabled: false },
      },
    } as Partial<NotificationSettings>);
    const fired = sweepLocalInterventions(settings, { directory: dir, nowMs: NOW });
    expect(fired.map((fire) => fire.kind)).not.toContain("cost_spike");
  });

  // The end-to-end shape of the bug this guard closes: an agent process that
  // booted and never did anything sat on the live board and paged the developer
  // every time the sweep ran. The ledger assertion is the honest one, since a
  // fire that is recorded but undelivered still claims the crossing happened.
  it("neither records nor delivers went_cold for a session that only ever started", () => {
    const dir = directory();
    seedPhantomSession(dir);
    expect(
      sweepLocalInterventions(settingsWith(), { directory: dir, nowMs: NOW }),
    ).toEqual([]);
    expect(listLocalInterventions({ directory: dir, nowMs: NOW })).toEqual([]);
  });

  it("is empty on a machine with nothing live", () => {
    const dir = directory();
    expect(sweepLocalInterventions(settingsWith(), { directory: dir, nowMs: NOW }))
      .toEqual([]);
    expect(listLocalInterventions({ directory: dir, nowMs: NOW })).toEqual([]);
  });
});

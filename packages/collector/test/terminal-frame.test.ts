/**
 * terminal-frame.test.ts — the connecting / unreachable states and the header's
 * motion cues, pinned as rendered strings. Motion contract: EVERYTHING animated
 * is color-gated, so the color-off path (non-TTY / NO_COLOR / --no-color) stays
 * byte-identical static text with zero ANSI escapes.
 */
import { describe, expect, it } from "vitest";
import {
  SPINNER_FRAMES,
  renderConnecting,
  renderFrame,
  renderUnreachable,
} from "../src/terminal/render/frame.ts";
import type { OverviewSnapshot, SessionSummary, UsageSnapshot } from "@seorak/types";
import type { BoardData, RenderContext } from "../src/terminal/types.ts";

const ANSI = /\x1b\[[0-9;]*m/;

const emptyData: BoardData = { live: [], generatedAt: new Date().toISOString(), overview: null };
const layout = { rangeDays: 7, view: "paragraph" as const };

function ctx(overrides: Partial<RenderContext> = {}): RenderContext {
  return { color: false, width: 80, now: Date.now(), days: 7, ...overrides };
}

describe("renderConnecting", () => {
  it("is a LOADER, not the identity block: the block flashed and vanished", () => {
    const out = renderConnecting(false, 80, "seorak", 3);
    expect(out).toContain("connecting");
    expect(out).not.toContain("performance tracking for agentic development");
    // the window control is there from the first frame, not only once data lands
    expect(out).toContain("[7d]");
  });
  it("color off: static text, no spinner glyph, zero ANSI (reduced motion)", () => {
    const out = renderConnecting(false, 80, "seorak", 3);
    expect(out).toContain("… connecting");
    expect(out).not.toMatch(ANSI);
    for (const glyph of SPINNER_FRAMES) expect(out).not.toContain(glyph);
  });
  it("color on with a frame index: the spinner glyph leads and advances", () => {
    expect(renderConnecting(true, 80, "seorak", 0)).toContain(`${SPINNER_FRAMES[0]} connecting`);
    expect(renderConnecting(true, 80, "seorak", 1)).toContain(`${SPINNER_FRAMES[1]} connecting`);
    // wraps past the end
    expect(renderConnecting(true, 80, "seorak", SPINNER_FRAMES.length)).toContain(SPINNER_FRAMES[0]!);
  });
  it("color on WITHOUT a frame index stays static (one-shot paths)", () => {
    const out = renderConnecting(true, 80);
    for (const glyph of SPINNER_FRAMES) expect(out).not.toContain(glyph);
  });
});

describe("renderUnreachable", () => {
  it("keeps the frame, names the worker, and points at status", () => {
    const out = renderUnreachable("https://w.example", false, 80);
    expect(out).toContain("seorak");
    expect(out).toContain("https://w.example");
    expect(out).toContain("captured locally");
    expect(out).toContain("seorak status");
    expect(out).not.toMatch(ANSI);
  });
});

describe("connection-lost banner (mid-session full outage keeps the board)", () => {
  it("renders the banner over the board when ctx.connectionLost is set", () => {
    const out = renderFrame(layout, emptyData, ctx({ connectionLost: true }));
    expect(out).toContain("connection lost, retrying");
    expect(out).toContain("seorak status");
    expect(out).not.toMatch(ANSI);
  });
  it("no banner in the normal frame", () => {
    expect(renderFrame(layout, emptyData, ctx())).not.toContain("connection lost");
  });
});

describe("blocked local delivery banner", () => {
  it("names the waiting capture and points to the diagnostic command", () => {
    const out = renderFrame(
      layout,
      emptyData,
      ctx({ shippingBlocked: true }),
    );
    expect(out).toContain("captured events are waiting to ship");
    expect(out).toContain("seorak status");
  });
});

describe("header carries no decorative marks", () => {
  it("no pulsing dot in the header (removed by buyer decision: decoration, not information)", () => {
    const out = renderFrame(layout, emptyData, ctx({ color: true }));
    expect(out).not.toContain("●");
  });
});


// ---------------------------------------------------------------------------
// The prose board. These moved here from terminal-widgets.test.ts when the
// widget grid was replaced by a paragraph: what the frame owes the reader is no
// longer "which cells rendered" but "which sentences were earned".
// ---------------------------------------------------------------------------

function mkUsage(over: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    totals: { sessions: 0, toolCalls: 0 },
    cost: { totalUsd: null, sessionsWithCost: 0, delta: null },
    lines: null,
    dailyTrends: [],
    projects: [],
    momentum: [],
    portfolio: { windowDays: 7, reposTotal: 0, reposMoved: 0, reposQuiet: 0, repos: [] },
    cacheReuseRatio: null,
    costPerEdit: null,
    ...over,
  };
}

function mkOverview(over: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    generatedAt: "2026-07-26T12:00:00.000Z",
    rangeDays: 7,
    live: [],
    usage: mkUsage(),
    outcomes: {
      endReasons: [],
      activeCount: 0,
      endedCount: 0,
      stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
      endReasonsByDay: [],
      oneShotRate: null,
      shipRate: null,
      lineSurvival: {
        rate: null,
        linesAuthored: 0,
        linesSurviving: 0,
        commitsChecked: 0,
        sessionsRated: 0,
        retained: 0,
        overwritten: 0,
        unreachable: 0,
        unknown: 0,
      },
      bySession: [],
    },
    activity: { hourlyDistribution: [], endReasonsByHour: [] },
    tools: { byTool: [], callStats: { totalCalls: 0, errorRate: null }, byModel: [], byAgent: [], verification: [] },
    codebase: { files: [], directories: [], rework: [], commitStats: null, filesInPlay: null },
    ...over,
  };
}

function mkSession(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "s1",
    project: "seorak",
    repoId: "r1",
    agent: "claude-code",
    status: "active",
    startedAt: "2026-07-26T11:00:00.000Z",
    lastEventAt: "2026-07-26T11:58:00.000Z",
    elapsedSeconds: 3480,
    toolCallCount: 12,
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
    costUsd: null,
    burnRateUsdPerMin: null,
    ...over,
  };
}

const ONE_PROJECT = [
  { repoId: "r1", project: "seorak", sessions: 3, toolCalls: 10, tokensTotal: 10, costUsd: null, byModel: [], lineSurvival: null, shipRate: null },
] as unknown as UsageSnapshot["projects"];

const TWO_PROJECTS = [
  ...ONE_PROJECT,
  { repoId: "r2", project: "chesstinker", sessions: 2, toolCalls: 4, tokensTotal: 8, costUsd: null, byModel: [], lineSurvival: null, shipRate: null },
] as unknown as UsageSnapshot["projects"];

const WORKED = mkOverview({
  usage: mkUsage({ totals: { sessions: 80, toolCalls: 17576 }, projects: ONE_PROJECT }),
});

function prose(data: Partial<BoardData>, over: Partial<RenderContext> = {}): string {
  const board: BoardData = {
    live: data.live ?? [],
    generatedAt: data.generatedAt ?? "2026-07-26T12:00:00.000Z",
    overview: data.overview ?? null,
  };
  return renderFrame(layout, board, ctx({ now: Date.parse("2026-07-26T12:00:00.000Z"), ...over }));
}

describe("renderFrame — the paragraph", () => {
  it("day zero says what fills the screen in, not 'no data'", () => {
    const out = prose(
      { overview: mkOverview() },
      {
        identity: { watching: "Claude Code", workerHost: "w" },
        shippingBlocked: true,
      },
    );
    expect(out).toContain("No sessions yet. Your next Claude Code or Codex session will show up here.");
    expect(out).toContain("captured events are waiting to ship");
    expect(out).toContain("seorak status");
  });

  it("leads with now, then the window, as sentences", () => {
    const out = prose({ live: [], overview: WORKED });
    expect(out).toContain("Nothing is running right now.");
    expect(out).toContain("In the last 7 days you ran 80 sessions");
  });

  it("a blocked session takes the first line of the board", () => {
    const out = prose({
      live: [mkSession({ awaitingInput: true, lastEventAt: "2026-07-26T11:46:00.000Z" })],
      overview: WORKED,
    });
    const body = out.split("\n").filter((l) => l.trim() !== "");
    expect(body[body.findIndex((l) => l.includes("╰")) + 1]).toContain("has been waiting on you for 14 minutes");
  });

  it("carries NO zone label: each sentence spells its own window", () => {
    const out = prose({ overview: mkOverview({ rangeDays: 30, usage: WORKED.usage }) }, { days: 30 });
    expect(out).toContain("In the last 30 days");
    expect(out.split("\n")).not.toContain("  past 30 days");
  });

  it("an in-flight overview shows a LOADER and fabricates no numbers", () => {
    const out = prose({ live: [mkSession()], overview: null }, { interactive: true, color: true, animFrame: 0 });
    expect(out).toContain("reading the last 7 days");
    expect(out).toContain(SPINNER_FRAMES[0]!);
    expect(out).not.toContain("In the last");
    expect(out).not.toContain("0%");
  });

  it("a FAILED overview says so in words, not with a spinner that implies progress", () => {
    const out = prose({ live: [mkSession()], overview: null }, { interactive: true, overviewFailing: true });
    expect(out).toContain("The last 7 days did not come back. Still retrying.");
    for (const glyph of SPINNER_FRAMES) expect(out).not.toContain(glyph);
  });

  it("an overview built for ANOTHER window is held back, never relabelled", () => {
    const out = prose({ overview: mkOverview({ rangeDays: 7, usage: WORKED.usage }) }, { days: 90, interactive: true });
    expect(out).toContain("reading the last 90 days");
    expect(out).not.toContain("In the last");
  });

  it("an overview with no rangeDays still renders (the cast is tolerant)", () => {
    const { rangeDays: _dropped, ...noWindow } = WORKED;
    const out = prose({ overview: noWindow as OverviewSnapshot }, { days: 30 });
    expect(out).toContain("In the last 30 days you ran 80 sessions");
  });

  // A plan clamp is the OTHER reason the windows disagree, and it is permanent
  // rather than in-flight. This surface persists its window to disk, so treating
  // a clamp like a mid-flight poll would leave a Free owner with an
  // aggregate-free board forever (docs/specs/pricing.md).
  it("a plan-CLAMPED overview renders, relabelled to the window actually served", () => {
    const out = prose(
      { overview: mkOverview({ rangeDays: 30, maxRangeDays: 30, usage: WORKED.usage }) },
      { days: 90, interactive: true },
    );
    expect(out).toContain("In the last 30 days you ran 80 sessions");
    // The claim the header makes must be the window under it, never the ask.
    expect(out).not.toContain("In the last 90 days");
    expect(out).not.toContain("reading the last 90 days");
  });

  it("drops the pills a plan cannot serve, so no control is offered that cannot work", () => {
    const capped = prose(
      { overview: mkOverview({ rangeDays: 30, maxRangeDays: 30, usage: WORKED.usage }) },
      { days: 30 },
    );
    expect(capped).toContain("30d");
    expect(capped).not.toContain("90d");

    const uncapped = prose(
      { overview: mkOverview({ rangeDays: 30, maxRangeDays: 90, usage: WORKED.usage }) },
      { days: 30 },
    );
    expect(uncapped).toContain("90d");
  });

  // The narrow case that must NOT be mistaken for a clamp: a mismatch that the
  // ceiling does not explain is still a poll in flight, and still held back.
  it("still holds back a mismatch the ceiling does not explain", () => {
    const out = prose(
      { overview: mkOverview({ rangeDays: 7, maxRangeDays: 90, usage: WORKED.usage }) },
      { days: 90, interactive: true },
    );
    expect(out).toContain("reading the last 90 days");
    expect(out).not.toContain("In the last");
  });
});

describe("renderFrame — the gateway", () => {
  it("names the dashboard and prints the URL", () => {
    const out = prose({ overview: WORKED }, { gateway: "https://w.example/dashboard" });
    expect(out).toContain("Charts, replay, and the model live in the dashboard:");
    expect(out).toContain("https://w.example/dashboard");
  });

  it("never carries a token on a URL that stays on screen", () => {
    const out = prose({ overview: WORKED }, { gateway: "https://w.example/dashboard" });
    expect(out).not.toContain("#token");
  });

  it("is absent when no gateway is offered (demo)", () => {
    expect(prose({ overview: WORKED })).not.toContain("dashboard");
  });
});

describe("renderFrame — header box", () => {
  const snap = { live: [mkSession()], overview: WORKED };

  it("frames the title in a rounded box (matching the input box)", () => {
    const out = prose(snap).split("\n");
    expect(out[0]).toMatch(/^╭─+╮$/);
    expect(out[1]).toContain("▟▙ seorak");
    expect(out[2]).toMatch(/^╰─+╯$/);
  });

  it("seats the window filter in the header, marking the active window", () => {
    const head = prose(snap).split("\n")[1]!;
    expect(head).toContain("[7d]");
    expect(head).toContain("30d");
    expect(head).not.toContain("[30d]");
  });
});

describe("renderFrame — color gating", () => {
  const snap = { live: [mkSession({ awaitingInput: true })], overview: WORKED };

  it("emits ZERO escape bytes when color is off", () => {
    expect(prose(snap, { color: false })).not.toContain("\x1b");
  });

  it("emits ANSI when color is on, and the sentences survive", () => {
    const out = prose(snap, { color: true });
    expect(out).toMatch(ANSI);
    expect(out).toContain("waiting on you");
    expect(out).toContain("In the last 7 days");
  });
});

describe("focus is a scope in the reading views and a CURSOR in the table", () => {
  const data = {
    live: [mkSession({ repoId: "r1", project: "seorak" }), mkSession({ sessionId: "s2", repoId: "r2", project: "chesstinker" })],
    overview: mkOverview({ usage: mkUsage({ totals: { sessions: 5, toolCalls: 9 }, projects: TWO_PROJECTS }) }),
  };
  const scoped = { scope: { repoId: "r2", project: "chesstinker" } };
  const render = (view: "paragraph" | "list" | "projects") =>
    renderFrame({ rangeDays: 7, view }, { generatedAt: "2026-07-26T12:00:00.000Z", ...data } as BoardData,
      ctx({ now: Date.parse("2026-07-26T12:00:00.000Z"), ...scoped }));

  it("the paragraph narrows to the focused project and the header says so", () => {
    const out = render("paragraph");
    expect(out).toContain("seorak › chesstinker");
    expect(out).toContain("in chesstinker");
    expect(out).not.toContain("Two sessions are running");
  });

  it("the projects table shows EVERY project, so the header claims no focus", () => {
    const out = render("projects");
    // The bug this pins: a breadcrumb reading "chesstinker" over a table listing
    // every other repo is the screen contradicting itself.
    expect(out).not.toContain("seorak › chesstinker");
    expect(out).toContain("chesstinker");
    expect(out).toContain("PROJECT");
  });

  it("and its now line covers everything running, not just the picked row", () => {
    const out = render("projects");
    expect(out).toContain("Two sessions are running");
  });

  it("the picked row is still marked, so the cursor is visible", () => {
    const lines = render("projects").split("\n");
    const afterHeader = lines.slice(lines.findIndex((l) => l.includes("PROJECT")) + 1);
    const row = afterHeader.find((l) => l.includes("chesstinker"))!;
    expect(row.trim().startsWith("▎")).toBe(true);
    // and only that row
    expect(afterHeader.find((l) => l.includes("seorak"))!.trim().startsWith("▎")).toBe(false);
  });
});

describe("the scoped path survives a response that omits an optional array", () => {
  // This surface CASTS the worker's response instead of parsing it, so an absent
  // `byAgent` / `byModel` (an older worker, a cached body) must degrade the
  // render rather than throw and take the session down with it.
  const bare = [{ repoId: "r1", project: "seorak", sessions: 3, tokensTotal: 0, costUsd: null }] as unknown as UsageSnapshot["projects"];
  const data = {
    live: [mkSession({ repoId: "r1" })],
    overview: mkOverview({ usage: mkUsage({ projects: bare }) }),
  };

  it("renders every view without throwing", () => {
    for (const view of ["paragraph", "list", "projects"] as const) {
      const out = renderFrame(
        { rangeDays: 7, view },
        { generatedAt: "2026-07-26T12:00:00.000Z", ...data } as BoardData,
        ctx({ now: Date.parse("2026-07-26T12:00:00.000Z"), scope: { repoId: "r1", project: "seorak" } }),
      );
      expect(out, view).toContain("seorak");
    }
  });
});

/**
 * terminal-narrative.test.ts — the honesty oracle for the terminal's prose. The
 * gates a sentence has to clear are the same ones the old stat cells had, plus
 * the two a cell could not express at all:
 *   - an unmeasured leg is NOT SPOKEN, never zero-filled ("--" has no prose form)
 *   - a partial cost names what it cannot price, so the total reads as a floor
 *   - an outcome rate names the agent it does NOT cover
 *   - an agent whose record starts inside the window says so beside its own share
 *   - no middot and no em dash reach the reader (voice-and-scope.md)
 */
import { describe, expect, it } from "vitest";
import type {
  OutcomesSnapshot,
  OverviewSnapshot,
  SessionSummary,
  UsageSnapshot,
} from "@seorak/types";
import { DEFAULT_THRESHOLDS, resolveCapabilities } from "@seorak/types";
import {
  liveRows,
  nowSentence,
  projectRollup,
  projectRows,
  projectSentences,
  projectTable,
  scopeChoices,
  windowRows,
  windowSentences,
} from "../src/terminal/narrative.ts";

// --- fixtures ----------------------------------------------------------------

const NOW = Date.parse("2026-07-26T12:00:00.000Z");

function mkUsage(over: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    totals: { sessions: 0, toolCalls: 0, sessionsDelta: null },
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

function mkOutcomes(over: Partial<OutcomesSnapshot> = {}): OutcomesSnapshot {
  return {
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
    ...over,
  };
}

type AgentRow = OverviewSnapshot["tools"]["byAgent"][number];

function mkAgent(agent: string, tokensTotal: number, over: Partial<AgentRow> = {}): AgentRow {
  return {
    agent,
    sessions: 1,
    activeSessions: 0,
    toolCalls: 10,
    tokensTotal,
    costUsd: null,
    lines: null,
    lastEventAt: "2026-07-26T11:00:00.000Z",
    capabilities: resolveCapabilities(agent),
    erroredPresent: false,
    ...over,
  };
}

function mkOverview(over: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    generatedAt: "2026-07-26T12:00:00.000Z",
    rangeDays: 7,
    thresholds: DEFAULT_THRESHOLDS,
    usageAllowances: [],
    live: [],
    usage: mkUsage(),
    outcomes: mkOutcomes(),
    activity: { hourlyDistribution: [], agentHourly: [], endReasonsByHour: [] },
    tools: {
      byTool: [],
      callStats: { totalCalls: 0, errorRate: null },
      byModel: [],
      byAgent: [],
      agentDaily: [],
      agentModels: [],
      agentOutcomes: [],
      agentOutcomesUnusable: 0,
      verification: [],
    },
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

/** Everything the reader would actually see, as one string. */
const spoken = (o: OverviewSnapshot, days = 7): string => windowSentences(o, NOW, days).join(" ");

// --- now ---------------------------------------------------------------------

describe("nowSentence", () => {
  it("nothing live reads as a sentence, never a blank or a dash", () => {
    expect(nowSentence([], NOW)).toBe("Nothing is running right now.");
  });

  it("names the running sessions and their projects, and says nothing needs you", () => {
    const out = nowSentence([mkSession(), mkSession({ sessionId: "s2", project: "kinetic-notes" })], NOW);
    expect(out).toBe("Two sessions are running, in seorak and kinetic-notes. Nothing needs you.");
  });

  it("a blocked session OWNS the sentence, with the measured wait", () => {
    const out = nowSentence(
      [mkSession({ awaitingInput: true, lastEventAt: "2026-07-26T11:46:00.000Z" })],
      NOW,
    );
    expect(out).toBe("seorak has been waiting on you for 14 minutes.");
  });

  it("the OTHER running sessions are named, never reduced to a count", () => {
    const out = nowSentence(
      [
        mkSession({ awaitingInput: true, lastEventAt: "2026-07-26T11:46:00.000Z" }),
        mkSession({ sessionId: "s2", project: "orchescope" }),
        mkSession({ sessionId: "s3", project: "chesstinker" }),
      ],
      NOW,
    );
    expect(out).toBe(
      "seorak has been waiting on you for 14 minutes. Two other sessions are running, in orchescope and chesstinker.",
    );
  });

  it("several blocked sessions are all named", () => {
    const out = nowSentence(
      [
        mkSession({ awaitingInput: true }),
        mkSession({ sessionId: "s2", project: "orchescope", awaitingInput: true }),
      ],
      NOW,
    );
    expect(out).toBe("Two sessions need you, in seorak and orchescope.");
  });

  it("ended sessions are not on the live board", () => {
    expect(nowSentence([mkSession({ status: "ended" })], NOW)).toBe("Nothing is running right now.");
  });

  it("a blank repo label is spoken, never rendered as an empty gap", () => {
    expect(nowSentence([mkSession({ project: "  " })], NOW)).toContain("an unlabeled project");
  });

  it("names as many projects as fit, then counts the rest (never counts instead of naming)", () => {
    const live = ["a", "b", "c", "d", "e", "f"].map((p, i) => mkSession({ sessionId: `s${i}`, project: p }));
    const out = nowSentence(live, NOW);
    expect(out).toContain("in a, b, c, d, and 2 more");
    expect(out).not.toContain("across 6 projects");
  });
});

// --- the window --------------------------------------------------------------

describe("windowSentences", () => {
  it("opens with volume, spelling the window", () => {
    const out = spoken(
      mkOverview({
        usage: mkUsage({
          totals: { sessions: 80, toolCalls: 17576, sessionsDelta: null },
        }),
      }),
    );
    expect(out).toContain("In the last 7 days you ran 80 sessions across 0 projects.");
  });

  it("splits tokens per agent, largest first", () => {
    const o = mkOverview({
      tools: {
        ...mkOverview().tools,
        byAgent: [mkAgent("codex", 13_351_436), mkAgent("claude-code", 29_188_697)],
      },
    });
    expect(spoken(o)).toContain("That used 42.5M tokens: 29.2M from Claude Code and 13.4M from Codex.");
  });

  it("an agent whose record STARTS inside the window says so, beside its own share", () => {
    const o = mkOverview({
      tools: {
        ...mkOverview().tools,
        byAgent: [
          mkAgent("claude-code", 29_000_000, { firstSeenAt: "2026-06-05T00:00:00.000Z" }),
          mkAgent("codex", 13_000_000, { firstSeenAt: "2026-07-12T00:00:00.000Z" }),
        ],
      },
    });
    expect(spoken(o, 30)).toContain("Seorak only started watching Codex on July 12");
    // At 7 days BOTH records span the window, so the caveat would be noise.
    expect(spoken(o, 7)).not.toContain("only started watching");
  });

  it("an agent with NO firstSeenAt is never called shallow (unknown depth is not shallow depth)", () => {
    const o = mkOverview({
      tools: {
        ...mkOverview().tools,
        byAgent: [mkAgent("claude-code", 29_000_000), mkAgent("codex", 13_000_000)],
      },
    });
    expect(spoken(o, 90)).not.toContain("only started watching");
  });

  it("a partial cost names what it cannot price, so the total reads as a floor", () => {
    const o = mkOverview({
      usage: mkUsage({
        cost: {
          totalUsd: 4338.52,
          sessionsWithCost: 57,
          costPartial: true,
          unpricedModels: [{ model: "claude-opus-5", tokensTotal: 2_121_026_648 }],
          delta: null,
        },
      }),
    });
    expect(spoken(o)).toContain("It cost at least $4,339.");
    expect(spoken(o)).toContain("Claude Opus 5 has no public price yet, so the real number is higher.");
  });

  it("a fully priced window states the estimate plainly", () => {
    const o = mkOverview({
      usage: mkUsage({ cost: { totalUsd: 42.5, sessionsWithCost: 3, delta: null } }),
    });
    expect(spoken(o)).toContain("That cost about $42.50.");
  });

  it("cost with no priced session is NOT spoken, never rendered as $0", () => {
    const o = mkOverview({ usage: mkUsage({ cost: { totalUsd: 0, sessionsWithCost: 0, delta: null } }) });
    expect(spoken(o)).not.toContain("$");
    expect(spoken(o)).not.toContain("cost");
  });

  it("outcome names both legs when both are measured", () => {
    const o = mkOverview({
      outcomes: mkOutcomes({
        shipRate: 0.7413,
        lineSurvival: { ...mkOutcomes().lineSurvival, rate: 0.8551, sessionsRated: 45 },
      }),
    });
    expect(spoken(o)).toContain(
      "74% of those sessions ended in a commit and 86% of the lines you wrote are still in your code, checked across 45 sessions old enough to tell.",
    );
  });

  it("outcome names the agent the read does NOT cover", () => {
    const o = mkOverview({
      outcomes: mkOutcomes({ shipRate: 0.74 }),
      tools: {
        ...mkOverview().tools,
        byAgent: [
          mkAgent("claude-code", 29_000_000),
          mkAgent("codex", 13_000_000),
        ],
      },
    });
    expect(spoken(o)).toContain("Both numbers cover Claude Code only, because Codex never reports when a session ends.");
  });

  it("no outcome measurement means NO outcome sentence, never a zero-filled one", () => {
    const out = spoken(mkOverview());
    expect(out).not.toContain("ended in a commit");
    expect(out).not.toContain("0%");
  });

  it("line survival below its maturity floor is not spoken", () => {
    const o = mkOverview({
      outcomes: mkOutcomes({ lineSurvival: { ...mkOutcomes().lineSurvival, rate: 0.9, sessionsRated: 0 } }),
    });
    expect(spoken(o)).not.toContain("still in your code");
  });

  it("the paragraph SHRINKS on thin data instead of padding itself", () => {
    expect(windowSentences(mkOverview(), NOW, 7)).toHaveLength(1);
  });

  it("uses plain words: no jargon the reader did not bring with them", () => {
    const o = mkOverview({
      usage: mkUsage({
        totals: { sessions: 80, toolCalls: 100, sessionsDelta: null },
      }),
      outcomes: mkOutcomes({
        shipRate: 0.74,
        lineSurvival: { ...mkOutcomes().lineSurvival, rate: 0.86, sessionsRated: 45 },
      }),
    });
    const all = spoken(o);
    for (const jargon of ["matured session", "on the branch", "aside", "aggregate", "rollup"]) {
      expect(all, jargon).not.toContain(jargon);
    }
  });

  it("never emits a middot or an em dash", () => {
    const o = mkOverview({
      usage: mkUsage({
        totals: { sessions: 80, toolCalls: 100, sessionsDelta: null },
        cost: {
          totalUsd: 4338.52,
          sessionsWithCost: 57,
          costPartial: true,
          unpricedModels: [{ model: "claude-opus-5", tokensTotal: 1 }],
          delta: null,
        },
      }),
      outcomes: mkOutcomes({ shipRate: 0.74 }),
      tools: {
        ...mkOverview().tools,
        byAgent: [
          mkAgent("claude-code", 29_000_000, { firstSeenAt: "2026-06-05T00:00:00.000Z" }),
          mkAgent("codex", 13_000_000, { firstSeenAt: "2026-07-12T00:00:00.000Z" }),
        ],
      },
    });
    const all = `${nowSentence([mkSession()], NOW)} ${spoken(o, 30)}`;
    expect(all).not.toContain("·");
    expect(all).not.toContain("—");
  });
});

// --- the two forms are one board ---------------------------------------------

describe("windowRows mirrors windowSentences", () => {
  const FULL = mkOverview({
    usage: mkUsage({
        totals: { sessions: 80, toolCalls: 100, sessionsDelta: null },
      cost: {
        totalUsd: 4338.52,
        sessionsWithCost: 57,
        costPartial: true,
        unpricedModels: [{ model: "claude-opus-5", tokensTotal: 1 }],
        delta: null,
      },
    }),
    outcomes: mkOutcomes({
      shipRate: 0.74,
      lineSurvival: { ...mkOutcomes().lineSurvival, rate: 0.86, sessionsRated: 45 },
    }),
    tools: {
      ...mkOverview().tools,
      byAgent: [
        mkAgent("claude-code", 29_000_000),
        mkAgent("codex", 13_000_000, {
          firstSeenAt: "2026-07-12T00:00:00.000Z",
        }),
      ],
    },
  });

  it("says the same numbers in both forms", () => {
    const rows = windowRows(FULL, NOW, 30);
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    expect(byLabel.get("sessions")?.value).toBe("80");
    expect(byLabel.get("cost")?.value).toBe("at least $4,339");
    expect(byLabel.get("ended in a commit")?.value).toBe("74%");
    expect(byLabel.get("lines still in your code")?.value).toBe("86%");
    // and the same caveats, as notes rather than sentences
    expect(byLabel.get("cost")?.note).toContain("no public price yet");
    expect(byLabel.get("ended in a commit")?.note).toBe("Claude Code only");
    expect(byLabel.get("watched since")?.note).toBe("Codex only");
  });

  it("withholds the SAME rows the prose withholds, never a '--'", () => {
    const rows = windowRows(mkOverview(), NOW, 7);
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual(["sessions"]); // the only fact an empty window has
    expect(windowSentences(mkOverview(), NOW, 7)).toHaveLength(1);
    expect(rows.some((r) => r.value.includes("--"))).toBe(false);
  });

  it("a rate row carries its rate so the form can draw it; a count row does not", () => {
    const rows = windowRows(FULL, NOW, 30);
    expect(rows.find((r) => r.label === "ended in a commit")?.rate).toBeCloseTo(0.74);
    expect(rows.find((r) => r.label === "sessions")?.rate).toBeUndefined();
  });
});

describe("liveRows", () => {
  it("puts a blocked session first and names its wait", () => {
    const rows = liveRows(
      [
        mkSession({ sessionId: "s1", project: "seorak" }),
        mkSession({ sessionId: "s2", project: "orchescope", awaitingInput: true, lastEventAt: "2026-07-26T11:46:00.000Z" }),
      ],
      NOW,
    );
    expect(rows[0]).toEqual({ project: "orchescope", state: "waiting on you for 14 minutes", needsYou: true });
    expect(rows[1]).toEqual({ project: "seorak", state: "running", needsYou: false });
  });

  it("drops ended sessions", () => {
    expect(liveRows([mkSession({ status: "ended" })], NOW)).toEqual([]);
  });
});

// --- focusing one project ----------------------------------------------------

type ProjectRow = OverviewSnapshot["usage"]["projects"][number];

function mkProject(over: Partial<ProjectRow> & { repoId: string; project: string }): ProjectRow {
  return {
    sessions: 0,
    activeSessions: 0,
    toolCalls: 0,
    tokensTotal: 0,
    costUsd: null,
    lastEventAt: "2026-07-26T11:00:00.000Z",
    errorRate: null,
    cacheReuseRatio: null,
    shipRate: null,
    oneShotRate: null,
    costDelta: null,
    endReasons: [],
    stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    byTool: [],
    byModel: [],
    byAgent: [],
    hourlyDistribution: [],
    lineSurvival: null,
    endReasonsByHour: [],
    ...over,
  } as unknown as ProjectRow;
}

describe("scopeChoices", () => {
  it("puts what is LIVE first, then the window's busiest, deduped", () => {
    const overview = mkOverview({
      usage: mkUsage({
        projects: [
          mkProject({ repoId: "r-quiet", project: "quiet", sessions: 90 }),
          mkProject({ repoId: "r1", project: "seorak", sessions: 5 }),
        ],
      }),
    });
    const live = [mkSession({ repoId: "r1", project: "seorak" }), mkSession({ sessionId: "s2", repoId: "r1" })];
    expect(scopeChoices(live, overview).map((c) => c.project)).toEqual(["seorak", "quiet"]);
  });

  it("works with nothing live at all, so the key is never dead", () => {
    const overview = mkOverview({
      usage: mkUsage({ projects: [mkProject({ repoId: "r1", project: "seorak", sessions: 3 })] }),
    });
    expect(scopeChoices([], overview)).toEqual([{ repoId: "r1", project: "seorak" }]);
  });

  it("is empty when there is nothing to focus", () => {
    expect(scopeChoices([], null)).toEqual([]);
  });
});

describe("projectSentences / projectRows", () => {
  const ROLLUP = mkProject({
    repoId: "r1",
    project: "seorak",
    sessions: 93,
    tokensTotal: 59_700_000,
    costUsd: 6949,
    shipRate: 0.6,
    byModel: [{ model: "claude-opus-5" }] as unknown as ProjectRow["byModel"],
    byAgent: [mkAgent("claude-code", 57_500_000), mkAgent("codex", 2_200_000)],
    lineSurvival: { rate: 0.71, sessionsRated: 52 } as unknown as ProjectRow["lineSurvival"],
  });
  const OVERVIEW = mkOverview({
    usage: mkUsage({
      projects: [ROLLUP],
      cost: {
        totalUsd: 9000,
        sessionsWithCost: 90,
        costPartial: true,
        unpricedModels: [{ model: "claude-opus-5", tokensTotal: 1 }],
        delta: null,
      },
    }),
  });

  it("scopes the claim to the project and keeps every gate", () => {
    const said = projectSentences(OVERVIEW, ROLLUP, 30).join(" ");
    expect(said).toContain("In the last 30 days you ran 93 sessions in seorak.");
    expect(said).toContain("That used 59.7M tokens: 57.5M from Claude Code and 2.2M from Codex.");
    expect(said).toContain("It cost at least $6,949.");
    expect(said).toContain("60% of those sessions ended in a commit");
  });

  it("only says 'at least' when THIS project used the unpriced model", () => {
    const priced = mkProject({ ...ROLLUP, byModel: [] as unknown as ProjectRow["byModel"] });
    expect(projectSentences(OVERVIEW, priced, 30).join(" ")).toContain("It cost about $6,949.");
  });

  it("withholds an unmeasured leg exactly as the unscoped paragraph does", () => {
    const thin = mkProject({ repoId: "r2", project: "thin", sessions: 4 });
    const said = projectSentences(OVERVIEW, thin, 30).join(" ");
    expect(said).toBe("In the last 30 days you ran 4 sessions in thin.");
    expect(said).not.toContain("0%");
    expect(projectRows(OVERVIEW, thin).map((r) => r.label)).toEqual(["sessions"]);
  });

  it("the rows say the same numbers as the sentences", () => {
    const byLabel = new Map(projectRows(OVERVIEW, ROLLUP).map((r) => [r.label, r]));
    expect(byLabel.get("sessions")?.value).toBe("93");
    expect(byLabel.get("cost")?.value).toBe("at least $6,949");
    expect(byLabel.get("ended in a commit")?.rate).toBeCloseTo(0.6);
  });

  it("projectRollup finds the repo, and is null for one with no window history", () => {
    expect(projectRollup(OVERVIEW, "r1")?.project).toBe("seorak");
    expect(projectRollup(OVERVIEW, "nope")).toBeNull();
  });
});

describe("projectTable", () => {
  const OV = mkOverview({
    usage: mkUsage({
      projects: [
        mkProject({ repoId: "r1", project: "small", sessions: 3, tokensTotal: 1_000 }),
        mkProject({
          repoId: "r2",
          project: "big",
          sessions: 90,
          tokensTotal: 5_000_000,
          costUsd: 400,
          byModel: [{ model: "claude-opus-5" }] as unknown as ProjectRow["byModel"],
        }),
      ],
      cost: {
        totalUsd: 400,
        sessionsWithCost: 90,
        costPartial: true,
        unpricedModels: [{ model: "claude-opus-5", tokensTotal: 1 }],
        delta: null,
      },
    }),
  });

  it("orders busiest first and reports the true total alongside the capped rows", () => {
    const t = projectTable(OV, 1);
    expect(t.rows.map((r) => r.project)).toEqual(["big"]);
    expect(t.total).toBe(2);
  });

  it("flags a cost as a floor only for the project that used the unpriced model", () => {
    const t = projectTable(OV, 10);
    expect(t.rows.find((r) => r.project === "big")?.costIsFloor).toBe(true);
    expect(t.rows.find((r) => r.project === "small")?.costIsFloor).toBe(false);
  });

  it("carries a rate as null when unmeasured, so the cell can render honest-empty", () => {
    const t = projectTable(OV, 10);
    const small = t.rows.find((r) => r.project === "small")!;
    expect(small.shipRate).toBeNull();
    expect(small.survival).toBeNull();
    expect(small.costUsd).toBeNull();
  });

  it("holds survival back below its maturity floor rather than showing a swingy rate", () => {
    const ov = mkOverview({
      usage: mkUsage({
        projects: [
          mkProject({
            repoId: "r1",
            project: "green",
            sessions: 2,
            lineSurvival: { rate: 0.9, sessionsRated: 0 } as unknown as ProjectRow["lineSurvival"],
          }),
        ],
      }),
    });
    expect(projectTable(ov, 10).rows[0]!.survival).toBeNull();
  });
});

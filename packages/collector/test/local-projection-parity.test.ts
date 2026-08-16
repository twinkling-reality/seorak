/**
 * local-projection-parity.test.ts — the guard on a deliberate duplication.
 *
 * The collector builds `OverviewSnapshot` from local history because it may not
 * import the worker's projection (CLAUDE.md boundary 1, enforced by
 * `npm run boundaries:check`). Two implementations of one contract WILL drift,
 * so this test pins the split that matters:
 *
 *   1. which fields the local plane POPULATES from measurement, and
 *   2. which it leaves at the contract's documented honest-empty value.
 *
 * A field that moves between those two lists without a decision fails here. The
 * shared fixture (`support/local-history-fixture.ts`) is the one input, so a new
 * required field on the type fails the collector's typecheck first and this test
 * second.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OVERVIEW_RANGE_DAYS,
  WIDEST_OVERVIEW_RANGE_DAYS,
  type SessionEvent,
} from "@seorak/types";
import { appendLocalEvent, localHistoryCounts } from "../src/local-store.ts";
import { LOCAL_PLANE_SURFACES } from "../src/local-plane.ts";
import {
  buildLocalDeveloperModel,
  buildLocalLive,
  buildLocalOverview,
  buildLocalReplay,
  buildLocalSessionOutcome,
  buildLocalSessionPage,
  LOCAL_OVERVIEW_HONEST_EMPTY_FIELDS,
  LOCAL_OVERVIEW_MANIFEST,
} from "../src/local-projection.ts";
import {
  FIXTURE_DIR_ONE,
  FIXTURE_FILE_ONE,
  FIXTURE_NOW,
  FIXTURE_UNPRICED_MODEL,
  FIXTURE_ZERO_TOKEN_MODEL,
  capFixture,
  carrierOnlyFixture,
  liveFixture,
  localHistoryFixture,
  REPO_A,
  REPO_B,
  REPO_C,
} from "./support/local-history-fixture.ts";

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function seeded(withLive = true): string {
  const dir = mkdtempSync(join(tmpdir(), "seorak-projection-"));
  temporary.push(dir);
  for (const event of localHistoryFixture()) appendLocalEvent(event, dir);
  if (withLive) for (const event of liveFixture()) appendLocalEvent(event, dir);
  return dir;
}

function overview(dir: string, rangeDays = 7) {
  return buildLocalOverview({ directory: dir, rangeDays, nowMs: FIXTURE_NOW });
}

/**
 * The contract's OWN key set, read from the type rather than from what the
 * local projection happens to emit.
 *
 * This is the load-bearing half. A parity test that only checks the fields the
 * local side implements passes forever while the two implementations drift: the
 * worker gains a field, the local plane silently omits it, and nothing fails.
 * `createEmptyOverview` is the canonical complete snapshot in this repo, so its
 * keys ARE the contract surface — and it lives in @seorak/web, which the
 * collector may not import, so the list is pinned here and checked against the
 * built snapshot from both directions.
 */
const CONTRACT_FIELDS = [
  "generatedAt",
  "rangeDays",
  "maxRangeDays",
  "thresholds",
  "usageAllowances",
  "notificationAvailability",
  "live",
  "usage",
  "codebase",
  "outcomes",
  "activity",
  "tools",
] as const;

describe("the manifest is the promise, and it is executable", () => {
  const dir = seeded();
  const snapshot = overview(dir);
  const classified = new Set<string>([
    ...LOCAL_OVERVIEW_MANIFEST.measured,
    ...LOCAL_OVERVIEW_MANIFEST.honestEmpty,
  ]);

  it("classifies every field the built snapshot emits", () => {
    for (const key of Object.keys(snapshot)) {
      expect(
        classified.has(key),
        `${key} is emitted but not classified in LOCAL_OVERVIEW_MANIFEST`,
      ).toBe(true);
    }
  });

  it("classifies every field the CONTRACT declares, emitted or not", () => {
    // The drift this catches: the worker gains a field, the local side never
    // populates it, and without this assertion nothing complains.
    for (const key of CONTRACT_FIELDS) {
      expect(
        classified.has(key),
        `${key} is on the contract but absent from LOCAL_OVERVIEW_MANIFEST — populate it or declare it honest-empty`,
      ).toBe(true);
    }
  });

  it("names nothing it does not actually answer for", () => {
    for (const key of classified) {
      expect(
        (CONTRACT_FIELDS as readonly string[]).includes(key),
        `${key} is classified but is not a field on OverviewSnapshot`,
      ).toBe(true);
    }
  });

  it("every measured field is actually present on the snapshot", () => {
    for (const key of LOCAL_OVERVIEW_MANIFEST.measured) {
      expect(snapshot, `${key} is claimed measured but is absent`).toHaveProperty(key);
    }
  });

  it("holds each nested honest-empty field at its documented empty value", () => {
    expect(LOCAL_OVERVIEW_HONEST_EMPTY_FIELDS).toContain("outcomes.oneShotRate");
    expect(snapshot.outcomes.oneShotRate).toBeNull();
    expect(LOCAL_OVERVIEW_HONEST_EMPTY_FIELDS).toContain("tools.agentOutcomes");
    expect(snapshot.tools.agentOutcomes).toEqual([]);
    expect(LOCAL_OVERVIEW_HONEST_EMPTY_FIELDS).toContain(
      "usage.portfolio.repos[].baseline",
    );
    for (const repo of snapshot.usage.portfolio.repos) {
      expect(repo.baseline).toBeNull();
    }
  });

  it("derives the plane's declared surfaces from the same decision", () => {
    // overview is measured, so the plane advertises it. `deliveryHealth` is
    // absent for a reason no derivation can fix: there is no local delivery for
    // it to report the health of.
    expect(LOCAL_PLANE_SURFACES).toContain("overview");
    expect(LOCAL_PLANE_SURFACES).not.toContain("deliveryHealth");
    // These are on the list because every leg of them is a local row.
    for (const served of [
      "sessionOutcome",
      "developerModel",
      "interventions",
    ] as const) {
      expect(LOCAL_PLANE_SURFACES).toContain(served);
    }
  });
});

describe("local session outcome — measured legs and honest nulls", () => {
  // Seeded per test rather than per describe: this read happens inside the
  // test body, and `afterEach` removes the directory a collection-time seed
  // would have created.
  function outcome(sessionId: string) {
    return buildLocalSessionOutcome(sessionId, {
      directory: seeded(),
      nowMs: FIXTURE_NOW,
    });
  }

  it("reads every leg from the session's own rows", () => {
    const built = outcome("claude-session");
    expect(built).not.toBeNull();
    // session.delta: 2 commits landed, 3 files / +20 / -5 still uncommitted,
    // with the anti-vanity generated exclusion carried separately.
    expect(built!.commitsLanded).toBe(2);
    expect(built!.uncommitted).toEqual({
      filesTouched: 3,
      linesAdded: 20,
      linesRemoved: 5,
      generatedLinesExcluded: 900,
    });
    // session.linesurvival at the 3d rung: 100 of 120 authored lines survive
    // over 4 landed commits, which clears the >=3-commit floor.
    expect(built!.lineSurvival).toEqual({
      rung: "3d",
      fate: "retained",
      rate: 100 / 120,
      linesAuthored: 120,
      linesSurviving: 100,
      commitsChecked: 4,
    });
    // Two tool.call rows carried `errored: true`; the first is the failed edit.
    expect(built!.errorCount).toBe(2);
    expect(built!.firstErrorAt).toBe("2026-07-31T09:03:00.000Z");
    expect(built!.endReason).toBe("clear");
  });

  it("reads unknown as null rather than as a zero", () => {
    // The Codex session's tool.call carries no boolean `errored`, emitted no
    // delta, matured no survival row, and wrote no end record at all. Every one
    // of those is unknown, and a 0 would claim a clean session nobody measured.
    const built = outcome("codex-session");
    expect(built).not.toBeNull();
    expect(built!.errorCount).toBeNull();
    expect(built!.firstErrorAt).toBeNull();
    expect(built!.commitsLanded).toBeNull();
    expect(built!.uncommitted).toBeNull();
    expect(built!.lineSurvival).toBeNull();
    expect(built!.endReason).toBeNull();
  });

  it("is null for a session local history never saw", () => {
    expect(outcome("no-such-session")).toBeNull();
  });
});

describe("local developer model — the portrait from local rows", () => {
  function portrait(rangeDays = 7, repoId: string | null = null) {
    return buildLocalDeveloperModel({
      directory: seeded(),
      rangeDays,
      repoId,
      nowMs: FIXTURE_NOW,
    });
  }

  /**
   * The contract's own top-level shape, pinned the same way `CONTRACT_FIELDS`
   * above is: the canonical validator is `developerModelSnapshotSchema` in
   * @seorak/web, which the collector may not import, so the split is written
   * down here and checked from both directions.
   */
  const REQUIRED = ["scope", "focus", "outcomes", "activity", "tools"] as const;
  const OPTIONAL = ["identity", "conditional", "accrual"] as const;

  it("emits every required field and nothing the contract does not declare", () => {
    const model = portrait();
    for (const key of REQUIRED) expect(model).toHaveProperty(key);
    for (const key of Object.keys(model)) {
      expect(
        ([...REQUIRED, ...OPTIONAL] as readonly string[]).includes(key),
        `${key} is emitted but is not a field on DeveloperModelSnapshot`,
      ).toBe(true);
    }
  });

  it("scopes itself and advertises no plan ceiling", () => {
    const model = portrait();
    expect(model.scope.rangeDays).toBe(7);
    expect(model.scope.maxRangeDays).toBe(WIDEST_OVERVIEW_RANGE_DAYS);
    expect(model.scope.repoId).toBeNull();
  });

  it("counts session starts once per session, not once per resumption", () => {
    // THREE sessions start in the 7-day window: unpriced, claude, codex. Two
    // more are resident without starting in it — the straddling session and the
    // long-running `live-session`, whose start moved before the window so that
    // `codebase.filesInPlay` has a session with a PRE-window file row to bound.
    // Both are deliberately absent here: this grid is a start distribution, not
    // a residency count.
    const model = portrait();
    const sessions = model.activity.hourlyDistribution.reduce(
      (sum, bucket) => sum + bucket.sessions,
      0,
    );
    expect(sessions).toBe(3);
  });

  it("splits focus by repo with a share that sums to one", () => {
    const model = portrait();
    const total = model.focus.projectFocus.reduce(
      (sum, entry) => sum + (entry.share ?? 0),
      0,
    );
    expect(model.focus.projectFocus.map((entry) => entry.repoId).sort()).toEqual(
      [REPO_A, REPO_B].sort(),
    );
    expect(total).toBeCloseTo(1);
  });

  it("divides ship and survival over the rows that can answer them", () => {
    const model = portrait();
    // One delta row determined shipping, and it landed 2 commits.
    expect(model.outcomes.shipDeterminable).toBe(1);
    expect(model.outcomes.shipped).toBe(1);
    expect(model.outcomes.shipRate).toBe(1);
    // The rate's own legs travel with it, so a reader can ask "1 of how many".
    // The fixture's check was RE-EMITTED with a grown sha set, so these are the
    // superseding row's counts, not the two rows added together.
    expect(model.outcomes.lineSurvival.linesAuthored).toBe(180);
    expect(model.outcomes.lineSurvival.linesSurviving).toBe(140);
    expect(model.outcomes.lineSurvival.rate).toBeCloseTo(140 / 180);
  });

  it("rates tool outcomes only over sessions that observe both legs", () => {
    const model = portrait();
    // Every claude-code call in the window carries the boolean — four on the
    // claude session, one each on the live, unpriced and straddling ones. The
    // Codex session's tool cannot report both legs, so its call is COUNTED and
    // never divided.
    expect(model.tools.callStats.callsWithResult).toBe(7);
    expect(model.tools.callStats.erroredCalls).toBe(2);
    expect(model.tools.callStats.errorRate).toBeCloseTo(2 / 7);
    expect(model.tools.byTool.reduce((sum, row) => sum + row.calls, 0)).toBe(8);
  });

  it("ships verification runs without a pass rate", () => {
    const model = portrait();
    const [run] = model.tools.verification;
    expect(run).toMatchObject({ kind: "test", runs: 2, passed: 1 });
    expect(run).not.toHaveProperty("passRate");
  });

  it("anchors the conditional cut to the session's start hour", () => {
    const model = portrait();
    // The survival check ran a day after the session it rates, so bucketing by
    // the check would file it at 10:00 instead of the 09:00 the work began.
    expect(model.conditional?.lineSurvivalByStartHour).toEqual([
      {
        hour: 9,
        linesAuthored: 180,
        linesSurviving: 140,
        commitsChecked: 6,
        sessionsRated: 1,
      },
    ]);
    expect(model.conditional?.shipByStartHour).toEqual([
      { hour: 9, shipped: 1, determinable: 1 },
    ]);
  });

  it("omits accrual rather than inventing a zero baseline", () => {
    // At 7 days the prior window holds three session starts — the prior
    // session, the straddling one, and `live-session`, which begins a week
    // before the window it is still running inside — so accrual is real.
    expect(portrait(7)?.accrual?.sessions).toBe(3);
    // At 90 days the prior window reaches back before capture existed. A quiet
    // fortnight and "no history yet" are indistinguishable, so there is nothing
    // honest to compare against and the whole leg is absent.
    expect(portrait(90).accrual).toBeUndefined();
  });

  it("narrows every facet to one repo when scoped", () => {
    const model = portrait(7, REPO_B);
    expect(model.scope.repoId).toBe(REPO_B);
    expect(model.focus.projectFocus).toHaveLength(1);
    expect(model.focus.projectFocus[0]!.share).toBe(1);
    // Repo B is the Codex session: no delta row, no survival check, and a tool
    // that cannot report both legs. Every one of those reads honest-null.
    expect(model.outcomes.shipRate).toBeNull();
    expect(model.outcomes.lineSurvival.rate).toBeNull();
    expect(model.tools.callStats.errorRate).toBeNull();
    expect(model.conditional).toBeUndefined();
  });
});

describe("local overview — what it MEASURES", () => {
  const dir = seeded();
  const snapshot = overview(dir);

  it("answers the window it was asked for and advertises no plan ceiling", () => {
    expect(snapshot.rangeDays).toBe(7);
    // The local plane holds the complete raw record; no plan narrows it.
    expect(snapshot.maxRangeDays).toBe(WIDEST_OVERVIEW_RANGE_DAYS);
    expect(OVERVIEW_RANGE_DAYS).toContain(snapshot.rangeDays);
  });

  it("counts the sessions the window HOLDS, not the ones it saw start", () => {
    // `usage.totals.sessions` is "summed over the sessions currently held in KV
    // within the window", which windows by `lastEventAt`: unpriced, claude,
    // codex, live AND the straddling session, whose start is a week older than
    // the window it worked inside. Counting starts dropped it, and dropped the
    // work it did in here with it.
    expect(snapshot.usage.totals.sessions).toBe(5);
    // `sessionsDelta` is the START count, deliberately — BOTH its legs are
    // distinct `session.start` counts over adjacent windows, so it is a
    // different number from the headline above and must stay one. Two of the
    // five resident sessions start in the PRIOR leg — the straddling one and
    // `live-session` — beside the prior session, so `previous` is 3 against a
    // `current` of 3 while the headline reads 5.
    expect(snapshot.usage.totals.sessionsDelta).toEqual({
      current: 3,
      previous: 3,
    });
  });

  it("counts every tool call and reports the error rate from BOTH legs", () => {
    // The RESIDENT sum: "the sum of `toolCallCount` over resident sessions", so
    // the straddling session brings BOTH its calls, including the one it made a
    // week before the window opened, and `live-session` now does the same.
    // 2 (straddle) + 1 (unpriced) + 4 (claude) + 1 (codex) + 2 (live).
    expect(snapshot.usage.totals.toolCalls).toBe(10);
    expect(snapshot.tools.callStats.totalCalls).toBe(10);
    // `byTool` beside it is an in-window ROW count and stays one — the contract
    // splits the two deliberately, so they are not the same number.
    expect(
      snapshot.tools.byTool.reduce((sum, row) => sum + row.calls, 0),
    ).toBe(8);
    // 7 in-window calls carried a boolean `errored` and 2 were true. The Codex
    // call carries none, so it is outside the DENOMINATOR rather than a silent pass.
    expect(snapshot.tools.callStats.errorRate).toBeCloseTo(2 / 7, 10);
  });

  it("prices from tokens and NAMES the model the table has no row for", () => {
    expect(snapshot.usage.cost.totalUsd).not.toBeNull();
    expect(snapshot.usage.cost.totalUsd!).toBeGreaterThan(0);
    expect(snapshot.usage.cost.sessionsWithCost).toBeGreaterThan(0);
    // TRUE because a session that COULD price its work yielded no price at all
    // and was dropped from the total — not merely because a model went unpriced.
    // The claude session has an unpriced model beside priced ones and the total
    // still counts it; `unpriced-session` is the one that is missing.
    expect(snapshot.usage.cost.costPartial).toBe(true);
    // The SIZE OF THE HOLE, which is every leg and not the billable pair:
    // 500 + 100 on the claude session, and 400 + 90 + 700 of cache read on the
    // unpriced one. Reading it as billable hid 700 tokens of real spend from the
    // one list whose job is to make missing spend visible.
    expect(snapshot.usage.cost.unpricedModels).toEqual([
      { model: FIXTURE_UNPRICED_MODEL, tokensTotal: 1_790 },
    ]);
    // And the zero-token unpriced model is NOT named: it burned nothing, so
    // there is no hole and no price row anyone should add.
    expect(
      snapshot.usage.cost.unpricedModels!.map((row) => row.model),
    ).not.toContain(FIXTURE_ZERO_TOKEN_MODEL);
    // Same drop in the per-model rollups it mirrors.
    expect(snapshot.tools.byModel.map((row) => row.model)).not.toContain(
      FIXTURE_ZERO_TOKEN_MODEL,
    );
    expect(snapshot.tools.agentModels.map((row) => row.model)).not.toContain(
      FIXTURE_ZERO_TOKEN_MODEL,
    );
  });

  it("reads a cumulative session.tokens carrier as a DELTA, never a sum", () => {
    const codex = snapshot.usage.projects.find((row) => row.repoId === REPO_B);
    expect(codex).toBeDefined();
    // Two cumulative snapshots: 10k/2k then 15k/3k. The window total is the
    // LATEST snapshot (15k + 3k billable), not 25k + 5k.
    expect(codex!.tokensTotal).toBe(18_000);
    expect(codex!.cacheReadTokens).toBe(6_000);
    // Codex tool.call rows carry a schema zero and must not enter the money.
    expect(codex!.costUsd).not.toBeNull();
    expect(codex!.costUsd!).toBeGreaterThan(0);
  });

  it("sums edit line volume from the collector's on-machine derivation", () => {
    expect(snapshot.usage.lines).toEqual({
      added: 158,
      removed: 23,
      // `previous` gained `live-session`'s pre-window edit (+3).
      delta: { current: 158, previous: 55 },
    });
  });

  it("buckets daily trends by each event's own date with NO zero-filled spine", () => {
    const days = snapshot.usage.dailyTrends.map((point) => point.day);
    expect(new Set(days).size).toBe(days.length);
    expect(days).toEqual([...days].sort());
    // A 7-day window over 3 active days must not manufacture 7 rows.
    expect(days.length).toBeLessThan(7);
    for (const point of snapshot.usage.dailyTrends) {
      expect(point.sessions).toBeGreaterThanOrEqual(0);
      if (point.costUsd !== null) expect(point.costUsd).toBeGreaterThan(0);
    }
  });

  it("groups per repo and keeps the repo rows consistent with the headline", () => {
    const repos = snapshot.usage.projects.map((row) => row.repoId).sort();
    expect(repos).toEqual([REPO_A, REPO_B, REPO_C].sort());
    const total = snapshot.usage.projects.reduce(
      (sum, row) => sum + row.toolCalls,
      0,
    );
    expect(total).toBe(snapshot.usage.totals.toolCalls);
  });

  it("derives file, directory, and rework heat from salted identity only", () => {
    const hot = snapshot.codebase.files.find(
      (file) => file.fileId === FIXTURE_FILE_ONE,
    );
    expect(hot).toBeDefined();
    expect(hot!.label).toBe("local-plane.ts");
    expect(hot!.edits).toBe(2);
    expect(hot!.linesAdded).toBe(120);
    // Two DISTINCT sessions edited it, so it is rework.
    expect(hot!.sessions).toBe(2);
    expect(
      snapshot.codebase.rework.map((row) => row.fileId),
    ).toContain(FIXTURE_FILE_ONE);
    const dir = snapshot.codebase.directories.find(
      (row) => row.dirId === FIXTURE_DIR_ONE,
    );
    expect(dir).toBeDefined();
    // Two of the window's three directory edits land here; the straddling
    // session's edit is in the other repo's directory.
    expect(dir!.share).toBeCloseTo(2 / 3, 10);
  });

  it("reports git ground truth from the latest momentum snapshot per repo", () => {
    expect(snapshot.usage.momentum).toHaveLength(2);
    expect(snapshot.codebase.commitStats).toMatchObject({
      // The WIDEST sweep the summed counts reach across (repo A sweeps 14 days,
      // repo B 7), never whichever repo's basename sorts first.
      windowDays: 14,
      commits: 6,
      filesTouched: 21,
      commitsFromSessions: 2,
    });
    expect(snapshot.usage.portfolio).toMatchObject({
      reposTotal: 2,
      reposMoved: 1,
      reposQuiet: 1,
    });
    const quiet = snapshot.usage.portfolio.repos.find(
      (row) => row.repoId === REPO_B,
    );
    expect(quiet!.temperature).toBe("quiet");
  });

  it("reports lifecycle, ship rate, and line survival from real rows", () => {
    expect(snapshot.outcomes.endReasons).toEqual([
      { reason: "clear", count: 2 },
      { reason: "resume", count: 1 },
    ]);
    // FOUR resident sessions have stopped: three wrote a `session.end`, and the
    // Codex one went silent past the abandoned horizon without ever writing one.
    // Counting only the end records left it in NEITHER column, so the chat
    // sentence ("N sessions. X ended, Y still in flight") lost a session and the
    // end-reason widget could not disclose it as an unlabelled end.
    expect(snapshot.outcomes.endedCount).toBe(4);
    expect(snapshot.outcomes.activeCount).toBe(1);
    expect(
      snapshot.outcomes.activeCount + snapshot.outcomes.endedCount,
    ).toBe(snapshot.usage.totals.sessions);
    // The ring still distributes over REAL reasons only, so the widget's
    // "ended without a recorded reason" disclosure has something to disclose.
    const labelled = snapshot.outcomes.endReasons.reduce(
      (sum, row) => sum + row.count,
      0,
    );
    expect(snapshot.outcomes.endedCount).toBeGreaterThan(labelled);
    expect(snapshot.outcomes.shipRate).toBe(1);
    expect(snapshot.outcomes.lineSurvival).toMatchObject({
      linesAuthored: 180,
      linesSurviving: 140,
      commitsChecked: 6,
      sessionsRated: 1,
      retained: 1,
      overwritten: 0,
    });
    // 140/180 over 6 checked commits clears the >=3 floor.
    expect(snapshot.outcomes.lineSurvival.rate).toBeCloseTo(140 / 180, 10);
    // The row set is EXACTLY the ended half of the resident partition, so it is
    // a drill into `endedCount` and not a second, smaller answer beside it. It
    // used to be seeded from `session.end` RECORDS, which left out every session
    // the abandoned horizon ended — `codex-session` here, and Codex never writes
    // an end record at all — so this list held three rows under a count of four.
    // A reaped session has no end time, so `lastEventAt` is the honest anchor,
    // which is the same rule `overview.ts` states (`endedAt ?? lastEventAt`).
    expect(snapshot.outcomes.bySession).toEqual([
      expect.objectContaining({ sessionId: "codex-session", status: "pending" }),
      expect.objectContaining({ sessionId: "claude-session", status: "retained" }),
      expect.objectContaining({ sessionId: "straddle-session", status: "pending" }),
      expect.objectContaining({ sessionId: "unpriced-session", status: "pending" }),
    ]);
    expect(snapshot.outcomes.bySession).toHaveLength(
      snapshot.outcomes.endedCount,
    );
  });

  it("gates verification on a tool that can observe BOTH legs", () => {
    expect(snapshot.tools.verification).toEqual([
      { kind: "test", passRate: 0.5, runs: 2, passed: 1 },
    ]);
  });

  it("resolves per-agent capabilities rather than blending the tools", () => {
    const agents = Object.fromEntries(
      snapshot.tools.byAgent.map((row) => [row.agent, row]),
    );
    expect(agents["claude-code"]!.capabilities.costScope).toBe("call");
    expect(agents["codex"]!.capabilities.costScope).toBe("session");
    // Codex reported no boolean error leg in this window.
    expect(agents["codex"]!.erroredPresent).toBe(false);
    expect(agents["codex"]!.errorRate?.rate).toBeNull();
    expect(agents["claude-code"]!.errorRate).toMatchObject({
      errored: 2,
      returned: 7,
    });
    // `firstSeenAt` is the earliest start across the WHOLE log and NOT the
    // window — deliberately asymmetric with the in-window `lastEventAt` beside
    // it, because it is the fact a cross-agent comparison cannot be honest
    // without. Windowing it reported both tools' records starting at the window
    // edge, which is exactly the false symmetry the field exists to break.
    // `live-session` starts an hour before the prior session, and this reads the
    // earliest start in the WHOLE log.
    expect(agents["claude-code"]!.firstSeenAt).toBe("2026-07-25T09:00:00.000Z");
    expect(agents["codex"]!.firstSeenAt).toBe("2026-08-01T14:00:00.000Z");
  });

  it("puts per-agent day tokens on agentDaily from BOTH carriers", () => {
    const codexDay = snapshot.tools.agentDaily.find((p) => p.agent === "codex");
    expect(codexDay).toBeDefined();
    // Cumulative session.tokens: 10k/2k then 15k/3k → window billable 18k.
    // Codex tool.call rows carry schema zeros and must not invent a different total.
    expect(codexDay!.tokensTotal).toBe(18_000);
    const claudeDays = snapshot.tools.agentDaily.filter((p) => p.agent === "claude-code");
    expect(claudeDays.some((p) => (p.tokensTotal ?? 0) > 0)).toBe(true);
    for (const point of snapshot.tools.agentDaily) {
      expect(point.tokensTotal === null || Number.isFinite(point.tokensTotal)).toBe(true);
    }
  });

  it("bins the activity grids only where activity happened", () => {
    for (const bucket of snapshot.activity.hourlyDistribution) {
      expect(bucket.sessions).toBeGreaterThan(0);
    }
    for (const point of snapshot.activity.agentHourly) {
      expect(point.calls).toBeGreaterThan(0);
    }
    for (const hour of snapshot.activity.endReasonsByHour) {
      expect(hour.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("local overview — what it deliberately leaves HONEST-EMPTY", () => {
  const dir = seeded();
  const snapshot = overview(dir);

  it("omits notificationAvailability rather than claiming a watch verdict", () => {
    // Absent means UNKNOWN on this contract, which is exactly true: the local
    // plane evaluates no watch applicability.
    expect(snapshot.notificationAvailability).toBeUndefined();
  });

  it("leaves usage headroom empty until a reading is derived locally", () => {
    expect(snapshot.usageAllowances).toEqual([]);
  });

  it("leaves one-shot rate NULL, never a fabricated 0", () => {
    // The retry-shape classifier is a worker derivation. 0 would read as
    // "nothing ran clean", which this plane cannot claim.
    expect(snapshot.outcomes.oneShotRate).toBeNull();
  });

  it("leaves the per-agent git split empty and DISCLOSES the rows it could not use", () => {
    expect(snapshot.tools.agentOutcomes).toEqual([]);
    // One rated survival row exists and is in nobody's legs, so the count says
    // so instead of a silent 0 that would imply complete coverage.
    expect(snapshot.tools.agentOutcomesUnusable).toBe(1);
  });

  it("judges no temperature it has no baseline for", () => {
    const active = snapshot.usage.portfolio.repos.find(
      (row) => row.repoId === REPO_A,
    );
    expect(active!.temperature).toBeNull();
    expect(active!.baseline).toBeNull();
  });

  it("emits the published thresholds as config, with interventions unavailable", () => {
    // Config is always present on this contract; that nothing FIRES is said by
    // the plane descriptor, which omits the `interventions` surface.
    expect(Object.keys(snapshot.thresholds).length).toBeGreaterThan(0);
  });
});

describe("local overview — empty history is empty, not zero-filled", () => {
  it("reports nothing measured rather than a measured nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "seorak-projection-empty-"));
    temporary.push(dir);
    const snapshot = overview(dir);
    expect(snapshot.usage.totals.sessions).toBe(0);
    // No prior window either, so the delta pill is suppressed rather than
    // claiming a measured zero baseline.
    expect(snapshot.usage.totals.sessionsDelta).toEqual({
      current: 0,
      previous: null,
    });
    expect(snapshot.usage.cost.totalUsd).toBeNull();
    expect(snapshot.usage.cost.delta).toBeNull();
    expect(snapshot.usage.lines).toBeNull();
    expect(snapshot.usage.cacheReuseRatio).toBeNull();
    expect(snapshot.usage.costPerEdit).toBeNull();
    expect(snapshot.usage.dailyTrends).toEqual([]);
    expect(snapshot.usage.projects).toEqual([]);
    expect(snapshot.codebase.commitStats).toBeNull();
    expect(snapshot.codebase.filesInPlay).toBeNull();
    expect(snapshot.outcomes.shipRate).toBeNull();
    expect(snapshot.outcomes.lineSurvival.rate).toBeNull();
    expect(snapshot.outcomes.stuckness.rate).toBeNull();
    expect(snapshot.tools.callStats.errorRate).toBeNull();
    expect(snapshot.tools.byAgent).toEqual([]);
  });
});

describe("local live board", () => {
  it("shows only sessions still inside the live horizon", () => {
    const dir = seeded();
    const live = buildLocalLive({ directory: dir, nowMs: FIXTURE_NOW });
    expect(live.live.map((row) => row.sessionId)).toEqual(["live-session"]);
    const row = live.live[0]!;
    expect(row.status).toBe("active");
    expect(row.currentTool).toBe("Read");
    // The session's own RUNNING totals, which is what a live board shows: 90
    // from the edit it made before the window opened plus 120 from the read it
    // just made. The window bound belongs to `codebase.filesInPlay`, which asks
    // what is in play NOW, not to a session's cumulative counters.
    expect(row.tokens.total).toBe(210);
    expect(row.costUsd).not.toBeNull();
  });

  it("drops a session silent past the abandoned horizon rather than showing it live", () => {
    const dir = seeded();
    // An hour later the live session is well past ABANDONED_THRESHOLD_MS.
    const later = buildLocalLive({
      directory: dir,
      nowMs: FIXTURE_NOW + 60 * 60 * 1000,
    });
    expect(later.live).toEqual([]);
  });

  it("puts the live session's files in play and nothing else", () => {
    const dir = seeded();
    const snapshot = overview(dir);
    expect(snapshot.codebase.filesInPlay).not.toBeNull();
    expect(snapshot.codebase.filesInPlay!.distinctFiles).toBe(1);
    expect(snapshot.codebase.filesInPlay!.files[0]).toMatchObject({
      fileId: FIXTURE_FILE_ONE,
      category: "source",
    });
  });
});

describe("sessions nobody ran", () => {
  /**
   * The daemon's momentum sweep emits `git.momentum` under the synthetic id
   * `daemon-momentum`, and local-store opens a session row for any unseen
   * session — so the sweep manufactures a session with an empty repoId. The
   * worker refuses exactly these rows (`isDisplayableSession`); the local
   * readers did not, so the two halves of one product disagreed about how many
   * sessions the user ran and the local half was the wrong one.
   */
  function withSweep(): string {
    const dir = seeded();
    appendLocalEvent(
      {
        kind: "git.momentum",
        eventId: "sweep-momentum",
        sessionId: "daemon-momentum",
        at: new Date(FIXTURE_NOW - 60_000).toISOString(),
        repoId: REPO_A,
        repoLabel: "seorak",
        gitContext: "clean",
        windowDays: 7,
        commits: 3,
        filesTouched: 9,
        linesAdded: 100,
        linesDeleted: 10,
        generatedLinesExcluded: 0,
      },
      dir,
    );
    return dir;
  }

  it("keeps the manufactured row out of every user-facing count", () => {
    const dir = withSweep();
    // It is genuinely in the database — history.sqlite is the permanent
    // authority and the fix belongs in the read path, not in pruning capture.
    expect(
      buildLocalSessionPage({ directory: dir, nowMs: FIXTURE_NOW }).sessions.map(
        (row) => row.sessionId,
      ),
    ).not.toContain("daemon-momentum");
    expect(
      buildLocalLive({ directory: dir, nowMs: FIXTURE_NOW }).live.map(
        (row) => row.sessionId,
      ),
    ).not.toContain("daemon-momentum");
    expect(localHistoryCounts(dir).sessions).toBe(6);
  });

  it("agrees with the hosted session count rather than over-reporting", () => {
    const swept = withSweep();
    const clean = seeded();
    // Adding a daemon sweep must not change how many sessions the user ran.
    expect(localHistoryCounts(swept).sessions).toBe(
      localHistoryCounts(clean).sessions,
    );
  });

  it("still counts the sweep's git evidence, which is real", () => {
    // The row is not displayable; the momentum snapshot on it is measurement.
    const snapshot = overview(withSweep());
    expect(snapshot.usage.momentum.map((row) => row.repoLabel)).toContain("seorak");
  });
});

describe("local session page", () => {
  it("pages newest activity first and terminates", () => {
    const dir = seeded();
    const first = buildLocalSessionPage({
      directory: dir,
      limit: 2,
      nowMs: FIXTURE_NOW,
    });
    expect(first.sessions).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = buildLocalSessionPage({
      directory: dir,
      limit: 2,
      cursor: first.nextCursor,
      nowMs: FIXTURE_NOW,
    });
    const third = buildLocalSessionPage({
      directory: dir,
      limit: 2,
      cursor: second.nextCursor,
      nowMs: FIXTURE_NOW,
    });
    const ids = [...first.sessions, ...second.sessions, ...third.sessions].map(
      (row) => row.sessionId,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(third.nextCursor).toBeNull();
  });

  it("scopes to one repo when asked", () => {
    const dir = seeded();
    const page = buildLocalSessionPage({
      directory: dir,
      repoId: REPO_B,
      nowMs: FIXTURE_NOW,
    });
    expect(page.sessions.map((row) => row.sessionId)).toEqual(["codex-session"]);
  });

  it("reads a long-silent session as ended, never permanently stuck", () => {
    // Codex writes no session-end record ever, so a finished Codex session is
    // only ever "silent". Leaving it "stuck" would accuse it forever.
    const dir = seeded();
    const page = buildLocalSessionPage({
      directory: dir,
      repoId: REPO_B,
      nowMs: FIXTURE_NOW,
    });
    expect(page.sessions[0]!.status).toBe("ended");
    expect(page.sessions[0]!.endedAt).toBeUndefined();
  });
});

describe("local replay", () => {
  it("reconstructs only moments a captured signal backs", () => {
    const dir = seeded();
    const replay = buildLocalReplay("claude-session", { directory: dir });
    expect(replay).not.toBeNull();
    const kinds = replay!.keyframes.map((frame) => frame.kind);
    expect(kinds).toContain("session-start");
    expect(kinds).toContain("first-tool-call");
    expect(kinds).toContain("first-error");
    expect(kinds).toContain("verification-failed");
    expect(kinds).toContain("biggest-commit");
    expect(kinds).toContain("session-end");
    expect(replay!.totals.toolCallCount).toBe(4);
    expect(replay!.totals.promptCount).toBe(1);
    expect(replay!.totals.filesTouchedUncommitted).toBe(3);
    // Keyframes are ordered by their backing event's sequence.
    const seqs = replay!.keyframes.map((frame) => frame.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    // Every moment is content-free: tool names, enums, and counts only.
    for (const moment of replay!.moments) {
      expect(Object.keys(moment)).not.toContain("payload");
    }
  });

  it("is honestly absent for a session local history has never seen", () => {
    const dir = seeded();
    expect(buildLocalReplay("no-such-session", { directory: dir })).toBeNull();
  });
});

/**
 * The VALUE half of parity, for the one rule this plane got wrong.
 *
 * The rest of this file pins WHICH fields are measured. It cannot pin what they
 * equal, because the hosted answer is not importable here (CLAUDE.md boundary 1),
 * and `scripts/check-projection-parity.mjs` is where the two are compared
 * head-to-head. That gate is private repository tooling, so it does NOT travel
 * to the open-core repository with this package — which is exactly why the rule
 * it caught is re-pinned here, in the suite that ships beside the code.
 */
describe("session-costed models", () => {
  it("counts a token carrier snapshot as tokens and never as a call", () => {
    const dir = seeded();
    const codex = overview(dir).tools?.byModel?.find(
      (m) => m.model === "gpt-5.1-codex",
    );
    // Codex's money and tokens ride `session.tokens`; its `tool.call` rows carry
    // no `models[]` at all. `ModelRollup.calls` is a MODEL-ITEM count, so a
    // carrier-only model has zero model-items in the window — a measured zero,
    // not an absence. Counting each snapshot delta as a call read `calls: 2`
    // here while the hosted plane reported `0` for the same events.
    expect(codex).toBeDefined();
    expect(codex!.calls).toBe(0);
    // The measurement itself must survive: a zero call count is not a zero row.
    expect(codex!.tokensTotal).toBeGreaterThan(0);
    expect(codex!.costUsd).toBeGreaterThan(0);
  });

  it("still counts a per-call model item, which is what the field means", () => {
    const dir = seeded();
    const claude = overview(dir).tools?.byModel?.find(
      (m) => m.model === "claude-opus-4-5",
    );
    // The guard above must not have zeroed the per-call path with it: a model
    // that rides `tool.call.models[]` still contributes one item per call.
    expect(claude).toBeDefined();
    expect(claude!.calls).toBeGreaterThan(0);
  });
});

/**
 * The second value-half rule the parity gate caught, re-pinned here for the same
 * reason as the first: `scripts/check-projection-parity.mjs` is private tooling
 * and does not travel to the open-core repository with this package.
 */
describe("portfolio ordering", () => {
  it("sinks quiet repos below repos that moved", () => {
    const repos = overview(seeded()).usage.portfolio.repos;
    // The ORDER is contract, not presentation. `MomentumWidgets.tsx` caps the
    // table at the first five rows and re-sorts nothing, on the stated grounds
    // that the server sorts by files touched with quiet repos sinking. Emitting
    // the scan order put a zero-commit repo above one with 21 files touched,
    // which on a portfolio of more than five repos hides the active ones inside
    // the fold.
    expect(repos.length).toBeGreaterThan(1);
    const touched = repos.map((repo) => repo.filesTouched);
    expect([...touched].sort((a, b) => b - a)).toEqual(touched);
    // The fixture's own case, so a sort that happens to hold on sorted input
    // cannot pass this: REPO_A moved and REPO_B is quiet.
    expect(repos[0]!.repoId).toBe(REPO_A);
    expect(repos[repos.length - 1]!.temperature).toBe("quiet");
  });
});

/**
 * The four value-half rules the parity gate's MEMBER-level expansion caught, on
 * the same footing as the two above: `scripts/check-projection-parity.mjs` is
 * private tooling and does not travel to the open-core repository with this
 * package, so every rule it settles is re-pinned where the package can carry it.
 */
describe("a re-emitted survival check supersedes, never adds", () => {
  it("dedups on the session and the rung the sweep re-emits under", () => {
    const survival = overview(seeded()).outcomes.lineSurvival;
    // `survival.ts` re-emits the UNION under a new deterministic eventId when a
    // session's attributed sha set grows, and both rows are in local history.
    // Summing them read 300 authored lines against a true 180. Its own comment
    // names `(sessionId, rung)` as the reader's dedup key, because a reader
    // keyed differently means "the session is COUNTED TWICE".
    expect(survival.linesAuthored).toBe(180);
    expect(survival.linesSurviving).toBe(140);
    expect(survival.commitsChecked).toBe(6);
    // The contract's own word for this leg is "Distinct rated sessions", and one
    // session re-checked twice is one session.
    expect(survival.sessionsRated).toBe(1);
    expect(survival.retained).toBe(1);
  });

  it("counts the deduped rows as the ones a per-agent split could not use", () => {
    // `agentOutcomes` is honest-empty locally, so every RATED check is disclosed
    // as one the absent split could not use — one check, not one per re-emission.
    expect(overview(seeded()).tools.agentOutcomesUnusable).toBe(1);
  });
});

describe("a momentum window is reported, never picked by basename", () => {
  it("spans the widest sweep the summed commit stats reach across", () => {
    // The fixture's repos sweep 14 and 7 days. `momentumRows` is ordered by repo
    // BASENAME, so reading its first row made this a function of what the
    // directory is called — and `GitPanel.tsx` renders it as the span the summed
    // commits and files cover.
    expect(overview(seeded()).codebase.commitStats!.windowDays).toBe(14);
  });

  it("takes the breadth window from the globally-latest snapshot", () => {
    // Repo A's snapshot is the later of the two, so its 14-day sweep is the
    // window the breadth counts describe. Same defect, same arbitrary basename.
    expect(overview(seeded()).usage.portfolio.windowDays).toBe(14);
  });
});

describe("cost per edit divides priced dollars by priced edits", () => {
  it("keeps a session-costed tool's money out of a per-call ratio", () => {
    // Without the live rows, so this is the same input the hosted side is driven
    // over and the two numbers below are directly comparable to it.
    const usage = overview(seeded(false)).usage;
    // BOTH legs are gated to per-call-priced work. The denominator cannot see a
    // session-costed tool's edits at all, so letting the carrier's dollars into
    // the numerator divided Claude+Codex money by Claude-only edits and read 3x
    // the hosted answer. The headline total keeps the carrier money; this ratio
    // must not.
    // The headline keeps BOTH sources' dollars, so it is strictly larger than
    // the per-call leg this ratio divides by its two priced edit calls.
    const windowDollars = usage.cost.delta!.current!;
    expect(usage.costPerEdit).not.toBeNull();
    expect(usage.costPerEdit! * 2).toBeLessThan(windowDollars);
    expect(usage.costPerEdit).toBeCloseTo(0.011158333333333334, 10);
  });
});

/**
 * The rules the PARITY GATE cannot check, pinned where they live.
 *
 * `scripts/check-projection-parity.mjs` is private and does not travel to the
 * open-core repository with this package, so a rule it drove into agreement has
 * to be re-pinned here or it is unguarded the moment the package ships alone.
 * Each case below is one the gate structurally cannot hold: two of them need a
 * history the shared fixture must NOT have (the gate needs the opposite shape to
 * exercise the field at all), and one is a member the gate declares.
 */
describe("rules the shared fixture cannot hold both sides of", () => {
  function seededWith(events: SessionEvent[]): string {
    const dir = mkdtempSync(join(tmpdir(), "seorak-projection-rule-"));
    temporary.push(dir);
    for (const event of events) appendLocalEvent(event, dir);
    return dir;
  }

  it("marks the total partial only when a session was DROPPED from it", () => {
    // The claude session alone: an unpriced model sitting BESIDE priced ones, so
    // the total counts the session and understates it by that model's tokens.
    // The contract scopes `costPartial` to "a session that COULD price its work
    // was excluded from `totalUsd`", and `CostPanel.tsx` reads the two facts as
    // separate disjuncts — `costPartial === true || byModel.some(m =>
    // m.tokensTotal > 0 && m.costUsd == null)`. Folding the second into the
    // first makes that second disjunct dead and makes the flag claim a drop that
    // did not happen; `compilePeriodComparison.ts` reads the flag ALONE, with no
    // second disjunct to correct it.
    const partialModel = seededWith(
      localHistoryFixture().filter((event) =>
        event.sessionId === "claude-session",
      ),
    );
    const snapshot = overview(partialModel);
    expect(snapshot.usage.cost.totalUsd).not.toBeNull();
    // The hole is still NAMED — that is the other disjunct's job, and it is the
    // half a reader can act on.
    expect(snapshot.usage.cost.unpricedModels).toEqual([
      { model: FIXTURE_UNPRICED_MODEL, tokensTotal: 600 },
    ]);
    expect(snapshot.usage.cost.costPartial).toBeUndefined();
  });

  it("sums cache reuse over the sessions the window HOLDS, not its events", () => {
    // The straddling session made one call before the window and one inside it.
    // `usage.cacheReuseRatio` is "summed across the sessions currently held in
    // KV", so BOTH calls' tokens are in the ratio: 200 + 1,200 cache read over
    // 300 + 800 input. Summing in-window rows instead silently dropped the
    // earlier call from both legs.
    const snapshot = overview(
      seededWith(
        localHistoryFixture().filter((event) =>
          event.sessionId === "straddle-session",
        ),
      ),
    );
    expect(snapshot.usage.cacheReuseRatio).toBeCloseTo(1_400 / 2_500, 12);
    // Same source, same reason: the resident sum, not the in-window row count.
    expect(snapshot.usage.totals.toolCalls).toBe(2);
    expect(snapshot.usage.totals.sessions).toBe(1);
    // And the START count beside it stays a start count, so it reads zero here.
    expect(snapshot.usage.totals.sessionsDelta.current).toBe(0);
  });
  it("scopes the cost HEADLINE to the sessions the window holds, and the TREND to its rows", () => {
    // A cumulative `session.tokens` carrier is the one row kind that can land
    // inside the window for a session whose own work fell outside it — Codex
    // re-ships its running totals and writes no `session.end` at all. The two
    // facts are deliberately different: `usage.cost.totalUsd` is "Σ of the SAME
    // per-session cost that `projects[].costUsd` and `byAgent[].costUsd` sum, so
    // the headline EQUALS the per-repo / per-agent tiles beside it" over the
    // WINDOWED sessions (overview.ts), while both legs of `usage.cost.delta`
    // come from the event log "so the % movement compares like with like". One
    // accumulator served both here, and the headline carried money belonging to
    // no session `usage.totals.sessions` counted — which `CostPanel.tsx` then
    // divides one by the other.
    const snapshot = overview(seededWith(carrierOnlyFixture()));
    expect(snapshot.usage.totals.sessions).toBe(0);
    expect(snapshot.usage.cost.totalUsd).toBeNull();
    expect(snapshot.usage.cost.sessionsWithCost).toBe(0);
    // The window's ROWS still measured that money, so the trend legs are real.
    expect(snapshot.usage.cost.delta?.current).toBeGreaterThan(0);
    expect(
      snapshot.usage.dailyTrends.reduce((sum, day) => sum + (day.costUsd ?? 0), 0),
    ).toBeGreaterThan(0);
  });

  it("does not let a non-lifecycle event keep a session alive", () => {
    // `applyBatch` reduces only session.start / tool.call / session.end /
    // session.notification into session state, and says why for the kind that
    // makes it clearest: git.momentum "carries a session's originating id but is
    // a cumulative per-repo snapshot", so reducing it "would bump liveness off a
    // repo metric". This plane advanced `last_event_at` on every kind, so a
    // carrier re-shipped days after the session stopped put it back inside the
    // window AND read it `active` — the dead-session-shown-as-in-flight hole the
    // reaper exists to close.
    const dir = seededWith(carrierOnlyFixture());
    expect(buildLocalLive({ directory: dir, nowMs: FIXTURE_NOW }).live).toEqual([]);
    expect(overview(dir).usage.totals.sessions).toBe(0);
  });

  it("caps every codebase list where the worker caps it", () => {
    // The caps are what a surface RENDERS: `FilesPanel.tsx` draws the whole
    // array it is handed as a treemap on the stated grounds that then "every
    // touched file is on the map (no cap, no residue)", and `FilesInPlay.files`
    // names the cap in the contract ("Hottest-first, capped server-side;
    // `distinctFiles` is the uncapped count"). All five were 40 here against the
    // worker's 20 / 12 / 20 / 50 / 24, so the same events drew a different
    // picture on the two planes. These numbers are the worker's, and they are
    // the shipped contract; whether 12 directories is the right cap for either
    // plane is a product decision with its own justification to write.
    const snapshot = overview(
      seededWith([...localHistoryFixture(), ...liveFixture(), ...capFixture()]),
    );
    expect(snapshot.codebase.files).toHaveLength(20);
    expect(snapshot.codebase.directories).toHaveLength(12);
    expect(snapshot.codebase.rework).toHaveLength(20);
    expect(snapshot.codebase.filesInPlay!.files).toHaveLength(50);
    // The uncapped count is what keeps the truncation honest rather than silent.
    expect(snapshot.codebase.filesInPlay!.distinctFiles).toBe(52);
  });

  it("shows only the files a live session has touched IN THE WINDOW", () => {
    // Every other member of `CodebaseSnapshot` is window-scoped — the type says
    // so once for all of them ("honest-empty until IN-WINDOW rows carry the
    // signal") — and the worker reads this one off the same windowed file grain.
    // An unbounded scan of the session listed a file it last touched eight days
    // ago under a widget whose empty state reads "No files in play right now".
    const snapshot = overview(seededWith(liveFixture()));
    expect(snapshot.codebase.filesInPlay!.files.map((f) => f.fileId)).toEqual([
      FIXTURE_FILE_ONE,
    ]);
    expect(snapshot.codebase.filesInPlay!.distinctFiles).toBe(1);
  });
});

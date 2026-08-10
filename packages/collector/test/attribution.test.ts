/**
 * attribution.test.ts — the (COMMIT × FILE) attribution walk (HEAD-TO-HEAD Tier 2).
 *
 * The load-bearing claim under test: a git commit, which knows nothing about agents, can
 * be attributed to the agent whose work is in it, WITHOUT ever guessing.
 *
 * Concerns:
 *  (a) the three buckets are exhaustive and never invent a line: attributed + contested
 *      + unattributed === every committed added line.
 *  (b) the WINDOW is what makes it honest — an edit made after the commit belongs to the
 *      NEXT commit; an edit already carried by an earlier commit is never charged twice.
 *  (c) TWO AGENTS on one file is CONTESTED, never silently resolved. This is the case
 *      that does not exist yet in the corpus (2 codex sessions) and is the whole reason
 *      Tier 2 cannot lean on the shipped session-window attribution.
 *  (d) an UNKNOWN session fails CLOSED (unattributed), never defaulting to claude-code —
 *      the worker's `agentOfRow` reflex, which is how a second agent's work silently
 *      becomes the first agent's.
 *  (e) agent-level totals stay EXACT when two sessions of the SAME agent share a file.
 *  (f) rename paths resolve to the target (what blame reads at the tip).
 */
import { describe, expect, it } from "vitest";
import {
  type AttributionWalk,
  attributeCommits,
  groupBySession,
} from "../src/attribution.ts";
import { resolveNumstatPath } from "../src/git.ts";
import type { ObservedCommit } from "../src/git.ts";
import { type FileTouchLedger, agentsTouching, emptyLedger, pruneLedger } from "../src/ledger.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-07-01T00:00:00.000Z");

/** A fileId oracle that is just the path — the salted hash adds nothing to these tests
 *  and would only obscure them. The REAL recipe is exercised in file-id.test.ts. */
const fileIdOf = (absPath: string) => absPath;

function ledgerWith(
  agents: Record<string, string>,
  touches: Record<string, { sessionId: string; at: number }[]>,
): FileTouchLedger {
  const l = emptyLedger();
  l.agents = agents;
  l.touches = touches;
  return l;
}

function commit(sha: string, at: number, files: [string, number][]): ObservedCommit {
  return { sha, at, files: files.map(([path, added]) => ({ path, added })) };
}

function walk(commits: ObservedCommit[], ledger: FileTouchLedger, floor = 0): AttributionWalk {
  return attributeCommits(commits, {
    ledger,
    toplevel: "/repo",
    windowFloorMs: floor,
    fileIdOf,
    lastCommitAt: {},
  });
}

// ── (a) + (b) the buckets and the window ────────────────────────────────────

describe("attributeCommits — the three buckets are exhaustive", () => {
  it("attributes a file to the sole agent that touched it before the commit", () => {
    const ledger = ledgerWith(
      { s1: "claude-code" },
      { "/repo/a.ts": [{ sessionId: "s1", at: T0 + HOUR }] },
    );
    const w = walk([commit("c1", T0 + 2 * HOUR, [["a.ts", 40]])], ledger);

    expect(w.coverage.byAgent).toEqual({ "claude-code": 40 });
    expect(w.coverage.contested).toBe(0);
    expect(w.coverage.unattributed).toBe(0);
    expect(w.commits[0]!.files[0]!.verdict).toEqual({
      kind: "attributed",
      agent: "claude-code",
      sessionId: "s1",
    });
  });

  it("a file NO agent touched is UNATTRIBUTED (yours), never credited to anyone", () => {
    const w = walk([commit("c1", T0 + HOUR, [["hand-written.ts", 25]])], emptyLedger());
    expect(w.coverage.byAgent).toEqual({});
    expect(w.coverage.unattributed).toBe(25);
    expect(w.commits[0]!.files[0]!.verdict).toEqual({ kind: "unattributed" });
  });

  it("every committed added line lands in exactly ONE bucket (nothing invented or lost)", () => {
    const ledger = ledgerWith(
      { s1: "claude-code", s2: "codex" },
      {
        "/repo/solo.ts": [{ sessionId: "s1", at: T0 + HOUR }],
        "/repo/both.ts": [
          { sessionId: "s1", at: T0 + HOUR },
          { sessionId: "s2", at: T0 + 2 * HOUR },
        ],
      },
    );
    const w = walk(
      [commit("c1", T0 + 3 * HOUR, [["solo.ts", 10], ["both.ts", 20], ["mine.ts", 30]])],
      ledger,
    );
    const summed =
      Object.values(w.coverage.byAgent).reduce((a, b) => a + b, 0) +
      w.coverage.contested +
      w.coverage.unattributed;
    expect(summed).toBe(60); // 10 + 20 + 30, exactly the commit's added lines
  });

  it("WINDOW: an edit made AFTER the commit belongs to the NEXT commit, not this one", () => {
    const ledger = ledgerWith(
      { s1: "claude-code" },
      { "/repo/a.ts": [{ sessionId: "s1", at: T0 + 5 * HOUR }] }, // touched AFTER c1
    );
    const w = walk([commit("c1", T0 + 2 * HOUR, [["a.ts", 40]])], ledger);
    expect(w.coverage.unattributed).toBe(40);
    expect(w.coverage.byAgent).toEqual({});
  });

  it("WINDOW: an edit already carried by an EARLIER commit is not charged again", () => {
    const ledger = ledgerWith(
      { s1: "claude-code" },
      { "/repo/a.ts": [{ sessionId: "s1", at: T0 + HOUR }] },
    );
    // c1 (T0+2h) takes the touch. c2 (T0+9h) touches the same file with NO new edit —
    // the human committed a hand change. It must NOT re-charge s1.
    const w = walk(
      [commit("c1", T0 + 2 * HOUR, [["a.ts", 40]]), commit("c2", T0 + 9 * HOUR, [["a.ts", 15]])],
      ledger,
    );
    expect(w.coverage.byAgent).toEqual({ "claude-code": 40 }); // NOT 55
    expect(w.coverage.unattributed).toBe(15);
  });

  it("a 0-added file (pure deletion / pure rename) carries no denominator and is skipped", () => {
    const ledger = ledgerWith(
      { s1: "claude-code" },
      { "/repo/gone.ts": [{ sessionId: "s1", at: T0 + HOUR }] },
    );
    const w = walk([commit("c1", T0 + 2 * HOUR, [["gone.ts", 0]])], ledger);
    expect(w.commits).toHaveLength(0);
    expect(w.coverage.byAgent).toEqual({});
  });
});

// ── (c) two agents: the case Tier 2 exists for ──────────────────────────────

describe("attributeCommits — two agents on one file is CONTESTED, never guessed", () => {
  it("both agents edited it in the window → contested, credited to NEITHER", () => {
    const ledger = ledgerWith(
      { s1: "claude-code", s2: "codex" },
      {
        "/repo/shared.ts": [
          { sessionId: "s1", at: T0 + HOUR },
          { sessionId: "s2", at: T0 + 2 * HOUR },
        ],
      },
    );
    const w = walk([commit("c1", T0 + 3 * HOUR, [["shared.ts", 90]])], ledger);

    expect(w.coverage.contested).toBe(90);
    expect(w.coverage.byAgent).toEqual({});
    const verdict = w.commits[0]!.files[0]!.verdict;
    expect(verdict.kind).toBe('contested');
    if (verdict.kind === 'contested') {
      expect(verdict.agents).toEqual(['claude-code', 'codex']); // deterministic order
    }
    // The whole point: a contested file is COUNTED, so the surface can say so, rather
    // than being resolved by a coin flip that would look exactly like a real result.
  });

  it("two agents in the same COMMIT but on DIFFERENT files split cleanly", () => {
    const ledger = ledgerWith(
      { s1: "claude-code", s2: "codex" },
      {
        "/repo/a.ts": [{ sessionId: "s1", at: T0 + HOUR }],
        "/repo/b.ts": [{ sessionId: "s2", at: T0 + HOUR }],
      },
    );
    const w = walk([commit("c1", T0 + 2 * HOUR, [["a.ts", 10], ["b.ts", 7]])], ledger);
    expect(w.coverage.byAgent).toEqual({ "claude-code": 10, codex: 7 });
    expect(w.coverage.contested).toBe(0);
  });
});

// ── (d) fail-closed on an unknown session ──────────────────────────────────

describe("agentsTouching — an unknown session fails CLOSED, never to claude-code", () => {
  it("a touch whose session.start was never seen is DROPPED, not defaulted", () => {
    // `agents` deliberately has no entry for s-ghost.
    const ledger = ledgerWith({}, { f: [{ sessionId: "s-ghost", at: T0 + HOUR }] });
    expect(agentsTouching(ledger, "f", 0, T0 + 2 * HOUR)).toEqual([]);
  });

  it("so the commit reads UNATTRIBUTED — the honest bucket, not a fabricated Claude line", () => {
    const ledger = ledgerWith({}, { "/repo/a.ts": [{ sessionId: "s-ghost", at: T0 + HOUR }] });
    const w = walk([commit("c1", T0 + 2 * HOUR, [["a.ts", 50]])], ledger);
    expect(w.coverage.byAgent["claude-code"]).toBeUndefined();
    expect(w.coverage.unattributed).toBe(50);
  });
});

// ── (e) same-agent sessions: agent totals stay EXACT ────────────────────────

describe("groupBySession — agent totals exact; only the per-session split approximates", () => {
  it("two sessions of ONE agent on one file: last toucher takes it, agent total is exact", () => {
    const ledger = ledgerWith(
      { s1: "claude-code", s2: "claude-code" },
      {
        "/repo/a.ts": [
          { sessionId: "s1", at: T0 + HOUR },
          { sessionId: "s2", at: T0 + 2 * HOUR }, // the LAST toucher before the commit
        ],
      },
    );
    const w = walk([commit("c1", T0 + 3 * HOUR, [["a.ts", 100]])], ledger);

    // Agent level (what Tier 2 reports): counted ONCE, exactly.
    expect(w.coverage.byAgent).toEqual({ "claude-code": 100 });
    expect(w.coverage.contested).toBe(0); // ONE agent, so not contested

    // Session level: the last toucher takes the file. Documented approximation.
    const sessions = groupBySession(w);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionId).toBe("s2");
    expect(sessions[0]!.linesAuthored).toBe(100);
  });

  it("groups a session's (commit, file) pairs and starts its clock at the NEWEST commit", () => {
    const ledger = ledgerWith(
      { s1: "claude-code" },
      {
        "/repo/a.ts": [{ sessionId: "s1", at: T0 + HOUR }],
        "/repo/b.ts": [{ sessionId: "s1", at: T0 + HOUR }],
      },
    );
    const w = walk(
      [
        commit("c1", T0 + 2 * HOUR, [["a.ts", 10]]),
        commit("c2", T0 + 4 * HOUR, [["b.ts", 20]]),
      ],
      ledger,
    );
    const s = groupBySession(w)[0]!;
    expect(s.commits.map((c) => c.sha)).toEqual(["c1", "c2"]);
    expect(s.linesAuthored).toBe(30);
    // ADR-H3: the maturation clock starts when work LANDED, not when a chat ended.
    expect(s.lastCommitAt).toBe(T0 + 4 * HOUR);
  });

  it("drops contested + unattributed files — they belong to no session", () => {
    const ledger = ledgerWith(
      { s1: "claude-code", s2: "codex" },
      {
        "/repo/shared.ts": [
          { sessionId: "s1", at: T0 + HOUR },
          { sessionId: "s2", at: T0 + HOUR },
        ],
      },
    );
    const w = walk([commit("c1", T0 + 2 * HOUR, [["shared.ts", 50], ["mine.ts", 5]])], ledger);
    expect(groupBySession(w)).toEqual([]); // nothing is owed to anybody
    expect(w.coverage.contested).toBe(50); // ...but it is still COUNTED
    expect(w.coverage.unattributed).toBe(5);
  });

  it("each SessionCommit carries the COMMIT's totals, not just the session's share", () => {
    // One commit, three fates in it: s1's file, a contested file, and a hand-written one.
    // A session's own `authored` count says nothing about how much of that commit anybody
    // could account for — the surface needs `added` and `contested` to say so honestly, and
    // they must be the COMMIT's, identical for every session in it, so a worker union over
    // commit ids counts them exactly once.
    const ledger = ledgerWith(
      { s1: "claude-code", s2: "codex" },
      {
        "/repo/mine.ts": [{ sessionId: "s1", at: T0 + HOUR }],
        "/repo/shared.ts": [
          { sessionId: "s1", at: T0 + HOUR },
          { sessionId: "s2", at: T0 + HOUR },
        ],
      },
    );
    const w = walk(
      [commit("c1", T0 + 2 * HOUR, [["mine.ts", 10], ["shared.ts", 50], ["hand.ts", 5]])],
      ledger,
    );
    const s = groupBySession(w).find((x) => x.sessionId === "s1")!;
    expect(s.commits).toHaveLength(1);
    expect(s.commits[0]).toMatchObject({ sha: "c1", added: 65, contested: 50 });
    expect(s.commits[0]!.files).toEqual([{ path: "mine.ts", added: 10 }]);
    expect(s.linesAuthored).toBe(10);
    // The invariant the emit validator pins: a commit's split cannot oversubscribe itself.
    expect(s.commits[0]!.contested + 10).toBeLessThanOrEqual(s.commits[0]!.added);
  });
});

// ── the cold-start floor ────────────────────────────────────────────────────

describe("windowFloorMs — a cold start cannot reach back past the ledger horizon", () => {
  it("a touch older than the floor is excluded when the file's previous commit is unknown", () => {
    const ledger = ledgerWith(
      { s1: "claude-code" },
      { "/repo/a.ts": [{ sessionId: "s1", at: T0 - 60 * DAY }] }, // ancient, already committed
    );
    const floor = T0 - 30 * DAY;
    const w = walk([commit("c1", T0, [["a.ts", 40]])], ledger, floor);
    // Conservative by design: an unknown previous commit must not let an already-landed
    // touch be charged to a commit it had nothing to do with.
    expect(w.coverage.unattributed).toBe(40);
    expect(w.coverage.byAgent).toEqual({});
  });
});

// ── (f) rename path resolution ──────────────────────────────────────────────

describe("resolveNumstatPath — a rename resolves to the TARGET (what blame reads at the tip)", () => {
  it.each([
    ["src/{old => new}.ts", "src/new.ts"],
    ["packages/{web => worker}/x.ts", "packages/worker/x.ts"],
    ["src/{foo/ => }bar.ts", "src/bar.ts"],
    ["{a => b}", "b"],
    ["old.ts => new.ts", "new.ts"],
    ["src/plain.ts", "src/plain.ts"],
  ])("%s → %s", (raw, expected) => {
    expect(resolveNumstatPath(raw)).toBe(expected);
  });
});

// ── ledger retention ────────────────────────────────────────────────────────

describe("pruneLedger — bounded by construction", () => {
  it("drops touches past the horizon, then the files and sessions left empty", () => {
    const l = ledgerWith(
      { old: "claude-code", fresh: "codex" },
      {
        stale: [{ sessionId: "old", at: T0 - 100 * DAY }],
        live: [{ sessionId: "fresh", at: T0 - 1 * DAY }],
      },
    );
    pruneLedger(l, T0, 90);
    expect(l.touches.stale).toBeUndefined();
    expect(l.touches.live).toHaveLength(1);
    expect(l.agents.old).toBeUndefined(); // no touches left → the session goes too
    expect(l.agents.fresh).toBe("codex");
  });
});

/**
 * survival.test.ts — the git-attributed LINE-survival emitter (HEAD-TO-HEAD, Tier 2).
 *
 * Every test here runs the REAL chain against a REAL temp git repo: a file-touch ledger
 * says which session edited which file when, the commit walk attributes each (commit ×
 * file) to whichever agent touched it, the record is written, and a matured sweep blames
 * it and emits. Nothing is stubbed, because the two things that can go wrong — crediting a
 * session for lines it did not write, and losing lines it did — are both invisible in a
 * mock.
 *
 * Concerns:
 *  (a) End to end: a touch plus a commit produces ONE counts-only session.linesurvival
 *      for the session that earned it, with salted commit ids and the coverage counts.
 *  (b) The fate matrix — retained / overwritten (a REVERT, which is-ancestor cannot see) /
 *      unreachable — proven against real git.
 *  (c) ADR-H0: a merged-and-deleted branch is a LOOKUP STEP, not a fate.
 *  (d) PER-FILE blame: a session credited with (C1, a.ts) and (C2, b.ts) must NOT be
 *      credited for lines that C2 wrote into a.ts. Blaming a flat sha set would.
 *  (e) The record OUTLIVES its emit (ADR-H10): an unchanged sha set never re-blames, and a
 *      LATE commit re-emits the UNION rather than a thin replacement.
 *  (f) Content-safety: a hostile branch / author / email / message / line never escapes.
 *
 * fs-sandboxed: SEORAK_DIR + the test repo live under a fresh temp dir per test.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentId } from "@seorak/types";
import { attributeCommits, groupBySession } from "../src/attribution.ts";
import { resetCaptureSettingsCache } from "../src/capture-settings.ts";
import { assertEmitSafe } from "../src/emit.ts";
import { fileIdentityForPath } from "../src/file-id.ts";
import { commitsSince, currentBranch } from "../src/git.ts";
import { emptyLedger } from "../src/ledger.ts";
import { captureSettingsPath, survivalPendingDir, survivalPendingPath } from "../src/paths.ts";
import {
  type SweptLineSurvival,
  markPendingEmitted,
  pendingFromAttribution,
  recordAttributionPending,
  saltedCommitId,
  survivalEventId,
  sweepAttributedSurvival,
} from "../src/survival.ts";

/** A 64-hex stand-in for the salted repoId. Content-free by derivation; the sweep passes
 *  it straight through, so its exact value is irrelevant to everything under test. */
const REPO_ID = "f".repeat(64);

/** Every commit gets an EXPLICIT author date. Without one, a temp repo's commits all land
 *  in the same second, the attribution window `(previous commit, this commit]` collapses to
 *  empty, and nothing can ever be attributed — the tests would pass vacuously. */
const BASE = "2026-06-01T00:00:00Z";
const FLOOR = Date.parse("2026-05-01T00:00:00Z");

let dir: string;
let repo: string;
let savedDir: string | undefined;
let savedAge: string | undefined;

function g(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

/** Append `lines` lines to `file` and commit them AT `iso`. Content is irrelevant — only
 *  counts are ever emitted — but the DATE is load-bearing (see BASE above). */
function commitAt(file: string, lines: number, iso: string, message = "c"): string {
  const body = Array.from({ length: lines }, (_, i) => `${file} ${message} ${i}`).join("\n");
  writeFileSync(join(repo, file), `${body}\n`, { flag: "a" });
  return commitTreeAt(iso, message);
}

/** Commit whatever is in the working tree AT `iso`. */
function commitTreeAt(iso: string, message = "c"): string {
  g(["add", "-A"]);
  execFileSync("git", ["commit", "-m", message], {
    cwd: repo,
    stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
  });
  return g(["rev-parse", "HEAD"]);
}

/** REPLACE a file's whole content (so the old lines are genuinely deleted) and commit. */
function rewriteAt(file: string, lines: number, iso: string, message = "rewrite"): string {
  const body = Array.from({ length: lines }, (_, i) => `${file} ${message} ${i}`).join("\n");
  writeFileSync(join(repo, file), `${body}\n`);
  return commitTreeAt(iso, message);
}

interface Touch {
  sessionId: string;
  agent?: AgentId;
  file: string;
  /** When the agent EDITED the file, which must fall inside `(previous commit, commit]`. */
  at: string;
}

/**
 * The daemon's real chain, minus the daemon: fold a ledger from `touches`, walk every
 * commit in the repo, attribute each (commit × file), and record what each session is owed.
 * Returns the credited session ids so a test can assert on the attribution itself.
 */
function attributeAndRecord(touches: Touch[], branch?: string | null): string[] {
  const ledger = emptyLedger();
  for (const t of touches) {
    ledger.agents[t.sessionId] = t.agent ?? "claude-code";
    const fileId = fileIdentityForPath(join(repo, t.file), false).fileId;
    const list = ledger.touches[fileId] ?? [];
    list.push({ sessionId: t.sessionId, at: Date.parse(t.at) });
    list.sort((a, b) => a.at - b.at);
    ledger.touches[fileId] = list;
  }

  const commits = commitsSince(repo, null, "HEAD", [], 3650);
  if (commits === null) throw new Error("git could not be consulted");
  const walk = attributeCommits(commits, {
    ledger,
    toplevel: repo,
    windowFloorMs: FLOOR,
    fileIdOf: (abs) => fileIdentityForPath(abs, false).fileId,
  });

  const sessions = groupBySession(walk);
  const repoInfo = {
    repoId: REPO_ID,
    repoLabel: "repo",
    toplevel: repo,
    branch: branch === undefined ? currentBranch(repo) : branch,
  };
  for (const session of sessions) {
    recordAttributionPending(pendingFromAttribution(repoInfo, session));
  }
  return sessions.map((s) => s.sessionId);
}

/** Sweep as of `iso` (default: 5 days past the usual commit dates, so records mature). */
function sweep(iso = "2026-06-12T00:00:00.000Z"): SweptLineSurvival[] {
  return sweepAttributedSurvival(iso);
}

/** The one swept event for `sessionId` (the walk may credit several sessions at once). */
function eventFor(swept: SweptLineSurvival[], sessionId: string): SweptLineSurvival {
  const hit = swept.find((s) => s.event.sessionId === sessionId);
  if (!hit) throw new Error(`no swept event for ${sessionId}`);
  return hit;
}

/** Flip the on-machine repoLabels opt-in for a test (default-OFF otherwise). */
function setRepoLabels(on: boolean): void {
  writeFileSync(captureSettingsPath(), JSON.stringify({ repoLabels: on }), "utf8");
  resetCaptureSettingsCache();
}

beforeEach(() => {
  savedDir = process.env.SEORAK_DIR;
  savedAge = process.env.SEORAK_SURVIVAL_AGE_DAYS;
  dir = mkdtempSync(join(tmpdir(), "seorak-survival-"));
  process.env.SEORAK_DIR = dir;
  process.env.SEORAK_SURVIVAL_AGE_DAYS = "3";
  resetCaptureSettingsCache(); // clean default settings (repoLabels OFF)
  repo = join(dir, "repo");
  execFileSync("mkdir", ["-p", repo]);
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.email", "t@t.t"]);
  g(["config", "user.name", "t"]);
  g(["config", "commit.gpgsign", "false"]);
  commitAt("a.txt", 1, BASE, "base"); // a base commit, so every file has a previous one
});

afterEach(() => {
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
  if (savedAge === undefined) delete process.env.SEORAK_SURVIVAL_AGE_DAYS;
  else process.env.SEORAK_SURVIVAL_AGE_DAYS = savedAge;
  resetCaptureSettingsCache();
  rmSync(dir, { recursive: true, force: true });
});

// ── (a) end to end ──────────────────────────────────────────────────────────

describe("attributed survival, end to end", () => {
  it("a touch plus a commit yields ONE counts-only event for the session that earned it", () => {
    commitAt("a.txt", 4, "2026-06-05T00:00:00Z");
    const credited = attributeAndRecord([
      { sessionId: "sess-1", file: "a.txt", at: "2026-06-03T00:00:00Z" },
    ]);
    expect(credited).toEqual(["sess-1"]);

    const swept = sweep();
    expect(swept).toHaveLength(1);
    const e = swept[0]!.event;
    expect(e.kind).toBe("session.linesurvival");
    expect(e.sessionId).toBe("sess-1");
    expect(e.rung).toBe("3d");
    expect(e.fate).toBe("retained");
    expect(e.commitsChecked).toBe(1);
    expect(e.linesAuthored).toBe(4);
    expect(e.linesSurviving).toBe(4);
    expect(e.linesSurviving).toBeLessThanOrEqual(e.linesAuthored);
    expect(e.filesGoneFromTip).toBe(0);

    // The commit ledger rides along SALTED, and carries the coverage denominator: the
    // commit added 4 lines, all 4 attributed to this session, none contested.
    expect(e.commits).toEqual([
      { id: saltedCommitId(g(["rev-parse", "HEAD"])), added: 4, contested: 0, authored: 4 },
    ]);

    // Counts-only, allowlist-clean: no sha, path, branch or toplevel on the wire.
    expect(() => assertEmitSafe(e)).not.toThrow();
    const wire = JSON.stringify(e);
    expect(wire.includes(repo)).toBe(false);
    expect(wire.includes(g(["rev-parse", "HEAD"]))).toBe(false);
    expect(wire.includes("a.txt")).toBe(false);
    expect(wire.includes("toplevel")).toBe(false);
    expect(e.repoLabel).toBeUndefined(); // repoLabels opt-in is OFF by default
  });

  it("the maturation clock runs from the COMMIT, so a session with no end still grades", () => {
    // No session.end anywhere in this test. Codex sessions never have one, and that is
    // exactly the coupling ADR-H3 breaks.
    commitAt("a.txt", 2, "2026-06-05T00:00:00Z");
    attributeAndRecord([
      { sessionId: "codex-sess", agent: "codex", file: "a.txt", at: "2026-06-03T00:00:00Z" },
    ]);

    expect(sweep("2026-06-06T00:00:00.000Z")).toHaveLength(0); // 1 day past the commit
    const swept = sweep("2026-06-09T00:00:00.000Z"); // 4 days past the commit
    expect(swept).toHaveLength(1);
    expect(swept[0]!.event.sessionId).toBe("codex-sess");
    expect(swept[0]!.event.fate).toBe("retained");
  });

  it("a commit NO agent touched credits nobody (honest-empty, never a default owner)", () => {
    commitAt("hand-written.txt", 9, "2026-06-05T00:00:00Z");
    expect(attributeAndRecord([])).toEqual([]);
    expect(sweep()).toHaveLength(0);
    expect(existsSync(survivalPendingDir())).toBe(false);
  });

  it("an empty survival dir sweeps to no events (honest-empty)", () => {
    expect(readdirSync(dir)).not.toContain("survival");
    expect(sweep()).toHaveLength(0);
  });

  it("leaves a NOT-YET-MATURED record alone and emits nothing", () => {
    commitAt("a.txt", 2, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "young", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);

    expect(sweep("2026-06-06T00:00:00.000Z")).toHaveLength(0);
    expect(existsSync(survivalPendingPath("young"))).toBe(true);
  });
});

// ── (b) the fate matrix ─────────────────────────────────────────────────────

describe("fate matrix (real git)", () => {
  it("OVERWRITTEN: a git revert is caught (is-ancestor's blind spot)", () => {
    commitAt("a.txt", 3, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "revert-sess", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);

    // The session's commit stays an ANCESTOR of HEAD after a revert — a reachability
    // check would score it SURVIVED — but every line it authored is gone.
    g(["revert", "--no-edit", "HEAD"]);

    const e = eventFor(sweep(), "revert-sess").event;
    expect(e.fate).toBe("overwritten");
    expect(e.linesAuthored).toBe(3);
    expect(e.linesSurviving).toBe(0);
  });

  it("UNREACHABLE: a reset past the work → excluded, never graded as death", () => {
    commitAt("a.txt", 3, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "reset-sess", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);

    g(["reset", "--hard", "HEAD~1"]);

    const e = eventFor(sweep(), "reset-sess").event;
    expect(e.fate).toBe("unreachable");
    expect(e.linesSurviving).toBe(0);
  });

  it("a DELETED file counts 0 surviving and is disclosed as filesGoneFromTip", () => {
    commitAt("gone.txt", 5, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "del-sess", file: "gone.txt", at: "2026-06-03T00:00:00Z" }]);

    g(["rm", "-q", "gone.txt"]);
    commitTreeAt("2026-06-06T00:00:00Z", "drop it");

    const e = eventFor(sweep(), "del-sess").event;
    expect(e.linesAuthored).toBe(5);
    expect(e.linesSurviving).toBe(0);
    expect(e.fate).toBe("overwritten");
    // The bias is SURFACED, not hidden: a deleted path reads the same as a moved one, and
    // a move would be an under-count.
    expect(e.filesGoneFromTip).toBe(1);
  });
});

// ── (c) ADR-H0: a gone branch is a lookup step, not a fate ──────────────────
//
// Measured on the buyer's machine 2026-07-12: survival blamed the session's remembered
// branch, and the workflow is branch → merge → DELETE the branch. 61 sessions, 113,950
// authored lines and 407 landed commits read `unknown` for work that was alive on main the
// whole time. A merged-and-deleted branch is the NORMAL end state of healthy work.

describe("ADR-H0 — a merged-and-deleted branch is a lookup step", () => {
  it("MERGED THEN DELETED: work survives on main → retained (was: unknown)", () => {
    g(["checkout", "-q", "-b", "feat/x"]);
    commitAt("a.txt", 4, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "merged", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);

    g(["checkout", "-q", "main"]);
    g(["merge", "--no-ff", "--no-edit", "-q", "feat/x"]);
    g(["branch", "-D", "feat/x"]);

    const e = eventFor(sweep(), "merged").event;
    expect(e.fate).toBe("retained"); // the recorded branch is GONE; the lines are not
    expect(e.linesSurviving).toBe(4);
  });

  it("PRECEDENCE: a still-live recorded branch wins, even when main lacks the work", () => {
    g(["checkout", "-q", "-b", "feat/y"]);
    commitAt("a.txt", 4, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "live-branch", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);
    // feat/y is never merged: main holds not one of these commits. Falling straight to the
    // default branch would misreport live work as `unreachable`.

    const e = eventFor(sweep(), "live-branch").event;
    expect(e.fate).toBe("retained");
    expect(e.linesSurviving).toBe(4);
  });

  it("DETACHED start: no branch recorded, but the work lands on main → retained", () => {
    g(["checkout", "-q", "--detach"]);
    commitAt("a.txt", 2, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "detached", file: "a.txt", at: "2026-06-03T00:00:00Z" }], null);
    g(["checkout", "-q", "-B", "main", "HEAD"]);

    const e = eventFor(sweep(), "detached").event;
    expect(e.fate).toBe("retained"); // a null branch used to short-circuit to `unknown`
    expect(e.linesSurviving).toBe(2);
  });

  it("GENUINELY REWRITTEN: squash-merged then deleted → unreachable, not retained", () => {
    g(["checkout", "-q", "-b", "feat/z"]);
    commitAt("a.txt", 3, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "squashed", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);

    g(["checkout", "-q", "main"]);
    g(["merge", "--squash", "feat/z"]);
    commitTreeAt("2026-06-06T00:00:00Z", "squashed");
    g(["branch", "-D", "feat/z"]);

    // The lines live on main, but under a NEW commit. We cannot trace them, so they are
    // EXCLUDED — never credited, never graded as death.
    const e = eventFor(sweep(), "squashed").event;
    expect(e.fate).toBe("unreachable");
    expect(e.linesSurviving).toBe(0);
  });
});

// ── (d) per-file blame ──────────────────────────────────────────────────────

describe("PER-FILE blame — a session is not credited for the other agent's lines", () => {
  it("blames each file against the commit it was attributed for, not the session's sha set", () => {
    // b.txt needs a previous commit before the window opens on it.
    commitAt("b.txt", 1, BASE, "base-b");

    // C1: 3 lines into a.txt, attributed to S (S touched a.txt on the 3rd).
    commitAt("a.txt", 3, "2026-06-05T00:00:00Z", "c1");
    // C2: a.txt REWRITTEN (S's 3 lines deleted, 7 new ones added) and 5 lines into b.txt.
    // a.txt in C2 belongs to T, who touched it on the 7th. b.txt belongs to S.
    rewriteAt("a.txt", 7, "2026-06-09T00:00:00Z", "c2a");
    writeFileSync(join(repo, "b.txt"), `${Array.from({ length: 5 }, (_, i) => `b ${i}`).join("\n")}\n`, {
      flag: "a",
    });
    commitTreeAt("2026-06-09T00:00:00Z", "c2");

    attributeAndRecord([
      { sessionId: "S", file: "a.txt", at: "2026-06-03T00:00:00Z" },
      { sessionId: "T", file: "a.txt", at: "2026-06-07T00:00:00Z" },
      { sessionId: "S", file: "b.txt", at: "2026-06-07T00:00:00Z" },
    ]);

    const e = eventFor(sweep("2026-06-13T00:00:00.000Z"), "S").event;
    // S authored 3 (a.txt in C1) + 5 (b.txt in C2) = 8.
    expect(e.linesAuthored).toBe(8);
    // Its a.txt lines were REWRITTEN away, so only the 5 b.txt lines survive.
    //
    // This is the number that exposes the bug. Blaming a FLAT set of S's shas {C1, C2}
    // would find a.txt's 7 lines (written by T under C2, which S is in the set for) and
    // report 8 of 8 — S's dead work reading as fully retained, and the inflation invisible
    // because the clamp to linesAuthored hides it.
    expect(e.linesSurviving).toBe(5);
    expect(e.fate).toBe("retained");
  });
});

// ── (e) the record outlives its emit (ADR-H10) ──────────────────────────────

describe("ADR-H10 — the record outlives its emit", () => {
  it("an UNCHANGED sha set never re-blames: a second sweep emits nothing", () => {
    commitAt("a.txt", 2, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "once", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);

    const first = sweep();
    expect(first).toHaveLength(1);
    markPendingEmitted(first[0]!.pendingPath, first[0]!.event.eventId);

    // The answer cannot have changed, so no git work is done and nothing is emitted.
    expect(sweep("2026-06-20T00:00:00.000Z")).toHaveLength(0);
    // ...and the record is still there, ready for a late commit to merge into.
    expect(existsSync(survivalPendingPath("once"))).toBe(true);
  });

  it("a LATE commit re-emits the UNION, not a thin replacement", () => {
    commitAt("a.txt", 2, "2026-06-05T00:00:00Z");
    attributeAndRecord([
      { sessionId: "late", file: "a.txt", at: "2026-06-03T00:00:00Z" },
      { sessionId: "late", file: "b.txt", at: "2026-06-03T00:00:00Z" }, // touched, not yet committed
    ]);

    const first = sweep();
    expect(first).toHaveLength(1);
    expect(first[0]!.event.linesAuthored).toBe(2);
    markPendingEmitted(first[0]!.pendingPath, first[0]!.event.eventId);

    // Days later, the file this session touched finally gets committed. The walk credits it
    // to the same session, and it merges into the SAME record.
    commitAt("b.txt", 6, "2026-06-13T00:00:00Z");
    attributeAndRecord([
      { sessionId: "late", file: "a.txt", at: "2026-06-03T00:00:00Z" },
      { sessionId: "late", file: "b.txt", at: "2026-06-03T00:00:00Z" },
    ]);

    const second = sweep("2026-06-20T00:00:00.000Z");
    expect(second).toHaveLength(1);
    const e = second[0]!.event;

    // The sha set GREW, so the eventId is new — which is what lets the row land at all
    // (D1 is INSERT OR IGNORE) and lets latest-wins pick it.
    expect(e.eventId).not.toBe(first[0]!.event.eventId);
    // And it carries BOTH commits. Pruning the record on emit would have made this a fresh
    // record holding only the late commit — 6 lines, not 8 — and latest-wins would have let
    // that thin row REPLACE the full one, silently losing the session's earlier work.
    expect(e.commitsChecked).toBe(2);
    expect(e.linesAuthored).toBe(8);
    expect(e.linesSurviving).toBe(8);
  });

  it("PRUNES a record whose newest commit is past the ledger horizon", () => {
    commitAt("a.txt", 2, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "ancient", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);

    // Past the horizon its touches are gone from the ledger, so its set can never grow
    // again and there is nothing left to say about it.
    expect(sweep("2026-11-01T00:00:00.000Z")).toHaveLength(0);
    expect(existsSync(survivalPendingPath("ancient"))).toBe(false);
  });

  it("the eventId keys on the sha SET: order-free, but set-sensitive", () => {
    expect(survivalEventId("s", ["b", "a"])).toBe(survivalEventId("s", ["a", "b"]));
    expect(survivalEventId("s", ["a", "b"])).not.toBe(survivalEventId("s", ["a"]));
    expect(survivalEventId("s", ["a"])).not.toBe(survivalEventId("t", ["a"]));
  });
});

// ── (f) content-safety ──────────────────────────────────────────────────────

describe("content-safety — the blame walk never leaks content", () => {
  it("a hostile branch / author / email / message / line never escapes the event", () => {
    const HOSTILE_BRANCH = "fix/acme-corp-billing-leak";
    const HOSTILE_EMAIL = "ceo@acme-secret.example";
    const HOSTILE_MSG = "patch the undisclosed-breach token rotation";
    const HOSTILE_LINE = "const API_SECRET = 'sk-live-do-not-ship';";

    g(["checkout", "-q", "-b", HOSTILE_BRANCH]);
    g(["config", "user.email", HOSTILE_EMAIL]);
    g(["config", "user.name", "Confidential Person"]);
    writeFileSync(join(repo, "a.txt"), `${HOSTILE_LINE}\n`, { flag: "a" });
    commitTreeAt("2026-06-05T00:00:00Z", HOSTILE_MSG);

    attributeAndRecord([{ sessionId: "leak", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);

    const swept = sweep();
    const e = eventFor(swept, "leak").event;
    expect(() => assertEmitSafe(e)).not.toThrow();

    const wire = JSON.stringify(e);
    for (const secret of [HOSTILE_BRANCH, HOSTILE_EMAIL, HOSTILE_MSG, HOSTILE_LINE, "API_SECRET"]) {
      expect(wire.includes(secret), `event leaked "${secret}"`).toBe(false);
    }
    // The resolved ref is a git detail; it must not ride out either.
    expect(wire.includes("refs/heads")).toBe(false);
    // It still produced a real, content-free stat.
    expect(e.fate).toBe("retained");
    expect(e.linesSurviving).toBe(1);
  });

  it("a raw sha never ships: commits[].id is the SALTED id, and only that", () => {
    const sha = commitAt("a.txt", 2, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "salted", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);

    const e = eventFor(sweep(), "salted").event;
    expect(e.commits![0]!.id).toBe(saltedCommitId(sha));
    expect(e.commits![0]!.id).toMatch(/^[0-9a-f]{64}$/); // a 40-hex sha would fail this
    expect(JSON.stringify(e).includes(sha)).toBe(false);
  });

  it("even with the repoLabels opt-in ON, only the BASENAME ships", () => {
    setRepoLabels(true);
    const HOSTILE_BRANCH = "fix/acme-corp-billing-leak";
    g(["checkout", "-q", "-b", HOSTILE_BRANCH]);
    commitAt("a.txt", 2, "2026-06-05T00:00:00Z");
    attributeAndRecord([{ sessionId: "label-on", file: "a.txt", at: "2026-06-03T00:00:00Z" }]);

    const e = eventFor(sweep(), "label-on").event;
    expect(() => assertEmitSafe(e)).not.toThrow();
    expect(e.repoLabel).toBe("repo"); // basename(toplevel), never the absolute path
    const wire = JSON.stringify(e);
    expect(wire.includes(repo)).toBe(false);
    expect(wire.includes(HOSTILE_BRANCH)).toBe(false);
  });
});

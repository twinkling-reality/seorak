/**
 * attribution.ts — the (COMMIT × FILE) attribution walk (HEAD-TO-HEAD ADR-H1).
 *
 * The unit of attribution is one file's added lines inside one commit. For each file
 * `f` in commit `C`, the agents that edited `fileId(f)` between f's PREVIOUS commit and
 * C are looked up in the file-touch ledger, and:
 *
 *   exactly one agent  → ATTRIBUTED    (its lines enter that agent's survival legs)
 *   two or more        → CONTESTED     (excluded from every agent; COUNTED and shown)
 *   none               → UNATTRIBUTED  (yours: a hand edit, a script, or capture was off)
 *
 * WHY THE FILE, AND NOT THE SESSION OR THE LINE:
 *
 *   The SESSION window is what shipped, and it is only correct while exactly one agent
 *   exists. It attributes EVERY commit landed between a session's start and end to that
 *   session — including files the human wrote by hand and files the other agent wrote.
 *   Tier 2 exists to break the one-agent assumption, so it cannot stand on it.
 *
 *   The LINE would be strictly more honest in principle, and is rejected on evidence:
 *   maintaining per-line provenance means observing EVERY mutation of a file, and we
 *   observe none of the hand edits, `git checkout`s, or script writes that measured out
 *   at ~55% of committed lines on this machine. Its failure mode is SILENT OVER-COUNTING.
 *   The file's failure mode is a countable exclusion. Given the choice, fail loudly.
 *
 * The three buckets are the honesty contract. `attributed` is never allowed to imply
 * `total`: a surface that renders an agent's line count without also rendering what it
 * could not attribute is claiming a completeness the capture does not have.
 *
 * PURE + I/O-free: `fileIdOf` is injected so the walk is testable without a salt, a
 * repo, or a filesystem.
 */
import type { AgentId } from "@seorak/types";
import type { ObservedCommit } from "./git.ts";
import { type FileTouchLedger, agentsTouching } from "./ledger.ts";

export type FileVerdict =
  | { kind: "attributed"; agent: AgentId; sessionId: string }
  | { kind: "contested"; agents: AgentId[] }
  | { kind: "unattributed" };

/** One attributed file inside one commit. `path` and `sha` are LOCAL ONLY. */
export interface AttributedFile {
  path: string;
  added: number;
  verdict: FileVerdict;
}

export interface AttributedCommit {
  sha: string;
  at: number;
  files: AttributedFile[];
}

/** The window-level coverage split. Every committed added line lands in exactly one of
 *  these three, so `attributed + contested + unattributed` is the whole denominator and
 *  no line is invented or lost. */
export interface CoverageTotals {
  /** agent → added lines attributed solely to it. Keyed on `string`, not `AgentId`:
   *  the agent union is OPEN (a third tool must not need a type change here), and a
   *  Record over an open union would demand the known literals as required keys. */
  byAgent: Record<string, number>;
  /** Added lines in files two or more agents edited in the same window. */
  contested: number;
  /** Added lines in files NO tracked agent edited: your own hand edits, script- or
   *  Bash-written files, and anything committed while capture was off. */
  unattributed: number;
}

/**
 * The per-file state the walk carries BETWEEN ticks: each file's most recent observed
 * commit time. It bounds the touch window, and it must persist, because commit N and
 * commit N+1 for one file are routinely observed on different daemon ticks.
 */
export type LastCommitAt = Record<string, number>;

export interface AttributionWalk {
  commits: AttributedCommit[];
  coverage: CoverageTotals;
  /** The updated per-file commit times, for the caller to persist. */
  lastCommitAt: LastCommitAt;
}

/**
 * attributeCommits(commits, opts) — walk commits OLDEST FIRST, attributing each file.
 *
 * `windowFloorMs` is the walk's lower time boundary (the cursor commit's time, or the
 * cold-start backfill horizon). A file whose previous commit is unknown — because it
 * predates everything we have walked — uses the floor rather than 0. That is what stops
 * a cold start from reaching back and charging an agent for a touch that had ALREADY
 * been committed before the window opened.
 *
 * Oldest-first is required, not stylistic: each commit updates `lastCommitAt`, which is
 * the very bound the NEXT commit to that file uses.
 */
export function attributeCommits(
  commits: ObservedCommit[],
  opts: {
    ledger: FileTouchLedger;
    toplevel: string;
    windowFloorMs: number;
    fileIdOf: (absPath: string) => string;
    lastCommitAt?: LastCommitAt;
  },
): AttributionWalk {
  const lastCommitAt: LastCommitAt = { ...(opts.lastCommitAt ?? {}) };
  const coverage: CoverageTotals = { byAgent: {}, contested: 0, unattributed: 0 };
  const out: AttributedCommit[] = [];

  for (const commit of commits) {
    const files: AttributedFile[] = [];

    for (const file of commit.files) {
      if (file.added <= 0) continue; // no denominator, nothing to attribute

      // The file's PREVIOUS commit bounds the window below. Unknown → the walk floor,
      // never 0: an unbounded window would reach past the previous commit and charge an
      // agent twice for work that already landed.
      const previous = Math.max(lastCommitAt[file.path] ?? 0, opts.windowFloorMs);
      lastCommitAt[file.path] = commit.at;

      const claims = agentsTouching(
        opts.ledger,
        opts.fileIdOf(`${opts.toplevel}/${file.path}`),
        previous,
        commit.at,
      );

      let verdict: FileVerdict;
      if (claims.length === 0) {
        verdict = { kind: "unattributed" };
        coverage.unattributed += file.added;
      } else if (claims.length > 1) {
        verdict = { kind: "contested", agents: claims.map((c) => c.agent) };
        coverage.contested += file.added;
      } else {
        const claim = claims[0]!;
        verdict = { kind: "attributed", agent: claim.agent, sessionId: claim.sessionId };
        coverage.byAgent[claim.agent] = (coverage.byAgent[claim.agent] ?? 0) + file.added;
      }
      files.push({ path: file.path, added: file.added, verdict });
    }

    if (files.length > 0) out.push({ sha: commit.sha, at: commit.at, files });
  }

  return { commits: out, coverage, lastCommitAt };
}

/** One commit a session's work landed in. Carries the COMMIT-level totals alongside this
 *  session's own share, because the worker needs all three to be exact after de-duplicating
 *  commits across an agent's sessions (types.LineSurvivalCommit explains why). LOCAL ONLY —
 *  the sha and paths never ship; only counts and the SALTED commit id do. */
export interface SessionCommit {
  sha: string;
  at: number;
  /** The COMMIT's total added lines (every file in it) — the coverage denominator. */
  added: number;
  /** The COMMIT's contested lines (files 2+ agents edited) — owned by nobody. */
  contested: number;
  /** THIS session's attributed files in this commit. */
  files: { path: string; added: number }[];
}

/** Everything one session is owed from a walk: the (commit, file) pairs attributed to it,
 *  the added lines they carry, and the newest commit its work landed in — which starts the
 *  maturation clock (ADR-H3: the clock runs from when work LANDED, not from when a chat
 *  ended, and that is precisely what decouples survival from `session.end`). */
export interface SessionAttribution {
  sessionId: string;
  agent: AgentId;
  commits: SessionCommit[];
  /** Sum of every attributed file's added lines — the survival DENOMINATOR. */
  linesAuthored: number;
  /** Newest attributed commit time (epoch ms) — the maturation clock starts here. */
  lastCommitAt: number;
}

/**
 * Group a walk's attributed files by the session that earned them. Contested and
 * unattributed files are dropped from the SESSIONS by design — they belong to nobody — but
 * their lines ride along on each `SessionCommit` (`added` / `contested`) so the surface can
 * render what it could not attribute rather than quietly forgetting it.
 */
export function groupBySession(walk: AttributionWalk): SessionAttribution[] {
  const bySession = new Map<string, SessionAttribution>();

  for (const commit of walk.commits) {
    // Commit-level totals: computed ONCE, identical for every session in this commit, so
    // the worker's union over salted commit ids counts them exactly once.
    let added = 0;
    let contested = 0;
    for (const file of commit.files) {
      added += file.added;
      if (file.verdict.kind === "contested") contested += file.added;
    }

    for (const file of commit.files) {
      if (file.verdict.kind !== "attributed") continue;
      const { sessionId, agent } = file.verdict;

      let entry = bySession.get(sessionId);
      if (entry === undefined) {
        entry = { sessionId, agent, commits: [], linesAuthored: 0, lastCommitAt: 0 };
        bySession.set(sessionId, entry);
      }
      let sc = entry.commits.find((c) => c.sha === commit.sha);
      if (sc === undefined) {
        sc = { sha: commit.sha, at: commit.at, added, contested, files: [] };
        entry.commits.push(sc);
      }
      sc.files.push({ path: file.path, added: file.added });
      entry.linesAuthored += file.added;
      if (commit.at > entry.lastCommitAt) entry.lastCommitAt = commit.at;
    }
  }

  return [...bySession.values()];
}

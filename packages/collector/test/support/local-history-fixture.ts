/**
 * One shared event fixture for the local read models.
 *
 * The collector re-implements the projection the worker also builds (ADR 001
 * puts local projections here, and CLAUDE.md's boundary forbids importing the
 * worker's). Duplication drifts, so both the parity test and the plane test read
 * THIS fixture rather than each inventing rows that happen to suit them.
 *
 * It deliberately exercises the shapes the honesty rules turn on: a priced
 * Claude session with per-model rows, an unpriced model, an errored call, a
 * verification pass and fail, edit rows with file and dir identity, a Codex
 * session whose money rides the cumulative `session.tokens` carrier, git
 * momentum and delta, and a matured line-survival check.
 *
 * Four shapes below exist because a UNIFORM fixture cannot tell two rules apart.
 * The repos sweep momentum over DIFFERENT `windowDays`, and the survival check
 * is RE-EMITTED for the same `(sessionId, rung)`. Both are real shapes the
 * product produces, and while the fixture was uniform in each the local plane
 * and the worker disagreed on four values with nothing failing.
 *
 * The other two arrived with the KV-fold pass, for the same reason. One session
 * STARTS BEFORE the window and works inside it, because `usage.totals.sessions`
 * windows by `lastEventAt` while a start-counting rule windows by `startedAt`,
 * and every session here used to satisfy both. One session is PRICEABLE BUT
 * ENTIRELY UNPRICED, because `usage.cost.costPartial` is about a session dropped
 * from the total, and the only unpriced model here used to sit beside priced ones
 * in a session the total still counted.
 */
import type { SessionEvent } from "@seorak/types";

export const FIXTURE_NOW = Date.parse("2026-08-02T12:00:00.000Z");

export const REPO_A = "a".repeat(64);
export const REPO_B = "b".repeat(64);
/** A THIRD project, so a per-repo cut is never a two-way split by accident. */
export const REPO_C = "9".repeat(64);
const FILE_ONE = "1".repeat(64);
const FILE_TWO = "2".repeat(64);
const FILE_THREE = "3".repeat(64);
const DIR_ONE = "d".repeat(64);
const DIR_TWO = "f".repeat(64);
const COMMIT_ONE = "c".repeat(64);
const COMMIT_TWO = "e".repeat(64);

/** Claude's per-call money, Codex's session-carrier money, and one model the
 *  price table has no row for. */
const PRICED_MODEL = "claude-opus-4-5";
const UNPRICED_MODEL = "totally-unknown-model-9";
/** An unpriceable model that burned NOTHING — the pricing-gap list must skip it. */
const ZERO_TOKEN_MODEL = "totally-unknown-model-0";

/** What a current claude-code collector declares. Written once so the sessions
 *  that need to differ from it differ VISIBLY rather than by omission. */
const CLAUDE_CAPABILITIES = {
  hasTokens: true,
  hasCacheTokens: true,
  cost: "estimated",
  toolResult: "both",
  endReason: true,
  duration: "measured",
  verification: "both",
  costScope: "call",
  usageWindow: "count",
} as const;

function at(dayOffset: number, hour: number, minute = 0): string {
  return new Date(
    FIXTURE_NOW - dayOffset * 24 * 60 * 60 * 1000 + (hour - 12) * 3_600_000 + minute * 60_000,
  ).toISOString();
}

/**
 * The complete fixture, oldest first. Day offsets are relative to
 * `FIXTURE_NOW`, so a 7-day window covers everything except the deliberately
 * out-of-window prior-window rows.
 */
export function localHistoryFixture(): SessionEvent[] {
  return [
    // ── prior window (8 days back): the delta pill's "previous" leg ─────────
    {
      kind: "session.start",
      eventId: "prior-start",
      sessionId: "prior-session",
      at: at(8, 10),
      repoId: REPO_A,
      repoLabel: "seorak",
      agent: "claude-code",
      agentVersion: "1.0.0",
    },
    {
      kind: "tool.call",
      eventId: "prior-call",
      sessionId: "prior-session",
      at: at(8, 10, 5),
      toolName: "Edit",
      inputTokens: 1_000,
      outputTokens: 200,
      cacheReadTokens: 500,
      cacheWriteTokens: 100,
      costUsd: 0,
      errored: false,
      linesAdded: 40,
      linesRemoved: 4,
      models: [
        {
          model: PRICED_MODEL,
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
      eventId: "prior-end",
      sessionId: "prior-session",
      at: at(8, 11),
      reason: "clear",
    },

    // ── STRADDLING the window start: begun before it, worked inside it ──────
    //
    // The shape a long-running session has whenever the picker lands mid-flight,
    // and the one every other session here fails to have. `usage.totals.sessions`
    // is "sessions currently held in KV within the window", which windows by
    // `lastEventAt`, so this session IS in that count while a rule counting
    // `session.start` rows misses it entirely. The same asymmetry decides
    // `tools.callStats.totalCalls`, whose contract is the sum of each resident
    // session's own `toolCallCount` — a cumulative figure that includes the
    // pre-window call below. Two rules, indistinguishable while every session
    // both started and worked inside the window.
    {
      kind: "session.start",
      eventId: "straddle-start",
      sessionId: "straddle-session",
      at: at(8, 12),
      repoId: REPO_C,
      repoLabel: "ridge",
      agent: "claude-code",
      agentVersion: "1.0.0",
      capabilities: { ...CLAUDE_CAPABILITIES },
    },
    {
      kind: "tool.call",
      eventId: "straddle-call-prior",
      sessionId: "straddle-session",
      at: at(8, 12, 30),
      toolName: "Edit",
      inputTokens: 300,
      outputTokens: 60,
      cacheReadTokens: 200,
      cacheWriteTokens: 0,
      costUsd: 0,
      errored: false,
      linesAdded: 12,
      linesRemoved: 3,
      models: [
        {
          model: PRICED_MODEL,
          inputTokens: 300,
          outputTokens: 60,
          cacheReadTokens: 200,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
      ],
    },

    // ── in window: priceable, and priced by nothing ─────────────────────────
    //
    // It declares `cost: 'estimated'` — it CAN price its work — and every model
    // it burned is missing from the price table, so it contributes no dollars at
    // all and the window total silently excludes it. That is what
    // `usage.cost.costPartial` is for. The unpriced model on `claude-session`
    // above cannot exercise it: that session had priced rows beside the unpriced
    // one, so the total still counted it and nothing was dropped.
    {
      kind: "session.start",
      eventId: "unpriced-start",
      sessionId: "unpriced-session",
      at: at(3, 8),
      repoId: REPO_A,
      repoLabel: "seorak",
      agent: "claude-code",
      agentVersion: "1.0.0",
      capabilities: { ...CLAUDE_CAPABILITIES },
    },
    {
      kind: "tool.call",
      eventId: "unpriced-call",
      sessionId: "unpriced-session",
      at: at(3, 8, 10),
      toolName: "Read",
      inputTokens: 400,
      outputTokens: 90,
      cacheReadTokens: 700,
      cacheWriteTokens: 0,
      costUsd: 0,
      errored: false,
      models: [
        {
          model: UNPRICED_MODEL,
          inputTokens: 400,
          outputTokens: 90,
          cacheReadTokens: 700,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
      ],
    },
    {
      kind: "session.end",
      eventId: "unpriced-end",
      sessionId: "unpriced-session",
      at: at(3, 8, 20),
      reason: "clear",
    },

    // ── the straddling session's in-window half, and its end ────────────────
    {
      kind: "tool.call",
      eventId: "straddle-call",
      sessionId: "straddle-session",
      at: at(3, 16),
      toolName: "Edit",
      inputTokens: 800,
      outputTokens: 150,
      cacheReadTokens: 1_200,
      cacheWriteTokens: 40,
      costUsd: 0,
      errored: false,
      linesAdded: 30,
      linesRemoved: 6,
      fileId: FILE_THREE,
      dirId: DIR_TWO,
      fileCategory: "source",
      fileLabel: "ridge-core.ts",
      dirLabel: "core",
      fileLanguage: "typescript",
      models: [
        {
          model: PRICED_MODEL,
          inputTokens: 800,
          outputTokens: 150,
          cacheReadTokens: 1_200,
          cacheWriteTokens: 40,
          costUsd: 0,
        },
      ],
    },
    {
      kind: "session.end",
      eventId: "straddle-end",
      sessionId: "straddle-session",
      at: at(3, 16, 30),
      // A SECOND reason, so the end-reason ring has more than one bucket and
      // "clear" carries a count above 1.
      reason: "resume",
    },

    // ── in window: a Claude session in repo A ───────────────────────────────
    {
      kind: "session.start",
      eventId: "claude-start",
      sessionId: "claude-session",
      at: at(2, 9),
      repoId: REPO_A,
      repoLabel: "seorak",
      agent: "claude-code",
      agentVersion: "1.0.0",
      capabilities: { ...CLAUDE_CAPABILITIES },
    },
    {
      kind: "session.prompt",
      eventId: "claude-prompt",
      sessionId: "claude-session",
      at: at(2, 9, 1),
    },
    {
      kind: "tool.call",
      eventId: "claude-edit-1",
      sessionId: "claude-session",
      at: at(2, 9, 2),
      toolName: "Edit",
      inputTokens: 2_000,
      outputTokens: 400,
      cacheReadTokens: 6_000,
      cacheWriteTokens: 300,
      costUsd: 0,
      errored: false,
      linesAdded: 120,
      linesRemoved: 15,
      fileId: FILE_ONE,
      dirId: DIR_ONE,
      fileCategory: "source",
      fileLabel: "local-plane.ts",
      dirLabel: "src",
      fileLanguage: "typescript",
      models: [
        {
          model: PRICED_MODEL,
          inputTokens: 2_000,
          outputTokens: 400,
          cacheReadTokens: 6_000,
          cacheWriteTokens: 300,
          costUsd: 0,
        },
      ],
    },
    {
      kind: "tool.call",
      eventId: "claude-edit-2",
      sessionId: "claude-session",
      at: at(2, 9, 3),
      toolName: "Edit",
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      errored: true,
      linesAdded: 8,
      linesRemoved: 2,
      fileId: FILE_TWO,
      dirId: DIR_ONE,
      fileCategory: "test",
      models: [
        {
          // The stale-price-table case: it must be NAMED, not shrugged at.
          model: UNPRICED_MODEL,
          inputTokens: 500,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
        {
          // The case that must NOT be named: an unpriceable model that burned
          // NOTHING. Claude Code stamps its synthetic assistant turns this way,
          // and every count is 0 — so the row is "unpriced" while there is no
          // spend to miss and no price row anyone should add. A pricing-gap list
          // that cries wolf here trains the reader to ignore the real entries.
          model: ZERO_TOKEN_MODEL,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
      ],
    },
    {
      kind: "tool.call",
      eventId: "claude-verify-pass",
      sessionId: "claude-session",
      at: at(2, 9, 4),
      toolName: "Bash",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      errored: false,
      verificationKind: "test",
      verificationPassed: true,
    },
    {
      kind: "tool.call",
      eventId: "claude-verify-fail",
      sessionId: "claude-session",
      at: at(2, 9, 5),
      toolName: "Bash",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      errored: true,
      verificationKind: "test",
      verificationPassed: false,
    },
    {
      kind: "session.notification",
      eventId: "claude-needs-you",
      sessionId: "claude-session",
      at: at(2, 9, 6),
      notificationType: "permission_prompt",
    },
    {
      kind: "session.delta",
      eventId: "claude-delta",
      sessionId: "claude-session",
      at: at(2, 10),
      repoId: REPO_A,
      repoLabel: "seorak",
      gitContext: "clean",
      startGitContext: "clean",
      commitsLanded: 2,
      headMoved: true,
      filesTouchedUncommitted: 3,
      linesAddedUncommitted: 20,
      linesDeletedUncommitted: 5,
      generatedLinesExcludedUncommitted: 900,
    },
    {
      kind: "session.end",
      eventId: "claude-end",
      sessionId: "claude-session",
      at: at(2, 10, 1),
      reason: "clear",
    },
    {
      kind: "session.linesurvival",
      eventId: "claude-survival",
      sessionId: "claude-session",
      at: at(1, 10),
      repoId: REPO_A,
      gitContext: "clean",
      rung: "3d",
      fate: "retained",
      commitsChecked: 4,
      linesAuthored: 120,
      linesSurviving: 100,
      commits: [{ id: COMMIT_ONE, added: 200, contested: 10, authored: 120 }],
      filesGoneFromTip: 1,
    },
    {
      // The SAME session and rung, re-emitted because the attributed sha set
      // GREW — a file the session touched was committed after the first sweep.
      // `survival.ts` seeds the deterministic eventId with the sha set exactly
      // so this lands as a second row rather than collapsing on the primary key,
      // and its own comment names `(sessionId, rung)` as the reader's dedup key
      // because a reader keyed differently "is COUNTED TWICE". The counts here
      // are the UNION, not the increment, so summing both rows over-reports.
      kind: "session.linesurvival",
      eventId: "claude-survival-regrown",
      sessionId: "claude-session",
      at: at(1, 11),
      repoId: REPO_A,
      gitContext: "clean",
      rung: "3d",
      fate: "retained",
      commitsChecked: 6,
      linesAuthored: 180,
      linesSurviving: 140,
      commits: [
        { id: COMMIT_ONE, added: 200, contested: 10, authored: 120 },
        { id: COMMIT_TWO, added: 90, contested: 0, authored: 60 },
      ],
      filesGoneFromTip: 1,
    },

    // ── in window: a Codex session in repo B, money on the carrier ──────────
    {
      kind: "session.start",
      eventId: "codex-start",
      sessionId: "codex-session",
      at: at(1, 14),
      repoId: REPO_B,
      repoLabel: "atlas",
      agent: "codex",
      agentVersion: "0.144.3",
    },
    {
      kind: "tool.call",
      eventId: "codex-call",
      sessionId: "codex-session",
      at: at(1, 14, 1),
      toolName: "Shell",
      // Codex's tool.call rows carry a schema zero; no per-call dollar
      // aggregate may read them (capabilities.costScope === "session").
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    {
      kind: "session.tokens",
      eventId: "codex-tokens-1",
      sessionId: "codex-session",
      at: at(1, 14, 2),
      models: [
        {
          model: "gpt-5.1-codex",
          inputTokens: 10_000,
          outputTokens: 2_000,
          cacheReadTokens: 4_000,
          cacheWriteTokens: 0,
        },
      ],
    },
    {
      // A CUMULATIVE second snapshot. Summing both would double count.
      kind: "session.tokens",
      eventId: "codex-tokens-2",
      sessionId: "codex-session",
      at: at(1, 14, 3),
      models: [
        {
          model: "gpt-5.1-codex",
          inputTokens: 15_000,
          outputTokens: 3_000,
          cacheReadTokens: 6_000,
          cacheWriteTokens: 0,
        },
      ],
    },
    {
      kind: "git.momentum",
      eventId: "codex-momentum",
      sessionId: "codex-session",
      at: at(1, 15),
      repoId: REPO_B,
      repoLabel: "atlas",
      gitContext: "clean",
      windowDays: 7,
      commits: 0,
      filesTouched: 0,
      linesAdded: 0,
      linesDeleted: 0,
      generatedLinesExcluded: 0,
    },
    {
      kind: "git.momentum",
      eventId: "claude-momentum",
      sessionId: "claude-session",
      at: at(1, 15, 1),
      repoId: REPO_A,
      repoLabel: "seorak",
      gitContext: "clean",
      // WIDER than repo B's sweep beside it, and deliberately so. `windowDays`
      // mirrors each repo's own sweep, and two repos need not sweep the same
      // window. While both read 7 the plane could pick one arbitrarily and no
      // gate could tell — see `codebase.commitStats` and `usage.portfolio`.
      windowDays: 14,
      commits: 6,
      filesTouched: 21,
      linesAdded: 900,
      linesDeleted: 300,
      generatedLinesExcluded: 4_000,
    },
  ];
}

/**
 * The still-running session, appended separately so a test can choose whether
 * the live board has a row on it.
 *
 * It STARTS BEFORE THE WINDOW and touches a file there, which is the shape that
 * tells `codebase.filesInPlay`'s two rules apart. The worker reads the WINDOWED
 * file grain; `filesInPlayFor` used to scan the session's whole history with no
 * bound, so a long-running session's pre-window file counted as "in play right
 * now". While every live session both started and worked inside the window the
 * two rules are one rule. A session in flight for more than a week is a shape
 * the product genuinely produces — it is what the reaper exists to bound.
 */
export function liveFixture(): SessionEvent[] {
  return [
    {
      kind: "session.start",
      eventId: "live-start",
      sessionId: "live-session",
      at: at(8, 9),
      repoId: REPO_A,
      repoLabel: "seorak",
      agent: "claude-code",
      agentVersion: "1.0.0",
    },
    // BEFORE the window opens. In the window's file grain this row does not
    // exist, so a rule that reads the grain never sees FILE_TWO in play and a
    // rule that scans the session does.
    {
      kind: "tool.call",
      eventId: "live-prior-call",
      sessionId: "live-session",
      at: at(8, 9, 30),
      toolName: "Edit",
      inputTokens: 80,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      errored: false,
      fileId: FILE_TWO,
      dirId: DIR_ONE,
      fileCategory: "test",
      linesAdded: 3,
      linesRemoved: 1,
      models: [
        {
          model: PRICED_MODEL,
          inputTokens: 80,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
      ],
    },
    {
      kind: "tool.call",
      eventId: "live-call",
      sessionId: "live-session",
      at: new Date(FIXTURE_NOW - 10_000).toISOString(),
      toolName: "Read",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      costUsd: 0,
      errored: false,
      fileId: FILE_ONE,
      fileCategory: "source",
      models: [
        {
          model: PRICED_MODEL,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 10,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
      ],
    },
  ];
}

/**
 * A session whose only IN-WINDOW row is a cumulative token carrier: it started
 * and did all its work before the window, and its `session.tokens` snapshot was
 * re-shipped inside it.
 *
 * Appended separately, like `liveFixture()`, so the collector's own pinned suite
 * chooses whether to hold it. It is the shape that tells apart two rules the
 * gate had no way to distinguish, because a carrier is the ONE kind that can be
 * in-window for a session that is not:
 *
 *   — LIVENESS. `applyBatch` reduces only the four lifecycle kinds into session
 *     state, so a carrier never moves the worker's `lastEventAt`. This plane
 *     advanced `last_event_at` on every kind, which put the session back inside
 *     `usage.totals.sessions` and made `statusFromSilence` read it active.
 *   — COST SCOPE. The cost HEADLINE sums the sessions the window holds; the cost
 *     TREND and delta sum the window's rows. One accumulator served both here.
 *
 * Codex is the agent that produces it, because it reports cumulative session
 * totals rather than per-call deltas and writes no `session.end` at all.
 */
export function carrierOnlyFixture(): SessionEvent[] {
  return [
    {
      kind: "session.start",
      eventId: "carrier-only-start",
      sessionId: "carrier-only-session",
      at: at(9, 10),
      repoId: REPO_B,
      repoLabel: "atlas",
      agent: "codex",
      agentVersion: "0.144.3",
    },
    {
      kind: "tool.call",
      eventId: "carrier-only-call",
      sessionId: "carrier-only-session",
      at: at(9, 10, 5),
      toolName: "Shell",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    // INSIDE the window, for a session that is not.
    {
      kind: "session.tokens",
      eventId: "carrier-only-tokens",
      sessionId: "carrier-only-session",
      at: at(2, 10),
      models: [
        {
          model: "gpt-5.1-codex",
          inputTokens: 9_000,
          outputTokens: 1_500,
          cacheReadTokens: 2_500,
          cacheWriteTokens: 0,
        },
      ],
    },
  ];
}

/**
 * A broad-repo tail: 21 files across 13 directories, each file edited by TWO
 * sessions.
 *
 * Appended separately because it is about ONE property and would otherwise
 * drown the shapes above in noise. Every codebase list is capped server-side,
 * and while a fixture stays under the SMALLER of two caps the two planes are
 * indistinguishable — `codebase.files`, `codebase.directories` and
 * `codebase.rework` were compared, passing, and truncating at different lengths
 * (40 locally against the worker's 20/12/20) for as long as the fixture held
 * three files in two directories. The counts here clear the tightest cap on
 * each list: 21 > 20 files, 13 > 12 directories, and 21 rework rows (a file in
 * two distinct sessions is what `rework` means) > 20.
 *
 * Edits are staggered so no two rows tie at a cap boundary: a tie AT the cut
 * decides which row is on the dashboard, and a fixture that ties there would
 * test the tie-break rather than the cap.
 */
export function capFixture(): SessionEvent[] {
  const events: SessionEvent[] = [];
  const hex = (prefix: string, n: number) =>
    `${prefix}${String(n).padStart(2, "0")}`.padEnd(64, "0");
  for (const [index, sessionId] of ["cap-session-a", "cap-session-b"].entries()) {
    events.push({
      kind: "session.start",
      eventId: `${sessionId}-start`,
      sessionId,
      at: at(3, 8 + index),
      repoId: REPO_B,
      // REPO_B's own label. Giving one repoId a SECOND label here would test how
      // the two planes resolve a label conflict, which is a different question
      // from the cap and would hide it.
      repoLabel: "atlas",
      agent: "claude-code",
      agentVersion: "1.0.0",
    });
    for (let file = 0; file < 21; file += 1) {
      // Descending edit counts, distinct per file, so the hottest-first order is
      // total and the cap cuts at an unambiguous row.
      for (let edit = 0; edit <= 21 - file; edit += 1) {
        events.push({
          kind: "tool.call",
          eventId: `${sessionId}-f${file}-e${edit}`,
          sessionId,
          at: at(3, 8 + index, 1 + file * 2 + (edit % 2)),
          toolName: "Edit",
          inputTokens: 10,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          errored: false,
          fileId: hex("ca", file),
          // 21 files over 13 directories, so the directory list clears its own
          // (tighter) cap without the file list deciding it.
          dirId: hex("da", file % 13),
          fileCategory: "source",
          linesAdded: 1,
          linesRemoved: 0,
          models: [
            {
              model: PRICED_MODEL,
              inputTokens: 10,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costUsd: 0,
            },
          ],
        });
      }
    }
    events.push({
      kind: "session.end",
      eventId: `${sessionId}-end`,
      sessionId,
      at: at(3, 8 + index, 55),
      reason: "clear",
    });
  }
  // A STILL-RUNNING session holding 51 files, because `filesInPlay` carries the
  // loosest cap of the five (50) and nothing else here comes near it. Its last
  // event is inside the idle threshold, so both planes read it `active` and the
  // board's membership is not what is under test.
  events.push({
    kind: "session.start",
    eventId: "cap-live-start",
    sessionId: "cap-live-session",
    at: new Date(FIXTURE_NOW - 20 * 60_000).toISOString(),
    repoId: REPO_B,
    repoLabel: "atlas",
    agent: "claude-code",
    agentVersion: "1.0.0",
  });
  for (let file = 0; file < 51; file += 1) {
    events.push({
      kind: "tool.call",
      eventId: `cap-live-f${file}`,
      sessionId: "cap-live-session",
      at: new Date(FIXTURE_NOW - (51 - file) * 1_000).toISOString(),
      toolName: "Edit",
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      errored: false,
      fileId: hex("cb", file),
      dirId: hex("db", file % 13),
      fileCategory: "source",
      linesAdded: 1,
      linesRemoved: 0,
      models: [
        {
          model: PRICED_MODEL,
          inputTokens: 10,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
        },
      ],
    });
  }
  return events;
}

export const FIXTURE_PRICED_MODEL = PRICED_MODEL;
export const FIXTURE_UNPRICED_MODEL = UNPRICED_MODEL;
export const FIXTURE_ZERO_TOKEN_MODEL = ZERO_TOKEN_MODEL;
export const FIXTURE_FILE_ONE = FILE_ONE;
export const FIXTURE_FILE_TWO = FILE_TWO;
export const FIXTURE_FILE_THREE = FILE_THREE;
export const FIXTURE_DIR_ONE = DIR_ONE;
export const FIXTURE_DIR_TWO = DIR_TWO;

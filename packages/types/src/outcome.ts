import type {
  IsoTimestamp,
  LineSurvivalFate,
  LineSurvivalRung,
  SessionEndEvent,
  SessionId,
} from "./events.ts";

/**
 * SessionOutcome is the content-safe per-session "did this session land / last?"
 * read used by mobile drill-down. A worker read-path
 * rollup keyed on `session_id` over the D1 outcome rows (`session.delta` /
 * `session.linesurvival` / `tool.call.errored`) plus the session's terminal
 * reason — NEVER stamped on `SessionState`/`SessionSummary` (ADR-OA7). COUNTS +
 * CLOSED ENUMS ONLY: no SHAs, paths, prompts, diffs, branch names, or lines.
 *
 * Honesty: renders on-branch `lineSurvival` ONLY (the revert-blind
 * commit-reachability rollup was retired 2026-07-12); excludes `verification.passRate` (a lower bound until the
 * retention window rolls past 2026-07-09, and ungated on the `toolResult`
 * capability — see ToolsSnapshot.verification); every field is null until its rows
 * accrue — an immature session is "outcome pending", never zero-filled. Passive
 * only (ADR-OA8): never a push trigger.
 *
 * Safe to publish (no secrets, no worker internals) — travels with `@seorak/types`
 * when the package is extracted.
 */
export interface SessionOutcome {
  sessionId: SessionId;
  /** When the worker computed this read. */
  generatedAt: IsoTimestamp;

  /** Commits that landed during the session (`session.delta.commitsLanded`);
   *  "shipped" = > 0. null when no `session.delta` row could determine it (start
   *  HEAD unknown, or the session emitted no delta yet) — never a fabricated 0. */
  commitsLanded: number | null;

  /** Uncommitted working-tree churn at session end — the "thrash vs ship" signal.
   *  The whole object is null until a `session.delta` row accrues. Counts only;
   *  generated/lockfile lines are excluded from the headline and surfaced
   *  separately so the anti-vanity exclusion stays auditable. */
  uncommitted: {
    filesTouched: number;
    linesAdded: number;
    linesRemoved: number;
    generatedLinesExcluded: number;
  } | null;

  /** On-branch LINE survival at the fixed maturation rung — the honest "did the
   *  work last", NOT revert-blind commit reachability. null while the maturation
   *  sweep has not emitted a `session.linesurvival` row yet (the "outcome pending
   *  — matures in ~3 d" state). */
  lineSurvival: {
    /** The fixed maturation rung (closed enum; "3d" in v1). */
    rung: LineSurvivalRung;
    /** retained | overwritten (RATED) | unreachable | unknown (EXCLUDED). */
    fate: LineSurvivalFate;
    /** surviving ÷ authored over the RATED fates (UI ×100); null below this
     *  session's own >=3-commit floor, when `fate` is unreachable/unknown, or when
     *  `linesAuthored === 0`. Below the floor the card shows fate + counts, never a %. */
    rate: number | null;
    linesAuthored: number;
    linesSurviving: number;
    /** The session's landed commit count — the floor basis. */
    commitsChecked: number;
  } | null;

  /** `tool.call.errored === true` count for the session. null = NO tool.call
   *  carried the boolean `errored` flag (signal unavailable: legacy/KV-only rows,
   *  or a tool whose `toolResult` cannot observe failures) — a null is "unknown", never
   *  "0 errors". A 0 is an honest "no errors observed". */
  errorCount: number | null;
  /** The earliest errored tool.call's timestamp; null when `errorCount` is 0 or null. */
  firstErrorAt: IsoTimestamp | null;

  /** How the session ended (the 6-value lifecycle enum). null while the session is
   *  active or no `session.end` recorded a reason. LIFECYCLE, never completion. */
  endReason: SessionEndEvent["reason"] | null;
}

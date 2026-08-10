import type { AgentId, IsoTimestamp, SessionId, UndoKind } from "./events.ts";

/**
 * replay.ts — the keyframe-replay contract (the third product surface). Replay is
 * NOT token-by-token playback: it is the handful of MOMENTS worth reviewing in a
 * past session, extracted by the worker from the retained D1 event log. Per-session
 * and fetched on demand (GET /replay/:sessionId) — it is NOT part of
 * OverviewSnapshot.
 *
 * Publish-safe: a keyframe carries COUNTS + metadata + a derived label ONLY —
 * never a prompt, command, file path, diff, stdout/stderr, or commit message
 * (commit-message display is a deferred opt-in, CAPTURE-ROADMAP §replay keyframes).
 * Every keyframe must be backed by a real captured signal; a moment with no
 * backing signal is simply absent (honest-empty), never fabricated.
 */

/**
 * KeyframeKind — the moments Seorak can honestly reconstruct from the event log.
 * Each maps to a real captured signal:
 *  - session-start / session-end  → the lifecycle bounds (always present).
 *  - first-tool-call              → the first tool.call (the session "got going").
 *  - first-error                  → the first tool.call with `errored === true`
 *                                   (UNBLOCKED by the errored flag).
 *  - verification-failed          → the first failed verification run
 *                                   (verificationPassed === false).
 *  - peak-burn                    → the highest-cost window across the ordered
 *                                   tool.call cost deltas.
 *  - biggest-commit               → the session's commit milestone, from
 *                                   session.delta (UNBLOCKED by session-bounded
 *                                   git delta). By files-touched / commitsLanded,
 *                                   NEVER raw LOC (anti-vanity).
 */
export type KeyframeKind =
  | "session-start"
  | "first-tool-call"
  | "first-error"
  | "verification-failed"
  | "peak-burn"
  | "biggest-commit"
  | "session-end";

/**
 * Keyframe — one reviewable moment. `label`/`detail` are short, derived, content-
 * free strings (a tool name, a count, a cost rate, an end reason) — the extractor
 * MUST NOT place any captured content (command/path/output/message) here.
 */
export interface Keyframe {
  kind: KeyframeKind;
  /** The moment's timestamp (the backing event's `at`). */
  at: IsoTimestamp;
  /** The backing event's per-session sequence number (orders keyframes; ties
   *  broken by `at`). */
  seq: number;
  /** Short human label, e.g. "First error", "Peak burn", "Shipped 2 commits".
   *  Content-free metadata only. */
  label: string;
  /** Optional one-line detail — still content-free (tool name, a count, a derived
   *  $/min rate, an end reason). Absent when there is nothing extra to say. */
  detail?: string;
}

/**
 * ReplayActivityBucket — one fixed-width window of session throughput for the
 * replay chart. Derived ONLY from real tool.call deltas in that window; a quiet
 * bucket is honestly `{ costUsd: 0, toolCallCount: 0, tokensTotal: 0 }`, never
 * omitted or interpolated.
 */
export interface ReplayActivityBucket {
  /** Bucket start timestamp (ISO). */
  at: IsoTimestamp;
  /** Bucket width in milliseconds (constant across the series). */
  bucketMs: number;
  costUsd: number;
  toolCallCount: number;
  /** input + output tokens billed in this bucket. */
  tokensTotal: number;
}

/** Playback-row kinds — content-free moments the scrubber can surface. */
export type ReplayMomentKind =
  | "tool.call"
  | "session.notification"
  | "session.prompt";

/**
 * ReplayMoment — one ordered, content-free row in the replay stream. Tool names,
 * counts, enums, and keyframe cross-refs only — never a prompt, command, path,
 * diff, or output.
 */
export interface ReplayMoment {
  at: IsoTimestamp;
  seq: number;
  kind: ReplayMomentKind;
  /** tool.call. These are a projection layer: the builder sets a field to `undefined`
   *  for "absent" rather than omitting the key, so each optional carries `| undefined`
   *  under exactOptionalPropertyTypes. Consumers see the same `T | undefined` either way. */
  toolName?: string | undefined;
  costUsd?: number | undefined;
  /** Whether costUsd is a complete measured value. Separate from zero so an
   * honestly measured $0 call does not collapse into a missing carrier. */
  costMeasured?: boolean | undefined;
  errored?: boolean | undefined;
  verificationKind?: string | undefined;
  verificationPassed?: boolean | undefined;
  fileCategory?: string | undefined;
  /** Language family of an edited file, from tool.call. Absent when capture did not derive one. */
  fileLanguage?: string | undefined;
  /** Within-session work discard (closed enum), from tool.call. Absent for non-undo calls. */
  undoKind?: UndoKind | undefined;
  /** session.notification */
  notificationType?: string | undefined;
}

/** Session totals derived from the retained event log (honest sums, never capped). */
export interface ReplayTotals {
  costUsd: number;
  tokensTotal: number;
  toolCallCount: number;
  /** Human steering ticks — count of `session.prompt` rows (envelope only, no text). */
  promptCount: number;
  /** Explicit evidence gates for external projections. Numeric zero alone cannot
   * distinguish measured absence from a legacy carrier that never existed. */
  measured?: {
    costUsd: boolean;
    tokensTotal: boolean;
    promptCount: boolean;
    errors: boolean;
  };
  /** Distinct uncommitted files at session end (`session.delta`). Absent when no delta row exists. */
  filesTouchedUncommitted?: number;
}

/**
 * ReplaySession — the keyframe timeline for one session. `keyframes` is `[]`
 * (honest-empty) when the session produced no qualifying moments; the lifecycle
 * bounds (session-start, and session-end once ended) are included whenever the
 * log has them. Ordered by (seq, at).
 *
 * `activity` feeds the throughput chart; `moments` feeds the scrub-window stream.
 * Both are honest-empty when the log has no qualifying rows — never fabricated.
 */
export interface ReplaySession {
  sessionId: SessionId;
  agent: AgentId;
  startedAt: IsoTimestamp;
  /** null while the session is still in flight (no session.end logged yet). */
  endedAt: IsoTimestamp | null;
  keyframes: Keyframe[];
  activity: ReplayActivityBucket[];
  moments: ReplayMoment[];
  totals: ReplayTotals;
}

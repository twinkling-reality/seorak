import type { IsoTimestamp, SessionId } from "./events.ts";
import type { SessionStatus } from "./session.ts";
import type { WorkspaceMember } from "./workspace.ts";

/**
 * SessionSummary — the canonical view-model for non-mobile surfaces (web, CLI).
 *
 * Deliberately free of any `@mobile-surfaces` dependency: where the iOS path
 * projects `SessionState` into a lossy, phone-shaped `LiveSurfaceSnapshot`
 * (cost squeezed into a 0..1 progress bar), this view-model keeps the full
 * fidelity a deep-dive surface needs — true cumulative cost, the token
 * breakdown, and a derived burn rate. It is a presenter shape, not domain
 * state: every field is derived from `SessionState` by `sessionToSummary`.
 *
 * Safe to publish (no secrets, no worker internals) — travels with
 * `@seorak/types` when the package is extracted.
 */
export interface SessionSummary {
  sessionId: SessionId;
  /** Repo display label — the last path segment (basename), e.g. "seorak". */
  project: string;
  /** Stable salted per-repo id — the keying id; never the absolute path. */
  repoId: string;
  agent: string;
  status: SessionStatus;
  /** Server-derived responsible person in a Shared workspace. Absent for
   * Personal history and never supplied by collector event payloads. */
  member?: WorkspaceMember;

  startedAt: IsoTimestamp;
  lastEventAt: IsoTimestamp;
  endedAt?: IsoTimestamp;
  /** Active span: lastEventAt − startedAt, in whole seconds. */
  elapsedSeconds: number;

  toolCallCount: number;
  currentTool?: string;
  /** Live "needs you" flag — the agent is blocked awaiting the human (a
   *  permission_prompt), mirrored from `SessionState.awaitingInput` so the hero
   *  live board can glance "needs you" (the wedge's most actionable live state).
   *  Present (`true`) only while blocked; ABSENT ⇒ not waiting (cleared on the next
   *  tool.call or session.end). A LIVE per-session field ONLY — it must NEVER enter
   *  an aggregate rollup (bucketing a transient live status into an aggregate is the
   *  same category error the EndReasonCount guard forbids). */
  awaitingInput?: boolean;

  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    /** input + output (the billable throughput figure). */
    total: number;
  };

  /**
   * True cumulative spend in USD, never capped. `null` when the host tool cannot
   * price its work (`cost:'none'`, or every model unpriced): unknown, NOT $0. A
   * numeric 0 is a real measurement (a genuinely ~free session). Mirrors the
   * number|null contract the aggregate rollups already carry.
   */
  costUsd: number | null;
  /** costUsd per active minute; 0 before any elapsed time; `null` when cost is null. */
  burnRateUsdPerMin: number | null;
}

/**
 * Whether a session has done anything since it opened.
 *
 * `went_cold` measures SILENCE, and silence is only a measurement when something
 * once made noise. A `session.start` carrying nothing after it is a session that
 * never began: the hook fires when the agent boots, before the developer has
 * typed anything, so a bare start is capture working correctly rather than work
 * happening. Firing a silence watch on one pages the developer about a session
 * there is nothing to step back into, which is the same fabricated attention the
 * Codex tailer's activation cutoff already exists to refuse.
 *
 * Three legs, each a real reading off the view-model:
 *   - a completed tool call is unambiguous work;
 *   - `awaitingInput` means the agent is BLOCKED on the developer, which is a
 *     session in flight even before its first call completes (`tool.call` is
 *     emitted from PostToolUse, so a permission prompt precedes it);
 *   - `lastEventAt` past `startedAt` means some liveness-advancing event landed
 *     after the start, which covers every future lifecycle kind without this
 *     predicate having to enumerate them.
 *
 * Boolean by contract, not by accident: the publish-safety gate exempts
 * comparisons inside a boolean-returning predicate. A richer return type here
 * would make this same body an evaluation finding and fail rule 2.
 */
export function sessionHasActivity(summary: SessionSummary): boolean {
  return (
    summary.toolCallCount > 0 ||
    summary.awaitingInput === true ||
    Date.parse(summary.lastEventAt) > Date.parse(summary.startedAt)
  );
}

/**
 * Whether a session measured anything.
 *
 * `usage.totals.sessions` sits beside `toolCalls` and `cost.totalUsd` and is read
 * as their denominator (the cost panel divides one by the other). A session that
 * produced no tool call and no priced carrier contributes to neither of them, so
 * counting it here makes this the only member that can see it, and every rate
 * beside it wrong by the size of the class.
 *
 * NOT a claim about who opened the session. The argv shape that separates a
 * developer's session from another program's is invisible to the hook, and
 * `SessionStartEvent` carries no launch reason, so inventing a discriminator we
 * cannot measure would be the fabrication this refuses. What IS measurable is
 * whether anything was measured, and that is the whole of the rule: a human who
 * opened a session and closed it without typing is excluded for exactly the same
 * reason a program is, and neither exclusion claims to know who was at the
 * keyboard.
 *
 * The carrier leg is not optional. Codex reports money at SESSION scope, so a
 * carrier-priced session with no tool call is real spend. Without this leg it
 * would leave `sessions` while its dollars stayed in `cost.totalUsd` and its id
 * stayed in `cost.sessionsWithCost`, and `sessionsWithCost <= sessions` is an
 * invariant a surface renders as a sentence.
 *
 * No token leg: on both engines a session row accrues tokens from `tool.call` and
 * nothing else, so `tokens.total > 0` already implies `toolCallCount > 0`. The
 * only token source that escapes the session row is the carrier, which is leg two.
 *
 * Boolean by contract, not by accident, for the same reason as
 * `sessionHasActivity`.
 */
export function sessionMeasuredWork(
  summary: SessionSummary,
  carrierPriced: (sessionId: SessionId) => boolean,
): boolean {
  return summary.toolCallCount > 0 || carrierPriced(summary.sessionId);
}

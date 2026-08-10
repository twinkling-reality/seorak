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

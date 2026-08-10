import type {
  AgentId,
  IsoTimestamp,
  SessionId,
  SessionEndEvent,
} from "./events.ts";
import type { SessionCapabilities } from "./capabilities.ts";
import type { ModelTokenUsage } from "./pricing.ts";
import type { WorkspaceMember } from "./workspace.ts";

export interface SessionState {
  sessionId: SessionId;
  startedAt: IsoTimestamp;
  lastEventAt: IsoTimestamp;
  endedAt?: IsoTimestamp;
  /** Carried verbatim from session.start — salted per-repo id, never the absolute
   *  path (which stays on the developer's machine). The keying id. */
  repoId: string;
  /** Carried verbatim from session.start — basename only, the repo display label. */
  repoLabel: string;
  /** Carried verbatim from the session.start event; never recomputed. Open union
   *  so a second tool's agent flows through as data. */
  agent: AgentId;
  /** Carried verbatim from session.start, never recomputed. OPTIONAL so KV rows
   *  written before capabilities shipped (and the delta-first `!current` reducer
   *  fallback) stay honest-absent rather than fabricating all-true; the worker
   *  treats absent capabilities as unknown and falls back to its per-field null
   *  gates (claude-code is treated as capable). */
  capabilities?: SessionCapabilities;
  /** Server-derived from the authenticated workspace credential. It is absent
   *  on personal cells and is never accepted from an event payload. */
  member?: WorkspaceMember;

  toolCallCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCostUsd: number;

  /** Per-model CUMULATIVE token totals, accumulated by the reducer from each
   *  tool.call's `models[]` (worker-side pricing authority, option C). Carries
   *  tokens ONLY — no baked-in cost — so `sessionToSummary` RE-PRICES the
   *  per-session/live/byAgent/projects cost from the shared `pricing.ts` table on
   *  demand, the same one source the worker's headline + byModel reprice from. A
   *  price change is then a `pricing.ts` edit + worker deploy with NO collector
   *  fan-out, for EVERY cost surface. Optional so KV rows written before this field
   *  shipped (and tool.calls carrying no `models[]`) stay valid — `sessionToSummary`
   *  falls back to the collector-priced `totalCostUsd` when it is absent/empty. */
  modelTokens?: Record<string, ModelTokenUsage>;

  currentTool?: string;
  currentToolStartedAt?: IsoTimestamp;

  /** Live-ambient "needs you" flag: set true by a
   *  session.notification(permission_prompt) reduce — the agent is blocked awaiting
   *  the human — and cleared on the next tool.call (it proceeded) or session.end.
   *  Drives ONLY the Live Activity needs-you glance; never enters SessionSummary or
   *  any aggregate. Optional so legacy rows stay valid (absent ⇒ not waiting). */
  awaitingInput?: boolean;

  /** Terminal reason persisted from the session.end event. Present only once
   *  the session has ended (status === "ended") and the reducer's session.end
   *  branch records it — the blocking prerequisite for a non-empty
   *  OverviewSnapshot.outcomes.endReasons distribution. Undefined while active. */
  reason?: SessionEndEvent["reason"];

  /** A bounded FIFO of the most-recent eventIds this session has already reduced,
   *  the worker's idempotency key. The collector ships AT-LEAST-ONCE (its offset
   *  only advances after a 2xx, so a crash between the worker accepting a batch
   *  and the daemon persisting the offset re-ships that batch). KV scalars are
   *  cumulative sums, so without dedup a re-ship double-counts tokens/cost/calls;
   *  the reducer skips any event whose id is already here. Internal dedup state —
   *  NOT part of SessionSummary (the presenter selects fields explicitly), so it
   *  never reaches the web. Bounded so KV growth stays trivial; see the cap in
   *  sessions.ts. Optional so legacy rows written before this field stay valid. */
  recentEventIds?: string[];

  status: SessionStatus;
}

export type SessionStatus =
  | "active"
  | "idle"
  | "stuck"
  | "ended";

export const IDLE_THRESHOLD_MS = 30_000;
export const STUCK_THRESHOLD_MS = 5 * 60_000;
/** Silence past which a non-ended session is treated as ABANDONED (collector
 *  crashed, machine slept, or the dev walked away without a clean session.end)
 *  and reaped to "ended" by the cron, so the live board and the stuck/active
 *  counts stop showing a dead session as in-flight forever. Set well beyond
 *  STUCK (and beyond any plausible single long-running tool call that emits no
 *  events while it runs) so a slow-but-alive session is never falsely reaped;
 *  it is the live-board horizon too (a session silent longer is not "live"). */
export const ABANDONED_THRESHOLD_MS = 30 * 60_000;

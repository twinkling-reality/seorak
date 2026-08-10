/**
 * types.ts — the terminal surface's shared shapes. Kept dependency-light so both
 * the PURE renderers/layout/parser (unit-tested without a TTY) and the impure
 * shell can import them.
 */
import type { OverviewSnapshot, SessionSummary } from "@seorak/types";

/**
 * BoardData — the assembled inputs a frame/widget renders from. The same two OPEN
 * read endpoints the web polls feed it: `live` + `generatedAt` from GET /live
 * (canonical), `overview` from GET /overview. A null `overview` means that
 * endpoint did not answer — aggregate widgets degrade to an honest "unavailable",
 * never a wall of "--" that would read as measured-empty. (This is the same shape
 * the v0 `StatsSnapshot` carried.)
 */
export interface BoardData {
  live: SessionSummary[];
  generatedAt: string | null;
  overview: OverviewSnapshot | null;
  /** The aggregate body is last-known-good while the worker rebuilds or recovers. */
  overviewStale?: boolean;
}

/**
 * TerminalLayout, the persisted terminal session config, which is now just the
 * window the paragraph covers. The on-disk schema (`~/.seorak/terminal-layout.json`)
 * wraps this with a `version`.
 */
export interface TerminalLayout {
  /** Window the stats cover: 7 | 30 | 90. */
  rangeDays: number;
  /** How the same facts are rendered. "paragraph" reads them as sentences,
   *  "list" lays them out as label-and-value rows with a bar on the rates. Both
   *  are built from one fact layer (narrative.ts), so this changes the FORM and
   *  never the claim. */
  view: TerminalView;
}

/** How the board is read. "paragraph" and "list" are two renderings of the SAME
 *  facts; "projects" is a different cut of them, every project side by side. */
export type TerminalView = "paragraph" | "list" | "projects";

export interface RenderContext {
  /** Emit ANSI style. The shell gates this on `isTTY && !NO_COLOR && !--no-color`;
   *  when false the output carries ZERO escape bytes (tested). */
  color: boolean;
  /** Terminal width for the header box + range pills (`columns ?? 80`). */
  width: number;
  /** "now" in epoch-ms for the relative header (Date.now() at the call site). */
  now: number;
  /** The window the overview covers (the layout's rangeDays), for block labels. */
  days: number;
  /** Set when BOTH endpoints are failing mid-session but the board still holds
   *  real data: the frame renders it under a connection-lost banner instead of
   *  discarding it (the header's "updated N ago" note carries the age). */
  connectionLost?: boolean;
  /** The worker answered, but explicitly marked the aggregate body as stale. */
  overviewStale?: boolean;
  /** Local delivery is blocked even if worker reads remain healthy. */
  shippingBlocked?: boolean;
  /** The identity-block facts (ADR-2a). When set, the QUIET states (first-run,
   *  connecting, unreachable) render the full identity block; when absent they
   *  keep the slim header (one-shot callers that never resolved the facts). */
  identity?: IdentityFacts;
  /** The quiet-state shimmer phase (the shell's ~100ms timer, running ONLY
   *  while an identity block is on screen). Absent/0 = the static gradient. */
  animFrame?: number;
  /** The project the board is FOCUSED on (↑/↓), or absent for everything. Both
   *  forms narrow to it: the live rows filter, and the window stats come from
   *  that repo's rollup, which the worker computes with the same definitions as
   *  the global ones. Focusing changes the population, never the meaning. */
  scope?: { repoId: string; project: string };
  /** The dashboard URL this terminal is a door to (`<origin>/dashboard`),
   *  resolved by the caller from the worker URL. Absent in demo mode, which must
   *  never print the owner's real host, and absent when no gateway is offered. */
  gateway?: string;
  /** True inside the live session (`seorak`), absent for one-shot renders.
   *  Copy that would lie in one mode gates on it: "still retrying" is only true
   *  when a poll loop exists. */
  interactive?: boolean;
  /** True once a GET /overview poll has actually FAILED (the shell's consecutive
   *  failure count is non-zero); absent while the first poll is still in flight.
   *  The missing-aggregate notice needs the difference: the windowed build takes
   *  about two seconds, so a wait that lasts is a failure rather than a slow
   *  build, and one "still waiting" line cannot honestly cover both. */
  overviewFailing?: boolean;
}

/** The identity block's fact rows — all real state, never claims. `watching` is
 *  null when no agent is installed yet (rendered honestly, not hidden). */
export interface IdentityFacts {
  watching: string | null;
  workerHost: string;
}

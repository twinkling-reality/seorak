import type { IsoTimestamp, SessionId } from "./events.ts";

/**
 * SignalId is the canonical id of every watch the intervention engine can fire.
 * It is the key of the signal
 * CATALOG (`notification-catalog.ts`), the key of `NotificationSettings.signals`,
 * and the discriminator of a fired `Intervention`. The four original kinds plus
 * the four new opt-in/idle signals.
 *
 */
export type SignalId =
  | "cost_spike"
  | "high_burn_rate"
  | "long_session"
  | "stuck_loop"
  | "went_cold"
  | "session_ended"
  | "daily_cost_cap"
  | "first_error";

/** The notification interruption level a fired signal carries onto its push
 *  (the subset of the `@mobile-surfaces` notification slice enum Seorak uses).
 *  Per-signal, resolved from the catalog at construction so the projection never
 *  hardcodes `cost_spike ? timeSensitive : active` again. */
export type InterruptionLevel = "passive" | "active" | "timeSensitive";

/**
 * A fired intervention is constructed only when a real measured value crossed
 * a real threshold. Nothing is fabricated.
 *
 * The notification format is PROJECT-AS-TITLE (§2/§4A): the repo is the
 * notification title, the signal name + the warm sentence live in the
 * subtitle/body. So the constructed intervention carries the project label and
 * its salted repo id (for per-project gating + the title), the human signal
 * `signalLabel` (the subtitle), the per-signal `interruptionLevel`, and the
 * `held` flag — true when quiet hours suppressed the PUSH but the fire is still
 * RECORDED for the history view (§D/§E). The collector-supplied repoLabel ships
 * by default, so project-as-title needs no new capture (§F).
 */
export interface Intervention {
  /** The signal that fired — the discriminator, identical to its `SignalId`. */
  kind: SignalId;
  sessionId: SessionId;
  /** Repo display label (basename) — the notification TITLE. "All projects" for
   *  the cross-project `daily_cost_cap`, which is not scoped to one repo. */
  project: string;
  /** Salted per-repo id — the per-project mute/override keying id (never a path).
   *  Empty for `daily_cost_cap` (it spans every project). */
  repoId: string;
  triggeredAt: IsoTimestamp;
  /** Human signal name ("Cost spike") — the catalog `label`, rendered as the
   *  notification SUBTITLE (and the row label in the web/mobile history). */
  signalLabel: string;
  /** The warm, direct one-sentence body (catalog `buildSignalBody`) — the
   *  notification BODY. Project is the title, so this is a single sentence. */
  body: string;
  deepLink: string;
  /** Per-signal interruption level (catalog), carried so the projection reads it
   *  verbatim instead of branching on `kind`. */
  interruptionLevel: InterruptionLevel;
  /** True when quiet hours held the PUSH but the fire was still recorded to the
   *  history index (§D) — the web/mobile history shows it as "held (quiet hours)".
   *  Absent/false on a delivered fire. */
  held?: boolean;
}

/**
 * The numeric thresholds the engine watches, the flat shape surfaced on
 * `/overview` (the web "watching for" cards) and seeded from the per-deploy
 * `SEORAK_*` env vars. The four original bounds plus the two new tunable ones
 * (`wentColdMinutes`, `dailyCostCapUsd`); the two event-driven signals
 * (`session_ended`, `first_error`) carry no threshold.
 *
 * Per-signal STORED overrides (NotificationSettings) now WIN over these at
 * evaluation time (the precedence flip, §C); these stay the default seed + the
 * value the web cards display when nothing is stored.
 */
export interface InterventionThresholds {
  costSpikeUsd: number;
  longSessionMinutes: number;
  highBurnRateUsdPerMinute: number;
  /** Cadence fallback: consecutive identical tool calls that trip `stuck_loop`
   *  when the stream carries NO per-call error signal (legacy/KV-only). A repeat
   *  is a weaker signal than a failure, so this stays higher. @grounding cadence */
  stuckLoopRepeatedToolCalls: number;
  /** Failure-based: consecutive ERRORED calls of the same tool that trip
   *  `stuck_loop` once the collector's `errored` flag is present. A real failure
   *  loop is higher-precision than mere repetition, so this fires sooner (lower).
   *  @grounding outcome */
  stuckLoopErroredToolCalls: number;
  /** Silence (minutes since the last event) past which a still-live session is
   *  "went cold". Below the abandoned-reaper horizon (30 min) so a cold session
   *  is still in the live set to fire on. @grounding cadence */
  wentColdMinutes: number;
  /** Total measured spend across ALL projects today past which `daily_cost_cap`
   *  fires once per calendar day. An aggregate bound, never per-session. */
  dailyCostCapUsd: number;
}

export const DEFAULT_THRESHOLDS: InterventionThresholds = {
  costSpikeUsd: 5,
  longSessionMinutes: 60,
  highBurnRateUsdPerMinute: 0.5,
  stuckLoopRepeatedToolCalls: 5,
  stuckLoopErroredToolCalls: 3,
  wentColdMinutes: 10,
  dailyCostCapUsd: 20,
};

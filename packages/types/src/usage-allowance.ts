import type { AgentId, IsoTimestamp } from "./events.ts";

/**
 * UsageAllowance — a normalized, per-(tool, window) usage-headroom reading for the
 * ambient surfaces. NO SURFACE RENDERS A GAUGE TODAY: the menu bar was the first
 * intended reader and it was removed on 2026-08-08, so the readings are measured,
 * carried on `/overview`, and validated by the web and mobile parsers without
 * anything drawing them. When a gauge does arrive, readings are NEVER summed
 * across tools; each gets its own (docs/specs/multi-tool.md).
 *
 * ── TWO LEGS, AND A READING HAS EXACTLY ONE ──────────────────────────────────
 * This is the whole contract, and it exists because the two tools we ship are
 * honest about opposite halves of the same fraction.
 *
 *   COUNT leg  (`consumed` + `unit`, ceiling in `allowance`) — a measurement WE made.
 *     Claude Code. We sum the tokens we captured in the trailing window. That is a
 *     real numerator with NO denominator: Anthropic does not publish the ceiling and
 *     it is not in the local files, so `allowance` stays null and a % NEVER renders.
 *
 *   RATIO leg  (`usedPercent`) — a measurement the PROVIDER made.
 *     Codex. Its `token_count` rows carry a provider-computed `used_percent` against
 *     OpenAI's real limit. That is a finished ratio with NEITHER TERM: there is no
 *     absolute consumed and no absolute allowance anywhere in the rollout. So
 *     `consumed` is null and a token count NEVER renders.
 *
 * THE INVARIANT: exactly one leg is populated. Never both, never neither.
 *   count → `consumed != null && unit != null`, `usedPercent == null`
 *   ratio → `usedPercent != null`, `consumed == null && unit == null && allowance == null`
 *
 * A ratio is never summed, never converted into a count, and never manufactured from
 * a count that has no ceiling. A count is never rendered as a percentage unless
 * `allowance` is real. This is the same "a rate needs both legs" rule that governs
 * capabilities.ts, applied to quota: a percentage needs a numerator AND a denominator,
 * and neither tool has both.
 *
 * ── WHY `consumed` IS NULLABLE, WHICH IS THE LOAD-BEARING PART ───────────────
 * It used to be a required `number`, back when Claude was the only filler and always
 * had one. Codex has no consumed AT ALL. Not zero — absent. Forcing it to carry a
 * number nobody measured is exactly the `costUsd: 0` trap that capabilities.ts already
 * names: "a schema-required zero, not a measurement", which every downstream sum then
 * trusts. Nullable makes the dishonest render UNAVAILABLE rather than merely
 * discouraged: a consumer that wants to sum or format a count reaches for `consumed`,
 * gets null, and the compiler forces it to say what it means.
 *
 * Filling `consumed: 2, allowance: 100, unit: "tokens"` from a percentage would claim
 * a unit Codex never reported and render "you used 2 of 100 tokens". It is the same
 * class of fabrication as a success-only 0% error rate, and it is banned here.
 *
 * ── COVERAGE AND FRESHNESS ARE DIFFERENT AXES ────────────────────────────────
 * They were conflated while Claude was the only reading, because Claude's is
 * recomputed to `now` on every build and so is fresh by construction. Codex's is a
 * SNAPSHOT taken at `observedAt` and rendered later, which forces them apart:
 *
 *   `coverageComplete` — what the number COUNTS. False for Claude forever (the account
 *     limit is shared with claude.ai, which Seorak cannot see, so `consumed` is a lower
 *     bound structurally, not from a bug). True for Codex: the provider's percentage
 *     counts ALL usage on that limit, including ChatGPT, so it is authoritative.
 *
 *   `observedAt` — when the number was TRUE. Null for a continuously recomputed
 *     reading (Claude). Non-null for a provider snapshot (Codex), so a surface can say
 *     "as of" instead of implying the number is current.
 *
 * Codex is the first reading that is COMPLETE BUT NOT CURRENT. Both fields are needed
 * to say that, and neither one alone can.
 *
 * `resetsAt` is the LIVENESS arbiter and needs no staleness constant: a snapshot is
 * dead once `now >= resetsAt`, because the window it describes no longer exists. A
 * dead reading is dropped, never rendered. (This is not hypothetical: the live corpus
 * holds a 50% five-hour reading whose window rolled over 18 hours earlier.)
 *
 * Publish-safe: counts + a salted-free tool id + closed enums, no content.
 */
export interface UsageAllowance {
  /** Which agent/tool this window belongs to. */
  tool: AgentId;
  /** The window this reading covers. Both are FIXED windows, independent of the
   *  dashboard's rangeDays. Bucketed by the provider's own window length where the
   *  provider states one, never by its position in the payload. */
  period: "rolling-5h" | "weekly";

  // ── COUNT leg ──────────────────────────────────────────────────────────────
  /** Units WE measured in the trailing window. A real count (0 is a measured zero,
   *  never a stand-in), and a LOWER BOUND when `coverageComplete` is false.
   *
   *  NULL when the tool reports no absolute count at all — Codex reports a finished
   *  ratio and no terms. Null is the honest answer there, and it is what stops a
   *  percentage from being smuggled into a slot every consumer treats as summable. */
  consumed: number | null;
  /** The unit of `consumed`. NULL exactly when `consumed` is null: a unit is a property
   *  of a count, so they live and die together. "percent" is deliberately NOT a member —
   *  a percent is a ratio, not a unit of consumption, and admitting it here would invite
   *  `consumed` to hold one. The ratio has its own slot. */
  unit: "tokens" | "requests" | "messages" | null;
  /** The window ceiling for `consumed`, or null until it is HONESTLY known (a user-picked
   *  plan estimate or a provider-auth read). NEVER invented, so a "% used" derived as
   *  `consumed / allowance` renders only once a real ceiling exists. Always null on a
   *  ratio reading, which has no absolute terms to put a ceiling on. */
  allowance: number | null;

  // ── RATIO leg ──────────────────────────────────────────────────────────────
  /** The PROVIDER's own computed share of the window, 0..100, for a tool that hands us
   *  a finished ratio instead of a count (Codex's `used_percent`).
   *
   *  NEVER derived from `consumed / allowance` — that derivation belongs to the surface
   *  and only runs when both terms are real. This field means "the provider told us",
   *  and nothing else may write it. It is never summed and never averaged across tools. */
  usedPercent: number | null;

  // ── Provenance ─────────────────────────────────────────────────────────────
  /** When the window resets, or null until it is known. On a snapshot reading this is
   *  also the liveness arbiter: once it has passed, the reading is dead and is dropped. */
  resetsAt: IsoTimestamp | null;
  /** When this reading was TRUE. Null for a reading recomputed to `now` on every build
   *  (Claude's trailing sum). Non-null for a provider snapshot observed in the past, so
   *  the surface can render an honest "as of" instead of implying it is current. */
  observedAt: IsoTimestamp | null;
  /** How the reading's AUTHORITY was derived. ("How `allowance` was derived" until Codex
   *  arrived with a provider-given ratio and a null allowance — the field has always been
   *  about where the authoritative number came from, and a ratio is one.)
   *    - `none`            no ceiling known and no provider figure. Claude today.
   *    - `self-calibrated` a ceiling inferred from the user's own recent peak.
   *    - `plan-estimate`   a ceiling from a user-picked plan. Caveated, never exact.
   *    - `provider-auth`   the provider computed it against its own real limit. Codex. */
  source: "none" | "self-calibrated" | "plan-estimate" | "provider-auth";
  /** false when the number cannot be vouched as the WHOLE window. Fixed false for Claude
   *  (claude.ai usage is invisible to us, so `consumed` is structurally a lower bound and
   *  the surface reads it as "at least" / "Claude Code only"). True for a provider ratio,
   *  which counts every bit of usage on that limit whether Seorak saw it or not.
   *
   *  This says what the number COUNTS, not when it was true. See `observedAt`. */
  coverageComplete: boolean;
}

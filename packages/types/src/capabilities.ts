/**
 * capabilities.ts — what a tool can MEASURE, as a contract rather than a claim.
 *
 * The bug this module exists to kill: a
 * capability used to be a flag that travelled beside the data without ever shaping
 * it. `hasErrored` was written onto every session for months and read by exactly
 * zero lines of code. A flag nobody reads cannot stop a fabricated number, so the
 * cure is not more flags, it is fewer flags that are actually consulted.
 *
 * Every field below has a live consumer. When a new one earns one, it lands here
 * WITH that consumer, never before.
 *
 * ── A RATE NEEDS BOTH LEGS ────────────────────────────────────────────────────
 * The load-bearing idea. An error rate divides failures by attempts, so it is only
 * honest if the tool reports BOTH outcomes. A tool that only ever tells us about
 * failures pins the rate at 100%; one that only reports successes pins it at 0%.
 * Neither is a measurement. `toolResult` is what lets the aggregation layer refuse
 * to render a rate it cannot honestly compute, instead of quietly publishing 0%.
 *
 * Publish-safe: descriptive tool capability facts only. Evaluation stays in the
 * worker; shared public defaults and vendor prices live in their owning modules.
 */
import type { AgentId } from "./agent.ts";

/**
 * How a tool's dollar figure comes to exist.
 *   - `billed`    — the tool reports what you were actually charged. NOTHING does.
 *   - `estimated` — we derive it: tokens x list price. Claude Code, and Codex.
 *   - `none`      — no token path, so no dollars. Never a $0.
 *
 * This is an ENUM and not a boolean on purpose. `hasCost: true` invited every
 * reader to believe the number was a bill. It never was, for any tool, and the
 * collector cannot tell a subscription seat from an API key (see pricing.ts).
 */
export type CostCapability = "billed" | "estimated" | "none";

/**
 * Which legs of a tool call's outcome the adapter can observe.
 *   - `both`          — success AND failure are both reported. Rates are honest.
 *   - `failures-only` — we hear about failures; successes are silent.
 *   - `passes-only`   — we hear about successes; failures are silent.
 *   - `none`          — no result signal at all.
 *
 * `both` is the ONLY value from which a rate may be computed. The other three
 * still support a COUNT (failures-only can honestly say "3 errors"), which is why
 * this is not simply `hasToolResult: boolean`.
 */
export type ToolResultCapability = "both" | "failures-only" | "passes-only" | "none";

/**
 * How a session's END instant comes to exist.
 *   - `measured` — the tool reports its own end (Claude Code's SessionEnd hook).
 *   - `inferred` — no end signal; the worker's reaper closes the session after
 *     idle, so the duration is an idle-horizon estimate, never a reading.
 */
export type DurationCapability = "measured" | "inferred";

/**
 * WHERE a tool's cost data lives. Not whether it can price (that is `cost`), but at what
 * GRAIN the number exists.
 *
 *   - `call`    — on each tool.call. Claude Code's hook fires per call with a real
 *                 per-call usage delta, so every row carries its own money.
 *   - `session` — on a session-scoped carrier only. Codex's `token_count` rows carry NO
 *                 call id, so per-call cost does not exist for it; the money rides
 *                 `session.tokens`.
 *
 * THIS DISTINCTION IS LOAD-BEARING AND IT IS EASY TO MISS. `cost: 'estimated'` says the
 * tool CAN price its work. It does NOT say the cost is on the row in front of you. A
 * session-costed tool's `tool.call` rows still carry `costUsd: 0` — a schema-required
 * zero, not a measurement — because `ToolCallEvent.costUsd` is a non-optional number.
 * Any per-call dollar aggregate that reads those zeros publishes a FABRICATED $0.
 *
 * That is not hypothetical: flipping Codex to `cost: 'estimated'` without this axis
 * immediately re-broke the daily cost trend (a Codex-only day rendered $0.00), and
 * `capability-gate-rows.test.ts` caught it. `canPriceWork` answers "may this tool's work
 * enter a dollar sum at all"; `pricesPerCall` answers "may THIS ROW", and the per-call
 * aggregates must ask the second one.
 */
export type CostScope = "call" | "session";

/**
 * WHICH LEG of a usage-headroom reading a tool can report (`UsageAllowance` in
 * `usage-allowance.ts`; docs/specs/multi-tool.md). This is the both-legs rule applied
 * to quota: a percentage
 * needs a numerator AND a denominator, and NEITHER tool we ship has both.
 *
 *   - `count` — the tool leaks a usable COUNT and no ceiling. Claude Code: we sum the
 *     tokens we captured, which is a real numerator, but Anthropic publishes no limit
 *     and it is not in the local files. So a % can never render, only a count.
 *   - `ratio` — the provider hands us a finished PERCENTAGE and neither term. Codex:
 *     `used_percent` against OpenAI's real limit, complete and authoritative, with no
 *     absolute consumed or allowance anywhere in the rollout. So a token count can
 *     never render, only a gauge.
 *   - `none` — no usage window is observable at all.
 *
 * An ENUM and not `hasUsageWindow: boolean` for the same reason `hasCost` became
 * `CostCapability`: a boolean flattens the distinction that actually matters. "Claude
 * has a usage window" and "Codex has a usage window" are both true and mean opposite
 * things, and a surface that cannot tell them apart will render one as the other.
 */
export type UsageWindowCapability = "count" | "ratio" | "none";

/**
 * SessionCapabilities — written once at `session.start` by the active adapter and
 * never mutated. It disambiguates a null aggregate: a null cost means "this tool
 * cannot price itself" (`cost: 'none'`) rather than "this session spent nothing".
 */
export interface SessionCapabilities {
  /** Input/output token counts are reported. Gates the token sums. */
  hasTokens: boolean;
  /**
   * Cache-read tokens are reported SEPARATELY from input tokens.
   *
   * Distinct from `hasTokens` for a reason that bites: the cache-reuse ratio is
   * `cacheRead / (cacheRead + input)`. A tool that reports input tokens but no
   * cache breakdown contributes 0 to the numerator and its full input to the
   * denominator, which is a fabricated 0% reuse, not a measurement. Such a
   * session must leave the ratio entirely rather than drag it down.
   */
  hasCacheTokens: boolean;
  cost: CostCapability;
  toolResult: ToolResultCapability;
  /**
   * The three ledger fields below are OPTIONAL on the wire: rows written before
   * they existed carry none of them, and `resolveCapabilities` falls back to the
   * registry (which always carries them). Their live consumer is the Agents
   * coverage ledger — the panel that explains why a compare cell is empty.
   */
  /** Can the tool say WHY a session ended (its own end event carries a reason)?
   *  Claude Code's SessionEnd hook does; a Codex rollout has no end row at all,
   *  so its sessions are reaper-closed with no reason to report. */
  endReason?: boolean;
  /** Whether session duration is a reading or an idle-horizon estimate. */
  duration?: DurationCapability;
  /** Which legs of a VERIFICATION run (test/build/typecheck/lint) the adapter can
   *  observe. Same both-legs rule as `toolResult`: only `both` may back a pass
   *  rate. Codex passive capture is `none` — the rollout's success-only patch
   *  events would pin a fabricated 100%, so the leg stays off permanently until
   *  a real result signal exists. */
  verification?: ToolResultCapability;
  /** At what grain this tool's cost EXISTS (see CostScope). Defaults to 'call', which
   *  is what every pre-Codex row means: absent = the historical claude-code shape. */
  costScope?: CostScope;
  /** Which leg of a usage-headroom reading this tool can report (see
   *  UsageWindowCapability). Its live consumer is the worker's count builder, which
   *  admits a tool's rows into the trailing-token sum ONLY on 'count' — replacing a
   *  hardcoded "is this claude-code?" check that would have silently swallowed Codex
   *  the moment its token carrier landed. */
  usageWindow?: UsageWindowCapability;
}

/**
 * The normalized capability contract returned by current worker projections.
 *
 * Stored session-start rows may omit fields that did not exist when they were
 * written, so `SessionCapabilities` remains the storage/input shape until that
 * retained history ages out. Every response projection resolves that input
 * before it crosses an API boundary and therefore carries this complete shape.
 */
export interface ResolvedSessionCapabilities extends SessionCapabilities {
  endReason: boolean;
  duration: DurationCapability;
  verification: ToolResultCapability;
  costScope: CostScope;
  usageWindow: UsageWindowCapability;
}

/** Closed value sets, for the collector's emit-time value pins. */
export const COST_CAPABILITIES: readonly CostCapability[] = ["billed", "estimated", "none"];
export const TOOL_RESULT_CAPABILITIES: readonly ToolResultCapability[] = [
  "both",
  "failures-only",
  "passes-only",
  "none",
];
export const DURATION_CAPABILITIES: readonly DurationCapability[] = ["measured", "inferred"];
export const COST_SCOPES: readonly CostScope[] = ["call", "session"];
export const USAGE_WINDOW_CAPABILITIES: readonly UsageWindowCapability[] = [
  "count",
  "ratio",
  "none",
];

/** A tool that can tell us nothing. The floor for anything we do not recognise. */
export const NO_CAPABILITIES: ResolvedSessionCapabilities = {
  hasTokens: false,
  hasCacheTokens: false,
  cost: "none",
  toolResult: "none",
  endReason: false,
  duration: "inferred",
  verification: "none",
  costScope: "call",
  usageWindow: "none",
};

/**
 * What we know about each agent we ship an adapter for.
 *
 * claude-code: hooks carry input/output/cache token counts; cost is DERIVED from
 * them at list price and is never a bill; `PostToolUse` fires on success and
 * `PostToolUseFailure` on non-zero exit, so both legs of a tool result are
 * observable. (The pass leg was being DROPPED by our own hook code until it was
 * repaired on 2026-07-09. That was a bug in us, never a limit of the tool, which
 * is why `toolResult` is 'both': this field describes what the TOOL can report,
 * not how much of it we happen to have already logged.)
 *
 * codex: tokens, the cache-read split, and cost are real only because their
 * capture plumbing landed with the capability. Flipping a capability without
 * that plumbing is forbidden: `hasTokens: true` with no tokens is a lie the
 * entire read path trusts. They ride the `session.tokens` carrier, a
 * cumulative per-model snapshot, with the cache-EXCLUSIVE de-inclusion done at the
 * adapter (Codex's `input_tokens` INCLUDES its `cached_input_tokens` — a field-for-field
 * copy would double-count the cache reads and fabricate the reuse ratio).
 *
 * `cost: 'estimated'` says the tool CAN price its work, not that every session shows a
 * dollar figure. A session on a model with no published rate still reads honest-null and
 * raises the `costPartial` marker; the tool-capability axis and the model-price axis are
 * separate, which is the "none and unknown are different cells" rule.
 *
 * Still false, and one of them permanently:
 * - `verification` stays 'none' — the rollout's success-only patch events would pin a
 *   fabricated 100% pass rate. It needs a real result signal (Phase 3).
 * - `endReason` is false FOREVER. Codex writes no session-end record at all; the file
 *   simply stops. We can infer WHEN a session went idle (the reaper does) but never WHY.
 *   A `turn_aborted` is a TURN abort, not a session end, and Claude's SessionEndReason
 *   union is Claude-specific — mapping one onto the other would be a category error.
 *
 * `toolResult` is 'both' because the exec header carries a real exit code for BOTH legs
 * — the collector still OMITS `errored` until the Phase 3 guard and the worker's
 * agent-partitioned error rate land together, and rates key on PRESENCE, so 'both' never
 * fabricates a rate meanwhile.
 *
 * 2026-07-14 (measured): Codex 0.144.3+ routes ALL interactive shell work through the
 * custom_tool_call exec JS sandbox, so exec_command/shell function_call rows (the only
 * errored-stampable shapes, ADR-C5) no longer occur on current versions. `toolResult` stays 'both': the
 * capability describes what the tool CAN report, and rates key on presence, so the
 * rate reads honest-null while the coverage ledger discloses the gap (ADR-C14
 * forbids stamping the sandbox).
 */
export const CAPABILITY_REGISTRY: Readonly<
  Record<string, ResolvedSessionCapabilities>
> = {
  "claude-code": {
    hasTokens: true,
    hasCacheTokens: true,
    cost: "estimated",
    toolResult: "both",
    endReason: true,
    duration: "measured",
    verification: "both",
    // Claude's hook fires per tool call with a real per-call usage delta
    // (consumeUsageSince), so every tool.call row carries its own money.
    costScope: "call",
    // A numerator with no denominator: the tokens are ours to sum, the ceiling is not
    // published and is not in the local files, so a % never renders for Claude.
    usageWindow: "count",
  },
  codex: {
    hasTokens: true,
    hasCacheTokens: true,
    cost: "estimated",
    toolResult: "both",
    endReason: false,
    duration: "inferred",
    verification: "none",
    // Codex's token_count rows carry NO call id (0 of 344 on 0.144.1), so per-call cost
    // does not exist for it. Its money rides `session.tokens`, and its tool.call rows
    // carry a schema zero that no per-call dollar aggregate may read.
    costScope: "session",
    // A finished ratio with neither term. `rate_limits.used_percent` on the same
    // `token_count` rows, computed by OpenAI against the real limit, so it counts usage
    // Seorak never saw (ChatGPT on the same plan) and is COMPLETE where Claude's is a
    // lower bound. There is no absolute consumed or allowance anywhere in the rollout,
    // so a token count never renders for Codex. It rides `agent.quota` (ADR-C15).
    usageWindow: "ratio",
  },
};

/**
 * The authority on what a session could measure.
 *
 * A DECLARED capability set is the adapter's own word, and we take it: the
 * adapter is the only code that knows what its tool emitted, and the emit
 * allowlist has already value-pinned every field.
 *
 * An ABSENT set is not a claim of incapability. It is a row written before the
 * field existed, which is what every real production `session.start` looks like
 * (`sessions.ts` omits the key when the collector did not send one). Defaulting
 * those to "incapable" would silently empty months of cost history, so we fall
 * back to what we know about that agent.
 *
 * An agent we do not recognise, declaring nothing, gets nothing. That is the
 * fail-closed case, and it is the one that matters: a half-built adapter yields
 * honest-empty aggregates instead of a fabricated cross-tool blend.
 */
export function resolveCapabilities(
  agent: AgentId,
  declared?: SessionCapabilities,
): ResolvedSessionCapabilities {
  const known = CAPABILITY_REGISTRY[agent] ?? NO_CAPABILITIES;
  if (!declared) return known;
  // Normalized FIELD BY FIELD: a declared field wins only when it speaks the
  // current vocabulary. Real KV rows from 2026-05/06 declare the LEGACY shape
  // ({hasTokens, hasCost, hasErrored}) — in today's vocabulary those fields are
  // absent, and absence is not a claim, so each falls back to what we know
  // about the agent. Building the object explicitly (never spreading declared)
  // also keeps foreign legacy keys off every wire this resolution reaches.
  // The trailing literals are the NO_CAPABILITIES floor — reached only for an
  // unrecognised agent, where claiming nothing is the honest default.
  return {
    hasTokens:
      typeof declared.hasTokens === "boolean" ? declared.hasTokens : known.hasTokens,
    hasCacheTokens:
      typeof declared.hasCacheTokens === "boolean"
        ? declared.hasCacheTokens
        : known.hasCacheTokens,
    cost: COST_CAPABILITIES.includes(declared.cost) ? declared.cost : known.cost,
    toolResult: TOOL_RESULT_CAPABILITIES.includes(declared.toolResult)
      ? declared.toolResult
      : known.toolResult,
    endReason:
      typeof declared.endReason === "boolean"
        ? declared.endReason
        : known.endReason ?? false,
    duration:
      declared.duration !== undefined && DURATION_CAPABILITIES.includes(declared.duration)
        ? declared.duration
        : known.duration ?? "inferred",
    verification:
      declared.verification !== undefined &&
      TOOL_RESULT_CAPABILITIES.includes(declared.verification)
        ? declared.verification
        : known.verification ?? "none",
    costScope:
      declared.costScope !== undefined && COST_SCOPES.includes(declared.costScope)
        ? declared.costScope
        : known.costScope ?? "call",
    usageWindow:
      declared.usageWindow !== undefined &&
      USAGE_WINDOW_CAPABILITIES.includes(declared.usageWindow)
        ? declared.usageWindow
        : known.usageWindow ?? "none",
  };
}

/**
 * May a RATE over tool outcomes be computed from this session's calls?
 * Only when both legs are observable. This is the single place the both-legs rule
 * is expressed; every rate that divides failures by attempts must ask it.
 */
export function canRateToolOutcomes(c: SessionCapabilities): boolean {
  return c.toolResult === "both";
}

/** Does this session contribute to a dollar sum at all? */
export function canPriceWork(c: SessionCapabilities): boolean {
  return c.cost !== "none";
}

/**
 * May one of this session's TOOL.CALL ROWS enter a per-call dollar sum?
 *
 * Stricter than `canPriceWork`, and the difference is the whole point. A session-costed
 * tool (Codex) CAN price its work, so `canPriceWork` is true and its money belongs in the
 * headline. But its cost lives on `session.tokens`, not on the call, and its `tool.call`
 * rows carry a schema-required `costUsd: 0`. A per-call aggregate that admits those rows
 * publishes a measured-looking $0 for work that actually cost money.
 *
 * Every aggregate that derives dollars FROM TOOL.CALL ROWS (the daily cost trend, the
 * period-over-period cost legs, cost-per-edit) must ask THIS, not `canPriceWork`. The
 * session-scoped cost is added back from its own carrier, so the headline stays complete
 * and the trend stays honest.
 */
export function pricesPerCall(c: SessionCapabilities): boolean {
  return c.cost !== "none" && (c.costScope ?? "call") === "call";
}

/**
 * May this session's tokens enter the cache-reuse ratio? Both legs of that ratio
 * (`cacheRead` and `cacheRead + input`) need the cache breakdown, so `hasTokens`
 * alone is not enough.
 */
export function canMeasureCacheReuse(c: SessionCapabilities): boolean {
  return c.hasTokens && c.hasCacheTokens;
}

/**
 * May this tool's rows enter the trailing-token COUNT that backs a usage-headroom
 * reading? Only a tool whose usage leaks as a count we can sum ourselves.
 *
 * This is the gate that used to be a hardcoded `row.agent === "claude-code"` inside the
 * projection. That hardcode was a landmine with a timer on it: its own comment said
 * Codex must stay out "until it has its own token carrier", and the day that carrier
 * landed, nothing would have told the projection to keep excluding it. Codex must stay
 * out FOREVER, not until a milestone — its usage is a provider ratio, and summing a
 * ratio into a token count is a category error, not a phasing question.
 */
export function canCountUsageWindow(c: SessionCapabilities): boolean {
  return (c.usageWindow ?? "none") === "count";
}

/**
 * Does this tool report a PROVIDER-GIVEN percentage of its window? The gate on the
 * ratio builder, and the thing that lets a surface tell "Codex has not reported its
 * limits yet" (honest-empty, data pending) apart from "this tool has no limits to
 * report" (permanently absent, show no gauge at all).
 */
export function hasProviderUsageRatio(c: SessionCapabilities): boolean {
  return (c.usageWindow ?? "none") === "ratio";
}

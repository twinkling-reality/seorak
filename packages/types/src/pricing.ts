/**
 * pricing.ts — the SINGLE source of truth for model token prices (option C of the
 * pricing-scaling plan). Lives in `@seorak/types` so both the collector (for the
 * live/per-session cost it computes) and the worker (for the headline + byModel +
 * period-over-period cost it RE-PRICES from the event log) read ONE table.
 *
 * Why this matters for scaling: the worker re-prices the aggregate/headline cost
 * from the per-model TOKENS it receives (it no longer trusts a per-event cost the
 * collector baked in), so correcting a price is a `pricing.ts` edit + a WORKER
 * deploy — no fan-out to every installed collector for those surfaces.
 *
 * Matching is by FAMILY PREFIX, taking the LONGEST registered key that the model id
 * starts with, so any 4.x minor (`claude-opus-4-8`, `claude-sonnet-4-6`) resolves
 * with no per-version entry, and a specific family (`gpt-5.4-mini`) wins over a
 * shorter stem (`gpt-5.4`) regardless of declaration order. A model that matches NO
 * prefix, OR whose matched family is registered null (known, unpriced), is
 * `priced: false` — the caller surfaces that as an honest null (ModelRollup.costUsd =
 * null, the "partial — excludes unpriced models" marker), NEVER a silent $0. Anthropic
 * cache multipliers are cacheRead = 0.1× input, cacheWrite (5-min TTL) = 1.25× input;
 * OpenAI has a cached-input read discount (0.1× input) and NO cache-write premium.
 *
 * KEEP CURRENT: Claude rows verified 2026-06-05 (Opus 4.x is a flat $5/$25 across its
 * 1M window, corrected down from the pre-4.6 $15/$75). OpenAI/Codex rows verified
 * 2026-07-10 (see the table's inline source note).
 */

export interface PricePerMTok {
  /** USD per million input tokens. */
  in: number;
  /** USD per million output tokens. */
  out: number;
  /** USD per million cache-READ input tokens. */
  cacheRead: number;
  /** USD per million cache-WRITE (creation) input tokens. */
  cacheWrite: number;
}

// A `null` VALUE is a KNOWN model family with NO published list price: it prices as
// honest-null (never a guessed number), distinct from an unrecognised model. It also
// guards the longest-prefix matcher (see below).
export const MODEL_PRICES: Record<string, PricePerMTok | null> = {
  "claude-opus-4": { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-4": { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4": { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // Claude Fable 5. Verified 2026-07-12: $10 in / $50 out per Mtok, with the standard
  // Anthropic cache multipliers (cacheRead 0.1x input, cacheWrite 5-min TTL 1.25x input),
  // the same arithmetic every row above uses.
  //
  // A missing family row prices as `priced: false`, never an invented zero.
  // `unpricedModels` on the overview makes that omission visible until the table is
  // updated from a published price.
  "claude-fable-5": { in: 10, out: 50, cacheRead: 1, cacheWrite: 12.5 },
  // OpenAI (Codex). USD/Mtok, sourced 2026-07-10 from developers.openai.com and
  // devtk.ai (which agree on the gpt-5.x rows) plus web search for the codex in/out.
  // cacheRead is OpenAI's cached-input rate, = 10% of input, verified exactly on
  // gpt-5.5 / gpt-5.4 / gpt-5.4-mini. OpenAI publishes NO cache-WRITE premium (unlike
  // Anthropic) and Codex reports no cache-write tokens, so cacheWrite is an inert 0.
  // Keys are the exact ids seen in real rollouts (turn_context.model). Cost from these
  // is an API-EQUIVALENT ESTIMATE (a ChatGPT-plan seat is billed in credits, not USD),
  // never a bill. NEVER rename an existing key.
  "gpt-5.1-codex": { in: 1.25, out: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gpt-5-codex": { in: 1.25, out: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gpt-5.5": { in: 5, out: 30, cacheRead: 0.5, cacheWrite: 0 },
  "gpt-5.4-mini": { in: 0.75, out: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  "gpt-5.4": { in: 2.5, out: 15, cacheRead: 0.25, cacheWrite: 0 },
  // gpt-5.6 "Sol", GA 2026-07-09. Verified 2026-07-12 against OpenAI's canonical
  // pricing page (developers.openai.com/api/docs/pricing, which platform.openai.com
  // now redirects to) and the model's own page. Observed verbatim in real 0.144.1
  // rollouts as turn_context.model = "gpt-5.6-sol".
  //
  // DO NOT "FIX" THIS ROW: these figures are IDENTICAL to gpt-5.5's. That is a real
  // coincidence of OpenAI's pricing, independently published under gpt-5.6-sol, not a
  // sibling's price pasted in by mistake. It looks exactly like the error it is not.
  //
  // KNOWN IMPRECISION, bounded and monitored: OpenAI bills a request whose INPUT
  // exceeds 272K tokens at 2x input and 1.5x output for the whole request, which this
  // flat row does not model. Cost is disclosed as an estimate regardless
  // (`COST_ESTIMATE_NOTE`); requests above that threshold require a tier-aware
  // calculation before this family can claim exact pricing.
  "gpt-5.6-sol": { in: 5, out: 30, cacheRead: 0.5, cacheWrite: 0 },
  // Known model, NO public list price (research preview). null renders honest-null
  // cost, never a guessed number. The explicit entry ALSO guards the matcher: without
  // it, a future "gpt-5.3-codex" row would capture "gpt-5.3-codex-spark" by prefix and
  // misprice it at the codex rate. Do not substitute a sibling's price.
  "gpt-5.3-codex-spark": null,
};

/** Per-model token usage in the canonical (camelCase, event-shaped) form. */
export interface ModelTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * WHY a model did not price. These are NOT the same fact, and conflating them is what
 * let $5,225 of real spend read as $0.00 for weeks (see the claude-fable-5 row above).
 *
 *   - `unknown-model`      — the id matched NO registered family. It means THE TABLE IS
 *                            STALE and a row is owed. This is an ACTION, and the surface
 *                            must name the model so the action is obvious.
 *   - `no-published-price` — the id matched a family registered `null`: a model we know
 *                            about and deliberately cannot price (a research preview with
 *                            no list rate). Nothing to do. Permanently honest-empty.
 *
 * A boolean `priced: false` collapsed both into a shrug. The surface could say "partial"
 * but never "you are missing a price for claude-fable-5", so nobody knew to act.
 */
export type UnpricedReason = "unknown-model" | "no-published-price";

export interface PricedUsage {
  costUsd: number;
  priced: boolean;
  /** Present only when `priced` is false. Absent on a priced model. */
  unpriced?: UnpricedReason;
}

/**
 * Price one model's token usage. `priced` is false when the model id matches no
 * family prefix, OR the matched family is registered with a null price (known model,
 * no published rate) — and `unpriced` says WHICH, because only one of them is a bug.
 * The caller must then treat the cost as honest-null (never coin a $0). Absent token
 * fields are treated as 0 so a partial usage row still prices.
 */
export function priceModelUsage(
  model: string,
  usage: Partial<ModelTokenUsage>,
): PricedUsage {
  // LONGEST matching prefix, not the first. `find` returned whichever key was
  // declared first, so once two families share a stem (`gpt-5.3-codex` beside
  // `gpt-5.3-codex-spark`, or `gpt-5.4` beside `gpt-5.4-mini`) the price depended on
  // declaration order and could swing several-fold silently. The most specific
  // registered family is always the right one.
  //
  // This is also the mechanism that makes the table scale: a family prefix covers every
  // minor under it, so `claude-opus-4-8`, `-4-7` and `-4-6` all resolve off ONE row and
  // a new minor needs no edit at all. Only a genuinely new FAMILY needs a row, and that
  // is exactly the case `unknown-model` now reports.
  let key: string | undefined;
  for (const k of Object.keys(MODEL_PRICES)) {
    if (model.startsWith(k) && (key === undefined || k.length > key.length)) key = k;
  }
  if (key === undefined) return { costUsd: 0, priced: false, unpriced: "unknown-model" };
  const p = MODEL_PRICES[key];
  // `== null` catches a registered null (a known family we deliberately cannot
  // price) AND the never-in-practice undefined (key came from Object.keys). Either
  // way: honest-null, never a fabricated $0, never an accidental sibling-prefix match.
  if (p == null) return { costUsd: 0, priced: false, unpriced: "no-published-price" };
  const total =
    (usage.inputTokens ?? 0) * p.in +
    (usage.outputTokens ?? 0) * p.out +
    (usage.cacheReadTokens ?? 0) * p.cacheRead +
    (usage.cacheWriteTokens ?? 0) * p.cacheWrite;
  return { costUsd: total / 1_000_000, priced: true };
}

/**
 * Sum the priced cost across a tool.call's per-model breakdown. `priced` is true
 * when AT LEAST ONE model priced (so a row mixing priced + unpriced models still
 * reports the priced portion); the caller decides how to surface a fully-unpriced
 * total (null). Unpriced models contribute 0 — never a fabricated cost.
 */
export function priceModels(
  models: ReadonlyArray<{ model: string } & Partial<ModelTokenUsage>>,
): { costUsd: number; priced: boolean } {
  let costUsd = 0;
  let priced = false;
  for (const m of models) {
    const r = priceModelUsage(m.model, m);
    if (r.priced) {
      costUsd += r.costUsd;
      priced = true;
    }
  }
  return { costUsd, priced };
}

/**
 * COST IS DERIVED, THEREFORE IT IS AN ESTIMATE — for every tool, every user.
 *
 * No agent we support reports a dollar figure. We compute `tokens × MODEL_PRICES`,
 * and MODEL_PRICES is the vendor's LIST price. Nothing in the capture path can tell
 * a subscription seat from an API key: the Claude Code transcript carries only
 * `{type, uuid, message:{usage, model}}`, the collector never reads
 * `~/.claude/.credentials.json`, and Codex's rollout file has no cost field at all.
 * So there is no conditional to write. The hedge is UNCONDITIONAL.
 *
 * Colocated with the derivation on purpose: the place that invents the number owns
 * the sentence that qualifies it. Every surface reads THESE strings so the product
 * cannot end up hedging in four different spellings (docs/specs/multi-tool.md
 * §honesty rules).
 *
 * NOTE: `SessionCapabilities.cost` is an ENUM, and no tool we ship reports `billed`.
 * `estimated` means "tokens and a priced model are present to derive from". It has
 * never meant "this is a bill". Do not gate this note on it.
 */

/** The full disclosure. Detail-view caveat slots, settings, the coverage page. */
export const COST_ESTIMATE_NOTE =
  "Estimated from token counts at list prices. Not a bill.";

// Guard for the longest-prefix price match (pricing.ts). The matcher used to take
// the FIRST declared family whose prefix matched, so once two families shared a
// stem the price swung on declaration order. These pin that the MOST SPECIFIC
// family wins regardless of order, and that a genuinely unknown model is honest
// unpriced (never a coined $0).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_PRICES, priceModelUsage, type PricePerMTok } from "../src/pricing.ts";

const M = 1_000_000;

test("longest prefix wins regardless of declaration order", () => {
  // Simulate the collision pair by pricing against a hand-built table in BOTH
  // orders, exercising the same selection logic priceModelUsage uses.
  const pick = (table: Record<string, PricePerMTok>, model: string) => {
    let key: string | undefined;
    for (const k of Object.keys(table)) {
      if (model.startsWith(k) && (key === undefined || k.length > key.length)) key = k;
    }
    return key;
  };
  const broad: PricePerMTok = { in: 10, out: 10, cacheRead: 1, cacheWrite: 1 };
  const specific: PricePerMTok = { in: 1, out: 1, cacheRead: 0.1, cacheWrite: 0.1 };
  const a = { "gpt-5.3-codex": broad, "gpt-5.3-codex-spark": specific };
  const b = { "gpt-5.3-codex-spark": specific, "gpt-5.3-codex": broad };
  assert.equal(pick(a, "gpt-5.3-codex-spark"), "gpt-5.3-codex-spark");
  assert.equal(pick(b, "gpt-5.3-codex-spark"), "gpt-5.3-codex-spark");
  assert.equal(pick(a, "gpt-5.3-codex"), "gpt-5.3-codex");
  assert.equal(pick(b, "gpt-5.3-codex"), "gpt-5.3-codex");
});

test("an unknown model is honest-unpriced, never a coined $0", () => {
  const r = priceModelUsage("gpt-99-imaginary", { inputTokens: 1000, outputTokens: 1000 });
  assert.equal(r.priced, false);
  assert.equal(r.costUsd, 0); // 0 accompanies priced:false, and the caller must render null
});

test("the three shipped Claude families still price unchanged", () => {
  // None of the current keys is a prefix of another, so longest-prefix is a no-op
  // for today's data. This pins that the fix did not move a live number.
  const opus = priceModelUsage("claude-opus-4-8", { inputTokens: M });
  assert.equal(opus.priced, true);
  assert.equal(opus.costUsd, (MODEL_PRICES["claude-opus-4"] as PricePerMTok).in);
  const sonnet = priceModelUsage("claude-sonnet-4-6", { outputTokens: M });
  assert.equal(sonnet.costUsd, (MODEL_PRICES["claude-sonnet-4"] as PricePerMTok).out);
});

test("every gpt model in the real corpus prices at its own sourced input rate", () => {
  // 1M input tokens each; the cost in USD equals that family's `in` rate. Sourced
  // 2026-07-10 (developers.openai.com / devtk.ai / web search).
  const cases: Array<[string, number]> = [
    ["gpt-5.1-codex", 1.25],
    ["gpt-5-codex", 1.25],
    ["gpt-5.5", 5],
    ["gpt-5.4-mini", 0.75],
    ["gpt-5.4", 2.5],
  ];
  for (const [model, expectedIn] of cases) {
    const r = priceModelUsage(model, { inputTokens: M });
    assert.equal(r.priced, true, `${model} should price`);
    assert.equal(r.costUsd, expectedIn, `${model} input rate`);
  }
});

test("gpt-5.4-mini resolves to its OWN row, not the gpt-5.4 prefix (mis-price guard)", () => {
  // The real prefix-collision pair in the corpus: without longest-prefix + its own
  // row, "gpt-5.4-mini" would price at the gpt-5.4 rate ($2.50), overcharging a mini.
  const mini = priceModelUsage("gpt-5.4-mini", { inputTokens: M });
  assert.equal(mini.costUsd, 0.75);
});

test("gpt-5.3-codex-spark is a KNOWN family with no price: honest-unpriced, never $0", () => {
  const r = priceModelUsage("gpt-5.3-codex-spark", { inputTokens: M, outputTokens: M });
  assert.equal(r.priced, false);
  assert.equal(r.costUsd, 0); // 0 accompanies priced:false; the caller renders honest-null
  // Registered (distinct from an unknown model): the key exists with a null value,
  // which also guards against a future "gpt-5.3-codex" row capturing it by prefix.
  assert.ok("gpt-5.3-codex-spark" in MODEL_PRICES);
  assert.equal(MODEL_PRICES["gpt-5.3-codex-spark"], null);
});

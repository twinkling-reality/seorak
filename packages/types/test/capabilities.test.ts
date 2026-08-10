// The capability contract's own guard (docs/specs/multi-tool.md).
//
// `resolveCapabilities` decides, for every session the worker aggregates, what that
// session was able to measure. Get it wrong in one direction and months of real
// cost history silently empty; wrong in the other and an unknown tool's absence of
// data reads as a measured zero. Neither failure is visible in a type, and neither
// throws. They just publish a wrong number. So they are pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_REGISTRY,
  NO_CAPABILITIES,
  canMeasureCacheReuse,
  canPriceWork,
  canRateToolOutcomes,
  resolveCapabilities,
  type SessionCapabilities,
} from "../src/capabilities.ts";

const CC = CAPABILITY_REGISTRY["claude-code"]!;

test("a legacy claude-code row (capabilities ABSENT) resolves to the full claude-code set", () => {
  // This is what EVERY session written before the field shipped looks like: the
  // collector sent no capabilities and `sessions.ts` omits the key. If this ever
  // resolves to NO_CAPABILITIES, `usage.cost.totalUsd` goes null across the whole
  // retention window and the dashboard empties. That is the failure this exists for.
  assert.deepEqual(resolveCapabilities("claude-code", undefined), CC);
  assert.equal(canPriceWork(resolveCapabilities("claude-code", undefined)), true);
});

test("an UNKNOWN agent claiming nothing measures nothing (fail-closed)", () => {
  assert.deepEqual(resolveCapabilities("some-future-tool", undefined), NO_CAPABILITIES);
  assert.equal(canPriceWork(NO_CAPABILITIES), false);
  assert.equal(canRateToolOutcomes(NO_CAPABILITIES), false);
  assert.equal(canMeasureCacheReuse(NO_CAPABILITIES), false);
});

test("a DECLARED set is the adapter's word and wins, even against the registry", () => {
  // The adapter is the only code that knows what its tool actually emitted, and the
  // emit allowlist has already value-pinned every field. A claude-code session that
  // declares it cannot price itself must be believed, not overridden. The ledger
  // fields it did NOT speak about fall back per-field to the registry — absence is
  // a row written before the field existed, not a claim of incapability.
  const declared: SessionCapabilities = {
    hasTokens: true,
    hasCacheTokens: true,
    cost: "none",
    toolResult: "none",
  };
  assert.deepEqual(resolveCapabilities("claude-code", declared), {
    ...declared,
    endReason: true,
    duration: "measured",
    verification: "both",
    costScope: "call",
    // Unspoken, so it falls back to the registry like every other absent ledger field.
    // Claude can sum the tokens it has burned and nobody publishes its ceiling, so it
    // reports a COUNT and never a percentage.
    usageWindow: "count",
  });
  assert.equal(canPriceWork(resolveCapabilities("claude-code", declared)), false);
});

test("a declared LEDGER field wins over the registry too", () => {
  const declared: SessionCapabilities = {
    hasTokens: true,
    hasCacheTokens: true,
    cost: "estimated",
    toolResult: "both",
    endReason: false,
    duration: "inferred",
    verification: "none",
  };
  // costScope and usageWindow are unspoken here, so they fall back to the claude-code
  // registry entry exactly like any other absent field. Absence is not a claim.
  assert.deepEqual(resolveCapabilities("claude-code", declared), {
    ...declared,
    costScope: "call",
    usageWindow: "count",
  });
});

test("a LEGACY-shape declared set (hasCost/hasErrored era) normalizes to the registry", () => {
  // Real KV rows from 2026-05/06 declare {hasTokens, hasCost, hasErrored} — in
  // today's vocabulary every field but hasTokens is ABSENT, and absence is not
  // a claim. The foreign keys must also never survive onto the wire.
  const legacy = {
    hasTokens: true,
    hasCost: true,
    hasErrored: true,
  } as unknown as SessionCapabilities;
  const resolved = resolveCapabilities("claude-code", legacy);
  assert.deepEqual(resolved, CC);
  assert.equal("hasCost" in resolved, false);
  // For an UNKNOWN agent the same legacy shape falls to the floor (fail-closed):
  // its undefined cost used to slip past canPriceWork as fail-OPEN.
  const unknownResolved = resolveCapabilities("mystery-tool", legacy);
  assert.equal(unknownResolved.cost, "none");
  assert.equal(canPriceWork(unknownResolved), false);
});

test("an unknown agent's declared set is honoured (a real adapter, absent from the registry)", () => {
  const declared: SessionCapabilities = {
    hasTokens: true,
    hasCacheTokens: false,
    cost: "estimated",
    toolResult: "passes-only",
  };
  // Core fields verbatim; unspoken ledger fields fall back to the codex registry
  // entry (endReason false, duration inferred, verification none).
  assert.deepEqual(resolveCapabilities("codex", declared), {
    ...declared,
    endReason: false,
    duration: "inferred",
    verification: "none",
    // Codex's token_count rows carry no call id: its cost exists only at SESSION scope.
    costScope: "session",
    // The mirror of Claude above. OpenAI hands Codex a finished percentage of its limit
    // and neither term of it, so Codex reports a RATIO and never a count. Two tools,
    // honest about opposite halves of the same both-legs rule.
    usageWindow: "ratio",
  });
});

// ── A RATE NEEDS BOTH LEGS ────────────────────────────────────────────────────
// The rule the whole contract exists to express. A tool that reports only failures
// pins an error rate at 100%; one that reports only successes pins it at 0%. Both
// are fabrications, and both look exactly like a measurement.
test("only `both` permits a RATE over tool outcomes", () => {
  const caps = (toolResult: SessionCapabilities["toolResult"]): SessionCapabilities => ({
    hasTokens: true,
    hasCacheTokens: true,
    cost: "estimated",
    toolResult,
  });
  assert.equal(canRateToolOutcomes(caps("both")), true);
  assert.equal(canRateToolOutcomes(caps("failures-only")), false);
  assert.equal(canRateToolOutcomes(caps("passes-only")), false);
  assert.equal(canRateToolOutcomes(caps("none")), false);
});

test("cache-reuse needs the cache breakdown, not merely tokens", () => {
  // cacheRead / (cacheRead + input). A tool reporting input tokens and no cache
  // split would contribute 0 to the numerator and its input to the denominator,
  // dragging the ratio toward a fabricated 0% reuse.
  const tokensNoCache: SessionCapabilities = {
    hasTokens: true,
    hasCacheTokens: false,
    cost: "estimated",
    toolResult: "both",
  };
  assert.equal(canMeasureCacheReuse(tokensNoCache), false);
  assert.equal(canMeasureCacheReuse(CC), true);
});

// ── Honesty claims about the shipped registry ────────────────────────────────
test("no agent in the registry claims its dollars are a bill", () => {
  for (const [agent, caps] of Object.entries(CAPABILITY_REGISTRY)) {
    assert.notEqual(caps.cost, "billed", `${agent} must not claim 'billed'`);
  }
  // Cost is tokens x list price. The collector cannot tell a subscription seat from
  // an API key for ANY tool, so `billed` is unreachable by construction today.
  assert.equal(CC.cost, "estimated");
});

test("claude-code observes both legs of a tool result", () => {
  // PostToolUse on success, PostToolUseFailure on a non-zero exit. This describes
  // what the TOOL reports, never how much of it we have already logged: the pass
  // leg was dropped by our own hook code until 2026-07-09, which was our bug.
  assert.equal(CC.toolResult, "both");
  assert.equal(canRateToolOutcomes(CC), true);
});

test("NO_CAPABILITIES is the floor: every boolean false, every enum its weakest value", () => {
  assert.deepEqual(NO_CAPABILITIES, {
    hasTokens: false,
    // The floor's costScope is 'call', which is NOT a capability claim — it is the
    // historical default every pre-Codex row means. A tool that can price nothing has
    // no cost to place at any scope, so this field is inert for the floor.
    costScope: "call",
    hasCacheTokens: false,
    cost: "none",
    toolResult: "none",
    endReason: false,
    duration: "inferred",
    verification: "none",
    // The weakest value: a tool we know nothing about reports neither a count nor a
    // ratio of its usage window, so it renders no headroom readout at all.
    usageWindow: "none",
  });
});

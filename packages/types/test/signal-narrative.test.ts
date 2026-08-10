import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSignalBody,
  buildSignalNarrative,
  parseSignalBody,
  SIGNAL_IDS,
  type SignalBodyContext,
} from "../src/notification-catalog.ts";

/** At least one context per signal, including every optional-field branch. */
const CONTEXTS: SignalBodyContext[] = [
  { signalId: "cost_spike", costUsd: 7.97, capUsd: 5 },
  { signalId: "cost_spike", costUsd: 1234.5, capUsd: 1000 },
  { signalId: "high_burn_rate", burnRateUsdPerMin: 0.64, elapsedMinutes: 24 },
  { signalId: "high_burn_rate", burnRateUsdPerMin: 0.5, elapsedMinutes: 0 },
  { signalId: "long_session", elapsedMinutes: 63 },
  { signalId: "stuck_loop", tool: "Bash", count: 3, failing: true },
  { signalId: "stuck_loop", tool: "Read", count: 5, failing: false },
  { signalId: "stuck_loop", tool: "Edit file", count: 4, failing: true },
  { signalId: "went_cold", silentMinutes: 14 },
  { signalId: "session_ended", durationMinutes: 42, costUsd: 3.1, linesAdded: 120, commits: 1 },
  { signalId: "session_ended", durationMinutes: 42, costUsd: 3.1, commits: 2 },
  { signalId: "session_ended", durationMinutes: 42, costUsd: null },
  { signalId: "session_ended", durationMinutes: 8, costUsd: null, linesAdded: 0, commits: 0 },
  { signalId: "daily_cost_cap", totalUsd: 22, capUsd: 20 },
  { signalId: "first_error", tool: "Bash" },
];

/**
 * THE load-bearing test. The narrative voice needs the numbers a fire measured,
 * but a stored fire only kept its push sentence — so the numbers are read back
 * out of that sentence. That is only safe while build and parse agree, and this
 * is what makes them agree: edit a body string and this fails until you edit its
 * pattern too. Without it, a copy tweak would silently start returning null and
 * every fire would quietly fall back to the old stiff wording.
 */
test("every signal body round-trips: parse(build(ctx)) recovers exactly what fired", () => {
  for (const ctx of CONTEXTS) {
    const body = buildSignalBody(ctx);
    const parsed = parseSignalBody(body, ctx.signalId);
    assert.deepEqual(parsed, ctx, `round trip failed for ${ctx.signalId}: ${body}`);
  }
});

test("every signal in the catalog is covered by a round-trip context", () => {
  const covered = new Set(CONTEXTS.map((c) => c.signalId));
  for (const id of SIGNAL_IDS) {
    assert.ok(covered.has(id), `signal "${id}" has no round-trip context`);
  }
});

test("a body that does not match its signal parses to null, never a guessed number", () => {
  assert.equal(parseSignalBody("Some older copy we no longer emit.", "went_cold"), null);
  assert.equal(parseSignalBody("", "cost_spike"), null);
  // A body from the WRONG signal must not be coerced into this one's shape.
  assert.equal(
    parseSignalBody(buildSignalBody({ signalId: "long_session", elapsedMinutes: 9 }), "went_cold"),
    null,
  );
});

// ── The narrative voice ─────────────────────────────────────────────────────

test("the narrative clause reads like a person talking, not like a lock screen", () => {
  const clause = (ctx: SignalBodyContext) => buildSignalNarrative(ctx);

  assert.equal(
    clause({ signalId: "high_burn_rate", burnRateUsdPerMin: 0.64, elapsedMinutes: 24 }),
    "was burning about $0.64 a minute, and had been for 24 minutes",
  );
  assert.equal(
    clause({ signalId: "went_cold", silentMinutes: 14 }),
    "went quiet, with nothing happening for 14 minutes",
  );
  assert.equal(
    clause({ signalId: "cost_spike", costUsd: 7.97, capUsd: 5 }),
    "had run up about $7.97, past the $5.00 cap you set",
  );
  assert.equal(
    clause({ signalId: "stuck_loop", tool: "Bash", count: 3, failing: true }),
    "looked stuck, with Bash failing 3 times in a row",
  );
});

test("a narrative clause is a subject-less past-tense clause, for every signal", () => {
  for (const ctx of CONTEXTS) {
    const clause = buildSignalNarrative(ctx);
    // Subject-less: a surface supplies "seorak" (or "your spend today"), so the
    // clause must not open with a capital or end its own sentence.
    assert.doesNotMatch(clause, /^[A-Z]/, `${ctx.signalId} clause starts a sentence: ${clause}`);
    assert.doesNotMatch(clause, /[.!?]$/, `${ctx.signalId} clause closes itself: ${clause}`);
    // The push voice's telegraphic tics must not leak into prose.
    assert.doesNotMatch(clause, /\/min\b/, `${ctx.signalId} keeps push shorthand: ${clause}`);
    assert.doesNotMatch(clause, /·|—/, `${ctx.signalId} uses a banned separator: ${clause}`);
  }
});

test("every dollar in the narrative voice stays hedged (it is an estimate, not a bill)", () => {
  for (const ctx of CONTEXTS) {
    const clause = buildSignalNarrative(ctx);
    if (!clause.includes("$")) continue;
    assert.match(
      clause,
      /about|estimated/i,
      `unhedged dollar in a narrative clause (reads as a bill): ${clause}`,
    );
  }
});

/**
 * codex-capture-parity.test.ts — the contract-seam guard for CODEX-CAPTURE's new fields.
 *
 * WHY THIS FILE EXISTS, AND IT IS NOT THEORETICAL.
 *
 * The web zod schemas run in zod's default STRIP mode, so any key the worker sends that is
 * not DECLARED in `common.ts` is silently dropped at parse time with **zero diagnostics**
 * (`validateResponse` only warns on a parse *failure*, never on a successful strip). A new
 * field therefore renders empty in production with a green CI.
 *
 * `contract-parity.test.ts` guards that for REQUIRED fields, because its fixture is
 * `satisfies OverviewSnapshot` and a new required field fails to compile until it is
 * carried. It does NOT guard OPTIONAL fields — and both of CODEX-CAPTURE's are optional:
 *
 *   - `usage.cost.unpricedModels[]`  (the models we hold no price row for)
 *   - `capabilities.costScope`       ('call' | 'session')
 *   - `byAgent[].errorRate`          (Phase 3: the per-agent rate + its coverage)
 *
 * The first two were being stripped when this file was written. All 993 web tests were
 * green, because every fixture in the suite was built WITHOUT the fields. That is the same
 * shape as the 2026-07-12 outage, where a demo fixture scrubbed `resume` to match a broken
 * schema and 987 tests passed against a fixture shaped like the bug.
 *
 * A fixture consumes the contract. It never authors it.
 */
import { describe, expect, it } from 'vitest';
import { overviewSnapshotSchema, createEmptyOverview } from '../common.js';

/** What the worker ACTUALLY emits now: a real snapshot carrying both new fields. */
function workerSnapshot(): Record<string, any> {
  const snap = structuredClone(createEmptyOverview(7)) as Record<string, any>;
  snap.usage.cost = {
    totalUsd: 21_905.31,
    sessionsWithCost: 353,
    costPartial: true,
    // The real one. 3.49B tokens on this machine, $5,225 of spend, priced at $0.00 until a
    // row landed. If this field is dropped, the dashboard loses the ONLY thing that tells
    // the buyer a price row is owed, and the under-report goes silent again.
    unpricedModels: [{ model: 'claude-fable-5', tokensTotal: 3_494_614_387 }],
    delta: null,
  };
  snap.tools.byAgent = [
    {
      agent: 'codex',
      sessions: 3,
      activeSessions: 0,
      toolCalls: 103,
      tokensTotal: 2_100_000,
      costUsd: 18,
      lines: null,
      sessionsWithCost: 1,
      lastEventAt: '2026-07-12T08:34:31.000Z',
      erroredPresent: true,
      // Phase 3, and these are the REAL measured shapes from the corpus: Codex errors on
      // 8 of 224 shell calls, and those 224 are only 44% of the 509 calls it made (its
      // `exec` sandbox reports nothing but "Script completed", and its patch events are
      // success-only). `returned / calls` is the coverage the surface is REQUIRED to show
      // beside the rate — without it, "3.6% errored" reads as a claim about all of Codex's
      // work when it is a claim about the 44% of it that reports a result at all.
      errorRate: { rate: 8 / 224, errored: 8, returned: 224, calls: 509 },
      capabilities: {
        hasTokens: true,
        hasCacheTokens: true,
        cost: 'estimated',
        toolResult: 'both',
        endReason: false,
        duration: 'inferred',
        verification: 'none',
        costScope: 'session',
        usageWindow: 'ratio',
      },
    },
  ];
  return snap;
}

describe('CODEX-CAPTURE: the worker’s new fields SURVIVE the web schema', () => {
  it('unpricedModels is not stripped (the $5,225 field)', () => {
    const parsed: any = overviewSnapshotSchema.parse(workerSnapshot());
    expect(parsed.usage.cost.unpricedModels).toEqual([
      { model: 'claude-fable-5', tokensTotal: 3_494_614_387 },
    ]);
  });

  it('costScope is not stripped (the per-call vs per-session cost grain)', () => {
    const parsed: any = overviewSnapshotSchema.parse(workerSnapshot());
    expect(parsed.tools.byAgent[0].capabilities.costScope).toBe('session');
  });

  it('an UNKNOWN costScope costs its own FIELD, never the agents section', () => {
    // The resume-bug lesson applied forward. The day a third cost grain exists, an older
    // web build meets a value its enum has never heard of. A bare enum would fail the
    // parse; because capabilities sits inside byAgent, that failure would take the whole
    // agents section with it. It must degrade to the field.
    const drifted = workerSnapshot();
    drifted.tools.byAgent[0].capabilities.costScope = 'per-turn-from-the-future';

    const parsed: any = overviewSnapshotSchema.parse(drifted);
    expect(parsed.tools.byAgent).toHaveLength(1); // section intact
    expect(parsed.tools.byAgent[0].costUsd).toBe(18); // its data intact
    expect(parsed.tools.byAgent[0].capabilities.costScope).toBe('call'); // degraded to the floor
  });

  it('usageWindow is not stripped (the count-vs-ratio headroom leg)', () => {
    const parsed: any = overviewSnapshotSchema.parse(workerSnapshot());
    expect(parsed.tools.byAgent[0].capabilities.usageWindow).toBe('ratio');
  });

  it('an UNKNOWN usageWindow costs its own FIELD, never the agents section', () => {
    // Same forward-drift shape as costScope: a newer worker's third leg must
    // degrade to 'none' at this field, not fail the parse around it.
    const drifted = workerSnapshot();
    drifted.tools.byAgent[0].capabilities.usageWindow = 'quota-from-the-future';

    const parsed: any = overviewSnapshotSchema.parse(drifted);
    expect(parsed.tools.byAgent).toHaveLength(1); // section intact
    expect(parsed.tools.byAgent[0].costUsd).toBe(18); // its data intact
    expect(parsed.tools.byAgent[0].capabilities.usageWindow).toBe('none'); // degraded to the floor
  });

  it('a MALFORMED unpricedModels entry never blanks the cost headline', () => {
    const bad = workerSnapshot();
    bad.usage.cost.unpricedModels = [{ model: 42, tokensTotal: 'lots' }];

    const parsed: any = overviewSnapshotSchema.parse(bad);
    // The headline is the number the buyer reads first. It must survive a bad row in the
    // field whose only job is to EXPLAIN why the headline is incomplete.
    expect(parsed.usage.cost.totalUsd).toBe(21_905.31);
    expect(parsed.usage.cost.costPartial).toBe(true);
    expect(parsed.usage.cost.unpricedModels).toEqual([]);
  });

  it('errorRate is not stripped, and it carries its COVERAGE, not just the rate', () => {
    const parsed: any = overviewSnapshotSchema.parse(workerSnapshot());
    const codex = parsed.tools.byAgent[0];

    expect(codex.errorRate).toEqual({ rate: 8 / 224, errored: 8, returned: 224, calls: 509 });

    // The coverage is the whole point of the field. A rate that arrives without its
    // denominator is a rate the surface cannot honestly caveat, and F9 is precisely the
    // ledger reading "pass and fail captured" while 56% of the calls said nothing.
    expect(codex.errorRate.returned).toBeLessThan(codex.errorRate.calls);
    expect(codex.errorRate.returned / codex.errorRate.calls).toBeCloseTo(0.44, 2);
  });

  it('a MALFORMED errorRate costs its own field, never the agents section', () => {
    const bad = workerSnapshot();
    bad.tools.byAgent[0].errorRate = { rate: 'quite high', errored: null };

    const parsed: any = overviewSnapshotSchema.parse(bad);
    expect(parsed.tools.byAgent).toHaveLength(1); // section intact
    expect(parsed.tools.byAgent[0].toolCalls).toBe(103); // its data intact
    expect(parsed.tools.byAgent[0].errorRate).toBeUndefined(); // absent, never a coerced 0
  });
});

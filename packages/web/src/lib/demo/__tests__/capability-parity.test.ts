import { describe, expect, it } from 'vitest';
import { CAPABILITY_REGISTRY } from '@seorak/types';
import { createBaselineOverview } from '../baseline.js';

/**
 * The guard that was missing for a whole phase.
 *
 * `packages/web/src/lib/demo/baseline.ts` HAND-WRITES a capability object per agent,
 * and nothing checked it against the shipped contract. So the fixture and its test
 * pinned each other to a contract the product had already left behind: the demo said
 * `cost: 'none'` for months after Codex started pricing its work, and every reader and
 * every test that trusted the fixture learned the wrong shape. That is the same class
 * of failure that blanked the Model pillar (CONTRACT-SEAM-AUDIT F2).
 *
 * A fixture CONSUMES the contract. It never authors it. This test is what makes that
 * true mechanically: flip a field in CAPABILITY_REGISTRY and the demo goes red until
 * it is told, instead of silently teaching the old shape forever.
 *
 * It asserts EQUALITY, not a subset. A demo that omits a field the registry declares
 * is exactly the drift being guarded against — the omission is what let `usageWindow`
 * (and `costScope` before it) sail through green.
 */
describe('demo capabilities EQUAL the shipped capability contract', () => {
  const base = createBaselineOverview();

  it('declares an agent the registry knows, for every agent in the fixture', () => {
    expect(base.tools.byAgent.length).toBeGreaterThan(0);
    for (const row of base.tools.byAgent) {
      expect(
        CAPABILITY_REGISTRY[row.agent],
        `demo agent "${row.agent}" is not in CAPABILITY_REGISTRY`,
      ).toBeDefined();
    }
  });

  it('carries capabilities byte-for-byte identical to CAPABILITY_REGISTRY', () => {
    for (const row of base.tools.byAgent) {
      expect(
        row.capabilities,
        `demo capabilities for "${row.agent}" have drifted from the shipped contract`,
      ).toEqual(CAPABILITY_REGISTRY[row.agent]);
    }
  });

  it('covers every agent the registry ships an adapter for', () => {
    // The other direction: a NEW agent in the registry that the demo never grew a row
    // for would leave that adapter's shape unexercised by every demo-backed test.
    const demoAgents = new Set(base.tools.byAgent.map((r) => r.agent));
    for (const agent of Object.keys(CAPABILITY_REGISTRY)) {
      expect(demoAgents.has(agent), `registry agent "${agent}" has no demo row`).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { buildDemoInterventions } from '../interventions.js';
import { createBaselineOverview } from '../baseline.js';
import { createEmptyOverviewDemo } from '../empty.js';

describe('buildDemoInterventions', () => {
  it('returns [] when there are no live sessions (honest-empty)', () => {
    expect(buildDemoInterventions(createEmptyOverviewDemo())).toEqual([]);
  });

  it('derives fired interventions from the baseline live sessions', () => {
    const fired = buildDemoInterventions(createBaselineOverview());
    expect(fired.length).toBeGreaterThanOrEqual(3);

    const stuck = fired.find((f) => f.kind === 'stuck_loop');
    expect(stuck).toBeDefined();
    expect(stuck?.sessionId).toBeTruthy();
    expect(stuck?.deepLink.startsWith('seorak://session/')).toBe(true);

    const cold = fired.find((f) => f.kind === 'went_cold');
    expect(cold).toBeDefined();
    expect(cold?.sessionId).not.toBe(stuck?.sessionId);

    const spike = fired.find((f) => f.kind === 'cost_spike');
    expect(spike).toBeDefined();
    expect(spike?.sessionId).not.toBe(stuck?.sessionId);
    expect(spike?.sessionId).not.toBe(cold?.sessionId);
  });
});

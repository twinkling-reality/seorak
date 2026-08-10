import { describe, expect, it } from 'vitest';

import { DEMO_SCENARIO_IDS, DEMO_SCENARIOS, getDemoData } from '../scenarios.js';

function liveCostByRepo(id: 'healthy' | 'high-cost', repoId: string): number {
  return getDemoData(id).overview.live
    .filter((s) => s.repoId === repoId)
    .reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
}

describe('demo scenarios', () => {
  it('marks compare and replay as covered demo surfaces', () => {
    for (const id of DEMO_SCENARIO_IDS) {
      expect(DEMO_SCENARIOS[id].views, `${id} missing Compare coverage`).toContain('compare');
      expect(DEMO_SCENARIOS[id].views, `${id} missing Replay coverage`).toContain('replay');
    }
  });

  it('builds range-aware snapshots for scenarios that use the baseline fixture', () => {
    const seven = getDemoData('healthy', 7).overview;
    const ninety = getDemoData('healthy', 90).overview;

    expect(seven.rangeDays).toBe(7);
    expect(seven.usage.dailyTrends).toHaveLength(7);
    expect(ninety.rangeDays).toBe(90);
    expect(ninety.usage.dailyTrends).toHaveLength(90);
  });

  it('keeps project rollups aligned with the one-session scenario live board', () => {
    const solo = getDemoData('solo-cc').overview;

    expect(solo.live).toHaveLength(1);
    expect(solo.usage.projects).toHaveLength(1);
    // Window can include history; live active count stays 1.
    expect(solo.usage.projects[0]?.activeSessions).toBe(1);
    expect(solo.usage.projects[0]?.sessions).toBeGreaterThanOrEqual(1);
    expect(solo.usage.projects[0]?.repoId).toBe(solo.live[0]?.repoId);
  });

  it('keeps high-cost project rollups above healthy at the same range', () => {
    const high = getDemoData('high-cost').overview;
    const healthy = getDemoData('healthy').overview;
    const repoId = 'repo-seorak';
    const highRollup = high.usage.projects.find((p) => p.repoId === repoId);
    const healthyRollup = healthy.usage.projects.find((p) => p.repoId === repoId);

    expect(highRollup?.costUsd ?? 0).toBeGreaterThan(healthyRollup?.costUsd ?? 0);
    expect(highRollup?.costUsd ?? 0).toBeGreaterThan(liveCostByRepo('high-cost', repoId));
  });

  it('healthy dual-agent: Codex prices in aggregates, never on the live row; solo-cc stays Claude-only', () => {
    const healthy = getDemoData('healthy').overview;
    const solo = getDemoData('solo-cc').overview;

    expect(healthy.tools.byAgent).toHaveLength(2);
    const codexLive = healthy.live.find((s) => s.agent === 'codex');
    expect(codexLive).toBeDefined();
    // The live KV path never sees the session.tokens carrier, so a live codex
    // row is structurally unpriced and renders '--', same as prod. The priced
    // codex story belongs to byAgent/agentModels, where the carrier lands.
    expect(codexLive!.costUsd).toBeNull();
    expect(codexLive!.tokens.total).toBe(0);
    const codexAgent = healthy.tools.byAgent.find((a) => a.agent === 'codex');
    expect(codexAgent?.costUsd ?? 0).toBeGreaterThan(0);
    expect(solo.live).toHaveLength(1);
    expect(solo.live[0]?.agent).toBe('claude-code');
    expect(solo.tools.byAgent).toHaveLength(1);
  });

  it('healthy scenario claims the throughline dimensions', () => {
    const healthy = DEMO_SCENARIOS.healthy;
    expect(healthy.dimensions).toEqual(
      expect.arrayContaining(['live-presence', 'intervention', 'introspection', 'honesty']),
    );
    expect(healthy.views).toContain('model');
  });
});

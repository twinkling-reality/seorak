import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIO_IDS, getDemoData } from '../scenarios.js';

describe('demo range coverage (7 / 30 / 90)', () => {
  for (const days of [7, 30, 90] as const) {
    for (const id of DEMO_SCENARIO_IDS) {
      it(`${id} stamps rangeDays=${days}`, () => {
        const data = getDemoData(id, days);
        const o = data.overview;
        expect(o.rangeDays).toBe(days);
        if (id === 'empty') {
          expect(o.usage.dailyTrends).toEqual([]);
          expect(o.live).toEqual([]);
        } else {
          expect(o.usage.dailyTrends).toHaveLength(days);
        }
      });
    }

    it(`healthy byAgent cost reconciles with the headline at ${days}d`, () => {
      const o = getDemoData('healthy', days).overview;
      const summed = o.tools.byAgent.reduce((s, a) => s + (a.costUsd ?? 0), 0);
      expect(summed).toBeCloseTo(o.usage.cost.totalUsd ?? 0, 6);
      const claude = o.tools.byAgent.find((a) => a.agent === 'claude-code')!;
      const claudeModels = o.tools.agentModels
        .filter((m) => m.agent === 'claude-code')
        .reduce((s, m) => s + (m.costUsd ?? 0), 0);
      expect(claudeModels).toBeCloseTo(claude.costUsd ?? 0, 6);
      // The LIVE codex row is unpriced (the session.tokens carrier never rides
      // the live path); Codex's dollars live in the aggregate rows above.
      expect(o.live.find((s) => s.agent === 'codex')?.costUsd).toBeNull();
    });

    it(`high-cost scales cost story coherently at ${days}d`, () => {
      const healthy = getDemoData('healthy', days).overview;
      const high = getDemoData('high-cost', days).overview;
      const summed = high.tools.byAgent.reduce((s, a) => s + (a.costUsd ?? 0), 0);
      expect(summed).toBeCloseTo(high.usage.cost.totalUsd ?? 0, 6);
      expect(high.usage.cost.totalUsd ?? 0).toBeGreaterThan(healthy.usage.cost.totalUsd ?? 0);
      expect(high.usage.costPerEdit ?? 0).toBeGreaterThan(healthy.usage.costPerEdit ?? 0);
      const highModel = getDemoData('high-cost', days).developerModel!;
      expect(highModel.tools.byModel.reduce((s, m) => s + (m.costUsd ?? 0), 0)).toBeCloseTo(
        high.tools.byModel.reduce((s, m) => s + (m.costUsd ?? 0), 0),
        6,
      );
    });

    it(`solo-cc is one Claude session with no Codex ghosts at ${days}d`, () => {
      const o = getDemoData('solo-cc', days).overview;
      expect(o.live).toHaveLength(1);
      expect(o.live[0]?.agent).toBe('claude-code');
      expect(o.tools.byAgent).toHaveLength(1);
      expect(o.tools.agentModels.every((m) => m.agent === 'claude-code')).toBe(true);
      expect(o.tools.agentDaily.every((d) => d.agent === 'claude-code')).toBe(true);
      expect(o.outcomes.stuckness.stuckCount).toBe(0);
      expect(o.usage.projects).toHaveLength(1);
      const model = getDemoData('solo-cc', days).developerModel!;
      expect(model.tools.byTool.length).toBe(o.tools.byTool.length);
    });

    it(`no-live-sessions keeps history with an empty live board at ${days}d`, () => {
      const o = getDemoData('no-live-sessions', days).overview;
      expect(o.live).toEqual([]);
      expect(o.usage.dailyTrends.length).toBe(days);
      expect(o.usage.cost.totalUsd ?? 0).toBeGreaterThan(0);
      expect(o.codebase.filesInPlay?.files ?? []).toEqual([]);
    });

    it(`Model fixture matches overview range at ${days}d`, () => {
      const data = getDemoData('healthy', days);
      expect(data.developerModel?.scope.rangeDays).toBe(days);
    });

    it(`project rollups carry Compare substrate and grow with range at ${days}d`, () => {
      const o = getDemoData('healthy', days).overview;
      for (const p of o.usage.projects) {
        expect(p.byTool.length).toBeGreaterThan(0);
        expect(p.byModel.length).toBeGreaterThan(0);
        expect(p.editCalls ?? 0).toBeGreaterThan(0);
        expect(p.codebaseDirectories.length).toBeGreaterThan(0);
      }
      if (days === 90) {
        const seven = getDemoData('healthy', 7).overview.usage.projects.find(
          (p) => p.repoId === 'repo-feather',
        )!;
        const ninety = o.usage.projects.find((p) => p.repoId === 'repo-feather')!;
        expect(ninety.sessions).toBeGreaterThan(seven.sessions);
        expect(ninety.costUsd ?? 0).toBeGreaterThan(seven.costUsd ?? 0);
      }
    });
  }
});

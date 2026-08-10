import { describe, expect, it } from 'vitest';
import { AGENT_SURVIVAL_FLOOR } from '@seorak/types';
import { createBaselineOverview } from '../baseline.js';
import { overviewSnapshotSchema } from '../../schemas/common.js';

describe('createBaselineOverview — publish-safe repo identity', () => {
  const base = createBaselineOverview();

  it('validates against the live overview schema (the frozen repoId contract)', () => {
    // The demo fixture must pass the same schema the live path uses, so demo
    // richness can never drift from the contract. The schema now requires
    // repoId (not workingDir) on SessionSummary + ProjectRollup.
    const result = overviewSnapshotSchema.safeParse(base);
    expect(result.success, result.error?.message).toBe(true);
  });

  it('carries a salted-style repoId on every live session — never an absolute path', () => {
    for (const s of base.live) {
      expect(s.repoId).toBeTruthy();
      // The absolute cwd stays LOCAL on the developer's machine; the demo must
      // not show one either.
      expect(s).not.toHaveProperty('workingDir');
      expect(s.repoId.startsWith('/')).toBe(false);
      expect(s.project.startsWith('/')).toBe(false);
    }
  });

  it('groups projects by repoId and surfaces only the basename label', () => {
    for (const p of base.usage.projects) {
      expect(p.repoId).toBeTruthy();
      expect(p).not.toHaveProperty('workingDir');
      expect(p.project.startsWith('/')).toBe(false);
    }
    // Three repos in the seed set (seorak + mobile-surfaces + feather); the two
    // seorak sessions collapse to one repo row.
    const repoIds = new Set(base.usage.projects.map((p) => p.repoId));
    expect(repoIds.size).toBe(base.usage.projects.length);
    expect(repoIds).toContain('repo-feather');
  });

  it('keeps feather realistic across live, rollup, momentum, and code signals', () => {
    const live = base.live.filter((s) => s.repoId === 'repo-feather');
    const rollup = base.usage.projects.find((p) => p.repoId === 'repo-feather');
    const momentum = base.usage.momentum.find((p) => p.repoId === 'repo-feather');

    expect(live).toHaveLength(1);
    expect(live[0]?.project).toBe('feather');
    // Window sessions include history; live board still has exactly one feather row.
    expect(rollup?.sessions).toBeGreaterThanOrEqual(1);
    expect(rollup?.activeSessions).toBe(1);
    expect(rollup?.shipRate).toBe(0.57);
    expect(rollup?.lineSurvival?.rate).toBe(0.68);
    expect(rollup?.codebaseFiles.map((f) => f.label)).toEqual(['exporter.ts', 'sync.test.ts']);
    expect(momentum?.repoLabel).toBe('feather');
    expect(momentum?.commits).toBeGreaterThan(0);
  });

  it('project window rollups grow with rangeDays', () => {
    const seven = createBaselineOverview(7).usage.projects.find((p) => p.repoId === 'repo-feather')!;
    const ninety = createBaselineOverview(90).usage.projects.find((p) => p.repoId === 'repo-feather')!;
    expect(ninety.sessions).toBeGreaterThan(seven.sessions);
    expect(ninety.costUsd ?? 0).toBeGreaterThan(seven.costUsd ?? 0);
    expect(ninety.toolCalls).toBeGreaterThan(seven.toolCalls);
    expect(ninety.codebaseFiles[0]!.edits).toBeGreaterThan(seven.codebaseFiles[0]!.edits);
  });

  it('leaks NO absolute filesystem path anywhere in the snapshot', () => {
    // The one absolute-path leak the frozen contract closes: assert it cannot
    // re-appear via any nested field.
    const json = JSON.stringify(base);
    expect(json).not.toContain('/Users/');
  });

  it('ships dual-agent byAgent with Codex priced honesty', () => {
    const agents = base.tools.byAgent;
    expect(agents.map((a) => a.agent).sort()).toEqual(['claude-code', 'codex']);
    const claude = agents.find((a) => a.agent === 'claude-code')!;
    const codex = agents.find((a) => a.agent === 'codex')!;
    expect(claude.costUsd).not.toBeNull();
    expect(claude.tokensTotal).toBeGreaterThan(0);
    expect(claude.lines).not.toBeNull();
    expect(claude.lines!.added).toBeGreaterThan(0);
    // Codex prices its work now: its money rides the session.tokens carrier, and both of
    // its demo models are real ids with real price rows. This used to assert a null cost,
    // which was correct while Codex was `cost: 'none'` and became a lie the moment the
    // carrier landed. The demo and this test were pinning each other to a contract the
    // product had already left behind.
    expect(codex.costUsd).not.toBeNull();
    expect(codex.costUsd).toBeGreaterThan(0);
    expect(codex.tokensTotal).toBeGreaterThan(0);
    expect(codex.toolCalls).toBeGreaterThan(0);
    expect(codex.lines).not.toBeNull();
    expect(codex.lines!.added).toBeGreaterThan(0);
  });

  it('the two agent cost rows sum to EXACTLY the cost headline above them', () => {
    // A demo whose numbers do not add up teaches the reader to distrust the real one. Codex
    // used to contribute nothing here, so Claude carried the whole headline; now that Codex
    // prices, its share comes OUT of Claude's rather than being added on top.
    const summed = base.tools.byAgent.reduce((s, a) => s + (a.costUsd ?? 0), 0);
    expect(summed).toBeCloseTo(base.usage.cost.totalUsd ?? 0, 6);
  });

  it('byAgent tokens agree with agentModels, and the ledger states the SHIPPED contract', () => {
    const codex = base.tools.byAgent.find((a) => a.agent === 'codex')!;
    const codexModelTokens = base.tools.agentModels
      .filter((m) => m.agent === 'codex')
      .reduce((s, m) => s + m.tokensTotal, 0);
    expect(codex.tokensTotal).toBe(codexModelTokens);
    // The agent's dollar figure is exactly the sum of its model rows, so the Models panel
    // and the Why matrix can be read side by side without contradicting each other.
    const codexModelCost = base.tools.agentModels
      .filter((m) => m.agent === 'codex')
      .reduce((s, m) => s + (m.costUsd ?? 0), 0);
    expect(codex.costUsd ?? 0).toBeCloseTo(codexModelCost, 6);
    // The contract the worker ACTUALLY ships (types/capabilities.ts). This used to assert
    // `cost: 'none'`, which stopped being true when the session.tokens carrier landed: the
    // demo and this test were pinning each other to a contract the product had left behind.
    // A fixture consumes the contract; it never authors it, and neither does its test.
    expect(codex.capabilities).toMatchObject({
      hasTokens: true,
      hasCacheTokens: true,
      cost: 'estimated',
      costScope: 'session',
      endReason: false,
      duration: 'inferred',
      verification: 'none',
    });
    const claude = base.tools.byAgent.find((a) => a.agent === 'claude-code')!;
    expect(claude.capabilities).toMatchObject({
      cost: 'estimated',
      costScope: 'call',
      duration: 'measured',
    });
  });

  it('the demo carries a PARTIAL error leg, because that is the state Codex is really in', () => {
    const codex = base.tools.byAgent.find((a) => a.agent === 'codex')!;
    const claude = base.tools.byAgent.find((a) => a.agent === 'claude-code')!;

    // Both capture error results now. The interesting difference is COVERAGE.
    expect(claude.erroredPresent).toBe(true);
    expect(codex.erroredPresent).toBe(true);

    // Claude's hooks fire on every call, pass or fail: total coverage.
    expect(claude.errorRate!.returned).toBe(claude.errorRate!.calls);

    // Codex only sees a result on its shell calls. This is the state the coverage panel and
    // the compare disclosure exist to explain, so the demo has to be IN it. The band is
    // loose on purpose: the exact share is integer-rounded off a small demo call count, and
    // what has to be true is that the coverage is PARTIAL and unmistakably so, not that it
    // lands on a decimal.
    const coverage = codex.errorRate!.returned / codex.errorRate!.calls;
    expect(coverage).toBeGreaterThan(0.3);
    expect(coverage).toBeLessThan(0.6);

    // And the legs reconcile with the tool-call count rendered one row above them: a demo
    // whose numbers do not add up teaches the reader to distrust the real one.
    for (const a of [claude, codex]) {
      expect(a.errorRate!.calls).toBe(a.toolCalls);
      expect(a.errorRate!.rate).toBeCloseTo(a.errorRate!.errored / a.errorRate!.returned, 10);
    }
  });

  it('agentDaily sums to the dailyTrends session spine (one story across surfaces)', () => {
    const byDay = new Map<string, number>();
    for (const p of base.tools.agentDaily) {
      byDay.set(p.day, (byDay.get(p.day) ?? 0) + p.sessions);
      // A present point is a real activity day: sessions or measured lines.
      expect(p.sessions > 0 || p.lines !== null).toBe(true);
    }
    for (const t of base.usage.dailyTrends) {
      expect(byDay.get(t.day) ?? 0).toBe(t.sessions);
    }
  });

  it('agentHourly gives both agents activity with codex concentrated late', () => {
    const codexHours = base.activity.agentHourly.filter((p) => p.agent === 'codex');
    const claudeHours = base.activity.agentHourly.filter((p) => p.agent === 'claude-code');
    expect(codexHours.length).toBeGreaterThan(0);
    expect(claudeHours.length).toBeGreaterThan(codexHours.length);
    expect(codexHours.every((p) => p.hour >= 19 && p.hour <= 23)).toBe(true);
  });

  // The head-to-head is the one surface where a real superiority claim becomes possible, so
  // the demo of it has to add up. A reader can put agentOutcomes next to the global
  // lineSurvival rollup on screen; a demo that does not reconcile teaches them to distrust
  // the live one.
  it('agentOutcomes RECONCILES against the global lineSurvival rollup', () => {
    const outcomes = base.tools.agentOutcomes;
    const global = base.outcomes.lineSurvival;
    const sum = (f: (o: (typeof outcomes)[number]) => number) => outcomes.reduce((n, o) => n + f(o), 0);

    // Every per-agent leg is a SUBSET of the global one — never more, because the rows the
    // split cannot use (`agentOutcomesUnusable`) are counted globally and by nobody.
    expect(sum((o) => o.linesAuthored)).toBeLessThanOrEqual(global.linesAuthored);
    expect(sum((o) => o.linesSurviving)).toBeLessThanOrEqual(global.linesSurviving);
    expect(sum((o) => o.commits)).toBeLessThanOrEqual(global.commitsChecked);
    expect(sum((o) => o.sessionsRated) + base.tools.agentOutcomesUnusable).toBe(global.sessionsRated);
    expect(base.tools.agentOutcomesUnusable).toBeGreaterThan(0); // the disclosure is exercised
  });

  it('every agent coverage split PARTITIONS its commits exactly (no invented or lost lines)', () => {
    for (const o of base.tools.agentOutcomes) {
      const c = o.coverage;
      expect(c.linesAuthored + c.linesOtherAgents + c.linesContested + c.linesUnattributed).toBe(
        c.linesInCommits,
      );
      // An agent cannot be attributed more lines in a commit than it authored overall.
      expect(c.linesAuthored).toBe(o.linesAuthored);
    }
  });

  it('the demo shows the honesty modes the panel exists for', () => {
    const claude = base.tools.agentOutcomes.find((o) => o.agent === 'claude-code')!;
    const codex = base.tools.agentOutcomes.find((o) => o.agent === 'codex')!;

    // Both clear the n-floor, so both rates render — what build week looks like.
    expect(claude.survivalRate).not.toBeNull();
    expect(codex.survivalRate).not.toBeNull();
    expect(codex.linesAuthored).toBeGreaterThanOrEqual(AGENT_SURVIVAL_FLOOR.lines);
    expect(codex.commits).toBeGreaterThanOrEqual(AGENT_SURVIVAL_FLOOR.commits);

    // Codex prices via session.tokens — both cost legs carry real dollars, never a fake $0.
    expect(codex.ratedCostUsd).toBeGreaterThan(0);
    expect(codex.costPerSurvivingLine).toBeGreaterThan(0);
    expect(claude.costPerSurvivingLine).toBeGreaterThan(0);

    // A compare needs COMPARABLE coverage. Both agents disclose a real unattributed share,
    // and the two are close enough that the gap between their rates is not a capture artifact.
    const unattributedShare = (o: typeof claude) =>
      o.coverage.linesUnattributed / o.coverage.linesInCommits;
    expect(unattributedShare(claude)).toBeGreaterThan(0);
    expect(unattributedShare(codex)).toBeGreaterThan(0);
    expect(Math.abs(unattributedShare(claude) - unattributedShare(codex))).toBeLessThan(0.25);
  });
});

/**
 * The demo's own numbers have to agree with the demo's own rail.
 *
 * The When panel draws, directly above the daily bars, the stretch of the window Seorak has
 * a record of for each tool. Both come out of THIS fixture, so a fixture that stamps
 * `firstSeenAt` 6 days back while emitting Codex bars from day 1 puts the contradiction on
 * one screen, and it hides the very bug the rail exists to kill: an unwatched day and an
 * idle day are not the same fact. Claude gets checked at 90 days on purpose, because its
 * record (38 days) only falls INSIDE the window at that range, which is exactly where the
 * ungated version drew bars across a stretch its own rail called empty.
 */
describe('createBaselineOverview — daily bars never predate the record that rails them', () => {
  for (const rangeDays of [7, 30, 90]) {
    it(`agrees with itself at ${rangeDays} days`, () => {
      const base = createBaselineOverview(rangeDays);
      const daily = base.tools.agentDaily;
      expect(daily.length).toBeGreaterThan(0);

      for (const rollup of base.tools.byAgent) {
        const firstSeen = rollup.firstSeenAt;
        expect(firstSeen, `${rollup.agent} must declare a record depth`).toBeTruthy();
        const recordStartDay = firstSeen!.slice(0, 10);

        const points = daily.filter((p) => p.agent === rollup.agent);
        for (const p of points) {
          expect(
            p.day >= recordStartDay,
            `${rollup.agent} has a bar on ${p.day}, before its record starts on ${recordStartDay}`,
          ).toBe(true);
        }
      }
    });
  }

  it('still gives Codex a populated stretch to draw, not one lonely sliver', () => {
    // The other half of a fixture's job: every widget must reach a POPULATED state. A demo
    // that is honest about the gap but leaves Codex with a single bar stops demonstrating
    // the chart at all.
    const base = createBaselineOverview(30);
    const codexDays = base.tools.agentDaily.filter((p) => p.agent === 'codex');
    expect(codexDays.length).toBeGreaterThan(1);
  });
});

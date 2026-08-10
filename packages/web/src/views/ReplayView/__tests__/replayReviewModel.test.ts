import { describe, expect, it } from 'vitest';

import type { ReplaySession, SessionSummary } from '../../../lib/apiSchemas.js';
import {
  buildReplayNow,
  buildReplayReviewBase,
  buildReplayReviewModel,
  firstAttentionElapsedMs,
  firstCommitElapsedMs,
  firstPeakBurnElapsedMs,
  firstRevisitElapsedMs,
  firstSessionReviewElapsedMs,
  firstToolCallElapsedMs,
  firstUncommittedSessionEndElapsedMs,
  stopTargetsForMode,
} from '../replayReviewModel.js';
import type { SessionLane } from '../replayTransforms.js';

function replay(): ReplaySession {
  return {
    sessionId: 's1',
    agent: 'claude-code',
    startedAt: '2026-06-04T12:00:00.000Z',
    endedAt: '2026-06-04T12:10:00.000Z',
    keyframes: [
      { kind: 'session-start', at: '2026-06-04T12:00:00.000Z', seq: 0, label: 'Session started' },
      { kind: 'first-tool-call', at: '2026-06-04T12:00:15.000Z', seq: 2, label: 'First tool call', detail: 'Read' },
      { kind: 'first-error', at: '2026-06-04T12:02:00.000Z', seq: 8, label: 'First error', detail: 'Bash' },
      { kind: 'peak-burn', at: '2026-06-04T12:04:00.000Z', seq: 12, label: 'Peak burn $0.60' },
      { kind: 'biggest-commit', at: '2026-06-04T12:08:00.000Z', seq: 20, label: 'Shipped 2 commits', detail: '5 files' },
      { kind: 'session-end', at: '2026-06-04T12:10:00.000Z', seq: 25, label: 'Session ended', detail: 'clear' },
    ],
    activity: [
      { at: '2026-06-04T12:00:00.000Z', bucketMs: 30_000, costUsd: 0.1, toolCallCount: 1, tokensTotal: 100 },
      { at: '2026-06-04T12:02:00.000Z', bucketMs: 30_000, costUsd: 0.3, toolCallCount: 2, tokensTotal: 300 },
    ],
    moments: [
      { at: '2026-06-04T12:01:00.000Z', seq: 5, kind: 'tool.call', toolName: 'Read' },
      { at: '2026-06-04T12:02:05.000Z', seq: 9, kind: 'tool.call', toolName: 'Bash', errored: true, costUsd: 0.2 },
      {
        at: '2026-06-04T12:02:10.000Z',
        seq: 10,
        kind: 'session.notification',
        notificationType: 'permission_prompt',
      },
    ],
    totals: { costUsd: 0.4, tokensTotal: 400, toolCallCount: 3, promptCount: 1 },
  };
}

function session(): SessionSummary {
  return {
    sessionId: 's1',
    project: 'seorak',
    repoId: 'repo-seorak',
    agent: 'claude-code',
    status: 'ended',
    startedAt: '2026-06-04T12:00:00.000Z',
    lastEventAt: '2026-06-04T12:10:00.000Z',
    endedAt: '2026-06-04T12:10:00.000Z',
    elapsedSeconds: 600,
    toolCallCount: 3,
    tokens: { input: 200, output: 200, cacheRead: 0, cacheWrite: 0, total: 400 },
    costUsd: 0.4,
    burnRateUsdPerMin: 0.04,
  };
}

function lane(): SessionLane {
  return {
    sessionId: 's1',
    replay: replay(),
    session: session(),
    index: 0,
  };
}

describe('replayReviewModel', () => {
  it('separates stable scope stats from the review queue', () => {
    const model = buildReplayReviewModel([lane()], 0);

    expect(model.scope.sessionCount).toBe(1);
    expect(model.scope.loadedReplayCount).toBe(1);
    expect(model.scope.totalCostUsd).toBeCloseTo(0.4);
    expect(model.scope.tokensTotal).toBe(400);
    expect(model.scope.toolCallCount).toBe(3);
    expect(model.scope.promptCount).toBe(1);
    expect(model.scope.reviewItemCount).toBeGreaterThan(0);
    expect(model.scope.alertCount).toBeGreaterThan(0);
    expect(model.scope.totalDurationMs).toBeGreaterThan(0);
    expect(model.queueItems.map((item) => item.title)).toEqual([
      'First error',
      'Tool error',
      'Needs you',
      'Peak burn $0.60',
      'Shipped 2 commits',
    ]);
    expect(model.queueItems.some((item) => item.title === 'Session started')).toBe(false);
  });

  it('builds cumulative playhead stats with bucket deltas without changing the stable queue', () => {
    const model = buildReplayReviewModel([lane()], 125_000);

    expect(model.now.clock).toBe('2:05');
    expect(model.now.costUsd).toBeCloseTo(0.4);
    expect(model.now.toolCallCount).toBe(3);
    expect(model.now.tokensTotal).toBe(400);
    expect(model.now.bucketCostUsd).toBeCloseTo(0.3);
    expect(model.now.bucketToolCallCount).toBe(2);
    expect(model.now.bucketTokensTotal).toBe(300);
    expect(model.now.promptCount).toBe(0);
    expect(model.now.items.map((item) => item.title)).toContain('Needs you');
    expect(model.queueItems.map((item) => item.title)).toContain('Peak burn $0.60');
  });

  it('exposes lifecycle bounds separate from the highlight queue', () => {
    const model = buildReplayReviewModel([lane()], 0);

    expect(model.lifecycleItems.map((item) => item.title)).toEqual([
      'Session started',
      'Session ended',
    ]);
    expect(model.queueItems.some((item) => item.title === 'Session ended')).toBe(false);
  });

  it('dedupes keyframe and moment at the same seq', () => {
    const sharedReplay = replay();
    const duplicateMoment = sharedReplay.moments.find((moment) => moment.seq === 9);
    if (duplicateMoment) {
      duplicateMoment.seq = 8;
      duplicateMoment.at = '2026-06-04T12:02:00.000Z';
    }
    const model = buildReplayReviewModel([{ ...lane(), replay: sharedReplay }], 0);
    const slotItems = model.allItems.filter((item) => item.elapsedMs === 120_000);
    expect(slotItems).toHaveLength(1);
    expect(slotItems[0]!.title).toBe('First error');
    expect(slotItems[0]!.source).toBe('keyframe');
  });

  it('returns highlight-only or all-moment stop targets by playback mode', () => {
    const base = buildReplayReviewBase([lane()]);

    expect(stopTargetsForMode(base, 'off')).toEqual([]);
    expect(stopTargetsForMode(base, 'highlights').map((item) => item.title)).not.toContain('Tool call');
    expect(stopTargetsForMode(base, 'moments').map((item) => item.title)).toContain('Tool call');
  });

  it('composes base and now the same as the full review model', () => {
    const lanes = [lane()];
    const playheadMs = 125_000;
    const base = buildReplayReviewBase(lanes);
    const composed = { ...base, now: buildReplayNow(lanes, base, playheadMs) };
    const full = buildReplayReviewModel(lanes, playheadMs);

    expect(composed.scope).toEqual(full.scope);
    expect(composed.queueItems).toEqual(full.queueItems);
    expect(composed.now).toEqual(full.now);
  });

  it('keeps cost in meta for sentence copy', () => {
    const shared = replay();
    shared.moments.push({
      at: '2026-06-04T12:03:00.000Z',
      seq: 15,
      kind: 'tool.call',
      toolName: 'Edit',
      fileCategory: 'source',
      fileLanguage: 'rust',
      costUsd: 0.02,
    });
    const model = buildReplayReviewModel([{ ...lane(), replay: shared }], 0);
    const editItem = model.allItems.find(
      (item) => item.title === 'Tool call' && item.detail === 'Edit' && item.meta.length > 0,
    );
    expect(editItem?.meta).toEqual(['$0.02']);
  });

  it('aggregates filesTouchedUncommitted across lanes in scope', () => {
    const laneTwo = {
      ...lane(),
      sessionId: 's2',
      index: 1,
      replay: {
        ...replay(),
        sessionId: 's2',
        totals: { ...replay().totals, filesTouchedUncommitted: 4 },
      },
    };
    const model = buildReplayReviewModel([lane(), laneTwo], 0);
    expect(model.scope.filesTouchedUncommitted).toBe(4);
    expect(model.sessionRows[0]?.filesTouchedUncommitted).toBe(0);
    expect(model.sessionRows[1]?.filesTouchedUncommitted).toBe(4);
  });

  it('finds first elapsed targets for summary stat actions', () => {
    const base = buildReplayReviewBase([lane()]);

    expect(firstRevisitElapsedMs(base.queueItems)).toBe(120_000);
    expect(firstAttentionElapsedMs(base.queueItems)).toBe(120_000);
    expect(firstCommitElapsedMs(base.queueItems)).toBe(480_000);
    expect(firstToolCallElapsedMs(base.allItems)).toBe(15_000);
    expect(firstPeakBurnElapsedMs(base.allItems)).toBe(240_000);
    expect(firstUncommittedSessionEndElapsedMs(base.allItems, 0)).toBeNull();
    expect(firstUncommittedSessionEndElapsedMs(base.allItems, 3)).toBe(600_000);
  });

  it('reads the shared playhead on each session own clock', () => {
    // Second session starts an hour after the first. On the scope timeline its
    // moments live at +1h, and at a playhead inside session one it has not
    // happened yet — so it must contribute nothing rather than be clamped to
    // its own first bucket.
    const laterStart = '2026-06-04T13:00:00.000Z';
    const laterReplay: ReplaySession = {
      ...replay(),
      sessionId: 's2',
      startedAt: laterStart,
      endedAt: '2026-06-04T13:10:00.000Z',
      keyframes: [
        { kind: 'session-start', at: laterStart, seq: 0, label: 'Session started' },
        { kind: 'peak-burn', at: '2026-06-04T13:04:00.000Z', seq: 12, label: 'Peak burn $1.20' },
      ],
      activity: [
        { at: laterStart, bucketMs: 30_000, costUsd: 1, toolCallCount: 4, tokensTotal: 900 },
      ],
      moments: [],
      totals: { costUsd: 1, tokensTotal: 900, toolCallCount: 4, promptCount: 0 },
    };
    const lanes: SessionLane[] = [
      lane(),
      { sessionId: 's2', replay: laterReplay, session: null, index: 1 },
    ];

    const midFirst = buildReplayReviewModel(lanes, 125_000);
    expect(midFirst.now.costUsd).toBeCloseTo(0.4);
    expect(midFirst.now.bucketCostUsd).toBeCloseTo(0.3);

    const insideSecond = buildReplayReviewModel(lanes, 3_600_000 + 10_000);
    expect(insideSecond.now.costUsd).toBeCloseTo(1.4);
    // Session one ended long before this instant; only session two is live.
    expect(insideSecond.now.bucketCostUsd).toBeCloseTo(1);

    const peak = insideSecond.allItems.find((item) => item.keyframeKind === 'peak-burn' && item.sessionId === 's2');
    expect(peak?.elapsedMs).toBe(3_600_000 + 240_000);
  });

  it('jumps session rows to the first highlight, then session start', () => {
    const base = buildReplayReviewBase([lane()]);

    expect(firstSessionReviewElapsedMs('s1', base.allItems)).toBe(120_000);

    const neutralOnly = base.allItems.filter((item) => item.stopKind !== 'highlight');
    expect(firstSessionReviewElapsedMs('s1', neutralOnly)).toBe(0);
  });
});

// What is true AT the playhead, as opposed to what has accumulated through it.
describe('replay playhead readings', () => {
  it('reports the burn rate of the bucket the playhead is inside', () => {
    // The 12:02 bucket spent $0.30 over 30s — $0.60/min.
    const inside = buildReplayReviewModel([lane()], 125_000);
    expect(inside.now.burnRateUsdPerMin).toBeCloseTo(0.6);
    expect(inside.now.runningSessionCount).toBe(1);
  });

  it('leaves burn absent where the session ran but nothing was measured', () => {
    // 12:06:40 — inside the session, past every activity bucket. A zero here
    // would claim a quiet stretch; there is simply no measurement.
    const model = buildReplayReviewModel([lane()], 400_000);

    expect(model.now.runningSessionCount).toBe(1);
    expect(model.now.burnRateUsdPerMin).toBeNull();
    expect(model.now.bucketCostUsd).toBe(0);
  });

  it('sums burn across the sessions running at the same instant', () => {
    const overlapStart = '2026-06-04T12:01:00.000Z';
    const overlapping: SessionLane = {
      sessionId: 's2',
      index: 1,
      session: { ...session(), sessionId: 's2', startedAt: overlapStart, endedAt: '2026-06-04T12:15:00.000Z' },
      replay: {
        ...replay(),
        sessionId: 's2',
        startedAt: overlapStart,
        endedAt: '2026-06-04T12:15:00.000Z',
        keyframes: [],
        moments: [],
        activity: [
          // 12:02–12:03 on the scope clock, so the same instant is live in both.
          { at: '2026-06-04T12:02:00.000Z', bucketMs: 60_000, costUsd: 0.5, toolCallCount: 3, tokensTotal: 200 },
        ],
      },
    };

    const model = buildReplayReviewModel([lane(), overlapping], 125_000);

    expect(model.now.runningSessionCount).toBe(2);
    expect(model.now.sessionCount).toBe(2);
    // $0.30 over 30s plus $0.50 over 60s — the money burning across the scope.
    expect(model.now.burnRateUsdPerMin).toBeCloseTo(1.1);
  });

  it('refuses to price a session the host could not price', () => {
    const unpriced: SessionLane = {
      ...lane(),
      session: { ...session(), costUsd: null },
    };

    const model = buildReplayReviewModel([unpriced], 125_000);

    // Its bucket still carries the measured throughput, but $0.00/min would
    // read as "not spending" rather than "cannot be priced".
    expect(model.now.runningSessionCount).toBe(1);
    expect(model.now.burnRateUsdPerMin).toBeNull();
    expect(model.now.bucketToolCallCount).toBe(2);
  });

  it('counts nothing as running between sessions', () => {
    const later = '2026-06-04T14:00:00.000Z';
    const secondLane: SessionLane = {
      sessionId: 's2',
      index: 1,
      session: { ...session(), sessionId: 's2', startedAt: later, endedAt: '2026-06-04T14:10:00.000Z' },
      replay: {
        ...replay(),
        sessionId: 's2',
        startedAt: later,
        endedAt: '2026-06-04T14:10:00.000Z',
        keyframes: [],
        moments: [],
      },
    };

    const between = buildReplayReviewModel([lane(), secondLane], 3_600_000);

    expect(between.now.runningSessionCount).toBe(0);
    expect(between.now.burnRateUsdPerMin).toBeNull();
  });

  it('accumulates errors and checks up to the playhead only', () => {
    const withChecks: SessionLane = {
      ...lane(),
      replay: {
        ...replay(),
        moments: [
          ...replay().moments,
          {
            at: '2026-06-04T12:03:00.000Z',
            seq: 12,
            kind: 'tool.call',
            toolName: 'Bash',
            verificationKind: 'test',
            verificationPassed: false,
          },
          {
            at: '2026-06-04T12:07:00.000Z',
            seq: 18,
            kind: 'tool.call',
            toolName: 'Bash',
            verificationKind: 'test',
            verificationPassed: true,
          },
        ],
      },
    };

    const early = buildReplayReviewModel([withChecks], 60_000);
    expect(early.now.errorCount).toBe(0);
    expect(early.now.checkCount).toBe(0);
    expect(early.now.checkFailedCount).toBe(0);

    const afterFailure = buildReplayReviewModel([withChecks], 200_000);
    expect(afterFailure.now.errorCount).toBe(1);
    expect(afterFailure.now.checkCount).toBe(1);
    expect(afterFailure.now.checkFailedCount).toBe(1);

    const afterRecovery = buildReplayReviewModel([withChecks], 500_000);
    expect(afterRecovery.now.checkCount).toBe(2);
    expect(afterRecovery.now.checkFailedCount).toBe(1);
  });

  it('states what the scope captured, so a zero is not confused with a blank', () => {
    const model = buildReplayReviewModel([lane()], 600_000);

    // Tool calls were logged, so "0 errors" would be a real absence.
    expect(model.now.captured.toolCalls).toBe(true);
    // No verification and no steering tick was captured in this stream — those
    // readings are absent, not zero.
    expect(model.now.captured.checks).toBe(false);
    expect(model.now.captured.prompts).toBe(false);

    const withPrompt: SessionLane = {
      ...lane(),
      replay: {
        ...replay(),
        moments: [
          ...replay().moments,
          { at: '2026-06-04T12:04:00.000Z', seq: 14, kind: 'session.prompt' },
        ],
      },
    };
    expect(buildReplayReviewModel([withPrompt], 600_000).now.captured.prompts).toBe(true);
    expect(buildReplayReviewModel([withPrompt], 60_000).now.promptCount).toBe(0);
    expect(buildReplayReviewModel([withPrompt], 600_000).now.promptCount).toBe(1);
  });

  it('reports the share of measured spend landed by the playhead', () => {
    // Buckets total $0.40; $0.10 has landed by the first one.
    expect(buildReplayReviewModel([lane()], 0).now.costShare).toBeCloseTo(0.25);
    expect(buildReplayReviewModel([lane()], 600_000).now.costShare).toBeCloseTo(1);

    const noSpend: SessionLane = {
      ...lane(),
      replay: {
        ...replay(),
        activity: replay().activity.map((bucket) => ({ ...bucket, costUsd: 0 })),
      },
    };
    // Nothing measured means there is no denominator, not a 0%.
    expect(buildReplayReviewModel([noSpend], 600_000).now.costShare).toBeNull();
  });

  it('names the wall-clock instant once elapsed stops being the honest read', () => {
    // A ten-minute scope reads in elapsed; the stamp would be noise.
    expect(buildReplayReviewModel([lane()], 60_000).now.stamp).toBeNull();

    const nextDay = '2026-06-05T12:00:00.000Z';
    const dayLater: SessionLane = {
      sessionId: 's2',
      index: 1,
      session: { ...session(), sessionId: 's2', startedAt: nextDay, endedAt: '2026-06-05T12:10:00.000Z' },
      replay: { ...replay(), sessionId: 's2', startedAt: nextDay, endedAt: '2026-06-05T12:10:00.000Z' },
    };
    const spread = buildReplayReviewModel([lane(), dayLater], 60_000);
    expect(spread.now.stamp).toBeTruthy();
  });
});

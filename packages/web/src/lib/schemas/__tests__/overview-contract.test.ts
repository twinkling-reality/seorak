import { describe, expect, it } from 'vitest';
import {
  overviewSnapshotSchema,
  interventionsArraySchema,
  createEmptyOverview,
} from '../common.js';

// z.object() STRIPS unknown keys — so portfolio / byAgent MUST be declared in the
// schema or GET /overview silently drops them and the hero/panels stay empty with
// no error. This is the load-bearing guard for the new contract fields.

function fullOverview() {
  const base = createEmptyOverview(7);
  return {
    ...base,
    usage: {
      ...base.usage,
      portfolio: {
        windowDays: 7,
        reposTotal: 2,
        reposMoved: 1,
        reposQuiet: 1,
        repos: [
          {
            repoId: 'r1',
            repoLabel: 'seorak',
            gitContext: 'clean',
            temperature: 'heating',
            quietDays: null,
            commits: 12,
            filesTouched: 34,
            netLines: 540,
            generatedLinesExcluded: 14632,
            baseline: { commits: 5, filesTouched: 18 },
          },
          {
            repoId: 'r2',
            repoLabel: 'notes',
            gitContext: 'clean',
            temperature: 'quiet',
            quietDays: 9,
            commits: 0,
            filesTouched: 0,
            netLines: 0,
            generatedLinesExcluded: 0,
            baseline: null,
          },
        ],
      },
    },
    tools: {
      ...base.tools,
      byModel: [{ model: 'claude-opus-4', calls: 3, tokensTotal: 1000, costUsd: 0.5 }],
      byAgent: [
        {
          agent: 'claude-code',
          sessions: 4,
          activeSessions: 2,
          toolCalls: 99,
          tokensTotal: 5000,
          costUsd: 2.1,
          lines: { added: 400, removed: 80 },
          lastEventAt: '2026-06-04T12:00:00.000Z',
          capabilities: {
            hasTokens: true,
            hasCacheTokens: true,
            cost: 'estimated',
            toolResult: 'both',
            endReason: true,
            duration: 'measured',
            verification: 'both',
            costScope: 'call',
            usageWindow: 'count',
          },
          erroredPresent: false,
        },
      ],
    },
  };
}

describe('overviewSnapshotSchema — portfolio + byAgent round-trip', () => {
  it('KEEPS portfolio and byAgent (does not strip the new keys)', () => {
    const parsed = overviewSnapshotSchema.parse(fullOverview());
    expect(parsed.usage.portfolio.reposTotal).toBe(2);
    expect(parsed.usage.portfolio.repos).toHaveLength(2);
    expect(parsed.usage.portfolio.repos[0].temperature).toBe('heating');
    expect(parsed.usage.portfolio.repos[1].quietDays).toBe(9);
    expect(parsed.tools.byAgent).toHaveLength(1);
    expect(parsed.tools.byAgent[0].agent).toBe('claude-code');
    expect(parsed.tools.byAgent[0].lines).toEqual({ added: 400, removed: 80 });
  });

  it('rejects omitted current portfolio and byAgent fields', () => {
    const raw = JSON.parse(JSON.stringify(createEmptyOverview(7)));
    delete raw.usage.portfolio;
    delete raw.tools.byAgent;
    expect(overviewSnapshotSchema.safeParse(raw).success).toBe(false);
  });

  it('coerces an unknown temperature enum value to null instead of failing the parse (DA-11)', () => {
    // DA-11: the schema is all-or-nothing, so a single unknown enum must not
    // blank the whole snapshot; repo temperature .catch()es to null. The
    // snapshot-level resilience guarantee lives in validate-resilience.test.ts.
    const bad = fullOverview();
    (bad.usage.portfolio.repos[0] as { temperature: unknown }).temperature = 'on-fire';
    const result = overviewSnapshotSchema.safeParse(bad);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.usage.portfolio.repos[0].temperature).toBe(null);
    }
  });

  it('createEmptyOverview carries honest-empty portfolio + byAgent', () => {
    const empty = createEmptyOverview(30);
    expect(empty.usage.portfolio.repos).toEqual([]);
    expect(empty.usage.portfolio.reposTotal).toBe(0);
    expect(empty.tools.byAgent).toEqual([]);
  });
});

describe('overviewSnapshotSchema — notification availability round-trip', () => {
  it('keeps the content-free worker contract without stripping signal keys', () => {
    const raw = createEmptyOverview(7);
    const parsed = overviewSnapshotSchema.parse(raw);
    expect(parsed.notificationAvailability?.agents).toEqual([]);
    expect(parsed.notificationAvailability?.signals.cost_spike).toEqual({
      state: 'unknown',
      supportedBy: [],
    });
    expect(Object.keys(parsed.notificationAvailability?.signals ?? {})).toHaveLength(8);
  });

  it('accepts a rolling-deploy response from an older worker without the contract', () => {
    const raw = JSON.parse(JSON.stringify(createEmptyOverview(7)));
    delete raw.notificationAvailability;
    const parsed = overviewSnapshotSchema.parse(raw);
    expect(parsed.notificationAvailability).toBeUndefined();
  });
});

describe('overviewSnapshotSchema — cacheReuseRatio round-trip', () => {
  it('KEEPS a 0..1 cacheReuseRatio (z.object() would otherwise strip it)', () => {
    const base = createEmptyOverview(7);
    const raw = { ...base, usage: { ...base.usage, cacheReuseRatio: 0.62 } };
    const parsed = overviewSnapshotSchema.parse(raw);
    expect(parsed.usage.cacheReuseRatio).toBe(0.62);
  });

  it('rejects an omitted current cacheReuseRatio', () => {
    const raw = JSON.parse(JSON.stringify(createEmptyOverview(7)));
    delete raw.usage.cacheReuseRatio;
    expect(overviewSnapshotSchema.safeParse(raw).success).toBe(false);
  });

  it('createEmptyOverview carries honest-empty cacheReuseRatio (null, not 0)', () => {
    const empty = createEmptyOverview(30);
    expect(empty.usage.cacheReuseRatio).toBeNull();
  });
});

describe('overviewSnapshotSchema — thresholds round-trip (FOLLOW-UP #3)', () => {
  it('KEEPS resolved thresholds (z.object() would otherwise strip the new key)', () => {
    const base = createEmptyOverview(7);
    const raw = {
      ...base,
      thresholds: {
        costSpikeUsd: 2.5,
        longSessionMinutes: 30,
        highBurnRateUsdPerMinute: 0.25,
        stuckLoopRepeatedToolCalls: 8,
        stuckLoopErroredToolCalls: 2,
        // The two NOTIFICATIONS.md bounds are now required (z.object() strips an
        // undeclared key); a worker serving thresholds carries all seven.
        wentColdMinutes: 10,
        dailyCostCapUsd: 20,
      },
    };
    const parsed = overviewSnapshotSchema.parse(raw);
    expect(parsed.thresholds.costSpikeUsd).toBe(2.5);
    expect(parsed.thresholds.stuckLoopErroredToolCalls).toBe(2);
  });

  it('rejects omitted current thresholds', () => {
    const raw = JSON.parse(JSON.stringify(createEmptyOverview(7)));
    delete raw.thresholds;
    expect(overviewSnapshotSchema.safeParse(raw).success).toBe(false);
  });

  it('createEmptyOverview carries DEFAULT_THRESHOLDS (config, never honest-empty)', () => {
    const empty = createEmptyOverview(30);
    expect(empty.thresholds).toBeDefined();
    // DEFAULT_THRESHOLDS.costSpikeUsd === 5.
    expect(empty.thresholds.costSpikeUsd).toBe(5);
  });
});

describe('overviewSnapshotSchema — repoId replaces workingDir (publish-safe)', () => {
  it('keeps repoId on live sessions + project rollups and never carries workingDir', () => {
    const base = createEmptyOverview(7);
    const raw = {
      ...base,
      live: [
        {
          sessionId: 's-1',
          project: 'seorak',
          repoId: 'repo-seorak',
          agent: 'claude-code',
          status: 'active',
          startedAt: '2026-06-04T12:00:00.000Z',
          lastEventAt: '2026-06-04T12:05:00.000Z',
          elapsedSeconds: 300,
          toolCallCount: 5,
          tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
          costUsd: 0.5,
          burnRateUsdPerMin: 0.1,
        },
      ],
      usage: {
        ...base.usage,
        projects: [
          {
            project: 'seorak',
            repoId: 'repo-seorak',
            sessions: 1,
            sessionsDelta: { current: 1, previous: null },
            activeSessions: 1,
            toolCalls: 5,
            tokensTotal: 15,
            costUsd: 0.5,
            lastEventAt: '2026-06-04T12:05:00.000Z',
            errorRate: null,
            cacheReuseRatio: null,
            shipRate: null,
            oneShotRate: null,
            costDelta: null,
            endReasons: [],
            stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
            byTool: [],
            byModel: [],
            byAgent: [],
            hourlyDistribution: [],
            lineSurvival: null,
            endReasonsByHour: [],
            codebaseFiles: [],
            codebaseDirectories: [],
            codebaseRework: [],
            verification: [],
            agentOutcomes: [],
            agentOutcomesUnusable: 0,
            agentModels: [],
            agentDaily: [],
            dailyTrends: [],
            agentHourly: [],
            cacheReadTokens: 0,
            cacheInputTokens: 0,
          },
        ],
      },
    };
    const parsed = overviewSnapshotSchema.parse(raw);
    expect(parsed.live[0].repoId).toBe('repo-seorak');
    expect(parsed.usage.projects[0].repoId).toBe('repo-seorak');
    // z.object() strips unknown keys: an absolute workingDir never round-trips.
    expect(parsed.live[0]).not.toHaveProperty('workingDir');
    expect(parsed.usage.projects[0]).not.toHaveProperty('workingDir');

    const missingDelta = JSON.parse(JSON.stringify(raw));
    delete missingDelta.usage.projects[0].sessionsDelta;
    expect(overviewSnapshotSchema.safeParse(missingDelta).success).toBe(false);
  });

  it('strips an undeclared workingDir field instead of carrying the absolute path', () => {
    const base = createEmptyOverview(7);
    const raw = JSON.parse(JSON.stringify(base));
    raw.live = [
      {
        sessionId: 's-1',
        project: 'seorak',
        repoId: 'repo-seorak',
        workingDir: '/Users/dev/Code/seorak',
        agent: 'claude-code',
        status: 'active',
        startedAt: '2026-06-04T12:00:00.000Z',
        lastEventAt: '2026-06-04T12:05:00.000Z',
        elapsedSeconds: 300,
        toolCallCount: 5,
        tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
        costUsd: 0.5,
        burnRateUsdPerMin: 0.1,
      },
    ];
    const parsed = overviewSnapshotSchema.parse(raw);
    expect(parsed.live[0]).not.toHaveProperty('workingDir');
    expect(parsed.live[0].repoId).toBe('repo-seorak');
    expect(JSON.stringify(parsed)).not.toContain('/Users/');
  });

  it('rejects a session row without the current repoId', () => {
    const raw = JSON.parse(JSON.stringify(createEmptyOverview(7)));
    raw.live = [
      {
        sessionId: 's-1',
        project: 'seorak',
        agent: 'claude-code',
        status: 'active',
        startedAt: '2026-06-04T12:00:00.000Z',
        lastEventAt: '2026-06-04T12:05:00.000Z',
        elapsedSeconds: 300,
        toolCallCount: 5,
        tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
        costUsd: 0.5,
        burnRateUsdPerMin: 0.1,
      },
    ];
    expect(overviewSnapshotSchema.safeParse(raw).success).toBe(false);
  });
});

describe('interventionsArraySchema', () => {
  // The PROJECT-AS-TITLE shape (NOTIFICATIONS.md §2/§4A): project/repoId/signalLabel
  // replace the old `title`; interruptionLevel + held ride along.
  const fired = {
    kind: 'cost_spike',
    sessionId: 's-1',
    project: 'seorak',
    repoId: 'r_abc123',
    triggeredAt: '2026-06-04T12:00:00.000Z',
    signalLabel: 'Cost spike',
    body: 'Cost is adding up. $5.20 so far, past the $5.00 mark.',
    deepLink: 'seorak://session/s-1',
    interruptionLevel: 'timeSensitive',
    held: false,
  };

  it('parses a valid fired list', () => {
    const parsed = interventionsArraySchema.parse([fired]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].kind).toBe('cost_spike');
    expect(parsed[0].project).toBe('seorak');
    expect(parsed[0].signalLabel).toBe('Cost spike');
    expect(parsed[0].interruptionLevel).toBe('timeSensitive');
  });

  it('accepts the four new catalog signal kinds (8-signal SignalId set)', () => {
    for (const kind of ['went_cold', 'session_ended', 'daily_cost_cap', 'first_error']) {
      expect(interventionsArraySchema.safeParse([{ ...fired, kind }]).success).toBe(true);
    }
  });

  it('rejects an unknown intervention kind', () => {
    expect(() => interventionsArraySchema.parse([{ ...fired, kind: 'meltdown' }])).toThrow();
  });

  it('rejects a malformed intervention row instead of hiding it among current siblings', () => {
    const stale = {
      kind: 'stuck_loop',
      sessionId: 's-2',
      triggeredAt: '2026-06-04T11:00:00.000Z',
      title: 'Stuck loop',
      body: 'Your agent has been retrying the same step.',
      deepLink: 'seorak://session/s-2',
    };
    expect(() => interventionsArraySchema.parse([stale, fired])).toThrow();
  });

  it('parses [] to [] (honest-empty)', () => {
    expect(interventionsArraySchema.parse([])).toEqual([]);
  });
});

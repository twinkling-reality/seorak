import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAPTURE_SETTINGS,
  resolveCapabilities,
  type CaptureSettings,
  type OverviewSnapshot,
} from '@seorak/types';
import { SEORAK_SIGNALS } from '@seorak/types';
import {
  collectionPanelVisible,
  getCollectionAttention,
  getCollectionSummary,
  getWidgetReadiness,
  isCaptureOffForWidget,
  isPickerAddBlocked,
  isReadyForFullLayout,
  readinessEmptyMessage,
  requiredCaptureKeys,
  resolveDefaultLayout,
} from './widgetReadiness.js';
import { getWidget } from '../widgets/catalog/index.js';
import { FULL_WIDGET_IDS, STARTER_WIDGET_IDS } from '../widgets/catalog/default-layout.js';

type OverviewOverride = Partial<Omit<OverviewSnapshot, 'codebase' | 'usage' | 'outcomes' | 'tools' | 'activity'>> & {
  codebase?: Partial<OverviewSnapshot['codebase']>;
  usage?: Partial<OverviewSnapshot['usage']>;
  outcomes?: Partial<OverviewSnapshot['outcomes']>;
  tools?: Partial<OverviewSnapshot['tools']>;
  activity?: Partial<OverviewSnapshot['activity']>;
};

function overview(partial: OverviewOverride = {}): OverviewSnapshot {
  const { codebase, usage, outcomes, tools, activity, ...rest } = partial;
  return {
    generatedAt: '2026-07-05T12:00:00.000Z',
    rangeDays: 7,
    live: [],
    usage: {
      totals: { sessions: 0, toolCalls: 0, sessionsDelta: null },
      cost: { totalUsd: null, sessionsWithCost: 0, delta: null },
      lines: null,
      dailyTrends: [],
      projects: [],
      momentum: [],
      portfolio: { windowDays: 7, reposTotal: 0, reposMoved: 0, reposQuiet: 0, repos: [] },
      cacheReuseRatio: null,
      costPerEdit: null,
      ...usage,
    },
    outcomes: {
      endReasons: [],
      activeCount: 0,
      endedCount: 0,
      stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
      endReasonsByDay: [],
      oneShotRate: null,
      shipRate: null,
      lineSurvival: {
        rate: null,
        linesAuthored: 0,
        linesSurviving: 0,
        commitsChecked: 0,
        sessionsRated: 0,
        retained: 0,
        overwritten: 0,
        unreachable: 0,
        unknown: 0,
      },
      bySession: [],
      ...outcomes,
    },
    activity: {
      hourlyDistribution: [],
      endReasonsByHour: [],
      ...activity,
    },
    tools: {
      byTool: [],
      callStats: { totalCalls: 0, errorRate: null },
      byModel: [],
      byAgent: [],
      verification: [],
      ...tools,
    },
    codebase: {
      files: [],
      directories: [],
      rework: [],
      commitStats: null,
      filesInPlay: null,
      ...codebase,
    },
    ...rest,
  } as OverviewSnapshot;
}

const gitOff: CaptureSettings = { ...DEFAULT_CAPTURE_SETTINGS, gitMomentum: false };
const fileOff: CaptureSettings = { ...DEFAULT_CAPTURE_SETTINGS, fileSignals: false };

describe('getWidgetReadiness — capture-off', () => {
  it('flags git widgets when gitMomentum is off', () => {
    const r = getWidgetReadiness('ship-rate', overview(), gitOff);
    expect(r.state).toBe('capture-off');
    expect(r.message).toMatch(/git capture is off/i);
    expect(r.action?.href).toBe('/dashboard/settings');
    expect(r.pickerBadge).toBe('Needs git capture');
  });

  it('flags file widgets when fileSignals is off', () => {
    const r = getWidgetReadiness('files', overview(), fileOff);
    expect(r.state).toBe('capture-off');
    expect(r.pickerBadge).toBe('Needs file capture');
  });

  it('does not capture-off session widgets when git is off', () => {
    const r = getWidgetReadiness(
      'sessions',
      overview({ usage: { totals: { sessions: 3, toolCalls: 0, sessionsDelta: null } } }),
      gitOff,
    );
    expect(r.state).toBe('ready');
  });
});

describe('getWidgetReadiness — maturing & accruing', () => {
  it('line-survival is maturing when pending session outcomes exist', () => {
    const r = getWidgetReadiness(
      'line-survival',
      overview({
        outcomes: {
          endedCount: 2,
          bySession: [
            {
              sessionId: 's1',
              project: 'app',
              repoId: 'r1',
              endedAt: '2026-07-01T12:00:00.000Z',
              status: 'pending',
            },
          ],
        },
      }),
    );
    expect(r.state).toBe('maturing');
    expect(r.pickerBadge).toBe('Maturing');
    expect(r.message).toMatch(/few days/i);
  });

  it('tool-mix is accruing with aggregate calls but no per-tool split', () => {
    const r = getWidgetReadiness(
      'tool-mix',
      overview({ tools: { callStats: { totalCalls: 12, errorRate: null }, byTool: [] } }),
    );
    expect(r.state).toBe('accruing');
    expect(r.message).toMatch(/no per-tool breakdown/i);
  });

  it('momentum is accruing without git data', () => {
    const r = getWidgetReadiness('momentum', overview());
    expect(r.state).toBe('accruing');
    expect(readinessEmptyMessage('momentum', overview())).toMatch(/git commit/i);
  });
});

describe('getWidgetReadiness — valid-zero & ready', () => {
  it('live-sessions is valid-zero with no live rows', () => {
    const r = getWidgetReadiness('live-sessions', overview());
    expect(r.state).toBe('valid-zero');
    expect(r.pickerBadge).toBe('Empty');
    expect(r.isEmpty).toBe(true);
  });

  it('ship-rate is ready when rate is measured', () => {
    const r = getWidgetReadiness('ship-rate', overview({ outcomes: { shipRate: 0.5, endedCount: 4 } }));
    expect(r.state).toBe('ready');
    expect(r.isEmpty).toBe(false);
    expect(r.pickerBadge).toBeNull();
  });

  it('commits is ready when commitStats exist', () => {
    const r = getWidgetReadiness(
      'commits',
      overview({
        codebase: {
          commitStats: {
            windowDays: 7,
            commits: 3,
            filesTouched: 2,
            linesAdded: 10,
            linesDeleted: 1,
            generatedLinesExcluded: 0,
            commitsFromSessions: 2,
          },
        },
      }),
    );
    expect(r.state).toBe('ready');
  });
});

describe('getWidgetReadiness — every catalog signal', () => {
  it.each(SEORAK_SIGNALS.map((s) => s.id))('%s resolves a readiness state', (id) => {
    const r = getWidgetReadiness(id, overview());
    expect(r.state).toBeTruthy();
    expect(r.message.length).toBeGreaterThan(0);
  });
});

describe('getCollectionSummary', () => {
  it('returns five grouped rows', () => {
    const rows = getCollectionSummary(overview());
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.group)).toEqual(['sessions', 'git', 'outcomes', 'files', 'tools']);
  });

  it('does not count valid-zero stats as ready', () => {
    const rows = getCollectionSummary(overview());
    const sessions = rows.find((r) => r.group === 'sessions');
    expect(sessions?.readyCount).toBe(0);
  });

  it('surfaces only groups that need attention', () => {
    const rows = getCollectionSummary(overview());
    const attention = getCollectionAttention(rows);
    expect(attention.length).toBeGreaterThan(0);
    expect(attention.every((r) => r.attentionCount > 0)).toBe(true);
    expect(collectionPanelVisible(rows)).toBe(true);
  });

  it('carries specific pending stat details for the readiness dialog', () => {
    const rows = getCollectionSummary(overview());
    const sessions = rows.find((r) => r.group === 'sessions');
    expect(sessions?.pendingStats.length).toBe(sessions?.attentionCount);
    expect(sessions?.pendingStats[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        label: expect.any(String),
        message: expect.any(String),
        state: expect.any(String),
      }),
    );
  });

  it('hides the panel when every tracked stat is ready', () => {
    const rows = getCollectionSummary(
      overview({
        live: [{ sessionId: 's1' } as never],
        usage: {
          totals: { sessions: 5, toolCalls: 20, sessionsDelta: null },
          cost: { totalUsd: 1.2, sessionsWithCost: 2, delta: null },
          dailyTrends: [
            { day: '2026-07-01', sessions: 1, costUsd: 0.1 },
            { day: '2026-07-02', sessions: 2, costUsd: 0.2 },
          ],
          projects: [
            {
              project: 'app',
              repoId: 'r1',
              sessions: 1,
              sessionsDelta: null,
              activeSessions: 0,
              toolCalls: 1,
              tokensTotal: 1,
              costUsd: 0.1,
              lastEventAt: '2026-07-05T12:00:00.000Z',
              errorRate: null,
              cacheReuseRatio: 0.5,
              shipRate: null,
              oneShotRate: null,
              costDelta: null,
              endReasons: [],
              stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
              byTool: [{ tool: 'Edit', calls: 1, sessions: 1 }],
              byModel: [{ model: 'claude', calls: 1, tokensTotal: 1, costUsd: 0.1 }],
              byAgent: [],
              hourlyDistribution: [{ dow: 1, hour: 10, sessions: 1 }],
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
          momentum: [
            {
              repoId: 'r1',
              repoLabel: 'app',
              gitContext: 'clean',
              windowDays: 7,
              commits: 1,
              filesTouched: 1,
              linesAdded: 1,
              linesDeleted: 0,
              netLines: 1,
              generatedLinesExcluded: 0,
            },
          ],
          portfolio: {
            windowDays: 7,
            reposTotal: 1,
            reposMoved: 1,
            reposQuiet: 0,
            repos: [
              {
                repoId: 'r1',
                repoLabel: 'app',
                gitContext: 'clean',
                temperature: 'steady',
                quietDays: null,
                commits: 1,
                filesTouched: 1,
                netLines: 1,
                generatedLinesExcluded: 0,
                baseline: null,
              },
            ],
          },
          cacheReuseRatio: 0.5,
          costPerEdit: 0.1,
        },
        outcomes: {
          endedCount: 2,
          shipRate: 0.5,
          oneShotRate: 0.5,
          endReasons: [{ reason: 'clear', count: 1 }],
          endReasonsByDay: [{ day: '2026-07-01', reasons: [{ reason: 'clear', count: 1 }] }],
          lineSurvival: {
            rate: 0.8,
            linesAuthored: 10,
            linesSurviving: 8,
            commitsChecked: 3,
            sessionsRated: 1,
            retained: 1,
            overwritten: 0,
            unreachable: 0,
            unknown: 0,
          },
          stuckness: { rate: 0, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
        },
        activity: {
          hourlyDistribution: [
            { dow: 1, hour: 10, sessions: 1 },
            { dow: 2, hour: 11, sessions: 1 },
            { dow: 3, hour: 12, sessions: 1 },
          ],
          endReasonsByHour: [{ hour: 10, reasons: [{ reason: 'clear', count: 1 }] }],
        },
        tools: {
          byTool: [{ tool: 'Edit', calls: 5, sessions: 2 }],
          callStats: { totalCalls: 5, errorRate: 0.1 },
          byModel: [{ model: 'claude', calls: 5, tokensTotal: 100, costUsd: 1 }],
          byAgent: [
            {
              agent: 'claude-code',
              sessions: 2,
              activeSessions: 0,
              toolCalls: 4,
              tokensTotal: 80,
              costUsd: 1,
              lines: { added: 40, removed: 8 },
              lastEventAt: '2026-07-05T12:00:00.000Z',
              capabilities: resolveCapabilities('claude-code'),
              erroredPresent: false,
            },
            {
              agent: 'codex',
              sessions: 1,
              activeSessions: 0,
              toolCalls: 1,
              tokensTotal: 0,
              costUsd: null,
              lines: { added: 10, removed: 2 },
              lastEventAt: '2026-07-05T11:00:00.000Z',
              capabilities: resolveCapabilities('codex'),
              erroredPresent: false,
            },
          ],
          verification: [{ kind: 'test', passRate: 0, runs: 1, passed: 0 }],
        },
        codebase: {
          files: [
            {
              fileId: 'f1',
              label: 'a.ts',
              edits: 1,
              linesAdded: 1,
              linesRemoved: 0,
              sessions: 1,
            },
          ],
          directories: [{ dirId: 'd1', label: 'src', edits: 1, share: 1 }],
          rework: [{ fileId: 'f1', label: 'a.ts', sessions: 2, edits: 2 }],
          commitStats: {
            windowDays: 7,
            commits: 1,
            filesTouched: 1,
            linesAdded: 1,
            linesDeleted: 0,
            generatedLinesExcluded: 0,
            commitsFromSessions: 1,
          },
          filesInPlay: {
            distinctFiles: 1,
            files: [
              {
                fileId: 'f1',
                label: 'a.ts',
                category: 'source',
                edits: 1,
                lastEditedAt: '2026-07-05T12:00:00.000Z',
                projects: [{ repoId: 'r1', project: 'app', edits: 1, sessions: 1 }],
              },
            ],
          },
        },
      }),
    );
    expect(getCollectionAttention(rows)).toHaveLength(0);
    expect(collectionPanelVisible(rows)).toBe(false);
  });

  it('marks git group capture-off when gitMomentum is disabled', () => {
    const rows = getCollectionSummary(overview(), gitOff);
    const git = rows.find((r) => r.group === 'git');
    expect(git?.state).toBe('capture-off');
  });
});

describe('requiredCaptureKeys', () => {
  it('maps commitTracking catalog entries to gitMomentum', () => {
    expect(requiredCaptureKeys('ship-rate', getWidget('ship-rate'))).toContain('gitMomentum');
  });

  it('maps file-axis catalog entries to fileSignals', () => {
    expect(requiredCaptureKeys('files', getWidget('files'))).toContain('fileSignals');
  });
});

describe('resolveDefaultLayout', () => {
  it('returns starter for brand-new users', () => {
    const layout = resolveDefaultLayout(overview());
    expect(layout.map((s) => s.id)).toEqual(STARTER_WIDGET_IDS);
  });

  it('returns full layout when git data has landed', () => {
    const layout = resolveDefaultLayout(
      overview({
        usage: {
          portfolio: {
            windowDays: 7,
            reposTotal: 1,
            reposMoved: 1,
            reposQuiet: 0,
            repos: [
              {
                repoId: 'r1',
                repoLabel: 'app',
                gitContext: 'clean',
                temperature: 'steady',
                quietDays: null,
                commits: 1,
                filesTouched: 2,
                netLines: 5,
                generatedLinesExcluded: 0,
                baseline: null,
              },
            ],
          },
        },
      }),
    );
    expect(layout.map((s) => s.id)).toEqual(FULL_WIDGET_IDS);
  });
});

describe('isReadyForFullLayout', () => {
  it('is false for brand-new users', () => {
    expect(isReadyForFullLayout(overview())).toBe(false);
  });

  it('is true when git momentum has landed', () => {
    expect(
      isReadyForFullLayout(
        overview({
          usage: {
            portfolio: {
              windowDays: 7,
              reposTotal: 1,
              reposMoved: 1,
              reposQuiet: 0,
              repos: [
                {
                  repoId: 'r1',
                  repoLabel: 'app',
                  gitContext: 'clean',
                  temperature: 'steady',
                  quietDays: null,
                  commits: 1,
                  filesTouched: 2,
                  netLines: 5,
                  generatedLinesExcluded: 0,
                  baseline: null,
                },
              ],
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it('is false when git capture is off even with session data', () => {
    expect(
      isReadyForFullLayout(
        overview({
          usage: { totals: { sessions: 5, toolCalls: 20, sessionsDelta: null } },
        }),
        gitOff,
      ),
    ).toBe(false);
  });
});

describe('picker gating', () => {
  it('does not block accruing widgets', () => {
    expect(isPickerAddBlocked('tool-mix', DEFAULT_CAPTURE_SETTINGS)).toBe(false);
    expect(isPickerAddBlocked('line-survival', DEFAULT_CAPTURE_SETTINGS)).toBe(false);
  });

  it('blocks capture-off git widgets', () => {
    expect(isPickerAddBlocked('ship-rate', gitOff)).toBe(true);
    expect(isCaptureOffForWidget('momentum', gitOff)).toBe(true);
  });
});

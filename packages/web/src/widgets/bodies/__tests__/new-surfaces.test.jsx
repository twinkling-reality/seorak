// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { outcomeWidgets } from '../OutcomeWidgets.js';
import { toolWidgets } from '../ToolWidgets.js';
import { usageWidgets } from '../UsageWidgets.js';
import { codebaseWidgets } from '../CodebaseWidgets.js';
import { activityWidgets } from '../ActivityWidgets.js';
import { createEmptyOverview } from '../../../lib/apiSchemas.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(Component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Component {...props} />));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function withOutcomes(partial) {
  const base = createEmptyOverview(7);
  return { ...base, outcomes: { ...base.outcomes, ...partial } };
}
function withTools(partial) {
  const base = createEmptyOverview(7);
  return { ...base, tools: { ...base.tools, ...partial } };
}
function withUsage(partial) {
  const base = createEmptyOverview(7);
  return { ...base, usage: { ...base.usage, ...partial } };
}
function withCodebase(partial) {
  const base = createEmptyOverview(7);
  return { ...base, codebase: { ...base.codebase, ...partial } };
}
function withActivity(partial) {
  const base = createEmptyOverview(7);
  return { ...base, activity: { ...base.activity, ...partial } };
}

const props = (overview) => ({ overview, liveSessions: [], openProject: () => {} });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ShipRateWidget', () => {
  const ShipRate = outcomeWidgets['ship-rate'];

  it('null shipRate renders -- (never a fabricated 0%)', () => {
    const { container, unmount } = render(ShipRate, props(withOutcomes({ shipRate: null })));
    expect(container.textContent).toContain('--');
    expect(container.textContent).not.toContain('0%');
    unmount();
  });

  it('0.68 renders 68% (×100)', () => {
    const { container, unmount } = render(ShipRate, props(withOutcomes({ shipRate: 0.68 })));
    expect(container.textContent).toContain('68%');
    unmount();
  });
});

describe('TrendWidget', () => {
  const Trend = usageWidgets.trend;

  it('empty dailyTrends renders the honest locked state (never a flat line)', () => {
    const { container, unmount } = render(Trend, props(withUsage({ dailyTrends: [] })));
    expect(container.textContent).toMatch(/fills in/i);
    expect(container.querySelector('svg')).toBeNull();
    unmount();
  });

  it('draws a sparkline when at least two days carry data', () => {
    const dailyTrends = [
      { day: '2026-06-01', sessions: 3, costUsd: 4.2 },
      { day: '2026-06-02', sessions: 5, costUsd: 6.1 },
      { day: '2026-06-03', sessions: 2, costUsd: null },
    ];
    const { container, unmount } = render(Trend, props(withUsage({ dailyTrends })));
    expect(container.querySelector('svg')).not.toBeNull();
    // Sessions headline: 3 + 5 + 2 = 10.
    expect(container.textContent).toContain('10');
    unmount();
  });

  it('stays a single-series dashboard tile without an internal metric toggle', () => {
    const dailyTrends = [
      { day: '2026-06-01', sessions: 3, costUsd: 4.2 },
      { day: '2026-06-02', sessions: 5, costUsd: 6.1 },
      { day: '2026-06-03', sessions: 2, costUsd: null },
    ];
    const { container, unmount } = render(Trend, props(withUsage({ dailyTrends })));

    expect(container.textContent).toContain('10 sessions');
    expect(container.textContent).not.toContain('Sessions, daily');
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).not.toContain('Cost');
    expect(container.textContent).not.toContain('$10.30');
    unmount();
  });
});

describe('VerificationWidget', () => {
  const Verification = toolWidgets.verification;

  it('renders a failure-mix strip (never a misleading pass rate)', () => {
    // CC-only: passing runs report no exit signal, so passRate is pinned at 0
    // and `runs` counts the failures. The tile must say "N failed", never "0%".
    const { container, unmount } = render(
      Verification,
      props(withTools({ verification: [{ kind: 'test', passRate: 0, runs: 3 }] })),
    );
    const text = container.textContent;
    expect(text).toContain('test');
    expect(text).toContain('3');
    expect(text.toLowerCase()).toContain('failed');
    expect(text.toLowerCase()).toContain('test failures');
    // Strip legend carries per-kind counts; never a pass-rate percentage.
    expect(text).not.toContain('0%');
    expect(text).not.toContain('%');
    unmount();
  });

  it('a kind with no failures across the board shows none, never a fabricated 0%', () => {
    const { container, unmount } = render(
      Verification,
      props(withTools({ verification: [{ kind: 'lint', passRate: null, runs: 0 }] })),
    );
    const text = container.textContent;
    expect(text.toLowerCase()).toContain('none');
    expect(text).not.toContain('0%');
    unmount();
  });

  it('caveats that passes are not separately reported on Claude Code (hover only)', () => {
    const { container, unmount } = render(
      Verification,
      props(withTools({ verification: [{ kind: 'build', passRate: 0, runs: 1 }] })),
    );
    const head = container.querySelector('[title]');
    const hint = head?.getAttribute('title')?.toLowerCase() ?? '';
    expect(hint).toContain('separately reported');
    expect(hint).toContain('not a pass rate');
    unmount();
  });

  it('empty verification renders the honest empty state', () => {
    const { container, unmount } = render(Verification, props(withTools({ verification: [] })));
    expect(container.textContent).toContain('Verification checks fill in');
    unmount();
  });
});

describe('ProjectsWidget — project squircle identity', () => {
  const Projects = usageWidgets.projects;

  it('renders a gradient squircle beside each project name', () => {
    const { container, unmount } = render(
      Projects,
      props(
        withUsage({
          projects: [
            {
              repoId: 'r1',
              project: 'seorak',
              sessions: 4,
              activeSessions: 1,
              lastEventAt: new Date().toISOString(),
            },
          ],
        }),
      ),
    );
    expect(container.querySelector('[class*="projectSquircle"]')).not.toBeNull();
    expect(container.textContent).toContain('seorak');
    unmount();
  });
});

describe('ToolCallErrorsWidget — stat tile height parity', () => {
  const ToolCallErrors = toolWidgets['tool-call-errors'];

  it('honest-empty renders -- with an absolutely pinned coverage note (matches stuck rate)', () => {
    const { container, unmount } = render(
      ToolCallErrors,
      props(withTools({ callStats: { totalCalls: 0, errorRate: null } })),
    );
    expect(container.textContent).toContain('--');
    expect(container.textContent.toLowerCase()).toContain('fills in');
    unmount();
  });
});

// A minimal AgentRollup row for the multi-tool disclosure tests below.
function agentRow(agent) {
  return {
    agent,
    sessions: 2,
    activeSessions: 0,
    toolCalls: 20,
    tokensTotal: 0,
    costUsd: null,
    lines: null,
    lastEventAt: '2026-07-12T00:00:00.000Z',
  };
}

describe('ToolCallErrorsWidget: blended coverage disclosure (multi-tool)', () => {
  const ToolCallErrors = toolWidgets['tool-call-errors'];

  it('one tool in the window: the rate stands alone, base rule on the hover hint', () => {
    const { container, unmount } = render(
      ToolCallErrors,
      props(
        withTools({
          callStats: { totalCalls: 100, errorRate: 0.05 },
          byAgent: [agentRow('claude-code')],
        }),
      ),
    );
    expect(container.textContent).toContain('5%');
    expect(container.textContent).not.toContain('Codex');
    const hinted = container.querySelector('[title]');
    expect(hinted?.getAttribute('title')).toBe('Measured on calls that report a result.');
    unmount();
  });

  it('two tools in the window: the hover hint says whose calls the rate can see', () => {
    // The blended rate is over calls that RETURNED a result, and Codex only
    // returns one on shell calls; without the disclosure the number reads as
    // a claim about all of both tools' work. The rule rides titleHint
    // (DASHBOARD-CLARITY P1: the face keeps one value) because the 2-row stat
    // card cannot hold a pinned prose note without overlapping the numeral;
    // the errors drill states the same rule in visible text (see ErrorsPanel).
    const { container, unmount } = render(
      ToolCallErrors,
      props(
        withTools({
          callStats: { totalCalls: 100, errorRate: 0.05 },
          byAgent: [agentRow('claude-code'), agentRow('codex')],
        }),
      ),
    );
    expect(container.textContent).toContain('5%');
    // The face keeps one value: no prose in the text content.
    expect(container.textContent).not.toContain('Measured on calls');
    const hinted = container.querySelector('[title]');
    expect(hinted?.getAttribute('title')).toBe(
      'Measured on calls that report a result. Codex reports results on shell calls only.',
    );
    unmount();
  });
});

describe('ToolMixWidget: face stays stat-only (caveat moved to the tools drill)', () => {
  const ToolMix = toolWidgets['tool-mix'];
  const byTool = [
    { tool: 'Bash', calls: 40, sessions: 3 },
    { tool: 'Shell', calls: 22, sessions: 2 },
    { tool: 'other', calls: 12, sessions: 2 },
  ];

  it('one tool in the window: the split stands alone, no disclosure', () => {
    const { container, unmount } = render(
      ToolMix,
      props(
        withTools({
          byTool,
          callStats: { totalCalls: 74, errorRate: null },
          byAgent: [agentRow('claude-code')],
        }),
      ),
    );
    expect(container.textContent).not.toContain('Codex');
    unmount();
  });

  it('carries no Codex "other"-bucket caption on the face even when Codex ran', () => {
    // The naming-limit caveat is filler under the tile; it now lives as a
    // structured note on the tools drill (ToolsPanel), not on the widget face.
    const { container, unmount } = render(
      ToolMix,
      props(
        withTools({
          byTool,
          callStats: { totalCalls: 74, errorRate: null },
          byAgent: [agentRow('claude-code'), agentRow('codex')],
        }),
      ),
    );
    const text = container.textContent;
    expect(text).not.toContain('naming limit');
    expect(text).not.toContain('share this split');
    expect(text).not.toContain('ApplyPatch');
    unmount();
  });
});

describe('FilesWidget — edit-share strip', () => {
  const Files = codebaseWidgets.files;

  it('leads with the hottest file and an edit-share strip legend', () => {
    const { container, unmount } = render(
      Files,
      props(
        withCodebase({
          files: [
            { fileId: 'f1', label: 'overview.ts', edits: 14, linesAdded: 40, linesRemoved: 2 },
            { fileId: 'f2', label: 'app.ts', edits: 5, linesAdded: 0, linesRemoved: 0 },
          ],
        }),
      ),
    );
    const text = container.textContent;
    expect(text).toContain('14');
    expect(text).toContain('edits on overview.ts');
    expect(text).toContain('overview.ts');
    expect(text).toContain('14 edits');
    unmount();
  });
});

describe('FileReworkWidget — session-share strip', () => {
  const FileRework = codebaseWidgets['file-rework'];

  it('matches the share-face family: head, strip legend, session counts per file', () => {
    const { container, unmount } = render(
      FileRework,
      props(
        withCodebase({
          rework: [
            { fileId: 'f1', label: 'overview.ts', sessions: 4, edits: 14 },
            { fileId: 'f2', label: 'sessions.ts', sessions: 3, edits: 9 },
          ],
        }),
      ),
    );
    const text = container.textContent;
    expect(text).toContain('sessions on overview.ts');
    expect(text).toContain('4 sessions');
    expect(text).toContain('3 sessions');
    expect(text).toContain('overview.ts');
    expect(text).toContain('sessions.ts');
    expect(container.querySelector('[aria-label="Share of recurring sessions by file"]')).not.toBeNull();
    unmount();
  });
});

describe('HourlyEffectivenessWidget — cadence pillars', () => {
  const Hourly = activityWidgets['hourly-effectiveness'];

  it('renders a 24-hour cadence spine with peak hour in the head', () => {
    const { container, unmount } = render(
      Hourly,
      props(
        withActivity({
          endReasonsByHour: [
            { hour: 14, reasons: [{ reason: 'clear', count: 5 }] },
            { hour: 9, reasons: [{ reason: 'clear', count: 2 }] },
          ],
        }),
      ),
    );
    const text = container.textContent;
    expect(text).toContain('5');
    expect(text).toMatch(/busiest \d{1,2}[ap]/);
    expect(text).not.toContain('·');
    expect(container.querySelector('[role="img"]')).not.toBeNull();
    unmount();
  });
});

describe('CacheReuseWidget', () => {
  const CacheReuse = usageWidgets['cache-reuse'];

  it('null ratio renders -- (never a fabricated 0%)', () => {
    const { container, unmount } = render(
      CacheReuse,
      props(withUsage({ cacheReuseRatio: null })),
    );
    expect(container.textContent).toContain('--');
    expect(container.textContent).not.toContain('0%');
    unmount();
  });

  it('0.62 renders 62% (×100); the cost-lever framing rides the hover, not the face', () => {
    const { container, unmount } = render(
      CacheReuse,
      props(withUsage({ cacheReuseRatio: 0.62 })),
    );
    const text = container.textContent;
    expect(text).toContain('62%');
    // Face-caption law: the definition leaves the face for the value alone; the
    // cost-lever framing stays reachable on the stat's hover.
    expect(text.toLowerCase()).not.toContain('cost lever');
    const hover = container.querySelector('[title]');
    expect(hover?.getAttribute('title')?.toLowerCase()).toContain('cost lever');
    // Anti-grade: never the word "bad", face or hover.
    expect(text.toLowerCase()).not.toContain('bad');
    expect(hover?.getAttribute('title')?.toLowerCase()).not.toContain('bad');
    unmount();
  });
});

describe('LinesAdded / LinesRemoved (git-count face; exclusion rides the hover)', () => {
  const LinesAdded = usageWidgets['lines-added'];
  const LinesRemoved = usageWidgets['lines-removed'];

  // usage.momentum[] carries the privacy-safe COUNTS the git-count tiles sum.
  const momentum = [{ filesTouched: 6, linesAdded: 420, linesDeleted: 96 }];

  it('null/empty momentum renders -- (never a fabricated 0)', () => {
    const { container, unmount } = render(LinesAdded, props(withUsage({ momentum: [] })));
    expect(container.textContent).toContain('--');
    unmount();
  });

  it('lines-added shows the count; the generated/lockfile exclusion is off the face, on hover', () => {
    const { container, unmount } = render(LinesAdded, props(withUsage({ momentum })));
    const text = container.textContent;
    expect(text).toContain('420');
    // Derivation leaves the face (face-caption law): no exclusion subline...
    expect(text.toLowerCase()).not.toContain('excluded');
    // ...it stays reachable on the value's hover.
    const hover = container.querySelector('[title]');
    expect(hover?.getAttribute('title')).toContain('Generated and lockfile lines are excluded');
    unmount();
  });

  it('lines-removed shows the count with the same hover-only exclusion', () => {
    const { container, unmount } = render(LinesRemoved, props(withUsage({ momentum })));
    const text = container.textContent;
    expect(text).toContain('96');
    expect(text.toLowerCase()).not.toContain('excluded');
    const hover = container.querySelector('[title]');
    expect(hover?.getAttribute('title')).toContain('Generated and lockfile lines are excluded');
    unmount();
  });
});

describe('CostPerEditWidget (formula rides the hover, not the face)', () => {
  const CostPerEdit = usageWidgets['cost-per-edit'];

  it('null renders -- (never a fabricated $0)', () => {
    const { container, unmount } = render(CostPerEdit, props(withUsage({ costPerEdit: null })));
    expect(container.textContent).toContain('--');
    expect(container.textContent).not.toContain('$0');
    unmount();
  });

  it('renders the dollar value; the "window cost ÷ edits" formula is off the face, on hover', () => {
    const { container, unmount } = render(CostPerEdit, props(withUsage({ costPerEdit: 0.42 })));
    const text = container.textContent;
    expect(text).toContain('$0.42');
    // Derivation leaves the face: no formula subline under the value.
    expect(text).not.toContain('÷');
    expect(text.toLowerCase()).not.toContain('edit-family tool calls');
    const hover = container.querySelector('[title]');
    expect(hover?.getAttribute('title')).toContain('÷');
    // Anti-grade framing lives on the hover, never the face.
    expect(text.toLowerCase()).not.toContain('not a grade');
    unmount();
  });
});

describe('SessionsWidget — period delta pill', () => {
  const Sessions = usageWidgets.sessions;

  function withSessions(totals) {
    const base = createEmptyOverview(30);
    return {
      ...base,
      usage: { ...base.usage, totals: { ...base.usage.totals, ...totals } },
    };
  }

  it('shows a delta pill when the prior window had sessions', () => {
    const overview = withSessions({
      sessions: 12,
      toolCalls: 40,
      sessionsDelta: { current: 12, previous: 8 },
    });
    const { container, unmount } = render(Sessions, props(overview));
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('↑');
    expect(container.textContent).toContain('4');
    unmount();
  });

  it('suppresses the delta pill when the prior window is empty', () => {
    const overview = withSessions({
      sessions: 5,
      toolCalls: 10,
      sessionsDelta: { current: 5, previous: null },
    });
    const { container, unmount } = render(Sessions, props(overview));
    expect(container.textContent).toContain('5');
    expect(container.querySelector('[class*="statInlineDelta"]')).toBeNull();
    unmount();
  });
});

describe('CostWidget — face is stat-only (partial disclosure moved to the cost drill)', () => {
  const Cost = usageWidgets.cost;

  function withCostAndModels(cost, byModel) {
    const base = createEmptyOverview(7);
    return {
      ...base,
      usage: { ...base.usage, cost },
      tools: { ...base.tools, byModel },
    };
  }

  it('shows the spend value, no "partial" filler, when a model is unpriced', () => {
    const overview = withCostAndModels(
      { totalUsd: 4.2, sessionsWithCost: 3, delta: null },
      [
        { model: 'claude-opus-4', calls: 3, tokensTotal: 8000, costUsd: 4.2 },
        { model: 'gpt-5', calls: 2, tokensTotal: 4000, costUsd: null },
      ],
    );
    const { container, unmount } = render(Cost, props(overview));
    const text = container.textContent;
    expect(text).toContain('$4.20');
    // The undercount caveat now lives on the usage → cost drill, not the tile.
    expect(text.toLowerCase()).not.toContain('partial');
    expect(text.toLowerCase()).not.toContain('unpriced');
    unmount();
  });

  it('is stat-only when every model with tokens is priced', () => {
    const overview = withCostAndModels(
      { totalUsd: 1.25, sessionsWithCost: 1, delta: null },
      [{ model: 'claude-opus-4', calls: 3, tokensTotal: 8000, costUsd: 1.25 }],
    );
    const { container, unmount } = render(Cost, props(overview));
    expect(container.textContent).toContain('$1.25');
    expect(container.textContent.toLowerCase()).not.toContain('partial');
    unmount();
  });

  it('is stat-only when byModel is empty', () => {
    const overview = withCostAndModels(
      { totalUsd: 2.0, sessionsWithCost: 1, delta: null },
      [],
    );
    const { container, unmount } = render(Cost, props(overview));
    expect(container.textContent).toContain('$2.00');
    expect(container.textContent.toLowerCase()).not.toContain('partial');
    unmount();
  });
});

describe('ModelMixWidget — unpriced model shows token share, not a fake $0', () => {
  const ModelMix = toolWidgets['model-mix'];

  it('falls back to token counts (never a fake $0) when any model is unpriced', () => {
    const overview = withTools({
      byModel: [
        { model: 'claude-opus-4-8', calls: 3, tokensTotal: 8000, costUsd: 0.5 },
        { model: 'gpt-5', calls: 2, tokensTotal: 4000, costUsd: null },
      ],
    });
    const { container, unmount } = render(ModelMix, props(overview));
    const text = container.textContent;
    // Head reads the model count (a value), the legend reads token counts — no $
    // implied anywhere, and no "token share" caption filler (that disclosure now
    // rides the Agents → Models drill this tile opens).
    expect(text).toContain('models');
    expect(text).toContain('tokens');
    expect(text).not.toContain('$0.00');
    expect(text).not.toContain('segments show token share');
    unmount();
  });

  it('shows a cost lead when every model is priced', () => {
    const overview = withTools({
      byModel: [{ model: 'claude-opus-4-8', calls: 3, tokensTotal: 8000, costUsd: 1.25 }],
    });
    const { container, unmount } = render(ModelMix, props(overview));
    expect(container.textContent).toContain('$1.25');
    unmount();
  });

  it('labels segments with the compact display name, not the raw id', () => {
    const overview = withTools({
      byModel: [
        { model: 'claude-opus-4-8', calls: 3, tokensTotal: 8000, costUsd: 1.25 },
        { model: 'claude-sonnet-4-6', calls: 2, tokensTotal: 4000, costUsd: 0.4 },
      ],
    });
    const { container, unmount } = render(ModelMix, props(overview));
    const text = container.textContent;
    expect(text).toContain('Opus 4.8');
    expect(text).toContain('Sonnet 4.6');
    expect(text).not.toContain('claude-opus-4-8');
    unmount();
  });

  it("passes an unrecognized model id through rather than inventing a name", () => {
    const overview = withTools({
      byModel: [
        { model: 'claude-opus-4-8', calls: 3, tokensTotal: 8000, costUsd: null },
        { model: 'gpt-5-codex', calls: 2, tokensTotal: 4000, costUsd: null },
      ],
    });
    const { container, unmount } = render(ModelMix, props(overview));
    expect(container.textContent).toContain('gpt-5-codex');
    unmount();
  });
});

const COMMIT_STATS = {
  windowDays: 7,
  commits: 23,
  filesTouched: 41,
  linesAdded: 1530,
  linesDeleted: 310,
  generatedLinesExcluded: 310,
  commitsFromSessions: 17,
};

describe('CommitsWidget (split out of the former commit-stats tile)', () => {
  const Commits = usageWidgets.commits;

  it('null commitStats renders -- (never a fabricated 0)', () => {
    const { container, unmount } = render(Commits, props(withCodebase({ commitStats: null })));
    expect(container.textContent).toContain('--');
    expect(container.textContent.toLowerCase()).toContain('git commit');
    unmount();
  });

  it('renders the commit count with no derivation subline (clarity precedent P1)', () => {
    const { container, unmount } = render(Commits, props(withCodebase({ commitStats: COMMIT_STATS })));
    const text = container.textContent;
    expect(text).toContain('23');
    // Face filler stripped: no secondary "N during sessions" count, no trailing-
    // window derivation (which also contradicted the range pill).
    expect(text).not.toContain('during sessions');
    expect(text).not.toContain('trailing');
    unmount();
  });
});

describe('NetLinesWidget (split out of the former commit-stats tile)', () => {
  const NetLines = usageWidgets['net-lines'];

  it('null commitStats renders -- (never a fabricated 0)', () => {
    const { container, unmount } = render(NetLines, props(withCodebase({ commitStats: null })));
    expect(container.textContent).toContain('--');
    unmount();
  });

  it('renders signed NET change (added − removed); the exclusion disclosure rides the hover', () => {
    const { container, unmount } = render(NetLines, props(withCodebase({ commitStats: COMMIT_STATS })));
    const text = container.textContent;
    expect(text).toContain('+1,220'); // 1530 − 310
    // 2026-07-03: derivation detail leaves the face (the value is the whole
    // face); the disclosure stays reachable on the value's hover.
    expect(text).not.toContain('generated excluded');
    const hover = container.querySelector('[title]');
    expect(hover?.getAttribute('title')).toContain('310 generated/lockfile lines excluded');
    unmount();
  });

  it('renders a negative net (more removed than added) with a minus, not a plus', () => {
    const net = { ...COMMIT_STATS, linesAdded: 40, linesDeleted: 540, generatedLinesExcluded: 0 };
    const { container, unmount } = render(NetLines, props(withCodebase({ commitStats: net })));
    const text = container.textContent;
    expect(text).toContain('500'); // 40 − 540 = −500
    expect(text).not.toContain('+500');
    unmount();
  });
});

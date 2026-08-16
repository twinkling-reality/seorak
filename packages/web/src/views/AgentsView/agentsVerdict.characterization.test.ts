/**
 * CHARACTERIZATION — the Agents verdict's whole output, pinned byte for byte.
 *
 * The behavioural tests beside this one assert the RULES (never a fabricated 0%, a
 * compare needs comparable coverage, and so on). This file asserts nothing at all
 * about intent: it runs every top-level entry point over a fixture matrix built to
 * reach each branch, and freezes the complete returned structure in a snapshot —
 * every number, every label, every hint, every disclosure sentence, every segment
 * of prose in order.
 *
 * It exists for extraction. A module split is only safe if the dashboard's numbers
 * and sentences come out identical on the other side, and "the rule tests still
 * pass" does not prove that: a rule test that pins `toContain('comparable ground')`
 * survives a reworded sentence around it. A snapshot of the whole segment stream
 * does not. The snapshot was recorded against the pre-split module, so any diff in
 * it during a refactor is a behaviour change, not a formatting nit.
 *
 * WHAT IT DOES NOT COVER: anything the fixtures do not reach. It is a regression
 * net over the branches enumerated in SCENARIOS, not a proof of total equivalence.
 */
import { describe, expect, it } from 'vitest';

import type {
  AgentDailyPoint,
  AgentHourPoint,
  AgentModelRollup,
  AgentOutcomeRollup,
  AgentRollup,
  ModelRollup,
  ProjectRollup,
} from '../../lib/apiSchemas.js';
import { resolveCapabilities } from '@seorak/types';

import {
  agentCadences,
  agentEditVolume,
  agentRecordStarts,
  agentTraceShare,
  buildAgentsCoverage,
  buildAgentsHistory,
  buildAgentsMatrix,
  buildAgentsNarrative,
  buildAgentsOutcomes,
  buildAgentsWhere,
  localHourOf,
  majorityModelByAgent,
  narrativeParagraphs,
  rankAgents,
  recordRailWorthShowing,
  shownSurvivalRate,
} from './agentsVerdict.js';

function agent(
  id: string,
  partial: Partial<AgentRollup> & Pick<AgentRollup, 'sessions' | 'toolCalls'>,
): AgentRollup {
  return {
    agent: id,
    activeSessions: 0,
    tokensTotal: 0,
    costUsd: null,
    lines: null,
    lastEventAt: '2026-07-11T00:00:00.000Z',
    capabilities: resolveCapabilities(id),
    erroredPresent: false,
    ...partial,
  };
}

function model(id: string, partial: Partial<ModelRollup>): ModelRollup {
  return { model: id, calls: 0, tokensTotal: 0, costUsd: null, ...partial };
}

function agentModel(
  agentId: string,
  modelId: string,
  tokensTotal: number,
  costUsd: number | null = null,
): AgentModelRollup {
  return { agent: agentId, model: modelId, calls: 4, tokensTotal, costUsd };
}

function hour(agentId: string, h: number, calls: number): AgentHourPoint {
  return { agent: agentId, hour: h, calls };
}

function outcome(
  id: string,
  partial: Partial<AgentOutcomeRollup> &
    Pick<AgentOutcomeRollup, 'linesAuthored' | 'linesSurviving'>,
): AgentOutcomeRollup {
  const authored = partial.linesAuthored;
  return {
    agent: id,
    survivalRate: authored > 0 ? partial.linesSurviving / authored : null,
    commits: 10,
    sessionsRated: 4,
    ratedCostUsd: null,
    costPerSurvivingLine: null,
    unreachableSessions: 0,
    unknownSessions: 0,
    filesGoneFromTip: 0,
    coverage: {
      linesInCommits: authored,
      linesAuthored: authored,
      linesOtherAgents: 0,
      linesContested: 0,
      linesUnattributed: 0,
    },
    ...partial,
  };
}

/** An outcome whose commits Seorak could only partly trace. */
function traced(o: AgentOutcomeRollup, share: number): AgentOutcomeRollup {
  const total = Math.round(o.linesAuthored / share);
  return {
    ...o,
    coverage: { ...o.coverage, linesInCommits: total, linesUnattributed: total - o.linesAuthored },
  };
}

const PROJECTS: ProjectRollup[] = [
  {
    project: 'seorak',
    repoId: 'r-1',
    byAgent: [
      agent('claude-code', { sessions: 6, toolCalls: 220, lines: { added: 640, removed: 120 } }),
      agent('codex', { sessions: 2, toolCalls: 70, lines: { added: 180, removed: 40 } }),
    ],
  },
  {
    project: 'chinmeister',
    repoId: 'r-2',
    byAgent: [
      agent('claude-code', { sessions: 3, toolCalls: 110, lines: { added: 260, removed: 80 } }),
    ],
  },
  {
    project: 'quiet-repo',
    repoId: 'r-3',
    byAgent: [],
  },
] as ProjectRollup[];

const HOURLY: AgentHourPoint[] = [
  ...[9, 11, 13, 15, 19].map((h) => hour('claude-code', h, 20)),
  ...[17, 18, 20].map((h) => hour('codex', h, 12)),
];

const DAILY: AgentDailyPoint[] = [
  { agent: 'claude-code', day: '2026-07-09', sessions: 3, lines: { added: 40, removed: 5 }, tokensTotal: null },
  { agent: 'claude-code', day: '2026-07-11', sessions: 2, lines: null, tokensTotal: null },
  { agent: 'codex', day: '2026-07-12', sessions: 1, lines: { added: 9, removed: 1 }, tokensTotal: null },
];

const NOW = Date.parse('2026-07-13T12:00:00.000Z');

interface Scenario {
  name: string;
  byAgent: AgentRollup[];
  projects: ProjectRollup[];
  byModel: ModelRollup[];
  agentModels: AgentModelRollup[];
  agentHourly: AgentHourPoint[];
  offsetMinutes: number;
  outcomes: AgentOutcomeRollup[];
  unusable: number;
}

function scenario(name: string, over: Partial<Scenario>): Scenario {
  return {
    name,
    byAgent: [],
    projects: [],
    byModel: [],
    agentModels: [],
    agentHourly: [],
    offsetMinutes: 0,
    outcomes: [],
    unusable: 0,
    ...over,
  };
}

const SCENARIOS: Scenario[] = [
  scenario('rich two-tool window with a clear leader and a rateable compare', {
    byAgent: [
      agent('claude-code', {
        sessions: 9,
        toolCalls: 330,
        tokensTotal: 1_200_000,
        costUsd: 42.5,
        lines: { added: 900, removed: 200 },
        firstSeenAt: '2026-06-05T11:48:00.048Z',
        erroredPresent: true,
        errorRate: { rate: 489 / 9412, errored: 489, returned: 9412, calls: 9412 },
      }),
      agent('codex', {
        sessions: 3,
        toolCalls: 82,
        tokensTotal: 90_000,
        lines: { added: 180, removed: 40 },
        firstSeenAt: '2026-07-12T02:44:46.662Z',
        erroredPresent: true,
        errorRate: { rate: 8 / 224, errored: 8, returned: 224, calls: 509 },
      }),
    ],
    projects: PROJECTS,
    byModel: [
      model('claude-opus-4-8', { calls: 210, tokensTotal: 900_000, costUsd: 38 }),
      model('claude-haiku-4-5', { calls: 60, tokensTotal: 300_000, costUsd: 4.5 }),
      model('gpt-5.5', { calls: 82, tokensTotal: 90_000, costUsd: 6 }),
      model('gpt-5.4-mini', { calls: 5, tokensTotal: 4_000, costUsd: 0.2 }),
    ],
    agentModels: [
      agentModel('claude-code', 'claude-opus-4-8', 900_000, 38),
      agentModel('claude-code', 'claude-haiku-4-5', 300_000, 4.5),
      agentModel('codex', 'gpt-5.5', 90_000, 6),
    ],
    agentHourly: HOURLY,
    offsetMinutes: 240,
    outcomes: [
      traced(outcome('claude-code', { linesAuthored: 1200, linesSurviving: 840 }), 0.85),
      traced(outcome('codex', { linesAuthored: 900, linesSurviving: 810, commits: 7 }), 0.9),
    ],
    unusable: 3,
  }),

  scenario('close shares, unpriced models, non-comparable outcome coverage', {
    byAgent: [
      agent('claude-code', { sessions: 5, toolCalls: 50, lines: { added: 52, removed: 0 } }),
      agent('codex', { sessions: 5, toolCalls: 50, lines: { added: 48, removed: 0 } }),
    ],
    projects: PROJECTS,
    byModel: [
      model('claude-opus-4-8', { calls: 10, tokensTotal: 5_000, costUsd: 12 }),
      model('gpt-5.5', { calls: 4, tokensTotal: 20_000, costUsd: null }),
    ],
    agentModels: [agentModel('claude-code', 'claude-opus-4-8', 5_000, 12)],
    outcomes: [
      traced(outcome('claude-code', { linesAuthored: 1000, linesSurviving: 700 }), 0.85),
      traced(outcome('codex', { linesAuthored: 800, linesSurviving: 760 }), 0.3),
    ],
  }),

  scenario('only one tool reports lines, a silent error leg, nothing rateable yet', {
    byAgent: [
      agent('claude-code', {
        sessions: 10,
        toolCalls: 100,
        lines: { added: 900, removed: 100 },
        errorRate: { rate: 0.05, errored: 5, returned: 100, calls: 100 },
      }),
      agent('codex', {
        sessions: 2,
        toolCalls: 60,
        errorRate: { rate: null, errored: 0, returned: 0, calls: 60 },
      }),
    ],
    projects: PROJECTS,
    outcomes: [outcome('claude-code', { linesAuthored: 200, linesSurviving: 150, commits: 1 })],
  }),

  scenario('no edit lines at all, so the read falls back to sessions', {
    byAgent: [
      agent('claude-code', { sessions: 8, toolCalls: 10 }),
      agent('codex', { sessions: 1, toolCalls: 2 }),
    ],
    projects: [],
    outcomes: [
      outcome('claude-code', { linesAuthored: 1000, linesSurviving: 700, filesGoneFromTip: 12 }),
    ],
  }),

  scenario('the rounding edge, where a 100 / 0 split would overclaim', {
    byAgent: [
      agent('claude-code', {
        sessions: 10,
        toolCalls: 300,
        lines: { added: 70_000, removed: 490 },
      }),
      agent('codex', { sessions: 2, toolCalls: 3, lines: { added: 1, removed: 1 } }),
    ],
    projects: [],
    outcomes: [
      outcome('claude-code', { linesAuthored: 1400, linesSurviving: 1100 }),
      outcome('codex', {
        linesAuthored: 900,
        linesSurviving: 700,
        unreachableSessions: 3,
        filesGoneFromTip: 4,
      }),
    ],
  }),

  scenario('a single agent, which is honest-empty by construction', {
    byAgent: [agent('claude-code', { sessions: 3, toolCalls: 5 })],
    projects: PROJECTS,
  }),

  scenario('three tools sharing the window', {
    byAgent: [
      agent('claude-code', { sessions: 9, toolCalls: 300, lines: { added: 900, removed: 100 } }),
      agent('codex', { sessions: 4, toolCalls: 120, lines: { added: 200, removed: 40 } }),
      agent('cursor', { sessions: 2, toolCalls: 40, lines: { added: 60, removed: 10 } }),
    ],
    projects: PROJECTS,
    outcomes: [
      traced(outcome('claude-code', { linesAuthored: 1200, linesSurviving: 900 }), 0.9),
      traced(outcome('codex', { linesAuthored: 1000, linesSurviving: 880 }), 0.88),
      outcome('cursor', { linesAuthored: 120, linesSurviving: 100, commits: 1 }),
    ],
  }),
];

describe('agents verdict output, pinned over a fixture matrix', () => {
  for (const s of SCENARIOS) {
    it(`is unchanged for: ${s.name}`, () => {
      const narrative = buildAgentsNarrative(
        s.byAgent,
        s.projects,
        s.byModel,
        s.agentModels,
        s.agentHourly,
        s.offsetMinutes,
        s.outcomes,
      );
      const order = rankAgents(s.byAgent).map((a) => a.agent);
      expect({
        narrative,
        paragraphs: narrativeParagraphs(narrative.segments),
        matrix: buildAgentsMatrix(s.byAgent),
        where: buildAgentsWhere(s.projects, order),
        coverage: buildAgentsCoverage(s.byAgent),
        outcomes: buildAgentsOutcomes(s.outcomes, s.byAgent, s.unusable),
        history: buildAgentsHistory(
          DAILY,
          s.agentHourly,
          order,
          7,
          NOW,
          s.offsetMinutes,
          s.byAgent,
        ),
        cadences: agentCadences(s.agentHourly, s.offsetMinutes),
        majorityModels: [...majorityModelByAgent(s.agentModels).entries()],
        editVolume: s.byAgent.map((a) => [a.agent, agentEditVolume(a)]),
        rank: order,
        survival: s.outcomes.map((o) => [o.agent, shownSurvivalRate(o), agentTraceShare(o)]),
      }).toMatchSnapshot();
    });
  }
});

describe('record rail and clock helpers, pinned', () => {
  const DAYS = ['2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13'];
  const ORDER = ['claude-code', 'codex'];

  it('is unchanged across every record-depth shape', () => {
    const cases: Array<[string | undefined, string | undefined]> = [
      ['2026-06-05T11:48:00.048Z', '2026-07-12T02:44:46.662Z'],
      ['2026-07-09T23:59:59.999Z', '2026-07-11T00:00:00.000Z'],
      ['2026-06-05T00:00:00.000Z', '2026-06-05T00:00:00.000Z'],
      [undefined, '2026-07-12T00:00:00.000Z'],
      ['nonsense', '2026-07-12T00:00:00.000Z'],
      ['', ''],
      ['2030-01-01T00:00:00.000Z', '2026-07-12T00:00:00.000Z'],
    ];
    expect(
      cases.map(([first, second]) => {
        const starts = agentRecordStarts(
          ORDER,
          [
            agent('claude-code', { sessions: 4, toolCalls: 9, firstSeenAt: first }),
            agent('codex', { sessions: 1, toolCalls: 2, firstSeenAt: second }),
          ],
          DAYS,
        );
        return { first, second, starts, rail: recordRailWorthShowing(starts) };
      }),
    ).toMatchSnapshot();
  });

  it('is unchanged for every UTC hour at a set of viewer offsets', () => {
    expect(
      [-720, -330, -120, 0, 60, 240, 570, 840].map((offset) => ({
        offset,
        hours: Array.from({ length: 24 }, (_, h) => localHourOf(h, offset)),
      })),
    ).toMatchSnapshot();
  });
});

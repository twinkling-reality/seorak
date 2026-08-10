import { describe, expect, it } from 'vitest';
import { sessionToSummary, DEFAULT_THRESHOLDS } from '@seorak/types';
import type { SessionState, OverviewSnapshot } from '@seorak/types';
import { overviewSnapshotSchema, sessionSummarySchema, createEmptyOverview } from '../common.js';

type DeepRequired<T> = T extends readonly (infer Item)[]
  ? DeepRequired<Item>[]
  : T extends object
    ? { [Key in keyof T]-?: DeepRequired<T[Key]> }
    : T;

const deepRequiredWitness: DeepRequired<{ nested: { optional?: string } }> = {
  // @ts-expect-error The parity fixture must reject a missing nested optional.
  nested: {},
};
void deepRequiredWitness;

// Exhaustive contract-parity guard — CONTRACT-SEAM-AUDIT.md F2 / WS2-P1.
//
// The web zod schemas are written `z.object({...}) as unknown as z.ZodType<T>`
// (common.ts). The cast defeats TypeScript's structural check, and z.object()
// runs in default STRIP mode, so any key the worker sends that is NOT declared
// in the schema is silently dropped at parse time with ZERO diagnostics —
// validateResponse (schemas/index.ts) only warns on a parse *failure*, never on
// a successful strip. So a new field added to OverviewSnapshot / SessionSummary
// and populated by the worker renders empty in production with a green CI.
//
// The schema intentionally has a small number of sparse-field and additive-enum
// transforms whose input types diverge from the output contract, so the cast
// alone cannot prove key parity. The durable guard is this round trip.
//
// These tests close the hole: round-trip a FULLY-POPULATED canonical object
// through the real schema and assert NO key is dropped. Add a field upstream and
// forget common.ts → the round-trip loses the key → this fails, turning a silent
// production strip into a red build. The overview fixture is recursively
// required, so new required or optional keys at any depth fail to compile here
// until they are carried.

// Recursively assert every key in `input` survives in `parsed` (the schema did
// not strip it). Walks nested objects + the first element of each non-empty
// array; null / primitive leaves terminate. Reports the full dotted path of any
// dropped key so a failure points straight at the missing common.ts declaration.
function assertNoKeysStripped(input: unknown, parsed: unknown, path = '$'): void {
  if (Array.isArray(input)) {
    if (input.length === 0) return;
    expect(Array.isArray(parsed), `${path} should stay an array`).toBe(true);
    assertNoKeysStripped(input[0], (parsed as unknown[])[0], `${path}[0]`);
    return;
  }
  if (input !== null && typeof input === 'object') {
    expect(
      parsed !== null && typeof parsed === 'object',
      `${path} should stay an object after parse`,
    ).toBe(true);
    for (const key of Object.keys(input)) {
      const childPath = `${path}.${key}`;
      expect(
        Object.prototype.hasOwnProperty.call(parsed as object, key),
        `schema STRIPPED ${childPath} — declare it in common.ts (z.object strip-mode silently drops undeclared keys)`,
      ).toBe(true);
      assertNoKeysStripped(
        (input as Record<string, unknown>)[key],
        (parsed as Record<string, unknown>)[key],
        childPath,
      );
    }
  }
}

describe('contract parity — SessionSummary survives the web schema', () => {
  it('every key sessionToSummary emits round-trips through sessionSummarySchema', () => {
    // A fully-populated canonical session. endedAt + currentTool + awaitingInput
    // are set so all THREE conditional projection keys are exercised
    // (sessionToSummary only emits them when present). `satisfies SessionState`
    // forces every REQUIRED canonical field — a new one fails to compile here until
    // carried. awaitingInput is the live-glanceable optional field the audit's F5
    // names as the canonical drop-risk: it round-trips here or the guard goes red.
    const state = {
      sessionId: 's1',
      startedAt: '2026-06-14T12:00:00.000Z',
      lastEventAt: '2026-06-14T12:30:00.000Z',
      endedAt: '2026-06-14T12:30:00.000Z',
      repoId: 'a'.repeat(64),
      repoLabel: 'seorak',
      agent: 'claude-code',
      member: { memberId: 'member_123', displayName: 'Alex' },
      toolCallCount: 42,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      totalCacheReadTokens: 200,
      totalCacheWriteTokens: 100,
      totalCostUsd: 1.23,
      currentTool: 'Bash',
      awaitingInput: true,
      status: 'ended',
    } satisfies SessionState;

    // sessionToSummary IS the exact shape the worker serializes to /live + /sessions
    // + overview.live, so its output is the real contract the web schema must not
    // strip. JSON round-trip mirrors the HTTP wire.
    const summary = sessionToSummary(state);
    const wire = JSON.parse(JSON.stringify(summary));
    const parsed = sessionSummarySchema.parse(wire);

    assertNoKeysStripped(summary, parsed);
  });
});

describe('contract parity — OverviewSnapshot survives the web schema', () => {
  it('every declared OverviewSnapshot field round-trips with no silent strip', () => {
    const base = createEmptyOverview(7);
    // Fully populate every array + nullable so each element/leaf schema is
    // exercised (an empty array would never reach its element schema). Built off
    // the honest-empty base then overridden.
    //
    // DA-08/F-05: DeepRequired forces every optional key at every depth into
    // this fixture. A newly added nested optional therefore fails typecheck
    // until the fixture carries it, after which assertNoKeysStripped proves the
    // web schema carries it too.
    const full = {
      ...base,
      notificationAvailability: base.notificationAvailability!,
      live: [
        {
          sessionId: 's1',
          project: 'seorak',
          repoId: 'r1',
          agent: 'claude-code',
          member: { memberId: 'member_123', displayName: 'Alex' },
          status: 'ended',
          startedAt: '2026-06-14T12:00:00.000Z',
          lastEventAt: '2026-06-14T12:30:00.000Z',
          endedAt: '2026-06-14T12:30:00.000Z',
          elapsedSeconds: 1800,
          toolCallCount: 42,
          currentTool: 'Bash',
          awaitingInput: false,
          tokens: {
            input: 1000,
            output: 500,
            cacheRead: 200,
            cacheWrite: 100,
            total: 1500,
          },
          costUsd: 1.23,
          burnRateUsdPerMin: 0.041,
        },
      ],
      // DA-08: explicit (not via ...base) so the type is InterventionThresholds,
      // not `| undefined`. Required<OverviewSnapshot> needs every optional present.
      thresholds: DEFAULT_THRESHOLDS,
      // Usage-headroom readings — a new optional top-level field; carried here (and
      // declared in common.ts) so the parity guard proves it round-trips.
      //
      // BOTH LEGS are exercised (CODEX-CAPTURE ADR-C15). A fixture carrying only the
      // count leg would let a missing `usedPercent` declaration sail through STRIP mode
      // green while erasing Codex's entire reading on the live path. The fixture must
      // hold every shape the contract can take, or it is not a parity guard.
      usageAllowances: [
        // COUNT leg: a real numerator, no ceiling anyone publishes, so no % can render.
        {
          tool: 'claude-code',
          period: 'rolling-5h',
          consumed: 42000,
          unit: 'tokens',
          allowance: null,
          usedPercent: null,
          resetsAt: null,
          observedAt: null,
          source: 'none',
          coverageComplete: false,
        },
        {
          tool: 'claude-code',
          period: 'weekly',
          consumed: 310000,
          unit: 'tokens',
          allowance: null,
          usedPercent: null,
          resetsAt: null,
          observedAt: null,
          source: 'none',
          coverageComplete: false,
        },
        // RATIO leg: a provider-given percentage and neither term, so no count can
        // render. Complete (it counts ChatGPT too) but observed in the past.
        {
          tool: 'codex',
          period: 'weekly',
          consumed: null,
          unit: null,
          allowance: null,
          usedPercent: 2,
          resetsAt: '2026-07-19T19:24:52.000Z',
          observedAt: '2026-07-13T01:51:31.461Z',
          source: 'provider-auth',
          coverageComplete: true,
        },
      ],
      usage: {
        ...base.usage,
        cost: {
          totalUsd: 12.5,
          sessionsWithCost: 3,
          costPartial: true,
          unpricedModels: [
            { model: 'claude-fable-5', tokensTotal: 3500 },
          ],
          delta: { current: 12.5, previous: 8.0 },
        },
        lines: { added: 540, removed: 120, delta: { current: 540, previous: 300 } },
        dailyTrends: [{ day: '2026-06-14', sessions: 3, costUsd: 12.5, tokensTotal: 42_000 }],
        projects: [
          {
            project: 'seorak',
            repoId: 'r1',
            sessions: 4,
            sessionsDelta: { current: 4, previous: 3 },
            activeSessions: 1,
            toolCalls: 99,
            tokensTotal: 5000,
            costUsd: 2.1,
            lastEventAt: '2026-06-14T12:00:00.000Z',
            errorRate: 0.05,
            cacheReuseRatio: 0.8,
            shipRate: 0.75,
            oneShotRate: 0.5,
            costDelta: { current: 2.1, previous: 1.4 },
            endReasons: [{ reason: 'clear', count: 5 }],
            stuckness: { rate: 0.25, stuckCount: 1, inFlight: 4, stuckSessionIds: ['s1'] },
            byTool: [{ tool: 'Bash', calls: 40, sessions: 3 }],
            byModel: [{ model: 'claude-opus-4', calls: 3, tokensTotal: 1000, costUsd: 0.5 }],
            byAgent: [],
            hourlyDistribution: [{ dow: 5, hour: 12, sessions: 3 }],
            lineSurvival: {
              rate: 0.82,
              linesAuthored: 540,
              linesSurviving: 443,
              commitsChecked: 10,
              sessionsRated: 4,
              retained: 3,
              overwritten: 1,
              unreachable: 1,
              unknown: 0,
            },
            endReasonsByHour: [{ hour: 12, reasons: [{ reason: 'clear', count: 5 }] }],
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
            cacheReadTokens: 4000,
            cacheInputTokens: 1000,
            shipped: 3,
            shipDeterminable: 4,
            oneShots: 2,
            oneShotDeterminable: 4,
            toolErrors: 3,
            toolCallsReturned: 60,
            editCalls: 40,
            dirEditsTotal: 35,
            commitsFromSessions: 3,
            lines: {
              added: 400,
              removed: 80,
              priorAdded: 300,
            },
            character: {
              repoShape: { monorepo: false, sizeBand: 'm', ageBand: 'established' },
              packageManager: 'pnpm',
              framework: 'react',
              observedAt: '2026-06-14T12:00:00.000Z',
            },
            workMix: {
              fileLanguageMix: [{ language: 'typescript', editCalls: 40 }],
              branchWorkTypeMix: [{ workType: 'feature', sessions: 3 }],
              fileCategoryMix: [{ category: 'source', editCalls: 35 }],
              peakHour: { dow: 5, hour: 14, sessions: 2 },
              sessionDurationMedianSeconds: 3600,
            },
            interventionFires: 2,
          },
        ],
        momentum: [
          {
            repoId: 'r1',
            repoLabel: 'seorak',
            gitContext: 'clean',
            windowDays: 7,
            commits: 12,
            filesTouched: 34,
            linesAdded: 600,
            linesDeleted: 60,
            netLines: 540,
            generatedLinesExcluded: 14632,
          },
        ],
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
          ],
        },
        cacheReuseRatio: 0.42,
        costPerEdit: 0.03,
      },
      codebase: {
        files: [
          {
            fileId: 'f1',
            label: 'projections.ts',
            edits: 7,
            linesAdded: 80,
            linesRemoved: 12,
            sessions: 2,
            projects: [
              { repoId: 'r1', project: 'seorak', edits: 7, sessions: 2 },
            ],
          },
        ],
        directories: [
          {
            dirId: 'd1',
            label: 'src',
            edits: 12,
            share: 0.6,
            projects: [
              { repoId: 'r1', project: 'seorak', edits: 12, sessions: 3 },
            ],
          },
        ],
        rework: [
          {
            fileId: 'f1',
            label: 'projections.ts',
            sessions: 3,
            edits: 9,
            projects: [
              { repoId: 'r1', project: 'seorak', edits: 9, sessions: 3 },
            ],
          },
        ],
        commitStats: {
          windowDays: 7,
          commits: 12,
          filesTouched: 34,
          linesAdded: 600,
          linesDeleted: 60,
          generatedLinesExcluded: 14632,
          commitsFromSessions: 4,
        },
        filesInPlay: {
          distinctFiles: 2,
          files: [
            {
              fileId: 'f1',
              label: 'projections.ts',
              category: 'source',
              edits: 7,
              lastEditedAt: '2026-06-14T12:00:00.000Z',
              projects: [{ repoId: 'r1', project: 'seorak', edits: 7, sessions: 1 }],
            },
          ],
        },
      },
      outcomes: {
        ...base.outcomes,
        endReasons: [{ reason: 'clear', count: 5 }],
        activeCount: 1,
        endedCount: 5,
        stuckness: { rate: 0.2, stuckCount: 1, inFlight: 5, stuckSessionIds: ['s1'] },
        endReasonsByDay: [{ day: '2026-06-14', reasons: [{ reason: 'clear', count: 5 }] }],
        oneShotRate: 0.5,
        shipRate: 0.75,
        lineSurvival: {
          rate: 0.82,
          linesAuthored: 540,
          linesSurviving: 443,
          commitsChecked: 10,
          sessionsRated: 4,
          retained: 3,
          overwritten: 1,
          unreachable: 1,
          unknown: 0,
        },
        bySession: [
          {
            sessionId: 's1',
            project: 'seorak',
            repoId: 'r1',
            endedAt: '2026-06-14T12:30:00.000Z',
            status: 'overwritten',
          },
        ],
      },
      activity: {
        hourlyDistribution: [{ dow: 5, hour: 12, sessions: 3 }],
        agentHourly: [{ agent: 'claude-code', hour: 12, calls: 40 }],
        endReasonsByHour: [{ hour: 12, reasons: [{ reason: 'clear', count: 5 }] }],
      },
      tools: {
        byTool: [{ tool: 'Bash', calls: 40, sessions: 3 }],
        callStats: { totalCalls: 99, errorRate: 0.076 },
        byModel: [{ model: 'claude-opus-4', calls: 3, tokensTotal: 1000, costUsd: 0.5 }],
        byAgent: [
          {
            agent: 'claude-code',
            sessions: 4,
            activeSessions: 1,
            toolCalls: 99,
            tokensTotal: 5000,
            costUsd: 2.1,
            lines: { added: 400, removed: 80 },
            lastEventAt: '2026-06-14T12:00:00.000Z',
            firstSeenAt: '2026-06-01T12:00:00.000Z',
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
            erroredPresent: true,
            errorRate: {
              rate: 0.05,
              errored: 3,
              returned: 60,
              calls: 99,
            },
          },
        ],
        agentDaily: [
          {
            agent: 'claude-code',
            day: '2026-06-14',
            sessions: 4,
            lines: { added: 400, removed: 80 },
          },
        ],
        agentModels: [
          {
            agent: 'claude-code',
            model: 'claude-opus-4',
            calls: 3,
            tokensTotal: 1000,
            costUsd: 0.5,
          },
        ],
        // Per-agent OUTCOMES from git — every leg populated, so a schema that forgets any
        // one of them (and would therefore render it empty in production) fails HERE.
        agentOutcomes: [
          {
            agent: 'claude-code',
            linesAuthored: 800,
            linesSurviving: 600,
            survivalRate: 0.75,
            commits: 5,
            sessionsRated: 3,
            ratedCostUsd: 4.2,
            costPerSurvivingLine: 0.007,
            unreachableSessions: 1,
            unknownSessions: 0,
            filesGoneFromTip: 2,
            coverage: {
              linesInCommits: 1000,
              linesAuthored: 800,
              linesOtherAgents: 50,
              linesContested: 30,
              linesUnattributed: 120,
            },
          },
        ],
        agentOutcomesUnusable: 2,
        verification: [{ kind: 'test', passRate: null, runs: 5, passed: 0 }],
      },
    } satisfies DeepRequired<OverviewSnapshot>;

    const wire = JSON.parse(JSON.stringify(full));
    const parsed = overviewSnapshotSchema.parse(wire);

    assertNoKeysStripped(full, parsed);
  });
});

describe('usageAllowances degrade element-wise, never the dashboard', () => {
  // A future enum member may cost only that gauge because dropping it cannot
  // fabricate a required measurement. The required array itself remains strict.
  function snapshotWithAllowances(allowances: unknown) {
    const snap = structuredClone(createEmptyOverview(7)) as Record<string, any>;
    snap.usage.totals = { sessions: 12, toolCalls: 340, sessionsDelta: null };
    snap.usageAllowances = allowances;
    return snap;
  }

  const clean = {
    tool: 'claude-code',
    period: 'weekly',
    consumed: 310000,
    unit: 'tokens',
    allowance: null,
    usedPercent: null,
    resetsAt: null,
    observedAt: null,
    source: 'none',
    coverageComplete: false,
  };

  it('one out-of-enum element costs ONLY that gauge; the rest still parse', () => {
    const drifted = snapshotWithAllowances([
      clean,
      { ...clean, tool: 'codex', period: 'daily-from-the-future' },
    ]);
    const parsed: any = overviewSnapshotSchema.parse(drifted);
    // The clean gauge survives, the drifted one is dropped, the dashboard keeps
    // its real worker data instead of the honest-empty fallback.
    expect(parsed.usageAllowances).toEqual([clean]);
    expect(parsed.usage.totals.sessions).toBe(12);
  });

  it('a non-array current usageAllowances field rejects the response', () => {
    const mangled = snapshotWithAllowances('not-an-array');
    expect(overviewSnapshotSchema.safeParse(mangled).success).toBe(false);
  });
});

describe('contract parity — the guard itself has teeth', () => {
  it('assertNoKeysStripped fails when a nested key is dropped', () => {
    const input = { a: 1, nested: { b: 2, c: 3 }, list: [{ d: 4 }] };
    const strippedKey = { a: 1, nested: { b: 2 }, list: [{ d: 4 }] }; // nested.c gone
    expect(() => assertNoKeysStripped(input, strippedKey)).toThrow();

    const strippedInArray = { a: 1, nested: { b: 2, c: 3 }, list: [{}] }; // list[0].d gone
    expect(() => assertNoKeysStripped(input, strippedInArray)).toThrow();
  });
});

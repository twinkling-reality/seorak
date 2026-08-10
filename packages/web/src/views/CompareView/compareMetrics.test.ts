import { describe, expect, it } from 'vitest';

import { createEmptyOverview } from '../../lib/schemas/common.js';
import type { OverviewSnapshot, ProjectRollup, RepoMomentum } from '../../lib/apiSchemas.js';
import {
  COMPARE_METRICS,
  compareRepoOptions,
  resolveRepo,
  type RepoData,
} from './compareMetrics.js';

// docs/specs/multi-repo.md Phase 2: compare is a presentation layer over two
// ProjectRollup rows. These guard the two things that must stay honest — the
// honesty gates (null/[] → '--', never a fabricated 0) and repoId resolution.

function makeRollup(over: Partial<ProjectRollup> = {}): ProjectRollup {
  return {
    project: 'repo',
    repoId: 'r',
    sessions: 0,
    sessionsDelta: null,
    activeSessions: 0,
    toolCalls: 0,
    tokensTotal: 0,
    costUsd: null,
    lastEventAt: '2026-06-14T00:00:00.000Z',
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
    ...over,
  } satisfies ProjectRollup;
}

function repoData(rollup: ProjectRollup, momentum: RepoMomentum | null = null): RepoData {
  return {
    project: rollup.project,
    repoId: rollup.repoId,
    rollup,
    momentum,
    temperature: null,
  };
}

function cellById(id: string, data: RepoData) {
  const metric = COMPARE_METRICS.find((m) => m.id === id);
  if (!metric) throw new Error(`no metric ${id}`);
  return metric.read(data);
}

function overviewWith(
  projects: ProjectRollup[],
  momentum: RepoMomentum[] = [],
): OverviewSnapshot {
  const overview = createEmptyOverview(30);
  overview.usage.projects = projects;
  overview.usage.momentum = momentum;
  return overview;
}

describe('resolveRepo', () => {
  it('resolves a stable repo id and matches momentum by repoId', () => {
    const rollup = makeRollup({ project: 'seorak', repoId: 'r-seorak', sessions: 12 });
    const momentum = { repoId: 'r-seorak', commits: 7 } as unknown as RepoMomentum;
    const overview = overviewWith([rollup], [momentum]);

    const resolved = resolveRepo(overview, 'r-seorak');
    expect(resolved.status).toBe('ok');
    expect(resolved.data?.repoId).toBe('r-seorak');
    expect(resolved.data?.momentum?.commits).toBe(7);
    expect(resolved.ambiguous).toBe(false);
  });

  it('an empty request is status "empty", never a fabricated pick', () => {
    const overview = overviewWith([makeRollup({ project: 'seorak' })]);
    const resolved = resolveRepo(overview, '');
    expect(resolved.status).toBe('empty');
    expect(resolved.data).toBeNull();
  });

  it('an unknown basename is status "unknown", never snapped to another repo', () => {
    const overview = overviewWith([makeRollup({ project: 'seorak' })]);
    const resolved = resolveRepo(overview, 'ghost');
    expect(resolved.status).toBe('unknown');
    expect(resolved.data).toBeNull();
  });

  it('flags a basename collision (same name, two repoIds) and takes the first', () => {
    const a = makeRollup({ project: 'api', repoId: 'r-1', sessions: 5 });
    const b = makeRollup({ project: 'api', repoId: 'r-2', sessions: 9 });
    const overview = overviewWith([a, b]);
    const resolved = resolveRepo(overview, 'api');
    expect(resolved.status).toBe('ok');
    expect(resolved.ambiguous).toBe(true);
    expect(resolved.data?.repoId).toBe('r-1');
  });

  it('resolves with no momentum row when git.momentum has not landed', () => {
    const overview = overviewWith([makeRollup({ project: 'seorak', repoId: 'r-seorak' })]);
    const resolved = resolveRepo(overview, 'seorak');
    expect(resolved.data?.momentum).toBeNull();
  });
});

describe('compareRepoOptions', () => {
  it('lists every stable repo id busiest-first, including colliding labels', () => {
    const overview = overviewWith([
      makeRollup({ project: 'a', repoId: 'r-a', sessions: 2 }),
      makeRollup({ project: 'b', repoId: 'r-b', sessions: 40 }),
      makeRollup({ project: 'a', repoId: 'r-a2', sessions: 1 }), // collision, deduped
    ]);
    expect(compareRepoOptions(overview)).toEqual([
      { value: 'r-b', label: 'b', repoId: 'r-b' },
      { value: 'r-a', label: 'a', repoId: 'r-a' },
      { value: 'r-a2', label: 'a', repoId: 'r-a2' },
    ]);
  });
});

describe('metric honesty gates (null / [] → "--", never a fabricated 0)', () => {
  const empty = repoData(makeRollup());

  it.each([
    'cost',
    'ship-rate',
    'line-survival',
    'stuck-rate',
    'one-shot-rate',
    'tool-error-rate',
    'top-end-reason',
    'top-verification',
    'top-file',
    'git-commits',
    'repo-size',
    'repo-age',
    'repo-layout',
    'stack',
    'file-category',
    'framework',
    'package-manager',
    'git-context',
    'temperature',
    'cost-trend',
    'cost-per-edit',
    'cache-reuse',
    'edit-volume',
    'commits-from-sessions',
    'branch-mix',
    'top-tool',
    'top-model',
    'top-directory',
    'rework-file',
    'peak-time',
    'typical-session',
  ])('%s reads honest-empty "--" with no data', (id) => {
    const cell = cellById(id, empty);
    expect(cell.value).toBe('--');
    expect(cell.empty).toBe(true);
  });

  it('sessions is a real count (0 is honest, not "--")', () => {
    expect(cellById('sessions', empty).value).toBe('0');
    expect(cellById('sessions', empty).empty).toBe(false);
  });

  it('a zero rate is rendered as 0%, distinct from honest-empty "--"', () => {
    const cell = cellById('ship-rate', repoData(makeRollup({ shipRate: 0 })));
    expect(cell.value).toBe('0%');
    expect(cell.empty).toBe(false);
  });

  it('a rollup MISSING array/object fields (undefined) reads "--", never throws', () => {
    // The demo path builds rollups without zod defaults, so codebaseFiles /
    // verification / endReasons / stuckness can be undefined, not []. Every
    // metric must treat that as honest-empty, not crash.
    const partial = {
      project: 'seorak',
      repoId: 'r-seorak',
      sessions: 8,
      sessionsDelta: null,
      activeSessions: 0,
      toolCalls: 40,
      tokensTotal: 0,
      costUsd: 3.2,
      lastEventAt: '2026-06-14T00:00:00.000Z',
      errorRate: null,
      cacheReuseRatio: null,
      shipRate: null,
      oneShotRate: null,
      costDelta: null,
      // endReasons, stuckness, codebaseFiles, verification, lineSurvival all absent
    } as unknown as ProjectRollup;
    const data = repoData(partial);
    for (const metric of COMPARE_METRICS) {
      expect(() => metric.read(data)).not.toThrow();
    }
    expect(cellById('top-file', data).value).toBe('--');
    expect(cellById('top-verification', data).value).toBe('--');
    expect(cellById('top-end-reason', data).value).toBe('--');
    expect(cellById('stuck-rate', data).value).toBe('--');
    // Real scalars still read through.
    expect(cellById('sessions', data).value).toBe('8');
    expect(cellById('cost', data).value).toBe('$3.20');
  });
});

describe('metric reads (populated)', () => {
  it('cost formats measured spend', () => {
    expect(cellById('cost', repoData(makeRollup({ costUsd: 42.5 }))).value).toBe('$42.50');
  });

  it('rates render as percentages', () => {
    expect(cellById('ship-rate', repoData(makeRollup({ shipRate: 0.8 }))).value).toBe('80%');
    expect(cellById('tool-error-rate', repoData(makeRollup({ errorRate: 0.05 }))).value).toBe('5%');
  });

  it('top-end-reason picks the dominant reason and its share', () => {
    const cell = cellById(
      'top-end-reason',
      repoData(
        makeRollup({
          endReasons: [
            { reason: 'clear', count: 6 },
            { reason: 'logout', count: 2 },
          ],
        }),
      ),
    );
    // endReasonLabel('clear') → "You closed it"
    expect(cell.value.toLowerCase()).toContain('closed');
    expect(cell.sub).toBe('75% of ended sessions');
  });

  it('top-verification surfaces the kind with the most failed runs', () => {
    const cell = cellById(
      'top-verification',
      repoData(
        makeRollup({
          verification: [
            { kind: 'test', passRate: 0, runs: 4, passed: 0 },
            { kind: 'lint', passRate: 0, runs: 1, passed: 0 },
          ],
        }),
      ),
    );
    expect(cell.value).toBe('Tests');
    expect(cell.sub).toBe('4 failed');
  });

  it('top-file shows the hottest file and its edit count', () => {
    const cell = cellById(
      'top-file',
      repoData(
        makeRollup({
          codebaseFiles: [
            { fileId: 'f1', label: 'router.ts', edits: 9, linesAdded: 0, linesRemoved: 0, sessions: 3 },
          ],
        }),
      ),
    );
    expect(cell.value).toBe('router.ts');
    expect(cell.sub).toBe('9 edits');
  });

  it('repo shape facets read as separate rows', () => {
    const data = repoData(
      makeRollup({
        character: {
          repoShape: { monorepo: true, sizeBand: 'l', ageBand: 'established' },
        },
      }),
    );
    expect(cellById('repo-size', data).value).toBe('Large');
    expect(cellById('repo-age', data).value).toBe('Established');
    expect(cellById('repo-layout', data).value).toBe('Monorepo');
    expect(cellById('repo-size', data).sub).toBeUndefined();
  });

  it('populated cells keep the product-copy contract', () => {
    const data = repoData(
      makeRollup({
        character: {
          repoShape: { monorepo: true, sizeBand: 'l', ageBand: 'established' },
          framework: 'react',
          packageManager: 'pnpm',
        },
      }),
    );
    for (const metric of COMPARE_METRICS) {
      const cell = metric.read(data);
      expect(cell.value).not.toContain('·');
      expect(cell.value).not.toMatch(/\bsignals?\b/i);
      if (cell.sub) expect(cell.sub).not.toContain('·');
      if (cell.sub) expect(cell.sub).not.toMatch(/\bsignals?\b/i);
      if (cell.hint) expect(cell.hint).not.toMatch(/\bsignals?\b/i);
    }
  });

  it('framework and package manager are separate rows with display labels', () => {
    const data = repoData(
      makeRollup({
        character: { framework: 'react', packageManager: 'pnpm' },
      }),
    );
    expect(cellById('framework', data).value).toBe('React');
    expect(cellById('framework', data).visual).toEqual({ kind: 'framework', id: 'react' });
    expect(cellById('package-manager', data).value).toBe('pnpm');
    expect(cellById('package-manager', data).visual?.kind).toBe('packageManager');
  });

  it('file category reads top category with visual', () => {
    const data = repoData(
      makeRollup({
        workMix: { fileCategoryMix: [{ category: 'source', editCalls: 10 }] },
      }),
    );
    expect(cellById('file-category', data).value).toBe('Source');
    expect(cellById('file-category', data).visual).toEqual({ kind: 'fileCategory', id: 'source' });
  });

  it('git-commits reads the momentum row (not the range pill)', () => {
    const cell = cellById(
      'git-commits',
      repoData(makeRollup(), {
        repoId: 'r',
        commits: 11,
        filesTouched: 5,
        windowDays: 7,
      } as unknown as RepoMomentum),
    );
    expect(cell.value).toBe('11');
    expect(cell.sub).toBe('5 files touched');
  });
});

describe('registry shape', () => {
  it('ships sectioned compare rows in spec order', () => {
    expect(COMPARE_METRICS.length).toBeGreaterThanOrEqual(25);
    expect(COMPARE_METRICS[0].id).toBe('repo-size');
    expect(COMPARE_METRICS.every((m) => m.section.length > 0)).toBe(true);
  });

  it('every row label and hint stays in product voice', () => {
    for (const m of COMPARE_METRICS) {
      expect(m.label).not.toContain('—');
      expect(m.label).not.toContain('·');
      expect(m.label).not.toMatch(/\bsignals?\b/i);
      expect(m.hint).not.toMatch(/\bsignals?\b/i);
    }
  });
});

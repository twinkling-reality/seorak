import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { compileSnapshotToPresentation } from '../../../views/ModelView/compileSnapshotToPresentation.js';
import { developerModelSnapshotSchema, createEmptyDeveloperModel } from '../../schemas/developer-model.js';
import { createBaselineDeveloperModel } from '../developerModel.js';
import { getDemoData } from '../scenarios.js';
import type { DeveloperModelSnapshot } from '@seorak/types';

type DeepRequired<T> = T extends readonly (infer U)[]
  ? DeepRequired<U>[]
  : T extends object
    ? { [K in keyof T]-?: DeepRequired<Exclude<T[K], undefined>> }
    : T;

// `createEmptyDeveloperModel` stamps `scope.generatedAt` from the wall clock, so
// two calls that straddle a millisecond boundary are not `toEqual`. Freeze time
// for the whole file: the empty-scenario test builds the expected snapshot with a
// SECOND call and compares. Without this it fails roughly whenever the clock ticks
// between the two, which made a honesty guard flaky (green by luck, not by proof).
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-09T00:00:00.000Z'));
});
afterAll(() => {
  vi.useRealTimers();
});

describe('createBaselineDeveloperModel', () => {
  const snapshot = createBaselineDeveloperModel();

  it('validates against developerModelSnapshotSchema', () => {
    expect(developerModelSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('compiles to a populated portrait (forming === null)', () => {
    const presentation = compileSnapshotToPresentation(snapshot, { displayName: 'Glendon', offsetMinutes: 0 });
    expect(presentation.forming).toBeNull();
    expect(presentation.insights.length).toBeGreaterThan(0);
    expect(presentation.insights.every((i) => !i.id.startsWith('forming-'))).toBe(true);
  });

  // The read no longer renders one sentence per facet. Being measurable stopped
  // entitling a projection to a sentence: the page ranks candidates by
  // weight x notability and speaks only the strongest few, because a portrait
  // that lists everything it knows is a receipt. Everything it DOES speak is
  // still fully checkable in its card.
  it('speaks the change and the payoff, and leaves the rest to the cards', () => {
    const presentation = compileSnapshotToPresentation(snapshot, { displayName: 'Glendon', offsetMinutes: 0 });
    const facets = new Set(presentation.insights.map((i) => i.facet));
    // Rhythm and the change it moved through both survive: a shift is the one
    // thing a reader cannot already know about themselves.
    expect(facets.has('rhythm')).toBe(true);
    expect(facets.has('payoff')).toBe(true);
    expect(presentation.insights.some((i) => i.id === 'shift-daypart')).toBe(true);
  });

  it('keeps the read short enough to be read', () => {
    const presentation = compileSnapshotToPresentation(snapshot, { displayName: 'Glendon', offsetMinutes: 0 });
    const joined = presentation.prose
      .map((s) => {
        if (s.type === 'text') return s.text;
        if (s.type === 'identityLead') return s.greeting;
        const insight = presentation.insights.find((i) => i.id === s.insightId);
        return insight?.linkedTerm ?? '';
      })
      .join('');
    expect(joined).toContain('evening developer');
    // At most three identity sentences and two payoff ones.
    const sentences = joined.split(/(?<=\.)\s/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(5);
  });

  it('uses only compiler-read snapshot fields (no orphan keys beyond schema)', () => {
    const parsed = developerModelSnapshotSchema.parse(snapshot);
    expect(parsed).toEqual(snapshot);
    expect(parsed.focus.projectFocus[0]?.project).toBe('seorak');
    expect(parsed.outcomes.endReasons.some((r) => r.reason === 'clear' && r.count >= 2)).toBe(true);
    expect(parsed.outcomes.lineSurvival.rate).toBeGreaterThanOrEqual(0.5);
    expect(parsed.activity.hourlyDistribution.length).toBeGreaterThan(0);
  });

  it('round-trips every optional contract branch without strip-mode loss', () => {
    const witness: DeepRequired<DeveloperModelSnapshot> = {
      ...snapshot,
      scope: { ...snapshot.scope, repoId: 'r1' },
      outcomes: {
        ...snapshot.outcomes,
        shipped: 7,
        shipDeterminable: 10,
      },
      identity: {
        fileLanguageMix: snapshot.identity?.fileLanguageMix ?? [
          { language: 'typescript', calls: 1 },
        ],
        branchWorkTypeMix: snapshot.identity?.branchWorkTypeMix ?? [
          { workType: 'feature', sessions: 1 },
        ],
      },
      accrual: {
        ...(snapshot.accrual ?? {
          sessions: 4,
          hourlyDistribution: [{ dow: 2, hour: 9, sessions: 4 }],
          projectFocus: [{ repoId: 'r1', project: 'seorak', sessions: 4, share: 1 }],
          lineSurvival: snapshot.outcomes.lineSurvival,
        }),
        branchWorkTypeMix: snapshot.accrual?.branchWorkTypeMix ?? [
          { workType: 'fix', sessions: 4 },
        ],
      },
      conditional: {
        lineSurvivalByStartHour: snapshot.conditional?.lineSurvivalByStartHour ?? [
          {
            hour: 20,
            linesAuthored: 400,
            linesSurviving: 300,
            commitsChecked: 6,
            sessionsRated: 5,
          },
        ],
        shipByStartHour: snapshot.conditional?.shipByStartHour ?? [
          { hour: 9, shipped: 3, determinable: 6 },
        ],
      },
    };

    expect(developerModelSnapshotSchema.parse(witness)).toEqual(witness);
  });
});

describe('demo scenario developerModel fixtures', () => {
  it('healthy scenario ships a rich model snapshot', () => {
    const data = getDemoData('healthy');
    expect(data.developerModel).toBeDefined();
    const presentation = compileSnapshotToPresentation(data.developerModel!, { displayName: 'You', offsetMinutes: 0 });
    expect(presentation.forming).toBeNull();
  });

  it('empty scenario keeps honest-empty forming read', () => {
    const data = getDemoData('empty');
    expect(data.developerModel).toEqual(createEmptyDeveloperModel(30));
    const presentation = compileSnapshotToPresentation(data.developerModel!, { displayName: 'You', offsetMinutes: 0 });
    expect(presentation.forming).not.toBeNull();
  });
});

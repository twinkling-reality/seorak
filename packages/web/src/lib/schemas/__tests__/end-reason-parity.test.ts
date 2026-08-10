/**
 * end-reason-parity.test.ts — every reader of `SessionEndReason` must accept ALL of it.
 *
 * The Model pillar rendered "run your first agent sessions and this read starts filling in"
 * to a developer with 185,000 events, for weeks. The cause was one word: the collector emits
 * `resume`, and the developer-model zod enum listed only four of the union's six values. An
 * unknown enum value failed the whole-object parse, the old validator answered with an
 * EMPTY snapshot, and the view's "no insights" branch rendered the first-run state. A
 * zero-fill wearing an honest-empty's clothes.
 *
 * It survived because nothing could see it: the union is type-only, so there was no runtime
 * value to check a copy against; the schema is cast `as unknown as z.ZodType<...>`, so
 * TypeScript could not compare it to the type it claims; and the demo fixture SCRUBBED
 * `resume` to `other` to match the broken enum, so all 987 web tests passed against a
 * fixture shaped like the bug.
 *
 * These tests check the two things that were actually false: that a real snapshot survives
 * validation, and that no reader silently drops a member of the union.
 */
import { describe, expect, it, vi } from 'vitest';
import { SESSION_END_REASONS } from '@seorak/types';
import type { DeveloperModelSnapshot } from '@seorak/types';
import { validateDeveloperModel, createEmptyDeveloperModel } from '../developer-model.js';
import { compileSnapshotToPresentation } from '../../../views/ModelView/compileSnapshotToPresentation.js';

/** A snapshot rich enough to produce insights, ending sessions EVERY way the union allows. */
function snapshotEndingEveryWay(): unknown {
  const base = createEmptyDeveloperModel(30) as DeveloperModelSnapshot;
  return {
    ...base,
    focus: {
      projectFocus: [{ repoId: 'r1', project: 'seorak', sessions: 40, share: 1 }],
    },
    outcomes: {
      ...base.outcomes,
      shipRate: 0.65,
      // Every member of the union, including the two the web used to reject.
      endReasons: SESSION_END_REASONS.map((reason, i) => ({ reason, count: 10 + i })),
      lineSurvival: {
        ...base.outcomes.lineSurvival,
        rate: 0.63,
        linesAuthored: 192246,
        linesSurviving: 120547,
        commitsChecked: 602,
        sessionsRated: 183,
      },
    },
    activity: {
      hourlyDistribution: [
        { dow: 3, hour: 20, sessions: 30 },
        { dow: 4, hour: 21, sessions: 25 },
        { dow: 5, hour: 9, sessions: 4 },
      ],
      endReasonsByHour: [
        { hour: 20, reasons: SESSION_END_REASONS.map((reason) => ({ reason, count: 2 })) },
      ],
    },
    identity: {
      fileLanguageMix: [{ language: 'typescript', calls: 2070 }],
      dayOfWeekCadence: [{ dow: 3, sessions: 76 }],
    },
  };
}

describe('SessionEndReason parity across the web readers', () => {
  it('validates a snapshot that ends sessions EVERY way the union allows', () => {
    const parsed = validateDeveloperModel(snapshotEndingEveryWay());

    // The bug: this came back as createEmptyDeveloperModel(), so projectFocus was [].
    expect(parsed.focus.projectFocus).toHaveLength(1);
    expect(parsed.outcomes.lineSurvival.linesAuthored).toBe(192246);
    expect(parsed.outcomes.endReasons.map((r) => r.reason)).toEqual([...SESSION_END_REASONS]);
  });

  it('still renders a real portrait, not the first-run state, when `resume` is present', () => {
    const parsed = validateDeveloperModel(snapshotEndingEveryWay());
    const presentation = compileSnapshotToPresentation(parsed, { displayName: 'dev' } as never);

    // `forming` non-null IS the "run your first agent sessions" screen.
    expect(presentation.forming).toBeNull();
    expect(presentation.insights.length).toBeGreaterThan(0);
  });

  it('coerces an end reason the collector has not taught the web yet, rather than blanking', () => {
    const future = snapshotEndingEveryWay() as { outcomes: { endReasons: unknown } };
    future.outcomes.endReasons = [{ reason: 'teleported_away', count: 7 }];

    const parsed = validateDeveloperModel(future);

    // The whole point: an unknown reason lands in the union's catch-all bucket and the rest
    // of the pillar survives. It must NEVER take the snapshot down with it.
    expect(parsed.outcomes.endReasons).toEqual([{ reason: 'other', count: 7 }]);
    expect(parsed.focus.projectFocus).toHaveLength(1);
  });

  it('rejects one malformed measured section instead of fabricating an empty replacement', () => {
    const broken = snapshotEndingEveryWay() as { tools: unknown };
    broken.tools = { byTool: 'not-an-array' };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let thrown: unknown;
    try {
      validateDeveloperModel(broken);
    } catch (error) {
      thrown = error;
    } finally {
      warn.mockRestore();
    }

    expect(thrown).toMatchObject({
      name: 'SchemaValidationError',
      message: 'Invalid API response (developer-model)',
    });
  });

  it('rejects an omitted required measurement instead of defaulting it to zero', () => {
    const broken = snapshotEndingEveryWay() as {
      outcomes: { lineSurvival: Record<string, unknown> };
    };
    delete broken.outcomes.lineSurvival.linesAuthored;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => validateDeveloperModel(broken)).toThrow(
      'Invalid API response (developer-model)',
    );
    warn.mockRestore();
  });

  it.each([
    ['identity', { fileLanguageMix: 'not-an-array' }],
    [
      'conditional',
      {
        lineSurvivalByStartHour: [
          {
            hour: 20,
            linesAuthored: 'many',
            linesSurviving: 300,
            commitsChecked: 6,
            sessionsRated: 5,
          },
        ],
      },
    ],
  ])('rejects a malformed present %s projection instead of hiding it', (field, value) => {
    const broken = snapshotEndingEveryWay() as Record<string, unknown>;
    broken[field] = value;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => validateDeveloperModel(broken)).toThrow(
      'Invalid API response (developer-model)',
    );
    warn.mockRestore();
  });
});

describe('the identity sentence composes for whichever rhythm insight leads', () => {
  /** Real shape: sessions spread across three dayparts, so NONE clears its share
   *  threshold and `steady-days` has to lead the sentence alone. */
  function noDaypartButSteadyDays(): unknown {
    const base = createEmptyDeveloperModel(30) as DeveloperModelSnapshot;
    return {
      ...base,
      focus: { projectFocus: [{ repoId: 'r1', project: 'seorak', sessions: 40, share: 1 }] },
      activity: {
        hourlyDistribution: [
          // Wednesday + Thursday lead the WEEK, but the day itself is split across
          // morning, afternoon and evening, so no daypart holds 40% of the starts.
          { dow: 3, hour: 9, sessions: 10 },
          { dow: 4, hour: 9, sessions: 8 },
          { dow: 3, hour: 14, sessions: 10 },
          { dow: 4, hour: 14, sessions: 8 },
          { dow: 3, hour: 20, sessions: 8 },
          { dow: 4, hour: 20, sessions: 7 },
          { dow: 1, hour: 23, sessions: 5 },
        ],
        endReasonsByHour: [],
      },
    };
  }

  const proseText = (segments: { type: string; text?: string }[]): string =>
    segments.map((s) => (s.type === 'text' ? (s.text ?? '') : '')).join('');

  /** UTC, so these fixtures mean the same thing on every machine that runs them. */
  const AT_UTC = { displayName: 'dev', offsetMinutes: 0 };

  it('never introduces a non-daypart insight with "you have been an"', () => {
    const snap = validateDeveloperModel(noDaypartButSteadyDays());
    const p = compileSnapshotToPresentation(snap, AT_UTC);

    const rhythm = p.insights.filter((i) => i.facet === 'rhythm').map((i) => i.id);
    expect(rhythm).toContain('steady-days');
    expect(rhythm).not.toContain('daypart');

    // The bug rendered: "dev, this period you've been an Wednesdays and Thursdays are
    // steadiest." The lead is a noun-phrase slot; only a daypart may fill it.
    expect(proseText(p.prose as never)).not.toMatch(/been an?\s*$/);
    expect(proseText(p.prose as never)).toMatch(/your week leaned on/i);
  });

  it('still uses the daypart lead when a daypart DOES lead', () => {
    const evenings = createEmptyDeveloperModel(30) as DeveloperModelSnapshot;
    const snap = validateDeveloperModel(
      {
        ...evenings,
        focus: { projectFocus: [{ repoId: 'r1', project: 'seorak', sessions: 30, share: 1 }] },
        activity: {
          hourlyDistribution: [
            { dow: 2, hour: 20, sessions: 15 },
            { dow: 3, hour: 21, sessions: 14 },
            { dow: 4, hour: 9, sessions: 1 },
          ],
          endReasonsByHour: [],
        },
      },
    );
    const p = compileSnapshotToPresentation(snap, AT_UTC);

    const daypart = p.insights.find((i) => i.id === 'daypart');
    expect(daypart?.linkedTerm).toBe('evening developer');
    expect(proseText(p.prose as never)).toMatch(/you’ve been an/);
  });
});

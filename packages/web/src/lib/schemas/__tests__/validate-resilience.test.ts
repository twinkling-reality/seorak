import { describe, expect, it, vi } from 'vitest';

import { overviewSnapshotSchema, createEmptyOverview } from '../common.js';
import { validateOverview } from '../../apiSchemas.js';

// Snapshot parse resilience keeps narrow additive enum fallbacks, while a
// missing or malformed current field rejects the response. Polling then keeps a
// prior snapshot stale or surfaces a cold schema error instead of manufacturing
// an empty section.

function wireWithRepo(temperature: unknown): unknown {
  const wire = JSON.parse(JSON.stringify(createEmptyOverview(7)));
  wire.usage.portfolio.reposTotal = 1;
  wire.usage.portfolio.repos = [
    {
      repoId: 'r1',
      repoLabel: 'seorak',
      gitContext: 'clean',
      temperature,
      quietDays: null,
      commits: 3,
      filesTouched: 5,
      netLines: 40,
      generatedLinesExcluded: 0,
      baseline: null,
    },
  ];
  return wire;
}

describe('snapshot parse resilience — field-level catch (DA-11)', () => {
  it('an unknown repo temperature coerces to null and the rest of the snapshot survives', () => {
    const parsed = overviewSnapshotSchema.parse(wireWithRepo('blazing'));
    const repo = parsed.usage.portfolio.repos[0];
    expect(repo.temperature).toBe(null); // coerced, parse did not throw
    expect(repo.commits).toBe(3); // the real row survived (not the empty fallback)
  });

  it('a known temperature parses through unchanged', () => {
    const parsed = overviewSnapshotSchema.parse(wireWithRepo('heating'));
    expect(parsed.usage.portfolio.repos[0].temperature).toBe('heating');
  });
});

describe('snapshot parse resilience — strict current contract', () => {
  it('rejects a malformed measured section instead of replacing it with zeros', () => {
    const wire = wireWithRepo('heating') as {
      usage: { portfolio: { repos: { gitContext: string }[] } };
      outcomes: { endedCount: number };
    };
    wire.usage.portfolio.repos[0].gitContext = 'volcanic';
    wire.outcomes.endedCount = 5;

    expect(() => validateOverview(wire)).toThrow('Invalid API response (overview)');
  });

  it('rejects omitted current fields instead of invoking compatibility defaults', () => {
    const wire = JSON.parse(JSON.stringify(createEmptyOverview(7)));
    delete wire.thresholds;
    delete wire.usage.portfolio;

    expect(() => validateOverview(wire)).toThrow('Invalid API response (overview)');
  });

  it.each([
    null,
    { generatedAt: '2026-06-08T10:06:00.000Z' },
    {
      generatedAt: '2026-06-08T10:06:00.000Z',
      usage: {},
      outcomes: {},
      activity: {},
      tools: 'not-an-object',
    },
  ])('throws SchemaValidationError for a root-invalid response %#', (wire) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let thrown: unknown;
    try {
      validateOverview(wire);
    } catch (error) {
      thrown = error;
    } finally {
      warn.mockRestore();
    }

    expect(thrown).toMatchObject({
      name: 'SchemaValidationError',
      message: 'Invalid API response (overview)',
    });
  });
});

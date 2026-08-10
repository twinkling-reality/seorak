import { describe, expect, it, vi } from 'vitest';
import { liveSnapshotSchema } from '../common.js';
import { validateLive } from '../../apiSchemas.js';

// GET /live returns `{ generatedAt, live: SessionSummary[] }` (DATA-LAYER
// §ADR-002). The web overrides overview.live with this fresh board, so the shape
// has to survive z.object's unknown-key stripping. Both envelope fields are
// required so schema drift becomes a failed refresh, never an empty ready board.

function liveSession() {
  return {
    sessionId: 's1',
    project: 'seorak',
    repoId: 'r1',
    agent: 'claude-code',
    status: 'active',
    startedAt: '2026-06-08T10:00:00.000Z',
    lastEventAt: '2026-06-08T10:05:00.000Z',
    elapsedSeconds: 300,
    toolCallCount: 4,
    tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
    costUsd: 1.23,
    burnRateUsdPerMin: 0.25,
  };
}

describe('liveSnapshotSchema', () => {
  it('parses a well-formed /live response', () => {
    const parsed = liveSnapshotSchema.parse({
      generatedAt: '2026-06-08T10:06:00.000Z',
      live: [liveSession()],
    });
    expect(parsed.generatedAt).toBe('2026-06-08T10:06:00.000Z');
    expect(parsed.live).toHaveLength(1);
    expect(parsed.live[0].costUsd).toBe(1.23);
  });

  it('preserves null cost/burn for activity-only agents (no silent $0)', () => {
    const parsed = liveSnapshotSchema.parse({
      generatedAt: '2026-06-08T10:06:00.000Z',
      live: [
        {
          ...liveSession(),
          agent: 'codex',
          currentTool: 'ApplyPatch',
          costUsd: null,
          burnRateUsdPerMin: null,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      ],
    });
    expect(parsed.live[0].costUsd).toBeNull();
    expect(parsed.live[0].burnRateUsdPerMin).toBeNull();
  });

  it('accepts an explicit, valid empty board', () => {
    const parsed = liveSnapshotSchema.parse({
      generatedAt: '2026-06-08T10:06:00.000Z',
      live: [],
    });
    expect(parsed.live).toEqual([]);
  });

  it('throws SchemaValidationError when the root body is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let thrown: unknown;
    try {
      validateLive({ generatedAt: 42 });
    } catch (error) {
      thrown = error;
    } finally {
      warn.mockRestore();
    }

    expect(thrown).toMatchObject({
      name: 'SchemaValidationError',
      message: 'Invalid API response (live)',
    });
  });
});

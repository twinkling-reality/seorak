import { describe, expect, it } from 'vitest';
import { replaySessionSchema, keyframeSchema } from '../replay.js';

// The replay contract is publish-safe COUNTS + content-free labels only. z.enum
// on KeyframeKind is the load-bearing guard: a fabricated keyframe kind must be
// REJECTED rather than rendered as a blank timeline row.

function validReplay() {
  return {
    sessionId: 'sess-1',
    agent: 'claude-code',
    startedAt: '2026-06-04T12:00:00.000Z',
    endedAt: '2026-06-04T12:42:00.000Z',
    activity: [],
    moments: [],
    totals: { costUsd: 0, tokensTotal: 0, toolCallCount: 0, promptCount: 0 },
    keyframes: [
      { kind: 'session-start', at: '2026-06-04T12:00:00.000Z', seq: 0, label: 'Session started' },
      {
        kind: 'first-error',
        at: '2026-06-04T12:14:00.000Z',
        seq: 41,
        label: 'First error',
        detail: 'Bash',
      },
      { kind: 'session-end', at: '2026-06-04T12:42:00.000Z', seq: 140, label: 'Session ended', detail: 'cleared' },
    ],
  };
}

describe('replaySessionSchema', () => {
  it('parses a valid replay session (round-trips keyframes + detail)', () => {
    const parsed = replaySessionSchema.parse(validReplay());
    expect(parsed.sessionId).toBe('sess-1');
    expect(parsed.keyframes).toHaveLength(3);
    expect(parsed.keyframes[1].kind).toBe('first-error');
    expect(parsed.keyframes[1].detail).toBe('Bash');
  });

  it('accepts a still-in-flight session (endedAt null)', () => {
    const raw = { ...validReplay(), endedAt: null, keyframes: validReplay().keyframes.slice(0, 1) };
    const parsed = replaySessionSchema.parse(raw);
    expect(parsed.endedAt).toBeNull();
  });

  it('rejects omitted current keyframes', () => {
    const raw = JSON.parse(JSON.stringify(validReplay()));
    delete raw.keyframes;
    expect(replaySessionSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects omitted current totals', () => {
    const raw = JSON.parse(JSON.stringify(validReplay()));
    delete raw.totals;
    expect(replaySessionSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects an unknown keyframe kind (no fabricated moments slip through)', () => {
    const bad = validReplay();
    (bad.keyframes[0] as { kind: unknown }).kind = 'cost-meltdown';
    expect(replaySessionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a keyframe missing its label', () => {
    const bad = { kind: 'peak-burn', at: '2026-06-04T12:00:00.000Z', seq: 1 };
    expect(keyframeSchema.safeParse(bad).success).toBe(false);
  });
});

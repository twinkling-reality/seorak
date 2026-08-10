import { describe, expect, it } from 'vitest';
import { buildDemoReplay } from '../replay.js';
import { createBaselineOverview } from '../baseline.js';
import { replaySessionSchema } from '../../schemas/replay.js';

describe('buildDemoReplay', () => {
  const base = createBaselineOverview();
  const active = base.live.find((s) => s.status !== 'ended') ?? base.live[0];

  it('produces a keyframe timeline that PASSES the publish-safe schema', () => {
    const replay = buildDemoReplay(active);
    // The demo fixture must validate against the same schema the live path uses,
    // so demo richness can never drift from the contract.
    expect(replaySessionSchema.safeParse(replay).success).toBe(true);
  });

  it('orders keyframes by seq and carries content-free labels', () => {
    const replay = buildDemoReplay(active);
    const seqs = replay.keyframes.map((k) => k.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    // first keyframe is the lifecycle start.
    expect(replay.keyframes[0].kind).toBe('session-start');
  });

  it('omits session-end + reports endedAt null for an in-flight session', () => {
    const inflight = { ...active, status: 'active' as const, endedAt: undefined };
    const replay = buildDemoReplay(inflight);
    expect(replay.endedAt).toBeNull();
    expect(replay.keyframes.some((k) => k.kind === 'session-end')).toBe(false);
  });

  it('includes session-end for an ended session', () => {
    const ended = {
      ...active,
      status: 'ended' as const,
      endedAt: new Date(Date.parse(active.startedAt) + 60_000).toISOString(),
    };
    const replay = buildDemoReplay(ended);
    expect(replay.endedAt).not.toBeNull();
    expect(replay.keyframes.some((k) => k.kind === 'session-end')).toBe(true);
  });

  it('keeps Codex replay capability-shaped: unpriced live row, Shell/ApplyPatch, no verification', () => {
    const codex = base.live.find((s) => s.agent === 'codex');
    expect(codex).toBeTruthy();
    const replay = buildDemoReplay(codex!);
    expect(replaySessionSchema.safeParse(replay).success).toBe(true);
    expect(replay.keyframes.some((k) => k.kind === 'first-error')).toBe(false);
    expect(replay.keyframes.some((k) => k.kind === 'verification-failed')).toBe(false);
    // A live codex row carries no dollars (its session.tokens carrier never
    // rides the live path), so there is no burn to mark and no spend to total.
    expect(replay.keyframes.some((k) => k.kind === 'peak-burn')).toBe(false);
    expect(replay.moments.some((m) => m.errored)).toBe(false);
    expect(replay.moments.some((m) => m.verificationKind)).toBe(false);
    expect(
      replay.moments.every(
        (m) => m.toolName === 'Shell' || m.toolName === 'ApplyPatch' || m.kind !== 'tool.call',
      ),
    ).toBe(true);
    expect(replay.totals.costUsd).toBe(0);
    expect(replay.totals.tokensTotal).toBe(0);
  });
});

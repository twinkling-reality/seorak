import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the network + demo gate so we drive pollLiveOnce deterministically. The
// store imports these by specifier; vitest matches the resolved module id.
vi.mock('../../api.js', () => ({
  fetchLive: vi.fn(),
  fetchOverview: vi.fn(),
  fetchInterventions: vi.fn(),
}));
vi.mock('../../demoMode.js', async (importActual) => {
  const actual = await importActual<typeof import('../../demoMode.js')>();
  return { ...actual, isDemoActive: vi.fn(() => false) };
});

import { nextLiveDelay, pollLiveOnce, pollingActions, resetPollingState } from '../polling.js';
import { LIVE_POLL_MS, LIVE_IDLE_POLL_MS } from '../../constants.js';
import { fetchLive } from '../../api.js';
import { isDemoActive } from '../../demoMode.js';

const mockFetchLive = vi.mocked(fetchLive);
const mockIsDemoActive = vi.mocked(isDemoActive);

function summary(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
}

beforeEach(() => {
  resetPollingState();
  mockFetchLive.mockReset();
  mockIsDemoActive.mockReset();
  mockIsDemoActive.mockReturnValue(false);
});

describe('nextLiveDelay — adaptive cadence (§ADR-006)', () => {
  it('polls fast while a session is live, slow when idle', () => {
    expect(nextLiveDelay(true, 0)).toBe(LIVE_POLL_MS);
    expect(nextLiveDelay(false, 0)).toBe(LIVE_IDLE_POLL_MS);
  });

  it('backs off exponentially on failures, capped at ×8', () => {
    expect(nextLiveDelay(true, 1)).toBe(LIVE_POLL_MS * 2);
    expect(nextLiveDelay(true, 3)).toBe(LIVE_POLL_MS * 8);
    expect(nextLiveDelay(true, 9)).toBe(LIVE_POLL_MS * 8); // still capped
    expect(nextLiveDelay(false, 5)).toBe(LIVE_IDLE_POLL_MS * 8);
  });
});

describe('pollLiveOnce — store updates', () => {
  it('stores the fresh board + generatedAt on success', async () => {
    mockFetchLive.mockResolvedValue({ generatedAt: '2026-06-08T10:06:00.000Z', live: [summary()] });
    await pollLiveOnce();
    const s = pollingActions.getState();
    expect(s.liveSessions).toHaveLength(1);
    expect(s.liveSessions?.[0].sessionId).toBe('s1');
    expect(s.liveGeneratedAt).toBe('2026-06-08T10:06:00.000Z');
    expect(s.liveStatus).toBe('ready');
  });

  it('stores an explicit, valid empty board as ready', async () => {
    mockFetchLive.mockResolvedValue({ generatedAt: '2026-06-08T10:06:00.000Z', live: [] });
    await pollLiveOnce();
    const s = pollingActions.getState();
    expect(s.liveSessions).toEqual([]);
    expect(s.liveStatus).toBe('ready');
  });

  it('keeps the prior board and marks it stale on a failed refresh', async () => {
    mockFetchLive.mockResolvedValueOnce({
      generatedAt: '2026-06-08T10:06:00.000Z',
      live: [summary()],
    });
    await pollLiveOnce(); // seed a real board

    mockFetchLive.mockRejectedValueOnce(new Error('network down'));
    await pollLiveOnce();
    const s = pollingActions.getState();
    expect(s.liveSessions).toHaveLength(1); // NOT blanked
    expect(s.liveStatus).toBe('stale');
  });

  it('keeps the prior board and marks it stale on a malformed refresh', async () => {
    mockFetchLive.mockResolvedValueOnce({
      generatedAt: '2026-06-08T10:06:00.000Z',
      live: [summary()],
    });
    await pollLiveOnce();

    mockFetchLive.mockResolvedValueOnce({
      generatedAt: '2026-06-08T10:07:00.000Z',
      live: 'not-an-array',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await pollLiveOnce();
    } finally {
      warn.mockRestore();
    }

    const s = pollingActions.getState();
    expect(s.liveSessions).toHaveLength(1);
    expect(s.liveSessions?.[0].sessionId).toBe('s1');
    expect(s.liveGeneratedAt).toBe('2026-06-08T10:06:00.000Z');
    expect(s.liveStatus).toBe('stale');
  });

  it('reports error (no board to keep) when the first poll fails', async () => {
    mockFetchLive.mockRejectedValueOnce(new Error('network down'));
    await pollLiveOnce();
    const s = pollingActions.getState();
    expect(s.liveSessions).toBeNull();
    expect(s.liveStatus).toBe('error');
  });

  it('short-circuits in demo mode without hitting the network', async () => {
    mockIsDemoActive.mockReturnValue(true);
    await pollLiveOnce();
    expect(mockFetchLive).not.toHaveBeenCalled();
    const s = pollingActions.getState();
    expect(s.liveSessions).toBeNull(); // demo board comes from overview.live
    expect(s.liveStatus).toBe('ready');
  });
});

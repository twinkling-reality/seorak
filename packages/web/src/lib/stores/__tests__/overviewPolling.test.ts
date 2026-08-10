import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  fetchLive: vi.fn(),
  fetchOverview: vi.fn(),
  fetchInterventions: vi.fn(),
}));
vi.mock('../../demoMode.js', async (importActual) => {
  const actual = await importActual<typeof import('../../demoMode.js')>();
  return { ...actual, isDemoActive: vi.fn(() => false) };
});

import {
  pollOverviewOnce,
  pollingActions,
  resetPollingState,
} from '../polling.js';
import { fetchInterventions, fetchOverview } from '../../api.js';
import { isDemoActive } from '../../demoMode.js';
import { createEmptyOverview } from '../../apiSchemas.js';

const mockFetchOverview = vi.mocked(fetchOverview);
const mockFetchInterventions = vi.mocked(fetchInterventions);
const mockIsDemoActive = vi.mocked(isDemoActive);
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetPollingState();
  mockFetchOverview.mockReset();
  mockFetchInterventions.mockReset();
  mockFetchInterventions.mockResolvedValue([]);
  mockIsDemoActive.mockReset();
  mockIsDemoActive.mockReturnValue(false);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetPollingState();
  warn.mockRestore();
});

describe('pollOverviewOnce invalid-data handling', () => {
  it('keeps a cold malformed response null and reports an error', async () => {
    mockFetchOverview.mockResolvedValue({
      notModified: false,
      data: { generatedAt: '2026-06-08T10:06:00.000Z' },
      etag: 'malformed-etag',
      cacheStatus: 'fresh',
    });

    await pollOverviewOnce();

    expect(pollingActions.getState()).toMatchObject({
      overviewData: null,
      overviewStatus: 'error',
      pollError: 'Invalid API response (overview)',
      lastUpdate: null,
    });
  });

  it('preserves a prior snapshot as stale and retains its ETag after malformed refresh', async () => {
    const measured = createEmptyOverview(7);
    measured.generatedAt = '2026-06-08T10:06:00.000Z';
    measured.usage.totals.sessions = 4;
    mockFetchOverview.mockResolvedValueOnce({
      notModified: false,
      data: measured,
      etag: 'valid-etag',
      cacheStatus: 'fresh',
    });

    await pollOverviewOnce();
    const prior = pollingActions.getState().overviewData;

    mockFetchOverview.mockResolvedValueOnce({
      notModified: false,
      data: { generatedAt: '2026-06-08T10:07:00.000Z' },
      etag: 'malformed-etag',
      cacheStatus: 'fresh',
    });
    await pollOverviewOnce();

    const stale = pollingActions.getState();
    expect(stale.overviewData).toBe(prior);
    expect(stale).toMatchObject({
      overviewStatus: 'stale',
      pollError: 'Invalid API response (overview)',
    });

    mockFetchOverview.mockResolvedValueOnce({
      notModified: true,
      etag: 'valid-etag',
      cacheStatus: 'fresh',
    });
    await pollOverviewOnce();

    expect(mockFetchOverview.mock.calls[2]?.[1]?.etag).toBe('valid-etag');
  });

  it('stores an explicit, valid empty response as ready', async () => {
    const empty = createEmptyOverview(7);
    mockFetchOverview.mockResolvedValue({
      notModified: false,
      data: empty,
      etag: 'empty-etag',
      cacheStatus: 'fresh',
    });

    await pollOverviewOnce();

    const state = pollingActions.getState();
    expect(state.overviewStatus).toBe('ready');
    expect(state.pollError).toBeNull();
    expect(state.overviewData?.usage.totals.sessions).toBe(0);
    expect(state.overviewData?.usage.projects).toEqual([]);
  });

  it('keeps a worker-supplied last-known-good body visibly stale', async () => {
    const prior = createEmptyOverview(7);
    mockFetchOverview.mockResolvedValue({
      notModified: false,
      data: prior,
      etag: null,
      cacheStatus: 'revalidating',
    });

    await pollOverviewOnce();

    expect(pollingActions.getState()).toMatchObject({
      overviewData: prior,
      overviewStatus: 'stale',
      pollError: null,
    });
  });
});

describe('pollOverviewOnce intervention validation', () => {
  function validIntervention() {
    return {
      kind: 'went_cold' as const,
      sessionId: 'session-1',
      project: 'seorak',
      repoId: 'repo-1',
      triggeredAt: '2026-06-08T10:06:00.000Z',
      signalLabel: 'Went quiet',
      body: 'Went quiet, no activity for 10 minutes.',
      deepLink: '/dashboard/replay?sessions=session-1',
    };
  }

  it('marks a cold malformed interventions payload as error while accepting overview', async () => {
    const overview = createEmptyOverview(7);
    mockFetchOverview.mockResolvedValue({
      notModified: false,
      data: overview,
      etag: 'overview-etag',
      cacheStatus: 'fresh',
    });
    mockFetchInterventions.mockResolvedValue({ invalid: true } as never);

    await pollOverviewOnce();

    expect(pollingActions.getState()).toMatchObject({
      overviewData: overview,
      overviewStatus: 'ready',
      interventions: [],
      interventionsStatus: 'error',
      pollError: null,
    });
  });

  it('preserves prior interventions as stale after a malformed refresh', async () => {
    const overview = createEmptyOverview(7);
    const prior = validIntervention();
    mockFetchOverview.mockResolvedValue({
      notModified: false,
      data: overview,
      etag: 'overview-etag',
      cacheStatus: 'fresh',
    });
    mockFetchInterventions.mockResolvedValueOnce([prior]);

    await pollOverviewOnce();

    mockFetchOverview.mockResolvedValue({
      notModified: true,
      etag: 'overview-etag',
      cacheStatus: 'fresh',
    });
    mockFetchInterventions.mockResolvedValueOnce([{ ...prior, deepLink: 42 }] as never);

    await pollOverviewOnce();

    expect(pollingActions.getState()).toMatchObject({
      overviewStatus: 'ready',
      interventions: [prior],
      interventionsStatus: 'stale',
      pollError: null,
    });
  });
});

describe('a plan gate is not an outage', () => {
  function gated(): Error & { status: number; capability: string } {
    const error = new Error('GET /overview?days=7 failed: 402') as Error & {
      status: number;
      capability: string;
    };
    error.status = 402;
    error.capability = 'remoteVisibility';
    return error;
  }

  it('records the capability without climbing the failure ladder', async () => {
    mockFetchOverview.mockRejectedValue(gated());

    await pollOverviewOnce();
    await pollOverviewOnce();
    await pollOverviewOnce();

    const state = pollingActions.getState();
    expect(state.hostedGate).toMatchObject({ capability: 'remoteVisibility' });
    // Zero, not three. The ladder drives slow-mode and then a loop restart, and
    // spending it here would be retrying a question whose answer cannot change
    // until the plan does.
    expect(state.consecutiveFailures).toBe(0);
    // The sentence a surface renders is the gate's, never the raw status line.
    expect(state.pollError).not.toContain('402');
  });

  it('clears the gate the moment a read succeeds', async () => {
    mockFetchOverview.mockRejectedValueOnce(gated());
    await pollOverviewOnce();
    expect(pollingActions.getState().hostedGate).not.toBeNull();

    mockFetchOverview.mockResolvedValue({
      notModified: false,
      data: createEmptyOverview(7),
      etag: 'overview-etag',
      cacheStatus: 'fresh',
    });
    await pollOverviewOnce();

    expect(pollingActions.getState()).toMatchObject({
      hostedGate: null,
      pollError: null,
      overviewStatus: 'ready',
    });
  });

  it('still reports an ordinary failure as a failure', async () => {
    const error = new Error('boom') as Error & { status: number };
    error.status = 503;
    mockFetchOverview.mockRejectedValue(error);

    await pollOverviewOnce();
    await pollOverviewOnce();

    const state = pollingActions.getState();
    expect(state.hostedGate).toBeNull();
    expect(state.consecutiveFailures).toBe(2);
  });
});

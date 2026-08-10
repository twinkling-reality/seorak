import { createStore, useStore } from 'zustand';
import { fetchInterventions, fetchLive, fetchOverview } from '../api.js';
import { POLL_MS, SLOW_POLL_MS, LIVE_POLL_MS, LIVE_IDLE_POLL_MS } from '../constants.js';
import {
  interventionsArraySchema,
  validateResponse,
  validateLive,
  validateOverview,
} from '../apiSchemas.js';
import { authActions } from './auth.js';
import { addRefreshHandler, requestRefresh } from './refresh.js';
import { type PollingState, type DataStatus } from './pollingTypes.js';
import { isDemoActive, getActiveScenarioId } from '../demoMode.js';
import { getDemoData } from '../demo/index.js';
import { buildDemoInterventions } from '../demo/interventions.js';
import { isAggregateCacheStale } from '@seorak/types';
import { hostedGateFor } from '../hostedGate.js';

interface InternalPollingState {
  pollTimer: ReturnType<typeof setInterval> | null;
  pollAbortController: AbortController | null;
  /** The window the poll fetches. OverviewView sets it from the RangePills. */
  rangeDays: number;
  /** Last /overview ETag, echoed as If-None-Match for the conditional GET so an
   *  unchanged poll comes back 304. Cleared on a range change (a different window
   *  is a different body). */
  overviewEtag: string | null;
  /** The self-scheduling /live loop. A setTimeout (not setInterval) so each tick
   *  can pick a NEW delay — fast while a session is live, slow when idle. */
  liveTimer: ReturnType<typeof setTimeout> | null;
  liveAbortController: AbortController | null;
  /** Gate so a stop during an in-flight /live can't reschedule a dead loop. */
  liveRunning: boolean;
  /** Consecutive /live failures — backs off the live cadence, independent of the
   *  /overview failure ladder so a flaky aggregate body never slows the board. */
  liveFailures: number;
  /** True while the initial (or range-change) /overview round-trip is in flight.
   *  Scheduled poll ticks skip while this is set and we have no snapshot yet —
   *  otherwise the 30s interval aborts a body that can legitimately take 40s+. */
  overviewPollInFlight: boolean;
}

function createInternalPollingState(): InternalPollingState {
  return {
    pollTimer: null,
    pollAbortController: null,
    rangeDays: 7,
    overviewEtag: null,
    liveTimer: null,
    liveAbortController: null,
    liveRunning: false,
    liveFailures: 0,
    overviewPollInFlight: false,
  };
}

const pollState = createInternalPollingState();

const pollingStore = createStore<PollingState>(() => ({
  overviewData: null,
  overviewStatus: 'idle',
  interventions: [],
  interventionsStatus: 'idle',
  pollError: null,
  hostedGate: null,
  lastUpdate: null,
  consecutiveFailures: 0,
  liveSessions: null,
  liveGeneratedAt: null,
  liveStatus: 'idle',
}));

const MAX_CONSECUTIVE_FAILURES = 20;

function resetAbortController(): AbortSignal {
  if (pollState.pollAbortController) pollState.pollAbortController.abort();
  pollState.pollAbortController = new AbortController();
  return pollState.pollAbortController.signal;
}

function isAbortError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return 'name' in err && (err as { name?: unknown }).name === 'AbortError';
}

/** A read rejected by the owner-lock (armed worker, missing/stale token). The API
 *  client stamps `.status` on its thrown errors, so a 401 is detectable here. */
function isUnauthorized(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return 'status' in err && (err as { status?: unknown }).status === 401;
}

function formatError(err: unknown): string {
  if (typeof err === 'string') return err;
  const msg = err instanceof Error ? err.message : 'Something went wrong';
  if (msg.includes('Failed to fetch') || (err instanceof Error && err.name === 'TypeError')) {
    return 'Cannot reach the server. Check your connection.';
  }
  return msg || 'Something went wrong';
}

/** Single poll cycle. Demo short-circuits to the scenario's OverviewSnapshot. */
export async function pollOverviewOnce(): Promise<void> {
  if (isDemoActive()) {
    const data = getDemoData(getActiveScenarioId(), pollState.rangeDays);
    pollingStore.setState({
      overviewData: data.overview,
      overviewStatus: 'ready',
      interventions: buildDemoInterventions(data.overview),
      interventionsStatus: 'ready',
      pollError: null,
      hostedGate: null,
      lastUpdate: new Date(),
      consecutiveFailures: 0,
    });
    return;
  }

  // A cold load (or a slow worker) can outlast POLL_MS. Let that fetch finish
  // instead of aborting it on the next tick — abort-on-reschedule only after we
  // have a snapshot to refresh.
  if (pollState.overviewPollInFlight && !pollingStore.getState().overviewData) return;

  pollState.overviewPollInFlight = true;
  const signal = resetAbortController();
  pollingStore.setState((state) => ({
    overviewStatus: state.overviewData ? state.overviewStatus : ('loading' as DataStatus),
  }));

  try {
    // /overview and /interventions in one round-trip. allSettled keeps the
    // dashboard rendering even if /interventions 500s — interventions are
    // ADDITIVE, never load-bearing for the overview.
    const [overviewRes, interventionsRes] = await Promise.allSettled([
      fetchOverview(pollState.rangeDays, { signal, etag: pollState.overviewEtag }),
      fetchInterventions({ signal }),
    ]);

    // Interventions first, isolated: a failure here never blanks the dashboard
    // or prevents a valid overview response from landing.
    if (interventionsRes.status === 'fulfilled') {
      try {
        const fired = validateResponse(
          interventionsArraySchema,
          interventionsRes.value,
          'interventions',
        );
        pollingStore.setState({ interventions: fired, interventionsStatus: 'ready' });
      } catch {
        pollingStore.setState((s) => ({
          interventionsStatus: (s.interventions.length ? 'stale' : 'error') as DataStatus,
        }));
      }
    } else if (!isAbortError(interventionsRes.reason)) {
      // Keep the prior list; mark it stale rather than wiping a real fired list.
      pollingStore.setState((s) => ({
        interventionsStatus: (s.interventions.length ? 'stale' : 'error') as DataStatus,
      }));
    }

    // Overview drives the dashboard's loading/error/failure state.
    if (overviewRes.status === 'rejected') throw overviewRes.reason;
    const overview = overviewRes.value;
    if (overview.notModified) {
      // 304: the worker confirmed the aggregate body is unchanged (it skipped the
      // fan-out) — keep the prior snapshot, just refresh the freshness stamp. This
      // is the cheap path the conditional GET exists for.
      pollingStore.setState({
        overviewStatus: isAggregateCacheStale(overview.cacheStatus) ? 'stale' : 'ready',
        pollError: null,
        hostedGate: null,
        lastUpdate: new Date(),
      });
    } else {
      const validated = validateOverview(overview.data);
      pollState.overviewEtag = overview.etag;
      pollingStore.setState({
        overviewData: validated,
        overviewStatus: isAggregateCacheStale(overview.cacheStatus) ? 'stale' : 'ready',
        pollError: null,
        // A read that succeeded is proof the gate is gone: an upgrade takes
        // effect on the cell, not in this tab, so nothing else would clear it.
        hostedGate: null,
        lastUpdate: new Date(),
      });
    }
    const { consecutiveFailures } = pollingStore.getState();
    if (consecutiveFailures > 0) {
      pollingStore.setState({ consecutiveFailures: 0 });
      restartPolling();
    }
  } catch (err) {
    if (isAbortError(err)) return;
    // The owner-lock rotated/revoked the token (or it was never valid): stop the
    // loop and bounce to the entry gate with the "session expired" notice, rather
    // than hammering a 401 up the failure ladder. DashboardApp's auth effect stops
    // polling once the token clears.
    if (isUnauthorized(err)) {
      authActions.expireSession();
      return;
    }
    // A plan gate is a settled answer, so it stops climbing the failure ladder
    // here. Counting it as an outage would slow-mode and then restart the loop
    // over a question whose answer cannot change until the plan does.
    //
    // The status still moves to `error` and `pollError` still carries a sentence,
    // deliberately. `hostedGate` is what the shell reads to render the real
    // state; this is the fallback for any surface that does not know about it
    // yet, and the alternative — reporting `ready` with no snapshot — would make
    // the board claim "no sessions yet" about history it was never shown.
    const gate = hostedGateFor(err);
    if (gate) {
      pollingStore.setState((state) => ({
        hostedGate: gate,
        pollError: gate.title,
        consecutiveFailures: 0,
        overviewStatus: (state.overviewData ? 'stale' : 'error') as DataStatus,
      }));
      return;
    }
    pollingStore.setState((state) => ({
      pollError: formatError(err),
      consecutiveFailures: state.consecutiveFailures + 1,
      overviewStatus: (state.overviewData ? 'stale' : 'error') as DataStatus,
    }));
    if (pollingStore.getState().consecutiveFailures >= 3) restartPolling();
  } finally {
    pollState.overviewPollInFlight = false;
  }
}

addRefreshHandler(pollOverviewOnce);

// ── The /live loop ──────────────────────────────────
//
// A second, INDEPENDENT loop polling only GET /live — the fresh, zero-D1 head
// (DATA-LAYER §ADR-002). It runs on its own adaptive cadence so the board feels
// live (fast while a session is running) without polling the heavy /overview
// body fast (which the 304 keeps cheap, but its live[] still only refreshes at
// 30s). The board reads this loop's `liveSessions`; useOverview overrides
// overview.live with it.

/** Pick the next /live delay: fast while a session is live, slow when idle
 *  (§ADR-006), with exponential backoff (capped ×8) on consecutive failures so a
 *  down worker is eased off without abandoning the live feel. Pure for testing. */
export function nextLiveDelay(active: boolean, failures: number): number {
  const base = active ? LIVE_POLL_MS : LIVE_IDLE_POLL_MS;
  return base * Math.min(1 << Math.max(0, failures), 8);
}

/** One /live fetch → store update. Demo owns the board from the scenario's
 *  overview.live, so it leaves `liveSessions` null (useOverview ignores it in
 *  demo). On failure it KEEPS the prior board (marks it stale), never blanks it. */
export async function pollLiveOnce(): Promise<void> {
  if (isDemoActive()) {
    pollingStore.setState({ liveSessions: null, liveGeneratedAt: null, liveStatus: 'ready' });
    pollState.liveFailures = 0;
    return;
  }

  if (pollState.liveAbortController) pollState.liveAbortController.abort();
  pollState.liveAbortController = new AbortController();
  const signal = pollState.liveAbortController.signal;

  try {
    const raw = await fetchLive({ signal });
    const snap = validateLive(raw);
    pollState.liveFailures = 0;
    pollingStore.setState({
      liveSessions: snap.live,
      liveGeneratedAt: snap.generatedAt,
      liveStatus: 'ready',
    });
  } catch (err) {
    if (isAbortError(err)) return;
    if (isUnauthorized(err)) {
      authActions.expireSession();
      return;
    }
    pollState.liveFailures += 1;
    // Keep the prior board; mark it stale so the freshness cue can degrade.
    pollingStore.setState((s) => ({
      liveStatus: (s.liveSessions ? 'stale' : 'error') as DataStatus,
    }));
  }
}

async function liveTick(): Promise<void> {
  if (!pollState.liveRunning) return;
  await pollLiveOnce();
  if (!pollState.liveRunning) return; // stopped during the await
  if (pollState.liveFailures >= MAX_CONSECUTIVE_FAILURES) return; // give up like /overview
  const active = (pollingStore.getState().liveSessions?.length ?? 0) > 0;
  pollState.liveTimer = setTimeout(() => void liveTick(), nextLiveDelay(active, pollState.liveFailures));
}

function startLive(): void {
  stopLive();
  pollState.liveRunning = true;
  void liveTick();
}

function stopLive(): void {
  pollState.liveRunning = false;
  if (pollState.liveAbortController) {
    pollState.liveAbortController.abort();
    pollState.liveAbortController = null;
  }
  if (pollState.liveTimer) {
    clearTimeout(pollState.liveTimer);
    pollState.liveTimer = null;
  }
}

function restartPolling(): void {
  // Stop the existing timer FIRST so the give-up path actually gives up: the old
  // code returned before stopPollTimer at the failure cap, leaving the interval
  // running forever. Now hitting the cap clears it and does not rearm.
  stopPollTimer();
  const { consecutiveFailures } = pollingStore.getState();
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return;
  const delay = consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
  pollState.pollTimer = setInterval(pollOverviewOnce, delay);
}

function stopPollTimer(): void {
  if (pollState.pollAbortController) {
    pollState.pollAbortController.abort();
    pollState.pollAbortController = null;
  }
  if (pollState.pollTimer) {
    clearInterval(pollState.pollTimer);
    pollState.pollTimer = null;
  }
}

/** Set the window the poll fetches. Triggers an immediate re-poll. */
export function setOverviewRange(rangeDays: number): void {
  if (pollState.rangeDays === rangeDays) return;
  pollState.rangeDays = rangeDays;
  // A different window is a different body → the old ETag would 304 us into
  // keeping the previous range's data. Drop it so the next poll fetches fresh.
  pollState.overviewEtag = null;
  if (pollState.pollAbortController) pollState.pollAbortController.abort();
  pollState.overviewPollInFlight = false;
  pollOverviewOnce();
}

export function startPolling(): void {
  stopPolling();
  pollOverviewOnce();
  const delay = pollingStore.getState().consecutiveFailures >= 3 ? SLOW_POLL_MS : POLL_MS;
  pollState.pollTimer = setInterval(pollOverviewOnce, delay);
  startLive();
}

export function stopPolling(): void {
  stopPollTimer();
  stopLive();
}

export function resetPollingState(): void {
  stopPolling();
  Object.assign(pollState, createInternalPollingState());
  pollingStore.setState({
    overviewData: null,
    overviewStatus: 'idle',
    interventions: [],
    interventionsStatus: 'idle',
    pollError: null,
    hostedGate: null,
    lastUpdate: null,
    consecutiveFailures: 0,
    liveSessions: null,
    liveGeneratedAt: null,
    liveStatus: 'idle',
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else startPolling();
  });
}

if (typeof window !== 'undefined') {
  // A demo toggle flips BOTH paths. pollOverviewOnce() swaps the aggregate body
  // to/from the scenario (no network in demo). The /live loop only drives the REAL
  // board — the demo board comes from the scenario's overview.live — so STOP it in
  // demo and resume it on exit, but only while the tab is visible (a hidden tab
  // keeps both loops stopped; visibilitychange owns the restart). This avoids a
  // wasted idle tick every minute during demo and never wakes the loop on a hidden
  // tab.
  window.addEventListener('seorak:demo-scenario-changed', () => {
    pollOverviewOnce();
    if (typeof document !== 'undefined' && document.hidden) return;
    if (isDemoActive()) stopLive();
    else startLive();
  });
}

/** Force an immediate poll cycle (use after the range changes). */
export function forceRefresh(): void {
  requestRefresh();
}

export function usePollingStore<T>(selector: (state: PollingState) => T): T {
  return useStore(pollingStore, selector);
}

export const pollingActions = {
  getState: (): PollingState => pollingStore.getState(),
  subscribe: pollingStore.subscribe,
};

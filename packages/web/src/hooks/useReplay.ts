// Replay data hooks for the keyframe-replay surface (the third product surface).
//
//   useReplaySessions() — the session picker source: the live-session board.
//     Demo reads overview.live from the active scenario; live fetches
//     GET /sessions, with the same demo short-circuit as the replay reader.
//   useReplay(sessionId) — the keyframe timeline for one session. Demo builds a
//     deterministic timeline from the scenario's matching live session; live
//     fetches GET /replay/:sessionId and validates it against
//     replaySessionSchema (honest-empty keyframes:[] when the worker has no
//     qualifying moments; null while a session is still loading).

import { useEffect, useMemo, useRef, useState } from 'react';
import { REPLAY_SESSION_REQUEST_MAX } from '@seorak/types';
import type { ReplaySession, SessionSummary } from '../lib/apiSchemas.js';
import { replaySessionSchema, validateResponse } from '../lib/apiSchemas.js';
import { fetchReplay, fetchSessions } from '../lib/api.js';
import { classifyReplayError } from '../lib/replayError.js';
import { getDemoData, buildDemoReplay } from '../lib/demo/index.js';
import { pooledMap } from '../lib/pooledMap.js';
import { useDemoScenario } from './useDemoScenario.js';

/**
 * Replay payloads in flight at once. Six matches what a browser opens to one
 * host anyway, so a bigger number only queues in the network layer instead of
 * here — while a period scope of hundreds would otherwise arrive as one burst.
 */
const REPLAY_FETCH_CONCURRENCY = 6;

interface UseReplaySessionsResult {
  sessions: SessionSummary[];
  isLoading: boolean;
  error: string | null;
}

/** The session picker source — the live-session board. */
export function useReplaySessions(): UseReplaySessionsResult {
  const demo = useDemoScenario();
  const [sessions, setSessions] = useState<SessionSummary[]>(() =>
    demo.active ? getDemoData(demo.scenarioId).overview.live : [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (demo.active) {
      setSessions(getDemoData(demo.scenarioId).overview.live);
      setIsLoading(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const rows = await fetchSessions({ signal: controller.signal });
        if (cancelled) return;
        setSessions(rows);
      } catch (err) {
        if (cancelled) return;
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message || 'Failed to load sessions');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [demo.active, demo.scenarioId]);

  return { sessions, isLoading, error };
}

interface UseReplayResult {
  /** null while loading / before a session is picked; a validated ReplaySession
   *  otherwise (keyframes may be [] — honest-empty). */
  replay: ReplaySession | null;
  isLoading: boolean;
  error: string | null;
}

export interface ReplayLoadState {
  sessionId: string;
  replay: ReplaySession | null;
  isLoading: boolean;
  error: string | null;
}

/** The keyframe timeline for one session. Pass null to clear (nothing picked). */
export function useReplay(sessionId: string | null): UseReplayResult {
  const demo = useDemoScenario();
  const [replay, setReplay] = useState<ReplaySession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setReplay(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (demo.active) {
      // Build a deterministic demo timeline from the scenario's matching live
      // session. If the id isn't in the scenario, render the honest-empty state.
      const match = getDemoData(demo.scenarioId).overview.live.find(
        (s) => s.sessionId === sessionId,
      );
      setReplay(match ? buildDemoReplay(match) : null);
      setIsLoading(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const raw = await fetchReplay(sessionId as string, { signal: controller.signal });
        if (cancelled) return;
        // A malformed replay is a real failure, not "no moments yet".
        setReplay(validateResponse(replaySessionSchema, raw, 'replay'));
      } catch (err) {
        if (cancelled) return;
        // DA-14: a 404 means the picker (KV-sourced) is ahead of the D1 replay
        // log, which is honest-empty "no keyframes yet" rather than a failure, so
        // clear the error and let the view render its gentle empty panel. Real
        // errors (5xx, network, unparseable) still surface; aborts are ignored.
        switch (classifyReplayError(err)) {
          case 'ignore':
            break;
          case 'no-keyframes':
            setReplay(null);
            setError(null);
            break;
          case 'error':
            setError((err as Error).message || 'Failed to load replay');
            setReplay(null);
            break;
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionId, demo.active, demo.scenarioId]);

  return { replay, isLoading, error };
}

/** Fetch several session replays independently so each lane can be honest-empty. */
export function useReplays(sessionIds: string[]): ReplayLoadState[] {
  const demo = useDemoScenario();
  const boundedIds = [...new Set(sessionIds)].slice(0, REPLAY_SESSION_REQUEST_MAX);
  const stableKey = boundedIds.join('\u001f');
  const ids = useMemo(() => boundedIds, [stableKey]);
  const [states, setStates] = useState<ReplayLoadState[]>(() =>
    ids.map((sessionId) => ({ sessionId, replay: null, isLoading: false, error: null })),
  );
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (ids.length === 0) {
      setStates([]);
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }

    if (demo.active) {
      const demoSessions = getDemoData(demo.scenarioId).overview.live;
      setStates(
        ids.map((sessionId) => {
          const match = demoSessions.find((s) => s.sessionId === sessionId);
          return {
            sessionId,
            replay: match ? buildDemoReplay(match) : null,
            isLoading: false,
            error: null,
          };
        }),
      );
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    setStates(ids.map((sessionId) => ({ sessionId, replay: null, isLoading: true, error: null })));

    async function loadOne(sessionId: string): Promise<ReplayLoadState> {
      try {
        const raw = await fetchReplay(sessionId, { signal: controller.signal });
        const replay = validateResponse(replaySessionSchema, raw, 'replay');
        return { sessionId, replay, isLoading: false, error: null };
      } catch (err) {
        switch (classifyReplayError(err)) {
          case 'ignore':
          case 'no-keyframes':
            return { sessionId, replay: null, isLoading: false, error: null };
          case 'error':
            return {
              sessionId,
              replay: null,
              isLoading: false,
              error: (err as Error).message || 'Failed to load replay',
            };
        }
      }
    }

    // Bounded, and drawn as it lands. Firing one request per session at once
    // is a thundering herd at period scale and leaves the stage blank until
    // the slowest returns; sessions with no payload yet still contribute their
    // summary totals, and `scopeLoadNote` states the coverage while it fills.
    void pooledMap(ids, REPLAY_FETCH_CONCURRENCY, loadOne, (index, state) => {
      if (cancelled) return;
      setStates((prev) => {
        // A newer scope may have replaced these lanes mid-flight.
        if (prev[index]?.sessionId !== state.sessionId) return prev;
        const next = prev.slice();
        next[index] = state;
        return next;
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ids, demo.active, demo.scenarioId]);

  return states;
}

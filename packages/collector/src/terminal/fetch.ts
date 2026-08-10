/**
 * fetch.ts — the terminal surface's read client for the two OPEN endpoints the
 * web already polls: GET /live (KV-only head, sub-second) and GET /overview
 * (windowed aggregate, about two seconds on a cold build). Both are tolerant: any
 * non-OK / timeout / parse error resolves to a null-ish result so the caller
 * degrades the board (live-only, or the unreachable screen) rather than
 * throwing.
 *
 * The reads are open by default; when the worker is owner-locked it carries
 * the owner access token as
 * `Authorization: Bearer <token>` — the same value the daemon uses for writes
 * today (one token, resolved by the CLI). An open worker ignores the header.
 *
 * /overview supports conditional GETs (the worker emits an ETag; the web
 * echoes If-None-Match and gets 304s) — `fetchOverviewConditional` is the
 * interactive loop's client for that, so a steady-state session costs a 304,
 * not a full aggregate body every 15 seconds.
 *
 * Every entry point takes an injectable `fetchFn` (default: global fetch) so
 * the failure paths are unit-tested without a network.
 *
 * Paths and headers come from `@seorak/types` (`api.ts`), the one declaration
 * web and mobile also build their URLs from, so a worker route rename cannot
 * drift one surface away from the others. The tolerant-null transport below
 * stays local: it is the terminal's own choice, not a shared policy.
 */
import {
  LEGACY_AGGREGATE_CACHE_STATUS_HEADERS,
  bearerHeader,
  conditionalGetHeaders,
  isAggregateCacheStale,
  readAggregateCacheStatus,
  seorakRoutes,
  type AggregateCacheStatus,
  type OverviewSnapshot,
  type SessionSummary,
} from "@seorak/types";
import type { BoardData } from "./types.ts";

interface LiveResponse {
  generatedAt: string;
  live: SessionSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

/** The fields every terminal live renderer dereferences. Additive fields pass. */
function isTerminalSession(value: unknown): value is SessionSummary {
  return (
    isRecord(value) &&
    typeof value.status === "string" &&
    (value.awaitingInput === undefined ||
      typeof value.awaitingInput === "boolean") &&
    typeof value.project === "string" &&
    typeof value.repoId === "string" &&
    typeof value.lastEventAt === "string"
  );
}

function isLiveResponse(value: unknown): value is LiveResponse {
  return (
    isRecord(value) &&
    typeof value.generatedAt === "string" &&
    Array.isArray(value.live) &&
    value.live.every(isTerminalSession)
  );
}

function isLineSurvival(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNumberOrNull(value.rate) &&
    typeof value.sessionsRated === "number"
  );
}

function isAgentRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.agent === "string" &&
    typeof value.tokensTotal === "number" &&
    (value.firstSeenAt === undefined || typeof value.firstSeenAt === "string") &&
    isRecord(value.capabilities) &&
    typeof value.capabilities.endReason === "boolean"
  );
}

function isModelRow(value: unknown): boolean {
  return isRecord(value) && typeof value.model === "string";
}

function isProjectRow(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.repoId === "string" &&
    typeof value.project === "string" &&
    typeof value.sessions === "number" &&
    typeof value.tokensTotal === "number" &&
    isNumberOrNull(value.costUsd) &&
    isNumberOrNull(value.shipRate) &&
    (value.byAgent === undefined ||
      (Array.isArray(value.byAgent) && value.byAgent.every(isAgentRow))) &&
    (value.byModel === undefined ||
      (Array.isArray(value.byModel) && value.byModel.every(isModelRow))) &&
    (value.lineSurvival === null || isLineSurvival(value.lineSurvival))
  );
}

/**
 * Validate exactly the additive Overview subset the terminal consumes. This is
 * intentionally smaller than the co-deployed web's strict current-contract
 * schema: old/additive fields remain compatible, but every array/object a
 * renderer dereferences must exist with safe element shapes.
 */
function isTerminalOverview(value: unknown): value is OverviewSnapshot {
  if (
    !isRecord(value) ||
    typeof value.generatedAt !== "string" ||
    (value.rangeDays !== undefined && typeof value.rangeDays !== "number") ||
    (value.maxRangeDays !== undefined &&
      typeof value.maxRangeDays !== "number") ||
    !Array.isArray(value.live) ||
    !value.live.every(isTerminalSession) ||
    !isRecord(value.usage) ||
    !isRecord(value.usage.totals) ||
    typeof value.usage.totals.sessions !== "number" ||
    !Array.isArray(value.usage.projects) ||
    !value.usage.projects.every(isProjectRow) ||
    !isRecord(value.usage.cost) ||
    !isNumberOrNull(value.usage.cost.totalUsd) ||
    typeof value.usage.cost.sessionsWithCost !== "number" ||
    !isRecord(value.tools) ||
    !Array.isArray(value.tools.byAgent) ||
    !value.tools.byAgent.every(isAgentRow) ||
    !isRecord(value.outcomes) ||
    !isNumberOrNull(value.outcomes.shipRate) ||
    !isLineSurvival(value.outcomes.lineSurvival)
  ) {
    return false;
  }
  const unpriced = value.usage.cost.unpricedModels;
  return (
    unpriced === undefined ||
    (Array.isArray(unpriced) && unpriced.every(isModelRow))
  );
}

/** GET a JSON body, tolerantly. null on any non-OK status (a 401 from an armed
 *  worker included), timeout, or parse error — the caller treats null as "this
 *  endpoint did not answer" and degrades the board. Sends the owner access token
 *  as a Bearer header when one is resolved. */
async function fetchJson<T>(
  url: string,
  timeoutMs: number,
  guard: (value: unknown) => value is T,
  token?: string,
  fetchFn: typeof fetch = fetch,
): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: bearerHeader(token),
      });
      if (!res.ok) return null;
      const value: unknown = await res.json();
      return guard(value) ? value : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Fetch ONLY the live head — the short-cadence poll in the interactive loop. */
export async function fetchLive(
  base: string,
  token?: string,
  timeoutMs = 6000,
  fetchFn: typeof fetch = fetch,
): Promise<LiveResponse | null> {
  return fetchJson<LiveResponse>(
    `${base}${seorakRoutes.live()}`,
    timeoutMs,
    isLiveResponse,
    token,
    fetchFn,
  );
}

/** Fetch ONLY the overview aggregate, unconditionally: the one-shot read.
 *
 *  The timeout is deliberately ~10x the real cost. Measured on the deployed
 *  worker 2026-07-25, full cache-miss builds: 7d 1.75s to 1.97s, 30d 1.74s to
 *  1.86s, 90d 1.93s to 2.27s (cached 304s are 100ms to 250ms). So the window is
 *  NOT the variable here, 90d costs about half a second more than 7d, and 20s
 *  buys enough headroom that this only ever fires on a genuine hang rather than
 *  on a healthy build. Keep the headroom: tuning it down toward the measurement
 *  would turn a slow day on the worker into a board that reports a failure. */
export async function fetchOverview(
  base: string,
  days: number,
  token?: string,
  timeoutMs = 20000,
  fetchFn: typeof fetch = fetch,
): Promise<OverviewSnapshot | null> {
  const res = await fetchOverviewConditional(base, days, token, null, timeoutMs, fetchFn);
  return res.overview;
}

export interface OverviewFetchResult {
  /** "ok" carries a fresh body; "notModified" means the caller's copy still
   *  stands (304); "failed" means the endpoint did not answer. */
  status: "ok" | "notModified" | "failed";
  overview: OverviewSnapshot | null;
  /** The ETag to echo as If-None-Match on the next poll (kept on a 304, null
   *  when the worker sent none or the request failed). */
  etag: string | null;
  cacheStatus: AggregateCacheStatus;
}

/**
 * Conditional GET /overview — the interactive loop's poll. Echoes the caller's
 * `etag` as If-None-Match so an unchanged window costs a 304 instead of a full
 * body (the same contract the web client uses). NOTE: an ETag is only valid for
 * the SAME `days` window it came from; the shell resets it on a range switch.
 */
export async function fetchOverviewConditional(
  base: string,
  days: number,
  token?: string,
  etag?: string | null,
  timeoutMs = 20000,
  fetchFn: typeof fetch = fetch,
): Promise<OverviewFetchResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${base}${seorakRoutes.overview(days)}`, {
        signal: controller.signal,
        headers: conditionalGetHeaders(token, etag),
      });
      const cacheStatus = readAggregateCacheStatus(
        res.headers,
        LEGACY_AGGREGATE_CACHE_STATUS_HEADERS.overview,
      );
      if (res.status === 304) {
        return { status: "notModified", overview: null, etag: etag ?? null, cacheStatus };
      }
      if (!res.ok) return { status: "failed", overview: null, etag: null, cacheStatus };
      const value: unknown = await res.json();
      if (!isTerminalOverview(value)) {
        return {
          status: "failed",
          overview: null,
          etag: null,
          cacheStatus,
        };
      }
      const overview = value;
      return { status: "ok", overview, etag: res.headers.get("etag"), cacheStatus };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { status: "failed", overview: null, etag: null, cacheStatus: "unknown" };
  }
}

/**
 * fetchBoard — both endpoints in parallel, assembled into BoardData. `live`
 * prefers the canonical /live head, falling back to /overview's embedded `live`
 * when only /overview answered; `overview` is null when that endpoint did not
 * answer (the frame degrades aggregates to "unavailable"). `reachable` is false
 * only when NEITHER answered — the unreachable screen. This is the one-shot
 * (`--once` / `--json`) assembly; the interactive loop polls the two endpoints
 * on their own cadences instead.
 */
export async function fetchBoard(
  base: string,
  days: number,
  token?: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ data: BoardData; reachable: boolean }> {
  const [liveRes, overviewResult] = await Promise.all([
    fetchLive(base, token, undefined, fetchFn),
    fetchOverviewConditional(base, days, token, null, undefined, fetchFn),
  ]);
  const overview = overviewResult.overview;
  const reachable = liveRes !== null || overview !== null;
  return {
    data: {
      live: liveRes?.live ?? overview?.live ?? [],
      generatedAt: liveRes?.generatedAt ?? overview?.generatedAt ?? null,
      overview: overview ?? null,
      overviewStale:
        overview !== null && isAggregateCacheStale(overviewResult.cacheStatus),
    },
    reachable,
  };
}

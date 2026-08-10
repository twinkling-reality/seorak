/**
 * ship.ts — the daemon's network POST with bounded retry/backoff (FOLLOW-UP #4).
 *
 * Split out of daemon.ts (which runs `main()` at import) so the retry policy is
 * unit-testable WITHOUT booting the watch loop — `fetch` and `sleep` are injected.
 *
 * Durability contract: the daemon advances its durable offset ONLY on a 2xx
 * (`ok`). Before this, a single transient 5xx / network blip left the batch
 * un-shipped until the NEXT file change — which could be minutes or hours on a
 * quiet repo. This adds a short bounded retry so a blip self-heals in-flight:
 *   - 5xx OR a network/timeout error → RETRIABLE: retry up to `maxAttempts` with
 *     exponential backoff, then give up (offset stays put → re-ship next time).
 *   - 408/425/429, plus Retry-After on 5xx, return immediately as retriable so
 *     the durable backlog scheduler, not this in-flight call, owns the wait.
 *   - Other 4xx → NOT retriable: bad input/auth will not heal on a timer.
 *   - 2xx → ok.
 * Each attempt combines a bounded timeout with process-lifecycle cancellation,
 * so a hung connection cannot wedge the serialized flush or delay shutdown.
 * Canceling never advances the durable local offset.
 */
import {
  parseEventIngestErrorResponse,
  type EventIngestErrorCode,
} from "@seorak/types";
import { setTimeout as delay } from "node:timers/promises";
import { readBoundedJsonResponse } from "./bounded-json-response.ts";

export interface EventIngestRejection {
  code: EventIngestErrorCode;
  workerAcceptedSchemaVersions?: number[];
}

export interface ShipResult {
  /** True only on a 2xx — the daemon advances its offset iff this is true. */
  ok: boolean;
  /** The last HTTP status seen, when a response was received (absent on a pure
   *  network error). */
  status?: number;
  /** Total attempts made (1 = succeeded/failed first try). */
  attempts: number;
  /** Whether the durable scheduler should retry (network/5xx/408/425/429) or
   *  stop on a permanent 4xx. Meaningful only when `ok` is false. */
  retriable: boolean;
  /** The last network error message, when the failure was a thrown fetch. */
  error?: string;
  /** Bounded server-directed delay for the durable backlog scheduler. */
  retryAfterMs?: number;
  /** Closed, bounded worker protocol rejection. Raw response text is discarded. */
  rejection?: EventIngestRejection;
}

export interface ShipOptions {
  url: string;
  body: string;
  /** Shared-secret ingest key; sent as `Authorization: Bearer` when set. */
  ingestKey?: string;
  /** Max attempts including the first (default 4: initial + 3 retries). */
  maxAttempts?: number;
  /** Base backoff in ms; attempt N waits baseBackoffMs * 2^(N-1) (default 500 →
   *  500ms, 1s, 2s). */
  baseBackoffMs?: number;
  /** Per-attempt request timeout in ms (default 10s). */
  timeoutMs?: number;
  /** Process-lifecycle cancellation. A canceled batch remains durable locally. */
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests (default: real timer). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable wall clock for HTTP-date Retry-After tests. */
  now?: () => number;
}

const defaultSleep = async (
  ms: number,
  signal?: AbortSignal,
): Promise<void> => {
  try {
    await delay(ms, undefined, signal ? { signal } : undefined);
  } catch (error) {
    if (!signal?.aborted) throw error;
  }
};

const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;
const INGEST_ERROR_BODY_LIMIT = 4_096;

async function readIngestRejection(
  response: Response,
): Promise<EventIngestRejection | undefined> {
  try {
    const parsed = parseEventIngestErrorResponse(
      await readBoundedJsonResponse(response, INGEST_ERROR_BODY_LIMIT),
    );
    if (parsed === null) return undefined;
    return {
      code: parsed.code,
      ...(parsed.acceptedSchemaVersions
        ? {
            workerAcceptedSchemaVersions: [
              ...parsed.acceptedSchemaVersions,
            ],
          }
        : {}),
    };
  } catch {
    return undefined;
  }
}

function retryAfterMs(response: Response, now: number): number | undefined {
  const raw = response.headers?.get?.("retry-after")?.trim();
  if (!raw) return undefined;

  const seconds = Number(raw);
  const parsed = Number.isFinite(seconds)
    ? Math.ceil(seconds * 1000)
    : Date.parse(raw) - now;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, parsed);
}

/**
 * POST `body` to `url`, retrying transient failures (5xx / network) with bounded
 * exponential backoff. Never throws — returns a `ShipResult` so the caller decides
 * whether to advance the offset (only on `ok`). Permanent 4xx is terminal;
 * rate-limit and server-directed waits return to the durable scheduler.
 */
export async function shipBatch(opts: ShipOptions): Promise<ShipResult> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseBackoffMs = opts.baseBackoffMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  let lastStatus: number | undefined;
  let lastError: string | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, timeout])
      : timeout;
    try {
      const res = await fetchImpl(opts.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.ingestKey ? { authorization: `Bearer ${opts.ingestKey}` } : {}),
        },
        body: opts.body,
        signal,
      });
      lastStatus = res.status;
      if (res.ok) {
        return { ok: true, status: res.status, attempts: attempt, retriable: false };
      }
      const directedDelay = retryAfterMs(res, now());
      const rejection = await readIngestRejection(res);
      if (
        res.status === 408 ||
        res.status === 425 ||
        res.status === 429 ||
        (res.status >= 500 && directedDelay !== undefined)
      ) {
        return {
          ok: false,
          status: res.status,
          attempts: attempt,
          retriable: true,
          ...(directedDelay !== undefined
            ? { retryAfterMs: directedDelay }
            : {}),
          ...(rejection ? { rejection } : {}),
        };
      }
      // Other 4xx is terminal: retrying bad input/auth never helps.
      if (res.status < 500) {
        return {
          ok: false,
          status: res.status,
          attempts: attempt,
          retriable: false,
          ...(rejection ? { rejection } : {}),
        };
      }
      // 5xx — fall through to the backoff/retry below.
    } catch (err) {
      // Network error / timeout (AbortError) — retriable.
      lastError = (err as Error).message;
    }

    if (opts.signal?.aborted) break;

    // Retriable failure: back off before the next attempt (none after the last).
    if (attempt < maxAttempts) {
      await sleep(baseBackoffMs * 2 ** (attempt - 1), opts.signal);
      if (opts.signal?.aborted) break;
    }
  }

  return {
    ok: false,
    ...(lastStatus !== undefined ? { status: lastStatus } : {}),
    ...(lastError !== undefined ? { error: lastError } : {}),
    attempts,
    retriable: true,
  };
}

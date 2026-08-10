/**
 * ship.test.ts — the daemon's bounded retry/backoff (FOLLOW-UP #4).
 *
 * The durability rule: advance the offset ONLY on a 2xx. A transient 5xx /
 * network blip is retried in-flight (instead of waiting for the next file change);
 * permanent 4xx is terminal while rate-limit/server-directed waits move to the
 * durable backlog scheduler. `fetch` and `sleep` are injected for determinism.
 */
import { describe, expect, it } from "vitest";
import { shipBatch } from "../src/ship.ts";

/** A fetch double that returns the queued statuses in order, then repeats the
 *  last; throws the queued errors (encoded as Error instances). Records calls. */
function fakeFetch(responses: Array<number | Error>) {
  let i = 0;
  const calls: number[] = [];
  const fn = async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    calls.push(1);
    if (r instanceof Error) throw r;
    return { ok: r >= 200 && r < 300, status: r } as Response;
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

const noSleep = async () => {};

const base = { url: "http://w/events", body: "{}", sleep: noSleep };

describe("shipBatch — bounded retry/backoff", () => {
  it("succeeds on the first try (one attempt, ok)", async () => {
    const { fn, calls } = fakeFetch([200]);
    const r = await shipBatch({ ...base, fetchImpl: fn });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(calls.length).toBe(1);
  });

  it("retries a 5xx and succeeds when the worker recovers", async () => {
    const { fn, calls } = fakeFetch([503, 503, 200]);
    const r = await shipBatch({ ...base, fetchImpl: fn, maxAttempts: 4 });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(calls.length).toBe(3);
  });

  it("retries a network error and succeeds on recovery", async () => {
    const { fn } = fakeFetch([new Error("ECONNREFUSED"), 200]);
    const r = await shipBatch({ ...base, fetchImpl: fn, maxAttempts: 4 });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(2);
  });

  it("gives up after maxAttempts on a persistent 5xx (retriable, not ok)", async () => {
    const { fn, calls } = fakeFetch([500]);
    const r = await shipBatch({ ...base, fetchImpl: fn, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(r.retriable).toBe(true);
    expect(r.status).toBe(500);
    expect(r.attempts).toBe(3);
    expect(calls.length).toBe(3);
  });

  it("does NOT retry a 4xx — terminal, one attempt only", async () => {
    const { fn, calls } = fakeFetch([401]);
    const r = await shipBatch({ ...base, fetchImpl: fn, maxAttempts: 4 });
    expect(r.ok).toBe(false);
    expect(r.retriable).toBe(false);
    expect(r.status).toBe(401);
    expect(r.attempts).toBe(1);
    expect(calls.length).toBe(1); // never retried
  });

  it.each([401, 413])(
    "does not let Retry-After turn permanent HTTP %s into a retry loop",
    async (status) => {
    const fn = (async () =>
      ({
        ok: false,
        status,
        headers: new Headers({ "retry-after": "60" }),
      }) as Response) as typeof fetch;
    const result = await shipBatch({ ...base, fetchImpl: fn });
    expect(result).toMatchObject({
      ok: false,
      status,
      attempts: 1,
      retriable: false,
    });
    expect(result.retryAfterMs).toBeUndefined();
    },
  );

  it("hands 429 and Retry-After to the durable scheduler without sleeping in-flight", async () => {
    const sleeps: number[] = [];
    const fn = (async () =>
      ({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "60" }),
      }) as Response) as typeof fetch;
    const result = await shipBatch({
      ...base,
      fetchImpl: fn,
      maxAttempts: 4,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result).toMatchObject({
      ok: false,
      status: 429,
      attempts: 1,
      retriable: true,
      retryAfterMs: 60_000,
    });
    expect(sleeps).toEqual([]);
  });

  it("bounds an HTTP-date Retry-After before handing it off", async () => {
    const now = Date.parse("2026-07-27T12:00:00.000Z");
    const fn = (async () =>
      ({
        ok: false,
        status: 503,
        headers: new Headers({
          "retry-after": new Date(now + 2 * 60 * 60_000).toUTCString(),
        }),
      }) as Response) as typeof fetch;
    const result = await shipBatch({
      ...base,
      fetchImpl: fn,
      now: () => now,
    });
    expect(result.retryAfterMs).toBe(60 * 60_000);
    expect(result.attempts).toBe(1);
  });

  it("reports the final network error when all attempts fail", async () => {
    const { fn } = fakeFetch([new Error("ETIMEDOUT")]);
    const r = await shipBatch({ ...base, fetchImpl: fn, maxAttempts: 2 });
    expect(r.ok).toBe(false);
    expect(r.retriable).toBe(true);
    expect(r.error).toContain("ETIMEDOUT");
  });

  it("cancels retry backoff on process shutdown without losing durability", async () => {
    const controller = new AbortController();
    let attempts = 0;
    let enteredBackoff!: () => void;
    const backoffStarted = new Promise<void>((resolve) => {
      enteredBackoff = resolve;
    });
    const pending = shipBatch({
      ...base,
      signal: controller.signal,
      maxAttempts: 4,
      fetchImpl: (async () => {
        attempts += 1;
        return new Response(null, { status: 503 });
      }) as typeof fetch,
      sleep: async (_ms, signal) => {
        enteredBackoff();
        await new Promise<void>((resolve) =>
          signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    });
    await backoffStarted;
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      retriable: true,
      attempts: 1,
    });
    expect(attempts).toBe(1);
  });

  it("sends the Bearer ingest key when provided", async () => {
    let seenAuth: string | undefined;
    const fn = (async (_url: string, init: RequestInit) => {
      seenAuth = (init.headers as Record<string, string>).authorization;
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    await shipBatch({ ...base, fetchImpl: fn, ingestKey: "secret" });
    expect(seenAuth).toBe("Bearer secret");
  });

  it("retains only a closed bounded worker rejection", async () => {
    const fn = (async () =>
      new Response(
        JSON.stringify({
          error: "event batch rejected",
          code: "unsupported_schema_version",
          acceptedSchemaVersions: [2],
        }),
        { status: 400 },
      )) as typeof fetch;
    await expect(
      shipBatch({ ...base, fetchImpl: fn }),
    ).resolves.toMatchObject({
      ok: false,
      status: 400,
      retriable: false,
      rejection: {
        code: "unsupported_schema_version",
        workerAcceptedSchemaVersions: [2],
      },
    });
  });

  it("discards malformed, unknown, and oversized worker error bodies", async () => {
    const bodies = [
      {
        error: "event batch rejected",
        code: "private_parser_detail",
      },
      {
        error: "event batch rejected",
        code: "invalid_batch",
        raw: "private parser content",
      },
      "x".repeat(4_097),
    ];
    for (const body of bodies) {
      const fn = (async () =>
        new Response(
          typeof body === "string" ? body : JSON.stringify(body),
          { status: 400 },
        )) as typeof fetch;
      const result = await shipBatch({ ...base, fetchImpl: fn });
      expect(result.rejection).toBeUndefined();
    }
  });
});

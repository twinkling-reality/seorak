/**
 * terminal-fetch.test.ts — the read client's tolerant edges, exercised through
 * the injectable fetch: auth header, 401→null degradation, timeout/throw→null,
 * the conditional /overview contract (etag out, If-None-Match back, 304 keeps
 * the copy in hand), and fetchBoard's assembly/fallback rules.
 */
import { describe, expect, it } from "vitest";
import { fetchBoard, fetchLive, fetchOverview, fetchOverviewConditional } from "../src/terminal/fetch.ts";

type Call = { url: string; headers: Record<string, string> };

/** A scripted fetch: routes by substring, records calls. */
function mkFetch(
  route: (url: string) =>
    | { status: number; body?: unknown; etag?: string; cacheStatus?: string }
    | "throw",
  calls: Call[] = [],
): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: (init?.headers as Record<string, string>) ?? {} });
    const r = route(u);
    if (r === "throw") throw new Error("network down");
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: new Headers({
        ...(r.etag ? { etag: r.etag } : {}),
        ...(r.cacheStatus ? { "x-seorak-cache-status": r.cacheStatus } : {}),
      }),
      json: async () => r.body,
    } as Response;
  }) as unknown as typeof fetch;
}

const LIVE_BODY = { generatedAt: "2026-07-16T09:00:00.000Z", live: [] };
const OVERVIEW_BODY = {
  generatedAt: "2026-07-16T09:00:00.000Z",
  live: [],
  rangeDays: 7,
  maxRangeDays: 90,
  usage: {
    totals: { sessions: 0 },
    projects: [],
    cost: { totalUsd: null, sessionsWithCost: 0 },
  },
  tools: { byAgent: [] },
  outcomes: {
    shipRate: null,
    lineSurvival: { rate: null, sessionsRated: 0 },
  },
};

describe("fetchLive", () => {
  it("returns the body and sends the Bearer token", async () => {
    const calls: Call[] = [];
    const res = await fetchLive("https://w", "tok", undefined, mkFetch(() => ({ status: 200, body: LIVE_BODY }), calls));
    expect(res).toEqual(LIVE_BODY);
    expect(calls[0]!.url).toBe("https://w/live");
    expect(calls[0]!.headers.authorization).toBe("Bearer tok");
  });
  it("degrades a 401 and a thrown fetch to null (never throws)", async () => {
    expect(await fetchLive("https://w", undefined, undefined, mkFetch(() => ({ status: 401 })))).toBeNull();
    expect(await fetchLive("https://w", undefined, undefined, mkFetch(() => "throw"))).toBeNull();
  });
  it("degrades a malformed successful body to null", async () => {
    for (const body of [
      {},
      { generatedAt: LIVE_BODY.generatedAt, live: "not-an-array" },
      { generatedAt: LIVE_BODY.generatedAt, live: [null] },
    ]) {
      await expect(
        fetchLive(
          "https://w",
          undefined,
          undefined,
          mkFetch(() => ({ status: 200, body })),
        ),
      ).resolves.toBeNull();
    }
  });
  it("accepts the canonical unblocked session with awaitingInput omitted", async () => {
    const body = {
      generatedAt: LIVE_BODY.generatedAt,
      live: [
        {
          status: "working",
          project: "seorak",
          repoId: "r1",
          lastEventAt: LIVE_BODY.generatedAt,
        },
      ],
    };
    await expect(
      fetchLive(
        "https://w",
        undefined,
        undefined,
        mkFetch(() => ({ status: 200, body })),
      ),
    ).resolves.toEqual(body);
  });
  it("sends no auth header against an open worker", async () => {
    const calls: Call[] = [];
    await fetchLive("https://w", undefined, undefined, mkFetch(() => ({ status: 200, body: LIVE_BODY }), calls));
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });
});

describe("fetchOverviewConditional — the interactive loop's client", () => {
  it("a fresh body comes back with the worker's etag", async () => {
    const res = await fetchOverviewConditional(
      "https://w",
      30,
      undefined,
      null,
      undefined,
      mkFetch(() => ({ status: 200, body: OVERVIEW_BODY, etag: 'W/"abc"' })),
    );
    expect(res.status).toBe("ok");
    expect(res.overview).toEqual(OVERVIEW_BODY);
    expect(res.etag).toBe('W/"abc"');
  });
  it("echoes the etag as If-None-Match and keeps it on a 304", async () => {
    const calls: Call[] = [];
    const res = await fetchOverviewConditional(
      "https://w",
      30,
      "tok",
      'W/"abc"',
      undefined,
      mkFetch(() => ({ status: 304 }), calls),
    );
    expect(calls[0]!.url).toBe("https://w/overview?days=30");
    expect(calls[0]!.headers["if-none-match"]).toBe('W/"abc"');
    expect(calls[0]!.headers.authorization).toBe("Bearer tok");
    expect(res).toEqual({
      status: "notModified",
      overview: null,
      etag: 'W/"abc"',
      cacheStatus: "fresh",
    });
  });
  it("carries an explicitly revalidating body as stale data", async () => {
    const res = await fetchOverviewConditional(
      "https://w",
      7,
      undefined,
      null,
      undefined,
      mkFetch(() => ({
        status: 200,
        body: OVERVIEW_BODY,
        cacheStatus: "revalidating",
      })),
    );
    expect(res.cacheStatus).toBe("revalidating");
    expect(res.etag).toBeNull();
  });
  it("reports failure (and drops the etag) on non-OK and on a throw", async () => {
    expect(
      await fetchOverviewConditional("https://w", 7, undefined, 'W/"abc"', undefined, mkFetch(() => ({ status: 500 }))),
    ).toEqual({ status: "failed", overview: null, etag: null, cacheStatus: "fresh" });
    expect(
      await fetchOverviewConditional("https://w", 7, undefined, null, undefined, mkFetch(() => "throw")),
    ).toEqual({ status: "failed", overview: null, etag: null, cacheStatus: "unknown" });
  });
  it("reports failure and drops the etag on a malformed successful body", async () => {
    for (const body of [
      {},
      { ...OVERVIEW_BODY, usage: {} },
      {
        ...OVERVIEW_BODY,
        tools: { byAgent: [null] },
      },
      {
        ...OVERVIEW_BODY,
        usage: {
          ...OVERVIEW_BODY.usage,
          projects: [{ repoId: "r", project: "p" }],
        },
      },
    ]) {
      await expect(
        fetchOverviewConditional(
          "https://w",
          7,
          undefined,
          'W/"poisoned"',
          undefined,
          mkFetch(() => ({
            status: 200,
            body,
            etag: 'W/"malformed"',
          })),
        ),
      ).resolves.toEqual({
        status: "failed",
        overview: null,
        etag: null,
        cacheStatus: "fresh",
      });
    }
  });
});

describe("fetchOverview (one-shot wrapper)", () => {
  it("returns the body, or null on failure", async () => {
    expect(await fetchOverview("https://w", 7, undefined, undefined, mkFetch(() => ({ status: 200, body: OVERVIEW_BODY })))).toEqual(
      OVERVIEW_BODY,
    );
    expect(await fetchOverview("https://w", 7, undefined, undefined, mkFetch(() => ({ status: 503 })))).toBeNull();
    expect(
      await fetchOverview(
        "https://w",
        7,
        undefined,
        undefined,
        mkFetch(() => ({ status: 200, body: {} })),
      ),
    ).toBeNull();
  });
});

describe("fetchBoard — the one-shot assembly", () => {
  it("prefers the canonical /live head and carries the overview", async () => {
    const { data, reachable } = await fetchBoard(
      "https://w",
      7,
      undefined,
      mkFetch((url) => (url.includes("/live") ? { status: 200, body: LIVE_BODY } : { status: 200, body: OVERVIEW_BODY })),
    );
    expect(reachable).toBe(true);
    expect(data.generatedAt).toBe(LIVE_BODY.generatedAt);
    expect(data.overview).toEqual(OVERVIEW_BODY);
  });
  it("falls back to /overview's embedded live when only /overview answered", async () => {
    const embedded = {
      ...OVERVIEW_BODY,
      live: [
        {
          sessionId: "s1",
          status: "working",
          project: "seorak",
          repoId: "r1",
          lastEventAt: LIVE_BODY.generatedAt,
        },
      ],
    };
    const { data, reachable } = await fetchBoard(
      "https://w",
      7,
      undefined,
      mkFetch((url) => (url.includes("/live") ? "throw" : { status: 200, body: embedded })),
    );
    expect(reachable).toBe(true);
    expect(data.live).toEqual(embedded.live);
  });
  it("reachable=false only when NEITHER endpoint answered", async () => {
    const { data, reachable } = await fetchBoard("https://w", 7, undefined, mkFetch(() => "throw"));
    expect(reachable).toBe(false);
    expect(data.live).toEqual([]);
    expect(data.overview).toBeNull();
  });
});

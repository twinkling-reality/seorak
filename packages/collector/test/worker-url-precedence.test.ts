/**
 * worker-url-precedence.test.ts — `resolveWorkerUrl` ADR-5 precedence (flag >
 * env > plist > default), and the read-token rule both consumers share. PURE:
 * every case passes plain inputs, no ambient env / plist / launchctl reads.
 */
import { describe, expect, it } from "vitest";
import { dashboardDeepLink } from "../src/dashboard.ts";
import { daemonTokens } from "../src/daemon.ts";
import {
  DEFAULT_WORKER_URL,
  resolveAccessToken,
  resolveEnvAccessToken,
  resolveTargets,
  resolveWorkerUrl,
} from "../src/worker-url.ts";

describe("resolveWorkerUrl — flag > env > plist > default", () => {
  it("prefers the explicit --worker-url flag above all", () => {
    expect(
      resolveWorkerUrl({ flag: "https://flag.example", env: "https://env.example", plist: "https://plist.example" }),
    ).toBe("https://flag.example");
  });
  it("falls to the env var when no flag", () => {
    expect(resolveWorkerUrl({ env: "https://env.example", plist: "https://plist.example" })).toBe(
      "https://env.example",
    );
  });
  it("falls to the plist URL when no flag or env", () => {
    expect(resolveWorkerUrl({ plist: "https://plist.example" })).toBe("https://plist.example");
  });
  it("falls to the localhost default when every source is empty/null", () => {
    expect(resolveWorkerUrl({})).toBe(DEFAULT_WORKER_URL);
    expect(resolveWorkerUrl({ flag: "", env: "", plist: null })).toBe(DEFAULT_WORKER_URL);
  });
  it("ignores a bare boolean flag (--worker-url with no value)", () => {
    expect(resolveWorkerUrl({ flag: true, env: "https://env.example" })).toBe("https://env.example");
  });
  it("trims a trailing slash so `${base}/live` never doubles up", () => {
    expect(resolveWorkerUrl({ flag: "https://x.example/" })).toBe("https://x.example");
  });
});

describe("resolveAccessToken — env > plist, undefined when open (AUTH-OWNER-LOCK.md)", () => {
  it("prefers the env token over the plist-baked one", () => {
    expect(resolveAccessToken({ env: "env-tok", plist: "plist-tok" })).toBe("env-tok");
  });
  it("falls to the plist-baked token when env is empty", () => {
    expect(resolveAccessToken({ env: "", plist: "plist-tok" })).toBe("plist-tok");
    expect(resolveAccessToken({ plist: "plist-tok" })).toBe("plist-tok");
  });
  it("is undefined against an open worker (no token anywhere)", () => {
    expect(resolveAccessToken({})).toBeUndefined();
    expect(resolveAccessToken({ env: "", plist: null })).toBeUndefined();
    expect(resolveAccessToken({ env: "   ", plist: "  " })).toBeUndefined();
  });
  it("trims surrounding whitespace on the resolved token", () => {
    expect(resolveAccessToken({ env: "  tok  " })).toBe("tok");
  });
});

/**
 * The env leg of the read-token rule, and the proof that its TWO consumers — the
 * terminal (via resolveTargets) and the daemon (via daemonTokens) — read it from
 * this one function. The daemon used to re-derive `SEORAK_READ_KEY ?? INGEST_KEY`
 * inline, so a change to the read-only-token story could land in one consumer
 * and not the other.
 */
describe("resolveEnvAccessToken — read key over ingest key, one rule for both consumers", () => {
  const CASES: Array<{ name: string; env: NodeJS.ProcessEnv; expected: string | undefined }> = [
    { name: "only the ingest key is set", env: { SEORAK_INGEST_KEY: "ingest" }, expected: "ingest" },
    { name: "only the read key is set", env: { SEORAK_READ_KEY: "read" }, expected: "read" },
    {
      name: "both are set and differ",
      env: { SEORAK_INGEST_KEY: "ingest", SEORAK_READ_KEY: "read" },
      expected: "read",
    },
    { name: "neither is set", env: {}, expected: undefined },
    {
      name: "the read key is set but blank",
      env: { SEORAK_INGEST_KEY: "ingest", SEORAK_READ_KEY: "" },
      expected: undefined,
    },
  ];

  /** No install of record, so the terminal's plist leg is null and both
   *  consumers are reduced to the env rule under test. */
  const NO_PLIST = "/nonexistent/app.seorak.collector.plist";

  for (const { name, env, expected } of CASES) {
    it(`${name}: resolves ${String(expected)} for the terminal and the daemon alike`, () => {
      expect(resolveEnvAccessToken(env)).toBe(expected);
      expect(resolveTargets({}, env, NO_PLIST).accessToken).toBe(expected);
      // The daemon's settings sync sends "" rather than an absent header value.
      expect(daemonTokens(env).readKey).toBe(expected ?? "");
    });
  }

  it("trims whitespace, so a plist value with a stray newline still authenticates", () => {
    expect(resolveEnvAccessToken({ SEORAK_READ_KEY: " read\n" })).toBe("read");
  });
});

describe("dashboardDeepLink — points at /dashboard, carries #token (AUTH-OWNER-LOCK.md)", () => {
  it("targets /dashboard on a deployed worker (not marketing root)", () => {
    expect(dashboardDeepLink("https://cell.example")).toBe("https://cell.example/dashboard");
  });
  it("uses the vite dev server for a local worker", () => {
    expect(dashboardDeepLink("http://localhost:8787")).toBe("http://localhost:5173/dashboard");
  });
  it("appends an encoded #token for one-click sign-in when a key is set", () => {
    expect(dashboardDeepLink("https://cell.example", "a b")).toBe(
      "https://cell.example/dashboard#token=a%20b",
    );
  });
  it("omits the fragment with no token", () => {
    expect(dashboardDeepLink("https://cell.example", "")).toBe("https://cell.example/dashboard");
    expect(dashboardDeepLink("https://cell.example", undefined)).toBe("https://cell.example/dashboard");
  });
});

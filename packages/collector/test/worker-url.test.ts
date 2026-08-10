/**
 * worker-url.test.ts — resolveTargets, the ONE worker-URL + access-token
 * assembly every read surface (session, one-shot, status, init verify)
 * goes through. The leg-by-leg precedence of resolveWorkerUrl/resolveAccessToken
 * is covered in worker-url-precedence.test.ts; this file proves the assembly reads the
 * plist and honors flag > env > plist end to end, with a real temp plist.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveIngestToken,
  resolveReadTargets,
  resolveTargets,
  servicePlistEnv,
} from "../src/worker-url.ts";

let dir: string;
let plistPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seorak-worker-url-"));
  plistPath = join(dir, "app.seorak.collector.plist");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writePlist(env: Record<string, string>): void {
  const entries = Object.entries(env)
    .map(([k, v]) => `\t\t<key>${k}</key>\n\t\t<string>${v}</string>`)
    .join("\n");
  writeFileSync(
    plistPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>EnvironmentVariables</key>\n\t<dict>\n${entries}\n\t</dict>\n</dict>\n</plist>\n`,
    "utf8",
  );
}

describe("resolveTargets", () => {
  it("falls back to the localhost default with no flag, env, or plist", () => {
    expect(resolveTargets({}, {}, plistPath)).toEqual({ workerUrl: "http://localhost:8787" });
  });

  it("reads the plist-baked URL and ingest key (the launchd install)", () => {
    writePlist({ SEORAK_WORKER_URL: "https://plist.example/", SEORAK_INGEST_KEY: "baked" });
    expect(resolveTargets({}, {}, plistPath)).toEqual({
      workerUrl: "https://plist.example",
      accessToken: "baked",
    });
  });

  it("env beats plist, flag beats env (ADR-5), for both URL and token", () => {
    writePlist({ SEORAK_WORKER_URL: "https://plist.example", SEORAK_INGEST_KEY: "baked" });
    expect(
      resolveTargets(
        { "worker-url": "https://flag.example" },
        { SEORAK_WORKER_URL: "https://env.example", SEORAK_INGEST_KEY: "env-key" },
        plistPath,
      ),
    ).toEqual({ workerUrl: "https://flag.example", accessToken: "env-key" });
  });

  it("prefers SEORAK_READ_KEY over SEORAK_INGEST_KEY in both env and plist", () => {
    writePlist({ SEORAK_READ_KEY: "read-baked", SEORAK_INGEST_KEY: "ingest-baked" });
    expect(resolveTargets({}, {}, plistPath).accessToken).toBe("read-baked");
    expect(
      resolveTargets({}, { SEORAK_READ_KEY: "read-env", SEORAK_INGEST_KEY: "ingest-env" }, plistPath).accessToken,
    ).toBe("read-env");
  });

  it("an explicit blank env read key cannot resurrect a plist credential", () => {
    writePlist({
      SEORAK_READ_KEY: "read-baked",
      SEORAK_INGEST_KEY: "ingest-baked",
    });
    expect(
      resolveTargets(
        {},
        { SEORAK_READ_KEY: "", SEORAK_INGEST_KEY: "ingest-env" },
        plistPath,
      ).accessToken,
    ).toBeUndefined();
  });

  it("a blank plist read key suppresses the baked ingest fallback", () => {
    writePlist({
      SEORAK_READ_KEY: "",
      SEORAK_INGEST_KEY: "ingest-baked",
    });
    expect(resolveTargets({}, {}, plistPath).accessToken).toBeUndefined();
  });

  it("a bare --worker-url flag (boolean true) is ignored, not stringified", () => {
    expect(resolveTargets({ "worker-url": true }, {}, plistPath).workerUrl).toBe("http://localhost:8787");
  });
});

describe("resolveIngestToken", () => {
  it("reads the baked write key when the environment does not own it", () => {
    writePlist({ SEORAK_INGEST_KEY: "ingest-baked" });
    expect(resolveIngestToken({}, plistPath)).toBe("ingest-baked");
  });

  it("lets an explicit blank environment value suppress the baked key", () => {
    writePlist({ SEORAK_INGEST_KEY: "ingest-baked" });
    expect(
      resolveIngestToken({ SEORAK_INGEST_KEY: "" }, plistPath),
    ).toBeUndefined();
  });
});

describe("servicePlistEnv", () => {
  it("returns null for an absent plist or key, and unescapes XML entities", () => {
    expect(servicePlistEnv(plistPath, "SEORAK_WORKER_URL")).toBeNull();
    writePlist({ SEORAK_INGEST_KEY: "a&amp;b" });
    expect(servicePlistEnv(plistPath, "SEORAK_WORKER_URL")).toBeNull();
    expect(servicePlistEnv(plistPath, "SEORAK_INGEST_KEY")).toBe("a&b");
  });
});

describe("resolveReadTargets", () => {
  const PLANE = "http://127.0.0.1:4317";

  it("reads the local plane when this install has no worker", () => {
    // The account-free default. Before this, `seorak` probed localhost:8787 and
    // rendered the unreachable screen while the same routes were answered on
    // loopback by the plane the daemon had already started.
    expect(
      resolveReadTargets({ workerUrl: "http://localhost:8787" }, false, PLANE),
    ).toEqual({ workerUrl: PLANE });
  });

  it("carries no first-party token because the plane mints no operator credential", () => {
    expect(
      resolveReadTargets(
        { workerUrl: "http://localhost:8787", accessToken: "stale" },
        false,
        PLANE,
      ).accessToken,
    ).toBeUndefined();
  });

  it("leaves a configured connection exactly as resolved", () => {
    const configured = { workerUrl: "https://w.example.com", accessToken: "t" };
    expect(resolveReadTargets(configured, true, PLANE)).toEqual(configured);
  });

  it("trims a trailing slash so `${base}/live` never doubles up", () => {
    expect(
      resolveReadTargets({ workerUrl: "" }, false, `${PLANE}/`).workerUrl,
    ).toBe(PLANE);
  });
});

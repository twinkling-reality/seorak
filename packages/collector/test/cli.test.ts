/**
 * cli.test.ts — PURE logic supporting the `seorak` CLI. NO launchctl, NO daemon,
 * NO disk: importing cli.ts never shells out (all spawnSync calls live inside
 * subcommand handlers, none of which run here).
 */
import { describe, expect, it } from "vitest";
import { dashboardUrl } from "../src/dashboard.ts";
import { LAUNCHD_LABEL } from "../src/paths.ts";
import {
  EVENTS_LOG_STALE_MS,
  HEARTBEAT_STALE_MS,
  evaluateEventsLog,
  evaluateHeartbeat,
  evaluateHooks,
  evaluateService,
  isDaemonWedged,
} from "../src/status.ts";
import {
  buildLaunchAgentPlist,
  initVerificationPassed,
  resolveInitCredentials,
} from "../src/cli.ts";
import { mergeHooks } from "../src/install.ts";

describe("buildLaunchAgentPlist", () => {
  const plist = buildLaunchAgentPlist({
    nodeBin: "/usr/local/bin/node",
    daemonPath: "/Users/me/seorak/packages/collector/bin/daemon.mjs",
    workerUrl: "https://seorak-worker.example.workers.dev",
    stdoutPath: "/Users/me/.seorak/daemon.log",
    stderrPath: "/Users/me/.seorak/daemon.log",
    stateDir: "/Users/me/.seorak",
  });

  it("is well-formed plist XML with the right doctype", () => {
    expect(plist.startsWith('<?xml version="1.0"')).toBe(true);
    expect(plist).toContain("<!DOCTYPE plist PUBLIC");
    expect(plist.trimEnd().endsWith("</plist>")).toBe(true);
  });

  it("carries the Label", () => {
    expect(plist).toContain(`<key>Label</key>`);
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
  });

  it("carries the SEORAK_WORKER_URL value in EnvironmentVariables", () => {
    expect(plist).toContain("<key>SEORAK_WORKER_URL</key>");
    expect(plist).toContain("<string>https://seorak-worker.example.workers.dev</string>");
  });

  it("bakes NO worker URL for an account-free install", () => {
    // A baked localhost default would make the daemon, `seorak status`, and a
    // later re-init all believe a connection exists that nobody configured.
    const local = buildLaunchAgentPlist({
      nodeBin: "/usr/local/bin/node",
      daemonPath: "/Users/me/seorak/packages/collector/bin/daemon.mjs",
      stdoutPath: "/Users/me/.seorak/daemon.log",
      stderrPath: "/Users/me/.seorak/daemon.log",
      stateDir: "/Users/me/.seorak",
    });
    expect(local).not.toContain("SEORAK_WORKER_URL");
    expect(local).not.toContain("SEORAK_INGEST_KEY");
    expect(local).toContain("<key>SEORAK_DIR</key>");
    expect(local.startsWith('<?xml version="1.0"')).toBe(true);
    expect(local.trimEnd().endsWith("</plist>")).toBe(true);
  });

  it("pins the daemon to the CLI's canonical collector state directory", () => {
    expect(plist).toContain("<key>SEORAK_DIR</key>");
    expect(plist).toContain("<string>/Users/me/.seorak</string>");
  });

  it("carries the node binary and the daemon path as ProgramArguments", () => {
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/Users/me/seorak/packages/collector/bin/daemon.mjs</string>");
    // node must come before the daemon path in the array.
    expect(plist.indexOf("/usr/local/bin/node")).toBeLessThan(plist.indexOf("daemon.mjs"));
  });

  it("sets RunAtLoad and KeepAlive true and redirects stdout/stderr", () => {
    expect(plist).toContain("<key>RunAtLoad</key>\n\t<true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n\t<true/>");
    expect(plist).toContain("<key>StandardOutPath</key>\n\t<string>/Users/me/.seorak/daemon.log</string>");
    expect(plist).toContain("<key>StandardErrorPath</key>\n\t<string>/Users/me/.seorak/daemon.log</string>");
  });

  it("XML-escapes special characters in the worker URL", () => {
    const escaped = buildLaunchAgentPlist({
      nodeBin: "/node",
      daemonPath: "/d.mjs",
      workerUrl: "http://h/?a=1&b=2",
      stdoutPath: "/o",
      stderrPath: "/e",
      stateDir: "/state",
    });
    expect(escaped).toContain("http://h/?a=1&amp;b=2");
    expect(escaped).not.toContain("a=1&b=2");
  });

  it("honors a custom label", () => {
    const p = buildLaunchAgentPlist({
      nodeBin: "/node",
      daemonPath: "/d.mjs",
      workerUrl: "http://x",
      stdoutPath: "/o",
      stderrPath: "/e",
      stateDir: "/state",
      label: "com.example.test",
    });
    expect(p).toContain("<string>com.example.test</string>");
  });

  it("omits SEORAK_INGEST_KEY from the env when no ingest key is given", () => {
    // The default `plist` above was built without an ingestKey → open/local worker.
    expect(plist).not.toContain("SEORAK_INGEST_KEY");
  });

  it("bakes (and XML-escapes) SEORAK_INGEST_KEY into the env when provided", () => {
    const p = buildLaunchAgentPlist({
      nodeBin: "/node",
      daemonPath: "/d.mjs",
      workerUrl: "http://x",
      stdoutPath: "/o",
      stderrPath: "/e",
      stateDir: "/state",
      ingestKey: "abc&123",
    });
    expect(p).toContain("<key>SEORAK_INGEST_KEY</key>");
    expect(p).toContain("<string>abc&amp;123</string>");
  });

  it("omits an unspecified read key so ingest remains the read fallback", () => {
    expect(plist).not.toContain("SEORAK_READ_KEY");
  });

  it("bakes an escaped distinct read key", () => {
    const p = buildLaunchAgentPlist({
      nodeBin: "/node",
      daemonPath: "/d.mjs",
      workerUrl: "http://x",
      stdoutPath: "/o",
      stderrPath: "/e",
      stateDir: "/state",
      ingestKey: "write",
      readKey: "read<&",
    });
    expect(p).toContain("<key>SEORAK_READ_KEY</key>");
    expect(p).toContain("<string>read&lt;&amp;</string>");
  });

  it("bakes an explicit blank read key instead of falling back to ingest", () => {
    const p = buildLaunchAgentPlist({
      nodeBin: "/node",
      daemonPath: "/d.mjs",
      workerUrl: "http://x",
      stdoutPath: "/o",
      stderrPath: "/e",
      stateDir: "/state",
      ingestKey: "write",
      readKey: "",
    });
    expect(p).toContain(
      "<key>SEORAK_READ_KEY</key>\n\t\t<string></string>",
    );
  });
});

describe("resolveInitCredentials", () => {
  it("preserves distinct previous keys on a flagless re-init", () => {
    expect(
      resolveInitCredentials({}, {}, {
        ingestKey: "previous-write",
        readKey: "previous-read",
      }),
    ).toEqual({
      ingestKey: "previous-write",
      readKey: "previous-read",
      readAccessKey: "previous-read",
    });
  });

  it("uses flags before env and previous plist values", () => {
    expect(
      resolveInitCredentials(
        { "ingest-key": "flag-write", "read-key": "flag-read" },
        {
          SEORAK_INGEST_KEY: "env-write",
          SEORAK_READ_KEY: "env-read",
        },
        { ingestKey: "previous-write", readKey: "previous-read" },
      ),
    ).toEqual({
      ingestKey: "flag-write",
      readKey: "flag-read",
      readAccessKey: "flag-read",
    });
  });

  it("uses environment before previous plist values", () => {
    expect(
      resolveInitCredentials(
        {},
        {
          SEORAK_INGEST_KEY: "env-write",
          SEORAK_READ_KEY: "env-read",
        },
        { ingestKey: "previous-write", readKey: "previous-read" },
      ),
    ).toEqual({
      ingestKey: "env-write",
      readKey: "env-read",
      readAccessKey: "env-read",
    });
  });

  it("retains the one-token model when no read key was configured", () => {
    expect(
      resolveInitCredentials(
        { "ingest-key": "write" },
        {},
        { ingestKey: null, readKey: null },
      ),
    ).toEqual({
      ingestKey: "write",
      readAccessKey: "write",
    });
  });

  it("preserves an explicit blank read key through re-init", () => {
    expect(
      resolveInitCredentials(
        { "read-key": "" },
        { SEORAK_INGEST_KEY: "write", SEORAK_READ_KEY: "env-read" },
        { ingestKey: "old-write", readKey: "old-read" },
      ),
    ).toEqual({
      ingestKey: "write",
      readKey: "",
      readAccessKey: "",
    });
  });

  it("preserves a blank read key already baked in the previous plist", () => {
    expect(
      resolveInitCredentials(
        {},
        {},
        { ingestKey: "previous-write", readKey: "" },
      ),
    ).toEqual({
      ingestKey: "previous-write",
      readKey: "",
      readAccessKey: "",
    });
  });
});

describe("initVerificationPassed", () => {
  const passing = {
    hooksOk: true,
    serviceRequired: true,
    serviceLoaded: true,
    connectionRequested: true,
    readOk: true,
    ingestOk: true,
  };

  it("requires both read and ingest authority once a connection was requested", () => {
    expect(initVerificationPassed(passing)).toBe(true);
    expect(
      initVerificationPassed({ ...passing, readOk: false }),
    ).toBe(false);
    expect(
      initVerificationPassed({ ...passing, ingestOk: false }),
    ).toBe(false);
  });

  it("succeeds with no worker at all — Free is complete without one", () => {
    expect(
      initVerificationPassed({
        ...passing,
        connectionRequested: false,
        readOk: false,
        ingestOk: false,
      }),
    ).toBe(true);
  });

  it("still requires the hooks that ARE the capture path", () => {
    expect(
      initVerificationPassed({
        ...passing,
        connectionRequested: false,
        readOk: false,
        ingestOk: false,
        hooksOk: false,
      }),
    ).toBe(false);
  });

  it("requires launchd only when the install requested it", () => {
    expect(
      initVerificationPassed({ ...passing, serviceLoaded: false }),
    ).toBe(false);
    expect(
      initVerificationPassed({
        ...passing,
        serviceRequired: false,
        serviceLoaded: false,
      }),
    ).toBe(true);
  });
});

describe("dashboardUrl", () => {
  it("points a local worker at the Vite dev server (no bundled UI locally)", () => {
    expect(dashboardUrl("http://localhost:8787")).toBe("http://localhost:5173");
    expect(dashboardUrl("http://127.0.0.1:8787")).toBe("http://localhost:5173");
  });

  it("uses the worker URL itself for a deployed worker (it serves the dashboard)", () => {
    expect(dashboardUrl("https://seorak-worker.example.workers.dev")).toBe(
      "https://seorak-worker.example.workers.dev",
    );
  });
});

describe("evaluateHooks", () => {
  it("ok when all six events are bound", () => {
    const settings = mergeHooks({}, "/bin").settings;
    const check = evaluateHooks(settings);
    expect(check.ok).toBe(true);
    expect(check.present).toHaveLength(6);
    expect(check.missing).toEqual([]);
  });

  it("not-ok and names the gap on a partial file (missing PostToolUseFailure)", () => {
    const settings = mergeHooks({}, "/bin").settings;
    const partial = { ...settings, hooks: { ...(settings.hooks as Record<string, unknown>) } };
    delete (partial.hooks as Record<string, unknown>).PostToolUseFailure;
    const check = evaluateHooks(partial);
    expect(check.ok).toBe(false);
    expect(check.present).toHaveLength(5);
    expect(check.missing).toEqual(["PostToolUseFailure"]);
  });

  it("not-ok with all six missing on an empty/null settings object", () => {
    expect(evaluateHooks({}).ok).toBe(false);
    expect(evaluateHooks(null).missing).toHaveLength(6);
  });
});

describe("evaluateService", () => {
  it("ok only when the plist is present AND launchctl-loaded", () => {
    expect(evaluateService(true, true).ok).toBe(true);
    expect(evaluateService(true, false).ok).toBe(false);
    expect(evaluateService(false, false).ok).toBe(false);
  });

  it("reports plistPresent and loaded faithfully", () => {
    const c = evaluateService(true, false);
    expect(c.plistPresent).toBe(true);
    expect(c.loaded).toBe(false);
    expect(c.unsupported).toBe(false);
  });

  it("is N/A (ok, unsupported) on a non-macOS platform", () => {
    const c = evaluateService(false, false, false);
    expect(c.ok).toBe(true);
    expect(c.unsupported).toBe(true);
  });
});

describe("evaluateEventsLog", () => {
  const NOW = 1_000_000_000_000;

  it("not-ok and not-present when the log is absent", () => {
    const c = evaluateEventsLog(null, NOW);
    expect(c.present).toBe(false);
    expect(c.ok).toBe(false);
    expect(c.ageMs).toBeNull();
  });

  it("ok when present and modified within the freshness window", () => {
    const c = evaluateEventsLog(NOW - 60_000, NOW);
    expect(c.present).toBe(true);
    expect(c.fresh).toBe(true);
    expect(c.ok).toBe(true);
    expect(c.ageMs).toBe(60_000);
  });

  it("present-but-not-fresh (ok=false) when older than the stale threshold", () => {
    const c = evaluateEventsLog(NOW - (EVENTS_LOG_STALE_MS + 1), NOW);
    expect(c.present).toBe(true);
    expect(c.fresh).toBe(false);
    expect(c.ok).toBe(false);
  });
});

describe("evaluateHeartbeat (FOLLOW-UP #4 — wedged-daemon liveness)", () => {
  const NOW = 1_000_000_000_000;

  it("not-ok and not-present when there is no heartbeat (never started)", () => {
    const c = evaluateHeartbeat(null, NOW);
    expect(c.present).toBe(false);
    expect(c.ok).toBe(false);
    expect(c.ageMs).toBeNull();
  });

  it("ok (alive) when the last beat is within the freshness window", () => {
    const c = evaluateHeartbeat(NOW - 30_000, NOW);
    expect(c.present).toBe(true);
    expect(c.fresh).toBe(true);
    expect(c.ok).toBe(true);
    expect(c.ageMs).toBe(30_000);
  });

  it("present-but-stale (ok=false → WEDGED) when the last beat is too old", () => {
    const c = evaluateHeartbeat(NOW - (HEARTBEAT_STALE_MS + 1), NOW);
    expect(c.present).toBe(true);
    expect(c.fresh).toBe(false);
    expect(c.ok).toBe(false);
  });

  it("treats a future-dated beat (clock skew) as fresh, not a failure", () => {
    const c = evaluateHeartbeat(NOW + 5_000, NOW);
    expect(c.ok).toBe(true);
  });
});

describe("isDaemonWedged — loaded-but-stale only (no fresh-install false alarm)", () => {
  const loaded = { ok: true, plistPresent: true, loaded: true, unsupported: false };
  const notLoaded = { ok: false, plistPresent: true, loaded: false, unsupported: false };
  const unsupported = { ok: true, plistPresent: false, loaded: false, unsupported: true };

  it("WEDGED when service loaded + heartbeat present but stale", () => {
    const stale = { ok: false, present: true, fresh: false, ageMs: 999_999 };
    expect(isDaemonWedged(loaded, stale)).toBe(true);
  });

  it("NOT wedged when the heartbeat is absent (just loaded, hasn't beaten yet)", () => {
    // The fresh-install race: launchctl reports loaded before the daemon writes
    // its first beat. Absent must NOT fail the exit code.
    const absent = { ok: false, present: false, fresh: false, ageMs: null };
    expect(isDaemonWedged(loaded, absent)).toBe(false);
  });

  it("NOT wedged when the heartbeat is fresh (healthy)", () => {
    const fresh = { ok: true, present: true, fresh: true, ageMs: 5_000 };
    expect(isDaemonWedged(loaded, fresh)).toBe(false);
  });

  it("NOT wedged when the service is not loaded / unsupported", () => {
    const stale = { ok: false, present: true, fresh: false, ageMs: 999_999 };
    expect(isDaemonWedged(notLoaded, stale)).toBe(false);
    expect(isDaemonWedged(unsupported, stale)).toBe(false);
  });
});

/**
 * status.test.ts — the status command's PURE report builder, the codex evaluator, and
 * the (fetch-injected) worker probe. The report is asserted as rendered lines
 * because the lines ARE the product surface: glyph tier (✓/✘ critical, •
 * informational), remedy-on-every-✘, and the exit verdict.
 */
import { describe, expect, it } from "vitest";
import { servicedDaemonProgram } from "../src/launchd.ts";
import {
  evaluateRuntime,
  buildStatusReport,
  evaluateCodex,
  evaluateEventsLog,
  evaluateHeartbeat,
  evaluateHooks,
  evaluateService,
  probeWorker,
  probeWorkerIngestAuthority,
  type StatusReportInput,
} from "../src/status.ts";
import { SEORAK_EVENTS } from "../src/install.ts";
import { SHIPPING_STATUS_SCHEMA_VERSION } from "../src/shipping-status.ts";

const N = SEORAK_EVENTS.length;

/** A fully healthy input; tests override single legs. */
function healthy(): StatusReportInput {
  const nowMs = Date.now();
  return {
    nowMs,
    settingsPath: "/home/u/.claude/settings.json",
    settingsValid: true,
    hooks: { ok: true, present: [...SEORAK_EVENTS], missing: [] },
    staleHookPaths: [],
    service: evaluateService(true, true, true),
    platformName: "darwin",
    label: "app.seorak.collector",
    heartbeat: evaluateHeartbeat(nowMs - 3_000, nowMs),
    connected: true,
    workerUrl: "https://w.example",
    worker: { ok: true, status: 200, authRejected: false },
    ingest: { ok: true, status: 400, authRejected: false },
    localPlaneUrl: "http://127.0.0.1:4317/dashboard",
    shipping: {
      kind: "current",
      snapshot: {
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "caught-up",
        updatedAt: new Date(nowMs).toISOString(),
        consecutiveFailures: 0,
      },
    },
    rejections: { kind: "current", generation: 3, count: 0 },
    captureFailure: { kind: "missing" },
    events: evaluateEventsLog(nowMs - 1_000, nowMs),
    codex: "tailing",
    codexRoot: "/home/u/.codex/sessions",
  };
}

describe("evaluateRuntime and the plist it reads", () => {
  const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>app.seorak.collector</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/opt/homebrew/lib/node_modules/seorak/dist/daemon.mjs</string>
  </array>
</dict></plist>`;

  it("reads the daemon entry by what it is, not by its position", () => {
    expect(servicedDaemonProgram("/p.plist", () => PLIST)).toBe(
      "/opt/homebrew/lib/node_modules/seorak/dist/daemon.mjs",
    );
  });

  it("says nothing rather than guessing when the plist cannot be read", () => {
    expect(
      servicedDaemonProgram("/p.plist", () => {
        throw new Error("gone");
      }),
    ).toBeNull();
  });

  it("flags a daemon installed under a directory the OS may reclaim", () => {
    // The real one: an install test in a session scratchpad became the service.
    const check = evaluateRuntime({
      daemonPath:
        "/private/tmp/claude-501/abc/scratchpad/installtest/node_modules/seorak/dist/daemon.mjs",
      daemonVersion: "0.1.0",
      cliVersion: "0.1.1",
    });
    expect(check.ephemeral).toBe(true);
  });

  it("does not flag a durable install, even one pinned to another version", () => {
    const check = evaluateRuntime({
      daemonPath: "/opt/homebrew/lib/node_modules/seorak/dist/daemon.mjs",
      daemonVersion: "0.1.0",
      cliVersion: "0.1.1",
    });
    expect(check.ephemeral).toBe(false);
  });

  it("fails the run and names the path when the daemon is ephemeral", () => {
    const report = buildStatusReport({
      ...healthy(),
      runtime: evaluateRuntime({
        daemonPath: "/private/tmp/x/dist/daemon.mjs",
        daemonVersion: "0.1.0",
        cliVersion: "0.1.1",
      }),
    });
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toContain(
      "✘ runtime — daemon 0.1.0 runs from a temporary directory",
    );
  });

  it("notes a version split without failing, since a pin can be deliberate", () => {
    const report = buildStatusReport({
      ...healthy(),
      runtime: evaluateRuntime({
        daemonPath: "/opt/homebrew/lib/node_modules/seorak/dist/daemon.mjs",
        daemonVersion: "0.1.0",
        cliVersion: "0.1.1",
      }),
    });
    expect(report.ok).toBe(true);
    expect(report.lines.join("\n")).toContain(
      "• runtime — daemon 0.1.0 differs from this CLI 0.1.1",
    );
  });
});

describe("buildStatusReport — a caught-up cursor is not a delivery", () => {
  // The eight-day outage this pins: the managed plane acknowledged the local
  // mirror, the cursor reached the end of the log, and every drain returned
  // without error. `caught-up` was true about the CURSOR and said nothing about
  // whether anything reached the worker, so the check stayed green throughout.
  function withRoute(route: "worker" | "managed" | "local") {
    const input = healthy();
    return buildStatusReport({
      ...input,
      shipping: {
        kind: "current",
        snapshot: {
          schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
          state: "caught-up",
          updatedAt: new Date(Date.parse("2026-08-12T00:00:00.000Z")).toISOString(),
          consecutiveFailures: 0,
          route,
        },
      },
    });
  }

  it("refuses the delivered wording when nothing left the machine", () => {
    const text = withRoute("local").lines.join("\n");
    expect(text).toContain(
      "• shipping — nothing delivered; complete history stays on this machine",
    );
    expect(text).not.toContain("event backlog caught up");
  });

  it("names managed sync rather than implying a POST that never happens", () => {
    const text = withRoute("managed").lines.join("\n");
    expect(text).toContain("✓ shipping — managed sync current");
    expect(text).not.toContain("event backlog caught up");
  });

  it("keeps the delivered wording for the route that actually posts", () => {
    expect(withRoute("worker").lines.join("\n")).toContain(
      "✓ shipping — event backlog caught up",
    );
  });
});

describe("buildStatusReport — healthy", () => {
  const report = buildStatusReport(healthy());
  it("passes and says so", () => {
    expect(report.ok).toBe(true);
    expect(report.lines.at(-1)).toBe("✅ all critical checks pass");
  });
  it("renders every critical line with ✓ and the codex/events tiers", () => {
    const text = report.lines.join("\n");
    expect(text).toContain(`✓ hooks — ${N}/${N} bound`);
    expect(text).toContain("✓ service — launchd loaded (app.seorak.collector)");
    expect(text).toContain("✓ daemon — alive");
    expect(text).toContain("✓ worker reads — https://w.example reachable");
    expect(text).toContain("✓ worker ingest — authority accepted");
    expect(text).toContain("✓ shipping — event backlog caught up");
    expect(text).toContain(
      "• capture contract — no rejected records in current log generation 3",
    );
    expect(text).toContain(
      "• capture continuity — no hook contention gaps recorded",
    );
    expect(text).toContain("• codex — tailing /home/u/.codex/sessions");
    expect(text).toContain("✓ events — log fresh");
  });
});

describe("buildStatusReport — hooks leg", () => {
  it("missing events fail with the exact gap and the init remedy", () => {
    const input = healthy();
    input.hooks = { ok: false, present: SEORAK_EVENTS.slice(1), missing: [SEORAK_EVENTS[0]!] };
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    const line = report.lines.find((l) => l.startsWith("✘ hooks"))!;
    expect(line).toContain(`${N - 1}/${N} bound`);
    expect(line).toContain(`missing ${SEORAK_EVENTS[0]}`);
    expect(line).toContain("seorak setup");
  });
  it("stale script paths fail even at 6/6 bound (moved checkout)", () => {
    const input = healthy();
    input.staleHookPaths = [{ event: "SessionStart", path: "/old/checkout/bin/hook-session-start.mjs" }];
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    const line = report.lines.find((l) => l.startsWith("✘ hooks"))!;
    expect(line).toContain("/old/checkout/bin/hook-session-start.mjs");
    expect(line).toContain("re-point");
  });
  it("unparseable settings fail with the path named", () => {
    const input = healthy();
    input.settingsValid = false;
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    expect(report.lines.find((l) => l.startsWith("✘ hooks"))).toContain(input.settingsPath);
  });
  // Version-scoped runtime dirs made "the script exists" stop meaning "the
  // script is current": nothing prunes the old one, so an upgrade could leave
  // hooks on the previous build while the service ran the new one. Existence
  // alone reported a healthy 6/6 the whole time.
  it("hooks that exist but belong to another install fail at 6/6 bound", () => {
    const input = healthy();
    input.skewedHookPaths = [
      {
        event: "SessionStart",
        path: "/home/u/.seorak/runtime/0.1.2/node_modules/seorak/dist/hook-session-start.mjs",
      },
    ];
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    const line = report.lines.find((l) => l.startsWith("✘ hooks"))!;
    expect(line).toContain("runtime/0.1.2");
    expect(line).toContain("different install than the service");
    expect(line).toContain("re-point");
  });
  // An npx on-ramp puts nothing on PATH, so a checklist that says `seorak …` is
  // a dead end for exactly the install most likely to be reading it.
  it("names the command this reader can actually run", () => {
    const input = healthy();
    input.hooks = { ok: false, present: [], missing: [...SEORAK_EVENTS] };
    input.invocation = "npx seorak";
    const line = buildStatusReport(input).lines.find((l) => l.startsWith("✘ hooks"))!;
    expect(line).toContain("npx seorak setup");
  });
});

describe("buildStatusReport — service and daemon legs", () => {
  it("non-mac is informational, not a failure", () => {
    const input = healthy();
    input.service = evaluateService(false, false, false);
    input.platformName = "linux";
    const report = buildStatusReport(input);
    expect(report.ok).toBe(true);
    expect(report.lines.find((l) => l.includes("service"))).toMatch(/^• service — N\/A on linux/);
  });
  it("missing plist and unloaded plist carry distinct remedies", () => {
    const a = healthy();
    a.service = evaluateService(false, false, true);
    expect(buildStatusReport(a).lines.join("\n")).toContain("✘ service — not installed. Run `seorak setup`.");
    const b = healthy();
    b.service = evaluateService(true, false, true);
    expect(buildStatusReport(b).lines.join("\n")).toContain("✘ service — installed but not loaded. Run `seorak start`.");
  });
  it("absent heartbeat is informational; wedged (loaded + stale) is critical", () => {
    const absent = healthy();
    absent.heartbeat = evaluateHeartbeat(null, Date.now());
    const absentReport = buildStatusReport(absent);
    expect(absentReport.ok).toBe(true);
    expect(absentReport.lines.join("\n")).toContain("• daemon — no heartbeat yet");

    const wedged = healthy();
    wedged.heartbeat = evaluateHeartbeat(Date.now() - 10 * 60_000, Date.now());
    const wedgedReport = buildStatusReport(wedged);
    expect(wedgedReport.ok).toBe(false);
    expect(wedgedReport.lines.join("\n")).toContain("likely wedged");
    expect(wedgedReport.lines.join("\n")).toContain("launchctl kickstart");
  });
  it("stale heartbeat WITHOUT a loaded service stays informational", () => {
    const input = healthy();
    input.service = evaluateService(false, false, false); // foreground platform
    input.heartbeat = evaluateHeartbeat(Date.now() - 10 * 60_000, Date.now());
    const report = buildStatusReport(input);
    expect(report.ok).toBe(true);
    expect(report.lines.join("\n")).toContain("• daemon — heartbeat stale");
  });
});

describe("buildStatusReport — worker leg", () => {
  it("401 is 'locked', never 'unreachable', and names the key remedy", () => {
    const input = healthy();
    input.worker = { ok: false, status: 401, authRejected: true };
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    const line = report.lines.find((l) => l.startsWith("✘ worker reads"))!;
    expect(line).not.toContain("unreachable");
    expect(line).toContain("401");
    expect(line).toContain("SEORAK_READ_KEY");
    expect(line).toContain("--read-key");
  });
  it("a network failure reports unreachable with the resolver remedies", () => {
    const input = healthy();
    input.worker = { ok: false, authRejected: false, error: "fetch failed" };
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    const line = report.lines.find((l) => l.startsWith("✘ worker reads"))!;
    expect(line).toContain("unreachable (fetch failed)");
    expect(line).toContain("--worker-url");
  });

  it("fails when ingest authority is rejected before any delivery attempt", () => {
    const input = healthy();
    input.ingest = { ok: false, status: 401, authRejected: true };
    input.shipping = { kind: "missing" };
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    const line = report.lines.find((value) =>
      value.startsWith("✘ worker ingest"),
    )!;
    expect(line).toContain("SEORAK_INGEST_KEY");
    expect(line).toContain("--ingest-key");
  });
});

describe("buildStatusReport — durable shipping leg", () => {
  it("keeps a scheduled transient retry visible without failing the install", () => {
    const input = healthy();
    input.shipping = {
      kind: "current",
      snapshot: {
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "retrying",
        updatedAt: new Date(input.nowMs).toISOString(),
        consecutiveFailures: 2,
        nextRetryAt: new Date(input.nowMs + 60_000).toISOString(),
        httpStatus: 503,
      },
    };
    const report = buildStatusReport(input);
    expect(report.ok).toBe(true);
    expect(report.lines.join("\n")).toContain(
      "• shipping — backlog retry in 1m after HTTP 503",
    );
  });

  it("fails on a permanent worker rejection with a concrete remedy", () => {
    const input = healthy();
    input.shipping = {
      kind: "current",
      snapshot: {
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "blocked",
        updatedAt: new Date(input.nowMs).toISOString(),
        consecutiveFailures: 1,
        nextRetryAt: new Date(input.nowMs + 15 * 60_000).toISOString(),
        httpStatus: 401,
      },
    };
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    const line = report.lines.find((value) => value.startsWith("✘ shipping"))!;
    expect(line).toContain("HTTP 401");
    expect(line).toContain("slow recovery probe is due in 15m");
    expect(line).toContain("ingest key");
  });

  it("names proven and legacy schema blocks without inventing worker versions", () => {
    const proven = healthy();
    proven.shipping = {
      kind: "current",
      snapshot: {
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "blocked",
        updatedAt: new Date(proven.nowMs).toISOString(),
        consecutiveFailures: 1,
        protocol: {
          code: "unsupported_schema_version",
          emittedSchemaVersion: 1,
          workerAcceptedSchemaVersions: [2],
        },
      },
    };
    expect(buildStatusReport(proven).lines.join("\n")).toContain(
      "collector emits event schema 1, but worker accepts 2",
    );

    const legacy = healthy();
    legacy.shipping = {
      kind: "current",
      snapshot: {
        schemaVersion: SHIPPING_STATUS_SCHEMA_VERSION,
        state: "blocked",
        updatedAt: new Date(legacy.nowMs).toISOString(),
        consecutiveFailures: 1,
        protocol: {
          code: "unsupported_schema_version",
          emittedSchemaVersion: 1,
        },
      },
    };
    const line = buildStatusReport(legacy).lines.find((value) =>
      value.startsWith("✘ shipping"),
    )!;
    expect(line).toContain("did not advertise accepted versions");
    expect(line).not.toContain("worker accepts");
  });

  it("distinguishes a fresh install from corrupt local delivery state", () => {
    const missing = healthy();
    missing.shipping = { kind: "missing" };
    expect(buildStatusReport(missing).ok).toBe(true);
    expect(buildStatusReport(missing).lines.join("\n")).toContain(
      "no delivery attempt recorded yet",
    );

    const invalid = healthy();
    invalid.shipping = { kind: "invalid" };
    expect(buildStatusReport(invalid).ok).toBe(false);
    expect(buildStatusReport(invalid).lines.join("\n")).toContain(
      "local delivery status is invalid",
    );
  });
});

describe("buildStatusReport — local event validation", () => {
  it("fails the checklist when the current generation rejected records", () => {
    const input = healthy();
    input.rejections = {
      kind: "current",
      generation: 4,
      count: 12,
    };
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    const line = report.lines.find((value) =>
      value.startsWith("✘ capture contract"),
    )!;
    expect(line).toContain("12 locally captured record(s)");
    expect(line).toContain("generation 4");
    expect(line).toContain("@seorak/types");
  });

  it("fails closed when the rejection checkpoint cannot be read", () => {
    const input = healthy();
    input.rejections = { kind: "unreadable", generation: 5 };
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toContain(
      "rejection checkpoint for log generation 5 cannot be read",
    );
  });
});

describe("buildStatusReport — hook capture continuity", () => {
  it("fails on a durable lock-timeout marker without claiming a count", () => {
    const input = healthy();
    input.captureFailure = {
      kind: "current",
      snapshot: {
        schemaVersion: 1,
        reason: "event-log-lock-timeout",
        recordedAt: "2026-07-29T12:00:00.000Z",
      },
    };
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    const line = report.lines.find((value) =>
      value.startsWith("✘ capture continuity"),
    )!;
    expect(line).toContain("one or more hook events");
    expect(line).toContain("capture-failure.json");
    expect(line).not.toContain("1 hook event");
  });

  it("fails closed on an invalid marker", () => {
    const input = healthy();
    input.captureFailure = { kind: "invalid" };
    const report = buildStatusReport(input);
    expect(report.ok).toBe(false);
    expect(report.lines.join("\n")).toContain(
      "local capture-failure marker is invalid",
    );
  });
});

describe("buildStatusReport — informational legs never flip the verdict", () => {
  it("codex off / no-root and a stale or missing events log still pass", () => {
    for (const codex of ["off", "no-root"] as const) {
      for (const events of [evaluateEventsLog(null, Date.now()), evaluateEventsLog(Date.now() - 48 * 3600_000, Date.now())]) {
        const input = healthy();
        input.codex = codex;
        input.events = events;
        const report = buildStatusReport(input);
        expect(report.ok).toBe(true);
        expect(report.lines.filter((l) => l.startsWith("✘"))).toEqual([]);
      }
    }
  });
  it("codex states render their three distinct lines", () => {
    const tail = buildStatusReport(healthy()).lines.join("\n");
    expect(tail).toContain("• codex — tailing");
    const off = healthy();
    off.codex = "off";
    expect(buildStatusReport(off).lines.join("\n")).toContain("• codex — off (SEORAK_CODEX=0)");
    const missing = healthy();
    missing.codex = "no-root";
    expect(buildStatusReport(missing).lines.join("\n")).toContain("• codex — nothing at /home/u/.codex/sessions");
  });
});

describe("evaluateCodex", () => {
  it("maps the three worlds", () => {
    expect(evaluateCodex(false, true)).toBe("off");
    expect(evaluateCodex(false, false)).toBe("off");
    expect(evaluateCodex(true, true)).toBe("tailing");
    expect(evaluateCodex(true, false)).toBe("no-root");
  });
});

describe("evaluateHooks", () => {
  it("still reports the six-event gap set", () => {
    const check = evaluateHooks({});
    expect(check.ok).toBe(false);
    expect(check.missing).toHaveLength(N);
  });
});

describe("probeWorker — fetch injected", () => {
  const mkFetch = (status: number): typeof fetch =>
    (async () => ({ ok: status >= 200 && status < 300, status })) as unknown as typeof fetch;

  it("200 → ok", async () => {
    expect(await probeWorker("https://w.example", undefined, mkFetch(200))).toEqual({
      ok: true,
      status: 200,
      authRejected: false,
    });
  });
  it("401/403 → authRejected, other statuses not", async () => {
    expect((await probeWorker("https://w.example", "tok", mkFetch(401))).authRejected).toBe(true);
    expect((await probeWorker("https://w.example", "tok", mkFetch(403))).authRejected).toBe(true);
    expect((await probeWorker("https://w.example", "tok", mkFetch(500))).authRejected).toBe(false);
  });
  it("sends the Bearer token and probes /live (the fast gated head) without doubling slashes", async () => {
    let seenUrl = "";
    let seenAuth: string | undefined;
    const spy: typeof fetch = (async (url: string, init?: RequestInit) => {
      seenUrl = String(url);
      seenAuth = (init?.headers as Record<string, string> | undefined)?.authorization;
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    await probeWorker("https://w.example/", "sekrit", spy);
    expect(seenUrl).toBe("https://w.example/live");
    expect(seenAuth).toBe("Bearer sekrit");
  });
  it("maps an abort to a plain timed-out message", async () => {
    const abort: typeof fetch = (async () => {
      const e = new Error("This operation was aborted");
      e.name = "AbortError";
      throw e;
    }) as unknown as typeof fetch;
    const res = await probeWorker("https://w.example", undefined, abort);
    expect(res.error).toBe("timed out after 8s");
  });
  it("a thrown fetch resolves to unreachable with the message", async () => {
    const boom: typeof fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await probeWorker("https://w.example", undefined, boom)).toEqual({
      ok: false,
      authRejected: false,
      error: "ECONNREFUSED",
    });
  });
});

describe("probeWorkerIngestAuthority — fetch injected", () => {
  const response = (status: number, body: unknown): Response =>
    ({
      status,
      json: async () => body,
    }) as Response;

  it("proves a correct or open ingest path with the exact no-write rejection", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const spy: typeof fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return response(400, {
        error: "event batch rejected",
        code: "invalid_batch",
      });
    }) as typeof fetch;

    expect(
      await probeWorkerIngestAuthority(
        "https://w.example/",
        "write-secret",
        spy,
      ),
    ).toEqual({ ok: true, status: 400, authRejected: false });
    expect(seen[0]?.url).toBe("https://w.example/events");
    expect(seen[0]?.init).toMatchObject({
      method: "POST",
      body: '{"schemaVersion":1}',
      headers: {
        "content-type": "application/json",
        authorization: "Bearer write-secret",
      },
    });
  });

  it("reports a rejected ingest key separately", async () => {
    const unauthorized: typeof fetch = (async () =>
      response(401, { error: "unauthorized" })) as typeof fetch;
    expect(
      await probeWorkerIngestAuthority(
        "https://w.example",
        "wrong",
        unauthorized,
      ),
    ).toEqual({ ok: false, status: 401, authRejected: true });
  });

  it("fails closed on a non-Seorak 400 or a surprising success", async () => {
    const wrongBody: typeof fetch = (async () =>
      response(400, { error: "other" })) as typeof fetch;
    const success: typeof fetch = (async () =>
      response(204, null)) as typeof fetch;
    expect(
      (
        await probeWorkerIngestAuthority(
          "https://w.example",
          undefined,
          wrongBody,
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await probeWorkerIngestAuthority(
          "https://w.example",
          undefined,
          success,
        )
      ).ok,
    ).toBe(false);
  });
});

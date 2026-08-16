/**
 * status.ts — `seorak status`: the ✓/✗ checklist answering
 * "is it actually working?", extracted from cli.ts so the checklist assembly is
 * a PURE, unit-tested function instead of untested console glue (the two P0s
 * this surface shipped with — probing the wrong worker URL and probing an
 * owner-locked worker without its token — both lived in that glue).
 *
 * Contract:
 *   - Worker URL + access token resolve through worker-url.ts `resolveTargets`,
 *     the SAME path the live session uses. `--worker-url` and SEORAK_WORKER_URL
 *     now work here exactly as they do for `seorak`.
 *   - Three glyph tiers, one meaning each: ✓ a passing critical check, ✘ a
 *     failing critical check (these decide the exit code), • informational.
 *   - Every ✘ carries its remedy in the same line.
 *   - Exit 0 iff hooks (bound, valid JSON, no stale paths) + service (mac) +
 *     worker reads + worker ingest authority + daemon-not-wedged all hold.
 *     Heartbeat-absent, events-log staleness, and the codex line never fail the
 *     exit code; they are reported for the eye, not for CI.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { collectorVersion } from "./terminal/news-store.ts";
import { platform } from "node:os";
import {
  bearerHeader,
  parseEventIngestErrorResponse,
  seorakRoutes,
} from "@seorak/types";
import {
  readCaptureFailure,
  type CaptureFailureRead,
} from "./capture-failure.ts";
import { codexSessionsRoot, codexTailEnabled } from "./codex-tailer.ts";
import { loadSavedConnection } from "./connection.ts";
import {
  readCurrentEventRejections,
  type CurrentEventRejections,
} from "./event-rejections.ts";
import { SEORAK_EVENTS, defaultSettingsPath, presentEvents, seorakHookPaths } from "./install.ts";
import { BINARY_INVOCATION, currentCollectorInvocation } from "./invocation.ts";
import { launchdServiceLoaded, servicedDaemonProgram } from "./launchd.ts";
import { LAUNCHD_LABEL, eventsLogPath, heartbeatPath, launchAgentPlistPath } from "./paths.ts";
import {
  readShippingStatus,
  type ShippingStatusRead,
} from "./shipping-status.ts";
import { DEFAULT_LOCAL_PLANE_PORT } from "./local-plane.ts";
import {
  hasWorkerConnection,
  resolveIngestToken,
  resolveTargets,
} from "./worker-url.ts";

/** The port the daemon serves the loopback plane on, so status names the same
 *  URL the daemon logs. */
function localPlanePort(): number {
  const raw = Number.parseInt(process.env.SEORAK_LOCAL_PLANE_PORT ?? "", 10);
  return Number.isSafeInteger(raw) && raw >= 1 && raw <= 65_535
    ? raw
    : DEFAULT_LOCAL_PLANE_PORT;
}

/** Consider the events log "stale" past this age (the daemon flushes far more
 *  often, so a fresh-but-old mtime means nothing has been captured lately). */
export const EVENTS_LOG_STALE_MS = 24 * 60 * 60 * 1000;
/** Consider the daemon heartbeat "stale" past this age (FOLLOW-UP #4). The daemon
 *  beats every 30s, so 90s tolerates two missed ticks before status calls it
 *  wedged — long enough to avoid a false alarm, short enough to catch a real hang. */
export const HEARTBEAT_STALE_MS = 90 * 1000;

// ---------------------------------------------------------------------------
// PURE evaluators (unit-tested directly)
// ---------------------------------------------------------------------------

export interface HookCheck {
  ok: boolean;
  present: string[];
  missing: string[];
}

/**
 * evaluateHooks — PURE. Given a parsed settings object (or null), report which of
 * the six Seorak events are present. ok only when all six are bound — a 5/6 file
 * (e.g. missing PostToolUseFailure) reports ok=false and names the gap.
 */
export function evaluateHooks(settings: unknown): HookCheck {
  const { present, missing } = presentEvents(settings ?? {});
  return { ok: missing.length === 0, present, missing };
}

export interface ServiceCheck {
  ok: boolean;
  plistPresent: boolean;
  loaded: boolean;
  /** Set when the platform has no launchd service path (non-macOS). */
  unsupported: boolean;
}

/**
 * evaluateService — PURE. Given the plist-present flag and the launchctl-loaded
 * flag, decide whether the background service is healthy. On a non-macOS platform
 * (`supported=false`) the service is N/A, so ok=true (the user runs `seorak start`
 * in the foreground instead — it is not a failure).
 */
export function evaluateService(plistPresent: boolean, loaded: boolean, supported = true): ServiceCheck {
  if (!supported) {
    return { ok: true, plistPresent, loaded, unsupported: true };
  }
  return { ok: plistPresent && loaded, plistPresent, loaded, unsupported: false };
}

export interface EventsLogCheck {
  ok: boolean;
  present: boolean;
  fresh: boolean;
  ageMs: number | null;
}

/**
 * evaluateEventsLog — PURE. Given the log's mtime (ms, or null when absent) and
 * "now", report present + fresh (modified within EVENTS_LOG_STALE_MS). A missing
 * log is not-ok; a present-but-stale log is present-but-not-fresh (ok=false) so
 * status can say "no events captured recently". Informational either way — a
 * quiet week is not a broken install.
 */
export function evaluateEventsLog(mtimeMs: number | null, nowMs: number, staleMs = EVENTS_LOG_STALE_MS): EventsLogCheck {
  if (mtimeMs === null) {
    return { ok: false, present: false, fresh: false, ageMs: null };
  }
  const ageMs = nowMs - mtimeMs;
  const fresh = ageMs <= staleMs;
  return { ok: fresh, present: true, fresh, ageMs };
}

export interface HeartbeatCheck {
  ok: boolean;
  present: boolean;
  fresh: boolean;
  ageMs: number | null;
}

/**
 * evaluateHeartbeat — PURE (FOLLOW-UP #4). Given the heartbeat's written epoch-ms
 * (or null when absent) and "now", report present + fresh (beaten within
 * HEARTBEAT_STALE_MS). This is the REAL daemon-liveness signal: launchd's KeepAlive
 * restarts only on process EXIT, so a loaded-but-hung daemon shows a STALE
 * heartbeat (present, not fresh → ok=false), distinct from a never-started daemon
 * (absent → ok=false) and a healthy one (fresh → ok=true). A future-dated beat
 * (clock skew) reads as fresh rather than failing.
 */
export function evaluateHeartbeat(writtenMs: number | null, nowMs: number, staleMs = HEARTBEAT_STALE_MS): HeartbeatCheck {
  if (writtenMs === null) {
    return { ok: false, present: false, fresh: false, ageMs: null };
  }
  const ageMs = nowMs - writtenMs;
  const fresh = ageMs <= staleMs;
  return { ok: fresh, present: true, fresh, ageMs };
}

/**
 * isDaemonWedged — PURE (FOLLOW-UP #4 review fixup). A loaded launchd service whose
 * heartbeat is PRESENT-BUT-STALE is genuinely hung (launchd reports it "loaded"
 * while it hangs) → wedged. An ABSENT heartbeat is NOT wedged: a just-loaded daemon
 * hasn't written its first beat yet (a race right after `seorak setup`), so absent
 * reads as "still starting", reported but never failing the exit code. On a
 * platform with no launchd (foreground), the heartbeat is informational only.
 */
export function isDaemonWedged(service: ServiceCheck, heartbeat: HeartbeatCheck): boolean {
  return !service.unsupported && service.loaded && heartbeat.present && !heartbeat.fresh;
}

export type CodexState = "tailing" | "off" | "no-root";

/** evaluateCodex — PURE. The tailer is invisible plumbing (default on, kill
 *  switch SEORAK_CODEX=0), so status states which of the three worlds this
 *  machine is in. Always informational: an absent ~/.codex is not a failure. */
export function evaluateCodex(enabled: boolean, rootExists: boolean): CodexState {
  if (!enabled) return "off";
  return rootExists ? "tailing" : "no-root";
}

export interface WorkerProbe {
  ok: boolean;
  status?: number;
  /** The worker answered, but rejected the (missing or wrong) access token. A
   *  distinct state from unreachable: the network is fine, the key is not. */
  authRejected: boolean;
  error?: string;
}

/** Human age like "42s" / "3m" / "5h" / "2d". */
export function formatAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// ---------------------------------------------------------------------------
// The probe (impure, fetch injectable for tests)
// ---------------------------------------------------------------------------

/** Probe <workerUrl>/live with the SAME auth the board sends, so status
 *  proves the actual read path. /live (the KV head the session polls every 3s)
 *  rather than /overview: it exercises the same read gate but answers in
 *  milliseconds, where a cold /overview build is legitimately multi-second and
 *  made the probe's timeout fire on a perfectly healthy worker. Never throws.
 *  A 401/403 reports authRejected (reachable but locked) rather than the
 *  misleading "unreachable". */
export async function probeWorker(
  workerUrl: string,
  token?: string,
  fetchFn: typeof fetch = fetch,
): Promise<WorkerProbe> {
  const url = `${workerUrl.replace(/\/$/, "")}${seorakRoutes.live()}`;
  const timeoutMs = 8000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: bearerHeader(token),
      });
      if (res.ok) return { ok: true, status: res.status, authRejected: false };
      return { ok: false, status: res.status, authRejected: res.status === 401 || res.status === 403 };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const e = err as Error;
    const message = e.name === "AbortError" ? `timed out after ${timeoutMs / 1000}s` : e.message;
    return { ok: false, authRejected: false, error: message };
  }
}

/**
 * Prove that POST /events accepts the configured ingest authority without
 * writing product data. Authentication runs before request parsing; once
 * authorized, the deliberately incomplete v1 batch must reach Seorak's closed
 * parser and return its exact `invalid_batch` response. Everything else fails
 * closed, including a surprising 2xx.
 */
export async function probeWorkerIngestAuthority(
  workerUrl: string,
  token?: string,
  fetchFn: typeof fetch = fetch,
): Promise<WorkerProbe> {
  const url = `${workerUrl.replace(/\/$/, "")}${seorakRoutes.events()}`;
  const timeoutMs = 8000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...bearerHeader(token),
        },
        body: '{"schemaVersion":1}',
      });
      if (res.status === 400) {
        const parsed = parseEventIngestErrorResponse(
          await res.json().catch(() => null),
        );
        if (parsed?.code === "invalid_batch") {
          return { ok: true, status: res.status, authRejected: false };
        }
      }
      return {
        ok: false,
        status: res.status,
        authRejected: res.status === 401 || res.status === 403,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const e = err as Error;
    const message =
      e.name === "AbortError"
        ? `timed out after ${timeoutMs / 1000}s`
        : e.message;
    return { ok: false, authRejected: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// The report (PURE — the whole checklist as data in, lines + verdict out)
// ---------------------------------------------------------------------------

export interface StatusReportInput {
  nowMs: number;
  activeHome?: { name: string; kind: "personal" | "workspace" };
  settingsPath: string;
  /** false when the settings file exists but is not parseable JSON. */
  settingsValid: boolean;
  hooks: HookCheck;
  /** Bound Seorak scripts whose file no longer exists (moved checkout). */
  staleHookPaths: Array<{ event: string; path: string }>;
  /**
   * Bound Seorak scripts that exist but belong to a DIFFERENT install than the
   * one the service runs. Version-scoped runtime directories made this possible:
   * the previous version's hook scripts are still on disk after an upgrade, so
   * an existence check alone reports a healthy 6/6 while capture is split across
   * two builds. Optional so a caller built before this field keeps compiling.
   */
  skewedHookPaths?: Array<{ event: string; path: string }>;
  service: ServiceCheck;
  /** Optional so a caller built before this field keeps compiling; absent simply
   *  prints no runtime line. */
  runtime?: RuntimeCheck;
  platformName: string;
  label: string;
  heartbeat: HeartbeatCheck;
  /**
   * Whether this install was explicitly pointed at a worker. A local-only
   * install is a HEALTHY install, not an incomplete one: Free is complete from
   * the machine's own record, so worker reachability is reported (and can fail
   * the exit code) only for an install that asked for a connection.
   */
  connected: boolean;
  workerUrl: string;
  /** Null on a local-only install, where there is nothing to probe. */
  worker: WorkerProbe | null;
  ingest: WorkerProbe | null;
  /**
   * How THIS reader runs Seorak — `seorak` for an install on PATH, `npx …` for
   * an npx on-ramp that put nothing there. Optional so a caller built before
   * this field keeps compiling, defaulting to the binary form.
   */
  invocation?: string;
  /** Where the primary dashboard reads from on this machine. */
  localPlaneUrl: string;
  shipping: ShippingStatusRead;
  rejections: CurrentEventRejections;
  captureFailure: CaptureFailureRead;
  events: EventsLogCheck;
  codex: CodexState;
  codexRoot: string;
}

export interface StatusReport {
  lines: string[];
  ok: boolean;
}

/**
 * buildStatusReport — PURE. Assembles the full checklist (including the verdict
 * line) from evaluated checks. Glyph contract: ✓/✘ are the critical checks that
 * decide `ok` (and the exit code); • lines are informational and never fail it.
 */
export function buildStatusReport(input: StatusReportInput): StatusReport {
  const lines: string[] = [];
  const totalEvents = SEORAK_EVENTS.length;
  // Every remedy below has to name a command this reader can type. An npx
  // on-ramp installs nothing on PATH, so a hardcoded `seorak …` was a dead end
  // for precisely the install most likely to need the checklist.
  const cmd = input.invocation ?? BINARY_INVOCATION;

  if (input.activeHome) {
    lines.push(
      `• home — ${input.activeHome.name} (${input.activeHome.kind === "workspace" ? "Shared workspace" : "Personal"})`,
    );
  }

  // hooks (critical): valid JSON, all six bound, none pointing at a dead path.
  let hooksOk = false;
  if (!input.settingsValid) {
    lines.push(`✘ hooks — ${input.settingsPath} is not valid JSON. Fix or restore it (look for a .bak next to it), then run \`${cmd} setup\`.`);
  } else if (!input.hooks.ok) {
    const missing = input.hooks.missing.join(", ");
    const pronoun = input.hooks.missing.length === 1 ? "it" : "them";
    lines.push(`✘ hooks — ${input.hooks.present.length}/${totalEvents} bound (missing ${missing}). Run \`${cmd} setup\` to add ${pronoun}.`);
  } else if (input.staleHookPaths.length > 0) {
    const stalePath = input.staleHookPaths[0]!.path;
    lines.push(`✘ hooks — ${totalEvents}/${totalEvents} bound, but they point at a missing checkout (${stalePath}). Run \`${cmd} setup\` from the current checkout to re-point them.`);
  } else if (input.skewedHookPaths && input.skewedHookPaths.length > 0) {
    // Bound, present, and WRONG: the scripts exist, but they belong to a build
    // the service is not running. Capture is split until setup re-points them.
    const skewed = input.skewedHookPaths[0]!.path;
    lines.push(
      `✘ hooks — ${totalEvents}/${totalEvents} bound, but they run a different install than the service (${skewed}). Run \`${cmd} setup\` to re-point them.`,
    );
  } else {
    hooksOk = true;
    lines.push(`✓ hooks — ${totalEvents}/${totalEvents} bound`);
  }

  // service (critical on mac, N/A elsewhere)
  if (input.service.unsupported) {
    lines.push(`• service — N/A on ${input.platformName} (run \`${cmd} start --foreground\`)`);
  } else if (input.service.ok) {
    lines.push(`✓ service — launchd loaded (${input.label})`);
  } else if (!input.service.plistPresent) {
    lines.push(`✘ service — not installed. Run \`${cmd} setup\`.`);
  } else {
    lines.push(`✘ service — installed but not loaded. Run \`${cmd} start\`.`);
  }

  // Which build the service actually runs. The CLI and the daemon are separate
  // installs and can silently disagree; saying so costs one line and saves
  // reading source that the running build does not contain.
  if (input.runtime && input.runtime.daemonPath !== null) {
    const version = input.runtime.daemonVersion ?? "unknown version";
    if (input.runtime.ephemeral) {
      lines.push(
        `✘ runtime — daemon ${version} runs from a temporary directory that may be deleted: ${input.runtime.daemonPath}. Reinstall it somewhere durable.`,
      );
    } else if (
      input.runtime.daemonVersion !== null &&
      input.runtime.daemonVersion !== input.runtime.cliVersion
    ) {
      lines.push(
        `• runtime — daemon ${version} differs from this CLI ${input.runtime.cliVersion} (${input.runtime.daemonPath})`,
      );
    } else {
      lines.push(`• runtime — daemon ${version} (${input.runtime.daemonPath})`);
    }
  }

  // daemon liveness (heartbeat): wedged is critical, the rest informational.
  const wedged = isDaemonWedged(input.service, input.heartbeat);
  if (!input.heartbeat.present) {
    lines.push(`• daemon — no heartbeat yet (it appears within 30s of the daemon starting)`);
  } else if (input.heartbeat.fresh) {
    lines.push(`✓ daemon — alive (heartbeat ${formatAge(input.heartbeat.ageMs!)} ago)`);
  } else if (wedged) {
    lines.push(`✘ daemon — heartbeat stale (last beat ${formatAge(input.heartbeat.ageMs!)} ago); likely wedged. Restart with \`launchctl kickstart -k gui/$(id -u)/${input.label}\`.`);
  } else {
    lines.push(`• daemon — heartbeat stale (last beat ${formatAge(input.heartbeat.ageMs!)} ago); the daemon does not look like it is running.`);
  }

  // The local record is the product on this machine, connected or not.
  lines.push(`• local — complete history on this machine, dashboard at ${input.localPlaneUrl}`);

  // worker reads and ingest are critical ONLY for an install that opted into a
  // connection. A local-only install reports the absence informationally.
  const worker = input.worker;
  const ingest = input.ingest;
  let connectionOk = true;
  if (!input.connected || worker === null || ingest === null) {
    lines.push(
      `• connection — none configured. Run \`${cmd} login\`, or \`${cmd} setup --worker-url URL\` for a worker you operate.`,
    );
  } else {
    if (worker.ok) {
      lines.push(`✓ worker reads — ${input.workerUrl} reachable`);
    } else if (worker.authRejected) {
      connectionOk = false;
      lines.push(`✘ worker reads — ${input.workerUrl} answered ${worker.status}: no valid read authority is set. Set SEORAK_READ_KEY, or re-run \`${cmd} setup\` with --read-key.`);
    } else {
      connectionOk = false;
      const why = worker.error ?? `HTTP ${worker.status}`;
      lines.push(`✘ worker reads — ${input.workerUrl} unreachable (${why}). Check the URL, or point me with --worker-url / SEORAK_WORKER_URL.`);
    }

    // The credential reached the closed event parser, but the deliberately
    // invalid probe could not persist product data.
    if (ingest.ok) {
      lines.push("✓ worker ingest — authority accepted");
    } else if (ingest.authRejected) {
      connectionOk = false;
      lines.push(
        `✘ worker ingest — worker answered ${ingest.status}: no valid ingest authority is set. Set SEORAK_INGEST_KEY, or re-run \`${cmd} setup\` with --ingest-key.`,
      );
    } else {
      connectionOk = false;
      const why = ingest.error ?? `HTTP ${ingest.status}`;
      lines.push(
        `✘ worker ingest — authority could not be verified (${why}). Check the worker and ingest configuration.`,
      );
    }
  }

  // Durable event delivery. A transient retry is visible but not yet a failed
  // install; a permanent 4xx or corrupt status contract is critical.
  let shippingOk = true;
  if (input.shipping.kind === "missing") {
    lines.push(
      input.connected
        ? "• shipping — no delivery attempt recorded yet"
        : "• shipping — nothing to ship, capture stays on this machine",
    );
  } else if (input.shipping.kind === "invalid") {
    shippingOk = false;
    lines.push(
      "✘ shipping — local delivery status is invalid. Restart the collector to rebuild it.",
    );
  } else if (input.shipping.snapshot.state === "caught-up") {
    // "caught-up" means the cursor reached the end of the log, which is NOT the
    // same as "the worker has it". A local acknowledgement moves the cursor
    // without posting anything, so reporting a delivery here is how a total
    // outage read healthy for eight days. Only a route that left this machine
    // earns the delivered wording.
    const route = input.shipping.snapshot.route;
    if (route === "local") {
      lines.push(
        "• shipping — nothing delivered; complete history stays on this machine",
      );
    } else if (route === "managed") {
      lines.push("✓ shipping — managed sync current");
    } else {
      lines.push("✓ shipping — event backlog caught up");
    }
  } else if (input.shipping.snapshot.state === "retrying") {
    const waitMs = Math.max(
      0,
      Date.parse(input.shipping.snapshot.nextRetryAt) - input.nowMs,
    );
    const status =
      input.shipping.snapshot.httpStatus === undefined
        ? ""
        : ` after HTTP ${input.shipping.snapshot.httpStatus}`;
    lines.push(
      `• shipping — backlog retry in ${formatAge(waitMs)}${status}`,
    );
  } else {
    shippingOk = false;
    const status =
      input.shipping.snapshot.httpStatus === undefined
        ? ""
        : ` (HTTP ${input.shipping.snapshot.httpStatus})`;
    const retry =
      input.shipping.snapshot.nextRetryAt === undefined
        ? ""
        : ` The next slow recovery probe is due in ${formatAge(
            Math.max(
              0,
              Date.parse(input.shipping.snapshot.nextRetryAt) - input.nowMs,
            ),
          )}.`;
    const protocol = input.shipping.snapshot.protocol;
    if (protocol?.code === "unsupported_schema_version") {
      const incompatibility =
        protocol.workerAcceptedSchemaVersions === undefined
          ? `worker rejected collector event schema ${protocol.emittedSchemaVersion} and did not advertise accepted versions`
          : `collector emits event schema ${protocol.emittedSchemaVersion}, but worker accepts ${protocol.workerAcceptedSchemaVersions.join(", ")}`;
      lines.push(
        `✘ shipping — ${incompatibility}${status}.${retry} Upgrade the worker and collector to compatible releases.`,
      );
    } else if (protocol) {
      lines.push(
        `✘ shipping — worker rejected the event protocol (${protocol.code})${status}.${retry} Upgrade the worker and collector to compatible releases.`,
      );
    } else {
      lines.push(
        `✘ shipping — event backlog is blocked${status}.${retry} Check the ingest key and collector/worker versions.`,
      );
    }
  }

  const captureContractOk =
    input.rejections.kind === "current" && input.rejections.count === 0;
  if (
    input.rejections.kind === "current" &&
    input.rejections.count === 0
  ) {
    lines.push(
      `• capture contract — no rejected records in current log generation ${input.rejections.generation}`,
    );
  } else if (input.rejections.kind === "unreadable") {
    lines.push(
      `✘ capture contract — the local rejection checkpoint for log generation ${input.rejections.generation} cannot be read. Check the collector directory permissions, then restart the collector.`,
    );
  } else {
    lines.push(
      `✘ capture contract — ${input.rejections.count} locally captured record(s) in current log generation ${input.rejections.generation} could not be validated. Your collector and @seorak/types event contract disagree; upgrade both or file these counts.`,
    );
  }

  const captureContinuityOk = input.captureFailure.kind === "missing";
  if (input.captureFailure.kind === "missing") {
    lines.push("• capture continuity — no hook contention gaps recorded");
  } else if (input.captureFailure.kind === "invalid") {
    lines.push(
      "✘ capture continuity — the local capture-failure marker is invalid. Check capture-failure.json and collector directory permissions before clearing it.",
    );
  } else {
    lines.push(
      `✘ capture continuity — one or more hook events were not recorded after event-log contention (evidence recorded at ${input.captureFailure.snapshot.recordedAt}). Fix the competing writer, then remove capture-failure.json after acknowledging the gap.`,
    );
  }

  // codex (informational)
  if (input.codex === "tailing") {
    lines.push(`• codex — tailing ${input.codexRoot} (set SEORAK_CODEX=0 to turn off)`);
  } else if (input.codex === "off") {
    lines.push(`• codex — off (SEORAK_CODEX=0)`);
  } else {
    lines.push(`• codex — nothing at ${input.codexRoot} on this machine`);
  }

  // events log (informational: a quiet day is not a broken install)
  if (!input.events.present) {
    lines.push(`• events — no log yet (created on your first session)`);
  } else if (input.events.fresh) {
    lines.push(`✓ events — log fresh (last write ${formatAge(input.events.ageMs!)} ago)`);
  } else {
    lines.push(`• events — no writes in ${formatAge(input.events.ageMs!)} (nothing captured lately)`);
  }

  const ok =
    hooksOk &&
    input.service.ok &&
    connectionOk &&
    shippingOk &&
    // A daemon in a directory the OS may reclaim is a capture outage waiting to
    // happen, so it fails the run rather than merely noting itself.
    !(input.runtime?.ephemeral ?? false) &&
    captureContractOk &&
    captureContinuityOk &&
    !wedged;
  lines.push("");
  lines.push(ok ? "✅ all critical checks pass" : "✘ something is not wired (see above)");
  return { lines, ok };
}

// ---------------------------------------------------------------------------
// Impure glue (thin: read the world, evaluate, print)
// ---------------------------------------------------------------------------

function isMac(): boolean {
  return platform() === "darwin";
}

/** True if launchctl currently lists the Seorak label. Shells out — call only
 *  from a subcommand. Returns false on any non-macOS / launchctl error. */
export function launchctlLoaded(label: string = LAUNCHD_LABEL): boolean {
  return launchdServiceLoaded(label);
}

/** Read + parse the settings file, returning {} when absent and null when the
 *  file exists but is unparseable (status surfaces that as a broken hooks check). */
export function loadSettings(settingsPath: string): Record<string, unknown> | null {
  if (!existsSync(settingsPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** mtime in ms of the events log, or null when absent. */
function eventsLogMtime(): number | null {
  const path = eventsLogPath();
  if (!existsSync(path)) return null;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** The epoch-ms the daemon last wrote to its heartbeat file, or null when absent
 *  or unparseable. The CONTENT (not the mtime) is the timestamp, so an unrelated
 *  touch can't masquerade as a live beat. */
function heartbeatWrittenMs(): number | null {
  const path = heartbeatPath();
  if (!existsSync(path)) return null;
  try {
    const n = Number(readFileSync(path, "utf8").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export interface RuntimeCheck {
  /** The daemon entry the plist names, or null when it could not be read. */
  daemonPath: string | null;
  /** The `seorak` version that path resolves to, when discoverable. */
  daemonVersion: string | null;
  /** This process's own version, for the comparison. */
  cliVersion: string;
  /** The daemon lives somewhere the OS may delete out from under it. */
  ephemeral: boolean;
}

/** Directories an OS or a tool may reclaim while the daemon is still running.
 *  A collector installed into one of these keeps working right up until it
 *  silently does not, and capture is the product. */
const EPHEMERAL_ROOTS = ["/tmp/", "/private/tmp/", "/var/folders/"];

/**
 * evaluateRuntime — PURE. Whether the service runs a build this CLI can reason
 * about, and whether it runs it from somewhere durable.
 *
 * Neither answer is a failure on its own: a deliberate version pin is legitimate,
 * and so is running a published build while the CLI is linked to a checkout. An
 * EPHEMERAL path is different, because nothing about it is deliberate for long.
 */
export function evaluateRuntime(input: {
  daemonPath: string | null;
  daemonVersion: string | null;
  cliVersion: string;
}): RuntimeCheck {
  const ephemeral =
    input.daemonPath !== null &&
    EPHEMERAL_ROOTS.some((root) => input.daemonPath!.startsWith(root));
  return { ...input, ephemeral };
}

/**
 * The `seorak` version owning a daemon entry point, by walking up to
 * the nearest `package.json`. Null when there is none to read, which is the
 * honest answer for a daemon run straight out of a source tree.
 */
function packageVersionFor(daemonPath: string): string | null {
  let dir = dirname(daemonPath);
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const raw = readFileSync(join(dir, "package.json"), "utf8");
      const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
      if (typeof parsed.version === "string") return parsed.version;
    } catch {
      // Keep walking: a dist/ or bin/ directory legitimately has no manifest.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** `seorak status`. Accepts the session's flags so
 *  `--worker-url` works here too. Returns the process exit code. */
export async function cmdStatus(flags: Record<string, string | boolean> = {}): Promise<number> {
  const nowMs = Date.now();
  const plistPath = launchAgentPlistPath();
  const savedConnection = loadSavedConnection();
  const targets = resolveTargets(
    flags,
    process.env,
    plistPath,
    savedConnection,
  );

  const settingsPath = defaultSettingsPath();
  const settings = loadSettings(settingsPath);
  const hooks = evaluateHooks(settings);
  const boundHookPaths = settings === null ? [] : seorakHookPaths(settings);
  const staleHookPaths = boundHookPaths.filter((p) => !existsSync(p.path));

  const service = evaluateService(existsSync(plistPath), launchctlLoaded(), isMac());
  const daemonPath = servicedDaemonProgram(plistPath, (path: string) =>
    readFileSync(path, "utf8"),
  );
  // A hook script that EXISTS can still be the wrong one. Version-scoped runtime
  // directories are not pruned, so after an upgrade the previous build's hooks
  // are still on disk next to the new ones; only comparing them against the
  // daemon the service actually runs tells the two apart.
  const daemonBinDir = daemonPath === null ? null : dirname(daemonPath);
  const skewedHookPaths =
    daemonBinDir === null
      ? []
      : boundHookPaths.filter(
          (p) => existsSync(p.path) && dirname(p.path) !== daemonBinDir,
        );
  const runtime = evaluateRuntime({
    daemonPath,
    daemonVersion: daemonPath === null ? null : packageVersionFor(daemonPath),
    cliVersion: collectorVersion(),
  });
  const heartbeat = evaluateHeartbeat(heartbeatWrittenMs(), nowMs);
  const connected = hasWorkerConnection(
    flags,
    process.env,
    plistPath,
    savedConnection,
  );
  const worker = connected
    ? await probeWorker(targets.workerUrl, targets.accessToken)
    : null;
  const ingest = connected
    ? await probeWorkerIngestAuthority(
        targets.workerUrl,
        resolveIngestToken(process.env, plistPath, savedConnection),
      )
    : null;
  const shipping = readShippingStatus();
  const rejections = await readCurrentEventRejections();
  const captureFailure = readCaptureFailure();
  const events = evaluateEventsLog(eventsLogMtime(), nowMs);
  const codexRoot = codexSessionsRoot();
  const codex = evaluateCodex(codexTailEnabled(), existsSync(codexRoot));

  const report = buildStatusReport({
    nowMs,
    ...(savedConnection?.home
      ? {
          activeHome: {
            name: savedConnection.home.name,
            kind: savedConnection.home.kind,
          },
        }
      : {}),
    settingsPath,
    settingsValid: settings !== null,
    hooks,
    staleHookPaths,
    skewedHookPaths,
    invocation: currentCollectorInvocation(),
    service,
    runtime,
    platformName: platform(),
    label: LAUNCHD_LABEL,
    heartbeat,
    connected,
    workerUrl: targets.workerUrl,
    worker,
    ingest,
    localPlaneUrl: `http://127.0.0.1:${localPlanePort()}/dashboard`,
    shipping,
    rejections,
    captureFailure,
    events,
    codex,
    codexRoot,
  });

  console.log("seorak status\n");
  for (const line of report.lines) console.log(line);
  return report.ok ? 0 : 1;
}

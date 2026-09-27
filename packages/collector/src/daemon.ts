import { watch } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { appendEvent } from "./append.ts";
import { syncCaptureSettings } from "./capture-settings.ts";
import { codexTailEnabled, sweepCodexRollouts } from "./codex-tailer.ts";
import {
  acquireDaemonLease,
  collectorCaptureRevoked,
  resolveCollectorLifecyclePaths,
} from "./collector-lifecycle.ts";
import { saveWatchState, sweepCommitAttribution } from "./commit-watcher.ts";
import { rotateDaemonLogIfNeeded } from "./daemon-log.ts";
import { EventDeliveryLoop } from "./delivery-loop.ts";
import {
  acknowledgeLocalEventMirror,
  drainManagedCompactSync,
} from "./compact-sync.ts";
import { boundedIntOr, MAX_TIMER_MS } from "./env-numbers.ts";
import {
  loadSavedConnection,
  type SavedConnection,
} from "./connection.ts";
import {
  compactAcknowledgedEventLog,
  eventLogNeedsCompaction,
  readEventLogGeneration,
  recoverAcknowledgedEventLogs,
} from "./event-log.ts";
import { advanceEventRejectionCheckpoint } from "./event-rejections.ts";
import { currentCollectorInvocation } from "./invocation.ts";
import { momentumEnabled } from "./git.ts";
import { getDeviceId } from "./identity.ts";
import {
  createCompatibilityCheckedDrain,
  WorkerIngestCompatibilityGate,
} from "./ingest-compatibility.ts";
import {
  drainEventQueue,
  type DrainEventQueueResult,
} from "./ingest-queue.ts";
import { ledgerSize, syncLedger } from "./ledger.ts";
import { sweepLocalInterventions } from "./local-intervention.ts";
import { deliverLocalInterventions } from "./local-notify.ts";
import {
  DEFAULT_LOCAL_PLANE_PORT,
  readLocalSettings,
  startLocalPlane,
  startSelfHostedPlane,
  type StartedLocalPlane,
} from "./local-plane.ts";
import { compactSyncActivated, importLegacyEventLog } from "./local-store.ts";
import { readOffset } from "./log-reader.ts";
import {
  collectorDir,
  eventsLogPath,
  heartbeatPath,
  selfHostedCredentialPath,
} from "./paths.ts";
import { resolveSelfHostedBinding } from "./plane-binding.ts";
import {
  addConfigRepo,
  listRegisteredRepos,
  registerConfiguredRepos,
  removeConfigRepo,
  sweepRegistryMomentum,
} from "./registry.ts";
import {
  markPendingEmitted,
  pendingFromAttribution,
  recordAttributionPending,
  sweepAttributedSurvival,
} from "./survival.ts";
import {
  type ShippingStatusSnapshot,
  writeShippingStatus,
} from "./shipping-status.ts";
import { migrateLegacySessionCursors } from "./session-cursors.ts";
import { collectorVersion } from "./terminal/news-store.ts";
import {
  resolveEnvAccessToken,
  resolveWorkerUrl,
  workerConnectionConfigured,
} from "./worker-url.ts";

const SAVED_CONNECTION = loadSavedConnection();
const WORKER_URL = resolveWorkerUrl({
  env: process.env.SEORAK_WORKER_URL,
  saved: SAVED_CONNECTION?.workerUrl,
});
/**
 * Whether this daemon was pointed at a worker at all. The daemon is launched by
 * the plist it was installed with and reads its own environment, so it stops at
 * the env + saved-connection legs for the same reason `resolveEnvAccessToken`
 * does.
 */
const WORKER_CONFIGURED = workerConnectionConfigured({
  env: process.env.SEORAK_WORKER_URL,
  saved: SAVED_CONNECTION?.workerUrl,
});
/** The loopback plane is part of the installed app, not a server the user
 *  operates. `SEORAK_LOCAL_PLANE=0` is the kill switch. */
const LOCAL_PLANE_ENABLED = process.env.SEORAK_LOCAL_PLANE !== "0";
const LOCAL_PLANE_PORT = boundedIntOr(
  process.env.SEORAK_LOCAL_PLANE_PORT,
  DEFAULT_LOCAL_PLANE_PORT,
  1,
  65_535,
);
const COLLECTOR_VERSION = collectorVersion();

/**
 * daemonTokens — the two Bearer tokens this process sends, and the one place
 * that decides which goes where.
 *
 * `ingestKey` is the shared secret on every POST /events, which the deployed
 * worker's ingest guard enforces (unset on either side keeps local dev open).
 * `readKey` is the owner-lock READ token: GET /settings is gated by
 * `requireReadAuth`, NOT the ingest guard, so an ingest-only key 401s there.
 * Both are baked into the launchd plist by `seorak setup`.
 *
 * The read-key precedence (SEORAK_READ_KEY over SEORAK_INGEST_KEY, the one-token
 * model) lives in worker-url.ts and is resolved there for BOTH consumers. This
 * used to re-derive it inline, which left the read-only-token story two places
 * to change and only one of them documented.
 *
 * ENV-ONLY here on purpose, and that is the one genuine difference from the
 * terminal: the terminal also reads the installed plist because it can run
 * outside the service, while this process is either launched BY that plist (and
 * so inherits its EnvironmentVariables) or started by hand from a shell that
 * exports them. Reading the plist here would hand the daemon a token its own
 * environment does not contain.
 *
 * PURE and exported so the token each call site sends is pinned by test.
 */
export function daemonTokens(
  env: NodeJS.ProcessEnv,
  saved: SavedConnection | null = null,
): {
  ingestKey: string;
  readKey: string;
} {
  const environmentOwnsRead =
    env.SEORAK_READ_KEY !== undefined ||
    env.SEORAK_INGEST_KEY !== undefined;
  return {
    ingestKey: env.SEORAK_INGEST_KEY ?? saved?.ingestToken ?? "",
    readKey: environmentOwnsRead
      ? resolveEnvAccessToken(env) ?? ""
      : saved?.readToken ?? saved?.ingestToken ?? "",
  };
}

const { ingestKey: INGEST_KEY, readKey: READ_KEY } = daemonTokens(
  process.env,
  SAVED_CONNECTION,
);

/** Liveness heartbeat cadence (FOLLOW-UP #4): the keep-alive loop rewrites the
 *  heartbeat file this often so `seorak status` can detect a wedged daemon (launchd
 *  KeepAlive restarts only on EXIT, never on a hang). */
const HEARTBEAT_INTERVAL_MS = 30_000;
const BACKLOG_RETRY_BASE_MS = 30_000;
const BACKLOG_RETRY_MAX_MS = 15 * 60_000;

/**
 * daemonCadences — every env-tunable timer the daemon runs, with its default,
 * its floor, and its ceiling in ONE place.
 *
 * Each was a bare `Number(process.env.X ?? default)`, which is the audited hot
 * loop: `Number("")` is 0, `Number("garbage")` is NaN, and a timer given either
 * fires at ~1ms — so a typo in one variable turned a background cadence into a
 * spin that burned CPU and hammered the worker. The floors below are what a
 * single tick actually costs; the ceiling is the signed-32-bit timer limit,
 * past which Node overflows to that same 1ms (env-numbers.ts). Out of band reads
 * as the documented default, so the effective value is always one a reader can
 * find in the README.
 *
 * PURE and exported so each variable's floor, ceiling, and default are pinned by
 * test rather than by a comment claiming it.
 */
export function daemonCadences(env: NodeJS.ProcessEnv): {
  batchDelayMs: number;
  momentumSweepMs: number;
  settingsSyncMs: number;
  codexPollMs: number;
  compactSyncMs: number;
  interventionSweepMs: number;
} {
  return {
    // Append-to-flush debounce. Floor 1ms: this one is a coalescing window, and
    // the delivery loop serializes the flushes it triggers, so a fast value
    // costs batching, not correctness.
    batchDelayMs: boundedIntOr(env.SEORAK_BATCH_DELAY_MS, 250, 1, MAX_TIMER_MS),
    // Commit-history momentum sweep (default 1h). Each tick walks the local repo
    // registry and emits a git.momentum per repo — catching manual/non-Claude
    // commits. Disabled entirely when SEORAK_MOMENTUM=0. Floor 1s: a tick spawns
    // one git subprocess per registered repo plus a blame per matured session,
    // and sub-second sweeps would spend the machine on work the re-entrancy
    // guard then throws away.
    momentumSweepMs: boundedIntOr(env.SEORAK_MOMENTUM_SWEEP_MS, 60 * 60 * 1000, 1_000, MAX_TIMER_MS),
    // Data & capture toggle sync: how often the daemon refreshes the local
    // capture.json cache from the worker's GET /settings. One tiny GET per tick,
    // so the 1s floor is about not turning a toggle poll into a load test.
    settingsSyncMs: boundedIntOr(env.SEORAK_SETTINGS_SYNC_MS, 5 * 60 * 1000, 1_000, MAX_TIMER_MS),
    // Codex rollout tail: each tick reads the new
    // complete lines of every rollout file from its persisted byte cursor. 30s
    // staleness is fine for a surface whose sessions the worker reaper closes at
    // 30min; an absent ~/.codex costs one stat per tick. Floor 1s, unchanged
    // from the guard this replaces.
    codexPollMs: boundedIntOr(env.SEORAK_CODEX_POLL_MS, 30_000, 1_000, MAX_TIMER_MS),
    // Managed sync is intentionally coarser than capture. Five minutes is the
    // product budget and also guarantees a quiet dirty session is retried after
    // its debounce becomes due without waiting for another filesystem event.
    compactSyncMs: boundedIntOr(
      env.SEORAK_COMPACT_SYNC_MS,
      5 * 60 * 1000,
      10_000,
      MAX_TIMER_MS,
    ),
    // Intervention sweep (default 5min). Each tick reads the live board and, for
    // a session whose log-derived watches are on, that session's ordered tool
    // calls. Five minutes sits comfortably under the 10-minute `went_cold`
    // default while keeping the per-session scan off the machine's back; a
    // 10-second floor stops a mistyped var from turning a watch into a spin.
    interventionSweepMs: boundedIntOr(
      env.SEORAK_INTERVENTION_SWEEP_MS,
      5 * 60 * 1000,
      10_000,
      MAX_TIMER_MS,
    ),
  };
}

const {
  batchDelayMs: BATCH_DELAY_MS,
  momentumSweepMs: MOMENTUM_SWEEP_MS,
  settingsSyncMs: SETTINGS_SYNC_MS,
  codexPollMs: CODEX_POLL_MS,
  compactSyncMs: COMPACT_SYNC_MS,
  interventionSweepMs: INTERVENTION_SWEEP_MS,
} = daemonCadences(process.env);

let pending = false;
let stopping = false;
let rebindEventLogWatcher: (() => void) | undefined;

/**
 * Everything holding the event loop open, and the one way to let go of it.
 *
 * Shutdown used to clear a fixed list of variables. That is only correct if the
 * signal arrives after startup finished, and it does not have to: launchd, a
 * `seorak stop`, or a machine going to sleep can land in the middle of the boot
 * sequence, when `stop()` sees `undefined` for a watcher and timers that are
 * created moments LATER. The process then had a live `fs.watch` handle and two
 * intervals nobody would ever clear, and it never exited — SIGTERM looked like
 * it worked while the daemon lingered.
 *
 * So a resource registers its own disposal at the moment it is created, and a
 * resource created after shutdown began is disposed immediately rather than
 * recorded. Both directions of the race close.
 */
const disposables: Array<() => void> = [];

function registerDisposable(dispose: () => void): void {
  if (stopping) {
    dispose();
    return;
  }
  disposables.push(dispose);
}

function disposeAll(): void {
  while (disposables.length > 0) {
    try {
      disposables.pop()?.();
    } catch {
      // One resource refusing to close must not strand the rest.
    }
  }
}

/** An interval that is guaranteed to be cleared, whenever shutdown happens. */
function managedInterval(
  handler: () => void,
  everyMs: number,
): void {
  const timer = setInterval(handler, everyMs);
  registerDisposable(() => clearInterval(timer));
}
let daemonLogFailureReported = false;
/** Said once per process: a platform with no notifier is a standing fact, not
 *  an event to repeat every five minutes. */
let localDeliveryUnsupportedReported = false;
let activeNetworkSignal: AbortSignal | undefined;

function maintainDaemonLog(): void {
  try {
    const result = rotateDaemonLogIfNeeded();
    if (result.rotated) {
      console.log(
        `[seorak/collector] rotated local daemon log (${result.bytesArchived} bytes retained)`,
      );
    }
    daemonLogFailureReported = false;
  } catch (error) {
    if (daemonLogFailureReported) return;
    daemonLogFailureReported = true;
    console.error(
      `[seorak/collector] daemon log rotation failed; existing log retained: ${(error as Error).message}`,
    );
  }
}

/** Best-effort liveness heartbeat (FOLLOW-UP #4): record the current epoch-ms so
 *  `seorak status` can tell a live daemon from a wedged one. Never throws — a
 *  heartbeat write failure must not crash or stall the daemon. */
async function writeHeartbeat(): Promise<void> {
  try {
    await writeFile(heartbeatPath(), String(Date.now()), "utf8");
  } catch (error) {
    console.error("[seorak/collector] heartbeat write failed", error);
  }
}

async function persistShippingStatus(
  snapshot: ShippingStatusSnapshot,
): Promise<void> {
  try {
    await writeShippingStatus(snapshot);
  } catch {
    console.error("[seorak/collector] delivery status write failed");
  }
}

async function drainLegacyQueue(): Promise<DrainEventQueueResult> {
  const deviceId = await getDeviceId();
  const result = await drainEventQueue({
    workerUrl: WORKER_URL,
    collectorVersion: COLLECTOR_VERSION,
    deviceId,
    ...(INGEST_KEY ? { ingestKey: INGEST_KEY } : {}),
    ...(activeNetworkSignal ? { signal: activeNetworkSignal } : {}),
    onAccepted: writeHeartbeat,
  });
  if (result.rejectedLocalRecords > 0) {
    console.error(
      `[seorak/collector] ${result.rejectedLocalRecords} locally captured event record(s) could not be validated and were not shipped; run seorak status`,
    );
  }
  return result;
}

async function maintainEventLog(): Promise<void> {
  if (await eventLogNeedsCompaction()) {
    try {
      const ledger = await syncLedger(Date.now());
      const compacted = await compactAcknowledgedEventLog({
        shippingOffset: await readOffset(),
        attributionOffset: ledger.offset,
      });
      if (compacted.compacted) {
        rebindEventLogWatcher?.();
        console.log(
          `[seorak/collector] reclaimed ${compacted.bytesReclaimed} acknowledged event-log bytes (generation ${compacted.generation})`,
        );
        await advanceEventRejectionCheckpoint(compacted.generation);
      }
    } catch (error) {
      console.error("[seorak/collector] event-log rollover failed", error);
    }
  }
}

const flushLegacyOnce = createCompatibilityCheckedDrain({
  gate: new WorkerIngestCompatibilityGate({
    workerUrl: WORKER_URL,
    signal: () => activeNetworkSignal,
  }),
  drain: drainLegacyQueue,
});

const flushOnce = async (): Promise<DrainEventQueueResult> => {
  // An account-free install has nowhere to ship to, and shipping is the ONLY
  // reason the compatibility JSONL mirror exists — `history.sqlite` is the raw
  // authority and already holds every event (ADR 001). So the mirror is
  // acknowledged to its own end and the log is rolled over exactly as an
  // activated compact-sync install does.
  //
  // Without this the daemon would post every batch at a localhost default
  // nobody configured: a permanent retry loop, a `blocked` delivery status, and
  // a `seorak status` that fails a healthy machine. Capture and local reads must
  // not depend on network state, and this is where that stops being a slogan.
  if (!WORKER_CONFIGURED) {
    await acknowledgeLocalEventMirror();
    await maintainEventLog();
    return {
      acceptedEvents: 0,
      acceptedChunks: 0,
      rejectedLocalRecords: 0,
      route: "local",
      blocked: false,
    };
  }
  const managed = await drainManagedCompactSync({
    workerUrl: WORKER_URL,
    installationId: await getDeviceId(),
    ...(INGEST_KEY ? { ingestKey: INGEST_KEY } : {}),
    // The managed plane spans BOTH access classes, so it needs both tokens: the
    // batch/rebaseline POSTs are ingest-gated, the entitlement and data-plane
    // reads are not. Sending only the ingest key made every read 401 on a
    // deployment with a distinct read key, which is the one that stops delivery.
    ...(READ_KEY ? { readKey: READ_KEY } : {}),
    ...(activeNetworkSignal ? { signal: activeNetworkSignal } : {}),
    onAccepted: writeHeartbeat,
  });
  if (managed.kind === "legacy") {
    const result = await flushLegacyOnce();
    if (!result.blocked) await maintainEventLog();
    return result;
  }
  await acknowledgeLocalEventMirror();
  await maintainEventLog();
  // The mirror was just acknowledged, so the cursor has moved past bytes this
  // drain did not post anywhere. That is correct ONLY when a managed cell is
  // actually holding them; otherwise local history is the authority and nothing
  // was delivered. Saying which lets `seorak status` stop reporting a delivery
  // that never happened, which is how a total outage stayed green for days.
  return {
    ...managed.result,
    route: compactSyncActivated() ? "managed" : "local",
  };
};

/**
 * One commit-attribution tick (HEAD-TO-HEAD Tier 2): fold the file-touch ledger forward,
 * attribute every newly-landed commit's files to whichever agent edited them, and record
 * what each session is owed. It EMITS NOTHING — it seeds the records that mature on their
 * own commit clock and are swept into `session.linesurvival` below.
 *
 * This is the machinery that replaces `session.end` as the outcome trigger, and is what
 * makes survival tool-independent: git does not care which tool wrote a line.
 *
 * Never throws: attribution is an observer, and must not be able to take down the sweep
 * that ships events. A failure here degrades to a log line.
 *
 * The log line reports ALL THREE coverage buckets on purpose. `attributed` alone would
 * imply a completeness the capture does not have — a large share of committed lines trace
 * to no agent at all (hand edits, script-written files, capture gaps), and that is a fact
 * to publish, not to hide.
 */
async function runAttributionSweep(nowIso: string): Promise<void> {
  try {
    const nowMs = Date.parse(nowIso);
    const ledger = await syncLedger(nowMs);
    const { results, state } = sweepCommitAttribution(ledger, nowMs);
    saveWatchState(state);

    if (results.length === 0) return;
    const size = ledgerSize(ledger);
    for (const repo of results) {
      for (const session of repo.sessions) {
        recordAttributionPending(pendingFromAttribution(repo, session));
      }

      const byAgent = Object.entries(repo.coverage.byAgent)
        .sort((a, b) => b[1] - a[1])
        .map(([agent, lines]) => `${agent} ${lines}`)
        .join(", ");
      const total =
        Object.values(repo.coverage.byAgent).reduce((a, b) => a + b, 0) +
        repo.coverage.contested +
        repo.coverage.unattributed;
      console.log(
        `[seorak/collector] attribution ${repo.repoLabel}: ${repo.commitsWalked} commit(s), ` +
          `${total} added line(s) → attributed {${byAgent || "none"}}, ` +
          `contested ${repo.coverage.contested}, yours ${repo.coverage.unattributed}; ` +
          `${repo.sessions.length} session(s) credited ` +
          `[ledger ${size.touches} touches / ${size.files} files]`,
      );
    }
  } catch (error) {
    console.error("[seorak/collector] attribution sweep failed", error);
  }
}

const deliveryLoop = new EventDeliveryLoop({
  drain: flushOnce,
  persistStatus: persistShippingStatus,
  retry: {
    baseDelayMs: BACKLOG_RETRY_BASE_MS,
    maxDelayMs: BACKLOG_RETRY_MAX_MS,
    onAttemptError: () => {
      console.error("[seorak/collector] scheduled backlog retry failed");
    },
  },
  onDrainError: () => {
    console.error(
      "[seorak/collector] local event drain failed before delivery; retry scheduled",
    );
  },
});

async function flush(): Promise<void> {
  await deliveryLoop.trigger();
}

function schedule(): void {
  if (pending || stopping) return;
  pending = true;
  setTimeout(async () => {
    pending = false;
    await flush();
  }, BATCH_DELAY_MS);
}

/**
 * `seorak-collector repo <add|list|remove>` — LOCAL repo-list management for
 * portfolio momentum (closes the observed-only registry gap). Returns true when
 * a repo subcommand was handled (so main() exits without starting the watch
 * loop). NEVER prints an absolute path: `add` echoes the basename + masked id,
 * `list` shows label + masked id only.
 */
function handleRepoCli(): boolean {
  const [, , cmd, sub, arg] = process.argv;
  if (cmd !== "repo") return false;
  const now = new Date().toISOString();

  if (sub === "add") {
    if (!arg) {
      console.error("usage: seorak-collector repo add <path>");
      process.exitCode = 1;
      return true;
    }
    const identity = addConfigRepo(arg, now);
    if (!identity) {
      // Echo only the basename, not the absolute path the user typed — upholds the
      // CLI's no-path invariant even on the error path (screenshot/log-safe).
      console.error(`[seorak/collector] not a git repo (or unreadable): ${basename(arg)}`);
      process.exitCode = 1;
      return true;
    }
    console.log(
      `[seorak/collector] added ${identity.repoLabel} (${identity.repoId.slice(0, 8)}…) to portfolio momentum`,
    );
    return true;
  }

  if (sub === "list") {
    const repos = listRegisteredRepos();
    if (repos.length === 0) {
      console.log("[seorak/collector] no repos registered yet");
    } else {
      for (const r of repos) console.log(`  ${r.repoLabel}\t${r.repoIdMasked}`);
    }
    return true;
  }

  if (sub === "remove") {
    if (!arg) {
      console.error("usage: seorak-collector repo remove <label|path>");
      process.exitCode = 1;
      return true;
    }
    const removed = removeConfigRepo(arg);
    console.log(`[seorak/collector] removed ${removed} repo(s) from the config list`);
    return true;
  }

  console.error("usage: seorak-collector repo <add|list|remove> [arg]");
  process.exitCode = 1;
  return true;
}

export async function runDaemon(): Promise<void> {
  const stateDir = collectorDir();
  if (collectorCaptureRevoked(stateDir)) {
    throw new Error(
      `collector capture is disabled after purge; run \`${currentCollectorInvocation()} setup\` to reactivate it.`,
    );
  }

  // Repo-management CLI: handle + exit before starting the watch loop.
  if (handleRepoCli()) return;

  const lifecyclePaths = resolveCollectorLifecyclePaths(stateDir);
  const releaseDaemonLease = acquireDaemonLease(lifecyclePaths);
  if (collectorCaptureRevoked(stateDir)) {
    releaseDaemonLease();
    throw new Error(
      "collector capture was disabled while the daemon was starting.",
    );
  }

  let watcher: ReturnType<typeof watch> | undefined;
  let localPlane: StartedLocalPlane | undefined;
  let selfHostedPlane: StartedLocalPlane | undefined;
  const heartbeatAbort = new AbortController();
  const networkAbort = new AbortController();
  activeNetworkSignal = networkAbort.signal;
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    // `stopping` FIRST, so anything the boot sequence is still about to create
    // registers as already-disposed instead of outliving this call.
    stopping = true;
    heartbeatAbort.abort();
    networkAbort.abort();
    disposeAll();
    stopPromise = (async () => {
      if (selfHostedPlane) {
        await selfHostedPlane.close();
        selfHostedPlane = undefined;
      }
      if (localPlane) {
        await localPlane.close();
        localPlane = undefined;
      }
      await flush();
      deliveryLoop.stop();
      // Startup may have registered a watcher or a timer between the drain
      // above and here; nothing may outlive the drain.
      disposeAll();
    })();
    return stopPromise;
  };
  const onSignal = () => {
    void stop();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    // launchd holds stdout/stderr descriptors open across the process lifetime.
    // Copy-truncate preserves that inode; rename rotation would send all future
    // output into the archived pathname and leave daemon.log empty.
    maintainDaemonLog();
    const historyImport = importLegacyEventLog(eventsLogPath(), stateDir);
    if (historyImport.accepted > 0) {
      console.log(
        `[seorak/collector] imported ${historyImport.accepted} legacy event(s) into permanent local history`,
      );
    }
    if (historyImport.rejected > 0) {
      console.error(
        `[seorak/collector] retained ${historyImport.rejected} invalid legacy record(s) outside local history; run seorak status`,
      );
    }
    const cursorMigration = migrateLegacySessionCursors();
    if (cursorMigration.removed > 0) {
      console.log(
        `[seorak/collector] migrated ${cursorMigration.removed} legacy session cursor file(s) into the transactional store`,
      );
    }
    if (cursorMigration.retained > 0 || cursorMigration.skipped > 0) {
      console.error(
        `[seorak/collector] legacy session cursor migration retained ${cursorMigration.retained} valid and ${cursorMigration.skipped} invalid file(s) for recovery`,
      );
    }
    await recoverAcknowledgedEventLogs();
    await advanceEventRejectionCheckpoint(await readEventLogGeneration());
    if (stopping) return await stop();
    console.log(
      WORKER_CONFIGURED
        ? `[seorak/collector] watching ${eventsLogPath()} → ${WORKER_URL}`
        : `[seorak/collector] watching ${eventsLogPath()} (local only, no worker configured)`,
    );
    // Emit a heartbeat immediately so `seorak status` sees a live daemon the moment
    // the service loads (before the first flush / loop tick).
    await writeHeartbeat();

    // The loopback data plane the primary dashboard reads. It is part of the
    // installed app, so it comes up with capture rather than being a server the
    // user starts. A bound port or a missing permission must never take capture
    // down with it: the failure is reported and the daemon carries on.
    if (LOCAL_PLANE_ENABLED) {
      try {
        localPlane = await startLocalPlane({ port: LOCAL_PLANE_PORT });
        console.log(
          `[seorak/collector] local data plane on ${localPlane.url}${
            localPlane.dashboardUrl === null
              ? " (no dashboard bundle installed)"
              : `, dashboard ${localPlane.dashboardUrl}`
          }`,
        );
        // A refused bundle is not the same as an absent one, and the line above
        // cannot say which without becoming three lines nobody reads. The
        // refusal names itself, on stderr, only when there is one.
        if (localPlane.dashboardRefusal !== null) {
          console.error(`[seorak/collector] ${localPlane.dashboardRefusal}`);
        }
      } catch (error) {
        localPlane = undefined;
        console.error(
          `[seorak/collector] local data plane did not start on port ${LOCAL_PLANE_PORT}`,
          error,
        );
      }
    }

    // The self-hosted binding: the SAME plane on a routable socket, behind a
    // credential and TLS the operator supplied. Off unless all four settings and
    // a minted credential are present, and `resolveSelfHostedBinding` throws
    // rather than returning anything partial — so a misconfiguration lands here
    // as a loud refusal and no routable socket, never as a weaker plane that
    // looks like it is working. Reasoning:
    // docs/reference/self-hosted-plane-hardening.md.
    try {
      const binding = resolveSelfHostedBinding(process.env, {
        credentialPath: selfHostedCredentialPath(stateDir),
        loopbackPort: LOCAL_PLANE_PORT,
      });
      if (binding !== null) {
        selfHostedPlane = await startSelfHostedPlane(binding);
        console.log(
          `[seorak/collector] self-hosted data plane on ${binding.origin} (credential required)`,
        );
      }
    } catch (error) {
      selfHostedPlane = undefined;
      // Capture is never taken down by a remote-access failure, and the loopback
      // plane above is already up. What must not happen is starting anyway.
      console.error(
        `[seorak/collector] self-hosted data plane refused to bind: ${(error as Error).message}`,
      );
    }
    if (stopping) return await stop();
    // The capture toggles have ONE authority per install. On a CONNECTED
    // install that is the worker, and this poll pulls them into the local cache
    // so a toggle flipped on a remote surface reaches every hook process within
    // minutes. On an account-free install there is no worker to ask, and the
    // local plane's own `PUT /settings` writes that cache directly — polling a
    // default localhost URL would only overwrite the user's local choice with
    // nothing.
    if (WORKER_CONFIGURED) {
      await syncCaptureSettings(WORKER_URL, READ_KEY, heartbeatAbort.signal);
      if (stopping) return await stop();
      // Re-entrancy guard, the last of the five ticks in this file to get one.
      // This tick is network-only, so it cannot block the event loop the way a
      // sweep can, and that is why it went without one.
      //
      // The hazard is RESPONSE REORDERING, and it is worth naming precisely
      // because the obvious guess is wrong. The obvious guess is a torn file:
      // two syncs staging through one fixed `<capture-settings>.tmp` and one
      // renaming the other's half-written bytes into place. That cannot happen.
      // `writeFileSync` and `renameSync` are adjacent SYNCHRONOUS calls with no
      // await between them, so two ticks can never interleave inside the pair.
      //
      // What they can do is finish out of order. Two syncs in flight, the older
      // one lands second, and the toggles left on disk are the stale ones, which
      // silently reverts whatever the user most recently changed in whichever
      // direction they changed it. Each overlap is also a duplicate request to a
      // provider that is by hypothesis already slow. A guard costs one boolean.
      let syncingCaptureSettings = false;
      managedInterval(() => {
        if (syncingCaptureSettings) return;
        syncingCaptureSettings = true;
        void syncCaptureSettings(WORKER_URL, READ_KEY, heartbeatAbort.signal)
          .finally(() => {
            syncingCaptureSettings = false;
          });
      }, SETTINGS_SYNC_MS);
    }
    await flush();
    if (stopping) return await stop();
    managedInterval(() => void flush(), COMPACT_SYNC_MS);
    // Pick up user-configured repos (repos.config.json) at startup so portfolio
    // momentum covers un-instrumented repos, not just observed session.start cwds.
    if (momentumEnabled()) registerConfiguredRepos(new Date().toISOString());

    // fs.watch throws ENOENT until the first hook appends a line, and under launchd
    // KeepAlive that throw is a crash loop on a fresh install. Create the empty log
    // (parents included) before watching; append mode leaves an existing log alone.
    const logPath = eventsLogPath();
    await mkdir(dirname(logPath), { recursive: true });
    await writeFile(logPath, "", { flag: "a" });
    const createEventLogWatcher = (): ReturnType<typeof watch> => {
      const created = watch(logPath, { persistent: true }, () => schedule());
      // A persistent fs.watch holds the event loop open by itself, so it is
      // registered the instant it exists — including the rebind after a log
      // rollover, which used to replace the handle shutdown had been told about.
      registerDisposable(() => created.close());
      return created;
    };
    watcher = createEventLogWatcher();
    rebindEventLogWatcher = () => {
      watcher?.close();
      watcher = createEventLogWatcher();
    };

    // Commit-history momentum sweep (Capture Roadmap): periodically emit a
    // git.momentum per registered repo, catching manual/non-Claude commits. The
    // appended events get shipped by the same watch→flush path. The enabled gate
    // sits INSIDE the tick (not around the timer) so the Data & capture toggle
    // takes effect without a daemon restart; SEORAK_MOMENTUM=0 still wins.
    // Re-entrancy guard (the delivery side is serialized by EventDeliveryLoop): the sweep
    // spawns one git subprocess per registered repo + per matured session (blame), so
    // a backlog can outlast the interval. Without this, a second tick would re-walk the
    // same not-yet-pruned cursors and re-append the same deterministic-eventId lines
    // (harmless to the rollup — the D1 PK + read-dedup collapse them — but wasted git
    // work + duplicate local-log writes). Bail if a prior sweep is still running.
    let sweeping = false;
    managedInterval(() => void (async () => {
      if (!momentumEnabled()) return;
      if (sweeping) return;
      sweeping = true;
      try {
        const sweepNow = new Date().toISOString();
        // Re-read the user repo-config each tick so edits are picked up live.
        registerConfiguredRepos(sweepNow);
        const swept = sweepRegistryMomentum(sweepNow);
        for (const event of swept) await appendEvent(event);

        // Attribution FIRST: it folds the ledger and records what each session is owed, so a
        // session whose newest commit just landed is graded against its complete set rather
        // than a stale one.
        await runAttributionSweep(sweepNow);

        // Line-survival sweep: re-check matured sessions' locally-stored commits via
        // on-branch blame and emit session.linesurvival COUNTS (shas/branch/paths never
        // ship). Append DURABLY, THEN mark the record emitted — so a crash in between loses
        // nothing (it re-emits next sweep under the same deterministic eventId, which the D1
        // PK collapses). Same timer; appended events ride the watch→flush path.
        const survived = sweepAttributedSurvival(sweepNow);
        for (const { event, pendingPath } of survived) {
          await appendEvent(event);
          markPendingEmitted(pendingPath, event.eventId);
        }

        const emitted = swept.length + survived.length;
        if (swept.length > 0) {
          console.log(
            `[seorak/collector] momentum sweep emitted ${swept.length} repo snapshot(s)`,
          );
        }
        if (survived.length > 0) {
          console.log(
            `[seorak/collector] survival sweep emitted ${survived.length} session check(s)`,
          );
        }
        if (emitted > 0) schedule();
      } catch (error) {
        console.error("[seorak/collector] momentum sweep failed", error);
      } finally {
        sweeping = false;
      }
    })(), MOMENTUM_SWEEP_MS);

    // Intervention sweep: evaluate the live board against the watches the user
    // configured and RECORD what crossed. It is deliberately separate from the
    // momentum sweep — that one is gated by the capture toggles and spawns git
    // subprocesses, while this one only reads the local database.
    //
    // Recording comes first and delivery second, in that order and never the
    // other way: a recorded fire is the truth about what was measured whether or
    // not a banner ever appeared, so a notifier that is missing or refused
    // permission costs the user the notification and not the history.
    //
    // Never throws out of the tick: a watch engine that can take down the sweep
    // that ships events would cost the user their history to tell them about a
    // cost spike.
    let sweepingInterventions = false;
    managedInterval(() => void (async () => {
      if (sweepingInterventions) return;
      sweepingInterventions = true;
      try {
        const fired = sweepLocalInterventions(readLocalSettings());
        if (fired.length === 0) return;
        const sent = deliverLocalInterventions(fired);
        console.log(
          `[seorak/collector] intervention sweep recorded ${fired.length} fire(s), delivered ${sent.delivered}`,
        );
        // Say it once, and say what is actually true: the fires are recorded and
        // readable, and this machine has no way to show them.
        if (sent.unsupported && !localDeliveryUnsupportedReported) {
          localDeliveryUnsupportedReported = true;
          console.log(
            "[seorak/collector] no desktop notifier on this platform; fires are recorded and readable at /interventions",
          );
        }
      } catch (error) {
        console.error("[seorak/collector] intervention sweep failed", error);
      } finally {
        sweepingInterventions = false;
      }
    })(), INTERVENTION_SWEEP_MS);

    // Codex rollout tail: tail rollout JSONL into events on a
    // short poll. The enabled gate sits INSIDE the tick (like the momentum
    // sweep's) so the SEORAK_CODEX kill switch — and the future capture-settings
    // toggle — take effect without a daemon restart. Re-entrancy-guarded: a
    // first-activation catch-up on a large live rollout can outlast the interval.
    let codexTailing = false;
    managedInterval(() => void (async () => {
      if (!codexTailEnabled()) return;
      if (codexTailing) return;
      codexTailing = true;
      try {
        const emitted = await sweepCodexRollouts(new Date().toISOString());
        if (emitted > 0) {
          console.log(
            `[seorak/collector] codex tail emitted ${emitted} event(s)`,
          );
          schedule();
        }
      } catch (error) {
        console.error("[seorak/collector] codex tail tick failed", error);
      } finally {
        codexTailing = false;
      }
    })(), CODEX_POLL_MS);

    // Keep the process alive even if watch becomes stale, AND emit the liveness
    // heartbeat each tick so `seorak status` can detect a wedged daemon.
    while (!stopping) {
      maintainDaemonLog();
      await writeHeartbeat();
      try {
        await delay(HEARTBEAT_INTERVAL_MS, undefined, {
          signal: heartbeatAbort.signal,
        });
      } catch (error) {
        if (!stopping) throw error;
      }
    }
    await stop();
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    activeNetworkSignal = undefined;
    releaseDaemonLease();
  }
}

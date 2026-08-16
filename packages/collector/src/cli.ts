/**
 * cli.ts — the `seorak` onboarding CLI. One command replaces the manual SETUP.md
 * steps: `seorak setup` installs the six Claude Code hooks (via the shared
 * src/install.ts module), registers a macOS launchd LaunchAgent for the daemon,
 * and verifies the whole chain end-to-end. The status command lives in status.ts;
 * worker URL + access-token resolution lives in
 * worker-url.ts (ONE resolver for every read surface).
 *
 * Design constraints:
 *   - Node built-ins only (node:fs/os/path/child_process) + the shared install
 *     module. No new deps.
 *   - The PURE helpers (here: buildLaunchAgentPlist, dashboardDeepLink; the
 *     status evaluators in status.ts) take plain inputs and are unit-tested
 *     WITHOUT touching launchctl or the real filesystem.
 *   - Every launchctl invocation is guarded inside a subcommand handler — importing
 *     this module (as the tests do) NEVER shells out.
 */
import { isOverviewRangeDays } from "@seorak/types";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  SEORAK_EVENTS,
  defaultSettingsPath,
  installHooks,
  removeHooks,
} from "./install.ts";
import {
  acquireCollectorLifecycleLock,
  activateCollectorState,
  advanceCollectorPurge,
  assertCollectorCanInitialize,
  beginCollectorPurge,
  claimCollectorState,
  collectorCaptureRevoked,
  daemonLeaseStatus,
  hookCaptureLeaseStatus,
  planCollectorPurge,
  purgeCollectorStateDirectory,
  resolveCollectorLifecyclePaths,
  type CollectorLifecyclePaths,
} from "./collector-lifecycle.ts";
import {
  listSavedConnections,
  loadSavedConnection,
  saveConnection,
  selectSavedConnection,
} from "./connection.ts";
import {
  DEFAULT_CONTROL_PLANE_URL,
  loginWithDeviceCode,
} from "./device-login.ts";
import { inspectLaunchdService, stopLaunchdService } from "./launchd.ts";
import { buildLocalReport, exportLocalHistory } from "./local-dashboard.ts";
import {
  DEFAULT_LOCAL_PLANE_PORT,
  dashboardBundleRefusal,
  resolveDashboardBundle,
  startLocalPlane,
} from "./local-plane.ts";
import {
  listLocalSessionPage,
  replayLocalSession,
  type LocalSessionRow,
} from "./local-store.ts";
import { boundedIntOr } from "./env-numbers.ts";
import { collectorExecutableDirectory } from "./package-layout.ts";
import { ensureCollectorRuntime } from "./runtime-install.ts";
import {
  collectorInvocation,
  currentCollectorInvocation,
} from "./invocation.ts";
import { downloadRecoveryBundle } from "./recovery-download.ts";
import { codexSessionsRoot, codexTailEnabled } from "./codex-tailer.ts";
import { dashboardDeepLink } from "./dashboard.ts";
import {
  LAUNCHD_LABEL,
  collectorDir,
  daemonLogPath,
  launchAgentPlistPath,
  selfHostedCredentialPath,
} from "./paths.ts";
import { mintSelfHostedCredential } from "./plane-binding.ts";
import {
  cmdStatus,
  evaluateHooks,
  launchctlLoaded,
  loadSettings,
  probeWorker,
  probeWorkerIngestAuthority,
} from "./status.ts";
import {
  DEFAULT_WORKER_URL,
  hasWorkerConnection,
  resolveReadTargets,
  resolveTargets,
  servicePlistEnv,
  serviceWorkerUrl,
  workerConnectionConfigured,
} from "./worker-url.ts";
import { runInteractive, runOnce, type ShellOptions } from "./terminal/shell.ts";
import {
  DEFAULT_DEMO_SCENARIO,
  isDemoScenarioId,
  type DemoScenarioId,
} from "./terminal/demo/fixtures.ts";

/** Absolute path to the daemon entry owned by this source or package layout. */
export function daemonEntryPath(binDir: string = collectorExecutableDirectory()): string {
  return join(binDir, "daemon.mjs");
}

// ---------------------------------------------------------------------------
// PURE helpers (unit-tested directly)
// ---------------------------------------------------------------------------

export interface PlistOptions {
  nodeBin: string;
  daemonPath: string;
  /** Baked ONLY for an install that opted into a worker. An account-free install
   *  writes no `SEORAK_WORKER_URL`, which is what keeps the daemon, `seorak
   *  status`, and a later re-init from inferring a connection nobody asked for
   *  out of a localhost default. */
  workerUrl?: string;
  stdoutPath: string;
  stderrPath: string;
  /** Canonical absolute collector state directory shared by CLI and daemon. */
  stateDir: string;
  label?: string;
  /** Optional shared-secret the daemon sends as `Authorization: Bearer` on every
   *  /events POST. Baked into the plist env ONLY when the deployed worker enforces
   *  it (SEORAK_INGEST_KEY set there); omitted for an open/local worker. */
  ingestKey?: string;
  /** Optional read authority for terminal and settings GETs. `undefined` omits
   *  the variable and preserves the one-token ingest fallback. An explicit
   *  empty string is baked so the daemon sends no read credential. */
  readKey?: string;
}

/** Escape the five XML predefined entities for safe interpolation into a plist. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * buildLaunchAgentPlist — PURE. Returns the launchd plist XML for the collector
 * daemon: ProgramArguments = [node, daemonPath]; SEORAK_WORKER_URL in the env;
 * RunAtLoad + KeepAlive true; stdout/stderr redirected under the collector dir.
 */
export function buildLaunchAgentPlist(opts: PlistOptions): string {
  const label = opts.label ?? LAUNCHD_LABEL;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${xmlEscape(label)}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xmlEscape(opts.nodeBin)}</string>
		<string>${xmlEscape(opts.daemonPath)}</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>${
    opts.workerUrl
      ? `
		<key>SEORAK_WORKER_URL</key>
		<string>${xmlEscape(opts.workerUrl)}</string>`
      : ""
  }${
    opts.ingestKey
      ? `
		<key>SEORAK_INGEST_KEY</key>
		<string>${xmlEscape(opts.ingestKey)}</string>`
      : ""
  }${
    opts.readKey !== undefined
      ? `
		<key>SEORAK_READ_KEY</key>
		<string>${xmlEscape(opts.readKey)}</string>`
      : ""
  }
		<key>SEORAK_DIR</key>
		<string>${xmlEscape(opts.stateDir)}</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${xmlEscape(opts.stdoutPath)}</string>
	<key>StandardErrorPath</key>
	<string>${xmlEscape(opts.stderrPath)}</string>
</dict>
</plist>
`;
}

// ---------------------------------------------------------------------------
// Side-effecting helpers (called only from subcommand handlers)
// ---------------------------------------------------------------------------

function isMac(): boolean {
  return platform() === "darwin";
}

// `prompt` lived here to ask for a worker URL during `init`. Setup no longer
// asks a question at all — the Free path needs no worker and a managed one is an
// explicit flag — so the helper went with the question rather than waiting for a
// caller that is not coming back.

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string;
  extraPositionals: string[];
  flags: Record<string, string | boolean>;
}

export function resolveInitCredentials(
  flags: Record<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  previous: {
    ingestKey: string | null;
    readKey: string | null;
  },
): {
  ingestKey: string;
  readKey?: string;
  readAccessKey: string;
} {
  const ingestKey =
    typeof flags["ingest-key"] === "string"
      ? flags["ingest-key"]
      : (env.SEORAK_INGEST_KEY ?? previous.ingestKey ?? "");
  const readKey =
    typeof flags["read-key"] === "string"
      ? flags["read-key"]
      : env.SEORAK_READ_KEY !== undefined
        ? env.SEORAK_READ_KEY
        : (previous.readKey ?? undefined);
  return {
    ingestKey,
    ...(readKey !== undefined ? { readKey } : {}),
    readAccessKey: readKey ?? ingestKey,
  };
}

/**
 * What "setup succeeded" means.
 *
 * A Free install is COMPLETE with no account, no key, and no Seorak service:
 * hooks bound and capture running is the whole product on this machine. Worker
 * reachability used to be part of this verdict, which meant a fresh install
 * reported "setup incomplete" for doing exactly what the product promises.
 *
 * A worker is now an explicit opt-in (`--worker-url`, `SEORAK_WORKER_URL`, or a
 * `seorak login` connection), and only THEN may its probes fail the command —
 * because at that point the user asked for a connection and did not get one.
 */
export function initVerificationPassed(checks: {
  hooksOk: boolean;
  serviceRequired: boolean;
  serviceLoaded: boolean;
  /** True only when this install was explicitly pointed at a worker. */
  connectionRequested: boolean;
  readOk: boolean;
  ingestOk: boolean;
}): boolean {
  return (
    checks.hooksOk &&
    (!checks.serviceRequired || checks.serviceLoaded) &&
    (!checks.connectionRequested || (checks.readOk && checks.ingestOk))
  );
}

/**
 * Per-command flag contract. Unknown names are rejected before side effects so a
 * typo cannot quietly do the wrong thing (`--worker-uri` must not look like a
 * successful account-free init; `--dry-run` on init must not install).
 *
 * `boolean` flags are bare only (`--flag`). `value` flags require a string.
 * `optionalValue` flags accept bare or a string (`--demo` / `--demo=scenario`).
 */
type CommandFlagSpec = {
  boolean?: ReadonlySet<string>;
  value?: ReadonlySet<string>;
  optionalValue?: ReadonlySet<string>;
};

const INIT_FLAGS: CommandFlagSpec = {
  boolean: new Set(["no-service"]),
  value: new Set(["worker-url", "ingest-key", "read-key"]),
};

const START_FLAGS: CommandFlagSpec = {
  boolean: new Set(["foreground"]),
};

/** `seorak stop` takes no flags; the empty allowlist is intentional. */
const STOP_FLAGS: CommandFlagSpec = {};

const SESSION_FLAGS: CommandFlagSpec = {
  boolean: new Set(["once", "json", "no-color"]),
  value: new Set(["days", "worker-url"]),
  optionalValue: new Set(["demo"]),
};

function validateCommandFlags(
  flags: Record<string, string | boolean>,
  spec: CommandFlagSpec,
  label: string,
): string | null {
  const allowed = new Set<string>([
    ...(spec.boolean ?? []),
    ...(spec.value ?? []),
    ...(spec.optionalValue ?? []),
  ]);
  for (const [name, value] of Object.entries(flags)) {
    if (!allowed.has(name)) return `unknown ${label} flag: --${name}`;
    if (spec.boolean?.has(name) && value !== true) {
      return `--${name} does not take a value`;
    }
    if (spec.value?.has(name) && typeof value !== "string") {
      return `--${name} requires a value`;
    }
  }
  return null;
}

/** Parse argv into the first POSITIONAL (the subcommand, "" when none — i.e. bare
 *  `seorak`) and the `--flag` map. Supports `--key value`, `--key=value`, and bare
 *  `--key`. A flag value is consumed (never re-read as the command), so
 *  `seorak --worker-url http://x` has no subcommand and opens the session. */
function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }
  return {
    command: positionals[0] ?? "",
    extraPositionals: positionals.slice(1),
    flags,
  };
}

async function cmdInitConfigured(
  flags: Record<string, string | boolean>,
  lifecyclePaths: CollectorLifecyclePaths,
  binDir: string,
  commandPrefix: string,
): Promise<number> {
  const noService = flags["no-service"] === true;
  const savedConnection = loadSavedConnection();

  // A RE-init must not lose the working config: the status check's remedy for a
  // missing hook or a moved checkout is "run `seorak setup`", so the values the
  // previous init baked into the plist are the fallback for anything not passed
  // explicitly. Without this, a keyless/non-TTY re-init would silently rewrite
  // a deployed install to an unauthenticated localhost service.
  const plistBakedUrl =
    savedConnection?.workerUrl ?? serviceWorkerUrl(launchAgentPlistPath());
  const previousCredentials = {
    ingestKey:
      savedConnection?.ingestToken ??
      servicePlistEnv(launchAgentPlistPath(), "SEORAK_INGEST_KEY"),
    readKey:
      savedConnection?.readToken ??
      servicePlistEnv(launchAgentPlistPath(), "SEORAK_READ_KEY"),
  };

  // A worker is an OPT-IN. There is no prompt and no default any more: the Free
  // install is complete without one, and asking for a URL as step one taught
  // every new user that Seorak needs a server. A connection exists only when the
  // user asked for one — `--worker-url`, `SEORAK_WORKER_URL`, `seorak login`, or
  // a URL a previous init already baked into the LaunchAgent.
  const connectionRequested = workerConnectionConfigured({
    flag: flags["worker-url"],
    env: process.env.SEORAK_WORKER_URL,
    saved: savedConnection?.workerUrl,
    plist: plistBakedUrl,
  });
  const workerUrl = connectionRequested
    ? (typeof flags["worker-url"] === "string"
        ? flags["worker-url"]
        : (process.env.SEORAK_WORKER_URL ?? plistBakedUrl ?? DEFAULT_WORKER_URL)
      ).replace(/\/$/, "")
    : "";

  // Resolve write and read authority independently. Re-init preserves both
  // plist values; an explicit blank read key remains blank rather than silently
  // regaining write authority through the one-token fallback.
  const { ingestKey, readKey, readAccessKey } = resolveInitCredentials(
    flags,
    process.env,
    previousCredentials,
  );
  if (connectionRequested && ingestKey && readAccessKey) {
    saveConnection({
      schemaVersion: 1,
      workerUrl,
      ingestToken: ingestKey,
      readToken: readAccessKey,
    });
  }

  console.log(`${commandPrefix} setup\n`);

  // (a) hooks ---------------------------------------------------------------
  let installed;
  try {
    installed = installHooks({ binDir });
  } catch (err) {
    console.error(`✘ hook install failed: ${(err as Error).message}`);
    return 1;
  }
  if (installed.added.length > 0 || installed.repaired.length > 0) {
    if (installed.added.length > 0) console.log(`✓ hooks installed (${installed.added.join(", ")})`);
    if (installed.repaired.length > 0) {
      // Not always a checkout: the common case now is an upgrade re-pointing
      // hooks off the previous runtime, where naming a "checkout" is nonsense.
      console.log(`✓ hooks re-pointed to this install (${installed.repaired.join(", ")})`);
    }
    if (installed.backedUp) console.log(`  • backed up previous settings to ${installed.settingsPath}.bak`);
  } else {
    console.log(`✓ hooks already registered (${installed.settingsPath})`);
  }

  // (b) background service ---------------------------------------------------
  const plistPath = launchAgentPlistPath();
  let serviceLoaded = false;
  if (noService || !isMac()) {
    activateCollectorState(lifecyclePaths);
    const reason = noService ? "--no-service" : `${platform()} (no launchd)`;
    console.log(`• skipping background service (${reason})`);
    console.log(
      `  run the daemon yourself with: ${
        connectionRequested ? ` SEORAK_WORKER_URL=${workerUrl}` : ""
      }${ingestKey ? " SEORAK_INGEST_KEY=<key>" : ""}${
        readKey !== undefined
          ? ` SEORAK_READ_KEY=${readKey ? "<key>" : "''"}`
          : ""
      } ${commandPrefix} start --foreground`,
    );
  } else {
    const plist = buildLaunchAgentPlist({
      nodeBin: process.execPath,
      daemonPath: daemonEntryPath(binDir),
      ...(connectionRequested ? { workerUrl } : {}),
      stdoutPath: daemonLogPath(),
      stderrPath: daemonLogPath(),
      stateDir: lifecyclePaths.stateDir,
      // Credentials belong to a connection. Baking them with no worker URL
      // would leave a key in the LaunchAgent that nothing can ever use.
      ...(connectionRequested && ingestKey ? { ingestKey } : {}),
      ...(connectionRequested && readKey !== undefined ? { readKey } : {}),
    });
    mkdirSync(dirname(plistPath), { recursive: true });
    mkdirSync(collectorDir(), { recursive: true });
    writeFileSync(plistPath, plist, "utf8");
    console.log(`✓ wrote LaunchAgent ${plistPath}`);
    // Reload: bootout an already-loaded copy first so a re-init picks up new env.
    spawnSync("launchctl", ["unload", plistPath], { encoding: "utf8" });
    activateCollectorState(lifecyclePaths);
    const load = spawnSync("launchctl", ["load", plistPath], { encoding: "utf8" });
    serviceLoaded = launchctlLoaded();
    if (load.status === 0 && serviceLoaded) {
      console.log(`✓ background service loaded (${LAUNCHD_LABEL})`);
    } else {
      console.log(`✘ background service failed to load (see ${daemonLogPath()})`);
      if (load.stderr) console.log(`  ${load.stderr.trim()}`);
    }
  }

  // (c) verify ---------------------------------------------------------------
  console.log("\nverifying…");
  const settings = loadSettings(defaultSettingsPath());
  const hooks = evaluateHooks(settings);
  console.log(`  ${hooks.ok ? "✓" : "✘"} hooks: ${hooks.present.length}/${SEORAK_EVENTS.length} bound` + (hooks.missing.length ? ` (missing ${hooks.missing.join(", ")})` : ""));

  // The worker is probed only when this install asked for one. Probing a
  // localhost default nobody configured is what used to print two failures on a
  // perfectly healthy account-free setup.
  let worker: Awaited<ReturnType<typeof probeWorker>> = {
    ok: false,
    authRejected: false,
  };
  let ingest = worker;
  if (connectionRequested) {
    worker = await probeWorker(workerUrl, readAccessKey || undefined);
    if (worker.ok) {
      console.log(`  ✓ worker reachable at ${workerUrl}`);
    } else if (worker.authRejected) {
      console.log(
        `  ✘ worker at ${workerUrl} rejected the read key (HTTP ${worker.status}). Check --read-key / SEORAK_READ_KEY (or the ingest-key fallback).`,
      );
    } else {
      console.log(`  ✘ worker NOT reachable at ${workerUrl} (${worker.error ?? `HTTP ${worker.status}`})`);
    }

    ingest = await probeWorkerIngestAuthority(workerUrl, ingestKey || undefined);
    if (ingest.ok) {
      console.log("  ✓ worker accepts the ingest authority");
    } else if (ingest.authRejected) {
      console.log(
        `  ✘ worker rejected the ingest key (HTTP ${ingest.status}). Check --ingest-key / SEORAK_INGEST_KEY.`,
      );
    } else {
      console.log(
        `  ✘ worker ingest authority NOT verified (${ingest.error ?? `HTTP ${ingest.status}`})`,
      );
    }
  } else {
    console.log("  • local only, no worker connection configured");
  }

  if (!noService && isMac()) {
    console.log(`  ${serviceLoaded ? "✓" : "✘"} service ${serviceLoaded ? "loaded" : "not loaded"}`);
  }

  // (d) summary --------------------------------------------------------------
  const allOk = initVerificationPassed({
    hooksOk: hooks.ok,
    serviceRequired: !noService && isMac(),
    serviceLoaded,
    connectionRequested,
    readOk: worker.ok,
    ingestOk: ingest.ok,
  });
  console.log("");
  if (allOk) {
    // Hand off into the product with the exact next commands, not prose.
    console.log(connectionRequested ? "✅ connected" : "✅ capturing");
    const codexRoot = codexSessionsRoot();
    const watching =
      codexTailEnabled() && existsSync(codexRoot) ? "Claude Code and Codex" : "Claude Code";
    console.log(`   watching ${watching} on this machine`);
    console.log("");
    console.log("next:");
    console.log("  1. restart Claude Code (or start a new session) so the hooks load");
    console.log(`  2. run \`${commandPrefix}\` to watch the live board`);
    // A connected install signs the browser in through the worker's deep link;
    // an account-free one opens the dashboard the local plane already serves,
    // with no key, no fragment, and no sign-in.
    console.log(`  3. dashboard: ${connectionRequested ? dashboardDeepLink(workerUrl) : localDashboardUrl()}`);
    if (!connectionRequested) {
      console.log("");
      console.log(`   this machine holds the complete record. \`${commandPrefix} login\` adds a managed connection later.`);
    }
  } else {
    console.log("⚠ setup needs attention.");
    console.log(`   Run \`${commandPrefix} status\` for the checklist and exact recovery steps.`);
  }
  return allOk ? 0 : 1;
}

/** The origin the daemon's plane is actually listening on. `SEORAK_LOCAL_PLANE_PORT`
 *  moves the daemon's listener, so anything that names the plane has to read the
 *  same value or it will point at a port nothing is bound to. */
function localPlaneOrigin(): string {
  const port = boundedIntOr(
    process.env.SEORAK_LOCAL_PLANE_PORT,
    DEFAULT_LOCAL_PLANE_PORT,
    1,
    65_535,
  );
  return `http://127.0.0.1:${port}`;
}

/** Where the primary dashboard opens on this machine. The plane is served by the
 *  daemon, so this is a statement about the installed app, not an instruction to
 *  start a server. */
function localDashboardUrl(): string {
  return `${localPlaneOrigin()}/dashboard`;
}

async function cmdSetup(
  extraPositionals: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const invocation = currentCollectorInvocation();
  if (extraPositionals.length > 0) {
    console.error(`✘ unexpected setup argument: ${extraPositionals[0]}`);
    console.error(`  Run \`${invocation} setup --help\` to see the supported options.`);
    return 1;
  }
  const flagError = validateCommandFlags(flags, INIT_FLAGS, "setup");
  if (flagError) {
    console.error(`✘ ${flagError}`);
    console.error(`  Run \`${invocation} setup --help\` to see the supported options.`);
    return 1;
  }
  let lifecyclePaths: CollectorLifecyclePaths;
  try {
    lifecyclePaths = resolveCollectorLifecyclePaths(collectorDir());
  } catch (error) {
    console.error(`✘ collector state path invalid: ${(error as Error).message}`);
    return 1;
  }
  let release: () => void;
  try {
    release = acquireCollectorLifecycleLock(lifecyclePaths);
  } catch (error) {
    console.error(`✘ collector setup failed: ${(error as Error).message}`);
    console.error(`  Run \`${invocation} status\` for the checklist and recovery steps.`);
    return 1;
  }
  try {
    assertCollectorCanInitialize(lifecyclePaths);
    // Claim a custom state directory while it is still empty. A staged runtime
    // lives below that directory, so staging it first would make the lifecycle
    // guard correctly refuse its own newly populated path.
    claimCollectorState(lifecyclePaths);
    const runtime = ensureCollectorRuntime(lifecyclePaths.stateDir);
    if (runtime.installed) console.log("✓ Seorak is ready on this machine");
    // Recompute from where the runtime actually landed: an npx launch that just
    // staged a durable copy still has to tell the reader to use npx.
    const commandPrefix = collectorInvocation({
      packageRoot: runtime.packageRoot,
      binDir: runtime.binDir,
      stateDir: lifecyclePaths.stateDir,
    });
    return await cmdInitConfigured(
      flags,
      lifecyclePaths,
      runtime.binDir,
      commandPrefix,
    );
  } catch (error) {
    console.error(`✘ collector setup failed: ${(error as Error).message}`);
    console.error(`  Run \`${invocation} status\` for the checklist and recovery steps.`);
    return 1;
  } finally {
    release();
  }
}

/** Resolve a demo scenario from `--demo` / `--demo=scenario` / `--demo scenario`.
 *  Bare `--demo` → the default scenario; an unknown scenario also falls to the
 *  default (a typo shows a board, never a crash). undefined when not passed. */
function resolveDemo(flags: Record<string, string | boolean>): DemoScenarioId | undefined {
  const v = flags["demo"];
  if (v === undefined) return undefined;
  if (typeof v !== "string") return DEFAULT_DEMO_SCENARIO; // bare --demo
  return isDemoScenarioId(v) ? v : DEFAULT_DEMO_SCENARIO;
}

/** Assemble the shell options shared by the live session and the one-shot read:
 *  worker URL (ADR-5 precedence), color gate, optional demo scenario, and an
 *  optional `--days` window override (in-memory only; the persisted layout's
 *  rangeDays is otherwise authoritative). */
function resolveShellOptions(flags: Record<string, string | boolean>): ShellOptions & { rangeDays?: number } {
  const plistPath = launchAgentPlistPath();
  const saved = loadSavedConnection();
  // The terminal is a READ surface, so an install with no configured worker
  // reads its own plane instead of probing a localhost worker that an
  // account-free install never had. See `resolveReadTargets`.
  const targets = resolveReadTargets(
    resolveTargets(flags, process.env, plistPath, saved),
    hasWorkerConnection(flags, process.env, plistPath, saved),
    localPlaneOrigin(),
  );
  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && flags["no-color"] !== true;
  const demo = resolveDemo(flags);
  const rawDays = typeof flags["days"] === "string" ? Number.parseInt(flags["days"] as string, 10) : undefined;
  const days = isOverviewRangeDays(rawDays) ? rawDays : undefined;
  return {
    ...targets,
    color,
    watching: watchedAgents(),
    ...(demo ? { demo } : {}),
    ...(days !== undefined ? { rangeDays: days } : {}),
  };
}

async function cmdLogin(
  flags: Record<string, string | boolean>,
): Promise<number> {
  for (const name of Object.keys(flags)) {
    if (name !== "control-plane" && name !== "no-browser") {
      console.error(`✘ unknown login flag: --${name}`);
      return 1;
    }
  }
  const controlPlane =
    typeof flags["control-plane"] === "string"
      ? flags["control-plane"]
      : process.env.SEORAK_CONTROL_PLANE_URL ?? DEFAULT_CONTROL_PLANE_URL;
  if (flags["control-plane"] === true) {
    console.error("✘ --control-plane requires a URL");
    return 1;
  }
  let release: (() => void) | null = null;
  console.log(`${currentCollectorInvocation()} login\n`);
  try {
    const lifecyclePaths = resolveCollectorLifecyclePaths(collectorDir());
    release = acquireCollectorLifecycleLock(lifecyclePaths);
    assertCollectorCanInitialize(lifecyclePaths);
    claimCollectorState(lifecyclePaths);
    const connection = await loginWithDeviceCode({
      controlPlaneUrl: controlPlane,
      noBrowser: flags["no-browser"] === true,
    });
    console.log(
      connection.home
        ? `✓ signed in to ${connection.home.name} (${connection.home.kind === "workspace" ? "Shared workspace" : "Personal"})`
        : "✓ signed in",
    );
    console.log(`  run \`${currentCollectorInvocation()} setup\` to install capture`);
    return 0;
  } catch (error) {
    console.error(`✘ login failed: ${(error as Error).message}`);
    return 1;
  } finally {
    release?.();
  }
}

function cmdHome(
  positionals: string[],
  flags: Record<string, string | boolean>,
): number {
  const unknownFlag = Object.keys(flags)[0];
  if (unknownFlag) {
    console.error(`✘ unknown home flag: --${unknownFlag}`);
    return 1;
  }
  if (positionals.length > 1) {
    console.error(`✘ unexpected home argument: ${positionals[1]}`);
    return 1;
  }
  const selector = positionals[0];
  if (selector) {
    const selected = selectSavedConnection(selector);
    if (!selected?.home) {
      console.error(
        `✘ no single saved home matches "${selector}". Run \`seorak home\` to list choices.`,
      );
      return 1;
    }
    console.log(
      `✓ active home — ${selected.home.name} (${selected.home.kind === "workspace" ? "Shared workspace" : "Personal"})`,
    );
    console.log(`  run \`${currentCollectorInvocation()} setup\` to point capture at this home`);
    return 0;
  }

  const active = loadSavedConnection();
  const connections = listSavedConnections();
  const homes = connections.filter(
    (connection) => connection.home !== undefined,
  );
  console.log(`${currentCollectorInvocation()} homes\n`);
  if (homes.length === 0) {
    if (active) {
      console.log("● Personal (legacy connection)");
      console.log("  Sign in again to name this home and enable switching.");
      return 0;
    }
    console.log(`No saved homes. Run \`${currentCollectorInvocation()} login\`.`);
    return 0;
  }
  for (const connection of homes) {
    const home = connection.home!;
    const marker = active?.home?.id === home.id ? "●" : "○";
    const label =
      home.kind === "workspace" ? "Shared workspace" : "Personal";
    console.log(`${marker} ${home.name} — ${label} (${home.id})`);
  }
  console.log(`\nSwitch with \`${currentCollectorInvocation()} home <name-or-id>\`.`);
  return 0;
}

/**
 * `seorak recovery download` — pull the managed copy during the 30-day window.
 *
 * The grant comes from the environment and never from a flag, so it does not
 * land in shell history. It is a short-lived bearer credential for one home's
 * recovery read, and nothing here prints it back.
 *
 * This command reads a Seorak-operated copy. It is not how anyone reads their
 * own history: that is `seorak local export`, which needs no account, no
 * network, and no grant, and which stays available on every plan.
 */
async function cmdRecovery(
  positionals: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const usage =
    "usage: SEORAK_RECOVERY_TOKEN=... seorak recovery download --cell URL --output /absolute/dir";
  if (positionals[0] !== "download") {
    console.error(usage);
    return 1;
  }
  const cell = flags.cell;
  const output = flags.output;
  const unknown = Object.keys(flags).find(
    (flag) => flag !== "cell" && flag !== "output",
  );
  if (typeof cell !== "string" || typeof output !== "string" || unknown) {
    console.error(usage);
    return 1;
  }
  const token = process.env.SEORAK_RECOVERY_TOKEN?.trim();
  if (!token) {
    console.error(
      "✘ set SEORAK_RECOVERY_TOKEN to the grant from your billing page; it is not accepted as a flag",
    );
    return 1;
  }
  const result = await downloadRecoveryBundle({
    cellUrl: cell,
    token,
    outputDir: output,
  });
  if (!result.ok) {
    console.error(`✘ recovery download failed: ${result.detail}`);
    if (result.reason === "copy-deleted") {
      console.error(
        "  The complete history is on this computer. Read it with `seorak local export`.",
      );
    }
    if (result.partialPath) {
      console.error(
        `  The incomplete attempt is at ${result.partialPath}. It has no bundle.json, so it is not a bundle.`,
      );
    }
    return 1;
  }
  console.log(
    `✓ recovery bundle at ${result.bundlePath}: ${result.counts.sessions} session(s), ${result.counts.hours} hour(s), ${result.counts.archives} archive(s), ${result.archiveCiphertextBytes} ciphertext byte(s)`,
  );
  // Said here, at the moment of download, and not in a help article.
  console.log(
    "  Archive objects are encrypted with the key on this computer. Seorak holds no key and cannot read them.",
  );
  console.log(
    "  Your complete plaintext history is local. `seorak local export` reads it with no account and no network.",
  );
  return 0;
}

/**
 * `seorak remote credential [--rotate]` — mint the credential the plane's
 * routable binding requires.
 *
 * The plane will not create this file for itself, and that is the point: an
 * operator who has not run this command has not enabled remote access, so a
 * mistyped setting can never produce a routable socket. The value is printed
 * ONCE, here, to an interactive terminal. It is deliberately never written to
 * `daemon.log`, which persists.
 *
 * Rotation is a first-class action rather than an afterthought, because
 * "rotatable in one command" is the mitigation the design claims for a leaked
 * credential. Reasoning: docs/reference/self-hosted-plane-hardening.md.
 */
function cmdRemote(
  positionals: string[],
  flags: Record<string, string | boolean>,
): number {
  const usage = "usage: seorak remote credential [--rotate]";
  if (positionals[0] !== "credential" || positionals.length > 1) {
    console.error(usage);
    return 1;
  }
  const unknown = Object.keys(flags).find((flag) => flag !== "rotate");
  if (unknown !== undefined) {
    console.error(`✘ unknown remote credential flag: --${unknown}`);
    console.error(usage);
    return 1;
  }
  // `--rotate=yes` must not read as "no rotation". It parses to a STRING, so a
  // bare `=== true` test would quietly fall through to the mint-if-absent path
  // and leave an operator believing they had rotated.
  const rotateFlag = flags["rotate"];
  if (rotateFlag !== undefined && rotateFlag !== true) {
    console.error("✘ --rotate does not take a value");
    console.error(usage);
    return 1;
  }
  const rotate = rotateFlag === true;
  let path: string;
  try {
    path = selfHostedCredentialPath(collectorDir());
  } catch (error) {
    console.error(`✘ collector state path invalid: ${(error as Error).message}`);
    return 1;
  }
  if (existsSync(path) && !rotate) {
    // Never re-print an existing credential. Reading it back would put a live
    // secret in a terminal (and a scrollback, and a screen share) for a caller
    // who may only have been checking whether one exists.
    console.log(`Seorak self-hosted plane credential already exists at ${path}`);
    console.log("It is not printed again. `--rotate` replaces it with a new one.");
    return 0;
  }
  let credential: string;
  try {
    credential = mintSelfHostedCredential(path);
  } catch (error) {
    console.error(`✘ could not write the credential: ${(error as Error).message}`);
    return 1;
  }
  console.log(`${rotate ? "✓ rotated" : "✓ minted"} the self-hosted plane credential at ${path}`);
  console.log("");
  console.log(`  ${credential}`);
  console.log("");
  console.log("Shown once. Send it as `Authorization: Bearer <credential>`.");
  if (rotate) {
    console.log("Every client holding the previous one is refused from the next daemon start.");
  }
  console.log(
    "Remote access also needs SEORAK_SELF_HOSTED_ORIGIN, _BIND, _TLS_CERT, and _TLS_KEY; the plane refuses to bind without all four.",
  );
  return 0;
}

async function cmdLocal(
  positionals: string[],
  flags: Record<string, string | boolean>,
): Promise<number> {
  const action = positionals[0] ?? "report";
  if (action === "report") {
    const unknown = Object.keys(flags).find((flag) => flag !== "json");
    if (unknown) {
      console.error(`✘ unknown local report flag: --${unknown}`);
      return 1;
    }
    const report = buildLocalReport();
    if (flags.json === true) {
      console.log(JSON.stringify(report));
      return 0;
    }
    console.log("Seorak local history\n");
    console.log("Complete history on this machine. No hosted account required.");
    console.log(`sessions: ${report.totals.sessions}`);
    console.log(`events: ${report.totals.events}`);
    console.log(`tool calls: ${report.totals.toolCalls}`);
    console.log(`prompts: ${report.totals.prompts}`);
    console.log(`tokens: ${report.totals.tokens}`);
    console.log(
      `estimated cost: ${
        report.totals.costUsd === null
          ? "not fully priced"
          : `$${report.totals.costUsd.toFixed(2)}`
      }`,
    );
    return 0;
  }
  if (action === "sessions") {
    if (Object.keys(flags).length > 0) {
      console.error(`✘ local sessions does not accept flags`);
      return 1;
    }
    // The COMPLETE local history, which is the promise (docs/specs/pricing.md),
    // not the first page of it. This used to print one capped page with no way
    // to ask for the next, so a user with more sessions than the cap was quietly
    // told a truncated story about their own machine.
    const sessions: LocalSessionRow[] = [];
    let cursor: string | null = null;
    do {
      const page = listLocalSessionPage({ limit: 500, cursor });
      sessions.push(...page.sessions);
      cursor = page.nextCursor;
    } while (cursor !== null);
    console.log(JSON.stringify({ sessions }));
    return 0;
  }
  if (action === "replay") {
    if (Object.keys(flags).length > 0 || !positionals[1]) {
      console.error("usage: seorak local replay <session-id>");
      return 1;
    }
    const events = replayLocalSession(positionals[1]);
    if (events.length === 0) {
      console.error("✘ local session not found");
      return 1;
    }
    console.log(
      JSON.stringify({
        sessionId: positionals[1],
        completeness: "complete-local-history",
        events,
      }),
    );
    return 0;
  }
  if (action === "export") {
    const output = flags.output;
    if (typeof output !== "string" || Object.keys(flags).some((flag) => flag !== "output")) {
      console.error("usage: seorak local export --output /absolute/path.json");
      return 1;
    }
    try {
      const result = exportLocalHistory(output);
      console.log(`✓ exported ${result.events} local event(s) to ${result.path}`);
      return 0;
    } catch (error) {
      console.error(`✘ local export failed: ${(error as Error).message}`);
      return 1;
    }
  }
  if (action === "dashboard") {
    if (Object.keys(flags).some((flag) => flag !== "port")) {
      console.error("usage: seorak local dashboard [--port 4317]");
      return 1;
    }
    const rawPort = flags.port;
    const port =
      typeof rawPort === "string" ? Number(rawPort) : DEFAULT_LOCAL_PLANE_PORT;
    // This used to serve a bespoke simplified page. It is now an alias that
    // brings up the SAME loopback data plane the daemon runs and points at the
    // SAME primary dashboard, because a second local UI was a second product.
    //
    // The bundle arrives with the install: `@seorakseorak` depends on
    // `@seorak/dashboard` exactly, and the plane resolves it by name. So the two
    // branches below are the two real failures, not the normal case they used to
    // be: nothing installed the package, or the one installed speaks a different
    // protocol than this collector.
    const bundle = resolveDashboardBundle();
    const refusal = dashboardBundleRefusal(bundle);
    if (refusal !== null) {
      console.error(`✘ ${refusal}`);
    } else if (bundle.state === "absent") {
      console.log("Seorak local data plane (no dashboard bundle installed with this collector).");
    }
    try {
      const plane = await startLocalPlane({ port });
      // Name what is actually there. This used to fall back to the plane's own
      // url under the word "dashboard", so a refusal two lines above was
      // followed by a dashboard address that answers 404, and the reader had to
      // decide which of the two to believe.
      console.log(
        plane.dashboardUrl === null
          ? `Seorak local data plane: ${plane.url}`
          : `Seorak dashboard: ${plane.dashboardUrl}`,
      );
      console.log("Press Ctrl+C to stop.");
      await new Promise<void>((resolve) => {
        const stop = () => void plane.close().then(resolve);
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
      return 0;
    } catch (error) {
      // The daemon already owning the port is the healthy case, not a failure:
      // the plane is up, so print where it is instead of an error.
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        console.log(`Seorak dashboard: http://127.0.0.1:${port}/dashboard`);
        console.log("The collector daemon is already serving it.");
        return 0;
      }
      console.error(`✘ local plane failed: ${(error as Error).message}`);
      return 1;
    }
  }
  console.error(`✘ unknown local command: ${action}`);
  return 1;
}

/** Which agents this machine ACTUALLY captures, for the identity block's
 *  `watching` row: Claude Code when any Seorak hook is bound, Codex when the
 *  tailer is on and its sessions root exists. null = nothing installed yet
 *  (rendered honestly, with the fix). */
function watchedAgents(): string | null {
  const settings = loadSettings(defaultSettingsPath());
  const claude = settings !== null && evaluateHooks(settings).present.length > 0;
  const codex = codexTailEnabled() && existsSync(codexSessionsRoot());
  if (claude && codex) return "Claude Code and Codex";
  if (claude) return "Claude Code";
  if (codex) return "Codex";
  return null;
}

/**
 * `seorak` (no subcommand) — open the interactive terminal SESSION: a live,
 * always-refreshing stat board on top, a command/chat input line at the bottom.
 * `--once` renders a single board and exits instead. `--demo[=scenario]` drives
 * it from fixtures with no worker.
 */
function cmdSession(flags: Record<string, string | boolean>): Promise<number> {
  const flagError = validateCommandFlags(flags, SESSION_FLAGS, "session");
  if (flagError) {
    console.error(`✘ ${flagError}`);
    return Promise.resolve(1);
  }
  const options = resolveShellOptions(flags);
  if (flags["once"] === true) return runOnce({ ...options, json: flags["json"] === true });
  return runInteractive(options);
}

export async function runForegroundDaemon(
  loadDaemon: () => Promise<{ runDaemon: () => Promise<void> }> = () =>
    import("./daemon.ts"),
): Promise<number> {
  try {
    const { runDaemon } = await loadDaemon();
    await runDaemon();
    return 0;
  } catch (error) {
    console.error(`✘ foreground collector stopped: ${(error as Error).message}`);
    return 1;
  }
}

async function cmdStart(flags: Record<string, string | boolean>): Promise<number> {
  const flagError = validateCommandFlags(flags, START_FLAGS, "start");
  if (flagError) {
    console.error(`✘ ${flagError}`);
    return 1;
  }
  if (collectorCaptureRevoked(collectorDir())) {
    console.error(
      `✘ collector capture is disabled after purge. Run \`${currentCollectorInvocation()} setup\` to reactivate it.`,
    );
    return 1;
  }
  if (flags.foreground === true) {
    // Run and await the daemon in this process so the documented recovery path
    // owns its lifetime and reports a startup refusal instead of exiting after
    // a successful import.
    return runForegroundDaemon();
  }
  if (!isMac()) {
    console.error(`✘ no launchd on this platform. Use \`${currentCollectorInvocation()} start --foreground\`.`);
    return 1;
  }
  const plistPath = launchAgentPlistPath();
  if (!existsSync(plistPath)) {
    console.error(`✘ no LaunchAgent at ${plistPath}. Run \`${currentCollectorInvocation()} setup\` first.`);
    return 1;
  }
  const res = spawnSync("launchctl", ["load", plistPath], { encoding: "utf8" });
  if (res.status === 0 && launchctlLoaded()) {
    console.log(`✓ started (${LAUNCHD_LABEL})`);
    return 0;
  }
  console.error(`✘ failed to start: ${res.stderr?.trim() || "launchctl load failed"}`);
  return 1;
}

function cmdStop(flags: Record<string, string | boolean>): number {
  const flagError = validateCommandFlags(flags, STOP_FLAGS, "stop");
  if (flagError) {
    console.error(`✘ ${flagError}`);
    return 1;
  }
  if (!isMac()) {
    console.error("✘ no launchd on this platform.");
    return 1;
  }
  const result = stopLaunchdService();
  if (result.stopped && result.attempted) {
    console.log(`✓ stopped (${LAUNCHD_LABEL})`);
    return 0;
  }
  if (result.stopped) {
    console.error(`✘ service is not loaded (${LAUNCHD_LABEL}).`);
    return 1;
  }
  console.error(`✘ failed to stop: ${result.error}`);
  return 1;
}

function validateUninstallFlags(
  flags: Record<string, string | boolean>,
): string | null {
  return validateCommandFlags(
    flags,
    { boolean: new Set(["hooks", "purge", "dry-run"]) },
    "uninstall",
  );
}

function removeInstalledService(): boolean {
  if (!isMac()) {
    console.log("• no LaunchAgent to remove");
    return true;
  }
  const stopped = stopLaunchdService();
  if (!stopped.stopped) {
    console.error(`✘ failed to stop ${LAUNCHD_LABEL}: ${stopped.error}`);
    return false;
  }
  const plistPath = launchAgentPlistPath();
  if (existsSync(plistPath)) {
    rmSync(plistPath, { force: true });
    console.log(`✓ removed LaunchAgent ${plistPath}`);
  } else {
    console.log("• no LaunchAgent plist to remove");
  }
  return true;
}

function removeInstalledHooks(): boolean {
  try {
    const result = removeHooks();
    if (result.removed.length > 0) {
      console.log(`✓ removed Seorak hooks (${result.removed.join(", ")})`);
      if (result.backedUp) {
        console.log(`  • backed up settings to ${result.settingsPath}.bak`);
      }
    } else {
      console.log("• no Seorak hooks found to remove");
    }
    return true;
  } catch (err) {
    console.error(`✘ hook removal failed: ${(err as Error).message}`);
    return false;
  }
}

function printUninstallDryRun(
  purge: boolean,
  removeHookBindings: boolean,
): number {
  const plistPath = launchAgentPlistPath();
  const settingsPath = defaultSettingsPath();
  const launchd = inspectLaunchdService();
  console.log("seorak uninstall --dry-run\n");
  if (launchd.state === "unknown") {
    console.error(`✘ cannot inspect ${LAUNCHD_LABEL}: ${launchd.error}`);
    return 1;
  }
  console.log(
    launchd.state === "loaded"
      ? `would stop ${LAUNCHD_LABEL}`
      : `no loaded ${LAUNCHD_LABEL} service`,
  );
  console.log(
    existsSync(plistPath)
      ? `would remove LaunchAgent ${plistPath}`
      : `no LaunchAgent plist at ${plistPath}`,
  );
  if (removeHookBindings) {
    if (loadSettings(settingsPath) === null) {
      console.error(`✘ cannot inspect invalid hook settings: ${settingsPath}`);
      return 1;
    }
    console.log(`would remove Seorak hooks from ${settingsPath}`);
  } else {
    console.log(`would retain Claude Code hooks in ${settingsPath}`);
  }
  if (!purge) {
    console.log(`would retain collector data at ${collectorDir()}`);
    return 0;
  }
  try {
    const paths = resolveCollectorLifecyclePaths(collectorDir());
    const plan = planCollectorPurge(paths);
    const lease = daemonLeaseStatus(paths);
    const hooks = hookCaptureLeaseStatus(paths);
    console.log(`would permanently purge collector data at ${plan.stateDir}`);
    if (plan.tombstone) {
      console.log(`would resume cleanup of ${plan.tombstone}`);
    }
    if (lease === "live" || lease === "invalid") {
      console.error(
        lease === "live"
          ? "✘ a foreground collector daemon is still running; stop it before purging."
          : "✘ collector daemon ownership is invalid; refusing to purge.",
      );
      return 1;
    }
    if (hooks === "invalid") {
      console.error("✘ collector hook ownership is invalid; refusing to purge.");
      return 1;
    }
    if (hooks === "live") console.log("would wait for active hook capture to finish");
    return 0;
  } catch (error) {
    console.error(`✘ purge validation failed: ${(error as Error).message}`);
    return 1;
  }
}

async function waitForDaemonLeaseRelease(
  paths: CollectorLifecyclePaths,
  timeoutMs: number = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (daemonLeaseStatus(paths) === "live" && Date.now() < deadline) {
    await delay(50);
  }
  return daemonLeaseStatus(paths) !== "live";
}

async function waitForHookLeasesToDrain(
  paths: CollectorLifecyclePaths,
  timeoutMs: number = 10_000,
): Promise<"clear" | "live" | "invalid"> {
  const deadline = Date.now() + timeoutMs;
  let status = hookCaptureLeaseStatus(paths);
  while (status === "live" && Date.now() < deadline) {
    await delay(25);
    status = hookCaptureLeaseStatus(paths);
  }
  return status;
}

async function cmdUninstall(
  flags: Record<string, string | boolean>,
): Promise<number> {
  const flagError = validateUninstallFlags(flags);
  if (flagError) {
    console.error(`✘ ${flagError}`);
    return 1;
  }
  const purge = flags.purge === true;
  const removeHookBindings = purge || flags.hooks === true;
  if (flags["dry-run"] === true) {
    return printUninstallDryRun(purge, removeHookBindings);
  }

  if (!purge) {
    if (!removeInstalledService()) return 1;
    if (removeHookBindings) {
      if (!removeInstalledHooks()) return 1;
    } else {
      console.log("• left Claude Code hooks in place (pass --hooks to remove them)");
    }
    console.log(`• retained collector data at ${collectorDir()}`);
    return 0;
  }

  let paths: CollectorLifecyclePaths;
  try {
    paths = resolveCollectorLifecyclePaths(collectorDir());
  } catch (error) {
    console.error(`✘ purge validation failed: ${(error as Error).message}`);
    return 1;
  }
  let release: () => void;
  try {
    release = acquireCollectorLifecycleLock(paths);
  } catch (error) {
    console.error(`✘ collector purge failed: ${(error as Error).message}`);
    return 1;
  }
  try {
    planCollectorPurge(paths);
    beginCollectorPurge(paths);

    if (!removeInstalledService()) return 1;
    advanceCollectorPurge(paths, "service-stopped");

    const daemonStopped = !isMac() || (await waitForDaemonLeaseRelease(paths));
    const daemonState = daemonLeaseStatus(paths);
    if (
      !daemonStopped ||
      daemonState === "live" ||
      daemonState === "invalid"
    ) {
      console.error(
        daemonState === "invalid"
          ? "✘ collector daemon ownership is invalid; refusing to purge."
          : "✘ a foreground collector daemon is still running. Stop it and retry `seorak uninstall --purge`.",
      );
      return 1;
    }

    if (!removeInstalledHooks()) return 1;
    advanceCollectorPurge(paths, "hooks-removed");

    const hookLeases = await waitForHookLeasesToDrain(paths);
    if (hookLeases !== "clear") {
      console.error(
        hookLeases === "invalid"
          ? "✘ collector hook ownership is invalid; refusing to purge."
          : "✘ an active collector hook did not finish before the purge deadline. Retry `seorak uninstall --purge`.",
      );
      return 1;
    }

    purgeCollectorStateDirectory(paths);
    console.log(`✓ permanently purged collector data at ${paths.stateDir}`);
    console.log("• hosted Seorak data was not changed");
    return 0;
  } catch (error) {
    console.error(`✘ collector purge failed: ${(error as Error).message}`);
    return 1;
  } finally {
    release();
  }
}

const HELP = `seorak: performance tracking for agentic development (Claude Code and Codex)

start here:
  npx seorak setup                                 set up local capture without a global install

usage:
  seorak                                           open the live terminal session (the product)
  seorak [--once] [--days 7|30|90] [--json]        render the board once and exit (--once)
  seorak [--demo[=scenario]]                        drive the session from demo fixtures (no worker)
  seorak login [--control-plane URL] [--no-browser] pair this machine through OAuth
  seorak home [NAME-OR-ID]                         list or select a saved home
  seorak local [report] [--json]                   read complete on-machine statistics
  seorak local dashboard [--port 4317]             open the dashboard from local history (the daemon already serves it)
  seorak local sessions                            list complete local session history (all pages)
  seorak local replay <session-id>                 replay one session from local history
  seorak local export --output /absolute/file.json export all local history
  seorak remote credential [--rotate]              mint the credential the plane's routable binding requires
  seorak recovery download --cell URL --output /absolute/dir
                                                   download the Seorak-operated copy during the recovery window
  seorak setup [--no-service]                      install hooks + background service (no account or hosted connection)
  seorak setup --worker-url URL [--ingest-key KEY] [--read-key KEY]
                                                   the same, plus an explicit worker connection
  seorak init [options]                            compatibility alias for setup
  seorak status [--worker-url URL]                 ✓/✗ checklist
  seorak start [--foreground]                      load the background daemon (or run it here)
  seorak stop                                      unload the background daemon
  seorak uninstall [--hooks] [--dry-run]             remove service; retain collector data
  seorak uninstall --purge [--dry-run]               remove service, hooks, and local collector data

in the session:
  /range <7|30|90>   /view [paragraph|list|projects]   /help   /quit
  (type anything else to ask about your stats; chat is coming soon)

env:
  SEORAK_WORKER_URL   worker base URL for an opt-in connection (unset = local only)
  SEORAK_LOCAL_PLANE_PORT  loopback dashboard port (default ${DEFAULT_LOCAL_PLANE_PORT})
  SEORAK_SELF_HOSTED_ORIGIN  exact public https origin for remote access (all four are required together)
  SEORAK_SELF_HOSTED_BIND    interface address the routable plane listens on
  SEORAK_SELF_HOSTED_TLS_CERT / _TLS_KEY  absolute PEM paths; the plane terminates TLS itself
  SEORAK_CONTROL_PLANE_URL  hosted login base URL (default ${DEFAULT_CONTROL_PLANE_URL})
  SEORAK_INGEST_KEY   shared secret for writes, when your worker is locked
  SEORAK_READ_KEY     read token, defaults to SEORAK_INGEST_KEY
  SEORAK_RECOVERY_TOKEN  one-time recovery grant for \`seorak recovery download\`
  SEORAK_DIR          collector state dir (default ~/.seorak)
  SEORAK_SETTINGS     hook-install target (default ~/.claude/settings.json)
`;

/**
 * Did this invocation ask to READ about the CLI rather than to run it?
 *
 * `--help` counts with whatever value parseArgs attached to it, because there is
 * no form of it that means anything else: `seorak --help init` parses the
 * subcommand as the flag's value, and `--help=x` as a string.
 *
 * `-h` is matched against the RAW argv rather than the parse, because parseArgs
 * only ever recognizes `--` forms. It lands in the positionals (`seorak init
 * -h`) or, worse, is eaten as the preceding flag's value (`seorak init
 * --no-service -h`), and in both shapes the parse no longer says "help" at all.
 */
function helpRequested(
  argv: string[],
  flags: Record<string, string | boolean>,
): boolean {
  if (flags["help"] !== undefined || flags["h"] !== undefined) return true;
  return argv.includes("-h");
}

/** The CLI entrypoint. Returns the process exit code. */
export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { command, extraPositionals, flags } = parseArgs(argv);
  // `--help` / `-h` win regardless of position AND regardless of subcommand,
  // answered here so no handler can run on the way to printing the text. This
  // used to fire only for a bare `seorak`, on the theory that per-subcommand
  // help could be added later — so in the meantime `seorak init --help` fell
  // through the switch and installed hooks, a LaunchAgent, and a live
  // background service on the machine of someone who was only reading. One
  // usage text answers every form: HELP already documents each subcommand
  // alongside the env vars they read, and slicing it per subcommand would buy a
  // parser for the wrapped lines without making the answer more complete.
  if (helpRequested(argv, flags)) {
    console.log(HELP);
    return 0;
  }
  switch (command) {
    case "":
      // Bare `seorak` (plus --once / --demo / --days flags) → the session.
      return cmdSession(flags);
    // `init` is a pure alias. It used to skip the durable runtime, which meant
    // `npx … init` bound hooks and the LaunchAgent to npm's disposable cache.
    // Where the code runs decides that now, not which name was typed.
    case "setup":
    case "init":
      return cmdSetup(extraPositionals, flags);
    case "login":
      return cmdLogin(flags);
    case "home":
      return cmdHome(extraPositionals, flags);
    case "local":
      return cmdLocal(extraPositionals, flags);
    case "remote":
      return cmdRemote(extraPositionals, flags);
    case "recovery":
      return cmdRecovery(extraPositionals, flags);
    case "status":
      return cmdStatus(flags);
    case "start":
      return cmdStart(flags);
    case "stop":
      return cmdStop(flags);
    case "uninstall":
      if (extraPositionals.length > 0) {
        console.error(
          `✘ unexpected uninstall argument: ${extraPositionals[0]}`,
        );
        return 1;
      }
      return cmdUninstall(flags);
    case "help":
      // `-h` never reaches the switch any more; helpRequested answers it.
      console.log(HELP);
      return 0;
    default:
      console.error(`unknown command: ${command}\n`);
      console.log(HELP);
      return 1;
  }
}

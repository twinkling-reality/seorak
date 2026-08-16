import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import {
  collectorExecutableDirectory,
  collectorPackageRoot,
} from "./package-layout.ts";
import { COLLECTOR_PACKAGE } from "./package-name.ts";

const REQUIRED_RUNTIME_FILES = [
  "seorak.mjs",
  "daemon.mjs",
  "hook-session-start.mjs",
  "hook-tool-use.mjs",
  "hook-session-end.mjs",
  "hook-notification.mjs",
  "hook-user-prompt.mjs",
] as const;

export interface CollectorRuntimeLayout {
  version: string;
  prefix: string;
  packageRoot: string;
  binDir: string;
}

/**
 * Where the running collector lives, which is what decides whether setup may
 * bind hooks and the LaunchAgent straight to it.
 *
 *   source    — a checkout's bin/. Durable, and never asks the registry for
 *               work that may not be published yet.
 *   durable   — a global install, a repo's own dist/, or a runtime this command
 *               already staged. Safe to bind to directly.
 *   ephemeral — npm's npx cache or a temp dir. Nothing here survives a cache
 *               clean, so a runtime must be staged before anything points at it.
 */
export type CollectorRuntimeOrigin = "source" | "durable" | "ephemeral";

export interface CollectorRuntimeResult extends CollectorRuntimeLayout {
  installed: boolean;
  origin: CollectorRuntimeOrigin;
}

export interface CollectorRuntimeInstallOptions {
  packageRoot?: string;
  binDir?: string;
  env?: NodeJS.ProcessEnv;
  runInstall?: (
    executable: string,
    args: readonly string[],
  ) => { status: number | null; stdout?: string; stderr?: string };
}

/**
 * npm runs `npx <pkg>` out of `<cache>/_npx/<hash>/`, which `npm cache clean`
 * deletes. The `_npx` path segment is the stable marker across npm 7–11; the
 * configured cache dir is checked too, for a relocated cache.
 *
 * Deliberately NOT "anything under /tmp": a CI job or a throwaway clone that
 * checks out into a temp directory and runs its own build is durable enough for
 * the length of that job, and calling it ephemeral would send it to the registry
 * for a version it built locally and may never have published.
 */
export function isEphemeralRuntimePath(
  packageRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (packageRoot.split(sep).includes("_npx")) return true;
  const cache = env.npm_config_cache;
  return Boolean(
    cache && packageRoot.startsWith(cache.endsWith(sep) ? cache : cache + sep),
  );
}

/**
 * Classify by LOCATION, never by which command name the user typed. Deciding
 * this from the subcommand meant `setup` staged a second copy for someone who
 * already had a durable global install — moving the LaunchAgent to the staged
 * copy while the hooks stayed on the global one — and `init`, the compatibility
 * alias, wrote hooks and the LaunchAgent into the disposable npx cache, which is
 * the exact failure the staged runtime exists to prevent.
 */
export function collectorRuntimeOrigin(
  packageRoot: string,
  binDir: string,
  env: NodeJS.ProcessEnv = process.env,
): CollectorRuntimeOrigin {
  if (basename(binDir) === "bin") return "source";
  return isEphemeralRuntimePath(packageRoot, env) ? "ephemeral" : "durable";
}

function packageVersion(packageRoot: string): string {
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ) as { name?: unknown; version?: unknown };
  if (
    manifest.name !== COLLECTOR_PACKAGE ||
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
  ) {
    throw new Error("the collector package does not declare a usable version");
  }
  return manifest.version;
}

export function collectorRuntimeLayout(
  stateDir: string,
  version: string,
): CollectorRuntimeLayout {
  const prefix = join(stateDir, "runtime", version);
  const packageRoot = join(prefix, "node_modules", COLLECTOR_PACKAGE);
  return {
    version,
    prefix,
    packageRoot,
    binDir: join(packageRoot, "dist"),
  };
}

export function collectorRuntimeReady(layout: CollectorRuntimeLayout): boolean {
  try {
    if (packageVersion(layout.packageRoot) !== layout.version) return false;
    if (!existsSync(join(layout.prefix, "node_modules", "@seorak", "dashboard", "package.json"))) {
      return false;
    }
    return REQUIRED_RUNTIME_FILES.every((file) => existsSync(join(layout.binDir, file)));
  } catch {
    return false;
  }
}

/**
 * Keep the long-lived daemon and hook paths off anything disposable.
 *
 * Only an EPHEMERAL origin needs a staged copy, and an ephemeral origin is by
 * definition a version npm just resolved from the registry — so the pinned
 * `seorak@<version>` install below always names a version that
 * exists. A durable origin binds in place, which is also why a locally built
 * `dist/` in a checkout no longer tries to fetch its own unpublished version.
 */
export function ensureCollectorRuntime(
  stateDir: string,
  options: CollectorRuntimeInstallOptions = {},
): CollectorRuntimeResult {
  const currentRoot = options.packageRoot ?? collectorPackageRoot();
  const currentBin = options.binDir ?? collectorExecutableDirectory();
  const env = options.env ?? process.env;
  const version = packageVersion(currentRoot);
  const origin = collectorRuntimeOrigin(currentRoot, currentBin, env);

  if (origin !== "ephemeral") {
    return {
      version,
      prefix: currentRoot,
      packageRoot: currentRoot,
      binDir: currentBin,
      installed: false,
      origin,
    };
  }

  const layout = collectorRuntimeLayout(stateDir, version);
  if (collectorRuntimeReady(layout)) {
    return { ...layout, installed: false, origin };
  }

  mkdirSync(layout.prefix, { recursive: true });
  const npmCli = env.npm_execpath;
  const executable = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = [
    ...(npmCli ? [npmCli] : []),
    "install",
    "--prefix",
    layout.prefix,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
    "--no-package-lock",
    "--no-save",
    `${COLLECTOR_PACKAGE}@${version}`,
  ];
  const install = options.runInstall
    ? options.runInstall(executable, args)
    : spawnSync(executable, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
  if (install.status !== 0 || !collectorRuntimeReady(layout)) {
    throw new Error(
      `could not make Seorak available for background capture; existing capture was not changed.\n${installFailureDetail(install)}`,
    );
  }
  return { ...layout, installed: true, origin };
}

/**
 * npm's own words, not a guess about them. Collapsing every cause into "check
 * that npm can reach the registry" told an offline user, a user behind a proxy,
 * a user without write permission, and a user whose npm is missing the same
 * wrong thing.
 */
function installFailureDetail(install: {
  status: number | null;
  stdout?: string;
  stderr?: string;
}): string {
  if (install.status === null) {
    return "  npm could not be started. Check that npm is installed and on PATH.";
  }
  const output = `${install.stderr ?? ""}\n${install.stdout ?? ""}`;
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return `  npm exited ${install.status} without output. Re-run setup to see it.`;
  }
  return lines
    .slice(-8)
    .map((line) => `  ${line}`)
    .join("\n");
}

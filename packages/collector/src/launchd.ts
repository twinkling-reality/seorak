import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { platform } from "node:os";
import { LAUNCHD_LABEL } from "./paths.ts";

export type LaunchctlSpawn = (
  command: string,
  args: readonly string[],
  options: { encoding: "utf8" },
) => SpawnSyncReturns<string>;

export interface LaunchdStopResult {
  stopped: boolean;
  attempted: boolean;
  error: string | null;
}

export interface LaunchdInspection {
  state: "loaded" | "absent" | "unknown";
  error: string | null;
}

/**
 * How long `stopLaunchdService` waits for launchctl to report the service
 * absent after bootout.
 *
 * Option B observed a launchctl/daemon race: bootout returned, the first
 * post-query still reported loaded, and `seorak stop` printed a failure even
 * though a later inspect showed the service gone. Settling across a short
 * deadline closes that window without treating a permanently stuck service as
 * stopped.
 */
export const LAUNCHD_STOP_SETTLE_DEADLINE_MS = 2_000;
export const LAUNCHD_STOP_SETTLE_POLL_MS = 50;

export interface LaunchdStopTiming {
  nowMs?: () => number;
  sleepMs?: (ms: number) => void;
  settleDeadlineMs?: number;
  settlePollMs?: number;
}

function currentUserServiceTarget(label: string): string | null {
  const uid = process.getuid?.();
  return uid === undefined ? null : `gui/${uid}/${label}`;
}

function explicitlyMissingService(output: string, label: string): boolean {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `could not find service\\s+["']?${escapedLabel}["']?(?:\\s|$)`,
    "i",
  ).test(output);
}

function defaultSleepMs(ms: number): void {
  if (ms <= 0) return;
  const seconds = Math.max(0.001, ms / 1000);
  spawnSync("sleep", [String(seconds)], { encoding: "utf8" });
}

/** A nonzero launchctl status is absence only with an exact not-found diagnostic. */
export function inspectLaunchdService(
  label: string = LAUNCHD_LABEL,
  spawn: LaunchctlSpawn = spawnSync,
  platformName: NodeJS.Platform = platform(),
): LaunchdInspection {
  if (platformName !== "darwin") return { state: "absent", error: null };
  const target = currentUserServiceTarget(label);
  const result = target
    ? spawn("launchctl", ["print", target], { encoding: "utf8" })
    : spawn("launchctl", ["list", label], { encoding: "utf8" });
  if (result.status === 0) return { state: "loaded", error: null };
  const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
  if (explicitlyMissingService(detail, label)) {
    return { state: "absent", error: null };
  }
  return {
    state: "unknown",
    error: detail || "launchctl could not prove whether the service exists",
  };
}

export function launchdServiceLoaded(
  label: string = LAUNCHD_LABEL,
  spawn: LaunchctlSpawn = spawnSync,
  platformName: NodeJS.Platform = platform(),
): boolean {
  return inspectLaunchdService(label, spawn, platformName).state === "loaded";
}

function bootoutService(
  label: string,
  spawn: LaunchctlSpawn,
): SpawnSyncReturns<string> {
  const target = currentUserServiceTarget(label);
  return target
    ? spawn("launchctl", ["bootout", target], { encoding: "utf8" })
    : spawn("launchctl", ["remove", label], { encoding: "utf8" });
}

/**
 * Stop by exact service label, not merely by plist presence. The post-query is
 * authoritative: a failed bootout is harmless only when the service is proven
 * absent afterward.
 *
 * After the first bootout, settle across a short deadline. launchctl can still
 * report the service as loaded for a moment while the daemon exits; a single
 * immediate inspect is what made Option B's `seorak stop` print a failure for a
 * service that was already leaving. Re-issue bootout while it remains loaded so
 * an interrupted first call is not the only attempt. Unknown inspection during
 * settle fails closed rather than inventing absence.
 */
export function stopLaunchdService(
  label: string = LAUNCHD_LABEL,
  spawn: LaunchctlSpawn = spawnSync,
  platformName: NodeJS.Platform = platform(),
  timing: LaunchdStopTiming = {},
): LaunchdStopResult {
  if (platformName !== "darwin") {
    return { stopped: true, attempted: false, error: null };
  }
  const before = inspectLaunchdService(label, spawn, platformName);
  if (before.state === "unknown") {
    return { stopped: false, attempted: false, error: before.error };
  }
  if (before.state === "absent") {
    return { stopped: true, attempted: false, error: null };
  }

  const nowMs = timing.nowMs ?? Date.now;
  const sleepMs = timing.sleepMs ?? defaultSleepMs;
  const settleDeadlineMs =
    timing.settleDeadlineMs ?? LAUNCHD_STOP_SETTLE_DEADLINE_MS;
  const settlePollMs = timing.settlePollMs ?? LAUNCHD_STOP_SETTLE_POLL_MS;

  let lastBootout = bootoutService(label, spawn);
  const deadline = nowMs() + settleDeadlineMs;
  let after = inspectLaunchdService(label, spawn, platformName);
  while (after.state === "loaded" && nowMs() < deadline) {
    sleepMs(settlePollMs);
    lastBootout = bootoutService(label, spawn);
    after = inspectLaunchdService(label, spawn, platformName);
  }

  if (after.state === "absent") {
    return { stopped: true, attempted: true, error: null };
  }
  if (after.state === "unknown") {
    return {
      stopped: false,
      attempted: true,
      error:
        after.error ||
        lastBootout.stderr?.trim() ||
        "launchctl could not prove whether the service stopped",
    };
  }
  return {
    stopped: false,
    attempted: true,
    error:
      lastBootout.stderr?.trim() ||
      "launchctl still reports the service as loaded",
  };
}

/**
 * local-notify.ts — telling the person at the keyboard, from their own machine.
 *
 * This is the delivery leg of the local watch engine. `local-intervention.ts`
 * decides WHETHER a fire happened and records it; this decides only how to say
 * it, and the split is deliberate: a recorded fire is the truth about what was
 * measured whether or not a notification ever appeared, so a delivery failure
 * must never be able to erase or suppress the history.
 *
 * NO INTERPOLATION INTO A SCRIPT. The notification text carries a repo basename
 * the user chose, and building an AppleScript by string concatenation would make
 * a directory named `x" & (do shell script "…")` an execution vector on the
 * machine that owns every session. So the script below is a CONSTANT that reads
 * its three strings from `argv`, and the values travel as process arguments,
 * which cross no shell and no parser. There is no quoting rule to get right
 * because nothing is quoted.
 *
 * THE PLATFORM ANSWER IS HONEST. macOS is the only platform with a delivery path
 * here today. Everywhere else this reports `unsupported-platform` and delivers
 * nothing, rather than pretending. What the caller does with that is record it;
 * what it must not do is drop the fire.
 *
 * A NOTE ON WHAT THE USER WILL SEE. `osascript` posts under the notifying
 * application's identity, so a banner from a daemon launched by launchd is
 * attributed to whatever is hosting the script rather than to Seorak, and macOS
 * requires notification permission for that host. That is a packaging question
 * (a signed app bundle with its own identity), not an engine one, and it is
 * documented rather than worked around with a second dependency.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { platform } from "node:os";
import type { Intervention } from "@seorak/types";

/**
 * The whole script, as a constant. `argv` carries body, title and subtitle in
 * that order; `display notification` takes them as VALUES, so no character in
 * any of them can change what runs.
 */
const NOTIFY_SCRIPT = `on run argv
  display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)
end run`;

/** How a single delivery attempt ended. */
export interface LocalDeliveryResult {
  delivered: boolean;
  /** Present only on a failure, and always one of a closed set so a caller can
   *  branch without reading prose. */
  reason?: "unsupported-platform" | "notifier-failed";
}

export type NotifySpawn = typeof spawnSync;

/**
 * Post one fired intervention as a desktop notification.
 *
 * Never throws. A notifier that is missing, refused permission, or wedged is a
 * failure to TELL the user about a measurement, and the measurement is already
 * safe on disk; taking down the sweep over it would trade the history for the
 * banner.
 */
export function deliverLocalIntervention(
  intervention: Intervention,
  spawn: NotifySpawn = spawnSync,
  platformName: NodeJS.Platform = platform(),
): LocalDeliveryResult {
  if (platformName !== "darwin") {
    return { delivered: false, reason: "unsupported-platform" };
  }
  let result: SpawnSyncReturns<string>;
  try {
    result = spawn(
      "osascript",
      [
        "-e",
        NOTIFY_SCRIPT,
        // Project-as-title: the repo is the title, the catalog label the
        // subtitle, and the warm sentence the body — the same shape the push
        // projection uses, so a user sees one product speaking one way.
        intervention.body,
        intervention.project,
        intervention.signalLabel,
      ],
      { encoding: "utf8", timeout: 5_000 },
    );
  } catch {
    return { delivered: false, reason: "notifier-failed" };
  }
  return result.status === 0
    ? { delivered: true }
    : { delivered: false, reason: "notifier-failed" };
}

/**
 * Deliver a sweep's worth of fires, reporting what happened in aggregate.
 *
 * The counts exist so the daemon can log a delivery that silently did nothing —
 * an engine that fires perfectly into a void the user never sees is the failure
 * mode worth being able to notice.
 */
export function deliverLocalInterventions(
  interventions: readonly Intervention[],
  spawn: NotifySpawn = spawnSync,
  platformName: NodeJS.Platform = platform(),
): { delivered: number; failed: number; unsupported: boolean } {
  let delivered = 0;
  let failed = 0;
  let unsupported = false;
  for (const intervention of interventions) {
    const result = deliverLocalIntervention(intervention, spawn, platformName);
    if (result.delivered) delivered += 1;
    else {
      failed += 1;
      if (result.reason === "unsupported-platform") unsupported = true;
    }
  }
  return { delivered, failed, unsupported };
}

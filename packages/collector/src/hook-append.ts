import { type SessionEvent } from "@seorak/types";
import { appendEvent } from "./append.ts";
import { recordCaptureFailure } from "./capture-failure.ts";
import {
  acquireHookCaptureLease,
  collectorCaptureRevoked,
  resolveCollectorLifecyclePaths,
} from "./collector-lifecycle.ts";
import { EventLogLockTimeoutError } from "./event-log.ts";
import { hookCaptureEnabled, hookLauncherLabel } from "./hook-capture.ts";
import { recordLocalSessionLauncher } from "./local-store.ts";
import {
  resolveEventLogPathContext,
  type EventLogPathContext,
} from "./paths.ts";
import { collectorDir } from "./paths.ts";

export type HookEventAppender = (event: SessionEvent) => Promise<boolean>;

/**
 * Enter before parsing or deriving a hook event; held until process exit.
 *
 * The single gate every installed hook entry passes through, and therefore the
 * one place a refusal belongs: all five hook executables (six Claude Code
 * bindings) call this FIRST and exit 0 on `null`. Refusing here rather than at
 * the appender is what keeps a refusal whole. A per-event check would let a
 * session start and never end, or record tool calls with no session, and a
 * half-captured session is worse than none.
 *
 * `SEORAK_CAPTURE=0` is checked before any path is resolved, so a refused
 * invocation reads no payload, shells out to no `git`, and does not so much as
 * create the collector state directory.
 */
export async function acquireHookInvocationLease(): Promise<
  (() => void) | null
> {
  if (!hookCaptureEnabled()) return null;
  return await acquireHookCaptureLease(
    resolveCollectorLifecyclePaths(collectorDir()),
  );
}

/**
 * One hook invocation owns one immutable collector path context. A lock timeout
 * is the only append failure a hook may contain: it records a durable,
 * content-free gap and lets the host session continue. Validation, permissions,
 * and every other filesystem failure remain explicit process failures.
 */
export function createHookEventAppender(
  paths: EventLogPathContext = resolveEventLogPathContext(),
): HookEventAppender {
  if (collectorCaptureRevoked(paths.directory)) {
    return async () => false;
  }
  let timedOut = false;
  return async (event: SessionEvent): Promise<boolean> => {
    if (timedOut || collectorCaptureRevoked(paths.directory)) return false;
    try {
      await appendEvent(event, paths);
      return true;
    } catch (error) {
      if (!(error instanceof EventLogLockTimeoutError)) throw error;
      await recordCaptureFailure(paths);
      timedOut = true;
      return false;
    }
  };
}

/**
 * Record the `SEORAK_LAUNCHER` label for a session whose `session.start` was just
 * appended. A no-op when no valid label is set or capture has been revoked.
 *
 * Unlike an event append, a failure here is contained completely: the label is
 * attribution, not a measurement, and a session that loses it reads as unlabeled
 * (unknown), which is still true. Failing the host's SessionStart over it would
 * trade a real session for a label.
 */
export function recordHookSessionLauncher(
  sessionId: string,
  paths: EventLogPathContext = resolveEventLogPathContext(),
): boolean {
  const label = hookLauncherLabel();
  if (label === undefined || collectorCaptureRevoked(paths.directory)) return false;
  try {
    return recordLocalSessionLauncher(sessionId, label, paths.directory);
  } catch {
    return false;
  }
}

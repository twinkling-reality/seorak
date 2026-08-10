import { type SessionEvent } from "@seorak/types";
import { appendEvent } from "./append.ts";
import { recordCaptureFailure } from "./capture-failure.ts";
import {
  acquireHookCaptureLease,
  collectorCaptureRevoked,
  resolveCollectorLifecyclePaths,
} from "./collector-lifecycle.ts";
import { EventLogLockTimeoutError } from "./event-log.ts";
import {
  resolveEventLogPathContext,
  type EventLogPathContext,
} from "./paths.ts";
import { collectorDir } from "./paths.ts";

export type HookEventAppender = (event: SessionEvent) => Promise<boolean>;

/** Enter before parsing or deriving a hook event; held until process exit. */
export async function acquireHookInvocationLease(): Promise<
  (() => void) | null
> {
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

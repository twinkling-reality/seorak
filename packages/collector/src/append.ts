import { type SessionEvent } from "@seorak/types";
import { parseSessionEvent } from "@seorak/types/event-validation";
import { assertEmitSafe } from "./emit.ts";
import { appendEventLine } from "./event-log.ts";
import { appendLocalEvent } from "./local-store.ts";
import {
  resolveEventLogPathContext,
  type EventLogPathContext,
} from "./paths.ts";

export async function appendEvent(
  event: SessionEvent,
  paths: EventLogPathContext = resolveEventLogPathContext(),
): Promise<void> {
  // The shared HTTP schema runs first and fails with a content-free error. The
  // collector-specific allowlist below remains an independent privacy tripwire.
  if (parseSessionEvent(event) === null) {
    throw new Error("event failed shared protocol validation");
  }
  // Tripwire: throws on any un-allowlisted key BEFORE the line touches disk, so
  // content that the widened HookInput puts one property access away can never
  // be emitted. See emit.ts.
  assertEmitSafe(event);
  await appendEventLine(
    JSON.stringify(event) + "\n",
    paths,
    {},
    // SQLite commits before the compatibility JSONL append. If the file append
    // then fails, a retry is event-id idempotent and the permanent local copy is
    // already safe. The reverse order could acknowledge capture while losing
    // the only non-reclaimable copy across a crash.
    () => {
      appendLocalEvent(event, paths.directory);
    },
  );
}

/**
 * capture-settings.ts — on-machine enforcement of the Data & capture toggles.
 *
 * The web writes toggles to the worker (PUT /settings); the DAEMON polls them
 * down into a local cache file (capture.json) on a slow cadence; the capture
 * sites — the hook adapters and the momentum sweep — read the CACHE, never the
 * network, so a hook invocation stays fast and offline-safe.
 *
 * Direction of trust (CAPTURE-PRINCIPLE): these settings only ever REDUCE
 * capture. A worker can never instruct this collector to send more than the
 * emit allowlist permits — the allowlist is the boundary, this is a dial below
 * it. Fault-soft, defaults-on: a missing/corrupt cache or an unreachable
 * worker reads as DEFAULT_CAPTURE_SETTINGS.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  bearerHeader,
  coerceCaptureSettings,
  seorakRoutes,
  type CaptureSettings,
} from "@seorak/types";
import { captureSettingsPath } from "./paths.ts";

// Read-once-per-process cache. Hook scripts are short-lived (one event each),
// so they see a fresh file every invocation; the long-lived daemon resets this
// after each successful sync below.
let cached: CaptureSettings | undefined;

/** The effective capture settings, from the local cache file. Defaults-on when
 *  the cache is absent or corrupt. */
export function captureSettings(): CaptureSettings {
  if (cached === undefined) {
    try {
      cached = coerceCaptureSettings(JSON.parse(readFileSync(captureSettingsPath(), "utf8")));
    } catch {
      cached = coerceCaptureSettings(undefined);
    }
  }
  return cached;
}

/** Drop the per-process cache so the next captureSettings() re-reads the file.
 *  Called by the daemon after a sync, and by tests. */
export function resetCaptureSettingsCache(): void {
  cached = undefined;
}

/**
 * Daemon-side sync: GET the worker's /settings and refresh the local cache
 * atomically (temp + rename, same crash-safety move as writeOffset). Never
 * throws — an unreachable worker leaves the previous cache (or the defaults)
 * in force; capture must not flap on network weather.
 *
 * `readKey` is the owner-lock READ token: GET /settings is gated by the worker's
 * `requireReadAuth` (SEORAK_READ_KEY), NOT the ingest guard, so the caller passes
 * `SEORAK_READ_KEY ?? SEORAK_INGEST_KEY` — an armed worker 401s an ingest-only
 * key. Empty against an open/local worker (no header sent).
 */
export async function syncCaptureSettings(
  workerUrl: string,
  readKey = "",
  shutdownSignal?: AbortSignal,
): Promise<void> {
  try {
    const timeout = AbortSignal.timeout(5_000);
    const signal = shutdownSignal
      ? AbortSignal.any([shutdownSignal, timeout])
      : timeout;
    const res = await fetch(`${workerUrl}${seorakRoutes.settings()}`, {
      headers: bearerHeader(readKey),
      signal,
    });
    if (!res.ok) return;
    const body = (await res.json()) as { capture?: unknown };
    const next = coerceCaptureSettings(body?.capture);
    const path = captureSettingsPath();
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(next), "utf8");
    renameSync(tmp, path);
    resetCaptureSettingsCache();
  } catch (error) {
    if (shutdownSignal?.aborted) return;
    console.error("[seorak/collector] capture-settings sync failed", error);
  }
}

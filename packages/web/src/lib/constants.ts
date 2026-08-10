/** Polling timing constants (milliseconds). */

/** Default interval between HTTP poll cycles. 30s keeps a single open dashboard tab
 *  inside the Workers KV free-tier read cap (100k/day) even with a full index, and
 *  with /overview behind a conditional GET an unchanged poll is one D1 version row. */
export const POLL_MS = 30_000;

/** Slow-mode poll interval after repeated failures — genuinely SLOWER than POLL_MS
 *  (was equal, a no-op) so a server in distress is polled at half the rate, easing
 *  back-pressure while still recovering quickly on the first success. */
export const SLOW_POLL_MS = 60_000;

/** Live-board cadence WHILE a session is live. GET /live is the fresh, zero-D1
 *  head (DATA-LAYER §ADR-002/006): KV-only, so it is safe to poll fast for the
 *  live feel — ~8s active over a day is ~10.8k KV reads, well under the 100k/day
 *  free cap. The heavy /overview body stays on the slow 30s cadence behind a 304. */
export const LIVE_POLL_MS = 8_000;

/** Live-board cadence WHILE nothing is live. Slow enough to stay idle-cheap
 *  (~1.4k reads/day), fast enough to notice a NEW session within a minute — the
 *  activity gate that keeps an idle open tab off the free-tier cap (§ADR-006). */
export const LIVE_IDLE_POLL_MS = 60_000;

// --- Display limits ---

/** Max recent sessions shown in the project view sidebar. */
export const MAX_DISPLAY_SESSIONS = 8;

/** Max recent sessions retained for project-level analytics. */
export const MAX_RECENT_SESSIONS = 24;

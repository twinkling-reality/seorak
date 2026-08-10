/**
 * env-numbers.ts — the ONE parse for a numeric env override.
 *
 * Extracted from codex-tailer.ts (`positiveIntOr`, same name and semantics) once
 * the daemon needed the identical guard for its four cadences. The failure is
 * shared: `Number("garbage")` is NaN and `Number("")` is 0, and a timer given
 * either runs at ~1ms, so one typo in one env var turns a background cadence
 * into a hot loop that burns CPU and hammers the worker. The same slip freezes
 * the tailer instead (`n < NaN` is always false) — opposite symptom, one cause,
 * so one helper.
 *
 * FALLBACK, NEVER CLAMP: an out-of-range value is a typo, and the DOCUMENTED
 * default is the only value a reader can predict from the README. Clamping
 * would leave the daemon running a cadence that is written down nowhere.
 */

/** setTimeout/setInterval hold their delay in a SIGNED 32-BIT int (~24.8 days).
 *  A larger value overflows: Node prints TimeoutOverflowWarning and runs the
 *  timer at 1ms — the same hot loop NaN produces, arrived at from the opposite
 *  end. Every value below that ends up in a timer therefore carries this as its
 *  ceiling; it is a runtime limit, not a policy we chose. */
export const MAX_TIMER_MS = 2_147_483_647;

/** Parse an env override to a positive integer, else the fallback — a blank,
 *  non-numeric, zero, or negative value must never stall the loop (Number("")
 *  is 0 and `n < NaN` is always false, both of which would silently freeze the
 *  tail with no error — review finding). Mirrors intervention.ts positiveOr. */
export function positiveIntOr(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** positiveIntOr with an explicit floor and ceiling: anything outside the band
 *  reads as the documented default. The floor is per-variable (what the tick
 *  actually costs — a git subprocess per repo is not a thing to run every
 *  millisecond); the ceiling is MAX_TIMER_MS for anything a timer receives. */
export function boundedIntOr(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = positiveIntOr(raw, fallback);
  return n >= min && n <= max ? n : fallback;
}

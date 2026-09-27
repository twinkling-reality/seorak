/**
 * Memo for the local plane's projections.
 *
 * Why. `/overview` rebuilt the whole projection on every request. Measured on a
 * real 344,363-row history (2026-09-09): 680ms at 7 days, 2.4s at 30, 2.9s at 90,
 * with no reuse between identical back-to-back calls. The CPU profile puts 35.8%
 * of that in `streamEvents` and roughly 13% more in re-validating each stored
 * payload with zod, so the cost is per-event and scales with the window rather
 * than sitting in one slow statement. The dashboard polls this endpoint every
 * 30s (`POLL_MS`), so an idle reader paid seconds of work every 30 seconds to be
 * handed a projection identical to the one it already had.
 *
 * The key is the event high-water mark. `local_seq` is `INTEGER PRIMARY KEY
 * AUTOINCREMENT`, so `MAX(local_seq)` is an index lookup measured at 0ms against
 * that same history, and opening the database to ask costs 0-3ms. Any appended
 * event moves it, so capture invalidates the memo immediately and active work
 * never reads a stale total.
 *
 * Why a max age on top of the high-water key. Two pieces of the snapshot move
 * without an event being appended. `liveSessionsOn` ages sessions out against
 * `ABANDONED_THRESHOLD_MS`, which is 30 minutes, and a session's own elapsed
 * time advances with the clock. Both are answered by re-deriving within a minute,
 * and a 30-minute threshold cannot notice a 60-second memo. The bound exists so
 * that any future time-dependent leg inherits a ceiling rather than a promise.
 *
 * Why this is honest rather than a stale read. `OverviewSnapshot.generatedAt` is
 * defined as when the snapshot was COMPUTED, so a memo hit reports the real
 * computation instant and the surface's freshness contract reads it correctly. A
 * cached snapshot does not claim to be newer than it is. The type's own comments
 * already describe an aggregate cache on the hosted side for the same reason, so
 * this is the local plane adopting an established property, not a new liberty.
 */

/** How long a memo entry may serve after the instant it was computed. Chosen
 *  against `ABANDONED_THRESHOLD_MS` (30 minutes), the coarsest clock-dependent
 *  leg in the snapshot, and above the dashboard's 30s poll so an idle reader
 *  actually hits it. */
export const PROJECTION_MEMO_MAX_AGE_MS = 60_000;

/** Entries retained. Three windows times a couple of projections and filter states is the
 *  whole realistic working set; the bound is here so a plane serving odd queries
 *  cannot grow this without limit. */
export const PROJECTION_MEMO_MAX_ENTRIES = 16;

export interface ProjectionMemoKeyParts {
  /** Which projection. Two builders must never share an entry. */
  kind: string;
  directory: string | undefined;
  /** Everything else the builder reads: the window, a repo filter, an archive
   *  set. Anything JSON-encodable, because it is encoded rather than joined. */
  parameters: unknown;
  highWater: number;
}

/**
 * PURE. Everything that changes the projection is in the key, so a hit is a
 * snapshot the builder would have produced again. The archive set is sorted
 * because two equal sets must not produce two keys.
 */
export function projectionMemoKey(parts: ProjectionMemoKeyParts): string {
  // Encoded, never joined. A delimiter is only unambiguous while no member can
  // contain it: `directory` is an arbitrary filesystem path, and a parameter set
  // can hold arbitrary ids, so `["a,b"]` and `["a", "b"]` must not collapse into
  // one key. A raw NUL would be unforgeable but makes the file binary to grep,
  // which `bytes:check` refuses and is right to.
  return JSON.stringify([
    parts.kind,
    parts.directory ?? "",
    String(parts.highWater),
    stableParameters(parts.parameters),
  ]);
}

/**
 * PURE. JSON with object keys sorted, so two equal parameter sets that were
 * built in different property orders produce one key rather than two. Sets and
 * Maps are not handled on purpose: callers pass plain data, and silently
 * accepting a Set that stringifies to `{}` would collapse distinct keys.
 */
function stableParameters(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) => {
    if (
      typeof raw !== "object" ||
      raw === null ||
      Array.isArray(raw)
    ) {
      return raw;
    }
    const entries = Object.entries(raw as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return Object.fromEntries(entries);
  });
}

/** PURE. Separated so the age rule is testable without a cache instance. */
export function projectionMemoIsFresh(
  computedAtMs: number,
  nowMs: number,
  maxAgeMs = PROJECTION_MEMO_MAX_AGE_MS,
): boolean {
  const age = nowMs - computedAtMs;
  // A negative age means the clock moved backwards. Treat that as stale rather
  // than as infinitely fresh: recomputing costs a request, trusting a bad clock
  // costs correctness.
  return age >= 0 && age < maxAgeMs;
}

interface Entry<T> {
  key: string;
  computedAtMs: number;
  value: T;
}

/**
 * Insertion-ordered memo. Small enough that a linear scan beats any index, and
 * `Map` iteration order gives eviction of the oldest entry for free.
 */
export class ProjectionMemo<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #maxAgeMs: number;
  readonly #maxEntries: number;

  constructor(
    maxAgeMs = PROJECTION_MEMO_MAX_AGE_MS,
    maxEntries = PROJECTION_MEMO_MAX_ENTRIES,
  ) {
    this.#maxAgeMs = maxAgeMs;
    this.#maxEntries = maxEntries;
  }

  get(key: string, nowMs: number): T | null {
    const entry = this.#entries.get(key);
    if (entry === undefined) return null;
    if (!projectionMemoIsFresh(entry.computedAtMs, nowMs, this.#maxAgeMs)) {
      this.#entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, computedAtMs: number, value: T): void {
    // Delete first so a refreshed key moves to the END of the insertion order
    // and is not the next thing evicted.
    this.#entries.delete(key);
    this.#entries.set(key, { key, computedAtMs, value });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  /** Test seam and a safety valve for callers that change the world underneath
   *  the memo (an import, a rebaseline) rather than appending to it. */
  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}

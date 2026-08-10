/**
 * project-merges.ts — the project ALIAS contract: the family that stitches
 * multiple salted repoIds that are really ONE project back together. A git
 * rename/transfer/protocol change rotates the origin-seeded repoId; a folder
 * move or an iCloud path split rotates the path-seeded one — either way one
 * project fragments into separate cards. Keyed by the salted repoId, NEVER a
 * basename (two distinct repos can share a basename — merging is an explicit,
 * per-id user choice, never inferred from the label).
 *
 * Shape: `byRepo` maps a non-canonical repoId → the canonical repoId it folds
 * into. The aggregation layer resolves every repoId through this map BEFORE it
 * groups, so a merged project's sessions/cost/tokens/models/lines sum under one
 * card with no per-surface change. A repo absent from the map is its own
 * canonical id (honest-empty: no fabricated grouping).
 *
 * Fault-soft like every settings family (mirrors `coerceProjectThemes`): an
 * entry whose key or value is not a valid salted repoId, or a self-map
 * (key === value), is DROPPED by `coerceProjectMerges` — so a corrupt row can
 * never wrongly merge two distinct repos, and setting an entry to null / itself
 * is the "unmerge" patch. Cycles/chains are resolved (not flattened) at read
 * time by `resolveCanonicalRepoId`, so the stored map stays a faithful record of
 * intent.
 */

/** A salted repoId is a sha256 hex digest — mirrors the collector's mint and the
 *  worker's `SALTED_REPO_ID` gate (sessions.ts). The "All projects" aggregate id
 *  "" is deliberately not matched, so it can never be a merge key or target. */
export const SALTED_REPO_ID = /^[0-9a-f]{64}$/;

export function isSaltedRepoId(v: unknown): v is string {
  return typeof v === "string" && SALTED_REPO_ID.test(v);
}

export interface ProjectMerges {
  /** non-canonical repoId → canonical repoId. Empty by default (honest-empty:
   *  no project is grouped with another until the user says so). */
  byRepo: Record<string, string>;
}

export const DEFAULT_PROJECT_MERGES: ProjectMerges = { byRepo: {} };

/**
 * Coerce an unknown (stored row, request body, fetched JSON) into a valid
 * ProjectMerges, allowlist-based like `coerceProjectThemes`: an entry survives
 * ONLY when both its key and value are valid salted repoIds AND they differ. A
 * null / "" / non-hex value, or a self-map, is dropped (that is the "unmerge"
 * patch). Chains and cycles are NOT flattened here — `resolveCanonicalRepoId`
 * walks them safely at read time.
 */
export function coerceProjectMerges(raw: unknown): ProjectMerges {
  const obj =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawByRepo =
    obj.byRepo && typeof obj.byRepo === "object" && !Array.isArray(obj.byRepo)
      ? (obj.byRepo as Record<string, unknown>)
      : {};
  const byRepo: Record<string, string> = {};
  for (const [repoId, value] of Object.entries(rawByRepo)) {
    if (!isSaltedRepoId(repoId)) continue;
    if (!isSaltedRepoId(value)) continue; // null / "" / bad target => unmerge (dropped)
    if (repoId === value) continue; // self-map => unmerge (dropped)
    byRepo[repoId] = value;
  }
  return { byRepo };
}

/**
 * Resolve a repoId to its canonical id by following the `byRepo` chain, with a
 * visited-set + depth cap so a cycle or a pathological chain can never loop or
 * blow the stack — it stops and returns the last id reached. A repo absent from
 * the map resolves to itself (identity), so callers use this unconditionally.
 */
export function resolveCanonicalRepoId(merges: ProjectMerges, repoId: string): string {
  let current = repoId;
  const seen = new Set<string>([current]);
  for (let hops = 0; hops < 32; hops += 1) {
    const next = merges.byRepo[current];
    if (next === undefined || next === current || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }
  return current;
}

/**
 * Build a memoized `canonical()` resolver bound to a merge map. Returns the
 * identity function when the map is empty, so the hot aggregation path pays
 * nothing until a user actually merges something.
 */
export function makeCanonicalResolver(merges: ProjectMerges): (repoId: string) => string {
  if (Object.keys(merges.byRepo).length === 0) return (r) => r;
  const cache = new Map<string, string>();
  return (repoId: string): string => {
    const hit = cache.get(repoId);
    if (hit !== undefined) return hit;
    const canonical = resolveCanonicalRepoId(merges, repoId);
    cache.set(repoId, canonical);
    return canonical;
  };
}

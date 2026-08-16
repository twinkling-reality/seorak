/**
 * Persistent intervention ledger for the machine that owns the history.
 *
 * Schema ownership stays in `local-store.ts` (v4 migration creates
 * `local_intervention_fire`). This module is the ledger API only: record a
 * fire with rolling-window dedupe, and list fires inside that same window.
 * Delivery and evaluation live in `local-intervention.ts`.
 *
 * Same sibling-store shape as `local-integration-store.ts`: open the shared
 * history database through `openLocalHistory`, never import the worker.
 */
import { createHash } from "node:crypto";
import { openLocalHistory } from "./local-store.ts";

/** The rolling window a fire both dedupes against and is listed from. */
export const LOCAL_INTERVENTION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Bound on one history read, so a pathological log cannot return unboundedly. */
export const LOCAL_INTERVENTION_HISTORY_LIMIT = 500;

/**
 * Record one fire unless the same identity already fired inside the rolling
 * window. Returns false when it was deduped, so only the caller that actually
 * inserted the row may go on to deliver it.
 *
 * The existence check and the insert are ONE statement: the plane's read path
 * and the daemon's sweep are separate processes against the same file, and two
 * of them evaluating the same crossing a millisecond apart must not both win.
 */
export function recordLocalInterventionFire(
  fire: {
    kind: string;
    sessionId: string;
    repoId: string;
    triggeredAt: string;
  },
  interventionJson: string,
  dedupeKey: string,
  held: boolean,
  options: { directory?: string; nowMs?: number } = {},
): boolean {
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(
    nowMs - LOCAL_INTERVENTION_WINDOW_MS,
  ).toISOString();
  const database = openLocalHistory(options.directory);
  try {
    const changes = database
      .prepare(
        `INSERT INTO local_intervention_fire (
           fire_id, dedupe_key, kind, session_id, repo_id,
           intervention_json, held, triggered_at, created_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM local_intervention_fire
             WHERE dedupe_key = ?
               AND triggered_at > ?
               AND triggered_at <= ?
          )`,
      )
      .run(
        createHash("sha256")
          // `\u0000` as an ESCAPE, never a literal NUL. One raw NUL byte makes
          // the file read as BINARY to grep and every other text tool, which
          // silently hides every symbol from anyone auditing the module.
          // `CURSOR_SEPARATOR` in local-store.ts documents the same rule; the
          // two are the same decision and must stay spelled the same way.
          .update(`${dedupeKey}\u0000${fire.triggeredAt}`)
          .digest("hex"),
        dedupeKey,
        fire.kind,
        fire.sessionId,
        fire.repoId,
        interventionJson,
        held ? 1 : 0,
        fire.triggeredAt,
        nowIso,
        dedupeKey,
        cutoffIso,
        nowIso,
      );
    if (Number(changes.changes) === 0) return false;
    // Prune past the window in the same call. The ledger answers one rolling
    // day, so anything older is unreadable by every caller and only grows the
    // file; the retention rule and the read bound stay the same number.
    database
      .prepare("DELETE FROM local_intervention_fire WHERE triggered_at <= ?")
      .run(cutoffIso);
    return true;
  } finally {
    database.close();
  }
}

/**
 * Fires inside the rolling window, newest first, as stored JSON strings.
 *
 * The caller decodes: this module owns the table, not the `Intervention`
 * contract, and a row that no longer parses must be dropped by the layer that
 * knows the shape rather than half-read here.
 */
export function listLocalInterventionFires(
  options: { directory?: string; nowMs?: number; limit?: number } = {},
): string[] {
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(
    nowMs - LOCAL_INTERVENTION_WINDOW_MS,
  ).toISOString();
  const limit = Math.max(
    1,
    Math.min(
      LOCAL_INTERVENTION_HISTORY_LIMIT,
      options.limit ?? LOCAL_INTERVENTION_HISTORY_LIMIT,
    ),
  );
  const database = openLocalHistory(options.directory);
  try {
    return database
      .prepare(
        `SELECT intervention_json FROM local_intervention_fire
          WHERE triggered_at > ? AND triggered_at <= ?
          ORDER BY triggered_at DESC, created_at DESC, fire_id DESC
          LIMIT ?`,
      )
      .all(cutoffIso, nowIso, limit)
      .map((row) =>
        String((row as { intervention_json?: unknown }).intervention_json),
      );
  } finally {
    database.close();
  }
}

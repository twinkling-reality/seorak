// ── Codex rollout event ids (deterministic, re-tail-idempotent) ──────────────
//
// A Codex adapter TAILS append-only rollout JSONL files under
// `~/.codex/sessions/**/rollout-*.jsonl` from a daemon. The worker dedupes
// ingested events on the `event_id` primary key with `INSERT OR IGNORE`
// (packages/worker/src/eventlog/store.ts:71). So if a daemon restart re-tails a
// rollout file and re-emits its rows, the ONLY thing that stops every token and
// dollar from being double-counted is that a re-emitted row carries the SAME
// event id as the first emission — then `INSERT OR IGNORE` collapses it to a
// no-op. There is no later way to un-mix a double count, so this id MUST be a
// pure function of WHICH ROW it is, never of anything minted fresh per emission.
//
// This mirrors the existing outcome-event precedent in survival.ts:345
// (`saltedHash(\`linesurvival\0${sessionId}\0${rung}\`)`): a `\0`-delimited seed
// under a namespace token, run through `saltedHash` so the id is machine-salted,
// non-reversible, and free of raw content when it leaves the machine.
//
// Anchor = the row's BYTE OFFSET (the file position at which its JSON line
// begins), NOT any cumulative value carried in the row. Codex `token_count` rows
// repeat their cumulative `total_tokens` across distinct rows (observed: four
// rows sharing total_tokens=11281077 in one real rollout), and a context
// compaction replays cumulative values wholesale; anchoring on such a value
// would collide those rows under `INSERT OR IGNORE` and silently DROP all but
// one. A byte offset is reset-immune because rollout files are strictly
// append-only (verified: across 103 real files / 44,789 rows no timestamp ever
// moved backwards, and `compacted` / `thread_rolled_back` are APPENDED row types
// rather than rewrites), so the starting offset of an already-written line never
// shifts as the file grows. Byte offset (over a line ordinal) is also what the
// tailer's resume cursor already tracks, so there is one source of truth for
// "where am I in this file", not a byte cursor plus a parallel line counter that
// can desync across a restart.
//
// CALLER CONTRACT:
//   - `rolloutFileName` is the BASENAME of the rollout file (e.g.
//     "rollout-2026-07-06T07-52-42-<uuid>.jsonl"), NEVER the absolute path: the
//     path's parent directories carry the OS username, which is content. The
//     basename holds only a timestamp + session uuid and is content-free. It is
//     part of the seed because the same `sessionId` can, in principle, span two
//     physical files, where byte offset alone would collide at offset 0.
//   - `byteOffset` is the offset of the START of a COMPLETE, newline-terminated
//     line. The tailer must never anchor on a partial trailing line.
//   - Determinism holds ONLY while the machine salt is stable (its normal steady
//     state). `readOrCreateSalt` has a known non-atomic cold-start race that is
//     fixed separately; a salt that changed mid-flight would change every id.
import { saltedHash } from "./git.ts";

/**
 * codexRolloutEventId(sessionId, rolloutFileName, byteOffset) — the deterministic
 * event id for one Codex rollout row. Same three inputs => same id, so re-tailing
 * the same row collapses on the D1 `event_id` PK for free. See the module header
 * for the anchor choice and the caller contract.
 */
export function codexRolloutEventId(
  sessionId: string,
  rolloutFileName: string,
  byteOffset: number,
): string {
  return saltedHash(`codex.rollout\0${sessionId}\0${rolloutFileName}\0${byteOffset}`);
}

/**
 * codexQuotaEventId(...) — the deterministic id for the `agent.quota` event derived from
 * a `token_count` row (CODEX-CAPTURE ADR-C15).
 *
 * A SEPARATE NAMESPACE TOKEN, AND THAT IS THE WHOLE POINT. A `token_count` row yields TWO
 * events — the `session.tokens` snapshot and the `agent.quota` reading — from the SAME
 * (sessionId, file, byteOffset). `codexRolloutEventId` does not put the kind in its seed,
 * so both would hash to the SAME id, and `INSERT OR IGNORE` would silently drop whichever
 * one lost the race. One of the two facts would simply never exist, with nothing failing.
 *
 * The fix is a distinct seed prefix, never adding the kind to `codexRolloutEventId`'s
 * seed: that would change the id of every row already written to D1, so any future
 * re-tail would re-emit the entire corpus under new ids and double-count all of it.
 * Existing ids are load-bearing history and must stay byte-stable forever.
 *
 * Same anchor and the same caller contract as its sibling: byte offset of the row, so a
 * re-tail re-derives the same id and the PK collapses it for free.
 */
export function codexQuotaEventId(
  sessionId: string,
  rolloutFileName: string,
  byteOffset: number,
): string {
  return saltedHash(`codex.quota\0${sessionId}\0${rolloutFileName}\0${byteOffset}`);
}

/**
 * codex-tailer.ts — the daemon-hosted tail loop over Codex rollout files
 * (capability contract: docs/specs/multi-tool.md).
 *
 * Each tick: discover `rollout-*.jsonl` under the Codex sessions root, read
 * every file's NEW complete lines from its persisted byte cursor, hand each
 * line to the adapter (adapters/codex.ts), append the resulting events
 * DURABLY, and only then advance + persist the cursor — the survival.ts
 * append-then-prune contract. A crash anywhere re-reads at worst one file's
 * batch, and the deterministic event ids collapse the re-emit on the worker's
 * `event_id` PK, so a re-tail is a no-op, never a double count.
 *
 * ACTIVATION CUTOFF (ADR-T3): the first tick ever persists `activatedAt`; a
 * file first discovered with mtime older than that is marked done (cursor at
 * EOF, skip) and never emits. Without this, the first run would flood ~100
 * long-dead sessions into the live reducer and the intervention cron would
 * push `went_cold` for work that ended weeks ago — fabricated attention.
 * The cutoff is a capture boundary, not an id input: every emitted id stays a
 * pure file-coordinate function, so the boundary can never cause a duplicate.
 * (Consequence, accepted: a pre-activation thread RESUMED later grows a
 * skipped file and stays uncaptured — an undercount, the honest direction.)
 *
 * BOUNDED BY CONSTRUCTION: at most MAX_ROWS_PER_TICK rows per file per tick
 * (a 45MB live-file backlog drains across ticks instead of producing one
 * mega-batch), reads happen in a bounded window that grows only when a single
 * line exceeds it, and the whole loop is a no-op when the Codex root does not
 * exist. Kill switch: SEORAK_CODEX=0 (checked by the daemon INSIDE the tick,
 * so the future capture-settings toggle slots in without a restart).
 *
 * PRIVACY: this module never inspects payloads — parsing and scrubbing live in
 * the adapter's total drop-by-default table; appendEvent's allowlist tripwire
 * is the runtime backstop. The state file holds absolute rollout paths as keys
 * and stays under ~/.seorak (local only, honors SEORAK_DIR).
 */
import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { SessionEvent } from "@seorak/types";
import {
  initialCodexFileState,
  parseRolloutLine,
  type CodexFileState,
  type CodexModelTokens,
  type CodexPendingCall,
  type CodexTokenTotals,
} from "./adapters/codex.ts";
import { appendEvent } from "./append.ts";
import { EmitAllowlistError } from "./emit.ts";
import { positiveIntOr } from "./env-numbers.ts";
import { codexTailStatePath } from "./paths.ts";

/** Rows handed to the adapter per file per tick — the backlog drain rate. */
const MAX_ROWS_PER_TICK = positiveIntOr(process.env.SEORAK_CODEX_MAX_ROWS_PER_TICK, 500);

/** A file whose last write landed within this window BEFORE activation is
 *  treated as live, not historical: the canonical first run starts the daemon
 *  while a Codex session is generating, and that file's mtime necessarily
 *  predates the just-minted activation by seconds (review finding — ADR-T3's
 *  "modified after activation" branch was unreachable for pre-existing files).
 *  30 minutes mirrors the worker reaper's idle window: one constant meaning
 *  "still plausibly a live session". */
const LIVE_GRACE_MS = 30 * 60 * 1000;
/** Initial read window; doubles (up to the cap) only when a single rollout
 *  line is longer than the window (observed rows average ~1KB; image-bearing
 *  rows can reach MBs). */
const READ_WINDOW_BYTES = 4 * 1024 * 1024;
const READ_WINDOW_CAP_BYTES = 64 * 1024 * 1024;

/** The shrunken size last LOGGED per rollout path, so a rewritten-in-place file
 *  reports its shrink ONCE rather than on every sweep tick forever: the cursor
 *  is deliberately held (a re-read of rewritten bytes at the same coordinates
 *  would mint wrong-content ids the worker's PK pins), so the shrunk condition
 *  otherwise persists across every tick. Re-logs only when the shrunk size
 *  changes (a further rewrite) or after the file recovers past its cursor (the
 *  entry is cleared on a normal read). In-memory: a daemon restart re-logs once,
 *  which is acceptable. Keyed by absolute path, pruned with the file's state. */
const shrinkLoggedSize = new Map<string, number>();

/** The Codex sessions root. Overridable for tests/sandboxes (SEORAK_CODEX_DIR),
 *  like SEORAK_DIR for the collector's own state. */
export function codexSessionsRoot(): string {
  return process.env.SEORAK_CODEX_DIR ?? join(homedir(), ".codex", "sessions");
}

/** The tail kill switch (ADR-T9): on unless SEORAK_CODEX=0. Checked inside the
 *  daemon's tick so flipping it never needs a restart. */
export function codexTailEnabled(): boolean {
  return process.env.SEORAK_CODEX !== "0";
}

/** Per-file persisted entry: the byte cursor + the adapter's session state.
 *  They persist TOGETHER (ADR-T2): the cursor without the state would re-emit
 *  session.start with a fresh offset after a mid-file restart. */
export interface CodexTailFileEntry extends CodexFileState {
  offset: number;
}

/**
 * The on-disk shape version of codex-tail.json, stamped by writeState on every
 * write. Exactly this version loads; anything else is refused rather than
 * guessed, because a wrong cursor interpretation can skip unread bytes or
 * re-emit different content at an already-used coordinate.
 */
export const CODEX_TAIL_STATE_VERSION = 1;

export interface CodexTailState {
  /** On-disk shape version. Exactly CODEX_TAIL_STATE_VERSION loads. */
  version: number;
  /** First-ever tick time — the activation cutoff (ADR-T3). */
  activatedAt: string;
  /** Keyed by ABSOLUTE rollout path (local only; never emitted). */
  files: Record<string, CodexTailFileEntry>;
}

const finiteNonNegative = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Rehydrate the cumulative watermark. Any malformed field drops the WHOLE reading to
 *  null rather than a partial one: a half-restored watermark would compute the next
 *  delta against a wrong base, which is worse than restarting the walk. */
function readPrevTokens(raw: unknown): CodexTokenTotals | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Partial<CodexTokenTotals>;
  if (
    !finiteNonNegative(t.input) ||
    !finiteNonNegative(t.cachedInput) ||
    !finiteNonNegative(t.output) ||
    !finiteNonNegative(t.total)
  ) {
    return null;
  }
  return { input: t.input, cachedInput: t.cachedInput, output: t.output, total: t.total };
}

/**
 * Rehydrate the held-but-unemitted tool calls (CODEX-CAPTURE ADR-C13).
 *
 * This MUST survive a restart. A tick boundary routinely falls between a call row and its
 * result row (the tailer reads at most MAX_ROWS_PER_TICK rows per file per tick, and a
 * live file is still being written), so dropping this map on reload would strand every
 * in-flight call: its call row is already behind the cursor and will never be re-read, and
 * its result row would arrive to find no pending entry and emit nothing. Those tool calls
 * would be lost outright.
 *
 * A malformed entry is dropped individually rather than poisoning the map. A dropped entry
 * costs exactly one unstamped tool call, which is an undercount; a coerced one would mint
 * an event at a fabricated byte offset, which is a wrong event id forever.
 */
function readPendingCalls(raw: unknown): Record<string, CodexPendingCall> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, CodexPendingCall> = {};
  for (const [callId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
    const c = v as Partial<CodexPendingCall>;
    if (!finiteNonNegative(c.offset)) continue;
    if (typeof c.at !== "string" || !Number.isFinite(Date.parse(c.at))) continue;
    if (c.toolName !== "Shell" && c.toolName !== "ApplyPatch" && c.toolName !== "other") {
      continue;
    }
    out[callId] = { offset: c.offset, at: c.at, toolName: c.toolName };
  }
  return out;
}

/** Rehydrate the per-model accumulator, dropping any entry that does not round-trip as
 *  three non-negative numbers. A dropped entry undercounts; a coerced one fabricates. */
function readTokensByModel(raw: unknown): Record<string, CodexModelTokens> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, CodexModelTokens> = {};
  for (const [model, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
    const t = v as Partial<CodexModelTokens>;
    if (
      !finiteNonNegative(t.inputTokens) ||
      !finiteNonNegative(t.outputTokens) ||
      !finiteNonNegative(t.cacheReadTokens)
    ) {
      continue;
    }
    out[model] = {
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      cacheReadTokens: t.cacheReadTokens,
    };
  }
  return out;
}

/** Rehydrate the per-file map. An entry whose cursor is not a finite
 *  non-negative number is dropped whole: a cursor is the one field with no
 *  honest default, and a coerced one would either re-emit at wrong coordinates
 *  or skip unread bytes. */
function readFileEntries(raw: Record<string, unknown>): Record<string, CodexTailFileEntry> {
  const files: Record<string, CodexTailFileEntry> = {};
  for (const [path, value] of Object.entries(raw)) {
    const e = (value ?? {}) as Partial<CodexTailFileEntry>;
    if (typeof e.offset !== "number" || !Number.isFinite(e.offset) || e.offset < 0) continue;
    files[path] = {
      offset: e.offset,
      sessionId: typeof e.sessionId === "string" ? e.sessionId : null,
      startOffset: typeof e.startOffset === "number" ? e.startOffset : null,
      startEmitted: e.startEmitted === true,
      skip: e.skip === true,
      // The token walk MUST survive a restart (CODEX-CAPTURE ADR-C2). Losing
      // `prevTokens` mid-file would make the next reading's delta the session's WHOLE
      // cumulative total, and losing `tokensByModel` would then bank all of it against
      // whichever model happens to be active at resume — silently re-attributing every
      // token an earlier model spent. These three fields are the walk.
      activeModel: typeof e.activeModel === "string" ? e.activeModel : null,
      prevTokens: readPrevTokens(e.prevTokens),
      tokensByModel: readTokensByModel(e.tokensByModel),
      // Held tool calls (ADR-C13). Absent on a state file written before Phase 3,
      // which reads as {} — correct, because those files' in-flight calls were
      // ALREADY emitted (unstamped) by the pre-Phase-3 adapter at their call row.
      // Their result rows arrive to find no pending entry and emit nothing, which is
      // exactly right: the tool.call is already in D1 and re-emitting would duplicate
      // it. The upgrade costs no call, only the `errored` flag on whatever was in
      // flight at the moment the daemon restarted.
      pendingCalls: readPendingCalls(e.pendingCalls),
    };
  }
  return files;
}

/** A SHORT label for an unrecognized `version`, for the reset warning. Bounded
 *  and JSON-quoted because the value comes from a file this build has already
 *  decided it cannot read: an unbounded string would land verbatim in the
 *  daemon log. */
function versionLabel(raw: unknown): string {
  if (raw === undefined) return "missing";
  const text = JSON.stringify(raw) ?? String(raw);
  return text.length > 32 ? `${text.slice(0, 32)}...` : text;
}

interface LoadedState {
  state: CodexTailState;
  /** The state had to be RE-MINTED. The caller must persist it this tick. */
  reset: boolean;
  /** Set only when the reset was caused by a `version` this build does not
   *  understand, so the warning can say WHICH one rather than reading as a
   *  generic corruption. */
  unrecognizedVersion: string | null;
}

/**
 * Load the tail state. A version-CODEX_TAIL_STATE_VERSION file loads; a missing
 * or different version is refused; anything unparseable or shape-broken is
 * re-minted.
 *
 * `reset` is true when the state had to be re-minted (absent OR corrupt OR an
 * unparseable activatedAt OR an unrecognized version). The caller MUST persist a
 * reset state this tick — a corrupt file left in place would re-mint a LATER
 * activation every tick, silently sliding the cutoff forward past genuinely live
 * files (review finding). The activation validation is the fail-CLOSED leg: an
 * activatedAt that does not parse would otherwise make every historical file
 * read as live (NaN comparisons are false) — the exact first-activation flood
 * ADR-T3 exists to prevent. An unrecognized version fails closed the same way
 * and for a stronger reason: reading a shape written by newer software would be
 * a guess about field MEANING, and a wrong guess about `offset` re-emits at
 * wrong coordinates or skips unread bytes. The pre-publication unversioned
 * importer was retired after every supported install had written version 1;
 * accepting a missing version again would create an undocumented public
 * compatibility contract.
 */
function readState(nowIso: string): LoadedState {
  const reMinted = (unrecognizedVersion: string | null): LoadedState => ({
    state: { version: CODEX_TAIL_STATE_VERSION, activatedAt: nowIso, files: {} },
    reset: true,
    unrecognizedVersion,
  });

  let parsed: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(readFileSync(codexTailStatePath(), "utf8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return reMinted(null);
    parsed = raw as Record<string, unknown>;
  } catch {
    return reMinted(null); // absent or unparseable
  }

  const version = parsed.version;
  if (version !== CODEX_TAIL_STATE_VERSION) {
    return reMinted(versionLabel(version));
  }
  const { activatedAt, files: rawFiles } = parsed;
  if (
    typeof activatedAt !== "string" ||
    !Number.isFinite(Date.parse(activatedAt)) ||
    rawFiles === null ||
    typeof rawFiles !== "object" ||
    Array.isArray(rawFiles)
  ) {
    return reMinted(null);
  }

  const files = readFileEntries(rawFiles as Record<string, unknown>);
  const state: CodexTailState = { version: CODEX_TAIL_STATE_VERSION, activatedAt, files };
  return { state, reset: false, unrecognizedVersion: null };
}

function writeState(state: CodexTailState): void {
  // Atomic tmp+rename (the writeOffset move): a crash mid-write leaves the
  // previous valid state, which only means a re-tail the PK absorbs. The version
  // is stamped HERE, so no caller can persist an unstamped state.
  const path = codexTailStatePath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...state, version: CODEX_TAIL_STATE_VERSION }), "utf8");
  renameSync(tmp, path);
}

/** Every rollout file under the dated YYYY/MM/DD tree. Returns NULL when the
 *  listing itself failed (root missing, unmounted, permission blip) — the
 *  caller must treat that as "unknown", NOT "empty": pruning per-file state on
 *  an empty-because-error listing would wipe every cursor on one bad tick and
 *  force a full re-tail (review finding). */
function discoverRolloutFiles(root: string): string[] | null {
  let names: string[];
  try {
    names = readdirSync(root, { recursive: true }) as string[];
  } catch {
    return null;
  }
  const files: string[] = [];
  for (const name of names) {
    const base = basename(name);
    if (base.startsWith("rollout-") && base.endsWith(".jsonl")) files.push(join(root, name));
  }
  return files;
}

/** One COMPLETE line read from the file, with the byte offset it starts at and
 *  its byte span INCLUDING the terminating newline. The span is measured on the
 *  raw bytes, never re-derived from the decoded string — a hypothetical
 *  invalid-UTF-8 byte would decode to U+FFFD and re-encode to a different
 *  length, silently drifting the cursor. */
interface ReadLine {
  text: string;
  offset: number;
  byteSpan: number;
}

/**
 * Read up to `maxRows` complete lines starting at `offset`. Complete-lines-only
 * (the log-reader.ts discipline): a trailing line with no "\n" yet is left for
 * the next tick, so a mid-append row is never half-parsed and never anchors an
 * event id on a partial line. The read window doubles only when no newline
 * fits inside it (one pathological multi-MB line), up to a hard cap — past the
 * cap the file is reported stuck rather than silently skipped.
 */
function readCompleteLines(
  path: string,
  offset: number,
  size: number,
  maxRows: number,
): { lines: ReadLine[]; stuck: boolean } {
  const remaining = size - offset;
  if (remaining <= 0) return { lines: [], stuck: false };

  let window = READ_WINDOW_BYTES;
  while (true) {
    const toRead = Math.min(remaining, window);
    const buf = Buffer.alloc(toRead);
    let read = 0;
    const fd = openSync(path, "r");
    try {
      read = readSync(fd, buf, 0, toRead, offset);
    } finally {
      closeSync(fd);
    }
    const chunk = buf.subarray(0, read);
    if (chunk.indexOf(0x0a) === -1) {
      // No complete line in the window.
      if (toRead >= remaining) return { lines: [], stuck: false }; // partial tail — wait
      if (window >= READ_WINDOW_CAP_BYTES) return { lines: [], stuck: true };
      window *= 2;
      continue;
    }
    const lines: ReadLine[] = [];
    let lineStart = 0;
    while (lines.length < maxRows) {
      const nl = chunk.indexOf(0x0a, lineStart);
      if (nl === -1) break; // incomplete remainder — next tick re-reads it
      lines.push({
        text: chunk.subarray(lineStart, nl).toString("utf8"),
        offset: offset + lineStart,
        byteSpan: nl - lineStart + 1,
      });
      lineStart = nl + 1;
    }
    return { lines, stuck: false };
  }
}

/**
 * sweepCodexRollouts(nowIso) — one tick. Returns the number of events durably
 * appended (the daemon schedules a flush when > 0). Never throws for per-file
 * problems: one unreadable file must not stall the others.
 */
export async function sweepCodexRollouts(nowIso: string): Promise<number> {
  const root = codexSessionsRoot();
  // A reset (absent OR corrupt state) must persist THIS tick: leaving a corrupt
  // file in place would re-mint a later activation every tick, sliding the
  // cutoff forward past genuinely live files.
  const { state, reset, unrecognizedVersion } = readState(nowIso);
  const activatedAtMs = Date.parse(state.activatedAt);
  const seen = new Set<string>();
  let emitted = 0;
  let dirty = reset;
  // A re-minted activation reclassifies every file idle past LIVE_GRACE_MS as
  // historical, which is a silent capture loss for anything that was mid-tail.
  // Counted here, logged once per reset tick below, so the loss is visible.
  let resetSkipped = 0;

  const discovered = discoverRolloutFiles(root);
  for (const path of discovered ?? []) {
    seen.add(path);
    let mtimeMs: number;
    let size: number;
    try {
      const st = statSync(path);
      mtimeMs = st.mtimeMs;
      size = st.size;
    } catch {
      continue; // vanished between readdir and stat
    }

    let entry = state.files[path];
    if (!entry) {
      // ADR-T3: a file untouched since WELL BEFORE activation is history —
      // done, unread. The LIVE_GRACE window keeps the canonical first run
      // honest: a session generating at daemon start has an mtime seconds
      // before the just-minted activation and is one live session, tailed from
      // byte 0 (fully captured, its session_meta identity row included). An
      // unparseable activation fails CLOSED (historical), never open (flood).
      const historical =
        !Number.isFinite(activatedAtMs) || mtimeMs < activatedAtMs - LIVE_GRACE_MS;
      entry = historical
        ? { ...initialCodexFileState(), skip: true, offset: size }
        : { ...initialCodexFileState(), offset: 0 };
      if (historical && reset) resetSkipped += 1;
      state.files[path] = entry;
      dirty = true;
    }

    if (entry.skip) {
      // Keep the cursor pinned to EOF so a resumed pre-activation file never
      // accumulates an unbounded "unread" gap in the accounting.
      if (size > entry.offset) {
        entry.offset = size;
        dirty = true;
      }
      continue;
    }
    if (size < entry.offset) {
      // The rollout shrank below its cursor: truncated or rewritten in place.
      // Do NOT reset to 0 (the log-reader recovery): event ids here are pure
      // file coordinates, so re-reading DIFFERENT bytes at the SAME offsets
      // would mint wrong-content ids that the worker's event_id PK then pins
      // forever. Hold the cursor and say so; only growth past it resumes.
      // Log the TRANSITION once (the cursor never moves, so the shrunk condition
      // recurs every tick): re-log only when the shrunk size changes.
      if (shrinkLoggedSize.get(path) !== size) {
        console.error(
          `[seorak/collector] codex tail: ${basename(path)} shrank below its cursor (size ${size} < offset ${entry.offset}); leaving cursor put`,
        );
        shrinkLoggedSize.set(path, size);
      }
      continue;
    }
    // Not shrunk: forget any prior shrink-log memory so a file that recovers past
    // its cursor and later shrinks AGAIN reports that fresh transition.
    shrinkLoggedSize.delete(path);
    if (size === entry.offset) continue;

    let fileEmitted = 0;
    try {
      const { lines, stuck } = readCompleteLines(path, entry.offset, size, MAX_ROWS_PER_TICK);
      if (stuck) {
        console.error(
          `[seorak/collector] codex tail: no line boundary within ${READ_WINDOW_CAP_BYTES} bytes of ${basename(path)} — leaving cursor put`,
        );
        continue;
      }
      // session.tokens is a CUMULATIVE snapshot, so within one batch every snapshot but
      // the LAST is already superseded by the next (CODEX-CAPTURE ADR-C2). Emitting all
      // of them would put ~59 rows per session into D1 where only one is ever read — a
      // pure waste that bites hardest exactly when volume is highest (a first tail, a
      // catch-up, a state-loss replay). So they are coalesced: hold the newest, append
      // ONE per file per tick, anchored on the byte offset of the row that produced it
      // (still a pure file coordinate, so the id stays deterministic).
      let pendingTokens: SessionEvent | null = null;
      // agent.quota is coalesced for the SAME reason and by the same rule (ADR-C15): it is
      // a last-write-wins account snapshot, so within one batch every reading but the last
      // is already superseded. This is not merely a size optimization — superseding is what
      // the fact MEANS, and the read path only ever asks for the newest per (tool, window).
      //
      // It is a SEPARATE holder from pendingTokens, because the two events are emitted
      // independently: a `token_count` row with a fresh quota and no token movement yields
      // a quota event and no token snapshot at all, which is 26% of all rows.
      let pendingQuota: SessionEvent | null = null;
      let aborted = false;
      for (const line of lines) {
        const events = parseRolloutLine(line.text, line.offset, basename(path), entry);
        for (const event of events) {
          if (event.kind === "session.tokens") {
            pendingTokens = event; // supersedes any earlier snapshot in this batch
            continue;
          }
          if (event.kind === "agent.quota") {
            pendingQuota = event; // supersedes any earlier reading in this batch
            continue;
          }
          try {
            await appendEvent(event); // durable BEFORE the cursor moves
            fileEmitted += 1;
            // The start is owed until DURABLY appended: the adapter re-emits it
            // (same persisted-offset anchor, same id) on the next meta re-read
            // as long as this flag is down, so a transient disk failure can
            // never silently lose a session's start (review finding).
            if (event.kind === "session.start") {
              entry.startEmitted = true;
              dirty = true;
            }
          } catch (error) {
            if (error instanceof EmitAllowlistError) {
              // The tripwire caught a would-be leak: drop the event (nothing
              // shipped — the safe direction), advance past the row, and be
              // LOUD. Retrying forever would wedge the whole file's tail.
              console.error(`[seorak/collector] codex tail: emit blocked — ${error.message}`);
            } else {
              // Disk trouble: stop HERE without advancing past this row; the
              // next tick re-parses it and the PK absorbs any half-appended
              // batch.
              aborted = true;
              break;
            }
          }
        }
        if (aborted) break;
        entry.offset = line.offset + line.byteSpan;
        dirty = true;
      }

      // Append the surviving snapshot even when the batch aborted: the cursor has
      // already advanced past the token rows that fed it, so dropping it here would
      // strand those tokens in the (persisted) accumulator until the session's NEXT
      // token_count row happened to re-emit them, and a session that goes quiet right
      // here would never emit them at all. Appending is safe in every case because the
      // snapshot is cumulative and its id is a file coordinate: a re-read re-derives the
      // same id and the worker's PK collapses it.
      if (pendingTokens !== null) {
        try {
          await appendEvent(pendingTokens);
          fileEmitted += 1;
        } catch (error) {
          if (error instanceof EmitAllowlistError) {
            console.error(`[seorak/collector] codex tail: emit blocked — ${error.message}`);
          } else {
            // The accumulator persists, so the next token_count row emits a snapshot
            // that SUPERSEDES this lost one. Nothing is permanently undercounted.
            console.error("[seorak/collector] codex tail: session.tokens append failed", error);
          }
        }
      }

      // Same posture for the quota reading, and the same reason it is safe to append even
      // after an abort: the id is a file coordinate, so a re-read re-derives it and the PK
      // collapses the duplicate. A lost reading is superseded by the next `token_count`
      // row rather than permanently missing, and a quota gauge that is one tick stale is
      // still honest — `observedAt` says exactly how stale it is.
      if (pendingQuota !== null) {
        try {
          await appendEvent(pendingQuota);
          fileEmitted += 1;
        } catch (error) {
          if (error instanceof EmitAllowlistError) {
            console.error(`[seorak/collector] codex tail: emit blocked — ${error.message}`);
          } else {
            console.error("[seorak/collector] codex tail: agent.quota append failed", error);
          }
        }
      }
    } catch (error) {
      console.error(`[seorak/collector] codex tail failed on ${basename(path)}`, error);
    }
    emitted += fileEmitted;
  }

  if (reset) {
    // An unrecognized version is named, because that reset is not corruption:
    // it is this build refusing to guess at a shape a newer writer produced, and
    // the version is the one fact that tells the reader which build to look at.
    console.warn(
      unrecognizedVersion === null
        ? `[seorak/collector] codex tail: state reset, ${resetSkipped} idle file(s) classified historical`
        : `[seorak/collector] codex tail: state reset (unrecognized state version ${unrecognizedVersion}), ${resetSkipped} idle file(s) classified historical`,
    );
  }

  // Prune entries for files that no longer exist (Codex cleanups / user rm) —
  // but ONLY when the listing itself succeeded: an errored listing (null) says
  // nothing about the files, and pruning on it would wipe every cursor and
  // force a full re-tail on one bad tick.
  if (discovered !== null) {
    for (const path of Object.keys(state.files)) {
      if (!seen.has(path)) {
        delete state.files[path];
        shrinkLoggedSize.delete(path); // no cursor to guard once the file is gone
        dirty = true;
      }
    }
  }

  if (dirty) {
    try {
      writeState(state);
    } catch (error) {
      // A failed persist only means a re-tail next start; ids make it a no-op.
      console.error("[seorak/collector] codex tail: state persist failed", error);
    }
  }
  return emitted;
}

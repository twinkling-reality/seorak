/**
 * ledger.ts — the daemon's local FILE-TOUCH LEDGER (HEAD-TO-HEAD ADR-H2).
 *
 * The question it exists to answer, and the only one:
 *
 *   "Which agents edited file F between its previous commit and this one?"
 *
 * That is the join that lets a git commit — which is tool-independent and knows
 * nothing about agents — be attributed to the agent whose work is in it. Git records
 * lines-in-commits; we record file-touches. The salted `fileId` is where the two meet:
 * it is `sha256(salt ‖ "\0" ‖ ABSOLUTE path)` (file-id.ts), and the daemon knows each
 * repo's toplevel (registry.ts), so it can reconstruct the same id for any path git
 * hands it.
 *
 * WHY THE DAEMON OWNS IT (single writer):
 *   Claude's hooks are short-lived SEPARATE processes and the Codex tailer runs INSIDE
 *   the daemon. Having both read-modify-write a JSON index on every tool call is a
 *   corruption race (the repo registry gets away with it only because it writes rarely).
 *   So the ledger is never written on the hot path. The daemon folds it out of the
 *   active event-log generation on its own cursor. Once both consumers acknowledge a
 *   generation, the ledger's current + previous atomic checkpoints retain the durable
 *   attribution projection and the raw generation can be reclaimed.
 *
 * WHY ITS OWN CURSOR:
 *   The ship offset advances only after the worker 2xx-acks. Attribution must not stall
 *   behind a worker outage, and a ledger rebuild must not re-ship a month of events. Two
 *   cursors, both idempotent, no coupling (log-reader.readEventsFrom).
 *
 * PRIVACY: nothing here is new. The ledger holds only what the event log already holds
 * and already ships — salted fileIds, session ids, agent ids, timestamps. No path, no
 * content, no sha. It is local because it is a working index, not because it is secret.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { AgentId, SessionEvent } from "@seorak/types";
import { readEventLogGeneration } from "./event-log.ts";
import { readEventsFrom } from "./log-reader.ts";
import { ledgerBackupPath, ledgerPath } from "./paths.ts";

/** One edit of one file by one session. `at` is epoch ms (the event's `at`). */
export interface LedgerTouch {
  sessionId: string;
  at: number;
}

export interface FileTouchLedger {
  version: 2;
  /** Active raw-log generation this byte offset belongs to. */
  generation: number;
  /** Byte offset into events.jsonl this ledger has folded up to. */
  offset: number;
  /** sessionId → agent. `session.start` is the ONLY event carrying an agent, so this
   *  is the sole way a `tool.call` (which carries none) learns whose it was. */
  agents: Record<string, AgentId>;
  /** salted fileId → touches, kept ASCENDING by `at`. */
  touches: Record<string, LedgerTouch[]>;
}

/**
 * How much touch history the ledger keeps. Generous on purpose: a file an agent edits
 * today can legitimately be committed a week later, and a touch pruned before its
 * commit lands means the commit reads as UNATTRIBUTED (honest, but a needless loss).
 * 90 days is far past any realistic edit→commit lag and still bounded: this machine's
 * whole 46-day log holds 17,119 file-bearing tool calls, so a full window is a few MB.
 */
export const LEDGER_RETENTION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function emptyLedger(): FileTouchLedger {
  return { version: 2, generation: 0, offset: 0, agents: {}, touches: {} };
}

function parseLedger(path: string): FileTouchLedger | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<FileTouchLedger>;
    if (parsed.version !== 2) return null;
    return {
      version: 2,
      generation:
        typeof parsed.generation === "number" &&
        Number.isSafeInteger(parsed.generation) &&
        parsed.generation >= 0
          ? parsed.generation
          : 0,
      offset:
        typeof parsed.offset === "number" &&
        Number.isFinite(parsed.offset) &&
        parsed.offset >= 0
          ? parsed.offset
          : 0,
      agents:
        parsed.agents && typeof parsed.agents === "object"
          ? (parsed.agents as Record<string, AgentId>)
          : {},
      touches:
        parsed.touches && typeof parsed.touches === "object"
          ? (parsed.touches as Record<string, LedgerTouch[]>)
          : {},
    };
  } catch {
    return null;
  }
}

/** Read the newest valid durable checkpoint, then its previous generation. */
export function loadLedger(): FileTouchLedger {
  return parseLedger(ledgerPath()) ?? parseLedger(ledgerBackupPath()) ?? emptyLedger();
}

/**
 * Persist an fsynced current checkpoint while retaining the prior valid one.
 * A failure is returned to the caller because raw-log rollover must never treat
 * an in-memory-only offset as durable acknowledgement.
 */
export function saveLedger(
  ledger: FileTouchLedger,
  currentIsKnownValid = false,
): boolean {
  try {
    const path = ledgerPath();
    const backup = ledgerBackupPath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    const descriptor = openSync(tmp, "w", 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify(ledger), "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (existsSync(path)) {
      // Re-parsing the CURRENT file guards against promoting a corrupt one to
      // backup. It costs a full parse of the whole ledger (18ms at 4.3MB), and
      // it is pure waste when the caller already knows the file is the one this
      // process wrote and fsynced: writes land on a temp file and arrive by
      // atomic rename, so a torn current file is disk corruption, not a partial
      // write. The caller says which case it is rather than this function
      // guessing, so a caller that cannot know still pays for the check.
      if (currentIsKnownValid || parseLedger(path)) {
        if (existsSync(backup)) unlinkSync(backup);
        renameSync(path, backup);
      } else {
        unlinkSync(path);
      }
    }
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fold a batch of events into the ledger. PURE (mutates + returns `ledger`, no I/O) so
 * it is unit-testable without a filesystem.
 *
 * Idempotent by construction: a touch is keyed on (fileId, sessionId, at), so re-folding
 * the same events — which happens on any replay — is a no-op rather than a double-count.
 * That matters because the ledger's cursor and the ship cursor advance independently.
 *
 * Only two kinds are read. `session.start` carries the agent; `tool.call` carries the
 * fileId. A `tool.call` with no `fileId` (the ~90% that are Read/Bash/Grep, or any edit
 * made while the `fileSignals` capture setting is off) is not an attributable edit and
 * is skipped — absence keeps meaning "we cannot trace this", never "nobody did it".
 */
export function applyEventsToLedger(
  ledger: FileTouchLedger,
  events: SessionEvent[],
): FileTouchLedger {
  for (const event of events) {
    if (event.kind === "session.start") {
      ledger.agents[event.sessionId] = event.agent;
      continue;
    }
    if (event.kind !== "tool.call") continue;
    const fileId = event.fileId;
    if (typeof fileId !== "string" || fileId.length === 0) continue;
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;

    const list = (ledger.touches[fileId] ??= []);
    // Idempotent: the same (session, at) never lands twice on a replay.
    if (list.some((t) => t.sessionId === event.sessionId && t.at === at)) continue;
    list.push({ sessionId: event.sessionId, at });
  }
  // Keep every touch list ascending — the attribution window scan relies on it, and
  // sorting once here beats sorting per lookup.
  for (const list of Object.values(ledger.touches)) list.sort((a, b) => a.at - b.at);
  return ledger;
}

/**
 * Drop touches older than the retention window, then drop any file left with none and
 * any session left with no touches at all. Bounds the ledger by construction rather
 * than by hoping it stays small. PURE.
 */
export function pruneLedger(
  ledger: FileTouchLedger,
  nowMs: number,
  retentionDays: number = LEDGER_RETENTION_DAYS,
): FileTouchLedger {
  const floor = nowMs - retentionDays * MS_PER_DAY;
  const liveSessions = new Set<string>();

  for (const [fileId, list] of Object.entries(ledger.touches)) {
    const kept = list.filter((t) => t.at >= floor);
    if (kept.length === 0) {
      delete ledger.touches[fileId];
      continue;
    }
    ledger.touches[fileId] = kept;
    for (const t of kept) liveSessions.add(t.sessionId);
  }
  for (const sessionId of Object.keys(ledger.agents)) {
    if (!liveSessions.has(sessionId)) delete ledger.agents[sessionId];
  }
  return ledger;
}

/** One agent's claim on a file: which of its sessions touched the file last inside the
 *  window (the most recent editor before the commit). */
export interface TouchClaim {
  agent: AgentId;
  sessionId: string;
  at: number;
}

/**
 * agentsTouching(ledger, fileId, afterMs, throughMs) — every agent that edited `fileId`
 * in the HALF-OPEN window `(afterMs, throughMs]`, each resolved to the session that
 * touched it LAST within that window.
 *
 * The window bounds are what make this honest. `throughMs` is the commit's author time,
 * so an edit made AFTER the commit belongs to the NEXT commit, not this one. `afterMs`
 * is the file's PREVIOUS commit, so an edit that already landed in an earlier commit
 * cannot be charged again to this one.
 *
 * A touch whose session has no known agent (its `session.start` predates the ledger, or
 * was never captured) is DROPPED, not guessed. Fail-closed: it degrades that file to
 * `unattributed`, which is countable and honest. Defaulting it to claude-code — the
 * worker's `agentOfRow` reflex — is exactly how a second agent's work would silently
 * become the first agent's.
 *
 * Within one agent, the LAST toucher takes the file. Two sessions of the SAME agent
 * sharing one file in one commit is the only case this approximates, and it approximates
 * only the per-SESSION split: the agent-level totals, which are what Tier 2 reports, are
 * exact either way because the lines are counted once.
 */
export function agentsTouching(
  ledger: FileTouchLedger,
  fileId: string,
  afterMs: number,
  throughMs: number,
): TouchClaim[] {
  const list = ledger.touches[fileId];
  if (!list || list.length === 0) return [];

  const byAgent = new Map<AgentId, TouchClaim>();
  for (const touch of list) {
    if (touch.at <= afterMs) continue; // already committed
    if (touch.at > throughMs) break; // belongs to a later commit (list is ascending)
    const agent = ledger.agents[touch.sessionId];
    if (agent === undefined) continue; // unknown session → never guessed
    const held = byAgent.get(agent);
    if (held === undefined || touch.at >= held.at) {
      byAgent.set(agent, { agent, sessionId: touch.sessionId, at: touch.at });
    }
  }
  // Deterministic order so a contested file's agent list is stable across runs.
  return [...byAgent.values()].sort((a, b) => a.agent.localeCompare(b.agent));
}

/**
 * syncLedger(nowMs) — fold every event appended since the ledger's own cursor, prune,
 * and persist. Returns the live ledger.
 *
 * On a first run the cursor is 0, so this folds the active generation. Current and
 * previous checkpoints carry the retained projection across acknowledged raw-log
 * rollover; losing both checkpoints honestly loses pre-generation attribution history.
 *
 * The cursor is advanced and saved even when a fold produced nothing, so a log full of
 * events the ledger does not care about (the ~90% of tool calls with no fileId) is
 * walked once rather than every tick.
 */
/**
 * The ledger this process is working with, held across syncs.
 *
 * `loadLedger` is the RECOVERY primitive and deliberately still reads disk every
 * time: its job is to fall back to the previous checkpoint when the current file
 * is torn, which an in-memory answer cannot do. What is cached is the working
 * copy, and only after a save has proven it is also what is on disk.
 *
 * This matters because `syncLedgerOnce` parsed 4.3MB BEFORE it could reach its
 * own nothing-new short-circuit, so a tick with no attributable events still
 * paid for the whole ledger. The daemon calls this on every drain once the event
 * log crosses its compaction threshold, which is when it would have hurt most.
 */
let workingLedger: FileTouchLedger | null = null;

/**
 * The ledger path the cache above belongs to.
 *
 * `ledgerPath()` resolves through `SEORAK_DIR`, which is process-global and can
 * change under a test, an embedder, or a future multi-profile caller. A cache
 * that ignored it would hand one directory's ledger to another and the offsets
 * would be silently wrong, so the path is compared on every read and a change
 * simply misses.
 */
let workingLedgerPath: string | null = null;

/**
 * Whether THIS process wrote the ledger file that is currently on disk.
 *
 * Deliberately separate from `workingLedger`. Holding a working copy says the
 * parse can be skipped; having written the file says the re-parse inside
 * `saveLedger` can be skipped. They become true at different moments: the first
 * on load, the second only after a successful save. Conflating them would skip
 * validation on the first save of a process, which is exactly the file this
 * process did NOT write and the one most worth checking.
 */
let wroteCurrentFile = false;

/** Test seam. The daemon is the only writer, so nothing in production invalidates
 *  this; a test that writes a ledger file behind the module's back must. */
export function resetLedgerCache(): void {
  workingLedger = null;
  workingLedgerPath = null;
  wroteCurrentFile = false;
}

async function syncLedgerOnce(nowMs: number): Promise<FileTouchLedger> {
  // Cached on the way in, not only after a save: a tick that short-circuits
  // below still has the working copy, and re-reading 4.3MB to learn there was
  // nothing to do is the cost this exists to remove.
  const path = ledgerPath();
  if (workingLedgerPath !== path) {
    workingLedger = null;
    wroteCurrentFile = false;
    workingLedgerPath = path;
  }
  const ledger = workingLedger ?? loadLedger();
  workingLedger = ledger;
  const generation = await readEventLogGeneration();
  if (ledger.generation !== generation) {
    ledger.generation = generation;
    ledger.offset = 0;
  }
  const { events, nextOffset } = await readEventsFrom(ledger.offset);
  if (events.length === 0 && nextOffset === ledger.offset) return ledger;

  applyEventsToLedger(ledger, events);
  pruneLedger(ledger, nowMs);
  ledger.offset = nextOffset;
  if (!saveLedger(ledger, wroteCurrentFile)) {
    // Drop both: the on-disk state no longer matches this object, and the next
    // sync must re-read rather than build on an offset that was never
    // acknowledged or trust a file it did not prove it wrote.
    workingLedger = null;
    wroteCurrentFile = false;
    throw new Error("failed to persist the attribution-ledger checkpoint");
  }
  wroteCurrentFile = true;
  return ledger;
}

let syncInFlight: Promise<FileTouchLedger> | undefined;

/** Serialize daemon callers so delivery rollover and attribution cannot race the
 * ledger cursor or its atomic save. */
export function syncLedger(nowMs: number): Promise<FileTouchLedger> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = syncLedgerOnce(nowMs).finally(() => {
    syncInFlight = undefined;
  });
  return syncInFlight;
}

/** Touch + file counts, for the daemon's log line. A ledger that is silently empty is
 *  indistinguishable from one that is working, so the daemon says which. */
export function ledgerSize(ledger: FileTouchLedger): { files: number; touches: number } {
  let touches = 0;
  for (const list of Object.values(ledger.touches)) touches += list.length;
  return { files: Object.keys(ledger.touches).length, touches };
}

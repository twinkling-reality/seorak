/**
 * adapters/codex.ts — the Codex rollout adapter. Capability contract:
 * docs/specs/multi-tool.md.
 *
 * Codex is observed by TAILING its append-only rollout JSONL
 * (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`), not by hooks, so this
 * adapter's surface is `parseRolloutLine`: one raw rollout line in, 0..n
 * ready-to-append events out, driven by the daemon's tailer (codex-tailer.ts).
 *
 * SCRUB-BY-CONSTRUCTION (ADR-T4) — the load-bearing shape of this module: the
 * rollout vocabulary is handled by a TOTAL table whose default is drop. Every
 * observed row type is enumerated — the emitting ones and the dropped ones,
 * each dropped one with the content it carries named — and an UNKNOWN type
 * (format drift; Codex minors change the vocabulary) falls through to the same
 * drop. Handlers lift ONLY counts, closed enums, salted ids, and the row's own
 * timestamp. Content read locally to derive (a unified_diff to count lines, an
 * absolute path to salt-hash, a branch name to classify) is discarded inside
 * the handler. The emit.ts allowlist stays the runtime backstop.
 *
 * DETERMINISM (ADR-5/T2): every eventId is `codexRolloutEventId(sessionId,
 * fileBasename, byteOffset)` — a pure function of the row's file coordinate —
 * so a re-tail after any crash collapses on the worker's `event_id` PK. The
 * one per-SESSION event (session.start) anchors on the byte offset of the
 * file's FIRST session_meta row, which the tailer persists in the per-file
 * state: a duplicate meta (observed: up to 18 per file, all one session id)
 * or a mid-file restart can therefore never mint a second start id.
 *
 * DEFERRED TOOL CALLS (ADR-C13): a `tool.call` is emitted at its RESULT row, not at
 * its call row, because the result is the only row that knows how the call went and an
 * append-only log has no UPDATE (re-emitting with `errored` added is a silent no-op on
 * the worker's PK and a double count in KV). The call is held in `pendingCalls` keyed
 * by the rollout's `call_id` — Codex fans out up to 8 calls at once, so a single-slot
 * design would be wrong — and its event id stays anchored on the CALL's byte offset, so
 * every id is byte-identical to the one the pre-Phase-3 adapter minted. This also aligns
 * Codex with Claude, whose `tool.call` already fires on PostToolUse, after the call ran.
 *
 * HONEST-EMPTY (ADR-T6, as amended by CODEX-CAPTURE): tokens and cost ship on the
 * `session.tokens` carrier (ADR-C2). `errored` ships on SHELL calls only (ADR-C5), read
 * from the exec header and never from the command's own stdout, which could otherwise
 * fabricate an error against itself. It stays ABSENT on every other tool, and absent is
 * not false: the worker's rate keys on PRESENCE, so an unobservable call lands in neither
 * leg. ApplyPatch gets NO error leg on purpose — `patch_apply_end.success` is `true` on
 * 866 of 866 rows across every version, because a FAILED patch emits no end row at all,
 * so stamping it would pin a fabricated 0% error rate. NO session.end, ever — Codex writes
 * no end record, so `endReason` stays false permanently and the worker's reaper closes
 * silent sessions (CAPABILITY-CONTRACT ADR-11). A turn_aborted is a TURN abort, not a
 * session end.
 */
import {
  resolveCapabilities,
  type SessionEvent,
  type SessionPromptEvent,
  type SessionStartEvent,
  type ToolCallEvent,
} from "@seorak/types";
import { classifyBranchWorkType } from "../branch-work-type.ts";
import { captureSettings } from "../capture-settings.ts";
import { codexQuotaEventId, codexRolloutEventId } from "../codex-event-id.ts";
import {
  lineCount,
  sumEditLineCounts,
  unifiedDiffLineCounts,
  type EditLineCounts,
} from "../edit-lines.ts";
import { AGENT_VERSION_SHAPE } from "../emit.ts";
import { fileIdentityForPath } from "../file-id.ts";
import { momentumEnabled, repoIdentityOrCwd } from "../git.ts";
import { registerRepoFromCwd } from "../registry.ts";

/**
 * Per-file tail state, owned + persisted by the tailer (codex-tailer.ts) and
 * MUTATED here as rows reveal the file's identity. Persisting it beside the
 * byte cursor is what keeps session.start emission idempotent across daemon
 * restarts (see module header). All fields are LOCAL — nothing here ships.
 */
export interface CodexFileState {
  /** The file's session id, from its FIRST session_meta payload.id. One file is
   *  one session/thread (verified: 121/121 metas match their filename uuid; the
   *  18-meta file carries ONE id). null until a meta row is seen. */
  sessionId: string | null;
  /** Byte offset of that first meta row — the session.start id anchor. */
  startOffset: number | null;
  /** Whether session.start for this file was handed to the tailer already. */
  startEmitted: boolean;
  /** Never emit from this file: a subagent thread (ADR-T7 — its work folds
   *  into the parent at D5; emitting it as its own session would inflate Codex
   *  session counts against Claude's within-session subagents), a pre-activation
   *  file (ADR-T3), or a meta so malformed the file cannot be attributed. */
  skip: boolean;
  /** The model named by the most recent `turn_context` row. Token deltas accrue to
   *  THIS model (CODEX-CAPTURE ADR-C2): a session can switch models mid-flight, and
   *  `token_count` rows name no model of their own, so the active model is the only
   *  honest attribution the file offers. null until a turn_context is seen. */
  activeModel: string | null;
  /** The previous cumulative `total_token_usage` reading, for the delta walk. null
   *  before the first reading, which is then its own delta (from zero). */
  prevTokens: CodexTokenTotals | null;
  /** Cumulative, DE-INCLUDED, per-model session totals. This is the session.tokens
   *  payload, held across ticks and persisted with the byte cursor so a restart
   *  resumes the running total instead of restarting it. */
  tokensByModel: Record<string, CodexModelTokens>;
  /** Tool calls seen but NOT YET EMITTED, keyed by the rollout's own `call_id`
   *  (CODEX-CAPTURE ADR-C13). A Codex `tool.call` is emitted at its RESULT row, because
   *  that is the only row that knows how the call went, and an append-only log has no
   *  UPDATE. Persisted with the byte cursor: a tick boundary routinely falls between a
   *  call and its result, and losing this map would strand the call unemitted. */
  pendingCalls: Record<string, CodexPendingCall>;
}

/**
 * A tool call waiting for its result row.
 *
 * Both fields are the CALL's coordinates, never the result's, and that is the load-bearing
 * detail of ADR-C13: the event id stays `codexRolloutEventId(sessionId, basename, offset)`
 * over the CALL's offset, so every id this adapter mints is byte-identical to the one the
 * pre-Phase-3 adapter would have minted for the same row. A re-tail re-derives the same ids
 * and the worker's PK collapses them, and the four Codex sessions already in D1 keep theirs.
 * Anchoring on the result row instead would mint a SECOND id for a call already logged under
 * a different one, which the PK cannot collapse.
 */
export interface CodexPendingCall {
  /** Byte offset of the CALL row. The event-id anchor. */
  offset: number;
  /** The CALL's own timestamp. A tool.call's `at` is when the call HAPPENED, not when it
   *  returned, so deferring emission moves no row across a day boundary in the trends. */
  at: string;
  toolName: CodexToolName;
}

/** The three tool buckets this adapter emits. `Shell` is the only one whose result carries
 *  an exit code, and therefore the only one that can ever carry `errored` (ADR-C5). */
export type CodexToolName = "Shell" | "ApplyPatch" | "other";

/**
 * The most calls this adapter will hold unemitted for one file. Codex fans out: the corpus
 * shows up to **8** calls in flight at once, and 37% of calls are issued while another is
 * still pending, so this cannot be a single slot (F16). 64 is 8x the observed ceiling.
 *
 * On overflow the OLDEST pending call is emitted UNSTAMPED rather than dropped, so the worst
 * case degrades to exactly the pre-Phase-3 behaviour (a tool.call with no `errored`) instead
 * of to a missing tool call. It also bounds the persisted state, which is the other reason
 * a cap exists at all.
 */
export const MAX_PENDING_CALLS = 64;

/** One raw cumulative reading, exactly as Codex reports it (cache-INCLUSIVE input,
 *  reasoning-INCLUSIVE output). Kept raw so the monotonicity + reconciliation guards
 *  can check the SOURCE's own arithmetic before we transform it. */
export interface CodexTokenTotals {
  input: number;
  cachedInput: number;
  output: number;
  total: number;
}

/** Per-model running totals in Seorak's CACHE-EXCLUSIVE vocabulary. */
export interface CodexModelTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** Fresh state for a newly-discovered rollout file. */
export function initialCodexFileState(): CodexFileState {
  return {
    sessionId: null,
    startOffset: null,
    startEmitted: false,
    skip: false,
    activeModel: null,
    prevTokens: null,
    tokensByModel: {},
    pendingCalls: {},
  };
}

const AGENT = "codex" as const;

/**
 * The oldest Codex CLI version whose rollout vocabulary this adapter reads.
 *
 * MEASURED 2026-07-27 over the whole local corpus: 410 rollout files, 259,332 rows, 22
 * distinct `session_meta.cli_version` values from 0.46.0 to 0.146.0-alpha.3.1. Three
 * version-specific shapes this adapter used to read are all confined BELOW this floor —
 * quota slots stating their reset as a relative `resets_in_seconds` (3,580 slots, every
 * one on 0.46.0), the 299/10079 window pair (2,140 slots, every one on 0.46.0), and the
 * JSON envelope carrying a shell exit code as `metadata.exit_code` (1,878 rows, 764 on
 * 0.46.0 and 1,114 on 0.58.0). Zero of any of them on 0.116.0 or on the 20 versions after
 * it, so 0.116.0 is the oldest version observed to emit NONE of the retired shapes.
 *
 * THE EVIDENCE IS ASYMMETRIC AND THE FLOOR DOES NOT OVERSTATE IT. 0.116.0 through 0.125.0
 * contributed 219 rows to the corpus and ZERO tool-result rows and ZERO `rate_limits`
 * rows, so they are UN-CONTRADICTED rather than positively proven: nothing in them emits
 * a retired shape because nothing in them emits either shape at all. Positive proof of the
 * modern text result shape (a header terminated by an `Output:\n` marker) starts at
 * 0.128.0, which is where the first tool-result rows in the corpus appear.
 *
 * THE CONSEQUENCE, PRECISELY. Below the floor this adapter reads NOTHING version-specific.
 * A below-floor session's shell results carry no `errored` stamp and its `rate_limits`
 * rows produce no quota window. Both are honest ABSENCE, never a guess: an unstamped call
 * lands in NEITHER leg of the error rate, and a window we did not read simply does not
 * appear. Capture of sessions, prompts, tool calls, and tokens is unaffected — those ride
 * shapes every observed version writes — and the file is never skipped for its version.
 */
export const CODEX_MIN_SUPPORTED_CLI_VERSION = "0.116.0";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The leading numeric dot-triple of a version string, or null when it does not start with
 * one. A prerelease suffix is IGNORED: `0.145.0-alpha.18` compares as 0.145.0, because a
 * prerelease speaks its release's rollout vocabulary (2 of the 22 observed version strings
 * carry a suffix) and ordering alphas against releases is a precision nothing here needs.
 */
function versionTriple(raw: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Whether a reported `cli_version` sorts below CODEX_MIN_SUPPORTED_CLI_VERSION.
 *
 * A version that is ABSENT, shape-rejected, or does not start with a dot-triple reads
 * FALSE, not "old": absence of a version is not evidence of an old one, and treating it as
 * one would warn on every future format the pin has not learned yet.
 */
function isBelowSupportedFloor(raw: unknown): boolean {
  if (typeof raw !== "string" || !AGENT_VERSION_SHAPE.test(raw)) return false;
  const seen = versionTriple(raw);
  const floor = versionTriple(CODEX_MIN_SUPPORTED_CLI_VERSION);
  if (seen === null || floor === null) return false;
  for (let i = 0; i < 3; i++) {
    if (seen[i]! !== floor[i]!) return seen[i]! < floor[i]!;
  }
  return false;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * parseRolloutLine(line, byteOffset, fileBasename, state) — one rollout line to
 * 0..n events. Deterministic for a given (file content, initial state): the
 * tailer re-running any suffix of a file reproduces the same events with the
 * same ids. Fault-soft: a malformed line yields [] (the tailer advances past
 * it; a corrupt line is not retried forever — the log-reader.ts policy).
 *
 * The TOTAL handler table (ADR-T4). Row vocabulary verified 2026-07-10 across
 * 103 files / 45,509 rows / 14 versions (0.46.0–0.142.5); every branch names
 * what it lifts or why it drops. A 2026-07-27 re-survey (410 files / 259,332
 * rows / 22 versions, 0.46.0–0.146.0-alpha.3.1) found row TYPES this table does
 * not name — top-level `world_state` and `inter_agent_communication_metadata`,
 * event_msg `sub_agent_activity` / `thread_settings_applied` /
 * `thread_goal_updated`, response_item `agent_message` — so the table is a DATED
 * SURVEY, not a closed set. Every one of them lands on the default drop, which
 * is the point of making the default drop. Versions BELOW
 * CODEX_MIN_SUPPORTED_CLI_VERSION still parse through this same table; what they
 * lose is named on that constant:
 *
 *   session_meta        → session.start (first only). Lifts id, timestamp,
 *                         cli_version, git.branch→enum; cwd is consumed LOCALLY
 *                         (salted repoId + basename + registry). DISCARDS
 *                         base_instructions/instructions (system prompt text),
 *                         dynamic_tools, git.repository_url (a remote URL —
 *                         content, never emitted), originator, everything else.
 *   event_msg
 *     patch_apply_end   → tool.call "ApplyPatch": edit-line COUNTS from the
 *                         changes map (unified_diff/content read + discarded),
 *                         salted file identity when EXACTLY one file. The
 *                         absolute-path keys and diff bodies never leave.
 *     user_message      → session.prompt, ENVELOPE ONLY (the message text,
 *                         images, text_elements are never read).
 *     token_count       → session.tokens: a CUMULATIVE, per-model snapshot of
 *                         `info.total_token_usage` (never `last_token_usage`,
 *                         whose zero-breakdown sentinel rows would price a
 *                         six-figure total at $0). Deltas are de-included and
 *                         attributed to the model `turn_context` last named. It
 *                         is session-scoped because the row carries NO call id
 *                         — per-call tokens would be a fabricated attribution.
 *     agent_message / agent_reasoning → dropped (prose).
 *     exec_command_end  → dropped (0.128-only; carries command/stdout/stderr/cwd).
 *     mcp_tool_call_end → dropped for now (invocation/result payloads; the
 *                         result leg is item 4's job).
 *     task_started / task_complete / turn_aborted / web_search_end /
 *     context_compacted / thread_rolled_back / error / image_generation_end
 *                       → dropped (lifecycle/UI chatter; task_complete carries
 *                         last_agent_message — prose).
 *   response_item
 *     function_call     → HELD (ADR-C13), keyed by call_id, emitted at its result
 *                         row; a row with NO call_id is dropped, because nothing
 *                         could ever match a result to it (0 of 43,522 observed).
 *                         exec_command|shell → "Shell"; any other name →
 *                         "other" (Codex dynamic tools are an OPEN vocabulary —
 *                         tap/exec/spawn_agent/… — and must never ship raw, the
 *                         mcp__ lesson). Arguments (cmd text, workdir) never read.
 *     custom_tool_call  → apply_patch REQUEST rows dropped (patch_apply_end is
 *                         the applied truth; both would double-count the tool);
 *                         other custom tools HELD as tool.call "other".
 *     function_call_output / custom_tool_call_output
 *                       → RELEASES the held call as a tool.call. On a Shell call
 *                         ONLY, lifts the exit code from the HEADER preamble (never
 *                         from the command's own stdout, which could print the exit
 *                         line and fabricate an error against itself) and stamps
 *                         `errored`. Everything else about the row — stdout, stderr,
 *                         file paths, the command's output — is read for nothing and
 *                         discarded. A result whose header carries no exit code
 *                         (backgrounded process, sandbox refusal, aborted turn)
 *                         leaves `errored` ABSENT, which is neither leg of the rate.
 *     reasoning / message → dropped (prose, encrypted_content).
 *     ghost_snapshot    → dropped (ghost_commit lists UNTRACKED FILE PATHS —
 *                         `.env` by name — the densest path leak in the format).
 *     web_search_call / tool_search_call / tool_search_output /
 *     image_generation_call → dropped (queries/prose/binary).
 *   turn_context        → emits NOTHING; lifts `model` (shape-pinned) into the
 *                         file state as the ACTIVE MODEL that subsequent token
 *                         deltas accrue to. Its free-form keys (personality,
 *                         workspace_roots, …) stay unread.
 *   compacted           → dropped (embeds replaced transcript text wholesale).
 *   (anything else)     → dropped: format drift lands as silence, never a leak.
 */
export function parseRolloutLine(
  line: string,
  byteOffset: number,
  fileBasename: string,
  state: CodexFileState,
): SessionEvent[] {
  if (state.skip) return [];

  let row: unknown;
  try {
    row = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isPlainObject(row)) return [];

  // The row's own timestamp becomes the event's `at`, so it must actually BE
  // one: an unparseable value is both a dishonest event time and a free-text
  // channel to the wire (review finding). Drop the row — no honest time, no event.
  const at = str(row.timestamp);
  if (at === undefined || !Number.isFinite(Date.parse(at))) return [];
  const payload = isPlainObject(row.payload) ? row.payload : {};

  switch (row.type) {
    case "session_meta":
      return handleSessionMeta(payload, at, byteOffset, fileBasename, state);
    // The model in force for the turns that follow. Emits NOTHING — it only moves the
    // token attribution pointer (CODEX-CAPTURE ADR-C2). Every other key on this row
    // (personality, workspace_roots, …) is free-form and stays unread.
    case "turn_context": {
      const model = str(payload.model);
      if (model !== undefined && MODEL_SHAPE.test(model)) state.activeModel = model;
      return [];
    }
    case "event_msg": {
      if (state.sessionId === null) return []; // unattributable (no meta yet)
      if (payload.type === "patch_apply_end") {
        return handlePatchApplyEnd(payload, at, byteOffset, fileBasename, state.sessionId);
      }
      if (payload.type === "token_count") {
        return handleTokenCount(payload, at, byteOffset, fileBasename, state);
      }
      if (payload.type === "user_message") {
        const prompt: SessionPromptEvent = {
          kind: "session.prompt",
          eventId: codexRolloutEventId(state.sessionId, fileBasename, byteOffset),
          sessionId: state.sessionId,
          at,
        };
        return [prompt];
      }
      return [];
    }
    case "response_item": {
      if (state.sessionId === null) return [];
      if (payload.type === "function_call") {
        const name = str(payload.name);
        if (name === undefined) return [];
        // `Shell` is exactly the two names whose result carries an exit code, and so
        // exactly the calls that can ever carry `errored` (ADR-C5). Everything else is
        // `other`: Codex's dynamic tools are an OPEN vocabulary (tap / exec / spawn_agent
        // / an arbitrary MCP server's verbs) and must never ship raw — the mcp__ lesson.
        //
        // `shell` is NOT a version-retired shape and the supported floor does not touch
        // it. It is a NAME in an open vocabulary, not a payload shape, so no version pin
        // can prove it will not be sent again; and misclassifying a shell call as `other`
        // would silently drop the one stampable error leg this adapter has.
        const toolName = name === "exec_command" || name === "shell" ? "Shell" : "other";
        return holdCall(state, payload.call_id, byteOffset, at, toolName, fileBasename);
      }
      if (payload.type === "custom_tool_call") {
        const name = str(payload.name);
        if (name === undefined) return [];
        // apply_patch REQUEST rows: the matching patch_apply_end event is the applied
        // truth (and carries the changes); emitting both double-counts the tool. It gets
        // no pending entry either, so its result row (which DOES carry `Exit code: 0` on
        // every success) is correctly ignored: there is no tool.call for it to land on.
        if (name === "apply_patch") return [];
        return holdCall(state, payload.call_id, byteOffset, at, "other", fileBasename);
      }
      if (
        payload.type === "function_call_output" ||
        payload.type === "custom_tool_call_output"
      ) {
        return releaseCall(state, payload, fileBasename);
      }
      return [];
    }
    default:
      return [];
  }
}

/** agentVersion pin: the tool's version string must LOOK like one before it
 *  ships (a version field that grew a path or prose would otherwise be a
 *  free-text channel — review finding). Anything else reads "unknown". Shares
 *  emit's exported shape so the derivation and the emit pin cannot drift. */
function sanitizeVersion(raw: unknown): string {
  return typeof raw === "string" && AGENT_VERSION_SHAPE.test(raw) ? raw : "unknown";
}

/** Model-id pin, same posture as the version pin: `turn_context.model` is a free-text
 *  field from a tailed file and it SHIPS (it keys the pricing table), so it must look
 *  like a model id or it does not travel. All 6 ids in the local corpus pass
 *  (gpt-5.6-sol, gpt-5.5, gpt-5.4-mini, gpt-5.4, gpt-5.1-codex, gpt-5-codex). */
const MODEL_SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * ── The quota reader (CODEX-CAPTURE ADR-C15) ────────────────────────────────────────
 *
 * `token_count.rate_limits` carries OpenAI's own share-of-limit. Three things about its
 * shape are load-bearing, and all three were MEASURED rather than read off a doc — points
 * 1 and 3 over the 8,704-row corpus that designed this reader, point 2 re-measured over
 * the 259,332-row corpus of 2026-07-27 that set the supported-version floor:
 *
 * 1. THE SLOTS ARE A LIST, NOT A SCHEMA. `primary` is not "the 5-hour window"; it is
 *    "the first limit OpenAI chose to return". On CLI 0.144.1 it holds the WEEKLY window
 *    on 10.6% of rows (41 of 385) and the 5-hour one on the rest, and `secondary` is
 *    null on 43. An adapter that hardcodes primary=5h labels a weekly 2% as a 5-hourly
 *    2% on a ninth of recent rows. So we key on `window_minutes` and read both slots as
 *    an unordered pair. `primary` can also be null outright (a `limit_id: "premium"` row
 *    carries no windows at all), so neither slot may be dereferenced blindly.
 *
 * 2. THE RESET IS AN ABSOLUTE INSTANT, AND A SLOT WITHOUT ONE IS DROPPED. `resets_at` is
 *    UNIX SECONDS, not ISO. 0.46.0 instead shipped a relative `resets_in_seconds`, which
 *    this reader no longer speaks: measured 2026-07-27, all 3,580 slots carrying it are on
 *    0.46.0, below CODEX_MIN_SUPPORTED_CLI_VERSION, and no later version emits it. A
 *    window we cannot date is DROPPED rather than emitted: a percentage with no reset time
 *    cannot be told apart from the same percentage a week stale.
 *
 * 3. AN ABSENT WINDOW IS NOT A ZERO. In one real payload OpenAI reports the weekly
 *    window's emptiness as `0.0%` and the 5-hour window's emptiness by OMITTING it. Both
 *    encodings live in the same row, so absence is unexplained and `?? 0` would fabricate
 *    a measurement. A window we did not see simply does not appear.
 */

/**
 * The two window lengths this reader can name, EXACTLY. Measured 2026-07-27: the only
 * `window_minutes` values in the corpus that are not exactly 300 or 10080 are 0.46.0's
 * 299/10079 pair (2,140 slots, all below CODEX_MIN_SUPPORTED_CLI_VERSION) and a single `0`
 * on 0.144.5, which is not a window length at all. A tolerant rule and an exact rule drop
 * exactly the same rows at and above the floor, so the tolerance bought nothing and only
 * widened the range a future limit could be mistaken for.
 */
const CANONICAL_WINDOWS = [300, 10080] as const;

/**
 * The canonical window length this reading belongs to, or undefined when it matches none.
 *
 * EXACT MATCH, AND UNDEFINED IS A REAL ANSWER. A "closest match wins" rule would file a
 * future hourly or monthly limit under whichever of our two windows it happened to be
 * nearer, and put a confidently wrong number on the menu bar. A window we have no period
 * for is a window we cannot honestly name, so it is dropped until the contract learns it.
 * Fail closed.
 */
function canonicalWindowMinutes(windowMinutes: number): number | undefined {
  return CANONICAL_WINDOWS.find((w) => w === windowMinutes);
}

/** One slot (`primary` / `secondary`) → a dated, bucketed window, or null if unusable. */
function readQuotaWindow(slot: unknown): {
  windowMinutes: number;
  usedPercent: number;
  resetsAt: string;
} | null {
  if (!isPlainObject(slot)) return null; // null slot, or a `premium` row with no windows

  const rawWindow = num(slot.window_minutes);
  if (rawWindow === undefined) return null;
  const windowMinutes = canonicalWindowMinutes(rawWindow);
  if (windowMinutes === undefined) return null;

  const usedPercent = num(slot.used_percent);
  // An ABSENT percent is not a zero, and a percent outside 0..100 is the provider
  // contradicting itself. Refuse the reading in both cases rather than coerce a number we
  // do not have (or do not trust) into a plausible-looking gauge. Every slot in the corpus
  // carries `used_percent`, which is precisely why this guard needs a test: there is no
  // real row to catch a regression, so only the test stands between a future `?? 0` and a
  // fabricated "0% used".
  if (usedPercent === undefined || usedPercent < 0 || usedPercent > 100) return null;

  // resets_at is UNIX SECONDS, and it is the only reset this reader speaks. A slot without
  // one is a window we cannot date, which is the drop rule stated above, not a new one.
  const resetsAtSeconds = num(slot.resets_at);
  if (resetsAtSeconds === undefined) return null;

  const resetsAt = new Date(resetsAtSeconds * 1000);
  if (Number.isNaN(resetsAt.getTime())) return null;

  return { windowMinutes, usedPercent, resetsAt: resetsAt.toISOString() };
}

/**
 * `rate_limits` → the windows of an `agent.quota` event, or [] when the row carries none
 * we can use. Both slots are read and DEDUPED by window: the reading is one snapshot, so
 * two slots naming the same window would be one fact twice (never observed in 8,659 rows
 * carrying both, and cheap to make impossible).
 */
export function readQuotaWindows(
  rateLimits: unknown,
): { windowMinutes: number; usedPercent: number; resetsAt: string }[] {
  if (!isPlainObject(rateLimits)) return [];
  const byWindow = new Map<number, { windowMinutes: number; usedPercent: number; resetsAt: string }>();
  for (const slotName of ["primary", "secondary"] as const) {
    const window = readQuotaWindow(rateLimits[slotName]);
    if (window !== null && !byWindow.has(window.windowMinutes)) {
      byWindow.set(window.windowMinutes, window);
    }
  }
  // Sorted so the same reading always serializes identically (a stable event body).
  return [...byWindow.values()].sort((a, b) => a.windowMinutes - b.windowMinutes);
}

/**
 * Where Codex's own header ends and the COMMAND'S OWN STDOUT begins. Everything after
 * this marker is content the command printed, and it is never read.
 */
const EXEC_BODY_MARKER = /(?:^|\n)Output:\n/;

/**
 * `Process exited with code N`, anchored as a COMPLETE line. Not a substring search:
 * a line that merely CONTAINS the phrase is not Codex's header line.
 */
const EXIT_LINE = /^Process exited with code (-?\d+)$/;

/**
 * The exit code of a SHELL result, or null when the row does not honestly carry one
 * (CODEX-CAPTURE ADR-C5). Null contributes NOTHING: the call ends up in neither leg of
 * the error rate, which is what makes a partial error leg honest by construction.
 *
 * WHY THE HEADER, AND ONLY THE HEADER. An exec result looks like this:
 *
 *     Chunk ID: e314f8
 *     Wall time: 0.0972 seconds
 *     Process exited with code 0        <- Codex's word. THIS is what we read.
 *     Original token count: 2170
 *     Output:
 *     <the command's own stdout>        <- content. NEVER read.
 *
 * A command can print anything, including `Process exited with code 1`: `cat` a build log,
 * `echo` the phrase, grep a source file that mentions it. Scanning the whole result would
 * let the command FABRICATE an error against itself, which is the exact class of bug the
 * "never derive errors by string-matching output" rule exists to forbid. Splitting on the
 * body marker makes that impossible by construction rather than by luck. (Measured: 0 of
 * 7,121 shell bodies in the corpus contain the phrase today. That is an accident of what
 * happened to get run, and this guard does not depend on it staying true.)
 *
 * FAIL CLOSED. A result with no body marker at all (13 in-corpus) yields null, because
 * without the marker the header cannot be separated from the body, and a guess about which
 * half we are reading is not a measurement.
 *
 * ONE SHAPE, AND IT IS THE CURRENT ONE. A JSON envelope carrying the exit code as
 * `metadata.exit_code` used to be read here too. Measured 2026-07-27: 1,878 result rows in
 * the corpus carry that shape and every one is on 0.46.0 (764) or 0.58.0 (1,114) — zero on
 * 0.116.0 and on all 20 versions after it. It served only versions below
 * CODEX_MIN_SUPPORTED_CLI_VERSION, so it is gone, and a non-string output is now simply a
 * result we cannot read: null, absent, neither leg.
 */
export function shellExitCode(output: unknown): number | null {
  if (typeof output !== "string") return null;

  const body = EXEC_BODY_MARKER.exec(output);
  if (body === null) return null; // no marker -> cannot tell header from body -> refuse
  const header = output.slice(0, body.index);
  for (const line of header.split("\n")) {
    const match = EXIT_LINE.exec(line.trim());
    if (match !== null) {
      const code = Number(match[1]);
      return Number.isInteger(code) ? code : null;
    }
  }
  // No exit line in the header. The observed reasons are all honest absences: the process
  // was BACKGROUNDED ("Process running with session ID N"), the sandbox refused the command,
  // or the user aborted the turn. None of them is a failed call, and none of them is a
  // passed one.
  return null;
}

/**
 * One cumulative reading, validated against the SOURCE's own arithmetic before we
 * transform it (CODEX-CAPTURE ADR-C3). Returns null when the row does not reconcile,
 * and a null contributes NOTHING: an undercount is honest, a coerced number is not.
 *
 * Two properties are checked, both verified true on 686/686 real usage rows:
 *   input >= cachedInput   — because input is cache-INCLUSIVE, so the cache read is a
 *                            SUBSET of it. If this inverts, de-inclusion would go
 *                            negative and mint a negative token count.
 *   total == input + output — the proof that `output` already CONTAINS its reasoning
 *                            tokens (so we must NOT subtract them) and that no fifth
 *                            billable bucket is hiding in the row.
 *
 * That second check is also what quarantines the `last_token_usage` sentinel: 26 rows
 * in the corpus carry an all-zero breakdown with a large non-zero total (157,138 on
 * one), always right after a `turn_aborted`. We never read that field — we read
 * `total_token_usage`, which has no such shape — but the guard means that even if a
 * future Codex put that shape HERE, it would be dropped rather than priced at $0.
 */
function readTotals(usage: Record<string, unknown>): CodexTokenTotals | null {
  const input = num(usage.input_tokens);
  const cachedInput = num(usage.cached_input_tokens);
  const output = num(usage.output_tokens);
  const total = num(usage.total_tokens);
  if (input === undefined || cachedInput === undefined) return null;
  if (output === undefined || total === undefined) return null;
  if (input < 0 || cachedInput < 0 || output < 0) return null;
  if (input < cachedInput) return null;
  if (total !== input + output) return null;
  return { input, cachedInput, output, total };
}

const ZERO_TOTALS: CodexTokenTotals = { input: 0, cachedInput: 0, output: 0, total: 0 };

/**
 * token_count → a CUMULATIVE, per-model `session.tokens` snapshot (CODEX-CAPTURE
 * ADR-C2/C3/C4). Reads `info.total_token_usage` ONLY, never `last_token_usage`.
 *
 * THE DELTA WALK. `total_token_usage` is the session's running total, and it is
 * monotonic in every component (verified: zero decreases across all 109 local
 * rollouts). Subtracting the previous reading gives THIS turn's usage, which we
 * attribute to the model that `turn_context` last named. Walking deltas is what makes
 * a multi-model session priceable: the cumulative totals alone blend the models
 * together and cannot be un-blended after the fact.
 *
 * THE DE-INCLUSION. Codex's `input_tokens` INCLUDES `cached_input_tokens`; Seorak's
 * `inputTokens` excludes cache reads (Claude's convention). Copying the fields across
 * would count the cached tokens twice and fabricate a cache-reuse ratio out of the
 * double count. De-including the DELTAS is equivalent to delta-ing the de-included
 * values, since subtraction distributes, so it is done once, here.
 *
 * `reasoning_output_tokens` is deliberately NOT subtracted from output: the
 * `total == input + output` identity proves it is already inside `output`, and the
 * vendor bills it as output.
 *
 * Emits nothing until a model has actually consumed tokens, so a session that opened
 * but never billed carries no snapshot rather than a row of zeros.
 */
function handleTokenCount(
  payload: Record<string, unknown>,
  at: string,
  byteOffset: number,
  fileBasename: string,
  state: CodexFileState,
): SessionEvent[] {
  const sessionId = state.sessionId;
  if (sessionId === null) return [];

  // ── THE QUOTA READING IS BUILT FIRST, AND THAT ORDER IS THE DESIGN ──────────────
  // `rate_limits` rides the same row as the token totals, so hanging it off the
  // `session.tokens` event below looks natural and is wrong. Every `return []` after
  // this point exists for a TOKEN reason — chiefly "no token movement", because Codex
  // re-emits `token_count` with unchanged cumulative totals — and the ACCOUNT quota is
  // fresh on those rows regardless. Measured over the real corpus: emitting quota behind
  // those guards would have silently dropped 2,272 of 8,718 readings (26.1%).
  //
  // Two events, two ids. `codexQuotaEventId` uses its own namespace token because both
  // events come from the same (session, file, byteOffset), and sharing an id would make
  // `INSERT OR IGNORE` drop one of them with nothing failing anywhere.
  const events: SessionEvent[] = [];
  const quotaWindows = readQuotaWindows(payload.rate_limits);
  if (quotaWindows.length > 0) {
    events.push({
      kind: "agent.quota",
      eventId: codexQuotaEventId(sessionId, fileBasename, byteOffset),
      sessionId,
      at,
      tool: "codex",
      windows: quotaWindows,
    });
  }

  const info = isPlainObject(payload.info) ? payload.info : undefined;
  if (info === undefined) return events; // 25 rows in-corpus carry an empty `info`.
  const usage = isPlainObject(info.total_token_usage) ? info.total_token_usage : undefined;
  if (usage === undefined) return events;

  const totals = readTotals(usage);
  if (totals === null) return events;

  const prev = state.prevTokens ?? ZERO_TOTALS;
  const dInput = totals.input - prev.input;
  const dCached = totals.cachedInput - prev.cachedInput;
  const dOutput = totals.output - prev.output;

  // Resync the walk to the source's own series even when we refuse the delta, so one
  // anomalous reading cannot poison every reading after it. (A non-advancing cursor
  // would compute the NEXT delta against a stale base and compound the error.)
  state.prevTokens = totals;

  // A negative component means the source contradicted its own monotonicity, and a
  // negative de-included input (cache read growing faster than input) means the cache
  // read stopped being a subset of the input. Neither has ever been observed in 6,388
  // real turns. If either happens, this turn contributes nothing: an undercount is a
  // measurement error, a negative token count is a fabrication.
  const dInputExclusive = dInput - dCached;
  if (dInput < 0 || dCached < 0 || dOutput < 0 || dInputExclusive < 0) return events;
  if (dInputExclusive === 0 && dCached === 0 && dOutput === 0) return events;

  // No turn_context yet means no honest model to attribute these tokens to. Never seen
  // (0 of 6,388 turns), and if it happens we drop the tokens rather than invent a model
  // or invent an "unknown" one that would then need a price.
  const model = state.activeModel;
  if (model === null) return events;

  const acc = state.tokensByModel[model] ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
  acc.inputTokens += dInputExclusive;
  acc.cacheReadTokens += dCached;
  acc.outputTokens += dOutput;
  state.tokensByModel[model] = acc;

  // The snapshot is the WHOLE running total, every model, re-emitted. Sorted so the
  // same state always serializes to the same payload (a stable event body for a stable
  // event id). A model that has consumed nothing is absent, never a zero row.
  const models = Object.keys(state.tokensByModel)
    .sort()
    .map((m) => ({ model: m, ...state.tokensByModel[m]!, cacheWriteTokens: 0 }))
    .filter((m) => m.inputTokens > 0 || m.outputTokens > 0 || m.cacheReadTokens > 0);
  if (models.length === 0) return events;

  return [
    ...events,
    {
      kind: "session.tokens",
      eventId: codexRolloutEventId(sessionId, fileBasename, byteOffset),
      sessionId,
      at,
      models,
    },
  ];
}

/**
 * The first session_meta names the file's session; later ones are duplicates
 * (window/resume re-emissions of the SAME id) and are normally dropped. A meta
 * whose id differs from the recorded one would mean the one-file-one-session
 * invariant broke upstream — the file keeps its FIRST identity and the new
 * rows stay attributed to it (deterministic either way; the drift shows up in
 * the next corpus survey, not as a mis-keyed event).
 *
 * START RE-EMISSION (review finding, the lost-start crash window): this
 * function no longer flips `startEmitted` — the TAILER sets it only after the
 * session.start is DURABLY appended. If a prior tick recorded the identity but
 * the append failed (state persisted, cursor not advanced), the re-read meta
 * arrives here with `sessionId` already set and `startEmitted` still false:
 * rebuild the start anchored on the PERSISTED `startOffset`, so the retry
 * carries the exact same event id as the lost attempt.
 */
function handleSessionMeta(
  payload: Record<string, unknown>,
  at: string,
  byteOffset: number,
  fileBasename: string,
  state: CodexFileState,
): SessionEvent[] {
  const sessionId = str(payload.id);
  const cwd = str(payload.cwd);

  if (state.sessionId !== null) {
    // Duplicate meta. Normally silence — unless the start itself is still owed
    // (append failed after the identity was recorded): re-emit it, anchored on
    // the ORIGINAL meta's offset so the id is identical to the lost attempt.
    if (state.startEmitted || state.sessionId !== sessionId || state.startOffset === null) {
      return [];
    }
    return [buildSessionStart(payload, at, state.startOffset, fileBasename, state.sessionId)];
  }

  if (sessionId === undefined || cwd === undefined) {
    // Cannot attribute a session or a repo — nothing this file emits later
    // could be honest, so mark it skipped rather than half-capture it.
    state.skip = true;
    return [];
  }

  // Machine-initiated threads are skipped, deterministically (ADR-T7):
  // `thread_source: "subagent"` and the source-object subagent spawn are the
  // OBSERVED shapes; any OTHER non-"user" thread_source (a future fork/replay
  // kind) skips too — fail closed, because a fork COPIES parent history and
  // tailing it re-emits that history under a new session id, a cross-session
  // double count the event-id PK cannot collapse. Undercount over fabrication.
  const source = payload.source;
  const threadSource = payload.thread_source;
  const isMachineThread =
    (typeof threadSource === "string" && threadSource !== "user") ||
    (isPlainObject(source) && "subagent" in source);

  state.sessionId = sessionId;
  state.startOffset = byteOffset;
  if (isMachineThread) {
    state.skip = true;
    return [];
  }

  // A below-floor version captures FINE, minus the two measurements this adapter no longer
  // reads for it (CODEX_MIN_SUPPORTED_CLI_VERSION), and the resulting events look exactly
  // like a modern session's with those fields absent. The daemon log is the only place a
  // degraded capture can announce itself, so it does — once, here, on the FIRST meta of the
  // file. The duplicate-meta branch above returns before reaching this line, so a resumed
  // or re-emitted meta cannot repeat it, and the warning changes nothing: no event is
  // added, dropped, re-shaped, or re-keyed by it.
  if (isBelowSupportedFloor(payload.cli_version)) {
    console.warn(
      `[seorak] codex ${sanitizeVersion(payload.cli_version)} is below the supported rollout floor ${CODEX_MIN_SUPPORTED_CLI_VERSION}. This session captures with no shell error stamp and no quota window; sessions, prompts, tool calls, and tokens are unaffected.`,
    );
  }

  return [buildSessionStart(payload, at, byteOffset, fileBasename, sessionId)];
}

/** Build the session.start (shared by first emission and the owed-start retry).
 *  Anchored on the FIRST meta's byte offset — persisted as `startOffset` — so a
 *  re-tail or retry from any point re-derives this exact id. */
function buildSessionStart(
  payload: Record<string, unknown>,
  at: string,
  startOffset: number,
  fileBasename: string,
  sessionId: string,
): SessionStartEvent {
  // cwd is consumed LOCALLY: salted repoId + basename label, and registering
  // the repo so the daemon's momentum sweep covers it (git momentum is
  // tool-independent — the Codex repo gets it for free). The path never ships.
  const cwd = str(payload.cwd) ?? "";
  const { repoId, repoLabel } = repoIdentityOrCwd(cwd);
  if (momentumEnabled()) registerRepoFromCwd(cwd, at);

  // Work-type from the branch RECORDED IN THE META (Codex wrote it at session
  // start — honest even when the tail runs hours later and the repo has moved
  // on). Classified to the closed enum; the branch string is discarded. Same
  // momentum gate as the Claude builder.
  const branch = momentumEnabled()
    ? str(isPlainObject(payload.git) ? payload.git.branch : undefined)
    : undefined;
  const branchWorkType = branch ? classifyBranchWorkType(branch) : undefined;

  return {
    kind: "session.start",
    eventId: codexRolloutEventId(sessionId, fileBasename, startOffset),
    sessionId,
    at,
    repoId,
    repoLabel,
    agent: AGENT,
    // The tool's own word (session_meta.cli_version), e.g. "0.142.5", pinned to
    // a version SHAPE — the per-version capability future keys on this. Never
    // an env guess, never free text.
    agentVersion: sanitizeVersion(payload.cli_version),
    capabilities: resolveCapabilities(AGENT),
    ...(branchWorkType !== undefined ? { branchWorkType } : {}),
  };
}

/**
 * patch_apply_end → ONE tool.call "ApplyPatch". `changes` is keyed by ABSOLUTE
 * path; values carry `unified_diff` (updates) or `content` (adds). Both are
 * read here to COUNT and discarded (unifiedDiffLineCounts / lineCount — the
 * same derive-on-machine move as Claude's LCS edit counts). Edit lines ride
 * only a successful apply (success !== true → the edit never landed; counts
 * would be fiction) and only under the lineCounts capture toggle. The salted
 * file identity rides only when the patch touched EXACTLY one file — a
 * multi-file patch gets counts but no single-file identity (absent, never a
 * fabricated pick) — and only under the fileSignals toggle.
 */
function handlePatchApplyEnd(
  payload: Record<string, unknown>,
  at: string,
  byteOffset: number,
  fileBasename: string,
  sessionId: string,
): SessionEvent[] {
  const call = bareToolCall(sessionId, fileBasename, byteOffset, at, "ApplyPatch");
  if (payload.success !== true || !isPlainObject(payload.changes)) return [call];

  const settings = captureSettings();
  const paths = Object.keys(payload.changes);

  if (settings.lineCounts) {
    const parts: EditLineCounts[] = [];
    for (const change of Object.values(payload.changes)) {
      if (!isPlainObject(change)) continue;
      // The three observed change shapes (corpus 2026-07-10: update ×909 with a
      // unified_diff, add ×133 and delete ×13 both carrying `content`). The
      // `type` value decides the SIGN: a deleted file's content is REMOVED
      // lines — counting it as added would sign-invert the one sanctioned
      // head-to-head stat (review finding, repro'd on the real corpus). An
      // unrecognized type (drift) contributes nothing — an undercount, never
      // a guess.
      const diff = str(change.unified_diff);
      const content = str(change.content);
      if (change.type === "update" && diff !== undefined) {
        parts.push(unifiedDiffLineCounts(diff));
      } else if (change.type === "add" && content !== undefined) {
        parts.push({ added: lineCount(content), removed: 0 });
      } else if (change.type === "delete" && content !== undefined) {
        parts.push({ added: 0, removed: lineCount(content) });
      }
    }
    if (parts.length > 0) {
      const { added, removed } = sumEditLineCounts(parts);
      call.linesAdded = added;
      call.linesRemoved = removed;
    }
  }

  if (settings.fileSignals && paths.length === 1 && paths[0] !== undefined) {
    const identity = fileIdentityForPath(paths[0], settings.fileLabels);
    call.fileId = identity.fileId;
    call.dirId = identity.dirId;
    if (identity.fileCategory !== undefined) call.fileCategory = identity.fileCategory;
    if (identity.fileLanguage !== undefined) call.fileLanguage = identity.fileLanguage;
    if (identity.fileLabel !== undefined) call.fileLabel = identity.fileLabel;
    if (identity.dirLabel !== undefined) call.dirLabel = identity.dirLabel;
  }

  return [call];
}

/**
 * A tool call, seen but NOT emitted (ADR-C13). It is held until its result row arrives,
 * because the result is the only row that knows whether the call failed and an append-only
 * log has no UPDATE: re-emitting the call later with `errored` added is a silent no-op on
 * the worker's `event_id` PK (`INSERT OR IGNORE` keeps the unstamped row, with no error and
 * no warning) AND a double count in KV, whose reducer does not dedupe by event id.
 *
 * Returns any call EVICTED to make room, emitted unstamped.
 */
function holdCall(
  state: CodexFileState,
  rawCallId: unknown,
  byteOffset: number,
  at: string,
  toolName: CodexToolName,
  fileBasename: string,
): SessionEvent[] {
  const sessionId = state.sessionId;
  if (sessionId === null) return [];

  const callId = str(rawCallId);
  // A call with no call id can never be correlated to its result, so it is DROPPED and
  // emits nothing. This used to emit immediately and unstamped, framed as degrading to an
  // older rollout vocabulary — but there is no such vocabulary: measured 2026-07-27, 0 of
  // 43,522 call rows across all 22 observed versions omit `call_id`, 0.46.0 included, and
  // 0 of 43,522 result rows do either. It was speculative compatibility for a producer
  // that has never existed, and this module's rule for a producer it does not recognize is
  // already written down — format drift lands as silence. An undercount, never a
  // fabrication.
  if (callId === undefined) return [];

  const evicted = evictOldestIfFull(state, sessionId, fileBasename);
  // A call id already pending is a RE-PARSE of the same row (a crash before the cursor
  // advanced re-reads the batch), so overwriting with identical coordinates is the
  // idempotent move. Flushing the "duplicate" instead would emit a tool.call whose id is
  // the one the result row is about to emit again: collapsed by D1's PK, but DOUBLE
  // COUNTED by KV. Overwrite, never flush.
  state.pendingCalls[callId] = { offset: byteOffset, at, toolName };
  return evicted;
}

/**
 * The result row. This is where a Codex tool.call is finally emitted, carrying `errored`
 * when its header gave us an exit code to carry.
 */
function releaseCall(
  state: CodexFileState,
  payload: Record<string, unknown>,
  fileBasename: string,
): SessionEvent[] {
  const sessionId = state.sessionId;
  if (sessionId === null) return [];

  const callId = str(payload.call_id);
  if (callId === undefined) return [];

  const pending = state.pendingCalls[callId];
  // A result with no pending call. Three honest cases, and emitting in ANY of them would
  // be wrong:
  //   - the call row was consumed by the PRE-Phase-3 adapter, which already emitted its
  //     tool.call (unstamped) and advanced the cursor past it. The row is in D1. Emitting
  //     again would duplicate it.
  //   - the call was evicted by the pending cap and has already been emitted unstamped.
  //   - `apply_patch`, which is deliberately never held: `patch_apply_end` is its truth.
  if (pending === undefined) return [];
  delete state.pendingCalls[callId];

  const call = bareToolCall(
    sessionId,
    fileBasename,
    pending.offset,
    pending.at,
    pending.toolName,
  );
  // ONLY the shell. `write_stdin` carries the same header, but its exit code reports the
  // fate of the BACKGROUND PROCESS it wrote to, not whether the write succeeded (25 of its
  // 27 results read "Process running with session ID"), so stamping it would call a
  // successful write errored the moment a backgrounded process exits non-zero. Every other
  // tool either reports nothing readable (`exec` says only "Script completed") or reports
  // through a third-party MCP schema we deliberately do not parse. Absent, in all of them.
  if (pending.toolName === "Shell") {
    const code = shellExitCode(payload.output);
    if (code !== null) call.errored = code !== 0;
  }
  return [call];
}

/**
 * Make room in the pending map by emitting the OLDEST held call, unstamped.
 *
 * This is the safety valve, and its whole job is to make the worst case a DEGRADED call
 * rather than a MISSING one: a call whose result row never arrives (a SIGKILL between the
 * two rows) would otherwise sit in the persisted state forever and never be emitted at all.
 * Measured: 0 of 9,315 calls in the corpus failed to get a result, so this should never
 * fire; it exists because "should never" is not "cannot".
 *
 * Oldest is by BYTE OFFSET, not by map insertion order, so the choice survives a state
 * round-trip through JSON and stays deterministic under a re-tail.
 */
function evictOldestIfFull(
  state: CodexFileState,
  sessionId: string,
  fileBasename: string,
): SessionEvent[] {
  const entries = Object.entries(state.pendingCalls);
  if (entries.length < MAX_PENDING_CALLS) return [];

  let oldestId = entries[0]![0];
  let oldest = entries[0]![1];
  for (const [id, call] of entries) {
    if (call.offset < oldest.offset) {
      oldestId = id;
      oldest = call;
    }
  }
  delete state.pendingCalls[oldestId];
  return [
    bareToolCall(sessionId, fileBasename, oldest.offset, oldest.at, oldest.toolName),
  ];
}

/**
 * The minimal honest Codex tool.call. Token/cost fields are the schema-required
 * zeros a KV-legacy row also carries. What keeps them honest is the cost scope,
 * not the registry: Codex declares `costScope: 'session'`, so `pricesPerCall`
 * refuses these rows in every per-call dollar aggregate and the real money rides
 * the `session.tokens` carrier (ADR-C12).
 *
 * `errored` is ABSENT here and added by `releaseCall` only where an exit code genuinely
 * exists. Absent is not "false": the worker's rate keys on PRESENCE (`errorRateFromRows`),
 * so a call with no observable result lands in NEITHER leg and can never pull the rate
 * toward a fabricated 0%.
 */
function bareToolCall(
  sessionId: string,
  fileBasename: string,
  byteOffset: number,
  at: string,
  toolName: CodexToolName,
): ToolCallEvent {
  return {
    kind: "tool.call",
    eventId: codexRolloutEventId(sessionId, fileBasename, byteOffset),
    sessionId,
    at,
    toolName,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

/**
 * codex-adapter.test.ts — the Codex rollout adapter's honesty contracts
 * (CODEX-TAILER.md ADR-T2/T4/T5/T6/T7).
 *
 * The load-bearing suites:
 *   1. SCRUB PROOF — one fixture per OBSERVED rollout row type/sub-type (the
 *      2026-07-10 corpus vocabulary), each with a unique content marker planted
 *      in every content-bearing field. Whatever the adapter emits must pass
 *      assertEmitSafe AND contain none of the markers. Drop-by-default is
 *      pinned separately with unknown types (format drift lands as silence).
 *   2. SESSION IDENTITY — first meta emits ONE session.start anchored on its
 *      byte offset; duplicate metas drop; a reconstructed-state re-parse (the
 *      mid-file restart) reproduces identical event ids; subagent files skip.
 *   3. HONEST-EMPTY — no `errored`, zero tokens, no models, capabilities at
 *      the registry floor, no session.end ever.
 *
 * fs-sandboxed (SEORAK_DIR) so the machine salt and capture-settings cache are
 * test-local; SEORAK_MOMENTUM=0 keeps the builders git/registry-free (the cwd
 * fixtures are not repos).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CODEX_MIN_SUPPORTED_CLI_VERSION,
  initialCodexFileState,
  MAX_PENDING_CALLS,
  parseRolloutLine,
  shellExitCode,
  type CodexFileState,
} from "../src/adapters/codex.ts";
import { resetCaptureSettingsCache } from "../src/capture-settings.ts";
import { codexRolloutEventId } from "../src/codex-event-id.ts";
import { assertEmitSafe } from "../src/emit.ts";
import { captureSettingsPath } from "../src/paths.ts";

let sandbox: string;
const savedDir = process.env.SEORAK_DIR;
const savedMomentum = process.env.SEORAK_MOMENTUM;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "seorak-codexadapter-"));
  process.env.SEORAK_DIR = sandbox;
  process.env.SEORAK_MOMENTUM = "0";
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
  if (savedMomentum === undefined) delete process.env.SEORAK_MOMENTUM;
  else process.env.SEORAK_MOMENTUM = savedMomentum;
});

beforeEach(() => {
  resetCaptureSettingsCache(); // defaults-on unless a test writes capture.json
});

const FILE = "rollout-2026-07-10T12-12-14-019f4ccd-0cea-7492-a137-e55d0be08fee.jsonl";
const SESSION = "019f4ccd-0cea-7492-a137-e55d0be08fee";
const AT = "2026-07-10T12:12:14.512Z";
const CWD = "/tmp/seorak-codex-test-not-a-repo";

/** A rollout line: {timestamp, type, payload} serialized like the real file. */
const line = (type: string, payload: Record<string, unknown>, at = AT): string =>
  JSON.stringify({ timestamp: at, type, payload });

const metaLine = (extra: Record<string, unknown> = {}): string =>
  line("session_meta", {
    id: SESSION,
    timestamp: AT,
    cwd: CWD,
    originator: "codex-tui",
    cli_version: "0.142.5",
    source: "cli",
    git: { branch: "feat/multitool", commit_hash: "a".repeat(40), repository_url: "https://github.com/secret-org/secret-repo.git" },
    ...extra,
  });

/** Parse a whole synthetic file (array of lines) with a fresh state, returning
 *  every event plus the state — offsets computed exactly like the tailer's. */
function parseAll(lines: string[], state: CodexFileState = initialCodexFileState()) {
  const events = [];
  let offset = 0;
  for (const l of lines) {
    events.push(...parseRolloutLine(l, offset, FILE, state));
    offset += Buffer.byteLength(l, "utf8") + 1;
  }
  return { events, state };
}

// ── 1. the scrub proof ────────────────────────────────────────────────────────

describe("SCRUB PROOF: every observed row type, content planted, nothing leaks", () => {
  // One marker per content surface. If ANY of these strings appears in an
  // emitted event, the adapter copied content instead of deriving from it.
  const M = {
    systemPrompt: "MARKER_BASE_INSTRUCTIONS_SYSTEM_PROMPT",
    repoUrl: "MARKER_REPOSITORY_URL",
    prompt: "MARKER_USER_PROMPT_TEXT",
    agentProse: "MARKER_AGENT_MESSAGE_PROSE",
    reasoning: "MARKER_REASONING_TEXT",
    command: "MARKER_SHELL_COMMAND",
    stdout: "MARKER_STDOUT_TEXT",
    stderr: "MARKER_STDERR_TEXT",
    diff: "MARKER_UNIFIED_DIFF_BODY",
    envPath: "/Users/someone/secret/.env",
    transcript: "MARKER_COMPACTED_TRANSCRIPT",
    toolArgs: "MARKER_TOOL_ARGUMENTS",
    mcpResult: "MARKER_MCP_RESULT",
    searchQuery: "MARKER_SEARCH_QUERY",
    dynamicTool: "super_secret_dynamic_tool",
  } as const;

  /** The full observed vocabulary (survey 2026-07-10: 5 top-level types, 15
   *  event_msg + 11 response_item sub-types), every content field loaded. */
  const CORPUS: string[] = [
    metaLine({
      base_instructions: { text: M.systemPrompt },
      instructions: M.systemPrompt,
      dynamic_tools: [{ name: M.dynamicTool, description: M.systemPrompt }],
      git: { branch: "feat/x", commit_hash: "b".repeat(40), repository_url: M.repoUrl },
    }),
    line("turn_context", { cwd: CWD, model: "gpt-5.5", approval_policy: "never", sandbox_policy: {}, effort: "high", summary: M.agentProse, personality: M.agentProse, workspace_roots: [CWD] }),
    line("compacted", { message: M.transcript, replacement_history: [M.transcript], window_id: 1 }),
    // event_msg sub-types
    // NOTE the arithmetic: input(100) + output(15) == total(115), and input INCLUDES
    // cached(50), output INCLUDES reasoning(5). That is the real invariant Codex holds
    // (686/686 rows). This fixture used to claim total:115 against input:100 + output:10,
    // which reconciles to 110 — a shape Codex never emits. The adapter's guard correctly
    // REJECTS a row like that, so the broken fixture was silently switching the token path
    // OFF in this very scrub proof. A fixture consumes the contract; it never authors it.
    line("event_msg", { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 50, output_tokens: 15, reasoning_output_tokens: 5, total_tokens: 115 }, last_token_usage: {}, model_context_window: 272000 }, rate_limits: { primary: { used_percent: 12.5, window_minutes: 300, resets_at: AT }, plan_type: "plus" } }),
    line("event_msg", { type: "agent_message", message: M.agentProse, phase: "answer" }),
    line("event_msg", { type: "agent_reasoning", text: M.reasoning }),
    line("event_msg", { type: "patch_apply_end", call_id: "c1", turn_id: "t1", success: true, status: "completed", stdout: M.stdout, stderr: M.stderr, changes: { "/Users/someone/secret/project/file.ts": { type: "update", unified_diff: `--- a\n+++ b\n+${M.diff}\n-old`, move_path: null } } }),
    line("event_msg", { type: "user_message", message: M.prompt, kind: "plain", images: ["data:image/png;base64,MARKER_B64"], local_images: [M.envPath], text_elements: [M.prompt] }),
    line("event_msg", { type: "task_started", turn_id: "t1", model_context_window: 272000, collaboration_mode_kind: "default", started_at: AT }),
    line("event_msg", { type: "task_complete", turn_id: "t1", last_agent_message: M.agentProse, duration_ms: 12, completed_at: AT, time_to_first_token_ms: 5 }),
    line("event_msg", { type: "mcp_tool_call_end", call_id: "c2", invocation: { server: "secret-server", tool: M.dynamicTool, arguments: M.toolArgs }, duration: {}, result: { Ok: { content: [M.mcpResult], isError: false } } }),
    line("event_msg", { type: "web_search_end", call_id: "c3", query: M.searchQuery }),
    line("event_msg", { type: "exec_command_end", call_id: "c4", command: [M.command], cwd: CWD, stdout: M.stdout, stderr: M.stderr, aggregated_output: M.stdout, exit_code: 1, duration: {}, formatted_output: M.stdout, parsed_cmd: [{ cmd: M.command }], process_id: "p1", source: "unified_exec_startup", status: "failed", turn_id: "t1" }),
    line("event_msg", { type: "turn_aborted", reason: "interrupted", turn_id: "t1", duration_ms: 5, completed_at: AT }),
    line("event_msg", { type: "context_compacted" }),
    line("event_msg", { type: "thread_rolled_back", num_turns: 2 }),
    line("event_msg", { type: "error", message: M.stderr, codex_error_info: M.stderr }),
    line("event_msg", { type: "image_generation_end", call_id: "c5" }),
    // response_item sub-types
    line("response_item", { type: "function_call", name: "exec_command", call_id: "c6", arguments: JSON.stringify({ cmd: M.command, workdir: CWD, max_output_tokens: 1000, yield_time_ms: 100 }) }),
    line("response_item", { type: "function_call", name: M.dynamicTool, call_id: "c7", arguments: M.toolArgs }),
    line("response_item", { type: "function_call_output", call_id: "c6", output: `Chunk ID: abc123\nWall time: 1.2 seconds\nProcess exited with code 1\nOriginal token count: 50\nOutput:\n${M.stdout}` }),
    // c7's result. The xcodebuildmcp family DOES carry a structured `didError` boolean, so
    // these tools are not "unable to report an error" — we DECLINE to read them, because it
    // is a third-party MCP server's schema on an open vocabulary and every one of them
    // buckets into `other`, where a blended rate would mean nothing (ADR-C5). This row pins
    // that we keep declining: `didError: true` here must NOT stamp `errored`.
    line("response_item", { type: "function_call_output", call_id: "c7", output: `Wall time: 0.5 seconds\nOutput:\n{"schema":"xcodebuildmcp.output.error","schemaVersion":"1","didError":true,"error":"${M.mcpResult}"}` }),
    line("response_item", { type: "custom_tool_call", name: "apply_patch", call_id: "c8", input: `*** Begin Patch\n${M.diff}\n*** End Patch` }),
    line("response_item", { type: "custom_tool_call", name: "exec", call_id: "c9", input: M.command }),
    // c8's result. apply_patch's SUCCESS carries `Exit code: 0`, and this is the one that
    // must go nowhere: the adapter drops the apply_patch CALL row (patch_apply_end is the
    // applied truth), so there is no held call for this result to land on, and its exit code
    // reaches no tool.call at all. All 54 `Exit code:` rows in the corpus are this shape.
    line("response_item", { type: "custom_tool_call_output", call_id: "c8", output: `Exit code: 0\n${M.stdout}` }),
    // c9's result, in the REAL shape `exec` emits: an ARRAY of content blocks whose first
    // text is "Script completed". No exit code, anywhere, on any of its 109 corpus calls.
    // It is a tool that genuinely cannot tell us how it went, and it must stay in neither leg.
    line("response_item", { type: "custom_tool_call_output", call_id: "c9", output: [{ type: "input_text", text: "Script completed\nWall time 0.8 seconds\nOutput:\n" }, { type: "input_text", text: M.stdout }] }),
    line("response_item", { type: "reasoning", summary: [M.reasoning], content: [M.reasoning], encrypted_content: "MARKER_ENCRYPTED" }),
    line("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: M.agentProse }], phase: "answer" }),
    line("response_item", { type: "ghost_snapshot", ghost_commit: { id: "c".repeat(40), parent: "d".repeat(40), preexisting_untracked_files: [M.envPath], preexisting_untracked_dirs: ["/Users/someone/secret"] } }),
    line("response_item", { type: "web_search_call", action: { query: M.searchQuery }, status: "completed" }),
    line("response_item", { type: "tool_search_call", call_id: "c10", arguments: M.searchQuery, execution: {}, status: "completed" }),
    line("response_item", { type: "tool_search_output", call_id: "c10", tools: [{ name: M.dynamicTool }], execution: {}, status: "completed" }),
    line("response_item", { type: "image_generation_call", call_id: "c11" }),
  ];

  it("every emitted event is allowlist-clean and carries NO planted content", () => {
    const { events } = parseAll(CORPUS);
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    for (const event of events) expect(() => assertEmitSafe(event)).not.toThrow();
    for (const [name, marker] of Object.entries(M)) {
      expect(serialized, `content surface "${name}" leaked`).not.toContain(marker);
    }
    // The cwd and every absolute path never appear (repo/file ids are salted
    // hashes; labels are basenames). The SESSION uuid itself rides as the
    // envelope sessionId by design — an opaque random id, the same contract as
    // Claude's hook session_id — so it is deliberately NOT asserted absent.
    expect(serialized).not.toContain(CWD);
    expect(serialized).not.toContain("/Users/");
  });

  it("emits exactly the designed slice: 1 start + Shell + 2 other + ApplyPatch + 1 prompt + 1 tokens", () => {
    const { events } = parseAll(CORPUS);
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "session.start")).toHaveLength(1);
    expect(kinds.filter((k) => k === "session.prompt")).toHaveLength(1);
    const tools = events.filter((e) => e.kind === "tool.call") as Array<{ toolName: string }>;
    // exec_command → Shell; the dynamic tool + custom `exec` → other; the
    // apply_patch REQUEST row is dropped, its patch_apply_end is the ApplyPatch.
    expect(tools.map((t) => t.toolName).sort()).toEqual(["ApplyPatch", "Shell", "other", "other"]);
    // The one token_count row emits ONE cumulative snapshot, attributed to the model the
    // preceding turn_context named. Its numbers are the de-inclusion: Codex's input(100)
    // INCLUDES its cached(50), so Seorak's cache-EXCLUSIVE input is 50.
    const tokens = events.filter((e) => e.kind === "session.tokens") as Array<{
      models: Array<Record<string, unknown>>;
    }>;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.models).toEqual([
      {
        model: "gpt-5.5",
        inputTokens: 50, // 100 - 50, NOT 100
        cacheReadTokens: 50,
        outputTokens: 15, // reasoning is billed AS output, so it is NOT subtracted
        cacheWriteTokens: 0,
      },
    ]);
    // Nothing else: outputs / prose / ghost_snapshot all dropped.
    expect(events).toHaveLength(1 + 1 + 4 + 1);
    // And this slice can never end a session (the reaper owns that).
    expect(kinds).not.toContain("session.end");
  });

  it("UNKNOWN row types and sub-types drop to silence (format drift is never a leak)", () => {
    const drifted = [
      metaLine(),
      line("brand_new_top_level_type", { anything: "MARKER_DRIFT" }),
      line("event_msg", { type: "brand_new_event", payload_text: "MARKER_DRIFT" }),
      line("response_item", { type: "brand_new_item", content: "MARKER_DRIFT" }),
    ];
    const { events } = parseAll(drifted);
    expect(events).toHaveLength(1); // just the session.start
    expect(JSON.stringify(events)).not.toContain("MARKER_DRIFT");
  });

  it("malformed lines and rows without a timestamp yield nothing (fault-soft)", () => {
    const state = initialCodexFileState();
    expect(parseRolloutLine("{not json", 0, FILE, state)).toEqual([]);
    expect(parseRolloutLine('"a bare string"', 0, FILE, state)).toEqual([]);
    expect(
      parseRolloutLine(JSON.stringify({ type: "session_meta", payload: { id: SESSION, cwd: CWD } }), 0, FILE, state),
    ).toEqual([]); // no timestamp → no honest event time → no event
  });
});

// ── 2. session identity + determinism ────────────────────────────────────────

describe("session identity (ADR-T2): one file, one session, one start", () => {
  it("first meta emits session.start with the registry capabilities + the tool's own version", () => {
    const { events, state } = parseAll([metaLine()]);
    expect(events).toHaveLength(1);
    const start = events[0] as Record<string, unknown>;
    expect(start.kind).toBe("session.start");
    expect(start.agent).toBe("codex");
    expect(start.agentVersion).toBe("0.142.5");
    expect(start.sessionId).toBe(SESSION);
    // Tokens/cache/cost are TRUE now that session.tokens carries them (CODEX-CAPTURE
    // ADR-C9); verification and endReason stay false, the latter permanently.
    expect(start.capabilities).toEqual({ hasTokens: true, hasCacheTokens: true, cost: "estimated", toolResult: "both", endReason: false, duration: "inferred", verification: "none", costScope: "session", usageWindow: "ratio" });
    // repoLabel is the basename of the LOCAL-only cwd; the path itself never rides.
    expect(start.repoLabel).toBe("seorak-codex-test-not-a-repo");
    // The TAILER flips startEmitted only after a DURABLE append — the adapter
    // must leave it down so a failed append gets a retry (same anchor, same id).
    expect(state.startEmitted).toBe(false);
    expect(state.startOffset).toBe(0);
  });

  it("a version string that stopped looking like a version reads 'unknown' (no free-text channel)", () => {
    const { events } = parseAll([
      metaLine({ cli_version: "0.143.0 (/Users/someone/.local/bin/codex)" }),
    ]);
    expect((events[0] as Record<string, unknown>).agentVersion).toBe("unknown");
  });

  it("a row whose timestamp does not parse emits nothing (no dishonest event time)", () => {
    const state = initialCodexFileState();
    const bad = JSON.stringify({
      timestamp: "MARKER_NOT_A_TIME",
      type: "session_meta",
      payload: { id: SESSION, cwd: CWD, cli_version: "0.142.5" },
    });
    expect(parseRolloutLine(bad, 0, FILE, state)).toEqual([]);
  });

  it("branchWorkType comes from the meta's RECORDED branch when momentum is on, and is a closed enum", () => {
    process.env.SEORAK_MOMENTUM = "1";
    try {
      const { events } = parseAll([metaLine()]);
      expect((events[0] as Record<string, unknown>).branchWorkType).toBe("feature");
      expect(() => assertEmitSafe(events[0]!)).not.toThrow();
    } finally {
      process.env.SEORAK_MOMENTUM = "0";
    }
  });

  it("duplicate metas re-emit the start ONLY while it is still owed, always under ONE id", () => {
    // Until the tailer marks the start durably appended, every duplicate meta
    // retries it — anchored on the FIRST meta's offset, so the retries all
    // carry the SAME event id and the worker PK collapses them (idempotent).
    const { events } = parseAll([metaLine(), metaLine(), metaLine()]);
    const starts = events.filter((e) => e.kind === "session.start");
    expect(starts).toHaveLength(3);
    expect(new Set(starts.map((e) => e.eventId)).size).toBe(1);

    // Once the tailer has flipped startEmitted (durable append), duplicates
    // are silence — the observed 18-meta file emits one start, once.
    const settled: CodexFileState = {
      ...initialCodexFileState(),
      sessionId: SESSION,
      startOffset: 0,
      startEmitted: true,
    };
    expect(parseRolloutLine(metaLine(), 5000, FILE, settled)).toEqual([]);
  });

  it("the owed-start retry (append failed after identity was recorded) re-derives the ORIGINAL id", () => {
    // The crash window: tick 1 parsed the meta at offset 0, the append failed,
    // the state persisted {sessionId, startOffset: 0, startEmitted: false}.
    // Tick 2 re-reads the same meta (cursor never advanced): the start must
    // come back anchored at the PERSISTED offset, not the row's re-read one.
    const recovered: CodexFileState = {
      ...initialCodexFileState(),
      sessionId: SESSION,
      startOffset: 0,
      startEmitted: false,
    };
    const retried = parseRolloutLine(metaLine(), 0, FILE, recovered);
    expect(retried).toHaveLength(1);
    expect(retried[0]!.eventId).toBe(codexRolloutEventId(SESSION, FILE, 0));
  });

  it("a mid-file restart with reconstructed state reproduces IDENTICAL event ids", () => {
    // Each call carries its RESULT row too (ADR-C13: the tool.call is emitted there), so
    // this exercises the ids that actually ship rather than a file Codex never writes.
    const lines = [
      metaLine(),
      line("response_item", { type: "function_call", name: "exec_command", call_id: "a", arguments: "{}" }),
      line("response_item", { type: "function_call_output", call_id: "a", output: execResult(0) }),
      line("response_item", { type: "function_call", name: "exec_command", call_id: "b", arguments: "{}" }),
      line("response_item", { type: "function_call_output", call_id: "b", output: execResult(1) }),
    ];
    const first = parseAll(lines);
    const firstIds = first.events.map((e) => e.eventId);

    // The tailer persists the WHOLE adapter state beside the cursor, `pendingCalls`
    // included; a restart resumes AFTER the meta with exactly this state.
    const resumed: CodexFileState = {
      ...initialCodexFileState(),
      sessionId: SESSION,
      startOffset: 0,
      startEmitted: true,
    };
    let offset = Buffer.byteLength(lines[0]!, "utf8") + 1;
    const replay = [];
    for (const l of lines.slice(1)) {
      replay.push(...parseRolloutLine(l, offset, FILE, resumed));
      offset += Buffer.byteLength(l, "utf8") + 1;
    }
    expect(replay.map((e) => e.eventId)).toEqual(firstIds.slice(1));

    // Modeling the worker's INSERT OR IGNORE as a Set: the replay adds nothing.
    const table = new Set(firstIds);
    for (const e of replay) table.add(e.eventId);
    expect(table.size).toBe(firstIds.length);
  });

  it("rows arriving before any meta are unattributable and drop", () => {
    const { events } = parseAll([
      line("response_item", { type: "function_call", name: "exec_command", call_id: "a", arguments: "{}" }),
      line("event_msg", { type: "user_message", message: "hi" }),
    ]);
    expect(events).toEqual([]);
  });

  it("a meta missing id or cwd marks the whole file skipped (no half-attributed capture)", () => {
    const noId = parseAll([line("session_meta", { cwd: CWD, cli_version: "0.142.5" }), line("event_msg", { type: "user_message", message: "x" })]);
    expect(noId.events).toEqual([]);
    expect(noId.state.skip).toBe(true);
  });
});

describe("subagent threads skip (ADR-T7): undercount, never inflate or double-count", () => {
  it("thread_source subagent → nothing, ever, from that file", () => {
    const { events, state } = parseAll([
      metaLine({ thread_source: "subagent", parent_thread_id: "019f-parent" }),
      line("response_item", { type: "function_call", name: "exec_command", call_id: "a", arguments: "{}" }),
      line("event_msg", { type: "user_message", message: "x" }),
    ]);
    expect(events).toEqual([]);
    expect(state.skip).toBe(true);
  });

  it("a source OBJECT naming a subagent spawn also skips (the 0.142.x shape)", () => {
    const { events, state } = parseAll([
      metaLine({ source: { subagent: { thread_spawn: { agent_nickname: "Kepler" } } } }),
    ]);
    expect(events).toEqual([]);
    expect(state.skip).toBe(true);
  });

  it("any FUTURE non-user thread_source (fork/replay/…) skips too — fail closed", () => {
    // A fork copies parent history; tailing it would re-emit that history under
    // a NEW session id — a cross-session double count the event-id PK cannot
    // collapse. Undercount over fabrication.
    const { events, state } = parseAll([metaLine({ thread_source: "fork" })]);
    expect(events).toEqual([]);
    expect(state.skip).toBe(true);
    // …while the observed benign shapes still emit: "user" and absent.
    expect(parseAll([metaLine({ thread_source: "user" })]).events).toHaveLength(1);
    expect(parseAll([metaLine()]).events).toHaveLength(1);
  });
});

// ── 3. honest-empty tool calls + edit lines ──────────────────────────────────

/**
 * A real exec result. The exit code sits in the HEADER, before the `Output:` marker;
 * everything after that marker is the command's own stdout, which the adapter never reads.
 */
const execResult = (exitCode: number, body = "ok"): string =>
  `Chunk ID: abc123\nWall time: 0.1 seconds\nProcess exited with code ${exitCode}\nOriginal token count: 3\nOutput:\n${body}`;

describe("tool.call honesty (ADR-T5/T6)", () => {
  /**
   * A call AND its result. Codex always writes both (0 of 9,315 calls in the corpus ever
   * failed to get a result row), and since ADR-C13 the tool.call is emitted at the RESULT,
   * so a fixture that stops at the call row would be testing a file Codex never writes.
   */
  const toolLines = (payload: Record<string, unknown>, output: unknown = execResult(0)) => [
    metaLine(),
    line("response_item", payload),
    line("response_item", {
      type: payload.type === "custom_tool_call" ? "custom_tool_call_output" : "function_call_output",
      call_id: payload.call_id,
      output,
    }),
  ];

  it("exec_command and legacy shell both map to the DISTINCT Shell token (never Bash)", () => {
    for (const name of ["exec_command", "shell"]) {
      const { events } = parseAll(toolLines({ type: "function_call", name, call_id: "x", arguments: "{}" }));
      const call = events[1] as Record<string, unknown>;
      expect(call.toolName).toBe("Shell");
    }
  });

  it("the open dynamic-tool vocabulary folds to 'other' (the mcp__ lesson)", () => {
    for (const name of ["tap", "js", "spawn_agent", "build_run_sim", "update_plan", "write_stdin", "view_image"]) {
      const { events } = parseAll(toolLines({ type: "function_call", name, call_id: "x", arguments: "{}" }));
      expect((events[1] as Record<string, unknown>).toolName).toBe("other");
    }
  });

  it("a Codex tool.call carries NO per-call tokens (they are session-scoped)", () => {
    const { events } = parseAll(toolLines({ type: "function_call", name: "exec_command", call_id: "x", arguments: "{}" }));
    const call = events[1] as Record<string, unknown>;
    // Tokens are SESSION-scoped for Codex and must stay off the call: a `token_count` row
    // carries no call id (0 of 344 on 0.144.1), so a per-call number here would be an
    // attribution the rollout does not contain. The zeros are the schema's, not a claim;
    // the real tokens ride session.tokens.
    expect(call.inputTokens).toBe(0);
    expect(call.outputTokens).toBe(0);
    expect("models" in call).toBe(false);
    expect("verificationKind" in call).toBe(false);
    expect(() => assertEmitSafe(events[1]!)).not.toThrow();
  });

  it("timestamps ride the CALL row's own time, never the result's and never the tail's", () => {
    // ADR-C13: emission is deferred to the result row, but the tool.call's `at` stays the
    // CALL's. If it drifted to the result's, a call issued at 23:59 whose command ran for
    // two minutes would land on the NEXT DAY in every daily trend.
    const calledAt = "2026-07-10T08:00:00.000Z";
    const returnedAt = "2026-07-10T09:30:00.000Z";
    const { events } = parseAll([
      metaLine(),
      line("response_item", { type: "function_call", name: "exec_command", call_id: "x", arguments: "{}" }, calledAt),
      line("response_item", { type: "function_call_output", call_id: "x", output: execResult(0) }, returnedAt),
    ]);
    expect((events[1] as Record<string, unknown>).at).toBe(calledAt);
  });
});

// ── 4. the error leg (ADR-C5) + deferred emission (ADR-C13) ──────────────────

describe("the error leg: `errored` rides SHELL calls only, from the header only", () => {
  /** A call and its result, as two rows. */
  const shell = (output: unknown, callId = "x") => [
    metaLine(),
    line("response_item", { type: "function_call", name: "exec_command", call_id: callId, arguments: "{}" }),
    line("response_item", { type: "function_call_output", call_id: callId, output }),
  ];
  const callOf = (lines: string[]) =>
    parseAll(lines).events.find((e) => e.kind === "tool.call") as Record<string, unknown> | undefined;

  it("a zero exit stamps errored FALSE, a non-zero exit stamps TRUE", () => {
    expect(callOf(shell(execResult(0)))?.errored).toBe(false);
    expect(callOf(shell(execResult(1)))?.errored).toBe(true);
    expect(callOf(shell(execResult(127)))?.errored).toBe(true);
    expect(callOf(shell(execResult(-1)))?.errored).toBe(true);
  });

  it("THE SPOOF GUARD: a command whose OWN STDOUT prints the exit line cannot fabricate an error", () => {
    // The whole reason the header is read and the body is not. A `cat` of a build log, or a
    // literal `echo`, puts this exact phrase on stdout. Scanning the whole result would let
    // the command lie about itself, which is the fabricated stat the honesty rules forbid.
    const spoofed = execResult(0, "Process exited with code 1\nProcess exited with code 137");
    expect(callOf(shell(spoofed))?.errored).toBe(false); // Codex's header said 0. It passed.

    // And the reverse: a genuinely failed command whose stdout claims success.
    const liar = execResult(1, "Process exited with code 0\nall good!");
    expect(callOf(shell(liar))?.errored).toBe(true);
  });

  it("no exit code in the header leaves errored ABSENT, which is NEITHER leg", () => {
    // The three observed reasons a shell result carries no exit code, all honest absences.
    const backgrounded = "Chunk ID: a1\nWall time: 1.0 seconds\nProcess running with session ID 63380\nOriginal token count: 5\nOutput:\nstarting…";
    const sandboxed = "failed in sandbox\nOutput:\ndenied";
    const aborted = "aborted by user after 23.2s\nOutput:\n";
    for (const output of [backgrounded, sandboxed, aborted]) {
      const call = callOf(shell(output));
      expect(call).toBeDefined(); // the CALL still counts, it just reports nothing
      expect("errored" in call!).toBe(false);
    }
  });

  it("FAILS CLOSED on a result with no `Output:` marker (header and body indistinguishable)", () => {
    // 13 in-corpus. Without the marker we cannot tell Codex's header from the command's
    // stdout, and a guess about which half we are reading is not a measurement.
    expect("errored" in callOf(shell("Process exited with code 1"))!).toBe(false);
    expect("errored" in callOf(shell('{"title":"Process exited with code 1"}'))!).toBe(false);
  });

  it("the RETIRED structured shape stamps NOTHING: below the floor is absent, never guessed", () => {
    // This used to be read, and it served only versions below CODEX_MIN_SUPPORTED_CLI_VERSION:
    // measured 2026-07-27, all 1,878 rows carrying `metadata.exit_code` are on 0.46.0 (764) or
    // 0.58.0 (1,114), and zero are on 0.116.0 or any of the 20 versions after it. The reader
    // is gone, so the JSON envelope is now just an unreadable result: the call still counts,
    // and `errored` is ABSENT rather than false. Absent is what keeps it out of BOTH legs of
    // the error rate; a `false` here would pin a fabricated pass.
    const jsonEnvelope = JSON.stringify({ output: "whatever the command printed", metadata: { exit_code: 2 } });
    expect(shellExitCode(jsonEnvelope)).toBeNull();
    const envelopeCall = callOf(shell(jsonEnvelope));
    expect(envelopeCall).toBeDefined();
    expect("errored" in envelopeCall!).toBe(false);

    // A zero exit code in the envelope is equally unread — the deletion is not "treat the
    // legacy failures as passes", it is "read neither".
    const okEnvelope = JSON.stringify({ output: "done", metadata: { exit_code: 0 } });
    expect(shellExitCode(okEnvelope)).toBeNull();
    expect("errored" in callOf(shell(okEnvelope))!).toBe(false);

    // And a PLAIN OBJECT output (the same shape unserialized) is a non-string result, which
    // this reader refuses by type: only the modern text shape is parsed.
    expect(shellExitCode({ metadata: { exit_code: 2 } })).toBeNull();
    const objectCall = callOf(shell({ metadata: { exit_code: 2 } }));
    expect(objectCall).toBeDefined();
    expect("errored" in objectCall!).toBe(false);
  });

  it("NON-shell tools never carry errored, even when their result HAS an exit code", () => {
    // `write_stdin` emits the identical exec header, but its exit code reports the fate of
    // the BACKGROUND PROCESS it wrote to, not whether the write succeeded (25 of its 27
    // corpus results read "Process running with session ID"). Stamping it would call a
    // successful write errored the moment a backgrounded process exits non-zero.
    const stdin = [
      metaLine(),
      line("response_item", { type: "function_call", name: "write_stdin", call_id: "w", arguments: "{}" }),
      line("response_item", { type: "function_call_output", call_id: "w", output: execResult(1) }),
    ];
    const call = callOf(stdin);
    expect(call?.toolName).toBe("other");
    expect("errored" in call!).toBe(false);
  });

  it("APPLY_PATCH's exit code reaches NO tool.call (its call row is dropped by design)", () => {
    // All 54 `Exit code:` rows in the corpus are apply_patch's. The adapter drops the
    // apply_patch CALL row because patch_apply_end is the applied truth, so there is no held
    // call for this result to land on. Routing it anywhere would be a fabricated 0% error
    // rate: a FAILED apply_patch emits no `Exit code:` line at all, only prose.
    const { events } = parseAll([
      metaLine(),
      line("response_item", { type: "custom_tool_call", name: "apply_patch", call_id: "p", input: "*** Begin Patch" }),
      line("response_item", { type: "custom_tool_call_output", call_id: "p", output: "Exit code: 0\nSuccess." }),
    ]);
    expect(events.filter((e) => e.kind === "tool.call")).toHaveLength(0);
  });

  it("ApplyPatch itself carries NO errored: patch_apply_end is SUCCESS-ONLY (866 of 866)", () => {
    // The trap I nearly shipped. `success` looks like a clean boolean error leg, but a FAILED
    // patch emits no patch_apply_end at all, so `errored: !success` would pin a fabricated
    // 0% error rate over every patch Codex has ever applied.
    const { events } = parseAll([
      metaLine(),
      line("event_msg", { type: "patch_apply_end", call_id: "c", turn_id: "t", success: true, status: "completed", stdout: "", stderr: "", changes: {} }),
    ]);
    const call = events.find((e) => e.kind === "tool.call") as Record<string, unknown>;
    expect(call.toolName).toBe("ApplyPatch");
    expect("errored" in call).toBe(false);
  });
});

describe("deferred emission (ADR-C13): the call is emitted at its RESULT row", () => {
  it("a call with no result yet emits NOTHING, and emits once its result lands", () => {
    const state = initialCodexFileState();
    const lines = [
      metaLine(),
      line("response_item", { type: "function_call", name: "exec_command", call_id: "x", arguments: "{}" }),
    ];
    const first = parseAll(lines, state);
    // The tick ended mid-call. Nothing to emit yet, and the call is HELD, not lost.
    expect(first.events.filter((e) => e.kind === "tool.call")).toHaveLength(0);
    expect(Object.keys(state.pendingCalls)).toEqual(["x"]);

    // Next tick: the result lands, and the call finally emits.
    const resultOffset = lines.reduce((n, l) => n + Buffer.byteLength(l, "utf8") + 1, 0);
    const second = parseRolloutLine(
      line("response_item", { type: "function_call_output", call_id: "x", output: execResult(1) }),
      resultOffset,
      FILE,
      state,
    );
    expect(second).toHaveLength(1);
    expect((second[0] as Record<string, unknown>).errored).toBe(true);
    expect(state.pendingCalls).toEqual({}); // released
  });

  it("THE EVENT ID IS THE CALL'S OFFSET, not the result's (ids stay byte-identical to Phase 2)", () => {
    // The load-bearing invariant. Anchoring on the result row would mint a SECOND id for a
    // call that may already be in D1 under its call-offset id, and the PK could not collapse
    // it. Every id this adapter mints must be the one the pre-Phase-3 adapter would have.
    const meta = metaLine();
    const callRow = line("response_item", { type: "function_call", name: "exec_command", call_id: "x", arguments: "{}" });
    const callOffset = Buffer.byteLength(meta, "utf8") + 1;
    const { events } = parseAll([
      meta,
      callRow,
      line("response_item", { type: "function_call_output", call_id: "x", output: execResult(0) }),
    ]);
    const call = events.find((e) => e.kind === "tool.call")!;
    expect(call.eventId).toBe(codexRolloutEventId(SESSION, FILE, callOffset));
  });

  it("CONCURRENT calls resolve to their OWN results (Codex runs up to 8 in flight)", () => {
    // 37% of corpus calls are issued while another is still pending, so a "hold one, flush it
    // when the next arrives" design would emit still-running calls and mismatch their results.
    // Interleaved here, and resolved OUT OF ORDER, which the real files also do.
    const { events } = parseAll([
      metaLine(),
      line("response_item", { type: "function_call", name: "exec_command", call_id: "a", arguments: "{}" }),
      line("response_item", { type: "function_call", name: "exec_command", call_id: "b", arguments: "{}" }),
      line("response_item", { type: "function_call", name: "tap", call_id: "c", arguments: "{}" }),
      line("response_item", { type: "function_call_output", call_id: "b", output: execResult(1) }),
      line("response_item", { type: "function_call_output", call_id: "c", output: "Wall time: 1s\nOutput:\n{}" }),
      line("response_item", { type: "function_call_output", call_id: "a", output: execResult(0) }),
    ]);
    const calls = events.filter((e) => e.kind === "tool.call") as Array<Record<string, unknown>>;
    expect(calls).toHaveLength(3);
    // b failed, a passed, c is not a shell tool. Each got ITS OWN result, not its neighbour's.
    const byId = new Map(calls.map((c) => [c.eventId, c]));
    expect(byId.size).toBe(3);
    expect(calls.filter((c) => c.errored === true)).toHaveLength(1);
    expect(calls.filter((c) => c.errored === false)).toHaveLength(1);
    expect(calls.filter((c) => !("errored" in c))).toHaveLength(1);
  });

  it("an ORPHAN result (no held call) emits nothing: its tool.call is already in D1", () => {
    // The upgrade path. A call consumed by the PRE-Phase-3 adapter already emitted its
    // tool.call (unstamped) and the cursor moved past it. Its result arrives here to find no
    // pending entry. Emitting would DUPLICATE a row that already exists.
    const { events } = parseAll([
      metaLine(),
      line("response_item", { type: "function_call_output", call_id: "gone", output: execResult(1) }),
    ]);
    expect(events.filter((e) => e.kind === "tool.call")).toHaveLength(0);
  });

  it("the pending CAP evicts the oldest call UNSTAMPED, so a call is degraded, never lost", () => {
    // The safety valve for a call whose result never arrives (a SIGKILL between the two rows:
    // 0 of 9,315 in the corpus, but "should never" is not "cannot"). The oldest held call is
    // emitted exactly as the pre-Phase-3 adapter would have emitted it.
    const state = initialCodexFileState();
    parseRolloutLine(metaLine(), 0, FILE, state);
    const emitted: unknown[] = [];
    for (let i = 0; i < MAX_PENDING_CALLS + 1; i++) {
      emitted.push(
        ...parseRolloutLine(
          line("response_item", { type: "function_call", name: "exec_command", call_id: `c${i}`, arguments: "{}" }),
          100 + i,
          FILE,
          state,
        ),
      );
    }
    // The 65th call evicted the 1st, which emitted UNSTAMPED (no result was ever seen).
    expect(emitted).toHaveLength(1);
    const evicted = emitted[0] as Record<string, unknown>;
    expect(evicted.kind).toBe("tool.call");
    expect("errored" in evicted).toBe(false);
    expect(evicted.eventId).toBe(codexRolloutEventId(SESSION, FILE, 100)); // the OLDEST offset
    expect(Object.keys(state.pendingCalls)).toHaveLength(MAX_PENDING_CALLS);
    expect(state.pendingCalls.c0).toBeUndefined(); // gone
  });

  it("a re-parsed call row (crash before the cursor advanced) does NOT double-emit", () => {
    // The tailer re-reads a batch whose cursor never persisted. The same call row arrives
    // twice with the same coordinates. Overwriting the pending entry is idempotent; FLUSHING
    // the "duplicate" would emit a tool.call whose id the result row is about to emit again,
    // which D1's PK collapses but KV's reducer does NOT (it double-counts toolCallCount).
    const state = initialCodexFileState();
    parseRolloutLine(metaLine(), 0, FILE, state);
    const callRow = line("response_item", { type: "function_call", name: "exec_command", call_id: "x", arguments: "{}" });
    expect(parseRolloutLine(callRow, 100, FILE, state)).toHaveLength(0);
    expect(parseRolloutLine(callRow, 100, FILE, state)).toHaveLength(0); // re-parse: still silent
    const out = parseRolloutLine(
      line("response_item", { type: "function_call_output", call_id: "x", output: execResult(0) }),
      200,
      FILE,
      state,
    );
    expect(out).toHaveLength(1); // exactly ONE tool.call for one call
  });

  it("a call row with NO call_id emits NOTHING, and neither does its later result", () => {
    // This used to emit immediately and unstamped, justified as degrading to an older
    // rollout vocabulary. There is no such vocabulary: measured 2026-07-27, 0 of 43,522
    // call rows and 0 of 43,522 result rows across all 22 observed versions omit `call_id`,
    // 0.46.0 included. A call that cannot be correlated to its result has no honest moment
    // to be emitted, so it is dropped — format drift lands as silence, an undercount rather
    // than a fabrication.
    const state = initialCodexFileState();
    parseRolloutLine(metaLine(), 0, FILE, state);

    const orphanCall = parseRolloutLine(
      line("response_item", { type: "function_call", name: "exec_command", arguments: "{}" }),
      100,
      FILE,
      state,
    );
    expect(orphanCall).toEqual([]);
    expect(state.pendingCalls).toEqual({}); // not held either: nothing to key it by

    // Its result row lands on no pending call, so it too emits nothing. The pair is silent
    // end to end, not half-captured.
    const orphanResult = parseRolloutLine(
      line("response_item", { type: "function_call_output", output: execResult(1) }),
      200,
      FILE,
      state,
    );
    expect(orphanResult).toEqual([]);

    // Same for the custom-tool leg, which shares holdCall.
    expect(
      parseRolloutLine(line("response_item", { type: "custom_tool_call", name: "exec", input: "x" }), 300, FILE, state),
    ).toEqual([]);
    expect(state.pendingCalls).toEqual({});
  });
});

// ── 5. the supported CLI floor ───────────────────────────────────────────────

const silenceWarn = () => vi.spyOn(console, "warn").mockImplementation(() => {});

describe("the supported CLI floor: a degraded capture announces itself, and changes nothing", () => {
  let warn: ReturnType<typeof silenceWarn>;

  beforeEach(() => {
    warn = silenceWarn();
  });

  afterEach(() => {
    // Restore rather than clear: a leaked spy would swallow every other suite's warnings.
    warn.mockRestore();
  });

  it("pins the floor itself, so moving it is a deliberate act", () => {
    // 0.116.0 is the OLDEST version in the 2026-07-27 corpus (410 files, 259,332 rows, 22
    // versions) observed to emit none of the retired shapes. Raising this constant retires
    // more readers; lowering it claims evidence that does not exist. Either is a decision,
    // not a refactor, and this assertion is what makes it one.
    expect(CODEX_MIN_SUPPORTED_CLI_VERSION).toBe("0.116.0");
  });

  it("warns EXACTLY ONCE for a below-floor session, and not again on a duplicate meta", () => {
    const state = initialCodexFileState();
    const first = parseRolloutLine(metaLine({ cli_version: "0.46.0" }), 0, FILE, state);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("0.46.0");
    expect(String(warn.mock.calls[0]![0])).toContain(CODEX_MIN_SUPPORTED_CLI_VERSION);

    // A duplicate meta is the window/resume re-emission of the SAME session. It may still
    // retry an owed start, but it must not re-announce the version: one warning per session.
    const duplicate = parseRolloutLine(metaLine({ cli_version: "0.46.0" }), 5000, FILE, state);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(duplicate).toHaveLength(1); // the owed-start retry, unchanged by the warning

    // The warning is a log line and nothing more: the start it accompanies is byte-identical
    // to the one an unwarned session mints at the same coordinates.
    expect(first).toHaveLength(1);
    expect(first[0]!.eventId).toBe(codexRolloutEventId(SESSION, FILE, 0));
    expect(duplicate[0]!.eventId).toBe(first[0]!.eventId);
  });

  it("does not warn at or above the floor", () => {
    for (const version of ["0.116.0", "0.128.0", "0.142.5", "0.146.0-alpha.3.1"]) {
      parseRolloutLine(metaLine({ cli_version: version }), 0, FILE, initialCodexFileState());
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("a prerelease compares as its RELEASE: 0.145.0-alpha.18 is above the floor, not below", () => {
    // 2 of the 22 observed version strings carry a suffix. Comparing the leading dot-triple
    // and ignoring the suffix is what keeps them out of the warning.
    parseRolloutLine(metaLine({ cli_version: "0.145.0-alpha.18" }), 0, FILE, initialCodexFileState());
    expect(warn).not.toHaveBeenCalled();
  });

  it("an ABSENT or MALFORMED cli_version never warns: absence is not evidence of an old version", () => {
    // A version we cannot read is unknown, not old. Warning on it would fire on every future
    // version-string format the shape pin has not learned, and the warning would stop meaning
    // "this capture is degraded".
    const metaNoVersion = line("session_meta", { id: SESSION, timestamp: AT, cwd: CWD });
    expect(parseRolloutLine(metaNoVersion, 0, FILE, initialCodexFileState())).toHaveLength(1);

    for (const version of [
      "unknown",
      "0.46", // no dot-triple to compare
      "v0.46.0", // does not START with the triple
      "0.143.0 (/Users/someone/.local/bin/codex)", // shape-rejected (a free-text channel)
      42, // not even a string
    ]) {
      parseRolloutLine(metaLine({ cli_version: version }), 0, FILE, initialCodexFileState());
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("a below-floor file still captures everything that is not version-specific", () => {
    // The floor is a READING contract, not a skip. The session, its prompt, and its tool
    // calls all still ship; what is missing is the `errored` stamp, which is absent rather
    // than false, so the call sits in neither leg of the error rate.
    const { events, state } = parseAll([
      metaLine({ cli_version: "0.58.0" }),
      line("event_msg", { type: "user_message", message: "x" }),
      line("response_item", { type: "function_call", name: "exec_command", call_id: "x", arguments: "{}" }),
      line("response_item", {
        type: "function_call_output",
        call_id: "x",
        output: JSON.stringify({ output: "…", metadata: { exit_code: 1 } }),
      }),
    ]);
    expect(state.skip).toBe(false);
    expect(events.map((e) => e.kind)).toEqual(["session.start", "session.prompt", "tool.call"]);
    const call = events[2] as Record<string, unknown>;
    expect(call.toolName).toBe("Shell");
    expect("errored" in call).toBe(false);
    for (const event of events) expect(() => assertEmitSafe(event)).not.toThrow();
  });
});

describe("ApplyPatch edit lines (the head-to-head axis) ride patch_apply_end", () => {
  const apply = (changes: Record<string, unknown>, success: unknown = true) => [
    metaLine(),
    line("event_msg", { type: "patch_apply_end", call_id: "c", turn_id: "t", success, status: "completed", stdout: "", stderr: "", changes }),
  ];

  it("unified_diff → honest +/- counts (headers excluded); the diff is discarded", () => {
    const { events } = parseAll(
      apply({ "/x/a.ts": { type: "update", unified_diff: "--- a\n+++ b\n@@ -1,2 +1,2 @@\n context\n+new line\n+another\n-old line", move_path: null } }),
    );
    const call = events[1] as Record<string, unknown>;
    expect(call.toolName).toBe("ApplyPatch");
    expect(call.linesAdded).toBe(2);
    expect(call.linesRemoved).toBe(1);
  });

  it("an add-file change counts its content's lines; multi-file changes SUM and carry NO single-file identity", () => {
    const { events } = parseAll(
      apply({
        "/x/new.ts": { type: "add", content: "l1\nl2\nl3" },
        "/x/old.ts": { type: "update", unified_diff: "+added\n-gone", move_path: null },
      }),
    );
    const call = events[1] as Record<string, unknown>;
    expect(call.linesAdded).toBe(4);
    expect(call.linesRemoved).toBe(1);
    expect("fileId" in call).toBe(false); // no fabricated pick among N files
  });

  it("a DELETE change counts its content as REMOVED lines — never sign-inverted into added", () => {
    // The third observed change shape (corpus 2026-07-10: delete ×13 carrying
    // the deleted file's content). Counting it as added would fabricate
    // positive lines on the one sanctioned head-to-head stat.
    const { events } = parseAll(apply({ "/x/gone.ts": { type: "delete", content: "a\nb\nc\nd\ne" } }));
    const call = events[1] as Record<string, unknown>;
    expect(call.linesAdded).toBe(0);
    expect(call.linesRemoved).toBe(5);
  });

  it("an UNRECOGNIZED change type contributes nothing (drift undercounts, never guesses)", () => {
    const { events } = parseAll(
      apply({ "/x/a.ts": { type: "transmute", content: "x\ny", unified_diff: "+x" } }),
    );
    const call = events[1] as Record<string, unknown>;
    expect("linesAdded" in call).toBe(false);
  });

  it("a single-file patch carries the salted identity + closed enums, no label by default", () => {
    const { events } = parseAll(apply({ "/x/src/thing.ts": { type: "update", unified_diff: "+a", move_path: null } }));
    const call = events[1] as Record<string, unknown>;
    expect(call.fileId).toMatch(/^[0-9a-f]{64}$/);
    expect(call.dirId).toMatch(/^[0-9a-f]{64}$/);
    expect(call.fileCategory).toBe("source");
    expect(call.fileLanguage).toBe("typescript");
    expect("fileLabel" in call).toBe(false); // fileLabels is a default-OFF opt-in
    expect(JSON.stringify(call)).not.toContain("/x/src");
    expect(() => assertEmitSafe(events[1]!)).not.toThrow();
  });

  it("success !== true → the call still counts but carries NO lines (the edit never applied)", () => {
    const { events } = parseAll(apply({ "/x/a.ts": { type: "update", unified_diff: "+a", move_path: null } }, false));
    const call = events[1] as Record<string, unknown>;
    expect(call.toolName).toBe("ApplyPatch");
    expect("linesAdded" in call).toBe(false);
    expect("fileId" in call).toBe(false);
  });

  it("the lineCounts capture toggle gates the derivation (the strings are never even diffed)", () => {
    writeFileSync(
      captureSettingsPath(),
      JSON.stringify({ lineCounts: false, fileSignals: false }),
      "utf8",
    );
    resetCaptureSettingsCache();
    try {
      const { events } = parseAll(apply({ "/x/a.ts": { type: "update", unified_diff: "+a\n+b", move_path: null } }));
      const call = events[1] as Record<string, unknown>;
      expect("linesAdded" in call).toBe(false);
      expect("fileId" in call).toBe(false);
    } finally {
      rmSync(captureSettingsPath(), { force: true });
      resetCaptureSettingsCache();
    }
  });
});

describe("session.prompt is envelope-only (the prompt text does not exist here)", () => {
  it("user_message → exactly the four envelope keys", () => {
    const { events } = parseAll([metaLine(), line("event_msg", { type: "user_message", message: "MARKER", kind: "plain" })]);
    const prompt = events[1] as Record<string, unknown>;
    expect(Object.keys(prompt).sort()).toEqual(["at", "eventId", "kind", "sessionId"]);
    expect(prompt.kind).toBe("session.prompt");
  });
});

describe("id primitive wiring", () => {
  it("event ids are codexRolloutEventId over (sessionId, basename, byteOffset)", () => {
    const lines = [metaLine(), line("event_msg", { type: "user_message", message: "x" })];
    const { events } = parseAll(lines);
    const promptOffset = Buffer.byteLength(lines[0]!, "utf8") + 1;
    expect(events[0]!.eventId).toBe(codexRolloutEventId(SESSION, FILE, 0));
    expect(events[1]!.eventId).toBe(codexRolloutEventId(SESSION, FILE, promptOffset));
  });
});

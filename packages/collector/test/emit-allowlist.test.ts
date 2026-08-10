/**
 * emit-allowlist.test.ts — the MANDATORY privacy tripwire regression suite.
 *
 * This is the load-bearing test for Phase 1: it proves that CONTENT carried on
 * the widened HookInput (prompts, commands, file paths, file text, stdout,
 * stderr, tool_error) can NEVER reach an emitted event. It runs the REAL event
 * builders on hostile inputs that stuff a unique SENTINEL_* string into every
 * content-adjacent field, then asserts the serialized event contains none of
 * them. If a future refactor pipes a content field into a builder, the
 * SENTINEL-LEAK test fails loudly — that is a privacy bug to fix in src, never a
 * test to silence.
 *
 * network-free + fs-sandboxed: every builder is fed a non-existent
 * transcript_path so consumeUsageSince short-circuits to zeros, and git.momentum
 * is run with SEORAK_MOMENTUM=0 so buildGitMomentum returns undefined without
 * touching git. The ONLY fs touch is the per-machine repo salt that
 * toSessionStart's repoId derivation lazily creates — SEORAK_DIR is pointed at a
 * fresh temp dir for the whole file so that salt lands in a sandbox, never the
 * real ~/.seorak. Type imports stay type-only so the @seorak/types barrel (which
 * re-exports @mobile-surfaces) is never pulled in at runtime.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseClaudeCodeHook } from "../src/adapters/claude-code.ts";
import { sanitizeToolName } from "../src/tool-name.ts";
import {
  EMIT_ALLOWLIST,
  EmitAllowlistError,
  MODEL_ITEM_ALLOWLIST,
  assertEmitSafe,
} from "../src/emit.ts";
import {
  classifyVerification,
  toGitMomentum,
  toRepoToolchain,
  toSessionDelta,
  toSessionEnd,
  toSessionNotification,
  toSessionPrompt,
  toSessionStart,
  toToolCall,
} from "../src/hooks.ts";

/**
 * The builders consume a tool-agnostic CanonicalInput now (the per-tool parsing
 * moved behind the adapter seam). `canon(...)` parses a raw Claude Code hook
 * payload through the claude-code adapter the exact way the bin scripts do, so
 * these tests still feed builders the SAME hostile raw payloads and assert the
 * SAME content-leak guarantees — behavior preserved across the refactor.
 */
const canon = (raw: Record<string, unknown> = {}) => {
  const input = parseClaudeCodeHook(hostileInput(raw));
  if (!input) throw new Error("expected a valid Claude Code hook fixture");
  return input;
};
const startCanon = (raw: Record<string, unknown> = {}) =>
  canon({ hook_event_name: "SessionStart", ...raw });
const endCanon = (raw: Record<string, unknown> = {}) =>
  canon({ hook_event_name: "SessionEnd", ...raw });

// Sandbox the per-machine repo salt that toSessionStart's repoId derivation
// creates so it never lands in the real ~/.seorak (keeps the suite fs-clean).
let saltDir: string;
let savedSeorakDir: string | undefined;
beforeAll(() => {
  savedSeorakDir = process.env.SEORAK_DIR;
  saltDir = mkdtempSync(join(tmpdir(), "seorak-emit-"));
  process.env.SEORAK_DIR = saltDir;
});
afterAll(() => {
  if (savedSeorakDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedSeorakDir;
  rmSync(saltDir, { recursive: true, force: true });
});

// Every distinct SENTINEL_* marker we plant in content-adjacent HookInput fields.
// If ANY of these surfaces in a serialized event, content has leaked.
const SENTINELS = [
  "SENTINEL_PROMPT",
  "SENTINEL_CMD",
  "SENTINEL_PATH",
  "SENTINEL_CODE",
  "SENTINEL_OUT",
  "SENTINEL_ERR",
  "SENTINEL_TOOL_ERROR",
  "SENTINEL_DESCRIPTION",
  "SENTINEL_CONTENT",
  "SENTINEL_OLD",
  "SENTINEL_NEW",
  "SENTINEL_CAP",
] as const;

/**
 * A maximally hostile HookInput: legitimate metadata (session_id, tool_name,
 * cwd, hook_event_name) plus a SENTINEL string in EVERY content-adjacent field
 * the widened HookInput exposes. transcript_path points at a path that does not
 * exist so consumeUsageSince returns zeros (no fs read of a transcript, no
 * network). Typed as the raw record the builders accept.
 */
function hostileInput(overrides: Record<string, unknown> = {}): any {
  return {
    hook_event_name: "PostToolUse",
    session_id: "sess-1234",
    tool_name: "Bash",
    cwd: "/tmp/seorak-test-cwd",
    transcript_path: "/tmp/seorak-nonexistent-transcript-DOES-NOT-EXIST.jsonl",
    reason: "clear",
    source: "startup",
    model: "claude-sonnet-4-6",
    prompt: "SENTINEL_PROMPT",
    tool_input: {
      command: "SENTINEL_CMD",
      file_path: "/x/SENTINEL_PATH",
      file_text: "SENTINEL_CODE",
      description: "SENTINEL_DESCRIPTION",
      content: "SENTINEL_CONTENT",
      old_string: "SENTINEL_OLD",
      new_string: "SENTINEL_NEW",
    },
    tool_response: {
      stdout: "SENTINEL_OUT",
      stderr: "SENTINEL_ERR",
    },
    tool_error: "SENTINEL_TOOL_ERROR",
    ...overrides,
  };
}

function assertNoSentinels(value: unknown, label: string): void {
  // An undefined event (e.g. toGitMomentum when momentum is disabled or cwd is
  // not a repo) trivially carries no content — nothing is emitted at all.
  // JSON.stringify(undefined) is undefined, so guard before scanning.
  const serialized = value === undefined ? "" : JSON.stringify(value);
  for (const sentinel of SENTINELS) {
    expect(
      serialized.includes(sentinel),
      `${label} leaked content sentinel ${sentinel}: ${serialized}`,
    ).toBe(false);
  }
}

describe("SENTINEL-LEAK: builders never copy content onto an emitted event", () => {
  // git.momentum is the one builder that reads git; disable it so the leak test
  // is fs/network-free and deterministic (returns undefined when disabled).
  let savedMomentum: string | undefined;
  beforeEach(() => {
    savedMomentum = process.env.SEORAK_MOMENTUM;
    process.env.SEORAK_MOMENTUM = "0";
  });
  afterEach(() => {
    if (savedMomentum === undefined) delete process.env.SEORAK_MOMENTUM;
    else process.env.SEORAK_MOMENTUM = savedMomentum;
  });

  it("toSessionStart emits no content sentinels", () => {
    const event = toSessionStart(startCanon());
    assertNoSentinels(event, "toSessionStart");
  });

  it("toToolCall (success) emits no content sentinels", () => {
    const event = toToolCall(canon({ hook_event_name: "PostToolUse" }));
    expect(event).toBeDefined();
    assertNoSentinels(event, "toToolCall(PostToolUse)");
  });

  it("toToolCall (failure) emits no content sentinels", () => {
    const event = toToolCall(canon({ hook_event_name: "PostToolUseFailure" }));
    expect(event).toBeDefined();
    assertNoSentinels(event, "toToolCall(PostToolUseFailure)");
  });

  it("toSessionEnd emits no content sentinels", () => {
    const event = toSessionEnd(endCanon());
    assertNoSentinels(event, "toSessionEnd");
  });

  it("toGitMomentum (disabled) emits no content sentinels", () => {
    const event = toGitMomentum(startCanon());
    // Disabled momentum is undefined; either way it must carry no sentinel.
    assertNoSentinels(event, "toGitMomentum(disabled)");
  });

  it("every built event also survives a serialized scan when momentum is enabled but cwd is not a repo", () => {
    // cwd is a non-existent / non-repo path; gitContext -> no-repo -> undefined.
    process.env.SEORAK_MOMENTUM = "1";
    const cwd = "/tmp/seorak-test-cwd-not-a-repo-xyz";
    const toolInput = canon({ cwd });
    const events = [
      toSessionStart(startCanon({ cwd })),
      toToolCall(toolInput),
      toSessionEnd(endCanon({ cwd })),
      toGitMomentum(startCanon({ cwd })),
      toSessionDelta(endCanon({ cwd })),
    ];
    for (const event of events) {
      assertNoSentinels(event, "built event (momentum enabled, no-repo)");
    }
  });
});

describe("session.delta allowlist (counts only — never a sha or path)", () => {
  // A representative session.delta event (the builder needs a real repo, so we
  // hand-build the shape the contract emits and assert the guard accepts it and
  // rejects content/sha keys).
  const delta = {
    kind: "session.delta",
    eventId: "evt-1",
    sessionId: "sess-1",
    at: "2026-06-04T00:00:00.000Z",
    repoId: "abc123",
    repoLabel: "seorak",
    gitContext: "clean",
    startGitContext: "clean",
    commitsLanded: 2,
    headMoved: true,
    filesTouchedUncommitted: 3,
    linesAddedUncommitted: 40,
    linesDeletedUncommitted: 10,
    generatedLinesExcludedUncommitted: 14632,
  } as any;

  it("passes a well-formed session.delta", () => {
    expect(() => assertEmitSafe(delta)).not.toThrow();
  });

  it("THROWS if a commit SHA is smuggled onto the event", () => {
    expect(() => assertEmitSafe({ ...delta, startSha: "deadbeef" } as any)).toThrow(
      EmitAllowlistError,
    );
    expect(() => assertEmitSafe({ ...delta, endSha: "cafef00d" } as any)).toThrow(
      EmitAllowlistError,
    );
  });

  it("the session.delta allowlist contains no sha/path/content key", () => {
    for (const k of ["startSha", "endSha", "sha", "workingDir", "path", "diff", "message"]) {
      expect(EMIT_ALLOWLIST["session.delta"].includes(k), `${k} must not be allowlisted`).toBe(false);
    }
  });
});

describe("session.notification allowlist (needs-you enum only — never the message)", () => {
  const notif = {
    kind: "session.notification",
    eventId: "evt-1",
    sessionId: "sess-1",
    at: "2026-06-04T00:00:00.000Z",
    notificationType: "permission_prompt",
  } as any;

  it("passes a well-formed session.notification", () => {
    expect(() => assertEmitSafe(notif)).not.toThrow();
  });

  it("THROWS if the notification message (CONTENT) is smuggled on", () => {
    expect(() =>
      assertEmitSafe({ ...notif, message: "Claude needs permission to run rm -rf /" } as any),
    ).toThrow(EmitAllowlistError);
  });

  it("the builder reads notificationType only — the message never rides through", () => {
    const input = parseClaudeCodeHook({
      hook_event_name: "Notification",
      session_id: "s1",
      notification_type: "permission_prompt",
      message: "SENTINEL-secret-message",
    });
    const event = toSessionNotification(input);
    expect(event).toBeDefined();
    expect(event?.notificationType).toBe("permission_prompt");
    expect(JSON.stringify(event)).not.toContain("SENTINEL");
    expect(() => assertEmitSafe(event!)).not.toThrow();
  });

  it("the allowlist contains no message/content key", () => {
    for (const k of ["message", "title", "body", "path", "command"]) {
      expect(
        EMIT_ALLOWLIST["session.notification"].includes(k),
        `${k} must not be allowlisted`,
      ).toBe(false);
    }
  });
});

describe("retired event contracts", () => {
  it("does not allow the retired reachability event kind to return", () => {
    const retiredKind = ["session", "survival"].join(".");
    expect(retiredKind in EMIT_ALLOWLIST).toBe(false);
    expect(() =>
      assertEmitSafe({
        kind: retiredKind,
        eventId: "retired-event",
        sessionId: "session-1",
        at: "2026-06-07T00:00:00.000Z",
      } as any),
    ).toThrow(EmitAllowlistError);
  });
});

describe("session.linesurvival allowlist (counts + closed enums only — the blame surface)", () => {
  // A clean, counts-only line-survival event (the shape sweepAttributedSurvival emits).
  const lineSurvival = {
    kind: "session.linesurvival",
    eventId: "evt-ls-1",
    sessionId: "sess-original",
    at: "2026-06-07T00:00:00.000Z",
    repoId: "abc123",
    gitContext: "clean",
    rung: "3d",
    fate: "retained",
    commitsChecked: 2,
    linesAuthored: 10,
    linesSurviving: 8,
  } as any;

  it("passes a well-formed counts + enum event", () => {
    expect(() => assertEmitSafe(lineSurvival)).not.toThrow();
    // repoLabel (a basename) is allowed only under the opt-in but never required.
    expect(() => assertEmitSafe({ ...lineSurvival, repoLabel: "seorak" })).not.toThrow();
  });

  it("THROWS on a smuggled sha / path / branch / content key (the blame walk's surface)", () => {
    for (const poison of [
      { shas: ["deadbeef"] },
      { sha: "cafef00d" },
      { toplevel: "/Users/x/repo" },
      { branch: "fix/secret-leak" },
      { blame: "const SECRET='sk-live'" },
      { author: "Glendon Chin" },
      { message: "patch the breach" },
    ]) {
      expect(() => assertEmitSafe({ ...lineSurvival, ...poison } as any), JSON.stringify(poison)).toThrow(
        EmitAllowlistError,
      );
    }
  });

  it("THROWS when a count value is non-integer/negative or breaks the invariant", () => {
    expect(() => assertEmitSafe({ ...lineSurvival, linesSurviving: 11 })).toThrow(EmitAllowlistError); // > authored
    expect(() => assertEmitSafe({ ...lineSurvival, linesAuthored: -1 })).toThrow(EmitAllowlistError);
    expect(() => assertEmitSafe({ ...lineSurvival, commitsChecked: 1.5 })).toThrow(EmitAllowlistError);
    expect(() => assertEmitSafe({ ...lineSurvival, linesSurviving: "8" })).toThrow(EmitAllowlistError);
  });

  it("THROWS on an out-of-enum fate / rung / gitContext", () => {
    expect(() => assertEmitSafe({ ...lineSurvival, fate: "reverted" })).toThrow(EmitAllowlistError);
    expect(() => assertEmitSafe({ ...lineSurvival, rung: "7d" })).toThrow(EmitAllowlistError);
    expect(() => assertEmitSafe({ ...lineSurvival, gitContext: "fix/secret-branch" })).toThrow(
      EmitAllowlistError,
    );
  });

  it("the session.linesurvival allowlist contains no sha/path/branch/content key", () => {
    for (const k of ["sha", "shas", "toplevel", "branch", "path", "diff", "blame", "author", "message"]) {
      expect(
        EMIT_ALLOWLIST["session.linesurvival"].includes(k),
        `${k} must not be allowlisted`,
      ).toBe(false);
    }
  });

  // ── commits[] (ADR-H4) ────────────────────────────────────────────────────
  //
  // The top-level key-check CANNOT see inside an array, so `commits[]` gets its own
  // deep-validate — and it needs one more than most: the natural thing to put in a commit
  // id is the SHA, and a sha is a globally-correlatable fingerprint that would defeat the
  // salted repoId in one stroke. The item id is pinned to a 64-hex salted hash, which a
  // 40-hex sha fails on length alone.

  const SALTED = "a".repeat(64);
  const withCommits = {
    ...lineSurvival,
    commits: [{ id: SALTED, added: 12, contested: 2, authored: 10 }],
    filesGoneFromTip: 0,
  };

  it("passes a well-formed commits[] item", () => {
    expect(() => assertEmitSafe(withCommits)).not.toThrow();
  });

  it("THROWS on a RAW SHA in commits[].id (the fingerprint that must never ship)", () => {
    const sha = "9c22df1e4b5a6c7d8e9f0a1b2c3d4e5f60718293"; // 40 hex, a real sha shape
    expect(() =>
      assertEmitSafe({ ...withCommits, commits: [{ ...withCommits.commits[0], id: sha }] }),
    ).toThrow(EmitAllowlistError);
  });

  it("THROWS on an unknown key INSIDE a commits[] item (the array the key-check cannot see)", () => {
    for (const poison of [{ sha: "cafef00d" }, { path: "src/secret.ts" }, { message: "leak" }]) {
      expect(() =>
        assertEmitSafe({
          ...withCommits,
          commits: [{ ...withCommits.commits[0], ...poison }],
        }),
        JSON.stringify(poison),
      ).toThrow(EmitAllowlistError);
    }
  });

  it("THROWS when a commit's authored + contested exceeds its added lines", () => {
    // The three counts are one commit's coverage split: what the session earned, what two
    // agents both touched, and the total. A split that oversubscribes its own denominator
    // is arithmetic that cannot be true.
    expect(() =>
      assertEmitSafe({ ...withCommits, commits: [{ id: SALTED, added: 5, contested: 3, authored: 4 }] }),
    ).toThrow(EmitAllowlistError);
  });

  it("THROWS on a non-integer / negative count inside a commits[] item", () => {
    for (const poison of [{ added: -1 }, { authored: 1.5 }, { contested: "2" }]) {
      expect(() =>
        assertEmitSafe({ ...withCommits, commits: [{ ...withCommits.commits[0], ...poison }] }),
        JSON.stringify(poison),
      ).toThrow(EmitAllowlistError);
    }
  });

  it("THROWS when commits[] is not an array, or overflows the cap", () => {
    expect(() => assertEmitSafe({ ...withCommits, commits: "none" })).toThrow(EmitAllowlistError);
    const over = Array.from({ length: 101 }, () => ({ id: SALTED, added: 1, contested: 0, authored: 1 }));
    expect(() => assertEmitSafe({ ...withCommits, commits: over })).toThrow(EmitAllowlistError);
  });

  it("THROWS on a negative / non-integer filesGoneFromTip", () => {
    expect(() => assertEmitSafe({ ...withCommits, filesGoneFromTip: -1 })).toThrow(EmitAllowlistError);
    expect(() => assertEmitSafe({ ...withCommits, filesGoneFromTip: 1.5 })).toThrow(EmitAllowlistError);
  });
});

describe("ALLOWLIST: assertEmitSafe passes legit events, throws on poisoned ones", () => {
  const sessionStart = toSessionStart(startCanon());
  const toolCallOk = toToolCall(canon({ hook_event_name: "PostToolUse" }))!;
  const toolCallFail = toToolCall(canon({ hook_event_name: "PostToolUseFailure" }))!;
  const sessionEnd = toSessionEnd(endCanon());

  it("passes every legitimately-built event", () => {
    expect(() => assertEmitSafe(sessionStart)).not.toThrow();
    expect(() => assertEmitSafe(toolCallOk)).not.toThrow();
    expect(() => assertEmitSafe(toolCallFail)).not.toThrow();
    expect(() => assertEmitSafe(sessionEnd)).not.toThrow();
  });

  it("passes a valid tool.call with a well-formed models[] item", () => {
    const event = {
      ...toolCallOk,
      models: [
        { model: "claude-sonnet-4-6", inputTokens: 1, outputTokens: 2, costUsd: 0.01 },
      ],
    } as any;
    expect(() => assertEmitSafe(event)).not.toThrow();
  });

  it("THROWS on a valid event poisoned with an extra disallowed key (event.command)", () => {
    const poisoned = { ...sessionStart, command: "x" } as any;
    expect(() => assertEmitSafe(poisoned)).toThrow(EmitAllowlistError);
  });

  it("THROWS when a content field (tool_input) is spread onto an event", () => {
    const poisoned = { ...toolCallOk, tool_input: { command: "rm -rf /" } } as any;
    expect(() => assertEmitSafe(poisoned)).toThrow(EmitAllowlistError);
  });

  it("THROWS on a disallowed key inside a models[] item", () => {
    const poisoned = {
      ...toolCallOk,
      models: [
        {
          model: "claude-sonnet-4-6",
          inputTokens: 1,
          outputTokens: 2,
          costUsd: 0.01,
          effort: "SENTINEL_EFFORT",
        },
      ],
    } as any;
    expect(() => assertEmitSafe(poisoned)).toThrow(EmitAllowlistError);
  });

  it("THROWS on an unknown event kind", () => {
    expect(() => assertEmitSafe({ kind: "secret.leak" } as any)).toThrow(
      EmitAllowlistError,
    );
  });

  it("THROWS on a non-object event", () => {
    expect(() => assertEmitSafe(null as any)).toThrow(EmitAllowlistError);
  });

  it("the allowlist never contains a content key", () => {
    const forbidden = [
      "prompt",
      "command",
      "file_path",
      "file_text",
      "stdout",
      "stderr",
      "tool_input",
      "tool_response",
      "tool_error",
      "source",
      "model",
    ];
    for (const keys of Object.values(EMIT_ALLOWLIST)) {
      for (const f of forbidden) {
        expect(keys.includes(f), `${f} must not be allowlisted`).toBe(false);
      }
    }
    // models[] items only ever carry the allowed per-model accounting keys
    // (tokens + cache split + advisory cost) — never a model-side content key.
    expect([...MODEL_ITEM_ALLOWLIST].sort()).toEqual(
      [
        "cacheReadTokens",
        "cacheWriteTokens",
        "costUsd",
        "inputTokens",
        "model",
        "outputTokens",
      ].sort(),
    );
  });
});

describe("toolName is sanitized to a closed set — a private MCP name never ships (ADR-CF2)", () => {
  it("sanitizeToolName passes built-ins through, buckets mcp__*, and drops the rest", () => {
    expect(sanitizeToolName("Edit")).toBe("Edit");
    expect(sanitizeToolName("Bash")).toBe("Bash");
    expect(sanitizeToolName("Read")).toBe("Read");
    // A private MCP server name must collapse to the bounded bucket, never ship.
    expect(sanitizeToolName("mcp__acmecorp_internal__deploy_prod")).toBe("mcp");
    expect(sanitizeToolName("mcp__stripe_billing__refund")).toBe("mcp");
    // An unknown/custom/future tool → other (coarser, never raw).
    expect(sanitizeToolName("SomeFutureBuiltin")).toBe("other");
    expect(sanitizeToolName("")).toBe("other");
  });

  it("the Codex tokens Shell/ApplyPatch NEVER pass through the Claude deriver (ADR-T5)", () => {
    // BUILTIN_TOOL_NAMES is the CLAUDE subset of KnownToolName, not the whole
    // union. Adding Shell/ApplyPatch there would file Claude calls under Codex's
    // names and blend the two tools' distributions ADR-T5 keeps apart; this pin
    // is what fails if someone "completes" the set.
    expect(sanitizeToolName("Shell")).toBe("other");
    expect(sanitizeToolName("ApplyPatch")).toBe("other");
  });

  it("a tool.call built from an mcp__ tool_name carries 'mcp', not the raw server name", () => {
    const event = toToolCall(
      canon({
        hook_event_name: "PostToolUse",
        tool_name: "mcp__acmecorp_internal__deploy_prod",
      }),
    ) as any;
    expect(event.toolName).toBe("mcp");
    expect(JSON.stringify(event)).not.toContain("acmecorp");
    expect(() => assertEmitSafe(event)).not.toThrow();
  });

  it("assertEmitSafe THROWS on a tool.call carrying a raw / private toolName (the backstop)", () => {
    const base = toToolCall(canon({ hook_event_name: "PostToolUse", tool_name: "Edit" }))!;
    for (const raw of [
      "mcp__acmecorp_internal__deploy_prod",
      "SomeCustomTool",
      "edit", // wrong case is not a built-in
      "",
    ]) {
      expect(() => assertEmitSafe({ ...base, toolName: raw } as any), raw).toThrow(
        EmitAllowlistError,
      );
    }
  });
});

describe("errored derivation keys off hook_event_name, not output", () => {
  it("PostToolUseFailure => errored === true", () => {
    const event = toToolCall(canon({ hook_event_name: "PostToolUseFailure" }));
    expect(event).toBeDefined();
    expect((event as any).errored).toBe(true);
  });

  it("PostToolUse => errored === false", () => {
    const event = toToolCall(canon({ hook_event_name: "PostToolUse" }));
    expect(event).toBeDefined();
    expect((event as any).errored).toBe(false);
  });

  it("toToolCall returns undefined without session_id or tool_name", () => {
    expect(toToolCall(canon({ session_id: undefined }))).toBeUndefined();
    expect(toToolCall(canon({ tool_name: undefined }))).toBeUndefined();
  });
});

describe("verification signal classifies-then-discards the command", () => {
  it("emits verificationKind + verificationPassed but NEVER the command string", () => {
    const input = canon({
      tool_name: "Bash",
      hook_event_name: "PostToolUse",
      // A real verification command that ALSO carries a content sentinel.
      tool_input: { command: "vitest run SENTINEL_CMD" },
      tool_response: { exit_code: 0, stdout: "SENTINEL_OUT" },
    });
    const event = toToolCall(input) as any;
    expect(event.verificationKind).toBe("test");
    expect(event.verificationPassed).toBe(true);
    // The command (and any output) must not survive onto the emitted event.
    assertNoSentinels(event, "toToolCall(Bash verification)");
    expect(() => assertEmitSafe(event)).not.toThrow();
  });

  it("PostToolUseFailure on a verification command => verificationPassed false", () => {
    const event = toToolCall(
      canon({
        tool_name: "Bash",
        hook_event_name: "PostToolUseFailure",
        tool_input: { command: "tsc --noEmit SENTINEL_CMD" },
        tool_response: {},
      }),
    ) as any;
    expect(event.verificationKind).toBe("typecheck");
    expect(event.verificationPassed).toBe(false);
    assertNoSentinels(event, "toToolCall(Bash verification failure)");
  });

  it("a non-verification Bash command emits no verification fields", () => {
    const event = toToolCall(
      canon({ tool_name: "Bash", tool_input: { command: "ls -la SENTINEL_CMD" } }),
    ) as any;
    expect(event.verificationKind).toBeUndefined();
    expect(event.verificationPassed).toBeUndefined();
    assertNoSentinels(event, "toToolCall(non-verification Bash)");
  });

  // The REAL Claude Code payload shape: PostToolUse with no exit_code anywhere.
  // (0 exit_code hits across 5,148 local transcripts; the fixture above that
  // supplies `exit_code: 0` is synthetic and is the reason this hole went unseen.)
  // PostToolUse fires ONLY on exit 0 — a non-zero exit routes to
  // PostToolUseFailure (anthropics/claude-code#6371, closed "not planned") — so
  // which-hook-fired IS the result signal and this is a real, observed PASS.
  it("PostToolUse on a verification command with NO exit signal => passed true", () => {
    const event = toToolCall(
      canon({
        tool_name: "Bash",
        hook_event_name: "PostToolUse",
        tool_input: { command: "npm test SENTINEL_CMD" },
        tool_response: { stdout: "SENTINEL_OUT", stderr: "", interrupted: false },
      }),
    ) as any;
    expect(event.verificationKind).toBe("test");
    expect(event.verificationPassed).toBe(true);
    expect(event.errored).toBe(false);
    assertNoSentinels(event, "toToolCall(Bash verification pass, no exit_code)");
    expect(() => assertEmitSafe(event)).not.toThrow();
  });

  // ADAPTER INVARIANT: an adapter that cannot observe the FAILURE leg must leave
  // `errored` undefined, and then we must NOT infer a pass. This is the Codex
  // hazard: its PostToolUse fires only on success and it has no failure hook, so
  // inferring pass-from-success-hook would pin the rate at a fabricated 100%.
  it("errored undefined (adapter cannot observe the failure leg) => passed undefined", () => {
    const event = toToolCall({
      phase: "toolUse",
      sessionId: "no-failure-leg",
      toolName: "Bash",
      verificationCommand: "npm test",
      // errored intentionally absent
    }) as any;
    expect(event.verificationKind).toBe("test");
    expect(event.verificationPassed).toBeUndefined();
  });

  // `errored: false` asserts "observed to succeed". A one-leg adapter may not claim
  // it, or a tool with no error data reports a confident 0% error rate. The worker
  // keys on PRESENCE, so an absent flag reads honest-empty.
  it("errored is ABSENT (not false) when the adapter cannot observe the failure leg", () => {
    const event = toToolCall({
      phase: "toolUse",
      sessionId: "no-failure-leg",
      toolName: "Read",
    }) as any;
    expect("errored" in event).toBe(false);
    expect(() => assertEmitSafe(event)).not.toThrow();
  });

  it("claude-code still stamps errored on BOTH legs (this change is a no-op for it)", () => {
    const ok = toToolCall(canon({ tool_name: "Read", hook_event_name: "PostToolUse" })) as any;
    const bad = toToolCall(canon({ tool_name: "Read", hook_event_name: "PostToolUseFailure" })) as any;
    expect(ok.errored).toBe(false);
    expect(bad.errored).toBe(true);
  });

  it("classifyVerification maps representative commands and returns null otherwise", () => {
    expect(classifyVerification("npm test")).toBe("test");
    expect(classifyVerification("pnpm run test --watch=false")).toBe("test");
    expect(classifyVerification("npx tsc --noEmit")).toBe("typecheck");
    expect(classifyVerification("eslint .")).toBe("lint");
    expect(classifyVerification("npm run build")).toBe("build");
    expect(classifyVerification("git status")).toBeNull();
    expect(classifyVerification("echo hello")).toBeNull();
  });
});

describe("parseReason / reason mapping (via toSessionEnd)", () => {
  const KNOWN: ReadonlyArray<string> = [
    "clear",
    "resume",
    "logout",
    "prompt_input_exit",
    "bypass_permissions_disabled",
    "other",
  ];

  it("maps each known reason straight through", () => {
    for (const reason of KNOWN) {
      const event = toSessionEnd(canon({ hook_event_name: "SessionEnd", reason }));
      expect((event as any).reason).toBe(reason);
    }
  });

  it("maps an unknown reason to 'other'", () => {
    const event = toSessionEnd(
      canon({ hook_event_name: "SessionEnd", reason: "SENTINEL_REASON" }),
    );
    expect((event as any).reason).toBe("other");
  });

  it("maps a missing reason to 'other'", () => {
    const event = toSessionEnd(
      canon({ hook_event_name: "SessionEnd", reason: undefined }),
    );
    expect((event as any).reason).toBe("other");
  });
});

describe("session.start capabilities (3 booleans, allowlisted + deep-validated)", () => {
  it("EMIT_ALLOWLIST['session.start'] includes capabilities", () => {
    expect(EMIT_ALLOWLIST["session.start"].includes("capabilities")).toBe(true);
  });

  it("toSessionStart emits the claude-code capability set for the default adapter, and passes assertEmitSafe", () => {
    const event = toSessionStart(startCanon()) as any;
    expect(event.agent).toBe("claude-code");
    expect(event.capabilities).toEqual({ hasTokens: true, hasCacheTokens: true, cost: "estimated", toolResult: "both", endReason: true, duration: "measured", verification: "both", costScope: "call", usageWindow: "count" });
    expect(() => assertEmitSafe(event)).not.toThrow();
    // capabilities are booleans + closed enums — no content can ride inside.
    assertNoSentinels(event, "toSessionStart(capabilities)");
  });

  it("THROWS when capabilities carries an un-allowlisted (content) key", () => {
    const poisoned = {
      ...(toSessionStart(startCanon()) as any),
      capabilities: { hasTokens: true, hasCacheTokens: true, cost: "estimated", toolResult: "both", leaked: "SENTINEL_CAP" },
    };
    expect(() => assertEmitSafe(poisoned)).toThrow(EmitAllowlistError);
  });

  it("THROWS when a boolean capability carries a non-boolean (content) value", () => {
    const poisoned = {
      ...(toSessionStart(startCanon()) as any),
      capabilities: { hasTokens: "/Users/x/secret", hasCacheTokens: true, cost: "estimated", toolResult: "both" },
    };
    expect(() => assertEmitSafe(poisoned)).toThrow(EmitAllowlistError);
  });

  // `cost` and `toolResult` are the only STRING values allowed inside capabilities,
  // so they are the only place free text could ride in. The allowlist alone would
  // pass them (the key is permitted); it is the VALUE pin that closes the door.
  it("THROWS when `cost` is a string outside its closed enum (a typo, or smuggled content)", () => {
    for (const bad of ["estimate", "free", "/Users/x/secret", "", "BILLED"]) {
      const poisoned = {
        ...(toSessionStart(startCanon()) as any),
        capabilities: { hasTokens: true, hasCacheTokens: true, cost: bad, toolResult: "both" },
      };
      expect(() => assertEmitSafe(poisoned), `cost: ${JSON.stringify(bad)}`).toThrow(EmitAllowlistError);
    }
  });

  it("THROWS when `toolResult` is outside its closed enum", () => {
    for (const bad of ["failures", "all", true, 1, null]) {
      const poisoned = {
        ...(toSessionStart(startCanon()) as any),
        capabilities: { hasTokens: true, hasCacheTokens: true, cost: "estimated", toolResult: bad },
      };
      expect(() => assertEmitSafe(poisoned), `toolResult: ${JSON.stringify(bad)}`).toThrow(EmitAllowlistError);
    }
  });

  it("ACCEPTS every legal value of each capability enum", () => {
    for (const cost of ["billed", "estimated", "none"]) {
      for (const toolResult of ["both", "failures-only", "passes-only", "none"]) {
        const event = {
          ...(toSessionStart(startCanon()) as any),
          capabilities: { hasTokens: true, hasCacheTokens: true, cost, toolResult },
        };
        expect(() => assertEmitSafe(event), `${cost}/${toolResult}`).not.toThrow();
      }
    }
  });
});

describe("session.start carries a salted repoId + basename repoLabel, NEVER an absolute path", () => {
  it("emits repoId + repoLabel, no workingDir, and no absolute path in the JSON", () => {
    // hostileInput cwd is "/tmp/seorak-test-cwd" (NOT a git repo) → the builder
    // falls back to a salted hash of the cwd + basename(cwd) for the label.
    const event = toSessionStart(startCanon()) as any;

    // The frozen contract fields are present…
    expect(typeof event.repoId).toBe("string");
    expect(event.repoId.length).toBeGreaterThan(0);
    expect(event.repoLabel).toBe("seorak-test-cwd"); // basename of the cwd only

    // …and the absolute path is GONE: no workingDir, no cwd, no path-shaped value.
    expect(event.workingDir).toBeUndefined();
    expect(event.cwd).toBeUndefined();

    // repoId is a salted sha256 hex (the cwd is hashed, not stored verbatim).
    expect(/^[0-9a-f]{64}$/.test(event.repoId)).toBe(true);

    // PROBE: the serialized event must contain NO "/" — an absolute path always
    // does, so its absence proves no path (cwd, toplevel, transcript) leaked.
    const serialized = JSON.stringify(event);
    expect(serialized.includes("/"), `session.start JSON leaked a path: ${serialized}`).toBe(false);
  });

  it("the SAME cwd hashes to the SAME repoId (stable salted key) across builds", () => {
    const a = toSessionStart(startCanon()) as any;
    const b = toSessionStart(startCanon()) as any;
    expect(a.repoId).toBe(b.repoId);
  });

  it("EMIT_ALLOWLIST['session.start'] has repoId + repoLabel and NOT workingDir", () => {
    const allowed = EMIT_ALLOWLIST["session.start"];
    expect(allowed.includes("repoId")).toBe(true);
    expect(allowed.includes("repoLabel")).toBe(true);
    expect(allowed.includes("workingDir")).toBe(false);
  });

  it("passes a well-formed session.start, THROWS when a smuggled workingDir/absolute path rides on it", () => {
    const event = toSessionStart(startCanon());
    expect(() => assertEmitSafe(event)).not.toThrow();

    // A smuggled absolute-path key (the exact leak this contract closes) must throw.
    expect(() =>
      assertEmitSafe({ ...(event as any), workingDir: "/Users/x/secret/repo" } as any),
    ).toThrow(EmitAllowlistError);
    // Any other path-shaped key is equally rejected (only the allowlist passes).
    expect(() =>
      assertEmitSafe({ ...(event as any), cwd: "/Users/x/secret/repo" } as any),
    ).toThrow(EmitAllowlistError);
    expect(() =>
      assertEmitSafe({ ...(event as any), path: "/Users/x/secret/repo" } as any),
    ).toThrow(EmitAllowlistError);
  });

  it("the session.start allowlist contains no path/content key", () => {
    for (const k of ["workingDir", "cwd", "path", "toplevel", "transcriptPath"]) {
      expect(
        EMIT_ALLOWLIST["session.start"].includes(k),
        `${k} must not be allowlisted on session.start`,
      ).toBe(false);
    }
  });
});

describe("strict Claude hook authority", () => {
  const rawStart = {
    hook_event_name: "SessionStart",
    session_id: "disp-sess",
    cwd: "/tmp/seorak-test-cwd-not-a-repo-xyz",
    source: "startup",
    model: "claude-sonnet-4-6",
  };
  const rawToolFail = {
    hook_event_name: "PostToolUseFailure",
    session_id: "disp-sess",
    tool_name: "Bash",
    tool_input: { command: "vitest run SENTINEL_CMD" },
    tool_response: {},
  };
  const rawEnd = { hook_event_name: "SessionEnd", session_id: "disp-sess", reason: "clear" };

  it("builds current Claude events with the exact Claude authority", () => {
    const start = toSessionStart(canon(rawStart)) as any;
    expect(start.kind).toBe("session.start");
    expect(start.agent).toBe("claude-code");
    expect(start.sessionId).toBe("disp-sess");
    expect(start.capabilities).toEqual({ hasTokens: true, hasCacheTokens: true, cost: "estimated", toolResult: "both", endReason: true, duration: "measured", verification: "both", costScope: "call", usageWindow: "count" });

    const tool = toToolCall(canon(rawToolFail)) as any;
    expect(tool.kind).toBe("tool.call");
    expect(tool.errored).toBe(true);
    expect(tool.verificationKind).toBe("test");
    expect(tool.verificationPassed).toBe(false);
    assertNoSentinels(tool, "dispatch tool.call");
    expect(() => assertEmitSafe(tool)).not.toThrow();

    const end = toSessionEnd(canon(rawEnd)) as any;
    expect(end.kind).toBe("session.end");
    expect(end.reason).toBe("clear");
  });

  it("drops unknown or malformed native phases instead of guessing tool use", () => {
    expect(parseClaudeCodeHook(undefined)).toBeUndefined();
    expect(parseClaudeCodeHook([])).toBeUndefined();
    expect(parseClaudeCodeHook({})).toBeUndefined();
    expect(
      parseClaudeCodeHook({
        hook_event_name: "FutureHook",
        session_id: "disp-sess",
        tool_name: "Bash",
      }),
    ).toBeUndefined();
  });

  it("does not mint start or end events without a native session id", () => {
    expect(toSessionStart(canon({ hook_event_name: "SessionStart", session_id: undefined }))).toBeUndefined();
    expect(toSessionEnd(canon({ hook_event_name: "SessionEnd", session_id: undefined }))).toBeUndefined();
    expect(toGitMomentum(canon({ hook_event_name: "SessionStart", session_id: undefined }))).toBeUndefined();
    expect(toRepoToolchain(canon({ hook_event_name: "SessionStart", session_id: undefined }))).toBeUndefined();
  });

  it("builders reject a valid payload from the wrong hook executable", () => {
    const tool = canon(rawToolFail);
    expect(toSessionStart(tool)).toBeUndefined();
    expect(toSessionEnd(tool)).toBeUndefined();
  });

  it("maps only the six supported Claude Code phases", () => {
    expect(parseClaudeCodeHook({ hook_event_name: "SessionStart" })?.phase).toBe("start");
    expect(parseClaudeCodeHook({ hook_event_name: "PostToolUse" })?.phase).toBe("toolUse");
    expect(parseClaudeCodeHook({ hook_event_name: "PostToolUseFailure" })?.phase).toBe(
      "toolUseFailure",
    );
    expect(parseClaudeCodeHook({ hook_event_name: "SessionEnd" })?.phase).toBe("end");
    expect(parseClaudeCodeHook({ hook_event_name: "Notification" })?.phase).toBe("notification");
    expect(parseClaudeCodeHook({ hook_event_name: "UserPromptSubmit" })?.phase).toBe("userPrompt");
    expect(parseClaudeCodeHook({ hook_event_name: "PostToolUseFailure" })?.errored).toBe(true);
    expect(parseClaudeCodeHook({ hook_event_name: "PostToolUse" })?.errored).toBe(false);
  });

  it("does not retain speculative model metadata on CanonicalInput", () => {
    const parsed = parseClaudeCodeHook({
      hook_event_name: "SessionStart",
      model: "claude-sonnet-4-6",
      transcript_path: "/tmp/transcript.jsonl",
    });
    expect(parsed).not.toHaveProperty("model");
    expect(parsed?.transcriptPath).toBe("/tmp/transcript.jsonl");
  });
});

// ── CAPTURE-FOUNDATION: the additive capture layer's boundary regressions ──────

describe("repo.toolchain allowlist (enums + salted id only — the manifest never ships)", () => {
  const toolchain = {
    kind: "repo.toolchain",
    eventId: "evt-tc-1",
    sessionId: "sess-1",
    at: "2026-07-03T00:00:00.000Z",
    repoId: "abc123",
    gitContext: "clean",
    packageManager: "pnpm",
    framework: "react",
  } as any;

  it("passes a well-formed toolchain event (with and without the opt-in repoLabel, and with nulls)", () => {
    expect(() => assertEmitSafe(toolchain)).not.toThrow();
    expect(() => assertEmitSafe({ ...toolchain, repoLabel: "seorak" })).not.toThrow();
    expect(() => assertEmitSafe({ ...toolchain, packageManager: null, framework: null })).not.toThrow();
  });

  it("THROWS on a non-enum packageManager / framework (a raw dep name can never ride)", () => {
    expect(() => assertEmitSafe({ ...toolchain, packageManager: "@acmecorp/build" })).toThrow(EmitAllowlistError);
    expect(() => assertEmitSafe({ ...toolchain, framework: "acme-secret-framework" })).toThrow(EmitAllowlistError);
    expect(() => assertEmitSafe({ ...toolchain, gitContext: "packages/acme-secret" })).toThrow(EmitAllowlistError);
  });

  it("THROWS on a smuggled manifest key (dep list / name / repository url)", () => {
    for (const poison of [
      { dependencies: { react: "^18" } },
      { name: "acme-secret-service" },
      { repository: "git@github.com:acmecorp/secret.git" },
      { version: "1.2.3" },
    ]) {
      expect(() => assertEmitSafe({ ...toolchain, ...poison } as any), JSON.stringify(poison)).toThrow(
        EmitAllowlistError,
      );
    }
  });

  it("the repo.toolchain allowlist contains no manifest/content key", () => {
    for (const k of ["dependencies", "devDependencies", "name", "repository", "version", "workingDir", "path"]) {
      expect(EMIT_ALLOWLIST["repo.toolchain"].includes(k), `${k} must not be allowlisted`).toBe(false);
    }
  });

  it("the builder gates repoLabel behind the default-OFF repoLabels opt-in (undefined here in a non-repo cwd → undefined event, no leak)", () => {
    // In the sandbox cwd there is no manifest, so the builder returns undefined —
    // proving it emits nothing rather than a null-null event with a bare repoId.
    const event = toRepoToolchain(canon({ cwd: "/tmp/seorak-test-cwd-not-a-repo-xyz" }));
    assertNoSentinels(event, "toRepoToolchain(no manifest)");
  });
});

describe("session.prompt allowlist (ENVELOPE ONLY — the prompt text never ships, ADR-CF8)", () => {
  it("toSessionPrompt builds an envelope-only event that never carries the prompt", () => {
    const event = toSessionPrompt(
      parseClaudeCodeHook({
        hook_event_name: "UserPromptSubmit",
        session_id: "s1",
        prompt: "SENTINEL_PROMPT delete the production database",
      }),
    );
    expect(event).toBeDefined();
    expect(Object.keys(event!).sort()).toEqual(["at", "eventId", "kind", "sessionId"]);
    assertNoSentinels(event, "toSessionPrompt");
    expect(() => assertEmitSafe(event!)).not.toThrow();
  });

  it("THROWS on a smuggled prompt / promptLength / text key", () => {
    const base = { kind: "session.prompt", eventId: "e1", sessionId: "s1", at: "2026-07-03T00:00:00.000Z" };
    for (const poison of [{ prompt: "SENTINEL_PROMPT" }, { promptLength: 42 }, { text: "hi" }, { tokens: 10 }]) {
      expect(() => assertEmitSafe({ ...base, ...poison } as any), JSON.stringify(poison)).toThrow(
        EmitAllowlistError,
      );
    }
  });

  it("the session.prompt allowlist contains no prompt/text/length key", () => {
    for (const k of ["prompt", "promptLength", "text", "message", "tokens", "chars"]) {
      expect(EMIT_ALLOWLIST["session.prompt"].includes(k), `${k} must not be allowlisted`).toBe(false);
    }
  });
});

describe("session.start agentVersion value-pin (a version shape, never free text)", () => {
  const base = () => toSessionStart(startCanon()) as any;

  it("passes version-shaped strings, including the honest 'unknown' fallback", () => {
    for (const v of ["2.0.14", "0.142.5", "unknown", "1.2.3-beta.1+build.5"]) {
      expect(() => assertEmitSafe({ ...base(), agentVersion: v }), v).not.toThrow();
    }
  });

  it("THROWS on a path / prose / empty / oversized / non-string agentVersion", () => {
    // CLAUDE_CODE_VERSION is an env var shipped verbatim by the builder, so this
    // pin is what stops it from being a free-text channel out of the machine.
    for (const bad of [
      "/Users/x/secret/bin",
      "2.0.14 (SENTINEL prose)",
      "",
      "a".repeat(65),
      42,
      null,
    ]) {
      expect(() => assertEmitSafe({ ...base(), agentVersion: bad } as any), JSON.stringify(bad)).toThrow(
        EmitAllowlistError,
      );
    }
  });
});

describe("session.start agentVersion DERIVATION: a malformed env value degrades, never aborts the append", () => {
  // The Claude-Code leg reads process.env.CLAUDE_CODE_VERSION, an env var anyone
  // can set. Shipped verbatim, a non-conforming value (e.g. a nightly tag with a
  // space) would hit the emit pin and THROW inside the session-start hook, which
  // has no try/catch — silencing the whole session and its repo registration.
  // hooks.ts degrades it to "unknown" at derivation against the SAME exported pin.
  let savedVersion: string | undefined;
  beforeEach(() => {
    savedVersion = process.env.CLAUDE_CODE_VERSION;
  });
  afterEach(() => {
    if (savedVersion === undefined) delete process.env.CLAUDE_CODE_VERSION;
    else process.env.CLAUDE_CODE_VERSION = savedVersion;
  });

  it("a malformed env version becomes 'unknown' and appends cleanly", () => {
    process.env.CLAUDE_CODE_VERSION = "2.0.14 (nightly)"; // the space fails the pin
    const event = toSessionStart(startCanon()) as any;
    expect(event.agentVersion).toBe("unknown");
    expect(() => assertEmitSafe(event)).not.toThrow();
  });

  it("a version-shaped env value rides through verbatim", () => {
    process.env.CLAUDE_CODE_VERSION = "2.0.14";
    const event = toSessionStart(startCanon()) as any;
    expect(event.agentVersion).toBe("2.0.14");
    expect(() => assertEmitSafe(event)).not.toThrow();
  });

  it("an absent env value falls back to the honest 'unknown'", () => {
    delete process.env.CLAUDE_CODE_VERSION;
    const event = toSessionStart(startCanon()) as any;
    expect(event.agentVersion).toBe("unknown");
    expect(() => assertEmitSafe(event)).not.toThrow();
  });
});

describe("session.start branchWorkType value-pin (a closed enum, never a branch name — ADR-CF4)", () => {
  const base = () => toSessionStart(startCanon()) as any;

  it("passes a valid branchWorkType and rejects a raw branch name", () => {
    expect(() => assertEmitSafe({ ...base(), branchWorkType: "feature" })).not.toThrow();
    expect(() => assertEmitSafe({ ...base(), branchWorkType: "chore" })).not.toThrow();
    // A raw branch string (the exact leak the classify-then-discard closes) throws.
    expect(() => assertEmitSafe({ ...base(), branchWorkType: "feat/acme-secret-launch" })).toThrow(
      EmitAllowlistError,
    );
    expect(() => assertEmitSafe({ ...base(), branchWorkType: "main" })).toThrow(EmitAllowlistError);
  });
});

describe("tool.call fileLanguage + undoKind value-pins (closed enums — ADR-CF5/CF6)", () => {
  const toolCall = () => toToolCall(canon({ hook_event_name: "PostToolUse", tool_name: "Edit" }))!;

  it("passes valid fileLanguage / undoKind and rejects non-enum values", () => {
    expect(() => assertEmitSafe({ ...toolCall(), fileLanguage: "rust" })).not.toThrow();
    expect(() => assertEmitSafe({ ...toolCall(), undoKind: "reset-hard" })).not.toThrow();
    expect(() => assertEmitSafe({ ...toolCall(), fileLanguage: "cobol" })).toThrow(EmitAllowlistError);
    expect(() => assertEmitSafe({ ...toolCall(), undoKind: "stash" })).toThrow(EmitAllowlistError);
    // A raw path smuggled as a language must throw, not ride.
    expect(() => assertEmitSafe({ ...toolCall(), fileLanguage: "/Users/x/secret.rs" })).toThrow(
      EmitAllowlistError,
    );
  });
});

describe("git.momentum repoShape deep value-check (the FIRST git.momentum deep branch — ADR-CF7)", () => {
  const momentum = {
    kind: "git.momentum",
    eventId: "evt-m-1",
    sessionId: "sess-1",
    at: "2026-07-03T00:00:00.000Z",
    repoId: "abc123",
    repoLabel: "seorak",
    gitContext: "clean",
    windowDays: 7,
    commits: 3,
    filesTouched: 5,
    linesAdded: 40,
    linesDeleted: 10,
    generatedLinesExcluded: 100,
  } as any;
  const shape = { monorepo: true, sizeBand: "l", ageBand: "mature" };

  it("passes a well-formed repoShape (and momentum with none)", () => {
    expect(() => assertEmitSafe(momentum)).not.toThrow();
    expect(() => assertEmitSafe({ ...momentum, repoShape: shape })).not.toThrow();
  });

  it("THROWS when monorepo is a raw string (e.g. a leaked workspace glob), not a boolean", () => {
    expect(() =>
      assertEmitSafe({ ...momentum, repoShape: { ...shape, monorepo: "packages/acme-secret/*" } }),
    ).toThrow(EmitAllowlistError);
  });

  it("THROWS on an unknown nested key or a non-enum band", () => {
    expect(() =>
      assertEmitSafe({ ...momentum, repoShape: { ...shape, workspaceGlob: "packages/*" } }),
    ).toThrow(EmitAllowlistError);
    expect(() => assertEmitSafe({ ...momentum, repoShape: { ...shape, sizeBand: "huge" } })).toThrow(
      EmitAllowlistError,
    );
    expect(() => assertEmitSafe({ ...momentum, repoShape: { ...shape, ageBand: "ancient" } })).toThrow(
      EmitAllowlistError,
    );
    expect(() => assertEmitSafe({ ...momentum, repoShape: "not-an-object" })).toThrow(EmitAllowlistError);
  });
});

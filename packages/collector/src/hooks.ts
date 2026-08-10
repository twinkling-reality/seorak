import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type {
  GitMomentumEvent,
  RepoToolchainEvent,
  SessionDeltaEvent,
  SessionEvent,
  SessionNotificationEvent,
  SessionPromptEvent,
  UndoKind,
} from "@seorak/types";
import { CAPABILITY_REGISTRY } from "@seorak/types";
import type { CanonicalInput } from "./adapters/types.ts";
import { classifyBranchWorkType } from "./branch-work-type.ts";
import { captureSettings } from "./capture-settings.ts";
import { AGENT_VERSION_SHAPE } from "./emit.ts";
import {
  buildGitMomentum,
  captureSessionDelta,
  currentBranch,
  gitContext,
  momentumEnabled,
  repoIdentity,
  repoIdentityOrCwd,
  writeSessionStartGit,
} from "./git.ts";
import { registerRepoFromCwd } from "./registry.ts";
import { detectToolchain } from "./toolchain.ts";
import { consumeUsageSince } from "./usage.ts";

/**
 * readRawHookInput() — read + JSON-parse the hook's stdin into a raw object. This
 * is the ONLY tool-touching step left in hooks.ts, and it is tool-agnostic: it
 * just deserializes the bytes. The per-tool MEANING is assigned by an adapter's
 * parse() (see src/adapters/). Returns {} on empty/malformed input (never throws).
 */
export function readRawHookInput(): unknown {
  const raw = readFileSync(0, "utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const nowIso = () => new Date().toISOString();
const newEventId = () => randomUUID();

/**
 * The Claude-Code agentVersion leg: process.env.CLAUDE_CODE_VERSION is an env var
 * anyone can set, so a non-conforming value (e.g. "2.0.14 (nightly)") shipped
 * verbatim would hit the emit pin (AGENT_VERSION_SHAPE) and THROW, aborting the
 * whole session.start append and silencing the session (and its repo
 * registration). Degrade to "unknown" HERE at derivation, exactly as the codex
 * adapter's sanitizeVersion does, and against the EXACT same exported pin so the
 * two can never drift. The emit throw stays as the code-bug backstop.
 */
function agentVersionFromEnv(): string {
  const raw = process.env.CLAUDE_CODE_VERSION;
  return typeof raw === "string" && AGENT_VERSION_SHAPE.test(raw) ? raw : "unknown";
}

export function toSessionStart(
  input: CanonicalInput,
): SessionEvent | undefined {
  if (!input.sessionId || input.phase !== "start") return undefined;
  // The raw cwd is used LOCALLY only (git cwd + repo registration); the emitted
  // event carries the salted repoId + basename repoLabel, NEVER the absolute path.
  const cwd = input.cwd ?? process.cwd();
  const { repoId, repoLabel } = repoIdentityOrCwd(cwd);
  // Work-type from the branch-name prefix (classified on-machine, branch string
  // discarded — ADR-DM6). Gated by git capture; absent off a branch (non-repo /
  // detached / git off) so a non-git session carries no noisy "other".
  const branch = momentumEnabled() ? currentBranch(cwd) : null;
  const branchWorkType = branch ? classifyBranchWorkType(branch) : undefined;
  return {
    kind: "session.start",
    eventId: newEventId(),
    sessionId: input.sessionId,
    at: nowIso(),
    repoId,
    repoLabel,
    agent: "claude-code",
    agentVersion: agentVersionFromEnv(),
    capabilities: CAPABILITY_REGISTRY["claude-code"]!,
    ...(branchWorkType !== undefined ? { branchWorkType } : {}),
  };
}

/**
 * toRepoToolchain(input) — a repo-scoped RepoToolchainEvent (packageManager +
 * framework), appended alongside session.start. Undefined when the `toolchain`
 * capture setting is off or nothing is detected (no signal). ENUMS + salted id
 * only: the lockfile is existsSync'd, the manifest is read on-machine to match a
 * closed table and discarded. repoLabel rides only under the default-OFF
 * repoLabels opt-in (world-open read stays re-id-safe).
 */
export function toRepoToolchain(input: CanonicalInput): RepoToolchainEvent | undefined {
  if (!input.sessionId || input.phase !== "start" || !captureSettings().toolchain) {
    return undefined;
  }
  const cwd = input.cwd ?? process.cwd();
  const { packageManager, framework } = detectToolchain(cwd);
  if (packageManager === null && framework === null) return undefined;
  const { repoId, repoLabel } = repoIdentityOrCwd(cwd);
  return {
    kind: "repo.toolchain",
    eventId: newEventId(),
    sessionId: input.sessionId,
    at: nowIso(),
    repoId,
    gitContext: gitContext(cwd),
    packageManager,
    framework,
    ...(captureSettings().repoLabels ? { repoLabel } : {}),
  };
}

/**
 * registerSessionStartRepo(input) — register the repo behind this session's cwd
 * into the LOCAL daemon registry at session-start time, so the daemon's timer
 * sweep covers it. Replaces the daemon's old event-driven registration (the
 * emitted session.start no longer carries the absolute path). Side-effect only
 * (no event); the absolute cwd is used as a git cwd and stays LOCAL. No-op when
 * momentum is disabled or the cwd is not a git repo (registerRepoFromCwd guards).
 */
export function registerSessionStartRepo(input: CanonicalInput): void {
  if (!momentumEnabled()) return;
  registerRepoFromCwd(input.cwd ?? process.cwd(), nowIso());
}

export function toToolCall(input: CanonicalInput): SessionEvent | undefined {
  if (!input.sessionId || !input.toolName) return undefined;
  const { delta, models } = consumeUsageSince(input.sessionId, input.transcriptPath);
  const verification = classifyVerificationCall(input);
  // Within-session undo: reuse the Bash command already lifted for verification;
  // classify to a closed enum and discard (the command string never ships).
  const undoKind = classifyUndo(input.verificationCommand);
  return {
    kind: "tool.call",
    eventId: newEventId(),
    sessionId: input.sessionId,
    at: nowIso(),
    toolName: input.toolName,
    inputTokens: delta.inputTokens,
    outputTokens: delta.outputTokens,
    cacheReadTokens: delta.cacheReadTokens,
    cacheWriteTokens: delta.cacheWriteTokens,
    costUsd: delta.costUsd,
    // The adapter derives this from its native failure signal (Claude Code:
    // PostToolUseFailure) with ZERO output parsing.
    //
    // ABSENT, never coerced to false. `errored: false` asserts "this call was
    // OBSERVED to succeed", which an adapter may only claim when it can see BOTH
    // legs of the outcome. Claude Code can (PostToolUse => success,
    // PostToolUseFailure => failure), so this is unchanged for it. A one-leg
    // adapter must leave `errored` undefined: coercing to false would report a
    // confident 0% error rate for a tool with no error data at all. The worker
    // already keys on PRESENCE (`typeof errored !== "boolean"` => errorCount
    // null), so an absent flag reads honest-empty end to end.
    ...(typeof input.errored === "boolean" ? { errored: input.errored } : {}),
    // Line delta, ALREADY derived by the adapter from its native edit payload
    // (counts only — the strings never left the adapter). Absent for non-edit
    // tools and failed calls, keeping the honest-empty contract.
    ...(input.editLines !== undefined
      ? { linesAdded: input.editLines.added, linesRemoved: input.editLines.removed }
      : {}),
    // Salted file identity, ALREADY derived by the adapter (file-id.ts) — ids
    // are 64-hex hashes, labels are basenames riding only under the fileLabels
    // opt-in. The path never reached this builder.
    ...(input.file !== undefined
      ? {
          fileId: input.file.fileId,
          dirId: input.file.dirId,
          ...(input.file.fileCategory !== undefined
            ? { fileCategory: input.file.fileCategory }
            : {}),
          ...(input.file.fileLanguage !== undefined
            ? { fileLanguage: input.file.fileLanguage }
            : {}),
          ...(input.file.fileLabel !== undefined ? { fileLabel: input.file.fileLabel } : {}),
          ...(input.file.dirLabel !== undefined ? { dirLabel: input.file.dirLabel } : {}),
        }
      : {}),
    // Per-model breakdown of this delta. Only the four allowlisted accounting
    // keys are projected (cache tokens + the internal `priced` flag stay local);
    // an unpriced model's costUsd is 0, surfacing as ModelRollup.costUsd=null at
    // the worker. Omitted entirely (absent, not []) when the delta has no rows.
    ...(models.length > 0
      ? {
          models: models.map((m) => ({
            model: m.model,
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            // Per-model cache split so the worker can re-price from tokens alone
            // (option C) — cache is a large share of a cached Claude session.
            cacheReadTokens: m.cacheReadTokens,
            cacheWriteTokens: m.cacheWriteTokens,
            costUsd: m.costUsd,
          })),
        }
      : {}),
    // Verification signal: kind + pass/fail ONLY; the command string was read to
    // classify and immediately discarded (never stored — content stays local).
    ...(verification
      ? {
          verificationKind: verification.kind,
          ...(verification.passed === undefined
            ? {}
            : { verificationPassed: verification.passed }),
        }
      : {}),
    // Within-session undo kind (enum only; the command was read + discarded above).
    ...(undoKind !== undefined ? { undoKind } : {}),
  };
}

/**
 * classifyUndo(command) — classify a git command into a within-session UndoKind, or
 * undefined when it is not a work-discard. PURE + content-free output: the command
 * string is the input only (the caller discards it and emits just the enum). Only
 * genuine "changed back" actions count; a plain `git checkout <branch>` (a switch,
 * not a discard) deliberately does NOT match. Order: most-destructive first.
 */
export function classifyUndo(command: string | undefined): UndoKind | undefined {
  if (typeof command !== "string") return undefined;
  const c = command.toLowerCase();
  if (/\bgit\s+reset\b/.test(c) && /--hard\b/.test(c)) return "reset-hard";
  if (/\bgit\s+revert\b/.test(c)) return "revert";
  if (/\bgit\s+clean\b/.test(c)) return "clean";
  if (/\bgit\s+restore\b/.test(c)) return "restore";
  // `git checkout -- <path>` or `git checkout .` is a file restore (not a branch switch).
  if (/\bgit\s+checkout\s+(--\s|\.(\s|$))/.test(c)) return "restore";
  return undefined;
}

/** Verification-run classifications. Coarse on purpose — counts only, low stakes. */
type VerificationKind = "test" | "build" | "typecheck" | "lint";

/**
 * Classify a Bash command string into a verification kind, or null when it is not
 * a recognized verification command. PURE + content-free output: the command
 * string is the input only — the caller discards it and emits just the enum.
 * Order matters (typecheck/test/lint before the broad `build`). Tool-agnostic so
 * any adapter that surfaces a raw command (verificationCommand) reuses it.
 */
export function classifyVerification(command: string): VerificationKind | null {
  const c = command.toLowerCase();
  if (
    /\b(vitest|jest|pytest|mocha|ava|rspec|phpunit|cargo test|go test)\b/.test(c) ||
    /\b(npm|pnpm|yarn|bun)( run)? test\b/.test(c)
  )
    return "test";
  if (/\b(tsc|typecheck|type-check|mypy|pyright|tsd)\b/.test(c)) return "typecheck";
  if (
    /\b(eslint|biome|ruff|golangci-lint|clippy|rubocop|flake8|stylelint)\b/.test(c) ||
    /\bprettier\b.*--check\b/.test(c) ||
    /\b(npm|pnpm|yarn|bun)( run)? lint\b/.test(c)
  )
    return "lint";
  if (/\b(webpack|rollup|esbuild|vite build|cargo build|go build|make)\b/.test(c) || /\b(npm|pnpm|yarn|bun)( run)? build\b/.test(c))
    return "build";
  return null;
}

/**
 * Classify a tool.call's verification command (carried on the canonical input by
 * the adapter) and read its pass/fail, returning counts-only metadata. The
 * command lives ONLY as the classifier input here and is never put on the event
 * (the emit-allowlist is the backstop).
 *
 * A RATE NEEDS BOTH LEGS. `passed` is derived in priority order:
 *
 *   1. `verificationResult` — an explicit exit code / success from the adapter.
 *      No Claude Code version has ever supplied one (0 hits across 5,148 local
 *      transcripts; the only exit_code-bearing payload in this repo is a test
 *      fixture), but a future one might, and an explicit result always wins.
 *   2. `errored` — the which-hook-fired signal. Claude Code fires PostToolUse
 *      ONLY on exit 0 and routes a non-zero exit to the separate
 *      PostToolUseFailure event (anthropics/claude-code#6371 asked for the
 *      opposite and was closed "not planned"). So `errored === false` means the
 *      command exited 0: a real, observed PASS.
 *   3. Otherwise unknown, and the run is excluded from the denominator.
 *
 * ADAPTER INVARIANT (load-bearing, multi-tool): an adapter may set `errored` on a
 * tool call ONLY if it can observe BOTH legs for that call. Setting it when only
 * the failure leg is observable pins the pass-rate at 0 (which is what shipped
 * here until 2026-07-09: 3,034 passing runs carried no `verificationPassed` at
 * all, against 37 recorded failures). Setting it when only the SUCCESS leg is
 * observable is worse: it pins the rate at 100% and fabricates a green board.
 * Codex is exactly that hazard — its PostToolUse fires only on success and it has
 * no failure hook, and its passive `function_call_output` carries no exit code at
 * all (0 markers across 2,475 real outputs). A Codex adapter must therefore leave
 * `errored` UNDEFINED for shell calls, and may set it only for the tool families
 * where both legs exist (apply_patch `success`, MCP `result.Ok.isError`).
 */
function classifyVerificationCall(
  input: CanonicalInput,
): { kind: VerificationKind; passed: boolean | undefined } | undefined {
  const command = input.verificationCommand;
  if (typeof command !== "string") return undefined;
  const kind = classifyVerification(command); // command read + discarded here
  if (!kind) return undefined;

  let passed: boolean | undefined;
  if (typeof input.verificationResult === "boolean") passed = input.verificationResult;
  else if (input.errored === true) passed = false;
  else if (input.errored === false) passed = true;
  // else: the adapter cannot observe this call's result → unknown (honest),
  // excluded from both numerator and denominator. Never a fabricated pass.

  return { kind, passed };
}

/**
 * toSessionNotification(input) — the live-ambient "needs you" signal, built
 * from the Claude Code `Notification` hook. ENUM ONLY: it carries the
 * notificationType (permission_prompt | idle_prompt | other) and NOTHING else from the
 * notification — the `message` text is CONTENT and is never read or emitted (the
 * emit-allowlist is the runtime backstop). undefined when the payload omits a session
 * id or a notification type (the builder never fabricates one).
 */
export function toSessionNotification(
  input: CanonicalInput,
): SessionNotificationEvent | undefined {
  if (!input.sessionId || !input.notificationType) return undefined;
  return {
    kind: "session.notification",
    eventId: newEventId(),
    sessionId: input.sessionId,
    at: nowIso(),
    notificationType: input.notificationType,
  };
}

/**
 * toSessionPrompt(input) — the human-steering tick (CAPTURE-FOUNDATION ADR-CF8),
 * built from the UserPromptSubmit hook. ENVELOPE ONLY: it mints an eventId +
 * timestamp and copies the sessionId — the prompt TEXT is CONTENT and is never
 * read (the input carries `prompt` but nothing reads it; the emit envelope-only
 * key-check is the runtime backstop). undefined when the payload omits a session id.
 */
export function toSessionPrompt(input: CanonicalInput): SessionPromptEvent | undefined {
  if (!input.sessionId) return undefined;
  return {
    kind: "session.prompt",
    eventId: newEventId(),
    sessionId: input.sessionId,
    at: nowIso(),
  };
}

export function toSessionEnd(input: CanonicalInput): SessionEvent | undefined {
  if (!input.sessionId || input.phase !== "end") return undefined;
  return {
    kind: "session.end",
    eventId: newEventId(),
    sessionId: input.sessionId,
    at: nowIso(),
    // The adapter already mapped the native reason to the SessionEndEvent enum;
    // default to "other" (a real bucket) when absent.
    reason: parseReason(input.endReason),
  };
}

/**
 * toGitMomentum(input) — a repo-scoped GitMomentumEvent built from input.cwd via
 * git.ts, or undefined when momentum is disabled (SEORAK_MOMENTUM=0) or the cwd
 * is not a git repo (gitContext === "no-repo"). COUNTS + ids/enum only; no path
 * or content. Appended alongside session.start by the session-start hook.
 */
export function toGitMomentum(input: CanonicalInput): GitMomentumEvent | undefined {
  if (!input.sessionId || input.phase !== "start") return undefined;
  const cwd = input.cwd ?? process.cwd();
  return buildGitMomentum(cwd, input.sessionId, newEventId(), nowIso());
}

/**
 * Remember the session's start HEAD + git context in a LOCAL cursor so the
 * session.end hook can compute the session-bounded delta. Side-effect only (no
 * event); the stored sha never ships. Gated by SEORAK_MOMENTUM and a session id.
 */
export function recordSessionStartGit(input: CanonicalInput): void {
  if (!momentumEnabled() || !input.sessionId) return;
  writeSessionStartGit(input.sessionId, input.cwd ?? process.cwd());
}

/**
 * toSessionDelta(input) — the session-bounded git delta event (item 3), built at
 * session.end from the start cursor + the end working-tree state. undefined when
 * momentum is disabled, cwd is not a repo, or identity is unresolvable. COUNTS +
 * ids/enum only — no sha, no path, no diff.
 */
export function toSessionDelta(input: CanonicalInput): SessionDeltaEvent | undefined {
  if (!momentumEnabled() || !input.sessionId) return undefined;
  const cwd = input.cwd ?? process.cwd();
  const identity = repoIdentity(cwd);
  const counts = captureSessionDelta(cwd, input.sessionId);
  if (!identity || !counts) return undefined;
  return {
    kind: "session.delta",
    eventId: newEventId(),
    sessionId: input.sessionId,
    at: nowIso(),
    repoId: identity.repoId,
    repoLabel: identity.repoLabel,
    gitContext: counts.gitContext,
    startGitContext: counts.startGitContext,
    headMoved: counts.headMoved,
    filesTouchedUncommitted: counts.filesTouchedUncommitted,
    linesAddedUncommitted: counts.linesAddedUncommitted,
    linesDeletedUncommitted: counts.linesDeletedUncommitted,
    generatedLinesExcludedUncommitted: counts.generatedLinesExcludedUncommitted,
    ...(counts.commitsLanded === undefined ? {} : { commitsLanded: counts.commitsLanded }),
  };
}

/**
 * Map a SessionEnd reason straight through when recognized, else DEFAULT to
 * "other" (a real bucket, never a fabricated value). The adapter already mapped
 * the native value to this enum; this is the builder-side safety net for an
 * unrecognized value. LIFECYCLE only — never a quality signal.
 */
function parseReason(raw: string | undefined): import("@seorak/types").SessionEndEvent["reason"] {
  switch (raw) {
    case "clear":
    case "resume":
    case "logout":
    case "prompt_input_exit":
    case "bypass_permissions_disabled":
    case "other":
      return raw;
    default:
      return "other";
  }
}

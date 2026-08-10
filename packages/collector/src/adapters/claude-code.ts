/**
 * adapters/claude-code.ts — the Claude Code adapter.
 *
 * ALL Claude-Code-specific parsing lives here (it used to be inlined in
 * hooks.ts). It maps the raw Claude Code hook stdin payload onto the tool-
 * agnostic CanonicalInput the builders consume. The mappings this adapter owns:
 *
 *   - hook_event_name → CanonicalPhase
 *       SessionStart                 → "start"
 *       PostToolUse                  → "toolUse"
 *       PostToolUseFailure           → "toolUseFailure"
 *       SessionEnd                   → "end"
 *       (anything else)              → "toolUse" if a tool_name is present, else
 *                                      best-effort; the builder still gates on
 *                                      session_id + tool_name.
 *   - errored = (hook_event_name === "PostToolUseFailure") — the ONLY use of the
 *     failure event, with ZERO output parsing (tool_error is CONTENT, never read).
 *   - the SessionEnd reason enum is mapped to the SessionEndEvent values here
 *     (recognized straight through, unknown → "other").
 *   - the Bash verification command is extracted from tool_input.command and the
 *     pass/fail is derived defensively from tool_response.exit_code / .success.
 *     The command string is carried on the canonical input ONLY so the builder's
 *     classifier can read it; it is classified then discarded, never emitted.
 *
 * CONTENT (tool_input/tool_response/tool_error and anything nested) is READ-ONLY
 * here: nothing but the verification command/result is lifted onto the canonical
 * input, and even that is content-free by the time it reaches an event.
 */
import type { SessionEndEvent } from "@seorak/types";
import { captureSettings } from "../capture-settings.ts";
import { deriveFileIdentity } from "../file-id.ts";
import { sanitizeToolName } from "../tool-name.ts";
import {
  diffLineCounts,
  lineCount,
  sumEditLineCounts,
  type EditLineCounts,
} from "../edit-lines.ts";
import type { CanonicalInput } from "./types.ts";

/**
 * The raw Claude Code hook payload, widened to the documented field set the
 * collector reads. Mirrors the old hooks.ts HookInput — it now lives in the
 * adapter because it is Claude-Code-specific.
 */
export interface ClaudeCodeHookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  transcript_path?: string;
  reason?: string;
  /** Notification hook: the notification kind (e.g. "permission_prompt",
   *  "idle_prompt"). METADATA. The sibling `message` is CONTENT and is NEVER read. */
  notification_type?: string;
  /** CONTENT (PostToolUse / PostToolUseFailure tool arguments). READ-ONLY. */
  tool_input?: Record<string, unknown>;
  /** CONTENT (PostToolUse tool result). READ-ONLY. */
  tool_response?: Record<string, unknown>;
  /** CONTENT (PostToolUseFailure failure string). READ-ONLY — never read; errored
   *  keys off hook_event_name, not this field. */
  tool_error?: string;
  /** CONTENT (UserPromptSubmit prompt text — the densest content surface in the
   *  system). READ-ONLY and NEVER read: session.prompt is envelope-only, built
   *  from the phase alone. Declared so the boundary is explicit, not implicit. */
  prompt?: string;
}

/**
 * Map a Claude Code SessionEnd.reason straight through when recognized, else
 * DEFAULT to "other" (a real bucket, never a fabricated value). The six values
 * are the verbatim Claude Code enum.
 */
function mapReason(raw: string | undefined): SessionEndEvent["reason"] {
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

/** hook_event_name → canonical phase. PostToolUseFailure is its own phase so the
 *  builder can derive `errored` from the phase alone. */
function mapPhase(
  hookEventName: string | undefined,
): CanonicalInput["phase"] | undefined {
  switch (hookEventName) {
    case "SessionStart":
      return "start";
    case "SessionEnd":
      return "end";
    case "PostToolUseFailure":
      return "toolUseFailure";
    case "PostToolUse":
      return "toolUse";
    case "Notification":
      return "notification";
    case "UserPromptSubmit":
      // The prompt TEXT (input.prompt) is CONTENT and is NEVER read; the builder
      // mints an envelope-only session.prompt from the phase alone.
      return "userPrompt";
    default:
      return undefined;
  }
}

/** Map the Claude Code notification_type to the closed enum the event carries.
 *  permission_prompt = blocked on tool approval (the clean needs-you signal);
 *  idle_prompt = waiting at the prompt; anything else → "other". The `message`
 *  string is CONTENT and is never read here. */
function mapNotificationType(
  raw: string | undefined,
): "permission_prompt" | "idle_prompt" | "other" {
  switch (raw) {
    case "permission_prompt":
    case "idle_prompt":
      return raw;
    default:
      return "other";
  }
}

/**
 * Derive a Bash command's pass/fail defensively from the tool_response, matching
 * the old classifyBashVerification result logic: prefer exit_code (true result),
 * else `success`, else undefined (the builder then falls back to `errored`).
 * Returns undefined when no definitive result signal is present.
 */
function deriveVerificationResult(
  toolResponse: Record<string, unknown> | undefined,
): boolean | undefined {
  const resp = toolResponse ?? {};
  const exitCode = (resp as { exit_code?: unknown }).exit_code;
  const success = (resp as { success?: unknown }).success;
  if (typeof exitCode === "number") return exitCode === 0;
  if (typeof success === "boolean") return success;
  return undefined;
}

/**
 * Derive the line delta of a SUCCESSFUL edit-tool call from tool_input, reading
 * the edit strings locally and returning COUNTS only (CAPTURE-PRINCIPLE: derive
 * on machine, ship the derivation). Per tool:
 *
 *   Edit       — LCS line-diff of old_string → new_string. `replace_all` edits
 *                are counted as ONE occurrence (the file is never read, so the
 *                occurrence count is unknowable; one is the honest floor).
 *   MultiEdit  — the per-edit diffs summed.
 *   Write      — added = line count of the written content; removed = 0 (an
 *                overwrite's replaced content is not in the payload — unknowable
 *                without reading the file, which the collector never does).
 *   NotebookEdit — insert/replace count new_source lines as added; a replaced or
 *                deleted cell's old content is not in the payload, so removed
 *                stays 0. Delete-mode derives nothing.
 *
 * Returns undefined — never {0,0} — for non-edit tools and underivable payloads,
 * keeping the honest-empty contract (absent = unknown, 0 = a real zero).
 */
function deriveEditLines(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
): EditLineCounts | undefined {
  if (!toolName || !toolInput) return undefined;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  switch (toolName) {
    case "Edit": {
      const oldString = str(toolInput.old_string);
      const newString = str(toolInput.new_string);
      if (oldString === undefined || newString === undefined) return undefined;
      return diffLineCounts(oldString, newString);
    }
    case "MultiEdit": {
      const edits = toolInput.edits;
      if (!Array.isArray(edits)) return undefined;
      const parts: EditLineCounts[] = [];
      for (const edit of edits) {
        if (!edit || typeof edit !== "object") continue;
        const oldString = str((edit as Record<string, unknown>).old_string);
        const newString = str((edit as Record<string, unknown>).new_string);
        if (oldString === undefined || newString === undefined) continue;
        parts.push(diffLineCounts(oldString, newString));
      }
      return parts.length > 0 ? sumEditLineCounts(parts) : undefined;
    }
    case "Write": {
      const content = str(toolInput.content) ?? str(toolInput.file_text);
      if (content === undefined) return undefined;
      return { added: lineCount(content), removed: 0 };
    }
    case "NotebookEdit": {
      const mode = str(toolInput.edit_mode) ?? "replace";
      if (mode === "delete") return undefined;
      const newSource = str(toolInput.new_source);
      if (newSource === undefined) return undefined;
      return { added: lineCount(newSource), removed: 0 };
    }
    default:
      return undefined;
  }
}

/**
 * Parse one declared Claude Code hook payload into canonical metadata. Unknown
 * phases and malformed top-level values are dropped rather than guessed as tool
 * calls. Hook executables separately require the phase they were installed for.
 */
export function parseClaudeCodeHook(raw: unknown): CanonicalInput | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const input = raw as ClaudeCodeHookInput;
  const phase = mapPhase(input.hook_event_name);
  if (phase === undefined) return undefined;

  // The Bash verification command rides on the canonical input ONLY for the
  // classifier; lifted only for the Bash tool, never for any other call.
  const isBash = input.tool_name === "Bash";
  const rawCommand = isBash ? input.tool_input?.command : undefined;
  const verificationCommand = typeof rawCommand === "string" ? rawCommand : undefined;

  const canonical: CanonicalInput = {
    phase,
    // errored keys off the phase (PostToolUseFailure), ZERO output parsing.
    errored: phase === "toolUseFailure",
  };

  // Assign optional fields ONLY when present, so exactOptionalPropertyTypes never
  // sees an explicit `undefined` on an optional property.
  if (input.session_id !== undefined) canonical.sessionId = input.session_id;
  if (input.cwd !== undefined) canonical.cwd = input.cwd;
  // Sanitize the tool name to the closed emit set BEFORE it can reach an event:
  // a private `mcp__<server>__…` name folds to `mcp`, unknown names to `other`,
  // built-ins pass through (CAPTURE-FOUNDATION ADR-CF2). The RAW `input.tool_name`
  // is still used locally below (isBash, deriveEditLines, deriveFileIdentity).
  if (input.tool_name !== undefined) canonical.toolName = sanitizeToolName(input.tool_name);
  if (input.transcript_path !== undefined) canonical.transcriptPath = input.transcript_path;
  // Already mapped to the SessionEndEvent enum so the builder is tool-agnostic.
  if (phase === "end") canonical.endReason = mapReason(input.reason);
  // Notification kind (enum only; the message text is never read).
  if (phase === "notification") {
    canonical.notificationType = mapNotificationType(input.notification_type);
  }

  if (verificationCommand !== undefined) {
    canonical.verificationCommand = verificationCommand;
    const result = deriveVerificationResult(input.tool_response);
    if (result !== undefined) canonical.verificationResult = result;
  }

  // Line delta — successful edit-tool calls only (a failed edit never applied,
  // so its lines must not count). The edit strings are read by deriveEditLines
  // and discarded here; only the counts ride the canonical input. Gated by the
  // Data & capture toggle (local cache of the worker-served settings) — when
  // off, the strings are never even diffed.
  if (phase === "toolUse" && captureSettings().lineCounts) {
    const editLines = deriveEditLines(input.tool_name, input.tool_input);
    if (editLines !== undefined) canonical.editLines = editLines;
  }

  // Salted file identity — successful edit-family calls only (mirrors the
  // editLines gate: a failed edit never applied, so it is not file heat). The
  // path is read inside deriveFileIdentity and discarded; ids are 64-hex,
  // labels are basenames and ride only under the default-OFF fileLabels opt-in.
  if (phase === "toolUse" && captureSettings().fileSignals) {
    const file = deriveFileIdentity(
      input.tool_name,
      input.tool_input,
      captureSettings().fileLabels,
    );
    if (file !== undefined) canonical.file = file;
  }

  return canonical;
}

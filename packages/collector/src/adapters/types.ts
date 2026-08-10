/**
 * adapters/types.ts — the tool-agnostic CANONICAL input.
 *
 * Each capture source parses its native payload into normalized metadata before
 * lifecycle builders see it. Claude Code has a one-payload hook parser; Codex
 * has a streaming rollout parser and never passes through the hook path.
 *
 * CONTENT vs METADATA — the PRIVACY guardrail holds here too:
 *
 *   - `phase`, `sessionId`, `cwd`, `toolName`, `endReason`, and
 *     `transcriptPath` are METADATA: a phase enum, ids, a cwd consumed LOCALLY
 *     ONLY (git cwd + salted repoId/basename repoLabel derivation + repo
 *     registration — never emitted), an end-reason string, and a local file
 *     path read to extract token COUNTS.
 *   - `verificationCommand` is CONTENT (a raw shell command). It rides on the
 *     canonical input ONLY so the adapter's classifier can read it; the builder
 *     classifies it into an enum and DISCARDS the string. It is NEVER copied onto
 *     an event, and the emit.ts allowlist is the runtime backstop.
 *   - `errored` is a pure boolean derived by the adapter from its native failure
 *     signal (Claude Code: PostToolUseFailure) with ZERO output parsing.
 *
 * Honest-empty: a field the tool cannot supply is `undefined`, never a stand-in
 * value. The builders treat absent as unknown (e.g. an absent verification result
 * stays out of the pass-rate denominator).
 */

/** The lifecycle phase, normalized across tools. Each tool fires its own native
 *  hooks; the adapter maps them onto exactly these. */
export type CanonicalPhase =
  | "start"
  | "toolUse"
  | "toolUseFailure"
  | "end"
  | "notification"
  | "userPrompt";

/**
 * CanonicalInput — the normalized shape the lifecycle builders consume. Produced
 * by a capture-source parser; the builders NEVER see the raw tool payload.
 */
export interface CanonicalInput {
  /** Which lifecycle moment this is, normalized. */
  phase: CanonicalPhase;
  /** The session id from the tool, or undefined when the payload omits it (the
   *  builder mints one rather than dropping the event). */
  sessionId?: string;
  /** Working directory — consumed LOCALLY only: as a git cwd, to derive the
   *  session.start repoId (salted hash) + repoLabel (basename), and to register
   *  the repo for the daemon momentum sweep. The absolute path is NEVER emitted —
   *  session.start carries repoId + repoLabel, not the cwd. */
  cwd?: string;
  /** The tool/function name for a toolUse/toolUseFailure phase (Read/Edit/Bash…). */
  toolName?: string;
  /** Local transcript/log path the adapter reads to recover token COUNTS. Read
   *  for counts only; the path itself is never emitted. */
  transcriptPath?: string;
  /** SessionEnd reason, ALREADY mapped by the adapter to the SessionEndEvent enum
   *  (clear|resume|logout|prompt_input_exit|bypass_permissions_disabled|other). */
  endReason?: string;
  /** Whether THIS tool call failed, derived by the adapter from its native
   *  failure signal with zero output parsing. Absent when the phase is not a
   *  tool call. */
  errored?: boolean;
  /** A Bash/shell command string for verification classification. CONTENT —
   *  classified into an enum by the builder then discarded; NEVER emitted. Absent
   *  for tools that do not expose raw commands. */
  verificationCommand?: string;
  /** The tool call's pass/fail when the tool exposes a definitive result
   *  (exit code 0 / success boolean), used to set verificationPassed. Absent ⇒
   *  unknown; the builder falls back to `errored` then leaves it undefined. */
  verificationResult?: boolean;
  /** Line delta of an edit-tool call, ALREADY derived by the adapter from its
   *  native payload (edit-lines.ts: LCS diff of old/new strings, content line
   *  count for writes). COUNTS only — the strings were read locally and
   *  discarded inside the adapter; the builder copies these numbers onto the
   *  event verbatim. Absent — never {0,0} — for non-edit tools, failed calls
   *  (the edit never applied), and tools that cannot supply it. */
  editLines?: { added: number; removed: number };
  /** Salted file identity of an edit-family call, ALREADY derived by the
   *  adapter (file-id.ts: sha256(machine salt + path), labels = basenames only
   *  and only under the fileLabels opt-in). The path was read locally and
   *  discarded inside the adapter. Absent for non-edit tools, failed calls, and
   *  when the fileSignals toggle is off. */
  file?: {
    fileId: string;
    dirId: string;
    /** Coarse file kind (closed enum), derived from the discarded path. */
    fileCategory?: import("@seorak/types").FileCategory;
    /** Language family (closed enum), derived from the discarded path. */
    fileLanguage?: import("@seorak/types").FileLanguage;
    fileLabel?: string;
    dirLabel?: string;
  };
  /** Notification phase only: the kind of notification, mapped by the adapter to a
   *  closed enum. METADATA — the notification `message` is CONTENT and is never read
   *  or carried. Drives the live-ambient needs-you glance. */
  notificationType?: "permission_prompt" | "idle_prompt" | "other";
}

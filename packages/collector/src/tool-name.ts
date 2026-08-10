/**
 * tool-name.ts — sanitize a raw tool name into a CLOSED set before it is emitted
 * (CAPTURE-FOUNDATION ADR-CF2, the P0 boundary fix).
 *
 * Claude Code names MCP tools `mcp__<server>__<tool>`, where `<server>` is the
 * developer's OWN configured MCP server name — often a private/company-internal
 * string (e.g. `mcp__acmecorp_internal__deploy`). Today `tool.call.toolName` ships
 * that raw, next to the salted repoId + cost + timing: a company-name fingerprint
 * on every session. This collapses the value at the adapter to a closed known-tool
 * set, folds every `mcp__*` name to a single bounded `mcp` bucket, and drops any
 * other unknown name to `other`. The built-in tools every existing projection keys
 * on (Edit/Write/Bash/…) pass through unchanged. The raw string is read here and
 * discarded — only the closed value ships (emit.ts value-pins it as the backstop).
 */
import type { KnownToolName } from "@seorak/types";

/** The Claude Code built-in tools that pass through verbatim: the CLAUDE subset
 *  of `KnownToolName` (@seorak/types), deliberately NARROWER than that union and
 *  than emit.ts TOOL_NAMES (the emit value-pin is independent of this deriver by
 *  design). The Codex tokens `Shell` / `ApplyPatch` must NEVER be added here:
 *  this deriver runs on the Claude hook path, and passing them through would file
 *  Claude calls under Codex's names and merge the two tools' distributions that
 *  ADR-T5 keeps apart. Underinclusion only collapses a real built-in to `other`
 *  (a coarser bucket, never a break). */
const BUILTIN_TOOL_NAMES: ReadonlySet<KnownToolName> = new Set<KnownToolName>([
  "Task",
  "Bash",
  "BashOutput",
  "KillShell",
  "KillBash",
  "Glob",
  "Grep",
  "Read",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "ExitPlanMode",
  "SlashCommand",
  "ListMcpResources",
  "ReadMcpResource",
]);

/**
 * sanitizeToolName(raw) — map a raw tool name to the closed emit set:
 *   - a known built-in → itself (Edit/Write/Bash/…), so projections are unchanged.
 *   - `mcp__<server>__<tool>` → `"mcp"` (the private server name never ships).
 *   - anything else (a future built-in, a typo, a custom tool) → `"other"`.
 */
export function sanitizeToolName(raw: string): KnownToolName | "mcp" | "other" {
  if (BUILTIN_TOOL_NAMES.has(raw as KnownToolName)) return raw as KnownToolName;
  if (raw.startsWith("mcp__")) return "mcp";
  return "other";
}

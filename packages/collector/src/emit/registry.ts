/**
 * emit/registry.ts — THE registry. One allowlist per event kind, one closed set per
 * pinned value, and nothing else: this module is pure data with no control flow, so
 * "what may travel" can be read and audited in one place without reading a single
 * validator.
 *
 * Every closed set here is kept in LOCKSTEP with its @seorak/types enum, and the
 * emit layer stays deliberately INDEPENDENT of the derivation modules — a deriver bug
 * that lets a raw value through must fail loud in the validators, never ship.
 */
import {
  CAPABILITY_REGISTRY,
  COST_CAPABILITIES,
  COST_SCOPES,
  DURATION_CAPABILITIES,
  TOOL_RESULT_CAPABILITIES,
  USAGE_WINDOW_CAPABILITIES,
  type SessionEvent,
} from "@seorak/types";

/**
 * The closed set of agent ids that may travel on the wire.
 *
 * `AgentId` is deliberately OPEN in the type system (`"claude-code" | "codex" | (string &
 * {})`) so a half-built adapter can name itself without a types change. That openness is
 * fine for a type and unacceptable for a VALUE PIN: an un-pinned agent id on an emitted
 * event is a free-text channel out of the machine. The registry's own keys are the honest
 * closed set — an agent with no capability entry can report nothing anyway.
 */
export const AGENT_IDS: readonly string[] = Object.keys(CAPABILITY_REGISTRY);

/**
 * Per-kind allowlist of the EXACT permitted TOP-LEVEL keys. The common envelope
 * keys (kind, eventId, sessionId, at) are listed explicitly for every kind so
 * the deep-validator never needs a special case for them.
 */
export const EMIT_ALLOWLIST: Record<SessionEvent["kind"], readonly string[]> = {
  "session.start": ["kind", "eventId", "sessionId", "at", "repoId", "repoLabel", "agent", "agentVersion", "capabilities", "branchWorkType"],
  "tool.call": [
    "kind",
    "eventId",
    "sessionId",
    "at",
    "toolName",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "costUsd",
    "errored",
    "linesAdded",
    "linesRemoved",
    // Salted file identity (file-id.ts): 64-hex hashes only. The labels are
    // BASENAMES, present only under the default-OFF fileLabels opt-in — never
    // a path (the deep-validator can't tell a basename from a path, so the
    // basename-only contract is enforced at derivation, file-id.ts).
    "fileId",
    "dirId",
    // Coarse file kind: a CLOSED seven-value enum derived from the discarded
    // path (file-id.ts deriveFileCategory). Cannot reconstruct a name, so it
    // ships regardless of the fileLabels opt-in.
    "fileCategory",
    "fileLabel",
    "dirLabel",
    "models",
    "verificationKind",
    "verificationPassed",
    // Closed enums derived on-machine (CAPTURE-FOUNDATION): file language family
    // (fileSignals-gated) + within-session undo kind. Both value-pinned in the
    // validators.
    "fileLanguage",
    "undoKind",
  ],
  "session.end": ["kind", "eventId", "sessionId", "at", "reason"],
  // ENUM ONLY — the Claude Code notification `message` is CONTENT and must never be
  // emitted. notificationType is a closed enum.
  "session.notification": ["kind", "eventId", "sessionId", "at", "notificationType"],
  "git.momentum": [
    "kind",
    "eventId",
    "sessionId",
    "at",
    "repoId",
    "repoLabel",
    "gitContext",
    "windowDays",
    "commits",
    "filesTouched",
    "linesAdded",
    "linesDeleted",
    "generatedLinesExcluded",
    // Nested coarse repo shape (monorepo + size/age bands) — deep value-checked
    // by the git.momentum validator (the FIRST git.momentum deep branch).
    // CAPTURE-FOUNDATION ADR-CF7.
    "repoShape",
  ],
  "session.delta": [
    "kind",
    "eventId",
    "sessionId",
    "at",
    "repoId",
    "repoLabel",
    "gitContext",
    "startGitContext",
    "commitsLanded",
    "headMoved",
    "filesTouchedUncommitted",
    "linesAddedUncommitted",
    "linesDeletedUncommitted",
    "generatedLinesExcludedUncommitted",
  ],
  // On-branch line-survival. `git blame --porcelain` is the densest content surface in
  // the collector (line text, author, email, commit message, path), so EVERY value here
  // is magnitude/enum-checked by the session.linesurvival validator.
  //
  // It was FLAT, and the stated reason was that "a nested object/array would be
  // UNGUARDED here". `commits[]` (HEAD-TO-HEAD ADR-H4) is the one exception, and it is
  // allowed ONLY because the guard now exists: every item key is pinned to
  // LINE_SURVIVAL_COMMIT_ALLOWLIST, its `id` is pinned to a 64-hex salted hash (never a
  // sha), and its three counts are pinned to non-negative ints with the
  // `authored + contested <= added` invariant. Same posture as tool.call.models[].
  // The rule was never "flat"; it was "nothing unguarded". That rule still holds.
  "session.linesurvival": [
    "kind",
    "eventId",
    "sessionId",
    "at",
    "repoId",
    "repoLabel",
    "gitContext",
    "rung",
    "fate",
    "commitsChecked",
    "linesAuthored",
    "linesSurviving",
    "commits",
    "filesGoneFromTip",
  ],
  // Repo toolchain identity (CAPTURE-FOUNDATION ADR-CF3): salted id + enums only.
  // packageManager/framework are enum-or-null value-pinned; repoLabel is a
  // basename left UNPINNED (content-free by derivation, repoLabels-gated), same
  // provenance contract as session.linesurvival.
  "repo.toolchain": [
    "kind",
    "eventId",
    "sessionId",
    "at",
    "repoId",
    "repoLabel",
    "gitContext",
    "packageManager",
    "framework",
  ],
  // Human-steering tick (CAPTURE-FOUNDATION ADR-CF8): ENVELOPE ONLY. The prompt
  // TEXT is never read or emitted — this envelope-only key-check IS the backstop
  // (any extra key throws), so no value branch is needed.
  "session.prompt": ["kind", "eventId", "sessionId", "at"],
  // Session-scoped cumulative token usage (CODEX-CAPTURE ADR-C2). `models` is a nested
  // array, so the top-level key-check cannot see inside it: the session.tokens validator
  // pins every item's keys, VALUE-pins the model id to a shape (it is the one string
  // that travels from a tailed rollout file, and it keys the pricing table), and
  // requires every token count to be a non-negative integer.
  "session.tokens": ["kind", "eventId", "sessionId", "at", "models"],
  // Provider-given account quota (CODEX-CAPTURE ADR-C15). Its OWN kind rather than a key
  // on `session.tokens`, which is where it looks like it belongs: both facts arrive on the
  // same `token_count` row, but `session.tokens` refuses to emit on five guards that exist
  // for TOKEN reasons (chiefly "no token movement"), and riding it would have silently
  // dropped 26.1% of quota readings — measured, not feared.
  //
  // `windows` is a nested array, so the top-level key-check cannot see inside it: the
  // agent.quota validator pins every item's keys and every value's magnitude. `tool` is
  // VALUE-pinned to the closed agent enum. Numbers and a closed id only, no content.
  "agent.quota": ["kind", "eventId", "sessionId", "at", "tool", "windows"],
} as const;

/** The CLOSED key set of an `agent.quota.windows[]` item. Mirrors MODEL_ITEM_ALLOWLIST:
 *  the top-level key-check cannot see INSIDE an array, so an item key that is not here
 *  throws. Nothing from `rate_limits` travels except these three numbers, so `plan_type`,
 *  `credits.balance`, `limit_id` and any field a future Codex adds stay on the machine
 *  unless someone deliberately widens this list. */
export const QUOTA_WINDOW_ALLOWLIST: readonly string[] = ["windowMinutes", "usedPercent", "resetsAt"];

/** The CLOSED key set of a `session.linesurvival.commits[]` item (ADR-H4). Mirrors
 *  MODEL_ITEM_ALLOWLIST: the top-level key-check cannot see INSIDE an array, so an item
 *  key that is not here throws. `id` is a salted commit hash, never a sha. */
export const LINE_SURVIVAL_COMMIT_ALLOWLIST: readonly string[] = ["id", "added", "contested", "authored"];

/** A 64-hex salted hash (repoId / fileId / commit id). Pins `commits[].id` so a raw sha —
 *  a globally-correlatable fingerprint that would defeat the salted repoId — can never
 *  ride out on this event, even by mistake. A 40-hex sha fails this check. */
export const SALTED_HASH_RE = /^[0-9a-f]{64}$/;

/** The closed enums the line-survival deep-validate pins (kept in lockstep with
 *  @seorak/types LineSurvivalFate / LineSurvivalRung / GitContext). */
export const LINE_SURVIVAL_FATES: readonly string[] = ["retained", "overwritten", "unreachable", "unknown"];
export const LINE_SURVIVAL_RUNGS: readonly string[] = ["3d"];
export const GIT_CONTEXTS: readonly string[] = ["no-repo", "detached", "dirty-at-start", "no-remote", "clean"];

/** The CLOSED tool.call.toolName value set (CAPTURE-FOUNDATION ADR-CF2, the P0
 *  leak fix): the Claude Code built-ins, the two Codex tokens (`Shell` /
 *  `ApplyPatch` — DISTINCT from Bash/Edit so two tools' distributions never
 *  merge), plus the `mcp` bucket (every private
 *  `mcp__<server>__…` name collapses here) and `other`. Kept in lockstep with
 *  @seorak/types `KnownToolName`; tool-name.ts passes through only the CLAUDE
 *  subset. The validator is deliberately INDEPENDENT of the derivers — a
 *  deriver bug that lets a raw name through must fail loud THERE, never ship. */
export const TOOL_NAMES: readonly string[] = [
  "Task", "Bash", "BashOutput", "KillShell", "KillBash", "Glob", "Grep", "Read",
  "Edit", "MultiEdit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "TodoWrite",
  "ExitPlanMode", "SlashCommand", "ListMcpResources", "ReadMcpResource",
  "Shell", "ApplyPatch",
  "mcp", "other",
];

// CAPTURE-FOUNDATION closed-enum constants. Each is kept in LOCKSTEP with its
// @seorak/types enum; the emit validators stay INDEPENDENT of the derivation
// modules (a deriver bug must fail loud there, never ship a raw value).
export const PACKAGE_MANAGERS: readonly string[] = [
  "npm", "pnpm", "yarn", "bun", "pip", "poetry", "uv", "pipenv",
  "cargo", "gomod", "bundler", "composer", "maven", "gradle",
];
export const FRAMEWORKS: readonly string[] = [
  "next", "nuxt", "remix", "sveltekit", "astro", "react", "vue", "svelte",
  "angular", "solid", "expo", "react-native", "electron", "express", "fastify",
  "nest", "django", "flask", "fastapi", "rails", "laravel", "spring",
];
export const FILE_LANGUAGES: readonly string[] = [
  "typescript", "javascript", "python", "rust", "go", "java", "kotlin", "swift",
  "c", "cpp", "csharp", "ruby", "php", "shell", "lua", "html", "css", "sql",
  "markdown", "json", "yaml", "toml", "vue", "svelte",
];
export const BRANCH_WORK_TYPES: readonly string[] = ["feature", "fix", "refactor", "chore", "other"];
export const UNDO_KINDS: readonly string[] = ["reset-hard", "restore", "clean", "revert"];
export const REPO_SIZE_BANDS: readonly string[] = ["xs", "s", "m", "l", "xl"];
export const REPO_AGE_BANDS: readonly string[] = ["new", "recent", "established", "mature"];
/** The EXACT permitted keys on a git.momentum.repoShape nested object. */
export const REPO_SHAPE_ALLOWLIST: readonly string[] = ["monorepo", "sizeBand", "ageBand"];

/**
 * Allowed keys for each item in ToolCallEvent.models[]. The only nested object
 * array any event emits. Anything else on a model item is rejected.
 */
export const MODEL_ITEM_ALLOWLIST: readonly string[] = [
  "model",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
] as const;

/**
 * Allowed keys on a `session.tokens.models[]` item (CODEX-CAPTURE ADR-C2). Deliberately
 * NOT MODEL_ITEM_ALLOWLIST: there is no `costUsd` here, because the worker prices this
 * carrier from the shared table rather than trusting a number the collector baked in.
 */
export const SESSION_TOKENS_MODEL_ALLOWLIST: readonly string[] = [
  "model",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

/**
 * The shape a model id must have to reach the wire. `turn_context.model` is free text
 * in a file we tail, and unlike every other lifted field it is neither a count nor a
 * closed enum nor a salted hash — it is a vendor string that we then look up in the
 * pricing table. The adapter pins it and this is the runtime backstop, so a rollout
 * whose `model` grew into a path, a prompt, or anything else cannot ship it.
 * All six ids in the local corpus pass (gpt-5.6-sol, gpt-5.5, gpt-5.4-mini, gpt-5.4,
 * gpt-5.1-codex, gpt-5-codex).
 */
export const MODEL_ID_SHAPE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/**
 * The shape an agentVersion must have to reach the wire. Claude Code's builder
 * ships process.env.CLAUDE_CODE_VERSION verbatim, an env var anyone can set to
 * anything, so without a pin it is a free-text channel out of the machine. Same
 * discipline as the codex adapter's sanitizeVersion (which pins its own leg at
 * derivation); this is the runtime backstop for every adapter.
 *
 * Exported through emit.ts so the Claude-Code derivation (hooks.ts) can degrade a
 * malformed env value to "unknown" against the EXACT pin the tripwire enforces — one
 * constant, so the derivation and the backstop can never drift.
 */
export const AGENT_VERSION_SHAPE = /^[0-9A-Za-z._+-]{1,64}$/;

/**
 * Allowed keys on the SessionStartEvent.capabilities object — the only nested
 * object on session.start. Anything else (a path, a model string, any content) is
 * rejected by the session.start validator.
 *
 * Two of these are closed string ENUMS rather than booleans, so the validator
 * value-pins them via CAPABILITY_ENUMS below (the `BRANCH_WORK_TYPES` pattern).
 * Widening this array alone is NOT enough: the validator's `typeof value !==
 * "boolean"` check would still throw on the enum strings, and without a value pin a
 * typo like `cost: "estimate"` would ship, which defeats the point of an allowlist.
 */
export const CAPABILITIES_ALLOWLIST: readonly string[] = [
  "hasTokens",
  "hasCacheTokens",
  "cost",
  "toolResult",
  "endReason",
  "duration",
  "verification",
  "costScope",
  "usageWindow",
] as const;

/** Keys on `capabilities` whose value is a closed string enum, not a boolean. */
export const CAPABILITY_ENUMS: Readonly<Record<string, readonly string[]>> = {
  cost: COST_CAPABILITIES,
  toolResult: TOOL_RESULT_CAPABILITIES,
  duration: DURATION_CAPABILITIES,
  verification: TOOL_RESULT_CAPABILITIES,
  // Widening CAPABILITIES_ALLOWLIST alone is NOT enough: the validator's
  // `typeof value !== "boolean"` check would throw on the enum string. A value pin is
  // what stops a typo like `costScope: "sesion"` from shipping and silently reverting a
  // session-costed tool to per-call reads.
  costScope: COST_SCOPES,
  // Same rule. A typo like `usageWindow: "rato"` would fall back to "none" at the
  // resolver and silently erase the tool's gauge, with no error anywhere.
  usageWindow: USAGE_WINDOW_CAPABILITIES,
};

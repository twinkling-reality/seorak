/**
 * Publish-safe runtime contract for collector -> worker event ingestion.
 *
 * The TypeScript interfaces in events.ts protect code we compile together. This
 * module protects the HTTP boundary, old local logs, and independently upgraded
 * collectors. It contains only public wire shapes and resource limits: no
 * secrets, thresholds, or worker-only behavior.
 */
import { z } from "zod";
import { EVENT_BATCH_SCHEMA_VERSION } from "./event-protocol.ts";
import { SESSION_END_REASONS, type EventBatch, type SessionEvent } from "./events.ts";

export { EVENT_BATCH_SCHEMA_VERSION } from "./event-protocol.ts";
export const EVENT_BATCH_EVENT_LIMIT = 128;
export const EVENT_BATCH_BYTE_LIMIT = 524_288;
export const EVENT_MODEL_LIMIT = 16;
export const EVENT_QUOTA_WINDOW_LIMIT = 8;
export const EVENT_LINE_SURVIVAL_COMMIT_LIMIT = 100;

export const EVENT_STRING_LIMITS = {
  id: 256,
  label: 255,
  agent: 64,
  version: 64,
  model: 64,
  timestamp: 64,
} as const;

const nonNegativeInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveInt = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const nonNegativeNumber = z.number().min(0).max(Number.MAX_SAFE_INTEGER);
const boundedId = z.string().min(1).max(EVENT_STRING_LIMITS.id);
// basename("/") and a missing cwd can honestly produce an empty display
// label. The field remains present and bounded; consumers already render ids as
// the fallback rather than inventing a name.
const boundedLabel = z
  .string()
  .max(EVENT_STRING_LIMITS.label)
  .refine((value) => !value.includes("/") && !value.includes("\\"));
const boundedAgent = z
  .string()
  .min(1)
  .max(EVENT_STRING_LIMITS.agent)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const timestamp = z
  .iso
  .datetime({ offset: true })
  .max(EVENT_STRING_LIMITS.timestamp);
const modelId = z
  .string()
  .min(1)
  .max(EVENT_STRING_LIMITS.model)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const agentVersion = z
  .string()
  .min(1)
  .max(EVENT_STRING_LIMITS.version)
  .regex(/^[0-9A-Za-z._+-]+$/);
const saltedHash = z.string().regex(/^[0-9a-f]{64}$/);

const gitContext = z.enum([
  "no-repo",
  "clean",
  "dirty-at-start",
  "detached",
  "no-remote",
]);

const envelope = {
  eventId: boundedId,
  sessionId: boundedId,
  at: timestamp,
} as const;

const capabilitiesSchema = z
  .object({
    hasTokens: z.boolean(),
    hasCacheTokens: z.boolean(),
    cost: z.enum(["billed", "estimated", "none"]),
    toolResult: z.enum(["both", "failures-only", "passes-only", "none"]),
    endReason: z.boolean().optional(),
    duration: z.enum(["measured", "inferred"]).optional(),
    verification: z.enum(["both", "failures-only", "passes-only", "none"]).optional(),
    costScope: z.enum(["call", "session"]).optional(),
    usageWindow: z.enum(["count", "ratio", "none"]).optional(),
  })
  .strict();

const toolModelSchema = z
  .object({
    model: modelId,
    inputTokens: nonNegativeInt,
    outputTokens: nonNegativeInt,
    cacheReadTokens: nonNegativeInt,
    cacheWriteTokens: nonNegativeInt,
    costUsd: nonNegativeNumber,
  })
  .strict();

const sessionTokenModelSchema = z
  .object({
    model: modelId,
    inputTokens: nonNegativeInt,
    outputTokens: nonNegativeInt,
    cacheReadTokens: nonNegativeInt,
    cacheWriteTokens: nonNegativeInt,
  })
  .strict();

const lineSurvivalCommitSchema = z
  .object({
    id: saltedHash,
    added: nonNegativeInt,
    contested: nonNegativeInt,
    authored: nonNegativeInt,
  })
  .strict()
  .refine((commit) => commit.authored + commit.contested <= commit.added);

export const SessionStartEventSchema = z
  .object({
    kind: z.literal("session.start"),
    ...envelope,
    repoId: saltedHash,
    repoLabel: boundedLabel,
    agent: boundedAgent,
    agentVersion,
    capabilities: capabilitiesSchema.optional(),
    branchWorkType: z.enum(["feature", "fix", "refactor", "chore", "other"]).optional(),
  })
  .strict();

export const ToolCallEventSchema = z
  .object({
    kind: z.literal("tool.call"),
    ...envelope,
    toolName: z.enum([
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
      "Shell",
      "ApplyPatch",
      "mcp",
      "other",
    ]),
    inputTokens: nonNegativeInt,
    outputTokens: nonNegativeInt,
    cacheReadTokens: nonNegativeInt,
    cacheWriteTokens: nonNegativeInt,
    costUsd: nonNegativeNumber,
    errored: z.boolean().optional(),
    models: z.array(toolModelSchema).min(1).max(EVENT_MODEL_LIMIT).optional(),
    linesAdded: nonNegativeInt.optional(),
    linesRemoved: nonNegativeInt.optional(),
    fileId: saltedHash.optional(),
    dirId: saltedHash.optional(),
    fileCategory: z
      .enum(["source", "test", "config", "styles", "docs", "data", "other"])
      .optional(),
    fileLabel: boundedLabel.optional(),
    dirLabel: boundedLabel.optional(),
    verificationKind: z.enum(["test", "build", "typecheck", "lint"]).optional(),
    verificationPassed: z.boolean().optional(),
    fileLanguage: z
      .enum([
        "typescript",
        "javascript",
        "python",
        "rust",
        "go",
        "java",
        "kotlin",
        "swift",
        "c",
        "cpp",
        "csharp",
        "ruby",
        "php",
        "shell",
        "lua",
        "html",
        "css",
        "sql",
        "markdown",
        "json",
        "yaml",
        "toml",
        "vue",
        "svelte",
      ])
      .optional(),
    undoKind: z.enum(["reset-hard", "restore", "clean", "revert"]).optional(),
  })
  .strict();

export const SessionEndEventSchema = z
  .object({
    kind: z.literal("session.end"),
    ...envelope,
    reason: z.enum(SESSION_END_REASONS),
  })
  .strict();

export const SessionNotificationEventSchema = z
  .object({
    kind: z.literal("session.notification"),
    ...envelope,
    notificationType: z.enum(["permission_prompt", "idle_prompt", "other"]),
  })
  .strict();

export const GitMomentumEventSchema = z
  .object({
    kind: z.literal("git.momentum"),
    ...envelope,
    repoId: saltedHash,
    repoLabel: boundedLabel,
    gitContext,
    windowDays: positiveInt,
    commits: nonNegativeInt,
    filesTouched: nonNegativeInt,
    linesAdded: nonNegativeInt,
    linesDeleted: nonNegativeInt,
    generatedLinesExcluded: nonNegativeInt,
    repoShape: z
      .object({
        monorepo: z.boolean(),
        sizeBand: z.enum(["xs", "s", "m", "l", "xl"]),
        ageBand: z.enum(["new", "recent", "established", "mature"]),
      })
      .strict()
      .optional(),
  })
  .strict();

export const SessionDeltaEventSchema = z
  .object({
    kind: z.literal("session.delta"),
    ...envelope,
    repoId: saltedHash,
    repoLabel: boundedLabel,
    gitContext,
    startGitContext: gitContext,
    commitsLanded: nonNegativeInt.optional(),
    headMoved: z.boolean(),
    filesTouchedUncommitted: nonNegativeInt,
    linesAddedUncommitted: nonNegativeInt,
    linesDeletedUncommitted: nonNegativeInt,
    generatedLinesExcludedUncommitted: nonNegativeInt,
  })
  .strict();

export const SessionLineSurvivalEventSchema = z
  .object({
    kind: z.literal("session.linesurvival"),
    ...envelope,
    repoId: saltedHash,
    repoLabel: boundedLabel.optional(),
    gitContext,
    rung: z.literal("3d"),
    fate: z.enum(["retained", "overwritten", "unreachable", "unknown"]),
    commitsChecked: positiveInt,
    linesAuthored: nonNegativeInt,
    linesSurviving: nonNegativeInt,
    commits: z
      .array(lineSurvivalCommitSchema)
      .min(1)
      .max(EVENT_LINE_SURVIVAL_COMMIT_LIMIT)
      .optional(),
    filesGoneFromTip: nonNegativeInt.optional(),
  })
  .strict()
  .refine((event) => event.linesSurviving <= event.linesAuthored);

export const RepoToolchainEventSchema = z
  .object({
    kind: z.literal("repo.toolchain"),
    ...envelope,
    repoId: saltedHash,
    repoLabel: boundedLabel.optional(),
    gitContext,
    packageManager: z
      .enum([
        "npm",
        "pnpm",
        "yarn",
        "bun",
        "pip",
        "poetry",
        "uv",
        "pipenv",
        "cargo",
        "gomod",
        "bundler",
        "composer",
        "maven",
        "gradle",
      ])
      .nullable(),
    framework: z
      .enum([
        "next",
        "nuxt",
        "remix",
        "sveltekit",
        "astro",
        "react",
        "vue",
        "svelte",
        "angular",
        "solid",
        "expo",
        "react-native",
        "electron",
        "express",
        "fastify",
        "nest",
        "django",
        "flask",
        "fastapi",
        "rails",
        "laravel",
        "spring",
      ])
      .nullable(),
  })
  .strict();

export const SessionPromptEventSchema = z
  .object({
    kind: z.literal("session.prompt"),
    ...envelope,
  })
  .strict();

export const SessionTokensEventSchema = z
  .object({
    kind: z.literal("session.tokens"),
    ...envelope,
    models: z.array(sessionTokenModelSchema).min(1).max(EVENT_MODEL_LIMIT),
  })
  .strict();

export const AgentQuotaEventSchema = z
  .object({
    kind: z.literal("agent.quota"),
    ...envelope,
    // AgentId is deliberately open in the wire contract so a new collector
    // adapter does not require a coordinated @seorak/types release.
    tool: boundedAgent,
    windows: z
      .array(
        z
          .object({
            windowMinutes: positiveInt,
            usedPercent: z.number().min(0).max(100),
            resetsAt: timestamp,
          })
          .strict(),
      )
      .min(1)
      .max(EVENT_QUOTA_WINDOW_LIMIT),
  })
  .strict();

/**
 * Keep the runtime schema inventory compile-exhaustive with SessionEvent.
 * Adding or removing an event kind in events.ts must update this map.
 */
export const SESSION_EVENT_SCHEMAS = {
  "session.start": SessionStartEventSchema,
  "tool.call": ToolCallEventSchema,
  "session.end": SessionEndEventSchema,
  "session.notification": SessionNotificationEventSchema,
  "git.momentum": GitMomentumEventSchema,
  "session.delta": SessionDeltaEventSchema,
  "session.linesurvival": SessionLineSurvivalEventSchema,
  "repo.toolchain": RepoToolchainEventSchema,
  "session.prompt": SessionPromptEventSchema,
  "session.tokens": SessionTokensEventSchema,
  "agent.quota": AgentQuotaEventSchema,
} as const satisfies Record<SessionEvent["kind"], z.ZodType>;

export const SESSION_EVENT_KINDS = Object.freeze(
  Object.keys(SESSION_EVENT_SCHEMAS) as SessionEvent["kind"][],
);

export const SessionEventSchema = z.discriminatedUnion("kind", [
  SessionStartEventSchema,
  ToolCallEventSchema,
  SessionEndEventSchema,
  SessionNotificationEventSchema,
  GitMomentumEventSchema,
  SessionDeltaEventSchema,
  SessionLineSurvivalEventSchema,
  RepoToolchainEventSchema,
  SessionPromptEventSchema,
  SessionTokensEventSchema,
  AgentQuotaEventSchema,
]);

/**
 * Strict envelope schema for staged server validation. Events remain unknown
 * here so the worker can distinguish a malformed envelope (400) from an invalid
 * event (422) without exposing validation details.
 */
export const EventBatchEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(EVENT_BATCH_SCHEMA_VERSION),
    collectorVersion: z.string().min(1).max(EVENT_STRING_LIMITS.version),
    deviceId: boundedId,
    events: z.array(z.unknown()).max(EVENT_BATCH_EVENT_LIMIT),
  })
  .strict();

export const EventBatchSchema = EventBatchEnvelopeSchema.extend({
  events: z.array(SessionEventSchema).max(EVENT_BATCH_EVENT_LIMIT),
}).strict();

/** Validate without ever turning Zod's paths or rejected values into output. */
export function parseSessionEvent(value: unknown): SessionEvent | null {
  const result = SessionEventSchema.safeParse(value);
  return result.success ? (result.data as SessionEvent) : null;
}

/** Accepts only the current, explicitly versioned wire envelope. */
export function parseEventBatch(value: unknown): EventBatch | null {
  const result = EventBatchSchema.safeParse(value);
  return result.success ? (result.data as EventBatch) : null;
}

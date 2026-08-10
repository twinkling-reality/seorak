/**
 * emit/validators.ts — the DEEP per-kind validators.
 *
 * `assertEmitSafe` (emit.ts) key-checks the top level against the registry. That check
 * cannot see INSIDE a nested object or array, and it says nothing about VALUES — so
 * every kind that carries either gets a validator here, and each one is a pure
 * function of the event that throws EmitAllowlistError or returns.
 *
 * The validators are keyed by kind and dispatched once, which is exactly what the
 * chain of mutually-exclusive `if (kind === …)` blocks did before: at most one ever
 * ran. Each function's internal check ORDER is load-bearing, because the message a
 * refusal produces is the record a redaction audit reads.
 *
 * A kind ABSENT from DEEP_VALIDATORS is not an oversight — it is the statement that
 * the top-level key-check is the whole guarantee for it (session.end,
 * session.notification, session.delta, session.prompt carry no nested shape and no
 * value the collector could smuggle content through).
 */
import { type SessionEvent } from "@seorak/types";
import { EVENT_LINE_SURVIVAL_COMMIT_LIMIT, EVENT_MODEL_LIMIT, EVENT_QUOTA_WINDOW_LIMIT } from "@seorak/types/event-validation";
import { EmitAllowlistError, isNonNegativeInt, isPlainObject } from "./guard.ts";
import {
  AGENT_IDS,
  AGENT_VERSION_SHAPE,
  BRANCH_WORK_TYPES,
  CAPABILITIES_ALLOWLIST,
  CAPABILITY_ENUMS,
  FILE_LANGUAGES,
  FRAMEWORKS,
  GIT_CONTEXTS,
  LINE_SURVIVAL_COMMIT_ALLOWLIST,
  LINE_SURVIVAL_FATES,
  LINE_SURVIVAL_RUNGS,
  MODEL_ID_SHAPE,
  MODEL_ITEM_ALLOWLIST,
  PACKAGE_MANAGERS,
  QUOTA_WINDOW_ALLOWLIST,
  REPO_AGE_BANDS,
  REPO_SHAPE_ALLOWLIST,
  REPO_SIZE_BANDS,
  SALTED_HASH_RE,
  SESSION_TOKENS_MODEL_ALLOWLIST,
  TOOL_NAMES,
  UNDO_KINDS,
} from "./registry.ts";

/**
 * What a validator actually receives: an event whose kind is already established and
 * whose top-level keys are already allowlisted, but whose VALUES are still untrusted.
 *
 * Typing it as a bag of unknowns rather than as the narrowed event is the honest
 * signature, and it is the point of the tripwire: the declared type is exactly the
 * thing under suspicion here. A validator that trusted `SessionEvent` would be
 * checking what the compiler already believes instead of what the data says.
 */
export type EmitCandidate = Record<string, unknown>;

/**
 * Deep-validate the only nested object on session.start: capabilities. Booleans,
 * plus two closed string enums — a smuggled path/model/content key, an
 * off-enum value, or a non-boolean where a boolean belongs, all throw. Then the two
 * free-text-shaped scalars: agentVersion (an env var read verbatim by hooks.ts) and
 * branchWorkType (a closed enum, never a branch name).
 */
function validateSessionStart(event: EmitCandidate): void {
  const capabilities = (event as { capabilities?: unknown }).capabilities;
  if (capabilities !== undefined) {
    if (!isPlainObject(capabilities)) {
      throw new EmitAllowlistError(`emit blocked: session.start capabilities is not an object`);
    }
    for (const [key, value] of Object.entries(capabilities)) {
      if (!CAPABILITIES_ALLOWLIST.includes(key)) {
        throw new EmitAllowlistError(
          `emit blocked: un-allowlisted key "${key}" on session.start capabilities`,
        );
      }
      const permitted = CAPABILITY_ENUMS[key];
      if (permitted) {
        // VALUE-pin the enum: a free string here could carry anything.
        if (typeof value !== "string" || !permitted.includes(value)) {
          throw new EmitAllowlistError(
            `emit blocked: capabilities.${key} ${JSON.stringify(value)} not in the closed enum`,
          );
        }
      } else if (typeof value !== "boolean") {
        throw new EmitAllowlistError(
          `emit blocked: capabilities.${key} must be a boolean`,
        );
      }
    }
  }

  // agentVersion VALUE-pin: a version-looking string, bounded length. The key
  // was allowlisted with no value check, and Claude Code fills it from an env
  // var read verbatim (hooks.ts).
  const agentVersion = (event as { agentVersion?: unknown }).agentVersion;
  if (
    agentVersion !== undefined &&
    (typeof agentVersion !== "string" || !AGENT_VERSION_SHAPE.test(agentVersion))
  ) {
    throw new EmitAllowlistError(
      `emit blocked: session.start agentVersion ${JSON.stringify(agentVersion)} is not a version shape`,
    );
  }

  // branchWorkType VALUE-pin (CAPTURE-FOUNDATION ADR-CF4): a closed enum, never
  // a branch name (the classifier discards the branch string on-machine).
  const branchWorkType = (event as { branchWorkType?: unknown }).branchWorkType;
  if (
    branchWorkType !== undefined &&
    (typeof branchWorkType !== "string" || !BRANCH_WORK_TYPES.includes(branchWorkType))
  ) {
    throw new EmitAllowlistError(
      `emit blocked: session.start branchWorkType ${JSON.stringify(branchWorkType)} not in the closed enum`,
    );
  }
}

/** Deep-validate the only nested object array on tool.call: models[], plus the three
 *  closed enums this kind carries. */
function validateToolCall(event: EmitCandidate): void {
  // toolName VALUE-pin (CAPTURE-FOUNDATION ADR-CF2): the raw name is sanitized
  // to a closed set at the adapter (tool-name.ts); this is the runtime backstop
  // that a private `mcp__<server>__…` / any raw name can never ship.
  const toolName = (event as { toolName?: unknown }).toolName;
  if (typeof toolName !== "string" || !TOOL_NAMES.includes(toolName)) {
    throw new EmitAllowlistError(
      `emit blocked: tool.call toolName ${JSON.stringify(toolName)} not in the closed set`,
    );
  }

  // fileLanguage / undoKind VALUE-pins (CAPTURE-FOUNDATION ADR-CF5/CF6): closed
  // enums derived-and-discarded on-machine (extension family / a discarded git
  // command). Fingerprint-sensitive enough to earn a value-check fileCategory
  // was allowed to skip.
  const fileLanguage = (event as { fileLanguage?: unknown }).fileLanguage;
  if (
    fileLanguage !== undefined &&
    (typeof fileLanguage !== "string" || !FILE_LANGUAGES.includes(fileLanguage))
  ) {
    throw new EmitAllowlistError(
      `emit blocked: tool.call fileLanguage ${JSON.stringify(fileLanguage)} not in the closed enum`,
    );
  }
  const undoKind = (event as { undoKind?: unknown }).undoKind;
  if (undoKind !== undefined && (typeof undoKind !== "string" || !UNDO_KINDS.includes(undoKind))) {
    throw new EmitAllowlistError(
      `emit blocked: tool.call undoKind ${JSON.stringify(undoKind)} not in the closed enum`,
    );
  }

  const models = (event as { models?: unknown }).models;
  if (models !== undefined) {
    if (!Array.isArray(models)) {
      throw new EmitAllowlistError(`emit blocked: tool.call models is not an array`);
    }
    if (models.length > EVENT_MODEL_LIMIT) {
      throw new EmitAllowlistError(
        `emit blocked: tool.call models exceeds the ${EVENT_MODEL_LIMIT} cap`,
      );
    }
    for (const item of models) {
      if (!isPlainObject(item)) {
        throw new EmitAllowlistError(`emit blocked: tool.call models item is not an object`);
      }
      for (const key of Object.keys(item)) {
        if (!MODEL_ITEM_ALLOWLIST.includes(key)) {
          throw new EmitAllowlistError(
            `emit blocked: un-allowlisted key "${key}" on tool.call models item`,
          );
        }
      }
    }
  }
}

/**
 * Deep-validate session.tokens.models[] (CODEX-CAPTURE ADR-C2). Same reason as
 * tool.call's: the top-level key-check cannot see inside an array. Stricter than
 * tool.call's, because this carrier is fed by TAILING A FILE rather than by a hook we
 * shaped, so the model id gets a VALUE pin and every count must be a non-negative
 * integer. A negative token count is not a measurement, it is a bug escaping.
 */
function validateSessionTokens(event: EmitCandidate): void {
  const models = (event as { models?: unknown }).models;
  if (!Array.isArray(models)) {
    throw new EmitAllowlistError(`emit blocked: session.tokens models is not an array`);
  }
  if (models.length > EVENT_MODEL_LIMIT) {
    throw new EmitAllowlistError(
      `emit blocked: session.tokens models exceeds the ${EVENT_MODEL_LIMIT} cap`,
    );
  }
  for (const item of models) {
    if (!isPlainObject(item)) {
      throw new EmitAllowlistError(`emit blocked: session.tokens models item is not an object`);
    }
    for (const key of Object.keys(item)) {
      if (!SESSION_TOKENS_MODEL_ALLOWLIST.includes(key)) {
        throw new EmitAllowlistError(
          `emit blocked: un-allowlisted key "${key}" on session.tokens models item`,
        );
      }
    }
    const model = (item as { model?: unknown }).model;
    if (typeof model !== "string" || !MODEL_ID_SHAPE.test(model)) {
      throw new EmitAllowlistError(
        `emit blocked: session.tokens model ${JSON.stringify(model)} is not a model-id shape`,
      );
    }
    for (const field of [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
    ] as const) {
      if (!isNonNegativeInt((item as Record<string, unknown>)[field])) {
        throw new EmitAllowlistError(
          `emit blocked: session.tokens ${field} is not a non-negative integer`,
        );
      }
    }
  }
}

/**
 * Deep-VALUE-validate agent.quota (ADR-C15). Same posture as session.tokens.models[]:
 * the top-level key-check cannot see into an array, so every item key is pinned, and
 * every value is magnitude-checked. `rate_limits` is the densest un-audited surface
 * Codex hands us — it carries `plan_type`, a `credits.balance`, a `limit_id` — and NONE
 * of that travels. Only three numbers per window do, and this is what enforces it.
 */
function validateAgentQuota(event: EmitCandidate): void {
  const tool = (event as { tool?: unknown }).tool;
  // The shared wire schema keeps AgentId open for future adapters. This collector's
  // independent privacy tripwire still requires its locally registered adapter id;
  // adding an adapter updates that registry, not the published wire contract.
  if (typeof tool !== "string" || !AGENT_IDS.includes(tool)) {
    throw new EmitAllowlistError(
      `emit blocked: agent.quota tool is not a registered agent`,
    );
  }

  const windows = (event as { windows?: unknown }).windows;
  if (!Array.isArray(windows)) {
    throw new EmitAllowlistError(`emit blocked: agent.quota windows is not an array`);
  }
  if (windows.length === 0) {
    // An event with no usable window is not honest-empty, it is noise: it would land a
    // row in D1 that says nothing and would still win "newest snapshot" against a real
    // reading. The adapter drops the event instead of emitting one.
    throw new EmitAllowlistError(`emit blocked: agent.quota carries no windows`);
  }
  if (windows.length > EVENT_QUOTA_WINDOW_LIMIT) {
    throw new EmitAllowlistError(
      `emit blocked: agent.quota windows exceeds the ${EVENT_QUOTA_WINDOW_LIMIT} cap`,
    );
  }

  for (const item of windows) {
    if (!isPlainObject(item)) {
      throw new EmitAllowlistError(`emit blocked: agent.quota windows item is not an object`);
    }
    for (const key of Object.keys(item)) {
      if (!QUOTA_WINDOW_ALLOWLIST.includes(key)) {
        throw new EmitAllowlistError(
          `emit blocked: un-allowlisted key "${key}" on agent.quota windows item`,
        );
      }
    }
    if (!isNonNegativeInt(item.windowMinutes)) {
      throw new EmitAllowlistError(
        `emit blocked: agent.quota windowMinutes is not a non-negative integer`,
      );
    }
    // A share of a window is 0..100 BY DEFINITION. A value outside it is the provider
    // contradicting itself, and letting it through would overdraw (or invert) a gauge.
    const usedPercent = item.usedPercent;
    if (
      typeof usedPercent !== "number" ||
      !Number.isFinite(usedPercent) ||
      usedPercent < 0 ||
      usedPercent > 100
    ) {
      throw new EmitAllowlistError(
        `emit blocked: agent.quota usedPercent ${JSON.stringify(usedPercent)} is not 0..100`,
      );
    }
    // The liveness arbiter. A window we cannot date is one we can never tell apart from
    // the same reading a week stale, so an undateable window must never reach the wire.
    const resetsAt = item.resetsAt;
    if (
      typeof resetsAt !== "string" ||
      !Number.isFinite(Date.parse(resetsAt))
    ) {
      throw new EmitAllowlistError(
        `emit blocked: agent.quota resetsAt ${JSON.stringify(resetsAt)} is not an ISO instant`,
      );
    }
  }
}

/**
 * Deep-VALUE-validate session.linesurvival. The top-level key-check says nothing
 * about VALUES, so this event needs an explicit branch (the WS3 red-team finding):
 * the blame walk that produces these counts is the densest content surface in the
 * collector. Every COUNT is pinned to a finite non-negative int (with the
 * linesSurviving<=linesAuthored invariant) and every ENUM (fate/rung/gitContext) to
 * its closed set. The remaining string fields are content-free BY DERIVATION, not
 * pinned here: eventId/repoId are salted hashes and `at` an ISO timestamp
 * (git/identity.ts, git/line-survival.ts, survival.ts); `repoLabel` is a basename
 * behind the default-OFF opt-in (same provenance contract as fileLabel) — a basename
 * is arbitrary text and cannot be enum-checked.
 *
 * `commits[]` (ADR-H4) is the one nested shape, and the block at the end of this
 * function is what earns it: length-capped, every item key pinned, every count pinned,
 * and `id` pinned to a 64-hex SALTED hash so a raw 40-hex sha cannot ride out.
 */
function validateLineSurvival(event: EmitCandidate): void {
  const e = event;
  for (const k of ["commitsChecked", "linesAuthored", "linesSurviving"]) {
    if (!isNonNegativeInt(e[k])) {
      throw new EmitAllowlistError(`emit blocked: session.linesurvival ${k} must be a non-negative integer`);
    }
  }
  if ((e.linesSurviving as number) > (e.linesAuthored as number)) {
    throw new EmitAllowlistError(`emit blocked: session.linesurvival linesSurviving exceeds linesAuthored`);
  }
  if (typeof e.fate !== "string" || !LINE_SURVIVAL_FATES.includes(e.fate)) {
    throw new EmitAllowlistError(`emit blocked: session.linesurvival fate ${JSON.stringify(e.fate)} not in the closed enum`);
  }
  if (typeof e.rung !== "string" || !LINE_SURVIVAL_RUNGS.includes(e.rung)) {
    throw new EmitAllowlistError(`emit blocked: session.linesurvival rung ${JSON.stringify(e.rung)} not in the closed enum`);
  }
  if (typeof e.gitContext !== "string" || !GIT_CONTEXTS.includes(e.gitContext)) {
    throw new EmitAllowlistError(`emit blocked: session.linesurvival gitContext ${JSON.stringify(e.gitContext)} not in the closed enum`);
  }

  // ── commits[] (ADR-H4): the ONE nested shape, and the guard that permits it ──
  if (e.commits !== undefined) {
    if (!Array.isArray(e.commits)) {
      throw new EmitAllowlistError("emit blocked: session.linesurvival commits must be an array");
    }
    if (e.commits.length > EVENT_LINE_SURVIVAL_COMMIT_LIMIT) {
      throw new EmitAllowlistError(
        `emit blocked: session.linesurvival commits exceeds the ${EVENT_LINE_SURVIVAL_COMMIT_LIMIT} cap`,
      );
    }
    for (const raw of e.commits) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new EmitAllowlistError("emit blocked: session.linesurvival commits item must be an object");
      }
      const item = raw as Record<string, unknown>;
      // The top-level key-check cannot see inside an array, so pin the item keys here.
      for (const key of Object.keys(item)) {
        if (!LINE_SURVIVAL_COMMIT_ALLOWLIST.includes(key)) {
          throw new EmitAllowlistError(
            `emit blocked: un-allowlisted key "${key}" on session.linesurvival commits item`,
          );
        }
      }
      // A raw sha is a globally-correlatable fingerprint that would defeat the salted
      // repoId. Only the 64-hex SALTED id passes; a 40-hex sha is rejected by length.
      if (typeof item.id !== "string" || !SALTED_HASH_RE.test(item.id)) {
        throw new EmitAllowlistError(
          "emit blocked: session.linesurvival commits item id must be a 64-hex salted hash (never a sha)",
        );
      }
      for (const k of ["added", "contested", "authored"]) {
        if (!isNonNegativeInt(item[k])) {
          throw new EmitAllowlistError(
            `emit blocked: session.linesurvival commits item ${k} must be a non-negative integer`,
          );
        }
      }
      if ((item.authored as number) + (item.contested as number) > (item.added as number)) {
        throw new EmitAllowlistError(
          "emit blocked: session.linesurvival commits item authored+contested exceeds added",
        );
      }
    }
  }
  if (e.filesGoneFromTip !== undefined && !isNonNegativeInt(e.filesGoneFromTip)) {
    throw new EmitAllowlistError(
      "emit blocked: session.linesurvival filesGoneFromTip must be a non-negative integer",
    );
  }
}

/**
 * repo.toolchain VALUE-check (CAPTURE-FOUNDATION ADR-CF3). A NEW event kind gets
 * ONLY the top-level key-check, so its content-safety rests HERE: the manifest is
 * read during derivation, putting a raw dep name / string one property-assign away.
 * Pin the two enums (or null) + gitContext. `repoLabel` is a basename left UNPINNED
 * (content-free by derivation, repoLabels-gated).
 */
function validateRepoToolchain(event: EmitCandidate): void {
  const e = event;
  if (
    e.packageManager !== null &&
    (typeof e.packageManager !== "string" || !PACKAGE_MANAGERS.includes(e.packageManager))
  ) {
    throw new EmitAllowlistError(
      `emit blocked: repo.toolchain packageManager ${JSON.stringify(e.packageManager)} not in the closed enum (or null)`,
    );
  }
  if (
    e.framework !== null &&
    (typeof e.framework !== "string" || !FRAMEWORKS.includes(e.framework))
  ) {
    throw new EmitAllowlistError(
      `emit blocked: repo.toolchain framework ${JSON.stringify(e.framework)} not in the closed enum (or null)`,
    );
  }
  if (typeof e.gitContext !== "string" || !GIT_CONTEXTS.includes(e.gitContext)) {
    throw new EmitAllowlistError(
      `emit blocked: repo.toolchain gitContext ${JSON.stringify(e.gitContext)} not in the closed enum`,
    );
  }
}

/**
 * git.momentum repoShape deep VALUE-check (CAPTURE-FOUNDATION ADR-CF7): the
 * FIRST-EVER deep branch on git.momentum. repoShape is the first nested object on
 * this kind, so without this an unguarded string (e.g. a workspace-glob path)
 * could ride the top-level key-check alone. Pin every sub-key + value-type.
 */
function validateGitMomentum(event: EmitCandidate): void {
  const repoShape = (event as { repoShape?: unknown }).repoShape;
  if (repoShape !== undefined) {
    if (!isPlainObject(repoShape)) {
      throw new EmitAllowlistError(`emit blocked: git.momentum repoShape is not an object`);
    }
    for (const key of Object.keys(repoShape)) {
      if (!REPO_SHAPE_ALLOWLIST.includes(key)) {
        throw new EmitAllowlistError(
          `emit blocked: un-allowlisted key "${key}" on git.momentum repoShape`,
        );
      }
    }
    if (typeof repoShape.monorepo !== "boolean") {
      throw new EmitAllowlistError(`emit blocked: git.momentum repoShape.monorepo must be a boolean`);
    }
    if (typeof repoShape.sizeBand !== "string" || !REPO_SIZE_BANDS.includes(repoShape.sizeBand)) {
      throw new EmitAllowlistError(
        `emit blocked: git.momentum repoShape.sizeBand ${JSON.stringify(repoShape.sizeBand)} not in the closed enum`,
      );
    }
    if (typeof repoShape.ageBand !== "string" || !REPO_AGE_BANDS.includes(repoShape.ageBand)) {
      throw new EmitAllowlistError(
        `emit blocked: git.momentum repoShape.ageBand ${JSON.stringify(repoShape.ageBand)} not in the closed enum`,
      );
    }
  }
}

/**
 * The deep validator for each kind that has one. Kinds absent here are guarded by the
 * top-level key-check alone, deliberately — see the module header.
 *
 * `null`-prototype so a kind string that happens to name an Object.prototype member
 * ("toString", "constructor") can never resolve to a function here. `assertEmitSafe`
 * already refuses any kind outside EMIT_ALLOWLIST, so this is belt-and-braces on a
 * lookup keyed by attacker-adjacent data.
 */
export const DEEP_VALIDATORS: Readonly<
  Partial<Record<SessionEvent["kind"], (event: EmitCandidate) => void>>
> = Object.assign(Object.create(null), {
  "session.start": validateSessionStart,
  "tool.call": validateToolCall,
  "session.tokens": validateSessionTokens,
  "agent.quota": validateAgentQuota,
  "session.linesurvival": validateLineSurvival,
  "repo.toolchain": validateRepoToolchain,
  "git.momentum": validateGitMomentum,
});

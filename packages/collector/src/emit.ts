/**
 * emit.ts — the STRICT emit-allowlist tripwire, and the SINGLE entry point to it.
 *
 * The full-payload hook refactor (item 1) widens HookInput to carry the raw
 * Claude Code payload, which puts CONTENT (prompts, commands, file_text, stdout,
 * stderr, file paths, tool_input, tool_response, tool_error) ONE property access
 * away from an emitted event. This module is the runtime guarantee that none of
 * it can ever reach disk (and therefore the worker): `assertEmitSafe` deep-walks
 * every event about to be appended and THROWS on any key that is not explicitly
 * allowlisted for that event's kind.
 *
 * This is a tripwire, not a type check: it runs at emit time, on real data, so a
 * future refactor that accidentally spreads `...input` into a builder fails loud
 * and immediately instead of silently leaking content. The allowlist enumerates
 * EXACTLY the fields the builders emit (envelope keys + per-kind keys, plus the
 * nested key set for ToolCallEvent.models[] items) and rejects everything else —
 * especially anything carrying prompt/command/file_text/stdout/stderr/file_path/
 * tool_input/tool_response/tool_error.
 *
 * The two halves live in `emit/`:
 *
 *   emit/guard.ts      EmitAllowlistError + the two shape predicates
 *   emit/registry.ts   THE registry: one allowlist per kind, one closed set per pin
 *   emit/validators.ts the deep per-kind validators, keyed by kind
 *
 * `assertEmitSafe` below is the whole control flow — the envelope check, the
 * top-level key-check against the ONE registry, and a single dispatch into the deep
 * validator for that kind. Nothing outside `emit/` may import `emit/*` directly
 * (`test/split-module-boundary.test.ts` enforces it), so every event on every path
 * passes through this one function.
 */
import type { SessionEvent } from "@seorak/types";
import { EmitAllowlistError, isPlainObject } from "./emit/guard.ts";
import { EMIT_ALLOWLIST } from "./emit/registry.ts";
import { DEEP_VALIDATORS } from "./emit/validators.ts";

export { EmitAllowlistError } from "./emit/guard.ts";
export {
  AGENT_VERSION_SHAPE,
  CAPABILITIES_ALLOWLIST,
  EMIT_ALLOWLIST,
  MODEL_ITEM_ALLOWLIST,
  SESSION_TOKENS_MODEL_ALLOWLIST,
} from "./emit/registry.ts";

/**
 * assertEmitSafe(event) — throws EmitAllowlistError if the event carries any key
 * not in the allowlist for its kind (or any nested models[] item carries a key
 * not in MODEL_ITEM_ALLOWLIST). Called from append.ts BEFORE the line is written
 * to disk, so an un-allowlisted key can never be emitted.
 *
 * Order is the contract: the envelope must be an object with a KNOWN kind before
 * the registry can be consulted, the top-level key-check must pass before any deep
 * validator runs (so an un-allowlisted key is always reported as such rather than
 * as whatever the deep check happens to notice first), and at most one deep
 * validator ever runs, because they are keyed by kind.
 */
export function assertEmitSafe(event: SessionEvent): void {
  if (!isPlainObject(event)) {
    throw new EmitAllowlistError(`emit blocked: event is not an object`);
  }

  const kind = (event as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !(kind in EMIT_ALLOWLIST)) {
    throw new EmitAllowlistError(`emit blocked: unknown event kind ${JSON.stringify(kind)}`);
  }

  const allowed = EMIT_ALLOWLIST[kind as SessionEvent["kind"]];
  for (const key of Object.keys(event)) {
    if (!allowed.includes(key)) {
      throw new EmitAllowlistError(
        `emit blocked: un-allowlisted key "${key}" on ${kind} event`,
      );
    }
  }

  // The kinds with a nested shape or a pinned value get their deep validator here.
  // A kind with no entry is guarded by the key-check above alone, deliberately.
  DEEP_VALIDATORS[kind as SessionEvent["kind"]]?.(event);
}

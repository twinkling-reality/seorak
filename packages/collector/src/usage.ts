import { existsSync, readFileSync } from "node:fs";
import { priceModelUsage } from "@seorak/types";
import { withTranscriptSessionCursor } from "./session-cursors.ts";

export interface UsageDelta {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/**
 * A per-model slice of a usage delta. `priced` is whether this model is in the
 * PRICES table (`costUsd` reflects only priced tokens — 0 when unpriced). The
 * cache token figures + `priced` are INTERNAL to the collector; only
 * {model, inputTokens, outputTokens, costUsd} are emitted (MODEL_ITEM_ALLOWLIST).
 */
export interface ModelUsageBucket {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Priced-only cost (0 when the model is not in the price table). */
  costUsd: number;
  /** False when the model is not in the price table — surfaces as the worker's
   *  honest-empty ModelRollup.costUsd=null rather than a silent $0. */
  priced: boolean;
}

/** consumeUsageSince result: the summed delta plus its per-model breakdown. */
export interface UsageResult {
  delta: UsageDelta;
  models: ModelUsageBucket[];
}

const ZERO: UsageDelta = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Price a usage row for a model. Delegates to the SHARED `@seorak/types` price
 * table (option C: one source of truth for both the collector and the worker), so
 * a price correction is edited in exactly one place. Maps the transcript's
 * snake_case usage fields onto the canonical token shape. `priced` is false when
 * the model matches no family prefix, so an unpriced model NEVER folds a silent $0
 * into the headline (the per-model marker becomes ModelRollup.costUsd=null at the
 * worker). The worker RE-PRICES the headline/byModel from tokens; this collector
 * cost stays as the live/per-session figure + the worker's no-event-log fallback.
 */
function priceFor(model: string, usage: RawUsage): { costUsd: number; priced: boolean } {
  return priceModelUsage(model, {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  });
}

export function consumeUsageSince(
  sessionId: string,
  transcriptPath: string | undefined,
): UsageResult {
  if (!transcriptPath || !existsSync(transcriptPath)) return { delta: { ...ZERO }, models: [] };
  return withTranscriptSessionCursor(sessionId, (lastUuid) => {
    const lines = readFileSync(transcriptPath, "utf8").split("\n");
    const delta: UsageDelta = { ...ZERO };
    // Per-model accumulation: bucket each assistant row by its own model id so the
    // worker can build tools.byModel. A delta can span multiple models.
    const buckets = new Map<string, ModelUsageBucket>();
    let newCursor = lastUuid;
    let collecting = lastUuid === "";

    for (const line of lines) {
      if (!line) continue;
      let row: { type?: string; uuid?: string; message?: { usage?: RawUsage; model?: string } };
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row.type !== "assistant") continue;
      if (!collecting) {
        if (row.uuid === lastUuid) collecting = true;
        continue;
      }
      const usage = row.message?.usage ?? {};
      const model = row.message?.model ?? "";
      const inputTokens = usage.input_tokens ?? 0;
      const outputTokens = usage.output_tokens ?? 0;
      const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
      const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
      const { costUsd, priced } = priceFor(model, usage);

      delta.inputTokens += inputTokens;
      delta.outputTokens += outputTokens;
      delta.cacheReadTokens += cacheReadTokens;
      delta.cacheWriteTokens += cacheWriteTokens;
      // Silent-zero fix: only PRICED cost folds into the headline. An unpriced
      // model contributes its tokens but no fabricated $0 (its honest-empty marker
      // is ModelRollup.costUsd=null at the worker, derived from a per-model cost of 0).
      if (priced) delta.costUsd += costUsd;

      // Per-model bucket (only when a model id is present — no "unknown" noise).
      if (model) {
        let b = buckets.get(model);
        if (!b) {
          b = {
            model,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            priced,
          };
          buckets.set(model, b);
        }
        b.inputTokens += inputTokens;
        b.outputTokens += outputTokens;
        b.cacheReadTokens += cacheReadTokens;
        b.cacheWriteTokens += cacheWriteTokens;
        if (priced) b.costUsd += costUsd;
        b.priced = b.priced && priced;
      }

      if (row.uuid) newCursor = row.uuid;
    }

    return {
      result: { delta, models: [...buckets.values()] },
      ...(newCursor && newCursor !== lastUuid
        ? { nextValue: newCursor }
        : {}),
    };
  });
}

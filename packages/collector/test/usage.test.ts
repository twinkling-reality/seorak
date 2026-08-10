/**
 * usage.test.ts — per-model accumulation + the silent-zero (unpriced model) fix.
 *
 * consumeUsageSince now returns { delta, models[] }: it buckets each assistant
 * transcript row by its model id, prices PRICED models, and EXCLUDES unpriced
 * cost from the headline delta (a model not in the price table contributes its
 * tokens but no fabricated $0 — its honest-empty marker becomes
 * ModelRollup.costUsd=null at the worker). These tests prove that split, and that
 * toToolCall projects only the four allowlisted per-model keys with no content
 * leak.
 *
 * fs-sandboxed: SEORAK_DIR is pointed at a fresh temp dir per test so the
 * transcript cursor never collides; the transcript fixture is written there.
 */
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseClaudeCodeHook } from "../src/adapters/claude-code.ts";
import { assertEmitSafe } from "../src/emit.ts";
import { toSessionEnd, toToolCall } from "../src/hooks.ts";
import { sessionCursorDatabasePath } from "../src/paths.ts";
import { consumeUsageSince } from "../src/usage.ts";

/** Parse a raw Claude Code hook payload into the canonical input the builders now
 *  consume (the per-tool parsing moved behind the adapter seam). */
const cc = (raw: Record<string, unknown>) => parseClaudeCodeHook(raw);

// One priced (claude-sonnet-4-x → in the PRICES table) and one UNPRICED (gpt-5)
// assistant row. priced cost = 1000*3 + 200*15 = 6000 µ-units → $0.006.
const TRANSCRIPT_LINES = [
  JSON.stringify({
    type: "assistant",
    uuid: "u1",
    message: {
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }),
  JSON.stringify({
    type: "assistant",
    uuid: "u2",
    message: { model: "gpt-5", usage: { input_tokens: 500, output_tokens: 50 } },
  }),
];

let dir: string;
let transcriptPath: string;
let savedDir: string | undefined;

beforeEach(() => {
  savedDir = process.env.SEORAK_DIR;
  dir = mkdtempSync(join(tmpdir(), "seorak-usage-"));
  process.env.SEORAK_DIR = dir;
  transcriptPath = join(dir, "transcript.jsonl");
  writeFileSync(transcriptPath, TRANSCRIPT_LINES.join("\n") + "\n", "utf8");
});

afterEach(() => {
  if (savedDir === undefined) delete process.env.SEORAK_DIR;
  else process.env.SEORAK_DIR = savedDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("consumeUsageSince — per-model buckets + unpriced split", () => {
  it("sums tokens across models but only PRICED cost into the headline delta", () => {
    const { delta, models } = consumeUsageSince("sess-a", transcriptPath);
    expect(delta.inputTokens).toBe(1500);
    expect(delta.outputTokens).toBe(250);
    // gpt-5 (unpriced) contributes ZERO cost — no silent $0 inflation.
    expect(delta.costUsd).toBeCloseTo(0.006, 6);

    expect(models).toHaveLength(2);
    const sonnet = models.find((m) => m.model === "claude-sonnet-4-6")!;
    const gpt = models.find((m) => m.model === "gpt-5")!;
    expect(sonnet.priced).toBe(true);
    expect(sonnet.costUsd).toBeCloseTo(0.006, 6);
    expect(sonnet.inputTokens).toBe(1000);
    // Unpriced model: priced=false, costUsd 0 (surfaces as ModelRollup null at worker).
    expect(gpt.priced).toBe(false);
    expect(gpt.costUsd).toBe(0);
    expect(gpt.inputTokens).toBe(500);
  });

  it("returns honest-empty {delta zero, models []} for a missing transcript", () => {
    const { delta, models } = consumeUsageSince("sess-missing", join(dir, "nope.jsonl"));
    expect(models).toEqual([]);
    expect(delta.costUsd).toBe(0);
    expect(delta.inputTokens).toBe(0);
  });

  it("retains the cursor across session end so a resumed transcript is not recounted", () => {
    const first = consumeUsageSince("sess-resume", transcriptPath);
    expect(first.delta.inputTokens).toBe(1500);
    expect(consumeUsageSince("sess-resume", transcriptPath).delta.inputTokens).toBe(0);

    expect(
      toSessionEnd(
        cc({
          session_id: "sess-resume",
          hook_event_name: "SessionEnd",
          reason: "other",
        }),
      ),
    ).toBeDefined();
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "assistant",
        uuid: "u3",
        message: {
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 25, output_tokens: 5 },
        },
      })}\n`,
      "utf8",
    );

    const resumed = consumeUsageSince("sess-resume", transcriptPath);
    expect(resumed.delta.inputTokens).toBe(25);
    expect(resumed.delta.outputTokens).toBe(5);
  });

  it("imports one legacy cursor before reading and removes it only after commit", () => {
    const legacyPath = join(dir, "cursor-sess-legacy");
    writeFileSync(legacyPath, "u1", "utf8");

    const result = consumeUsageSince("sess-legacy", transcriptPath);
    expect(result.delta.inputTokens).toBe(500);
    expect(result.delta.outputTokens).toBe(50);
    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(sessionCursorDatabasePath())).toBe(true);
    expect(
      readdirSync(dir).filter(
        (name) => name.startsWith("cursor-") || name.startsWith("gitcursor-"),
      ),
    ).toEqual([]);
  });

  // Opus 4.x list price is $5/$25 per MTok (cacheRead 0.5, cacheWrite 6.25) — the
  // current rate, NOT the pre-4.6 $15/$75. This pins the µ-per-MTok → USD scaling
  // so a regression back to the old (3×-inflated) Opus price fails loudly: the
  // headline cost is the product's core number and an Opus-heavy session is the
  // common case. Resolves via the "claude-opus-4" PREFIX from the full model id.
  it("prices claude-opus-4-8 at the current $5/$25 rate (regression guard for the 3× inflation)", () => {
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: "assistant",
        uuid: "o1",
        message: {
          model: "claude-opus-4-8",
          usage: {
            input_tokens: 1000,
            output_tokens: 200,
            cache_read_input_tokens: 4000,
            cache_creation_input_tokens: 0,
          },
        },
      }) + "\n",
      "utf8",
    );
    const { delta, models } = consumeUsageSince("sess-opus", transcriptPath);
    // (1000*5 + 200*25 + 4000*0.5) / 1e6 = (5000 + 5000 + 2000) / 1e6 = 0.012.
    // The old $15/$75/$1.5 table would yield 0.036 — this assertion catches that.
    expect(delta.costUsd).toBeCloseTo(0.012, 6);
    const opus = models.find((m) => m.model === "claude-opus-4-8")!;
    expect(opus.priced).toBe(true);
    expect(opus.costUsd).toBeCloseTo(0.012, 6);
  });

  // Coverage guard (prices verified current 2026-06-05): the model ids actually in
  // use must all resolve to a PRICED family via the prefix table. Prices are
  // matched by family prefix, so any 4.x minor is covered automatically — but a new
  // MAJOR family (or a renamed id) would silently fall through to priced=false and
  // quietly UNDERCOUNT the headline cost. This fails loudly the moment a model the
  // product expects to price shows up unpriced, so the table never rots unnoticed.
  it("prices every current-generation model id (no silent unpriced fall-through)", () => {
    const CURRENT_MODEL_IDS = [
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ];
    writeFileSync(
      transcriptPath,
      CURRENT_MODEL_IDS.map((model, i) =>
        JSON.stringify({
          type: "assistant",
          uuid: `m${i}`,
          message: { model, usage: { input_tokens: 1000, output_tokens: 100 } },
        }),
      ).join("\n") + "\n",
      "utf8",
    );
    const { models } = consumeUsageSince("sess-coverage", transcriptPath);
    for (const id of CURRENT_MODEL_IDS) {
      const bucket = models.find((m) => m.model === id);
      expect(bucket, `${id} should be in the result`).toBeDefined();
      expect(bucket!.priced, `${id} must be PRICED — update PRICES if this fails`).toBe(true);
      expect(bucket!.costUsd).toBeGreaterThan(0);
    }
  });
});

describe("toToolCall — emits only the 4 allowlisted per-model keys, no content leak", () => {
  it("populates models[] and survives assertEmitSafe", () => {
    const event = toToolCall(cc({
      session_id: "sess-b",
      tool_name: "Read",
      hook_event_name: "PostToolUse",
      transcript_path: transcriptPath,
    })) as any;

    expect(event).toBeDefined();
    expect(Array.isArray(event.models)).toBe(true);
    expect(event.models).toHaveLength(2);
    for (const m of event.models) {
      // The 6 allowlisted per-model accounting keys (cache tokens added for option-C
      // worker repricing); nothing else (no internal `priced` flag, no content).
      expect(Object.keys(m).sort()).toEqual([
        "cacheReadTokens",
        "cacheWriteTokens",
        "costUsd",
        "inputTokens",
        "model",
        "outputTokens",
      ]);
    }
    const gpt = event.models.find((m: any) => m.model === "gpt-5");
    expect(gpt.costUsd).toBe(0); // unpriced → 0 on the wire → null at the worker
    // The internal `priced` flag must NOT ride on the wire.
    expect(event.models[0]).not.toHaveProperty("priced");
    expect(() => assertEmitSafe(event)).not.toThrow();
  });

  it("omits models entirely (absent, not []) when the delta has no rows", () => {
    const event = toToolCall(cc({
      session_id: "sess-c",
      tool_name: "Read",
      hook_event_name: "PostToolUse",
      transcript_path: join(dir, "nope.jsonl"),
    })) as any;
    expect(event).toBeDefined();
    expect(event.models).toBeUndefined();
  });
});

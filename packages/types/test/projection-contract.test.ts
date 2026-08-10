// WS2-P2 guard F5 (CONTRACT-SEAM-AUDIT §9): @seorak/types had a typecheck but
// ZERO tests, so a projection that silently OMITS a SessionState field is valid
// TS (proven in the audit: a probe field added to SessionState + sessionToSummary
// but not sessionToLiveActivity → tsc exit 0). This suite (a) pins the projection
// OUTPUT (golden strings the worker/web/LA all render), and (b) asserts every
// SessionState field is consciously classified across the two live projections —
// so a future live-glanceable field wired to the web summary but forgotten on the
// Live Activity (the exact F5 trigger) fails CI instead of rendering nowhere.
// Folds in the notification projection assertions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sessionToSummary,
  sessionToLiveActivity,
  liveActivityFingerprint,
  interventionToNotification,
  coerceNotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  buildSignalBody,
  SIGNAL_IDS,
  SIGNAL_CATALOG,
} from "@seorak/types";
import type { SessionState, Intervention } from "@seorak/types";

function fx(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: "sess-1",
    startedAt: "2026-06-15T12:00:00.000Z",
    lastEventAt: "2026-06-15T12:05:00.000Z", // +5 min
    repoId: "a".repeat(64),
    repoLabel: "seorak",
    agent: "claude-code",
    toolCallCount: 3,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    totalCacheReadTokens: 200,
    totalCacheWriteTokens: 100,
    totalCostUsd: 0.42,
    status: "active",
    ...overrides,
  };
}

// ── Golden: the presenter projection (web / CLI) ──────────────────────────────
test("sessionToSummary projects the canonical view-model", () => {
  const s = sessionToSummary(fx({ status: "active", currentTool: "Edit" }));
  assert.equal(s.project, "seorak");
  assert.equal(s.repoId, "a".repeat(64));
  assert.equal(s.status, "active");
  assert.equal(s.elapsedSeconds, 300);
  assert.equal(s.toolCallCount, 3);
  assert.equal(s.currentTool, "Edit");
  assert.equal(s.tokens.total, 1500); // input + output (billable throughput)
  assert.equal(s.tokens.cacheRead, 200);
  assert.equal(s.awaitingInput, undefined); // omitted unless blocked
  assert.ok(Number.isFinite(s.costUsd) && s.costUsd! >= 0);
  assert.ok(Number.isFinite(s.burnRateUsdPerMin) && s.burnRateUsdPerMin! >= 0);
});

// Null means "cannot price this" (unknown); a numeric 0 is measured
// and genuinely ~free. costFor must keep the two distinct; collapsing null into 0
// fabricated a "$0.00" for a token-priced-but-unpriceable session.
test("cost is null (not 0) when the host tool cannot price its work", () => {
  const none = sessionToSummary(
    fx({
      capabilities: { hasTokens: true, hasCacheTokens: false, cost: "none", toolResult: "both" },
    }),
  );
  assert.equal(none.costUsd, null, "cost:'none' is unknown, not a measured $0");
  assert.equal(none.burnRateUsdPerMin, null, "burn is unknowable when cost is");

  const unpriced = sessionToSummary(
    fx({
      totalCostUsd: 0, // no collector fallback to lean on
      modelTokens: {
        "gpt-unknown-model": {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    }),
  );
  assert.equal(unpriced.costUsd, null, "every model unpriced ⇒ null, never a summed 0");
});

test("a genuinely free measured session is 0, not null", () => {
  const free = sessionToSummary(fx({ totalCostUsd: 0 }));
  assert.equal(free.costUsd, 0, "a finite 0 is a real measurement, distinct from null");
});

// A session-costed tool's money rides the session.tokens carrier in the event log
// and never reaches KV, so a live Codex row's totalCostUsd is a sum of
// schema-required per-call zeros. Prod live[] rendered those as a measured $0.00
// on active codex sessions; costFor must refuse the fallback without evidence.
test("a session-costed tool with no model-token evidence is null, never the schema zero", () => {
  const codexCaps = {
    hasTokens: true,
    hasCacheTokens: true,
    cost: "estimated",
    toolResult: "both",
    costScope: "session",
  } as const;
  const live = sessionToSummary(
    fx({ agent: "codex", totalCostUsd: 0, capabilities: codexCaps }),
  );
  assert.equal(live.costUsd, null, "the KV zero is schema-required, not a measurement");
  assert.equal(live.burnRateUsdPerMin, null, "burn is unknowable when cost is");

  // An empty modelTokens record is the same absence of evidence, not a priced $0.
  const empty = sessionToSummary(
    fx({ agent: "codex", totalCostUsd: 0, capabilities: codexCaps, modelTokens: {} }),
  );
  assert.equal(empty.costUsd, null, "empty modelTokens is no evidence either");

  // With real model-token evidence the same session prices normally: the gate keys
  // on evidence, so a future KV accumulation of session.tokens re-enables pricing.
  const priced = sessionToSummary(
    fx({
      agent: "codex",
      totalCostUsd: 0,
      capabilities: codexCaps,
      modelTokens: {
        "gpt-5.5": {
          inputTokens: 1_000_000,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
    }),
  );
  assert.ok(
    priced.costUsd !== null && priced.costUsd > 0,
    "model-token evidence prices normally under costScope 'session'",
  );
});

test("sessionToSummary surfaces the live 'needs you' glance only while blocked", () => {
  assert.equal(sessionToSummary(fx({ awaitingInput: true })).awaitingInput, true);
  assert.equal(sessionToSummary(fx()).awaitingInput, undefined);
});

// ── Golden: the live-ambient projection (Live Activity) ───────────────────────
test("sessionToLiveActivity — working", () => {
  const snap = sessionToLiveActivity(fx({ status: "active", currentTool: "Edit" }));
  assert.equal(snap.kind, "liveActivity");
  assert.equal(snap.id, "session-sess-1");
  assert.equal(snap.surfaceId, "session-sess-1");
  assert.equal(snap.state, "active");
  const la = (snap as Extract<typeof snap, { kind: "liveActivity" }>).liveActivity;
  assert.equal(la.title, "Working in seorak");
  assert.equal(la.body, "seorak, 3 tool calls");
  assert.equal(la.progress, 0);
  assert.equal(la.stage, "inProgress");
  assert.equal(la.statusLine, "Working");
  assert.equal(la.deepLink, "seorak://session/sess-1");
  assert.equal(la.modeLabel, "claude-code");
});

test("sessionToLiveActivity — needs-you lights the surface (attention)", () => {
  const snap = sessionToLiveActivity(fx({ awaitingInput: true }));
  assert.equal(snap.state, "attention");
  const la = (snap as Extract<typeof snap, { kind: "liveActivity" }>).liveActivity;
  assert.equal(la.title, "Waiting for you in seorak");
  assert.equal(la.statusLine, "Waiting");
  assert.equal(la.stage, "prompted"); // no current tool
});

test("sessionToLiveActivity — done (honest-soft progress, never a cost meter)", () => {
  const snap = sessionToLiveActivity(fx({ status: "ended", endedAt: "2026-06-15T12:05:00.000Z" }));
  assert.equal(snap.state, "completed");
  const la = (snap as Extract<typeof snap, { kind: "liveActivity" }>).liveActivity;
  assert.equal(la.title, "Done in 5m");
  assert.equal(la.progress, 1);
  assert.equal(la.stage, "completing");
  assert.equal(la.statusLine, "Done");
});

test("sessionToLiveActivity — zero-call session is honest-empty (just the repo)", () => {
  const snap = sessionToLiveActivity(fx({ toolCallCount: 0 }));
  const la = (snap as Extract<typeof snap, { kind: "liveActivity" }>).liveActivity;
  assert.equal(la.body, "seorak"); // never a fabricated "0 tok · $0.00"
});

test("liveActivityFingerprint encodes ONLY discrete state — token/cost churn never re-pushes (ADR-002)", () => {
  assert.equal(liveActivityFingerprint(fx({ status: "active", currentTool: "Edit" })), "active|inProgress|ok");
  assert.equal(liveActivityFingerprint(fx({ awaitingInput: true })), "active|prompted|need");
  assert.equal(liveActivityFingerprint(fx({ status: "ended" })), "ended|completing|ok");
  const quiet = liveActivityFingerprint(fx({ status: "active", currentTool: "Edit", toolCallCount: 3, totalOutputTokens: 500, totalCostUsd: 0.42 }));
  const busy = liveActivityFingerprint(fx({ status: "active", currentTool: "Edit", toolCallCount: 99, totalOutputTokens: 999_999, totalCostUsd: 50 }));
  assert.equal(quiet, busy, "fingerprint must ignore token/cost churn or it blows the APNs budget");
});

// ── The parity guard: every SessionState field is consciously classified ──────
test("projection parity — no SessionState field is silently dropped from a surface", () => {
  const sessionSrc = readFileSync(new URL("../src/session.ts", import.meta.url), "utf8");
  const projSrc = readFileSync(new URL("../src/projections.ts", import.meta.url), "utf8");

  const allFields = parseInterfaceFields(sessionSrc, "SessionState");
  const blocks = fnBlocks(projSrc);
  // costFor is only reached from sessionToSummary; the LA helpers (needsInput,
  // liveActivityHeadline/State/Stage, fingerprint) are the live cluster.
  const summaryRefs = stateRefs(blocks, ["sessionToSummary", "costFor"]);
  const liveRefs = stateRefs(blocks, [
    "sessionToLiveActivity", "needsInput", "liveActivityHeadline",
    "liveActivityState", "liveActivityStage", "liveActivityFingerprint",
  ]);

  const summaryOnly = new Set([...allFields].filter((f) => summaryRefs.has(f) && !liveRefs.has(f)));
  const liveOnly = new Set([...allFields].filter((f) => liveRefs.has(f) && !summaryRefs.has(f)));
  const nowhere = new Set([...allFields].filter((f) => !summaryRefs.has(f) && !liveRefs.has(f)));

  // Web-only is LEGITIMATE by design — the Live Activity is state-only, so
  // tokens/cost/the keying id never reach it. But a field
  // landing on the web summary while SILENTLY absent from the glance is F5, so each
  // is acknowledged here; adding one to sessionToSummary and forgetting
  // sessionToLiveActivity fails this until the dev decides it's truly web-only.
  const WEB_ONLY = new Set([
    "repoId", "endedAt", "member",
    "totalInputTokens", "totalOutputTokens", "totalCacheReadTokens", "totalCacheWriteTokens",
    "capabilities", "modelTokens", "totalCostUsd",
  ]);
  // Never rendered on any read surface (internal reducer/idempotency state).
  const INTERNAL = new Set(["currentToolStartedAt", "recentEventIds"]);
  // On SessionState but not yet surfaced on any READ — slated for SessionSummary
  // because the mobile list/board wants an ended-reason chip. Moving it to a surface
  // moves it out of this set (a conscious step), which is the point of the guard.
  const DEFERRED = new Set(["reason"]);

  assert.deepEqual(summaryOnly, WEB_ONLY, `web-only set drifted → classify it: ${[...summaryOnly]}`);
  assert.deepEqual(liveOnly, new Set(), `a live-only field appeared — does the web summary want it too? ${[...liveOnly]}`);
  assert.deepEqual(nowhere, new Set([...INTERNAL, ...DEFERRED]), `un-projected set drifted → classify it: ${[...nowhere]}`);
});

// ── Notification projection ───────────────────────────────────────────────────
test("interventionToNotification is project-as-title for every signal (label rides subtitle, NOT category)", () => {
  for (const id of SIGNAL_IDS) {
    const meta = SIGNAL_CATALOG[id];
    const intervention: Intervention = {
      kind: id,
      sessionId: "sess-1",
      project: "seorak",
      repoId: "a".repeat(64),
      triggeredAt: "2026-06-15T12:00:00.000Z",
      signalLabel: meta.label,
      body: "A measured sentence.",
      deepLink: "seorak://session/sess-1",
      interruptionLevel: meta.interruptionLevel,
    };
    const snap = interventionToNotification(intervention);
    assert.equal(snap.kind, "notification");
    const n = (snap as Extract<typeof snap, { kind: "notification" }>).notification;
    assert.equal(n.title, "seorak", `${id}: title === project`);
    assert.equal(n.subtitle, meta.label, `${id}: subtitle === signal label`);
    assert.equal(n.category, "surface-update", `${id}: category is the routing id, not the human label`);
    assert.equal(n.interruptionLevel, meta.interruptionLevel, `${id}: interruption level from catalog`);
    assert.equal(snap.state, id === "session_ended" ? "completed" : "attention", `${id}: state mapped`);
  }
});

test("coerceNotificationSettings is fault-soft to catalog defaults (folds contract-check.mts)", () => {
  assert.deepEqual(coerceNotificationSettings(undefined), DEFAULT_NOTIFICATION_SETTINGS);
  const def = coerceNotificationSettings(undefined);
  assert.ok(SIGNAL_IDS.every((id) => id in def.signals));
  assert.equal(def.signals.cost_spike.enabled, true);
  assert.equal(def.signals.session_ended.enabled, false);

  const partial = coerceNotificationSettings({
    signals: {
      cost_spike: { enabled: false, thresholds: { costSpikeUsd: 0, foreign: 9 }, alwaysNotify: "yes" },
      daily_cost_cap: { enabled: true, thresholds: { dailyCostCapUsd: 42 } },
    },
    quietHours: { enabled: true, start: "25:99", end: "08:00", tz: "America/Los_Angeles" },
    perProject: {
      repoA: { muted: true },
      repoB: { overrides: { cost_spike: { thresholds: { costSpikeUsd: 12 } }, bogus_signal: { enabled: false } } },
      junk: 5,
    },
  });
  assert.equal(partial.signals.cost_spike.enabled, false);
  assert.equal(partial.signals.cost_spike.thresholds, undefined); // 0 + foreign key → sparse
  assert.equal(partial.signals.cost_spike.alwaysNotify, undefined); // non-boolean dropped
  assert.equal(partial.signals.daily_cost_cap.thresholds?.dailyCostCapUsd, 42);
  assert.equal(partial.signals.high_burn_rate.enabled, true); // untouched keeps default
  assert.equal(partial.quietHours.start, "22:00"); // invalid HH:MM → default
  assert.equal(partial.quietHours.tz, "America/Los_Angeles");
  assert.equal(partial.perProject.repoA?.muted, true);
  assert.equal(partial.perProject.repoB?.overrides?.cost_spike?.thresholds?.costSpikeUsd, 12);
  assert.equal((partial.perProject.repoB?.overrides as Record<string, unknown>)?.bogus_signal, undefined);
  assert.equal((partial.perProject as Record<string, unknown>).junk, undefined);
});

test("buildSignalBody copy is warm + honest (folds contract-check.mts)", () => {
  assert.equal(
    buildSignalBody({ signalId: "session_ended", durationMinutes: 42, costUsd: 3.1, commits: 1 }),
    "Wrapped: 42 min, about $3.10, 1 commit.",
  );
});

/**
 * Cost is DERIVED (tokens x list price) and no agent we support reports a dollar
 * figure, so every dollar Seorak shows is an estimate. A lock screen has no tooltip
 * and no caveat slot: the hedge must ride the sentence or it never reaches the
 * reader. This guards against a future copy edit quietly reintroducing a bare
 * dollar that reads as a bill. See pricing.ts COST_ESTIMATE_NOTE.
 */
test("every cost-bearing push body hedges its dollar (never presents a bill)", () => {
  const bodies = [
    buildSignalBody({ signalId: "cost_spike", costUsd: 5, capUsd: 5 }),
    buildSignalBody({ signalId: "high_burn_rate", burnRateUsdPerMin: 0.5, elapsedMinutes: 12 }),
    buildSignalBody({ signalId: "high_burn_rate", burnRateUsdPerMin: 0.5, elapsedMinutes: 0 }),
    buildSignalBody({ signalId: "daily_cost_cap", totalUsd: 22, capUsd: 20 }),
    buildSignalBody({ signalId: "session_ended", durationMinutes: 42, costUsd: 3.1 }),
  ];
  for (const body of bodies) {
    assert.ok(body.includes("$"), `expected a dollar figure in: ${body}`);
    assert.ok(
      /estimated|about/i.test(body),
      `unhedged dollar in a push body (reads as a bill): ${body}`,
    );
  }
});

// ── source-parsing helpers ────────────────────────────────────────────────────
/** Field names of a top-level `interface NAME { ... }` (comments stripped). */
function parseInterfaceFields(src: string, name: string): Set<string> {
  const start = src.indexOf(`interface ${name} {`);
  assert.ok(start >= 0, `interface ${name} not found`);
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { end = i; break; }
  }
  const body = src
    .slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const fields = new Set<string>();
  for (const m of body.matchAll(/(?:^|\n)\s*(\w+)\s*\??\s*:/g)) fields.add(m[1]);
  return fields;
}

/**
 * Map function-name → its source block (sliced at the next function decl).
 *
 * COMMENTS ARE STRIPPED FIRST, and that is load-bearing. A block runs from one
 * `function` keyword to the next, so a doc comment written ABOVE a function lands
 * inside the PRECEDING function's block. Without this, prose that merely MENTIONS
 * `state.someField` registers as a real reference and silently reclassifies that
 * field's surface — a documentation edit would flip this contract guard while the
 * code was untouched. (It did, once, which is why this reads code and not prose.)
 */
function fnBlocks(src: string): Record<string, string> {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const marks: { name: string; idx: number }[] = [];
  for (const m of code.matchAll(/(?:export\s+)?function\s+(\w+)\s*\(/g)) {
    marks.push({ name: m[1], idx: m.index ?? 0 });
  }
  const blocks: Record<string, string> = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].idx : code.length;
    blocks[marks[i].name] = code.slice(marks[i].idx, end);
  }
  return blocks;
}

/** Union of `state.<field>` references across the named function blocks. */
function stateRefs(blocks: Record<string, string>, names: string[]): Set<string> {
  const refs = new Set<string>();
  for (const n of names) {
    for (const m of (blocks[n] ?? "").matchAll(/\bstate\.(\w+)/g)) refs.add(m[1]);
  }
  return refs;
}

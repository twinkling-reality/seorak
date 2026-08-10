import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SIGNAL_CATALOG,
  SIGNAL_IDS,
  notificationAvailabilityExplanation,
  sessionToLiveActivity,
  type SessionState,
} from "@seorak/types";

function assertProductCopy(value: string, context: string): void {
  assert.equal(value.includes("·"), false, `${context} joins copy with a middot`);
  assert.equal(
    /\bsignals?\b/i.test(value),
    false,
    `${context} uses the internal catalog noun in product copy`,
  );
}

function session(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: "copy-contract",
    startedAt: "2026-06-15T12:00:00.000Z",
    lastEventAt: "2026-06-15T12:05:00.000Z",
    repoId: "a".repeat(64),
    repoLabel: "seorak",
    agent: "claude-code",
    toolCallCount: 3,
    totalInputTokens: 1_000,
    totalOutputTokens: 500,
    totalCacheReadTokens: 200,
    totalCacheWriteTokens: 100,
    totalCostUsd: 0.42,
    status: "active",
    ...overrides,
  };
}

test("the shared watch catalog keeps its user-visible metadata in product voice", () => {
  for (const id of SIGNAL_IDS) {
    const meta = SIGNAL_CATALOG[id];
    assertProductCopy(meta.label, `${id}.label`);
    assertProductCopy(meta.why, `${id}.why`);
    assertProductCopy(
      notificationAvailabilityExplanation(id, "unavailable") ?? "",
      `${id}.availability`,
    );
    for (const threshold of meta.thresholds) {
      assertProductCopy(threshold.label, `${id}.${threshold.key}.label`);
    }
  }
});

test("every Live Activity state projects product-safe copy", () => {
  const states = [
    session(),
    session({ awaitingInput: true }),
    session({ status: "stuck" }),
    session({ status: "ended", endedAt: "2026-06-15T12:05:00.000Z" }),
    session({ toolCallCount: 0 }),
  ];

  states.forEach((state, index) => {
    const snapshot = sessionToLiveActivity(state);
    assert.equal(snapshot.kind, "liveActivity");
    if (snapshot.kind !== "liveActivity") return;
    const copy = snapshot.liveActivity;
    [
      ["title", copy.title],
      ["body", copy.body],
      ["statusLine", copy.statusLine],
      ["modeLabel", copy.modeLabel],
      ["contextLabel", copy.contextLabel],
    ].forEach(([field, value]) => assertProductCopy(value, `state[${index}].${field}`));
  });
});

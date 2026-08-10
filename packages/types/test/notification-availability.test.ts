import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAPABILITY_REGISTRY,
  NO_CAPABILITIES,
  SIGNAL_CATALOG,
  SIGNAL_IDS,
  deriveNotificationAvailability,
  notificationAvailabilityExplanation,
  resolveNotificationAvailability,
  type AgentId,
  type NotificationAvailability,
  type ResolvedSessionCapabilities,
  type SignalId,
} from "../src/index.ts";

function evidence(agent: AgentId, capabilities: ResolvedSessionCapabilities) {
  return { agent, capabilities };
}

function states(availability: NotificationAvailability, state: string): SignalId[] {
  return SIGNAL_IDS.filter((id) => availability.signals[id].state === state);
}

test("every watch declares the evidence it needs", () => {
  for (const id of SIGNAL_IDS) {
    assert.ok(SIGNAL_CATALOG[id].evidenceRequirements.length > 0, id);
  }
});

test("Claude-only coverage can fire all eight watches", () => {
  const availability = deriveNotificationAvailability([
    evidence("claude-code", CAPABILITY_REGISTRY["claude-code"]!),
  ]);
  assert.deepEqual(states(availability, "available"), SIGNAL_IDS);
  assert.deepEqual(availability.agents, ["claude-code"]);
});

test("Codex-only coverage exposes exactly its five honest watches", () => {
  const availability = deriveNotificationAvailability([
    evidence("codex", CAPABILITY_REGISTRY.codex!),
  ]);
  assert.deepEqual(states(availability, "available"), [
    "long_session",
    "stuck_loop",
    "went_cold",
    "daily_cost_cap",
    "first_error",
  ]);
  assert.deepEqual(states(availability, "unavailable"), [
    "cost_spike",
    "high_burn_rate",
    "session_ended",
  ]);
});

test("mixed coverage keeps a watch when either installed agent can fire it", () => {
  const availability = deriveNotificationAvailability([
    evidence("codex", CAPABILITY_REGISTRY.codex!),
    evidence("claude-code", CAPABILITY_REGISTRY["claude-code"]!),
  ]);
  assert.deepEqual(states(availability, "available"), SIGNAL_IDS);
  assert.deepEqual(availability.signals.session_ended.supportedBy, ["claude-code"]);
  assert.deepEqual(availability.signals.daily_cost_cap.supportedBy, ["claude-code", "codex"]);
});

test("an unknown agent fails closed except for timing proven by its resident session", () => {
  const availability = deriveNotificationAvailability([
    evidence("future-agent", NO_CAPABILITIES),
  ]);
  assert.deepEqual(states(availability, "available"), ["long_session", "went_cold"]);
  assert.deepEqual(states(availability, "unavailable"), [
    "cost_spike",
    "high_burn_rate",
    "stuck_loop",
    "session_ended",
    "daily_cost_cap",
    "first_error",
  ]);
  assert.match(
    notificationAvailabilityExplanation("session_ended", "unavailable")!,
    /cannot fire/,
  );
});

test("no authoritative agent evidence is unknown, not unavailable", () => {
  const availability = deriveNotificationAvailability([]);
  assert.deepEqual(states(availability, "unknown"), SIGNAL_IDS);
  assert.deepEqual(availability.agents, []);
  assert.equal(
    notificationAvailabilityExplanation("cost_spike", "unknown"),
    "Watch availability appears after Seorak captures an agent session.",
  );
});

test("rolling-deploy fallback derives from the older agent ledger only when needed", () => {
  const fallback = [evidence("codex", CAPABILITY_REGISTRY.codex!)];
  const derived = resolveNotificationAvailability(undefined, fallback);
  assert.equal(derived.signals.session_ended.state, "unavailable");

  const explicit = deriveNotificationAvailability([
    evidence("claude-code", CAPABILITY_REGISTRY["claude-code"]!),
  ]);
  assert.equal(resolveNotificationAvailability(explicit, fallback), explicit);
});

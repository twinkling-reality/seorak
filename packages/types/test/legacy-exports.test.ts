import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as capabilities from "../src/capabilities.ts";
import * as pricing from "../src/pricing.ts";
import * as push from "../src/push.ts";
import * as usageAllowance from "../src/usage-allowance.ts";
import * as widgets from "../src/widgets.ts";

function source(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    "utf8",
  );
}

test("the shared stat catalog carries no retired terminal renderer surface", () => {
  for (const name of [
    "isTerminalSignal",
    "terminalColSpan",
    "TERMINAL_SIGNALS",
    "DEFAULT_TERMINAL_LAYOUT",
  ]) {
    assert.equal(name in widgets, false, `${name} must stay deleted`);
  }
  for (const stat of widgets.SEORAK_SIGNALS) {
    assert.equal("terminal" in stat, false, `${stat.id} retained terminal metadata`);
  }

  const code = source("../src/widgets.ts");
  assert.doesNotMatch(code, /\bTerminalViz\b|\bTerminalSignalRender\b/);
});

test("the unconsumed failure-count helper stays out of the public package", () => {
  assert.equal("canCountToolFailures" in capabilities, false);
});

test("unconsumed public symbols stay retired before publication", () => {
  for (const [module, names] of [
    [pricing, ["COST_ESTIMATE_SHORT"]],
    [push, ["PushTokenKindSchema"]],
    [
      usageAllowance,
      ["hasUsageCount", "hasUsagePercent", "usagePercentOf"],
    ],
  ] as const) {
    for (const name of names) {
      assert.equal(name in module, false, `${name} must stay deleted`);
    }
  }
  assert.doesNotMatch(
    source("../src/api.ts"),
    /export\s+type\s+SettingsPatchBody\b/,
  );
  assert.doesNotMatch(
    source("../src/push.ts"),
    /export\s+type\s+(?:PushDeliveryTarget|PushDeliveryStartAttributes)\b/,
  );
});

test("barrels do not restore retired aliases or unsupported surface variants", () => {
  const events = source("../src/events.ts");
  assert.doesNotMatch(
    events,
    /export\s+type\s*\{[^}]*\b(?:CostCapability|SessionCapabilities|ToolResultCapability)\b[^}]*\}/s,
  );

  const index = source("../src/index.ts");
  for (const name of [
    "LiveSurfaceSnapshotWidget",
    "LiveSurfaceSnapshotLockAccessory",
    "LiveSurfaceSnapshotStandby",
    "LiveSurfaceSnapshotControl",
  ]) {
    assert.doesNotMatch(index, new RegExp(`\\b${name}\\b`));
  }
});

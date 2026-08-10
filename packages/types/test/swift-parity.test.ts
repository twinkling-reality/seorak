// The app and extensions compile hand-maintained Swift mirrors of shared wire
// contracts. These tests fail immediately when a package upgrade changes those
// contracts without the corresponding native edit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  NOTIFICATION_CATEGORY_IDS,
  liveSurfaceActivityContentState,
  liveSurfaceNotificationContentEntry,
  liveSurfaceStages,
} from "@mobile-surfaces/surface-contracts";

/**
 * THE MIRRORS MAY NOT BE IN THIS TREE. Every file below is under `apps/mobile`,
 * which ADR 005 keeps in the private repository, and nothing here is a property
 * of @seorak/types at all: this suite compares the app's Swift against the
 * @mobile-surfaces contracts and lives here because this is where the contract
 * tests run without a Swift toolchain. In the public core there is no app to
 * compare, so the cases skip with the reason rather than failing on a missing
 * path. Where the app exists, which is the only place the edit this catches can
 * be made, nothing changes.
 *
 * C4 owns the durable answer: when packages/types leaves the private repository
 * these two parity suites have to go somewhere that still holds both sides.
 */
const MIRROR_ROOT = new URL("../../../apps/mobile/", import.meta.url);
const MIRROR_ABSENT = !existsSync(MIRROR_ROOT);
const SKIP = MIRROR_ABSENT
  ? "apps/mobile is not in this tree; the ownership map keeps the app private"
  : undefined;
const read = (relative: string): string =>
  MIRROR_ABSENT ? "" : readFileSync(new URL(relative, MIRROR_ROOT), "utf8");

const SWIFT = read("targets/widget/SeorakActivityAttributes.swift");
const NOTIFICATION_SWIFT = read(
  "targets/notification-content/MobileSurfacesNotificationContentEntry.swift",
);
const MOBILE_CATEGORIES = read("src/generated/notificationCategories.ts");

interface RuntimeSchema {
  type: string;
  isOptional(): boolean;
  unwrap?(): RuntimeSchema;
}

function swiftContractFields(
  shape: Record<string, unknown>,
  nativeTypes: Readonly<Record<string, string>> = {},
) {
  return Object.entries(shape).map(([name, value]) => {
    const schema = value as RuntimeSchema;
    const optional = schema.isOptional();
    const inner = optional ? schema.unwrap!() : schema;
    const type =
      nativeTypes[name] ??
      (inner.type === "number"
        ? "Double"
        : inner.type === "string" ||
            inner.type === "literal" ||
            inner.type === "enum"
          ? "String"
          : null);
    assert.ok(type, `no Swift scalar mapping for ${name}:${inner.type}`);
    return { name, type, optional };
  });
}

function swiftFields(block: string, declaration: "var" | "let") {
  return [
    ...block.matchAll(
      new RegExp(`\\b${declaration}\\s+(\\w+)\\s*:\\s*([A-Za-z]+)(\\?)?`, "g"),
    ),
  ].map((match) => ({
    name: match[1],
    type: match[2],
    optional: match[3] === "?",
  }));
}

test("Swift ContentState fields match @mobile-surfaces liveSurfaceActivityContentState", { skip: SKIP }, () => {
  const block = SWIFT.match(/struct\s+ContentState[^{]*\{([\s\S]*?)\}/);
  assert.ok(block, "could not locate `struct ContentState` in the Swift file");
  const nativeFields = swiftFields(block[1], "var");
  const contractFields = swiftContractFields(
    liveSurfaceActivityContentState.shape,
    { stage: "Stage" },
  );
  assert.deepEqual(nativeFields, contractFields);
});

test("Swift Stage cases match @mobile-surfaces liveSurfaceStages", { skip: SKIP }, () => {
  const block = SWIFT.match(/enum\s+Stage[^{]*\{([\s\S]*?)\}/);
  assert.ok(block, "could not locate `enum Stage` in the Swift file");
  const swiftCases = [...block[1].matchAll(/\bcase\s+(\w+)/g)].map((m) => m[1]);

  assert.deepEqual(
    new Set(swiftCases),
    new Set(liveSurfaceStages),
    `Swift Stage ${JSON.stringify(swiftCases.sort())} drifted from contract ${JSON.stringify([...liveSurfaceStages].sort())}; update the hand mirror`,
  );
});

test("Swift notification entry matches the shared content-extension contract", { skip: SKIP }, () => {
  const block = NOTIFICATION_SWIFT.match(
    /struct\s+SeorakNotificationContentEntry[^{]*\{([\s\S]*?)\}/,
  );
  assert.ok(block, "could not locate SeorakNotificationContentEntry");
  const nativeFields = swiftFields(block[1], "let");
  const contractFields = swiftContractFields(
    liveSurfaceNotificationContentEntry.shape,
  );

  assert.deepEqual(nativeFields, contractFields);
});

test("mobile notification categories match the installed native contract", { skip: SKIP }, () => {
  const mobileIds = [
    ...MOBILE_CATEGORIES.matchAll(/\bid:\s*"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.deepEqual(mobileIds, [...NOTIFICATION_CATEGORY_IDS]);
});

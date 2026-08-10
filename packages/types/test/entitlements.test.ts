import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENTITLEMENT_CACHE_MAX_MS,
  LOCAL_CAPABILITIES,
  NO_HOSTED_CAPABILITIES,
  hostedCapabilitiesForAuthority,
  parseServerEntitlement,
  resolveEffectiveEntitlements,
  type EntitlementState,
  type SeorakPlan,
  type ServerEntitlement,
} from "../src/index.ts";

const ISSUED_AT = "2026-08-01T12:00:00.000Z";
const REFRESH_AFTER = "2026-08-01T18:00:00.000Z";
const EXPIRES_AT = "2026-08-02T12:00:00.000Z";

function entitlement(
  plan: SeorakPlan = "pro",
  state: EntitlementState = "active",
): ServerEntitlement {
  return {
    schemaVersion: 1,
    authority: "server",
    subject: { kind: plan === "teams" ? "workspace" : "personal", id: "home_01" },
    plan,
    state,
    revision: 7,
    issuedAt: ISSUED_AT,
    refreshAfter: REFRESH_AFTER,
    expiresAt: EXPIRES_AT,
    local: { ...LOCAL_CAPABILITIES },
    hosted: hostedCapabilitiesForAuthority(plan, state),
  };
}

test("the canonical plan matrix keeps every local capability available", () => {
  for (const plan of ["free", "pro", "teams"] as const) {
    const parsed = parseServerEntitlement(entitlement(plan));
    assert.ok(parsed);
    assert.deepEqual(parsed.local, LOCAL_CAPABILITIES);
  }
  assert.deepEqual(
    hostedCapabilitiesForAuthority("free", "active"),
    NO_HOSTED_CAPABILITIES,
  );
  assert.equal(hostedCapabilitiesForAuthority("pro", "active").managedSync, true);
  assert.equal(hostedCapabilitiesForAuthority("pro", "active").sharedWorkspaces, false);
  assert.equal(hostedCapabilitiesForAuthority("teams", "active").sharedWorkspaces, true);
});

test("payment failure disables hosted work without narrowing or deleting local work", () => {
  for (const state of ["past_due", "canceled"] as const) {
    const parsed = parseServerEntitlement(entitlement("pro", state));
    assert.ok(parsed);
    assert.deepEqual(parsed.local, LOCAL_CAPABILITIES);
    assert.deepEqual(parsed.hosted, NO_HOSTED_CAPABILITIES);
  }
  assert.equal(hostedCapabilitiesForAuthority("pro", "grace").managedSync, true);
});

test("server snapshots are strict, short-lived, and internally consistent", () => {
  const valid = entitlement();
  assert.ok(parseServerEntitlement(valid));
  assert.equal(
    Date.parse(valid.expiresAt) - Date.parse(valid.issuedAt),
    ENTITLEMENT_CACHE_MAX_MS,
  );

  assert.equal(parseServerEntitlement({ ...valid, authority: "client" }), null);
  assert.equal(parseServerEntitlement({ ...valid, ownerId: "other" }), null);
  assert.equal(
    parseServerEntitlement({
      ...valid,
      local: { ...valid.local, replay: false },
    }),
    null,
  );
  assert.equal(
    parseServerEntitlement({
      ...valid,
      hosted: { ...valid.hosted, sharedWorkspaces: true },
    }),
    null,
  );
  assert.equal(
    parseServerEntitlement({ ...valid, expiresAt: "2026-08-02T12:00:00.001Z" }),
    null,
  );
});

test("missing, malformed, and expired cache entries fail closed only for hosting", () => {
  for (const value of [null, { plan: "pro" }, entitlement()]) {
    const effective = resolveEffectiveEntitlements(
      value,
      Date.parse(EXPIRES_AT),
    );
    assert.equal(effective.source, "local-default");
    assert.deepEqual(effective.local, LOCAL_CAPABILITIES);
    assert.deepEqual(effective.hosted, NO_HOSTED_CAPABILITIES);
  }

  const current = resolveEffectiveEntitlements(
    entitlement("teams"),
    Date.parse(REFRESH_AFTER),
  );
  assert.equal(current.source, "server");
  assert.equal(current.plan, "teams");
  assert.equal(current.hosted.sharedWorkspaces, true);
});

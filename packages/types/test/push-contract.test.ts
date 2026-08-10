import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DeliveryTestRequestSchema,
  APNS_ENVIRONMENTS,
  DeviceEnvironmentObservationSchema,
  DeviceTokenObservationSchema,
  PUSH_DELIVERY_ALERT_BODY_LIMIT,
  PUSH_TOKEN_KIND_BY_OPERATION,
  PushDeliveryOutcomeSchema,
  PushDeliveryRequestSchema,
  isApnsEnvironment,
  parseDeliveryTestRequest,
  parseDeviceTokenObservation,
  parsePushDeliveryOutcome,
  parsePushDeliveryOutcomeForRequest,
  parsePushDeliveryRequest,
} from "../src/push.ts";

describe("APNs environment contract", () => {
  it("has exactly the two Apple token environments", () => {
    assert.deepEqual(APNS_ENVIRONMENTS, ["development", "production"]);
    assert.equal(isApnsEnvironment("development"), true);
    assert.equal(isApnsEnvironment("production"), true);
    for (const value of [undefined, null, "", "sandbox", "unknown"]) {
      assert.equal(isApnsEnvironment(value), false);
    }
  });

  it("keeps delivery tests environment-explicit and content-free", () => {
    const request = {
      schemaVersion: 1,
      apnsEnvironment: "development",
      kind: "notification",
    } as const;
    assert.deepEqual(parseDeliveryTestRequest(request), request);
    for (const invalid of [
      { ...request, apnsEnvironment: "sandbox" },
      { ...request, kind: "liveActivity" },
      { ...request, token: "secret" },
      { ...request, body: "client-authored copy" },
      { kind: "notification" },
    ]) {
      assert.equal(DeliveryTestRequestSchema.safeParse(invalid).success, false);
    }
  });

  it("extends the token wire with exact revisions and keeps environments strict", () => {
    const observation = {
      kind: "apnsDevice",
      token: "token",
      environment: "production",
      recordedAt: "2026-07-27T12:00:00.000Z",
      lifecycle: "active",
      idempotencyKey: "a".repeat(64),
      schemaVersion: "1",
    };
    assert.deepEqual(parseDeviceTokenObservation(observation), observation);
    assert.equal(DeviceTokenObservationSchema.safeParse(observation).success, true);
    assert.equal(
      DeviceTokenObservationSchema.safeParse({
        ...observation,
        idempotencyKey: "not-a-token-revision",
      }).success,
      false,
    );
    assert.equal(
      DeviceEnvironmentObservationSchema.safeParse({
        deviceId: "device-1",
        apnsEnvironment: "production",
        authorityRevision: 1,
      }).success,
      true,
    );
    assert.equal(
      DeviceEnvironmentObservationSchema.safeParse({
        deviceId: "device-1",
        apnsEnvironment: "production",
        authorityRevision: 1,
        token: "not-allowed",
      }).success,
      false,
    );
    assert.equal(
      DeviceEnvironmentObservationSchema.safeParse({
        deviceId: "device-1",
        apnsEnvironment: "production",
        authorityRevision: 0,
      }).success,
      false,
    );
  });
});

const deliveryId = "11111111-1111-4111-8111-111111111111";
const tokenRevision = "a".repeat(64);

const liveSnapshot = {
  schemaVersion: "5",
  kind: "liveActivity",
  id: "snapshot-live",
  surfaceId: "surface-live",
  updatedAt: "2026-07-27T12:00:00.000Z",
  state: "active",
  liveActivity: {
    title: "Working",
    body: "Seorak is working.",
    progress: 0.5,
    deepLink: "seorak://session/session-1",
    modeLabel: "Build",
    contextLabel: "seorak",
    statusLine: "Running",
    stage: "inProgress",
    estimatedSeconds: 60,
    morePartsCount: 0,
  },
} as const;

const notificationSnapshot = {
  schemaVersion: "5",
  kind: "notification",
  id: "snapshot-notification",
  surfaceId: "surface-notification",
  updatedAt: "2026-07-27T12:00:00.000Z",
  state: "attention",
  notification: {
    title: "Cost spike",
    body: "A measured sentence.",
    deepLink: "seorak://session/session-1",
  },
} as const;

function target(
  tokenKind: "apnsDevice" | "pushToStart" | "perActivity",
) {
  return {
    deviceId: "device-1",
    environment: "development",
    tokenKind,
    tokenRevision,
    token: "device-token",
  } as const;
}

describe("stateless push delivery contract", () => {
  it("maps every operation to exactly one token kind", () => {
    assert.deepEqual(PUSH_TOKEN_KIND_BY_OPERATION, {
      notification: "apnsDevice",
      liveStart: "pushToStart",
      liveUpdate: "perActivity",
      liveEnd: "perActivity",
    });
  });

  it("accepts each exact operation and token pairing", () => {
    const requests = [
      {
        schemaVersion: 1,
        deliveryId,
        operation: "notification",
        target: target("apnsDevice"),
        snapshot: notificationSnapshot,
        sendOptions: { priority: 10, collapseId: "session-1" },
      },
      {
        schemaVersion: 1,
        deliveryId,
        operation: "liveStart",
        target: target("pushToStart"),
        snapshot: liveSnapshot,
        attributes: {
          surfaceId: liveSnapshot.surfaceId,
          modeLabel: liveSnapshot.liveActivity.modeLabel,
          liveGeneration: 1,
          accentToken: "indigo",
          startedAt: 1_774_782_000,
        },
        sendOptions: {
          priority: 10,
          staleDateSeconds: 1_774_782_300,
          alert: { title: "Working", body: "Seorak is working." },
        },
      },
      {
        schemaVersion: 1,
        deliveryId,
        operation: "liveUpdate",
        target: target("perActivity"),
        snapshot: liveSnapshot,
        sendOptions: { priority: 5, staleDateSeconds: 1_774_782_300 },
      },
      {
        schemaVersion: 1,
        deliveryId,
        operation: "liveEnd",
        target: target("perActivity"),
        snapshot: liveSnapshot,
        sendOptions: { priority: 10, dismissalDateSeconds: 1_774_782_300 },
      },
    ];

    for (const request of requests) {
      assert.notEqual(parsePushDeliveryRequest(request), null);
    }
  });

  it("rejects operation inference, unclassified revisions, and loose fields", () => {
    const update = {
      schemaVersion: 1,
      deliveryId,
      operation: "liveUpdate",
      target: target("pushToStart"),
      snapshot: liveSnapshot,
    };
    assert.equal(parsePushDeliveryRequest(update), null);
    assert.equal(
      parsePushDeliveryRequest({
        ...update,
        target: { ...target("perActivity"), tokenRevision: "A".repeat(64) },
      }),
      null,
    );
    assert.equal(
      parsePushDeliveryRequest({
        ...update,
        target: target("perActivity"),
        intent: "start",
      }),
      null,
    );
    assert.equal(
      PushDeliveryRequestSchema.safeParse({
        ...update,
        target: target("perActivity"),
        snapshot: notificationSnapshot,
      }).success,
      false,
    );
  });

  it("bounds start alerts and attributes and requires snapshot agreement", () => {
    const start = {
      schemaVersion: 1,
      deliveryId,
      operation: "liveStart",
      target: target("pushToStart"),
      snapshot: liveSnapshot,
      attributes: {
        surfaceId: liveSnapshot.surfaceId,
        modeLabel: liveSnapshot.liveActivity.modeLabel,
        liveGeneration: 1,
      },
      sendOptions: {
        alert: { title: "Working", body: "Seorak is working." },
      },
    };
    assert.equal(PushDeliveryRequestSchema.safeParse(start).success, true);
    assert.equal(
      PushDeliveryRequestSchema.safeParse({
        ...start,
        attributes: { ...start.attributes, modeLabel: "wrong" },
      }).success,
      false,
    );
    assert.equal(
      PushDeliveryRequestSchema.safeParse({
        ...start,
        attributes: { ...start.attributes, unbounded: "value" },
      }).success,
      false,
    );
    assert.equal(
      PushDeliveryRequestSchema.safeParse({
        ...start,
        sendOptions: {
          alert: {
            title: "Working",
            body: "x".repeat(PUSH_DELIVERY_ALERT_BODY_LIMIT + 1),
          },
        },
      }).success,
      false,
    );
  });

  it("validates safe outcomes and correlates them to the request", () => {
    const request = parsePushDeliveryRequest({
      schemaVersion: 1,
      deliveryId,
      operation: "notification",
      target: target("apnsDevice"),
      snapshot: notificationSnapshot,
    });
    assert.ok(request);
    const outcome = {
      schemaVersion: 1,
      deliveryId,
      apnsId: deliveryId,
      operation: "notification",
      target: {
        deviceId: "device-1",
        environment: "development",
        tokenKind: "apnsDevice",
        tokenRevision,
      },
      observedAt: "2026-07-27T12:00:00.000Z",
      outcome: "delivered",
      apnsStatus: 200,
      attempts: 1,
      latencyMs: 12,
      retryCount: 0,
    } as const;

    assert.deepEqual(parsePushDeliveryOutcome(outcome), outcome);
    assert.deepEqual(
      parsePushDeliveryOutcomeForRequest(outcome, request),
      outcome,
    );
    assert.equal(
      parsePushDeliveryOutcomeForRequest(
        {
          ...outcome,
          target: { ...outcome.target, tokenRevision: "b".repeat(64) },
        },
        request,
      ),
      null,
    );
    assert.equal(
      PushDeliveryOutcomeSchema.safeParse({
        ...outcome,
        apnsId: "22222222-2222-4222-8222-222222222222",
      }).success,
      false,
    );
  });

  it("never accepts tokens, raw errors, or bodies in outcomes", () => {
    const base = {
      schemaVersion: 1,
      deliveryId,
      apnsId: deliveryId,
      operation: "liveUpdate",
      target: {
        deviceId: "device-1",
        environment: "development",
        tokenKind: "perActivity",
        tokenRevision,
      },
      observedAt: "2026-07-27T12:00:00.000Z",
      outcome: "retryable",
      reason: "rateLimited",
      retryAfterSeconds: 60,
    } as const;
    assert.notEqual(parsePushDeliveryOutcome(base), null);
    for (const extra of [
      { token: "secret-token" },
      { error: "raw APNs error" },
      { body: "raw APNs body" },
    ]) {
      assert.equal(parsePushDeliveryOutcome({ ...base, ...extra }), null);
    }
  });
});

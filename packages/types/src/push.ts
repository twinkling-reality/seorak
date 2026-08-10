import {
  liveSurfaceSnapshotLiveActivity,
  liveSurfaceSnapshotNotification,
} from "@mobile-surfaces/surface-contracts";
import { z } from "zod";

export const APNS_ENVIRONMENTS = ["development", "production"] as const;
export type ApnsEnvironment = (typeof APNS_ENVIRONMENTS)[number];

export const APNS_TOKEN_STRING_LIMIT = 4_096;
export const DEVICE_ID_STRING_LIMIT = 256;
export const PUSH_DELIVERY_SCHEMA_VERSION = 1;
export const PUSH_DELIVERY_OPERATIONS = [
  "notification",
  "liveStart",
  "liveUpdate",
  "liveEnd",
] as const;
export const PUSH_TOKEN_KINDS = [
  "apnsDevice",
  "pushToStart",
  "perActivity",
] as const;
export const PUSH_TOKEN_KIND_BY_OPERATION = {
  notification: "apnsDevice",
  liveStart: "pushToStart",
  liveUpdate: "perActivity",
  liveEnd: "perActivity",
} as const satisfies Record<PushDeliveryOperation, PushTokenKind>;

export const PUSH_DELIVERY_ALERT_TITLE_LIMIT = 178;
export const PUSH_DELIVERY_ALERT_BODY_LIMIT = 512;
export const PUSH_DELIVERY_ATTRIBUTE_STRING_LIMIT = 256;
export const PUSH_DELIVERY_COLLAPSE_ID_LIMIT = 64;
export const PUSH_DELIVERY_RETRY_AFTER_SECONDS_LIMIT = 86_400;

const token = z.string().min(1).max(APNS_TOKEN_STRING_LIMIT);
const deviceId = z.string().min(1).max(DEVICE_ID_STRING_LIMIT);
const tokenRevision = z.string().regex(/^[a-f0-9]{64}$/);
const positiveSafeInteger = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const unixSeconds = z.number().int().nonnegative().max(4_102_444_800);
const deliveryId = z.uuid();

export const ApnsEnvironmentSchema = z.enum(APNS_ENVIRONMENTS);
export const PushDeliveryOperationSchema = z.enum(PUSH_DELIVERY_OPERATIONS);

/**
 * What a device posts when it forwards a token. This is the same shape
 * `@mobile-surfaces/tokens/wire` publishes, and it used to be imported from
 * there.
 *
 * WHY IT IS OWNED HERE. That import cost the public core an entire dependency
 * graph. The tokens package depends on `@mobile-surfaces/live-activity`, whose
 * `expo` and `react-native` peers are NOT optional, so npm installed a complete
 * mobile toolchain in order to typecheck eight fields of zod that touch none of
 * it: 429 of 697 lockfile entries, in a repository with no mobile application
 * in it. npm resolves whole packages rather than subpaths, so there was no way
 * to take the wire contract without the toolchain behind it.
 *
 * WHAT KEEPS THE COPY HONEST. `apps/mobile/test/tokenWireContract.test.mts`
 * compares this against the published schema field by field and payload by
 * payload. It lives there because that app is the only workspace declaring both
 * packages, and a parity suite beside the contract would mean this package
 * importing the very thing it deliberately does not depend on. That is the same
 * trade `swift-parity.test.ts` already makes for the app's Swift mirrors: where
 * a contract is duplicated across a boundary, a test rather than an import is
 * what stops the halves drifting.
 */
export const DeviceTokenObservationWireSchema = z
  .object({
    kind: z.enum(["pushToStart", "perActivity", "apnsDevice"]),
    token: z.string().min(1),
    activityId: z.string().optional(),
    environment: z.enum(["development", "production"]),
    recordedAt: z.iso.datetime(),
    lifecycle: z.enum(["active", "ending", "dead"]),
    idempotencyKey: z.string().min(1),
    schemaVersion: z.literal("1"),
  })
  .strict();

export const DeviceTokenObservationSchema =
  DeviceTokenObservationWireSchema.superRefine((observation, context) => {
    if (!tokenRevision.safeParse(observation.idempotencyKey).success) {
      context.addIssue({
        code: "custom",
        path: ["idempotencyKey"],
        message: "must be a 64-character lowercase hexadecimal token revision",
      });
    }
  });
export const DeviceEnvironmentObservationSchema = z
  .object({
    deviceId,
    apnsEnvironment: ApnsEnvironmentSchema,
    authorityRevision: positiveSafeInteger,
  })
  .strict();
export const DeliveryTestRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    apnsEnvironment: ApnsEnvironmentSchema,
    kind: z.literal("notification"),
  })
  .strict();

export type DeviceTokenObservationInput = z.infer<
  typeof DeviceTokenObservationWireSchema
>;
export type DeviceEnvironmentObservation = z.infer<
  typeof DeviceEnvironmentObservationSchema
>;
export type DeliveryTestRequest = z.infer<typeof DeliveryTestRequestSchema>;
export type PushDeliveryOperation = (typeof PUSH_DELIVERY_OPERATIONS)[number];
export type PushTokenKind = (typeof PUSH_TOKEN_KINDS)[number];

const targetShape = {
  deviceId,
  environment: ApnsEnvironmentSchema,
  tokenRevision,
  token,
};

const receiptTargetShape = {
  deviceId,
  environment: ApnsEnvironmentSchema,
  tokenRevision,
};

function targetSchema<const TKind extends PushTokenKind>(kind: TKind) {
  return z
    .object({
      ...targetShape,
      tokenKind: z.literal(kind),
    })
    .strict();
}

function receiptTargetSchema<const TKind extends PushTokenKind>(kind: TKind) {
  return z
    .object({
      ...receiptTargetShape,
      tokenKind: z.literal(kind),
    })
    .strict();
}

export const PushDeliveryTargetSchema = z.discriminatedUnion("tokenKind", [
  targetSchema("apnsDevice"),
  targetSchema("pushToStart"),
  targetSchema("perActivity"),
]);

export const PushDeliveryReceiptTargetSchema = z.discriminatedUnion(
  "tokenKind",
  [
    receiptTargetSchema("apnsDevice"),
    receiptTargetSchema("pushToStart"),
    receiptTargetSchema("perActivity"),
  ],
);

const commonSendOptionsShape = {
  priority: z.union([z.literal(5), z.literal(10)]).optional(),
  expirationSeconds: unixSeconds.optional(),
};

const notificationSendOptions = z
  .object({
    ...commonSendOptionsShape,
    collapseId: z
      .string()
      .min(1)
      .max(PUSH_DELIVERY_COLLAPSE_ID_LIMIT)
      .regex(/^[\x20-\x7e]+$/)
      .optional(),
  })
  .strict();

const liveSendOptionsShape = {
  ...commonSendOptionsShape,
  relevanceScore: z.number().finite().min(0).max(1).optional(),
};

const liveStartSendOptions = z
  .object({
    ...liveSendOptionsShape,
    staleDateSeconds: unixSeconds.optional(),
    alert: z
      .object({
        title: z.string().min(1).max(PUSH_DELIVERY_ALERT_TITLE_LIMIT),
        body: z.string().min(1).max(PUSH_DELIVERY_ALERT_BODY_LIMIT),
        sound: z.literal("default").optional(),
      })
      .strict(),
  })
  .strict();

const liveUpdateSendOptions = z
  .object({
    ...liveSendOptionsShape,
    staleDateSeconds: unixSeconds.optional(),
  })
  .strict();

const liveEndSendOptions = z
  .object({
    ...liveSendOptionsShape,
    dismissalDateSeconds: unixSeconds.optional(),
  })
  .strict();

export const PushDeliveryStartAttributesSchema = z
  .object({
    surfaceId: z.string().min(1).max(PUSH_DELIVERY_ATTRIBUTE_STRING_LIMIT),
    modeLabel: z.string().min(1).max(PUSH_DELIVERY_ATTRIBUTE_STRING_LIMIT),
    liveGeneration: positiveSafeInteger,
    accentToken: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/)
      .optional(),
    startedAt: unixSeconds.optional(),
  })
  .strict();

const requestBaseShape = {
  schemaVersion: z.literal(PUSH_DELIVERY_SCHEMA_VERSION),
  deliveryId,
};

const pushDeliveryRequest = z.discriminatedUnion("operation", [
  z
    .object({
      ...requestBaseShape,
      operation: z.literal("notification"),
      target: targetSchema("apnsDevice"),
      snapshot: liveSurfaceSnapshotNotification,
      sendOptions: notificationSendOptions.optional(),
    })
    .strict(),
  z
    .object({
      ...requestBaseShape,
      operation: z.literal("liveStart"),
      target: targetSchema("pushToStart"),
      snapshot: liveSurfaceSnapshotLiveActivity,
      attributes: PushDeliveryStartAttributesSchema,
      sendOptions: liveStartSendOptions,
    })
    .strict(),
  z
    .object({
      ...requestBaseShape,
      operation: z.literal("liveUpdate"),
      target: targetSchema("perActivity"),
      snapshot: liveSurfaceSnapshotLiveActivity,
      sendOptions: liveUpdateSendOptions.optional(),
    })
    .strict(),
  z
    .object({
      ...requestBaseShape,
      operation: z.literal("liveEnd"),
      target: targetSchema("perActivity"),
      snapshot: liveSurfaceSnapshotLiveActivity,
      sendOptions: liveEndSendOptions.optional(),
    })
    .strict(),
]);

export const PushDeliveryRequestSchema = pushDeliveryRequest.superRefine(
  (request, context) => {
    if (request.operation !== "liveStart") return;
    if (request.attributes.surfaceId !== request.snapshot.surfaceId) {
      context.addIssue({
        code: "custom",
        path: ["attributes", "surfaceId"],
        message: "must match snapshot.surfaceId",
      });
    }
    if (request.attributes.modeLabel !== request.snapshot.liveActivity.modeLabel) {
      context.addIssue({
        code: "custom",
        path: ["attributes", "modeLabel"],
        message: "must match snapshot.liveActivity.modeLabel",
      });
    }
  },
);

const outcomeBaseShape = {
  schemaVersion: z.literal(PUSH_DELIVERY_SCHEMA_VERSION),
  deliveryId,
  apnsId: deliveryId,
  operation: PushDeliveryOperationSchema,
  target: PushDeliveryReceiptTargetSchema,
  observedAt: z.iso.datetime({ offset: true }),
};

const apnsStatus = z.number().int().min(100).max(599);

const pushDeliveryOutcome = z.discriminatedUnion("outcome", [
  z
    .object({
      ...outcomeBaseShape,
      outcome: z.literal("delivered"),
      apnsStatus: z.number().int().min(200).max(299),
      attempts: z.number().int().positive().max(100),
      latencyMs: z.number().int().nonnegative().max(600_000),
      retryCount: z.number().int().nonnegative().max(99),
    })
    .strict(),
  z
    .object({
      ...outcomeBaseShape,
      outcome: z.literal("tokenInvalid"),
      reason: z.enum(["badDeviceToken", "unregistered"]),
      apnsStatus: apnsStatus.optional(),
    })
    .strict(),
  z
    .object({
      ...outcomeBaseShape,
      outcome: z.literal("retryable"),
      reason: z.enum([
        "deadline",
        "invalidReceipt",
        "rateLimited",
        "serviceUnavailable",
        "transport",
      ]),
      retryAfterSeconds: z
        .number()
        .int()
        .nonnegative()
        .max(PUSH_DELIVERY_RETRY_AFTER_SECONDS_LIMIT)
        .optional(),
      apnsStatus: apnsStatus.optional(),
    })
    .strict(),
  z
    .object({
      ...outcomeBaseShape,
      outcome: z.literal("permanentFailure"),
      reason: z.enum([
        "environmentMismatch",
        "invalidPayload",
        "providerConfiguration",
        "topicConfiguration",
        "apnsRejected",
      ]),
      apnsStatus: apnsStatus.optional(),
    })
    .strict(),
]);

export const PushDeliveryOutcomeSchema = pushDeliveryOutcome.superRefine(
  (outcome, context) => {
    if (outcome.apnsId !== outcome.deliveryId) {
      context.addIssue({
        code: "custom",
        path: ["apnsId"],
        message: "must match deliveryId",
      });
    }
    const expectedKind = PUSH_TOKEN_KIND_BY_OPERATION[outcome.operation];
    if (outcome.target.tokenKind !== expectedKind) {
      context.addIssue({
        code: "custom",
        path: ["target", "tokenKind"],
        message: `must be ${expectedKind} for ${outcome.operation}`,
      });
    }
    if (
      outcome.outcome !== "retryable" &&
      "retryAfterSeconds" in outcome
    ) {
      context.addIssue({
        code: "custom",
        path: ["retryAfterSeconds"],
        message: "is only valid for retryable outcomes",
      });
    }
  },
);

export type PushDeliveryReceiptTarget = z.infer<
  typeof PushDeliveryReceiptTargetSchema
>;
export type PushDeliveryRequest = z.infer<typeof PushDeliveryRequestSchema>;
export type PushDeliveryOutcome = z.infer<typeof PushDeliveryOutcomeSchema>;

export function isApnsEnvironment(
  value: unknown,
): value is ApnsEnvironment {
  return ApnsEnvironmentSchema.safeParse(value).success;
}

export function parseDeviceTokenObservation(
  value: unknown,
): DeviceTokenObservationInput | null {
  const parsed = DeviceTokenObservationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseDeviceEnvironmentObservation(
  value: unknown,
): DeviceEnvironmentObservation | null {
  const parsed = DeviceEnvironmentObservationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseDeliveryTestRequest(
  value: unknown,
): DeliveryTestRequest | null {
  const parsed = DeliveryTestRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parsePushDeliveryRequest(
  value: unknown,
): PushDeliveryRequest | null {
  const parsed = PushDeliveryRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parsePushDeliveryOutcome(
  value: unknown,
): PushDeliveryOutcome | null {
  const parsed = PushDeliveryOutcomeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parsePushDeliveryOutcomeForRequest(
  value: unknown,
  request: PushDeliveryRequest,
): PushDeliveryOutcome | null {
  const outcome = parsePushDeliveryOutcome(value);
  if (!outcome) return null;
  if (
    outcome.deliveryId !== request.deliveryId ||
    outcome.apnsId !== request.deliveryId ||
    outcome.operation !== request.operation ||
    outcome.target.deviceId !== request.target.deviceId ||
    outcome.target.environment !== request.target.environment ||
    outcome.target.tokenKind !== request.target.tokenKind ||
    outcome.target.tokenRevision !== request.target.tokenRevision
  ) {
    return null;
  }
  return outcome;
}

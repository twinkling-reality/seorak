// Interventions, delivery health, thresholds, notification availability.
import { z } from 'zod';
import { PUSH_DELIVERY_HEALTH_WINDOW_DAYS } from '@seorak/types';
import type {
  Intervention,
  InterventionThresholds,
  PushDeliveryHealth,
  NotificationAvailability,
  UsageAllowance,
} from '@seorak/types';

export const interventionSchema: z.ZodType<Intervention> = z.object({
  kind: z.enum([
    'cost_spike',
    'high_burn_rate',
    'long_session',
    'stuck_loop',
    'went_cold',
    'session_ended',
    'daily_cost_cap',
    'first_error',
  ]),
  sessionId: z.string(),
  project: z.string(),
  repoId: z.string(),
  triggeredAt: z.string(),
  signalLabel: z.string(),
  body: z.string(),
  deepLink: z.string(),
  interruptionLevel: z.enum(['passive', 'active', 'timeSensitive']).optional(),
  held: z.boolean().optional(),
}) as unknown as z.ZodType<Intervention>;

export const interventionsArraySchema: z.ZodType<Intervention[]> = z.array(interventionSchema);

const unobservedDeliveryEnvironmentSchema = z.object({
  registeredDevices: z.number().int().nonnegative(),
  state: z.literal('unobserved'),
  completedAttempts: z.null(),
  lastCompletedAt: z.null(),
  lastAcceptedAt: z.null(),
  terminalFailures: z.null(),
  lastTerminalAt: z.null(),
});

const observedDeliveryEnvironmentSchema = z.object({
  registeredDevices: z.number().int().nonnegative(),
  state: z.literal('observed'),
  completedAttempts: z.number().int().positive(),
  lastCompletedAt: z.string().datetime(),
  lastAcceptedAt: z.string().datetime().nullable(),
  terminalFailures: z.number().int().nonnegative(),
  lastTerminalAt: z.string().datetime().nullable(),
}).refine(
  (value) =>
    (value.terminalFailures === 0 && value.lastTerminalAt === null) ||
    (value.terminalFailures > 0 && value.lastTerminalAt !== null),
  { message: 'terminal failure count and timestamp disagree' },
);

export const pushDeliveryHealthSchema: z.ZodType<PushDeliveryHealth> = z.object({
  observedAt: z.string().datetime(),
  windowDays: z.literal(PUSH_DELIVERY_HEALTH_WINDOW_DAYS),
  environments: z.object({
    development: z.union([
      unobservedDeliveryEnvironmentSchema,
      observedDeliveryEnvironmentSchema,
    ]),
    production: z.union([
      unobservedDeliveryEnvironmentSchema,
      observedDeliveryEnvironmentSchema,
    ]),
  }),
}) as unknown as z.ZodType<PushDeliveryHealth>;

export const interventionThresholdsSchema: z.ZodType<InterventionThresholds> = z.object({
  costSpikeUsd: z.number(),
  longSessionMinutes: z.number(),
  highBurnRateUsdPerMinute: z.number(),
  stuckLoopRepeatedToolCalls: z.number(),
  stuckLoopErroredToolCalls: z.number(),
  wentColdMinutes: z.number(),
  dailyCostCapUsd: z.number(),
}) as unknown as z.ZodType<InterventionThresholds>;

// Asserted against UsageAllowance so the shared-union gate pairs the period /
// unit / source enums after this schema left the overviewSnapshot nest.
export const usageAllowanceSchema: z.ZodType<UsageAllowance> = z.object({
  tool: z.string(),
  period: z.enum(["rolling-5h", "weekly"]),
  // COUNT leg — null on a tool that reports a ratio and no absolute terms (Codex).
  consumed: z.number().nullable(),
  unit: z.enum(["tokens", "requests", "messages"]).nullable(),
  allowance: z.number().nullable(),
  // RATIO leg — the provider's own percentage. Null on a tool we count ourselves.
  usedPercent: z.number().nullable(),
  resetsAt: z.string().nullable(),
  observedAt: z.string().nullable(),
  source: z.enum(["none", "self-calibrated", "plan-estimate", "provider-auth"]),
  coverageComplete: z.boolean(),
}) as unknown as z.ZodType<UsageAllowance>;

const notificationSignalAvailabilitySchema = z.object({
  state: z.enum(['available', 'unavailable', 'unknown']),
  supportedBy: z.array(z.string()),
});

export const notificationAvailabilitySchema: z.ZodType<NotificationAvailability> = z.object({
  agents: z.array(z.string()),
  signals: z.object({
    cost_spike: notificationSignalAvailabilitySchema,
    high_burn_rate: notificationSignalAvailabilitySchema,
    long_session: notificationSignalAvailabilitySchema,
    stuck_loop: notificationSignalAvailabilitySchema,
    went_cold: notificationSignalAvailabilitySchema,
    session_ended: notificationSignalAvailabilitySchema,
    daily_cost_cap: notificationSignalAvailabilitySchema,
    first_error: notificationSignalAvailabilitySchema,
  }),
}) as unknown as z.ZodType<NotificationAvailability>;

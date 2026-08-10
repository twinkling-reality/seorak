/**
 * Product-visible facts from the worker's durable push delivery ledger.
 *
 * APNs acceptance is not device receipt. These names preserve that distinction,
 * and the discriminated union makes an empty observation window impossible to
 * mistake for zero failures.
 */
export const PUSH_DELIVERY_HEALTH_WINDOW_DAYS = 30 as const;

export type PushDeliveryEnvironment = "development" | "production";

interface PushDeliveryEnvironmentHealthBase {
  /** Current device authority rows in this APNs environment. */
  registeredDevices: number;
}

export interface UnobservedPushDeliveryEnvironmentHealth
  extends PushDeliveryEnvironmentHealthBase {
  state: "unobserved";
  completedAttempts: null;
  lastCompletedAt: null;
  lastAcceptedAt: null;
  terminalFailures: null;
  lastTerminalAt: null;
}

export interface ObservedPushDeliveryEnvironmentHealth
  extends PushDeliveryEnvironmentHealthBase {
  state: "observed";
  /** Completed transport attempts in the trailing retained window. */
  completedAttempts: number;
  lastCompletedAt: string;
  /** Latest APNs acceptance, not proof that a device displayed the push. */
  lastAcceptedAt: string | null;
  terminalFailures: number;
  lastTerminalAt: string | null;
}

export type PushDeliveryEnvironmentHealth =
  | UnobservedPushDeliveryEnvironmentHealth
  | ObservedPushDeliveryEnvironmentHealth;

export interface PushDeliveryHealth {
  observedAt: string;
  windowDays: typeof PUSH_DELIVERY_HEALTH_WINDOW_DAYS;
  environments: Record<
    PushDeliveryEnvironment,
    PushDeliveryEnvironmentHealth
  >;
}

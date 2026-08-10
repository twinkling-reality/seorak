/**
 * Publish-safe product entitlement contract.
 *
 * Local work belongs to the owner and never depends on a subscription or a
 * cached server decision. Hosted capabilities are separate, server-issued,
 * short-lived grants. A missing, malformed, or expired grant therefore turns
 * off hosted work without narrowing local capture, history, statistics, replay,
 * reports, or export.
 */

export const SEORAK_PLANS = ["free", "pro", "teams"] as const;
export type SeorakPlan = (typeof SEORAK_PLANS)[number];

export const ENTITLEMENT_STATES = [
  "active",
  "grace",
  "past_due",
  "canceled",
] as const;
export type EntitlementState = (typeof ENTITLEMENT_STATES)[number];

export const ENTITLEMENT_SCHEMA_VERSION = 1 as const;
/** A client must revalidate at least daily. Expiry always wins. */
export const ENTITLEMENT_CACHE_MAX_MS = 24 * 60 * 60 * 1_000;

/**
 * The revision a cell holds before any billing decision has been made about it.
 *
 * A cell applies a pushed authority only when its revision is STRICTLY greater
 * than the one it holds, which is the anti-rollback guard that stops a delayed
 * push from resurrecting older state. That guard turned into a silent failure
 * because two independent counters both started at 1: provisioning seeded a new
 * cell with a synthetic "no billing row yet" authority at revision 1, and the
 * canonical ledger wrote its FIRST real entitlement at revision 1 as well. `1 >
 * 1` is false, so the first purchase changed nothing in the cell, the webhook
 * answered the provider 200, and the customer paid for a cell that stayed Free
 * until the next event that both bumped the revision and arrived while the cell
 * was ready: about 30 days on monthly and about 365 on annual.
 *
 * Separating the two spaces is what fixes it. This value is the bootstrap
 * revision and belongs to provisioning alone; every revision the ledger issues
 * is strictly greater, so a real billing decision always beats the placeholder.
 * Relaxing the cell's comparison to `>=` would have been the other way to make
 * `1 > 1` stop mattering, and it would have destroyed the anti-rollback
 * property that the guard exists for.
 */
export const MANAGED_ENTITLEMENT_BOOTSTRAP_REVISION = 1;

/** The first revision the canonical billing ledger may issue for a subject. */
export const FIRST_BILLING_ENTITLEMENT_REVISION =
  MANAGED_ENTITLEMENT_BOOTSTRAP_REVISION + 1;

export interface LocalCapabilities {
  capture: true;
  completeHistory: true;
  statistics: true;
  replay: true;
  reports: true;
  export: true;
}

export interface HostedCapabilities {
  managedSync: boolean;
  encryptedBackup: boolean;
  multipleComputers: boolean;
  remoteVisibility: boolean;
  pushNotifications: boolean;
  liveActivities: boolean;
  interventionAlerts: boolean;
  crossDeviceContinuity: boolean;
  hostedReplay: boolean;
  weeklyOutcomeSummaries: boolean;
  sharedWorkspaces: boolean;
  teamOutcomeRollups: boolean;
  privacyControls: boolean;
  administration: boolean;
  audit: boolean;
  securityControls: boolean;
}

export interface EntitlementSubject {
  kind: "personal" | "workspace";
  /** Opaque server-issued home id, never an authorization selector by itself. */
  id: string;
}

export interface ServerEntitlement {
  schemaVersion: typeof ENTITLEMENT_SCHEMA_VERSION;
  /** Provenance marker only. Hosted services re-resolve grants from auth state. */
  authority: "server";
  subject: EntitlementSubject;
  plan: SeorakPlan;
  state: EntitlementState;
  revision: number;
  issuedAt: string;
  refreshAfter: string;
  expiresAt: string;
  local: LocalCapabilities;
  hosted: HostedCapabilities;
}

export interface EffectiveEntitlements {
  source: "local-default" | "server";
  plan: SeorakPlan;
  state: EntitlementState;
  revision: number | null;
  subject: EntitlementSubject | null;
  local: LocalCapabilities;
  hosted: HostedCapabilities;
  refreshAfter: string | null;
  expiresAt: string | null;
}

export const LOCAL_CAPABILITIES: LocalCapabilities = Object.freeze({
  capture: true,
  completeHistory: true,
  statistics: true,
  replay: true,
  reports: true,
  export: true,
});

export const NO_HOSTED_CAPABILITIES: HostedCapabilities = Object.freeze({
  managedSync: false,
  encryptedBackup: false,
  multipleComputers: false,
  remoteVisibility: false,
  pushNotifications: false,
  liveActivities: false,
  interventionAlerts: false,
  crossDeviceContinuity: false,
  hostedReplay: false,
  weeklyOutcomeSummaries: false,
  sharedWorkspaces: false,
  teamOutcomeRollups: false,
  privacyControls: false,
  administration: false,
  audit: false,
  securityControls: false,
});

const PRO_HOSTED_CAPABILITIES: HostedCapabilities = Object.freeze({
  managedSync: true,
  encryptedBackup: true,
  multipleComputers: true,
  remoteVisibility: true,
  pushNotifications: true,
  liveActivities: true,
  interventionAlerts: true,
  crossDeviceContinuity: true,
  hostedReplay: true,
  weeklyOutcomeSummaries: true,
  sharedWorkspaces: false,
  teamOutcomeRollups: false,
  privacyControls: false,
  administration: false,
  audit: false,
  securityControls: false,
});

const TEAMS_HOSTED_CAPABILITIES: HostedCapabilities = Object.freeze({
  ...PRO_HOSTED_CAPABILITIES,
  sharedWorkspaces: true,
  teamOutcomeRollups: true,
  privacyControls: true,
  administration: true,
  audit: true,
  securityControls: true,
});

const LOCAL_KEYS = Object.keys(LOCAL_CAPABILITIES) as (keyof LocalCapabilities)[];
const HOSTED_KEYS = Object.keys(
  NO_HOSTED_CAPABILITIES,
) as (keyof HostedCapabilities)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const allowed = new Set(required);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 35) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    !/[\u0000-\u001f]/.test(value)
  );
}

function parseLocalCapabilities(value: unknown): LocalCapabilities | null {
  if (!isRecord(value) || !hasOnlyKeys(value, LOCAL_KEYS)) return null;
  return LOCAL_KEYS.every((key) => value[key] === true)
    ? { ...LOCAL_CAPABILITIES }
    : null;
}

function parseHostedCapabilities(value: unknown): HostedCapabilities | null {
  if (!isRecord(value) || !hasOnlyKeys(value, HOSTED_KEYS)) return null;
  if (!HOSTED_KEYS.every((key) => typeof value[key] === "boolean")) return null;
  return Object.fromEntries(
    HOSTED_KEYS.map((key) => [key, value[key]]),
  ) as unknown as HostedCapabilities;
}

function expectedHosted(
  plan: SeorakPlan,
  state: EntitlementState,
): HostedCapabilities {
  if (state === "past_due" || state === "canceled") {
    return NO_HOSTED_CAPABILITIES;
  }
  if (plan === "pro") return PRO_HOSTED_CAPABILITIES;
  if (plan === "teams") return TEAMS_HOSTED_CAPABILITIES;
  return NO_HOSTED_CAPABILITIES;
}

function hostedEqual(
  left: HostedCapabilities,
  right: HostedCapabilities,
): boolean {
  return HOSTED_KEYS.every((key) => left[key] === right[key]);
}

/**
 * Strictly parse a server response for client presentation and scheduling.
 * This value is never an authorization credential: hosted services must derive
 * the subject from authentication and re-resolve the grant server-side. Plan
 * and account state must agree with the canonical capability matrix, local
 * capabilities can never be narrowed, and cache lifetime is bounded.
 */
export function parseServerEntitlement(
  value: unknown,
): ServerEntitlement | null {
  const keys = [
    "schemaVersion",
    "authority",
    "subject",
    "plan",
    "state",
    "revision",
    "issuedAt",
    "refreshAfter",
    "expiresAt",
    "local",
    "hosted",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (
    value.schemaVersion !== ENTITLEMENT_SCHEMA_VERSION ||
    value.authority !== "server" ||
    !(SEORAK_PLANS as readonly unknown[]).includes(value.plan) ||
    !(ENTITLEMENT_STATES as readonly unknown[]).includes(value.state) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !isIsoTimestamp(value.issuedAt) ||
    !isIsoTimestamp(value.refreshAfter) ||
    !isIsoTimestamp(value.expiresAt) ||
    !isRecord(value.subject) ||
    !hasOnlyKeys(value.subject, ["kind", "id"]) ||
    (value.subject.kind !== "personal" && value.subject.kind !== "workspace") ||
    ((value.plan === "teams") !== (value.subject.kind === "workspace")) ||
    !isBoundedId(value.subject.id)
  ) {
    return null;
  }
  const issuedAt = Date.parse(value.issuedAt);
  const refreshAfter = Date.parse(value.refreshAfter);
  const expiresAt = Date.parse(value.expiresAt);
  if (
    refreshAfter < issuedAt ||
    refreshAfter > expiresAt ||
    expiresAt - issuedAt > ENTITLEMENT_CACHE_MAX_MS
  ) {
    return null;
  }
  const local = parseLocalCapabilities(value.local);
  const hosted = parseHostedCapabilities(value.hosted);
  const plan = value.plan as SeorakPlan;
  const state = value.state as EntitlementState;
  if (!local || !hosted || !hostedEqual(hosted, expectedHosted(plan, state))) {
    return null;
  }
  return {
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    authority: "server",
    subject: { kind: value.subject.kind, id: value.subject.id },
    plan,
    state,
    revision: Number(value.revision),
    issuedAt: value.issuedAt,
    refreshAfter: value.refreshAfter,
    expiresAt: value.expiresAt,
    local,
    hosted,
  };
}

/** Resolve a cached response without ever making local work conditional on it. */
export function resolveEffectiveEntitlements(
  value: unknown,
  nowMs: number = Date.now(),
): EffectiveEntitlements {
  const parsed = parseServerEntitlement(value);
  if (!parsed || nowMs >= Date.parse(parsed.expiresAt)) {
    return {
      source: "local-default",
      plan: "free",
      state: "active",
      revision: null,
      subject: null,
      local: { ...LOCAL_CAPABILITIES },
      hosted: { ...NO_HOSTED_CAPABILITIES },
      refreshAfter: null,
      expiresAt: null,
    };
  }
  return {
    source: "server",
    plan: parsed.plan,
    state: parsed.state,
    revision: parsed.revision,
    subject: parsed.subject,
    local: parsed.local,
    hosted: parsed.hosted,
    refreshAfter: parsed.refreshAfter,
    expiresAt: parsed.expiresAt,
  };
}

/** Server-side helper for constructing the canonical matrix after authorization. */
export function hostedCapabilitiesForAuthority(
  plan: SeorakPlan,
  state: EntitlementState,
): HostedCapabilities {
  return { ...expectedHosted(plan, state) };
}

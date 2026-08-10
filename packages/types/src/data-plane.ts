/**
 * Publish-safe data-plane, managed-coverage, and managed-lifecycle contract.
 *
 * One primary product UI reads from one data plane. There are three shapes and
 * they are deliberately the same route contract, so no surface forks into a
 * simplified second product:
 *
 * | Authority | Operator        | Who runs it            | Account |
 * |-----------|-----------------|------------------------|---------|
 * | `local`   | `local-machine` | the user's own computer | none   |
 * | `remote`  | `self-hosted`   | the user, somewhere else| theirs |
 * | `remote`  | `seorak-managed`| Seorak                  | Seorak |
 *
 * What differs between them is transport, credential storage, and whether a
 * managed copy exists at all. What never differs is the local record: local
 * capture, history, statistics, replay, reports, and export are true in every
 * row of that table, including when the remote plane is unreachable, unpaid, or
 * deleted.
 *
 * This module performs no transport, storage, authentication, authorization,
 * encryption, or scoring. It is the vocabulary those layers agree on.
 */

export const DATA_PLANE_PROTOCOL_VERSION = 1 as const;

/** Where the primary UI is reading from. */
export const DATA_PLANE_AUTHORITIES = ["local", "remote"] as const;
export type DataPlaneAuthority = (typeof DATA_PLANE_AUTHORITIES)[number];

/**
 * Who operates that authority. This is a product-honesty boundary, not a
 * transport detail: only `seorak-managed` may be described as infrastructure
 * Seorak handles. A self-hosted plane gives the same product capabilities and
 * is never metered by Seorak.
 */
export const DATA_PLANE_OPERATORS = [
  "local-machine",
  "self-hosted",
  "seorak-managed",
] as const;
export type DataPlaneOperator = (typeof DATA_PLANE_OPERATORS)[number];

/**
 * The surfaces the primary UI consumes. A surface absent from a plane's list is
 * genuinely unavailable from that plane and must be presented as unavailable,
 * never as measured emptiness.
 *
 * Mostly reads. `settings`, `publication`, and `integrations` are
 * read-and-write, and they are on this list for the same reason the reads are:
 * the UI has to know whether the plane it is talking to can answer at all, and a
 * plane that cannot must be able to say so. Without an entry here the only
 * available answer is `404`, which claims the route does not exist rather than
 * "not from this plane" — and the UI renders a control that dead-ends instead of
 * one it can honestly withhold.
 *
 * `integrations` names the PRIVATE INTEGRATION BOUNDARY as one surface: the
 * credential management the dashboard calls (`/integrations`), the read API
 * those credentials are minted for (`/api/v1/*`), and the private MCP endpoint
 * (`/mcp/private`). One member rather than three, because they are bought,
 * refused, and withheld together: a plane that cannot mint the credential has
 * nothing to point at the API either.
 *
 * It is an OWNER control and never an entitlement. ADR 002 §2 deliberately keeps
 * every one of those routes out of `managedProductAccess.ts`, so no plan gates
 * them and no downgrade withdraws them — pinned on the worker side by
 * `packages/worker/test/managed-lifecycle.test.ts`. What decides the answer is
 * therefore the PLANE, not the plan. The collector's loopback and self-hosted
 * bindings serve the complete surface with scoped `srkx_` grants, while a
 * managed owner cell keeps hosted MCP OAuth separate from collector
 * static-bearer access.
 */
export const DATA_PLANE_SURFACES = [
  "live",
  "overview",
  "sessions",
  "session",
  "sessionOutcome",
  "replay",
  "interventions",
  "settings",
  "developerModel",
  "deliveryHealth",
  "publication",
  "integrations",
] as const;
export type DataPlaneSurface = (typeof DATA_PLANE_SURFACES)[number];

export interface DataPlaneDescriptor {
  protocolVersion: typeof DATA_PLANE_PROTOCOL_VERSION;
  authority: DataPlaneAuthority;
  operator: DataPlaneOperator;
  surfaces: readonly DataPlaneSurface[];
  /**
   * Whether requests must carry an operator credential. A loopback local plane
   * is bound to the machine that owns the history and mints no operator
   * credential, which is why the Free product needs no account, key, or
   * sign-in. Optional scoped integration grants are a separate principal.
   */
  credentialRequired: boolean;
  /**
   * The account origin this plane belongs to, when one operates it: where sign
   * in starts, where a logout continues, and where account deletion happens.
   *
   * ABSENT IS THE NORMAL ANSWER, not a gap. A loopback plane is the machine
   * that owns the history and belongs to no account service, so it names none
   * and the UI withholds the managed affordances instead of aiming them at an
   * origin nobody chose. This field exists so the primary UI never has to be
   * BUILT knowing an account origin: one dashboard artifact, told at runtime by
   * the plane serving it, is what lets the same bundle ship to a managed cell
   * and to a self-hoster who has no account service at all.
   *
   * Constrained to a bare origin by `parseControlPlaneOrigin`, because the UI
   * navigates the browser to it. A malformed value refuses the whole descriptor
   * rather than being dropped: a plane that cannot state its own account origin
   * correctly has not earned the rest of its self-description.
   */
  controlPlaneUrl?: string;
}

/* -------------------------------------------------------------------------- */
/* Managed coverage                                                           */
/* -------------------------------------------------------------------------- */

/**
 * How much of the local record the remote copy actually holds. Its whole job is
 * to make a partial remote copy legible instead of letting it look complete.
 */
export const MANAGED_SYNC_STATES = [
  /** No remote plane is configured, or none is entitled. */
  "not-connected",
  /** Entitled and uploading; the remote copy is behind the local record. */
  "backfilling",
  /** Entitled and caught up as of `observedAt`. */
  "current",
  /** Entitled, but a retriable condition stopped uploads for now. */
  "paused",
  /** Uploads need an explicit repair; retrying the same bytes will not help. */
  "blocked",
  /** Remote service has ended; the managed copy is read-only and downloadable. */
  "recovery",
  /** The managed copy has been deleted; a new baseline is required to resume. */
  "deleted",
] as const;
export type ManagedSyncState = (typeof MANAGED_SYNC_STATES)[number];

/**
 * Deliberately coarser than the compact-sync wire codes. A surface branches on
 * this, never on provider or protocol detail, and never on error prose.
 */
export const MANAGED_SYNC_ERROR_REASONS = [
  "network",
  "authority",
  "service-unavailable",
  "capacity",
  "protocol",
  "local-state",
] as const;
export type ManagedSyncErrorReason =
  (typeof MANAGED_SYNC_ERROR_REASONS)[number];

export interface ManagedSyncError {
  reason: ManagedSyncErrorReason;
  at: string;
  retriable: boolean;
}

export interface ManagedSyncBacklog {
  sessions: number;
  hours: number;
  archives: number;
}

export interface ManagedSyncCoverage {
  schemaVersion: typeof DATA_PLANE_PROTOCOL_VERSION;
  state: ManagedSyncState;
  /**
   * Latest local event instant the remote copy has durably acknowledged.
   * Honest-null before the first receipt, because the remote copy covers
   * nothing at all rather than covering the beginning of time.
   */
  synchronizedThrough: string | null;
  /** Oldest local instant not yet acknowledged. Null when nothing is pending. */
  pendingFrom: string | null;
  /** Null when the backlog genuinely cannot be measured, never zero-filled. */
  backlog: ManagedSyncBacklog | null;
  lastAcceptedAt: string | null;
  lastAttemptAt: string | null;
  lastError: ManagedSyncError | null;
  /**
   * True only when the remote copy holds every local record. The parser refuses
   * a payload that claims completeness without a measured empty backlog and an
   * acknowledged instant, so "complete" cannot be asserted by accident.
   */
  managedCopyComplete: boolean;
  observedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Managed lifecycle                                                          */
/* -------------------------------------------------------------------------- */

/** Days a managed copy stays read-only and downloadable after service ends. */
export const MANAGED_RECOVERY_WINDOW_DAYS = 30 as const;

/**
 * Published managed-archive allowance. These are the executable hard safety
 * budgets in reference/unit-economics.md, not marketing numbers, and they exist
 * so no surface has to reach for the word "unlimited".
 *
 * DECIMAL gigabytes, deliberately. The budgets these mirror are costed against
 * R2, which bills in decimal GB, so expressing the published allowance in binary
 * GiB would quietly hand out 7.37% more storage than the modeled budget prices.
 * A published number that exceeds the budget it cites is not evidence-backed,
 * it is a margin leak with a citation attached.
 */
export const MANAGED_ARCHIVE_ALLOWANCE = Object.freeze({
  /** New encrypted archive bytes accepted per home per calendar month. */
  monthlyUploadBytes: 2_000_000_000,
  /** Total retained encrypted archive bytes per home. */
  retainedBytes: 20_000_000_000,
});

export const MANAGED_LIFECYCLE_PHASES = [
  /** Never subscribed. */
  "none",
  /** Entitled and paid. */
  "active",
  /** Payment failed; managed service continues through a visible grace window. */
  "grace",
  /** Cancellation recorded; managed service runs until the paid-through date. */
  "ending",
  /** Past the paid-through date; read-only managed copy inside the window. */
  "recovery",
  /** The window elapsed and the managed copy was deleted. */
  "deleted",
] as const;
export type ManagedLifecyclePhase = (typeof MANAGED_LIFECYCLE_PHASES)[number];

export interface ManagedLifecycleWindow {
  schemaVersion: typeof DATA_PLANE_PROTOCOL_VERSION;
  phase: ManagedLifecyclePhase;
  /** Last instant managed service is paid for. Null when never subscribed. */
  paidThroughAt: string | null;
  /** Exact instant managed uploads, remote reads, and alerts stop. */
  remoteServiceEndsAt: string | null;
  /** Exact instant the managed copy is deleted. */
  hostedDeletionAt: string | null;
  /** Whether a customer-accessible read-only managed export can start now. */
  recoveryExportAvailable: boolean;
  /**
   * Whether re-subscribing now resumes into the existing managed copy rather
   * than requiring a fresh baseline from local history.
   */
  resumesExistingCopy: boolean;
  observedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Rebaseline handshake                                                       */
/* -------------------------------------------------------------------------- */

export const MANAGED_REBASELINE_REASONS = [
  /** The managed copy was deleted after the recovery window elapsed. */
  "hosted-copy-deleted",
  /** This installation now syncs to a different managed home. */
  "managed-home-changed",
  /** The install chain could not be continued and must restart deliberately. */
  "install-chain-reset",
] as const;
export type ManagedRebaselineReason =
  (typeof MANAGED_REBASELINE_REASONS)[number];

/**
 * The managed side's instruction to rebuild its copy from authoritative local
 * history. `baselineEpoch` is monotonic: a collector applies a directive only
 * when it exceeds the epoch it already acknowledged, so a replayed or reordered
 * directive is inert and cannot silently discard a healthy install chain.
 */
export interface RebaselineDirective {
  schemaVersion: typeof DATA_PLANE_PROTOCOL_VERSION;
  required: boolean;
  baselineEpoch: number;
  reason: ManagedRebaselineReason | null;
  /** The managed side holds no record before this instant. */
  managedCopyEmptySince: string | null;
  issuedAt: string;
}

/**
 * The collector's half of the handshake. It is sent only after every
 * acknowledged projection and archive checkpoint has been reset in one local
 * transaction, so the managed side can distinguish a genuine restart from a
 * collector that merely saw the directive.
 */
export interface RebaselineAcknowledgement {
  schemaVersion: typeof DATA_PLANE_PROTOCOL_VERSION;
  baselineEpoch: number;
  installationId: string;
  checkpointsReset: true;
  /**
   * What the collector can actually resend. Honest-null when local history no
   * longer reaches back that far, so the managed side never reports a
   * reconstruction it did not receive.
   */
  localHistoryFrom: string | null;
  acknowledgedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Composite status                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One read that tells the primary UI which plane it is on and, when a managed
 * plane is involved, exactly how much of the local record that plane holds.
 */
export interface DataPlaneStatus {
  schemaVersion: typeof DATA_PLANE_PROTOCOL_VERSION;
  descriptor: DataPlaneDescriptor;
  /** Null when no remote copy is involved at all. */
  coverage: ManagedSyncCoverage | null;
  /** Null unless Seorak operates the plane; billing has no other home. */
  lifecycle: ManagedLifecycleWindow | null;
  /** Null unless the managed side is asking for a fresh baseline. */
  rebaseline: RebaselineDirective | null;
}

/* -------------------------------------------------------------------------- */
/* Parsers                                                                     */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isIso(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 35) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNullableIso(value: unknown): value is string | null {
  return value === null || isIso(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    !/[\u0000-\u001f]/.test(value)
  );
}

function includes(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}

/**
 * A control-plane origin a surface may navigate the browser to, or null.
 *
 * Deliberately narrow, because the caller is a redirect. Scheme, host, and port
 * only: a path, a query, a fragment, or embedded credentials are all ways to
 * turn "where this plane's accounts live" into somewhere else entirely, and a
 * bare origin cannot carry any of them. Loopback over `http:` is admitted
 * because a development control plane and a self-hosted one both run there and
 * refusing them would leave no way to exercise the path at all.
 */
export function parseControlPlaneOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (
    (url.protocol !== "https:" && !loopback) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  return url.origin;
}

export function parseDataPlaneDescriptor(
  value: unknown,
): DataPlaneDescriptor | null {
  const keys = [
    "protocolVersion",
    "authority",
    "operator",
    "surfaces",
    "credentialRequired",
  ] as const;
  // `controlPlaneUrl` is OPTIONAL rather than required, and permanently so. Most
  // planes have no account service to name, starting with every loopback one,
  // and a required field would force each of them to send an empty string that
  // means the same thing absence already means.
  if (!isRecord(value) || !hasOnlyKeys(value, keys, ["controlPlaneUrl"])) {
    return null;
  }
  if (
    value.protocolVersion !== DATA_PLANE_PROTOCOL_VERSION ||
    !includes(DATA_PLANE_AUTHORITIES, value.authority) ||
    !includes(DATA_PLANE_OPERATORS, value.operator) ||
    typeof value.credentialRequired !== "boolean" ||
    !Array.isArray(value.surfaces) ||
    value.surfaces.length === 0 ||
    value.surfaces.length > DATA_PLANE_SURFACES.length ||
    !value.surfaces.every((surface) => includes(DATA_PLANE_SURFACES, surface)) ||
    new Set(value.surfaces).size !== value.surfaces.length
  ) {
    return null;
  }
  const authority = value.authority as DataPlaneAuthority;
  const operator = value.operator as DataPlaneOperator;
  // A local plane is the machine that owns the history. It cannot be operated
  // by anyone else, and it cannot demand a credential to read what is already
  // on that disk, because that would put an authorization gate in front of the
  // Free product.
  if (
    (authority === "local") !== (operator === "local-machine") ||
    (authority === "local" && value.credentialRequired)
  ) {
    return null;
  }
  // A local plane MAY name one. The local plane is the default authority for
  // every install including a paid one, so the machine that has been paired with
  // an account service is entitled to say which, and refusing that here would
  // make the account unreachable from the surface its owner is actually on.
  const controlPlaneUrl = Object.hasOwn(value, "controlPlaneUrl")
    ? parseControlPlaneOrigin(value.controlPlaneUrl)
    : null;
  if (Object.hasOwn(value, "controlPlaneUrl") && controlPlaneUrl === null) {
    return null;
  }
  return {
    protocolVersion: DATA_PLANE_PROTOCOL_VERSION,
    authority,
    operator,
    surfaces: [...(value.surfaces as DataPlaneSurface[])],
    credentialRequired: value.credentialRequired,
    ...(controlPlaneUrl === null ? {} : { controlPlaneUrl }),
  };
}

function parseBacklog(value: unknown): ManagedSyncBacklog | null | undefined {
  if (value === null) return null;
  const keys = ["sessions", "hours", "archives"] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return undefined;
  if (!keys.every((key) => isCount(value[key]))) return undefined;
  return {
    sessions: value.sessions as number,
    hours: value.hours as number,
    archives: value.archives as number,
  };
}

function parseSyncError(value: unknown): ManagedSyncError | null | undefined {
  if (value === null) return null;
  const keys = ["reason", "at", "retriable"] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return undefined;
  if (
    !includes(MANAGED_SYNC_ERROR_REASONS, value.reason) ||
    !isIso(value.at) ||
    typeof value.retriable !== "boolean"
  ) {
    return undefined;
  }
  return {
    reason: value.reason as ManagedSyncErrorReason,
    at: value.at,
    retriable: value.retriable,
  };
}

export function backlogIsEmpty(backlog: ManagedSyncBacklog | null): boolean {
  return (
    backlog !== null &&
    backlog.sessions === 0 &&
    backlog.hours === 0 &&
    backlog.archives === 0
  );
}

export function parseManagedSyncCoverage(
  value: unknown,
): ManagedSyncCoverage | null {
  const keys = [
    "schemaVersion",
    "state",
    "synchronizedThrough",
    "pendingFrom",
    "backlog",
    "lastAcceptedAt",
    "lastAttemptAt",
    "lastError",
    "managedCopyComplete",
    "observedAt",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (
    value.schemaVersion !== DATA_PLANE_PROTOCOL_VERSION ||
    !includes(MANAGED_SYNC_STATES, value.state) ||
    !isNullableIso(value.synchronizedThrough) ||
    !isNullableIso(value.pendingFrom) ||
    !isNullableIso(value.lastAcceptedAt) ||
    !isNullableIso(value.lastAttemptAt) ||
    typeof value.managedCopyComplete !== "boolean" ||
    !isIso(value.observedAt)
  ) {
    return null;
  }
  const backlog = parseBacklog(value.backlog);
  const lastError = parseSyncError(value.lastError);
  if (backlog === undefined || lastError === undefined) return null;

  const state = value.state as ManagedSyncState;
  // The invariant this whole type exists for: completeness is a measured claim.
  // It needs an acknowledged instant, a measured empty backlog, a caught-up
  // state, and nothing still pending. Anything short of that is partial.
  if (
    value.managedCopyComplete &&
    (state !== "current" ||
      !backlogIsEmpty(backlog) ||
      value.synchronizedThrough === null ||
      value.pendingFrom !== null)
  ) {
    return null;
  }
  // A plane that has never been connected cannot have acknowledged anything.
  if (
    state === "not-connected" &&
    (value.synchronizedThrough !== null || value.lastAcceptedAt !== null)
  ) {
    return null;
  }
  // A deleted managed copy holds nothing, whatever it once held.
  if (state === "deleted" && value.synchronizedThrough !== null) return null;
  // Backfilling means there is measurable work left.
  if (state === "backfilling" && backlogIsEmpty(backlog)) return null;
  // Nothing can have been observed after the moment of observation. Without
  // this a reading can claim the managed copy covers the year 2099, which is
  // the same "complete" overclaim managedCopyComplete exists to prevent, just
  // spelled with a timestamp instead of a boolean.
  const observedMs = Date.parse(value.observedAt);
  for (const instant of [
    value.synchronizedThrough,
    value.pendingFrom,
    value.lastAcceptedAt,
    value.lastAttemptAt,
  ]) {
    if (instant !== null && Date.parse(instant as string) > observedMs) return null;
  }
  // `paused` and `blocked` each name a condition, and `blocked` goes further by
  // asserting that retrying will not help. A surface handed either with no
  // recorded reason can say only "stopped", with no cause and no remedy, which
  // is the prose-free dead end MANAGED_SYNC_ERROR_REASONS exists to avoid.
  if ((state === "paused" || state === "blocked") && lastError === null) {
    return null;
  }
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    state,
    synchronizedThrough: value.synchronizedThrough as string | null,
    pendingFrom: value.pendingFrom as string | null,
    backlog,
    lastAcceptedAt: value.lastAcceptedAt as string | null,
    lastAttemptAt: value.lastAttemptAt as string | null,
    lastError,
    managedCopyComplete: value.managedCopyComplete,
    observedAt: value.observedAt,
  };
}

export function parseManagedLifecycleWindow(
  value: unknown,
): ManagedLifecycleWindow | null {
  const keys = [
    "schemaVersion",
    "phase",
    "paidThroughAt",
    "remoteServiceEndsAt",
    "hostedDeletionAt",
    "recoveryExportAvailable",
    "resumesExistingCopy",
    "observedAt",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (
    value.schemaVersion !== DATA_PLANE_PROTOCOL_VERSION ||
    !includes(MANAGED_LIFECYCLE_PHASES, value.phase) ||
    !isNullableIso(value.paidThroughAt) ||
    !isNullableIso(value.remoteServiceEndsAt) ||
    !isNullableIso(value.hostedDeletionAt) ||
    typeof value.recoveryExportAvailable !== "boolean" ||
    typeof value.resumesExistingCopy !== "boolean" ||
    !isIso(value.observedAt)
  ) {
    return null;
  }
  const phase = value.phase as ManagedLifecyclePhase;
  if (phase === "none") {
    if (
      value.paidThroughAt !== null ||
      value.remoteServiceEndsAt !== null ||
      value.hostedDeletionAt !== null ||
      value.recoveryExportAvailable ||
      value.resumesExistingCopy
    ) {
      return null;
    }
  }
  // Recovery is the only phase that promises a downloadable managed copy, and
  // it must name both exact dates the customer was told to expect.
  if (
    value.recoveryExportAvailable &&
    (phase !== "recovery" ||
      value.remoteServiceEndsAt === null ||
      value.hostedDeletionAt === null)
  ) {
    return null;
  }
  if (
    phase === "recovery" &&
    (value.remoteServiceEndsAt === null || value.hostedDeletionAt === null)
  ) {
    return null;
  }
  // After deletion there is nothing to resume into and nothing to export.
  if (
    phase === "deleted" &&
    (value.recoveryExportAvailable || value.resumesExistingCopy)
  ) {
    return null;
  }
  if (phase !== "none" && phase !== "deleted" && !value.resumesExistingCopy) {
    return null;
  }
  if (
    value.remoteServiceEndsAt !== null &&
    value.hostedDeletionAt !== null &&
    Date.parse(value.hostedDeletionAt) <= Date.parse(value.remoteServiceEndsAt)
  ) {
    return null;
  }
  // The window is a promise with a published length, so ordering alone is not
  // enough: "deletion is after service end" is satisfied by one second. A
  // customer told they have 30 days to retrieve their data must actually have
  // them. A longer window is refused too, because both dates are shown exactly
  // and a window nobody documented is still a surprise.
  if (value.remoteServiceEndsAt !== null && value.hostedDeletionAt !== null) {
    const windowMs =
      Date.parse(value.hostedDeletionAt) - Date.parse(value.remoteServiceEndsAt);
    if (windowMs !== MANAGED_RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1_000) {
      return null;
    }
  }
  // Money cannot be paid through a date past the one where the copy is gone.
  if (
    value.paidThroughAt !== null &&
    value.hostedDeletionAt !== null &&
    Date.parse(value.paidThroughAt) > Date.parse(value.hostedDeletionAt)
  ) {
    return null;
  }
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    phase,
    paidThroughAt: value.paidThroughAt as string | null,
    remoteServiceEndsAt: value.remoteServiceEndsAt as string | null,
    hostedDeletionAt: value.hostedDeletionAt as string | null,
    recoveryExportAvailable: value.recoveryExportAvailable,
    resumesExistingCopy: value.resumesExistingCopy,
    observedAt: value.observedAt,
  };
}

export function parseRebaselineDirective(
  value: unknown,
): RebaselineDirective | null {
  const keys = [
    "schemaVersion",
    "required",
    "baselineEpoch",
    "reason",
    "managedCopyEmptySince",
    "issuedAt",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (
    value.schemaVersion !== DATA_PLANE_PROTOCOL_VERSION ||
    typeof value.required !== "boolean" ||
    !Number.isSafeInteger(value.baselineEpoch) ||
    Number(value.baselineEpoch) < 0 ||
    !isNullableIso(value.managedCopyEmptySince) ||
    !isIso(value.issuedAt) ||
    !(
      value.reason === null ||
      includes(MANAGED_REBASELINE_REASONS, value.reason)
    )
  ) {
    return null;
  }
  // A directive with no reason is not a directive. A reason with no requirement
  // would let a surface narrate a reset that is not happening.
  if (value.required !== (value.reason !== null)) return null;
  if (value.required && Number(value.baselineEpoch) < 1) return null;
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    required: value.required,
    baselineEpoch: Number(value.baselineEpoch),
    reason: value.reason as ManagedRebaselineReason | null,
    managedCopyEmptySince: value.managedCopyEmptySince as string | null,
    issuedAt: value.issuedAt,
  };
}

export function parseRebaselineAcknowledgement(
  value: unknown,
): RebaselineAcknowledgement | null {
  const keys = [
    "schemaVersion",
    "baselineEpoch",
    "installationId",
    "checkpointsReset",
    "localHistoryFrom",
    "acknowledgedAt",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (
    value.schemaVersion !== DATA_PLANE_PROTOCOL_VERSION ||
    !Number.isSafeInteger(value.baselineEpoch) ||
    Number(value.baselineEpoch) < 1 ||
    !isBoundedId(value.installationId) ||
    value.checkpointsReset !== true ||
    !isNullableIso(value.localHistoryFrom) ||
    !isIso(value.acknowledgedAt)
  ) {
    return null;
  }
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    baselineEpoch: Number(value.baselineEpoch),
    installationId: value.installationId,
    checkpointsReset: true,
    localHistoryFrom: value.localHistoryFrom as string | null,
    acknowledgedAt: value.acknowledgedAt,
  };
}

export function parseDataPlaneStatus(value: unknown): DataPlaneStatus | null {
  const keys = [
    "schemaVersion",
    "descriptor",
    "coverage",
    "lifecycle",
    "rebaseline",
  ] as const;
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (value.schemaVersion !== DATA_PLANE_PROTOCOL_VERSION) return null;
  const descriptor = parseDataPlaneDescriptor(value.descriptor);
  if (!descriptor) return null;
  const coverage =
    value.coverage === null ? null : parseManagedSyncCoverage(value.coverage);
  if (value.coverage !== null && coverage === null) return null;
  const lifecycle =
    value.lifecycle === null
      ? null
      : parseManagedLifecycleWindow(value.lifecycle);
  if (value.lifecycle !== null && lifecycle === null) return null;
  const rebaseline =
    value.rebaseline === null ? null : parseRebaselineDirective(value.rebaseline);
  if (value.rebaseline !== null && rebaseline === null) return null;
  // Billing and recovery windows exist only where Seorak operates the service. A
  // self-hosted plane is never metered by Seorak, so it must not describe one.
  //
  // The LOCAL plane may carry them, and must. The local plane is the default
  // authority for every install including Pro, so a lapsed subscriber is reading
  // locally at exactly the moment the deletion countdown matters most. Refusing
  // the window here would make the single most important thing to tell that
  // person unrepresentable on the surface they are actually looking at.
  if (lifecycle !== null && descriptor.operator === "self-hosted") return null;
  if (rebaseline !== null && descriptor.operator === "self-hosted") return null;
  // A lifecycle phase past "none" asserts that a managed copy exists or existed,
  // and a rebaseline directive asserts there is something to rebuild. Both need
  // the observed sync relationship beside them, so neither can be narrated
  // without the coverage that says what is actually there.
  if (lifecycle !== null && lifecycle.phase !== "none" && coverage === null) {
    return null;
  }
  if (rebaseline !== null && rebaseline.required && coverage === null) return null;
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor,
    coverage,
    lifecycle,
    rebaseline,
  };
}

/* -------------------------------------------------------------------------- */
/* Presentation helpers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The only sanctioned way for a surface to answer "is the remote copy the whole
 * record?". It is deliberately conservative: unknown coverage is partial, not
 * complete.
 */
export function remoteCopyCoversEverything(
  coverage: ManagedSyncCoverage | null,
): boolean {
  return coverage !== null && coverage.managedCopyComplete;
}

/**
 * Whether this plane answers a surface at all. The module's central rule is that
 * a surface absent from the list is genuinely unavailable and must be presented
 * as unavailable rather than as measured emptiness. Stating that rule without
 * shipping the check left every consumer to hand-roll it and remember to.
 */
export function planeServes(
  status: DataPlaneStatus,
  surface: DataPlaneSurface,
): boolean {
  return status.descriptor.surfaces.includes(surface);
}

/**
 * Whether one surface's reads from this plane may be presented as the complete
 * record.
 *
 * Deliberately per-surface. A plane that does not answer a surface cannot be
 * complete for it, and the local plane's authority over raw history says
 * nothing about a surface it does not serve. Asking this question without
 * naming a surface is what let a local plane advertising one of ten surfaces
 * still report itself complete.
 */
export function planeReadsAreComplete(
  status: DataPlaneStatus,
  surface: DataPlaneSurface,
): boolean {
  if (!planeServes(status, surface)) return false;
  return (
    status.descriptor.authority === "local" ||
    remoteCopyCoversEverything(status.coverage)
  );
}

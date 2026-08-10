/**
 * Publish-safe collector-to-worker event protocol metadata.
 *
 * Keep this leaf module free of validators and event payload imports. Every
 * deployable surface may inspect compatibility without pulling the Zod event
 * graph into its bundle.
 */

/** Event envelope emitted by this collector build. */
export const EVENT_BATCH_SCHEMA_VERSION = 1 as const;

/**
 * Exact envelope parsers owned by this worker build. During a real protocol
 * expansion this becomes [N - 1, N] only after both parsers are implemented.
 */
export const EVENT_INGEST_ACCEPTED_SCHEMA_VERSIONS = [
  EVENT_BATCH_SCHEMA_VERSION,
] as const;

/** An expand release may advertise at most the current and previous schema. */
export const EVENT_INGEST_ACCEPTED_VERSION_LIMIT = 2;

/** Closed, content-free rejection vocabulary returned by POST /events. */
export const EVENT_INGEST_ERROR_CODES = [
  "unsupported_content_encoding",
  "invalid_json",
  "invalid_batch",
  "unsupported_schema_version",
  "batch_too_large",
  "event_count_limit",
  "invalid_event",
  "session_owner_conflict",
] as const;
export type EventIngestErrorCode = (typeof EVENT_INGEST_ERROR_CODES)[number];

export interface EventIngestCompatibility {
  currentSchemaVersion: number;
  acceptedSchemaVersions: readonly number[];
}

/**
 * Which durable stores this deployment actually binds.
 *
 * `ok: true` on its own is a literal, not a measurement. A cell that bound no
 * archive bucket and no live-transition namespace reported healthy, provisioning
 * asserted readiness against that literal and printed "deployed and ready", and
 * the customer discovered the truth when their first session was refused.
 *
 * These are BINDING PRESENCE, deliberately, not a liveness probe of R2 or a
 * Durable Object. `/health` is open and unrate-limited, so touching those
 * stores here would let an anonymous caller spend an owner's storage
 * operations. Proof that the resource behind a binding exists is the
 * provisioner's job, where it is done once with account authority. Event-log
 * schema readiness is a separate optional `schemaReady` field measured with one
 * cheap D1 SELECT.
 */
export interface WorkerStoreBindings {
  /** The append-only D1 event log every plane needs to answer anything. */
  eventLog: boolean;
  /** R2, where encrypted session archives are stored. */
  archives: boolean;
  /** The Durable Object namespace that coalesces live session transitions. */
  liveTransitions: boolean;
}

export interface WorkerHealthResponse {
  ok: true;
  eventIngest: EventIngestCompatibility;
  /**
   * Optional so a worker deployed before this field existed still parses. A
   * caller that requires the inventory must treat absent as "this deployment
   * cannot tell me", never as "everything is bound".
   */
  stores?: WorkerStoreBindings;
  /**
   * Optional so a worker deployed before schema probing existed still parses.
   * When present it is a measured D1 SELECT against the event-log migration
   * ledger, not binding presence. Absent means "this deployment cannot tell
   * me"; never treat absent as ready. Kept on HTTP 200 with `ok: true` so
   * collectors that treat non-2xx `/health` as unknown compatibility do not
   * break when the schema is behind.
   */
  schemaReady?: boolean;
}

/** Bounded public POST /events failure body. No rejected values or paths. */
export interface EventIngestErrorResponse {
  error: "event batch rejected";
  code: EventIngestErrorCode;
  acceptedSchemaVersions?: readonly number[];
}

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

function isSchemaVersion(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 2_147_483_647
  );
}

function parseAcceptedSchemaVersions(value: unknown): number[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > EVENT_INGEST_ACCEPTED_VERSION_LIMIT ||
    !value.every(isSchemaVersion) ||
    new Set(value).size !== value.length
  ) {
    return null;
  }
  return [...value].sort((a, b) => a - b);
}

export function isEventIngestErrorCode(
  value: unknown,
): value is EventIngestErrorCode {
  return (
    typeof value === "string" &&
    (EVENT_INGEST_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** Strict parser for the bounded public compatibility response. */
export function parseWorkerHealthResponse(
  value: unknown,
): WorkerHealthResponse | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["ok", "eventIngest"], ["stores", "schemaReady"]) ||
    value.ok !== true ||
    !isRecord(value.eventIngest) ||
    !hasOnlyKeys(value.eventIngest, [
      "currentSchemaVersion",
      "acceptedSchemaVersions",
    ]) ||
    !isSchemaVersion(value.eventIngest.currentSchemaVersion)
  ) {
    return null;
  }
  const acceptedSchemaVersions = parseAcceptedSchemaVersions(
    value.eventIngest.acceptedSchemaVersions,
  );
  if (
    acceptedSchemaVersions === null ||
    !acceptedSchemaVersions.includes(value.eventIngest.currentSchemaVersion)
  ) {
    return null;
  }
  const stores = parseWorkerStoreBindings(value.stores);
  if (value.stores !== undefined && stores === null) return null;
  if (
    value.schemaReady !== undefined &&
    typeof value.schemaReady !== "boolean"
  ) {
    return null;
  }
  return {
    ok: true,
    eventIngest: {
      currentSchemaVersion: value.eventIngest.currentSchemaVersion,
      acceptedSchemaVersions,
    },
    ...(stores === null ? {} : { stores }),
    ...(value.schemaReady === undefined
      ? {}
      : { schemaReady: value.schemaReady }),
  };
}

/**
 * A malformed inventory is refused rather than coerced.
 *
 * Reading a missing or unparseable field as `false` would be safe here, but
 * reading it as `true` would not, and a partial object invites exactly that. An
 * absent inventory and a broken one are both "this deployment cannot tell me",
 * which is what the caller has to decide about.
 */
export function parseWorkerStoreBindings(
  value: unknown,
): WorkerStoreBindings | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["eventLog", "archives", "liveTransitions"]) ||
    typeof value.eventLog !== "boolean" ||
    typeof value.archives !== "boolean" ||
    typeof value.liveTransitions !== "boolean"
  ) {
    return null;
  }
  return {
    eventLog: value.eventLog,
    archives: value.archives,
    liveTransitions: value.liveTransitions,
  };
}

/**
 * The stores a Seorak-operated product cell must bind before it may be called
 * ready. Free and Pro cells are the same deployment, so the requirement does not
 * vary by plan: a Free cell that later upgrades must already be able to receive
 * the archives it will then be entitled to send.
 */
export const REQUIRED_PRODUCT_CELL_STORES = [
  "eventLog",
  "archives",
  "liveTransitions",
] as const satisfies readonly (keyof WorkerStoreBindings)[];

/** Which required stores a health body proves absent, or `null` when it cannot
 *  answer at all. An empty array is the only "ready" result. */
export function missingProductCellStores(
  health: WorkerHealthResponse,
): (keyof WorkerStoreBindings)[] | null {
  if (!health.stores) return null;
  const stores = health.stores;
  return REQUIRED_PRODUCT_CELL_STORES.filter((name) => !stores[name]);
}

/** Strict parser for the only non-2xx body the collector may retain. */
export function parseEventIngestErrorResponse(
  value: unknown,
): EventIngestErrorResponse | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(
      value,
      ["error", "code"],
      value.code === "unsupported_schema_version"
        ? ["acceptedSchemaVersions"]
        : [],
    ) ||
    value.error !== "event batch rejected" ||
    !isEventIngestErrorCode(value.code)
  ) {
    return null;
  }
  if (value.acceptedSchemaVersions === undefined) {
    return { error: value.error, code: value.code };
  }
  if (value.code !== "unsupported_schema_version") return null;
  const acceptedSchemaVersions = parseAcceptedSchemaVersions(
    value.acceptedSchemaVersions,
  );
  return acceptedSchemaVersions === null
    ? null
    : { error: value.error, code: value.code, acceptedSchemaVersions };
}

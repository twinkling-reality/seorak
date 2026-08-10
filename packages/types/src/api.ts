/**
 * api.ts: the ONE declaration of the worker's public HTTP surface that every
 * surface shares: route paths, the auth header shape, conditional-GET headers,
 * the settings family keys, and how a response status classifies.
 *
 * WHY IT LIVES IN @seorak/types. The collector may depend on `@seorak/types` and
 * npm only (ARCHITECTURE.md, OSS split), so this is the only package terminal,
 * web, and mobile can all reach. Everything here is publish-safe: the worker's
 * routes are a public HTTP API, and nothing below holds a secret, a threshold, or
 * an extraction rule.
 *
 * WHAT IT IS NOT. Not a client. There is no `fetch` call in this file and there
 * must never be one. Each surface keeps its own transport, because the transports
 * are legitimately different: the terminal degrades every failure to null so a
 * board frame still renders, the web parses through zod with per-section
 * degradation, and mobile casts to the contract type on purpose (no zod strip, so
 * a field added upstream reaches the phone without a schema edit). Sharing the
 * transport would force one of those postures onto the others; sharing the URL
 * and header construction costs them nothing.
 *
 * So the rule is: a path, a header name, or a status meaning belongs here. A
 * timeout, a retry policy, a poll cadence, a cache, or a validation choice
 * belongs to the surface.
 */
import type { SessionSummary } from "./summary.ts";

/**
 * The windowed ranges `/overview` and `/developer-model` accept.
 *
 * This is the ONLY place the set is written down. Every surface's range picker
 * and both of the worker's allowlists derive from it, so adding or dropping a
 * window is a one-line edit here rather than a ten-file sweep. That matters
 * because dropping 90d is a live product question (STATUS.md open questions),
 * and it is also what makes a plan ceiling expressible: an entitlement narrows
 * this list rather than inventing a parallel one (docs/specs/pricing.md).
 *
 * NOTHING RE-DECLARES IT ANY MORE. The menu bar carried a hand-kept Swift copy
 * because it could not import TypeScript, and a parity test held that copy
 * honest; both went with the surface on 2026-08-08. Every remaining consumer
 * imports this constant, so the "one place" claim above is now literal rather
 * than aspirational, and a second copy in any language should be resisted.
 *
 * A DEFAULT is deliberately not exported. The narrowest window is the worker's
 * fallback for an unparseable request, but which window a surface *opens* on is
 * a presentation choice each one makes (web Model opens on 30, the terminal
 * board on 7), and collapsing those into one constant would hide a real
 * difference.
 */
export const OVERVIEW_RANGE_DAYS = [7, 30, 90] as const;
export type OverviewRangeDays = (typeof OVERVIEW_RANGE_DAYS)[number];

/**
 * Stable, content-free failure codes that a surface may act on more narrowly
 * than an HTTP status. Human-readable `error` prose is never a control plane.
 */
export const WORKER_ERROR_CODES = [
  "push_dispatcher_unconfigured",
  "session_materialization_limit",
  "session_outcome_limit",
  "session_page_changed",
] as const;
export type WorkerErrorCode = (typeof WORKER_ERROR_CODES)[number];

export function isWorkerErrorCode(value: unknown): value is WorkerErrorCode {
  return (WORKER_ERROR_CODES as readonly unknown[]).includes(value);
}

/** Default and maximum object counts for one `GET /sessions` response. The
 * cursor is opaque to callers; only the worker interprets it. */
export const SESSION_PAGE_DEFAULT_LIMIT = 100;
export const SESSION_PAGE_MAX_LIMIT = 200;
export const SESSION_MATERIALIZATION_MAX_ROWS = 10_000;
/**
 * Event rows one per-session outcome read may scan before it is refused.
 *
 * Here rather than in a server because `SessionOutcomeRefusal.maxRows` is a
 * public wire field, and because more than one implementation of the route
 * contract now enforces it: the hosted worker, and the collector's plane on its
 * self-hosted binding. Two independent literals that must agree is exactly the
 * drift this file exists to prevent.
 */
export const SESSION_OUTCOME_MAX_ROWS = 10_000;
/** One replay view may request at most this many per-session payloads. Kept below
 * the worker's aggregate request budget so opening Replay cannot rate-limit its
 * own owner cell. */
export const REPLAY_SESSION_REQUEST_MAX = 40;
export type SessionPageCursor = string;

export interface SessionPageRequest {
  cursor?: SessionPageCursor | null;
  limit?: number;
  /** Optional machine-salted repository id. The worker applies this scope before
   * paging so a project screen never traverses every owner session to discard
   * almost all of them on-device. */
  repoId?: string | null;
}

/** One bounded, deterministic page of session summaries. `nextCursor: null`
 * means this readable-history traversal has no later page. */
export interface SessionPage {
  sessions: SessionSummary[];
  nextCursor: SessionPageCursor | null;
}

export interface SessionMaterializationRefusal {
  error: "session materialization too large";
  code: "session_materialization_limit";
  detail: string;
  projectedRows: number;
  maxRows: number;
  projectedBytes?: number;
  maxBytes?: number;
}

export interface SessionPageChangedRefusal {
  error: "session collection changed";
  code: "session_page_changed";
  detail: string;
}

export interface SessionOutcomeRefusal {
  error: "session outcome too large";
  code: "session_outcome_limit";
  detail: string;
  projectedRows: number;
  maxRows: number;
}

/**
 * The widest window the read path SUPPORTS, which is not the same thing as the
 * widest window a given deployment's plan will SERVE. Named rather than reached
 * by index so callers do not each re-derive it, and named `WIDEST` rather than
 * `MAX` precisely so it does not read as the plan ceiling that narrows it
 * (`OverviewSnapshot.maxRangeDays`, docs/specs/pricing.md).
 */
export const WIDEST_OVERVIEW_RANGE_DAYS: OverviewRangeDays = 90;

/**
 * Whether an arbitrary value is one of the accepted windows. The predicate is
 * shared because the check was independently reimplemented as an array
 * `includes`, a `Set.has`, and an inline union cast, and a caller that gets it
 * wrong either serves a window the worker never costed or rejects one it does.
 */
export function isOverviewRangeDays(value: unknown): value is OverviewRangeDays {
  return (OVERVIEW_RANGE_DAYS as readonly number[]).includes(value as number);
}

/**
 * The families the worker's single `/settings` document carries. GET returns all
 * of them; PUT accepts any subset and deep-merges each into its own store, so a
 * one-family write never clobbers a sibling. Surfaces key their read-pick-coerce
 * off this list, so adding a family to the worker is a change here first.
 */
export const SETTINGS_FAMILIES = [
  "capture",
  "notifications",
  "liveActivity",
  "projectThemes",
  "projectMerges",
  "projectArchive",
] as const;
export type SettingsFamily = (typeof SETTINGS_FAMILIES)[number];

/** The shape of `GET /settings` and of the echo `PUT /settings` returns: every
 *  family present, each one already resolved to its effective value. Values stay
 *  `unknown` here because persisted operator input is a trust boundary; each
 *  surface runs the family coercer before consuming it. */
export type SettingsDocument = Record<SettingsFamily, unknown>;

/** The complete, content-free client crash shapes accepted by the worker. */
export interface WebClientErrorReport {
  schema: "obs.v1";
  surface: "web";
  ev: "render_error";
  label: string;
  errKind: string;
  stackDepth: number;
}

export interface MobileClientErrorReport {
  schema: "obs.v1";
  surface: "mobile";
  ev: "render_error";
  errKind: string;
}

export type ClientErrorReport =
  | WebClientErrorReport
  | MobileClientErrorReport;

/**
 * Every path a surface may call, built in one place. Paths are relative to the
 * surface's base (same-origin `''` on the deployed dashboard, `/api` in web dev,
 * an absolute worker URL on terminal and mobile), so a base is never baked in
 * here. Ids are percent-encoded, because a session id is opaque.
 */
export const seorakRoutes = {
  /** Liveness. Open even on an armed worker. */
  health: (): string => "/health",
  /** Server-authoritative Free, Pro, or Teams capability snapshot. */
  entitlements: (): string => "/entitlements",
  /** Open compact-sync compatibility and resource-limit metadata. */
  compactSyncHealth: (): string => "/sync/health",
  /** Authenticated compact-sync v1 batch acceptance. Owner scope is never a URL input. */
  compactSyncBatches: (): string => "/sync/v1/batches",
  /** Read one idempotent batch receipt without selecting an owner in the URL. */
  compactSyncBatch: (batchId: string): string =>
    `/sync/v1/batches/${encodeURIComponent(batchId)}`,
  /** Owner-lock probe: 200 when the token matches or the worker is open, 401 when armed and wrong. */
  authCheck: (): string => "/auth/check",
  /** Exchange a read credential for, or revoke, an HttpOnly browser session. */
  authSession: (): string => "/auth/session",
  /** Exchange a one-time fragment value for an HttpOnly browser session. */
  authHandoff: (): string => "/auth/handoff",
  /** Cell-operator route that creates a one-time browser handoff. */
  controlPlaneHandoffs: (): string => "/auth/control-plane/handoffs",
  /** Cell-operator route that creates a least-privilege credential pair for one installed client. */
  controlPlaneClientCredentials: (): string =>
    "/auth/control-plane/client-credentials",
  /** Cell-operator route that issues an independently revocable third-party read credential. */
  controlPlaneIntegrationCredentials: (): string =>
    "/auth/control-plane/integrations",
  /** Cell-operator route that revokes one third-party read credential. */
  controlPlaneIntegrationCredential: (credentialRef: string): string =>
    `/auth/control-plane/integrations/${encodeURIComponent(credentialRef)}`,
  /** Authenticated owner routes for listing, issuing, and revoking private API access. */
  ownerIntegrationCredentials: (): string => "/integrations",
  ownerIntegrationProjects: (): string => "/integrations/projects",
  /** Installed-client authorizations the owner can retire without holding them. */
  ownerInstalledClients: (): string => "/auth/clients",
  ownerInstalledClient: (clientRef: string): string =>
    `/auth/clients/${encodeURIComponent(clientRef)}`,
  ownerIntegrationCredential: (credentialRef: string): string =>
    `/integrations/${encodeURIComponent(credentialRef)}`,
  /** Owner-cell OAuth RS token mint and grant-wide revoke. */
  controlPlaneMcpAccessTokens: (): string =>
    "/auth/control-plane/mcp/access-tokens",
  controlPlaneMcpGrantRevoke: (grantRef: string): string =>
    `/auth/control-plane/mcp/grants/${encodeURIComponent(grantRef)}/revoke`,
  /** Cell-operator route that applies a monotonic billing entitlement revision. */
  controlPlaneEntitlement: (): string =>
    "/auth/control-plane/entitlement",
  /** Revoke the complete credential set represented by the installed client's presented token. */
  clientAuthorization: (): string => "/auth/client",
  /** Cell-operator route that invalidates one revoked workspace member's cell access. */
  controlPlaneMemberRevoke: (memberId: string): string =>
    `/auth/control-plane/members/${encodeURIComponent(memberId)}/revoke`,
  /** Freeze every installed client, browser session, and phone token in a Personal cell. */
  controlPlaneAccountFreeze: (): string => "/auth/control-plane/account/freeze",
  /** Irreversibly purge one deleted Shared-workspace member's scoped data. */
  controlPlaneMemberPurge: (memberId: string): string =>
    `/auth/control-plane/members/${encodeURIComponent(memberId)}/purge`,
  /** The current isolated cell's Personal or Shared workspace identity. */
  workspace: (): string => "/workspace",
  /** Explicitly join one machine-salted repo card to a workspace project. */
  workspaceProjectClaims: (): string => "/workspace/project-claims",
  /** Redacted, authenticated web/mobile render failures. */
  clientReports: (): string => "/client-reports",
  /** The KV-only live head. One read, so no ETag: a conditional GET would buy nothing. */
  live: (): string => "/live",
  /** The windowed aggregate. Supports `If-None-Match`; an ETag is only valid for the same `days`. */
  overview: (days: number): string => `/overview?days=${days}`,
  /** The slow-loop portrait. Supports `If-None-Match`, optionally scoped to one repo. */
  developerModel: (days: number, repoId?: string | null): string => {
    const params = new URLSearchParams({ days: String(days) });
    if (repoId) params.set("repoId", repoId);
    return `/developer-model?${params}`;
  },
  sessions: (page: SessionPageRequest = {}): string => {
    const params = new URLSearchParams();
    if (page.cursor !== undefined && page.cursor !== null) {
      params.set("cursor", page.cursor);
    }
    if (page.limit !== undefined) params.set("limit", String(page.limit));
    if (page.repoId) params.set("repoId", page.repoId);
    const query = params.toString();
    return query ? `/sessions?${query}` : "/sessions";
  },
  session: (sessionId: string): string => `/sessions/${encodeURIComponent(sessionId)}`,
  sessionOutcome: (sessionId: string): string =>
    `/sessions/${encodeURIComponent(sessionId)}/outcome`,
  replay: (sessionId: string): string => `/replay/${encodeURIComponent(sessionId)}`,
  /** Versioned third-party period summary. Auth uses the integration principal only. */
  privatePeriodSummary: (days: number): string =>
    `/api/v1/period-summary?days=${encodeURIComponent(String(days))}`,
  /** Versioned third-party session page using external-only handles. */
  privateSessions: (page: { cursor?: string | null; limit?: number } = {}): string => {
    const params = new URLSearchParams();
    if (page.cursor) params.set("cursor", page.cursor);
    if (page.limit !== undefined) params.set("limit", String(page.limit));
    const query = params.toString();
    return query ? `/api/v1/sessions?${query}` : "/api/v1/sessions";
  },
  /** Versioned third-party content-free session outcome. */
  privateSessionOutcome: (sessionRef: string): string =>
    `/api/v1/sessions/${encodeURIComponent(sessionRef)}/outcome`,
  /** Versioned third-party content-free Replay lens. */
  privateReplayLens: (sessionRef: string, lens: string): string =>
    `/api/v1/sessions/${encodeURIComponent(sessionRef)}/replay/${encodeURIComponent(lens)}`,
  privateMcp: (): string => "/mcp/private",
  privateMcpProtectedResourceMetadata: (): string =>
    "/.well-known/oauth-protected-resource/mcp/private",
  privateMcpAuthorizationServerMetadata: (): string =>
    "/.well-known/oauth-authorization-server",
  publicationManifest: (): string => "/public-presence/manifest",
  publicationPublish: (): string => "/public-presence/publish",
  publicationStatus: (): string => "/public-presence/status",
  publicationRevoke: (): string => "/public-presence/revoke",
  publicationRetry: (generation: number): string =>
    `/public-presence/deliveries/${encodeURIComponent(String(generation))}/retry`,
  interventions: (): string => "/interventions",
  /** Environment-separated facts from the retained push delivery ledger. */
  deliveryHealth: (): string => "/delivery-health",
  /** GET reads every family. PUT accepts mobile-control authority or a browser's
   *  narrow session-control authority with CSRF proof. */
  settings: (): string => "/settings",
  activityTap: (): string => "/activity-tap",
  /** Ingest. The collector daemon's only write. */
  events: (): string => "/events",
  /** Observe this installation's signed APNs environment. */
  devices: (): string => "/devices",
  /** Forward one revisioned APNs or ActivityKit token observation. */
  deviceTokens: (deviceId: string): string =>
    `/devices/${encodeURIComponent(deviceId)}/tokens`,
  /**
   * Dogfood-only, explicitly enabled delivery proof against an already
   * registered device. The worker owns token selection and the payload.
   */
  deliveryTest: (): string => "/dev/test-delivery",

  /**
   * The plane descriptor a LOCAL plane serves: the collector's loopback binding
   * and its self-hosted binding.
   *
   * This is not an alias of `compactSyncDataPlane()`. They are two different
   * planes answering the same question about themselves, and neither serves the
   * other's path, so a dashboard that does not already know which authority it
   * is reading has to ask for both. Both are listed here so that fact is a
   * contract rather than a literal repeated in three packages.
   */
  localDataPlane: (): string => "/data-plane",
  /** How much of the local record the managed copy holds, plus the exact dates
   *  managed service ends and the hosted copy is deleted. Deliberately outside
   *  the hosted capability gate: a downgraded home must still be able to read
   *  its own deletion date. */
  compactSyncDataPlane: (): string => "/sync/v1/data-plane",
  /** The collector's half of the rebaseline handshake, sent only after it has
   *  reset every acknowledged checkpoint in one local transaction. */
  compactSyncRebaseline: (): string => "/sync/v1/rebaseline",
  /** Cell-operator route that applies the canonical lifecycle window. */
  controlPlaneManagedLifecycle: (): string =>
    "/auth/control-plane/managed-lifecycle",
  /** Cell-operator routes that mint and revoke one customer recovery grant. */
  controlPlaneRecoveryGrants: (): string =>
    "/auth/control-plane/recovery-grants",
  controlPlaneRecoveryGrant: (grantRef: string): string =>
    `/auth/control-plane/recovery-grants/${encodeURIComponent(grantRef)}`,
  /**
   * The customer's read-only managed export during the recovery window. These
   * are authorized by a single-purpose recovery grant checked inside each
   * handler, never by a product credential, so the download survives the same
   * downgrade that makes every product route refuse with 402.
   */
  recoveryManifest: (): string => "/recovery/v1/manifest",
  recoverySessions: (): string => "/recovery/v1/sessions",
  recoveryHours: (): string => "/recovery/v1/hours",
  recoveryArchives: (): string => "/recovery/v1/archives",
  recoveryArchive: (archiveId: string): string =>
    `/recovery/v1/archives/${encodeURIComponent(archiveId)}`,
} as const;

/**
 * Device authority metadata stays outside the upstream token-forwarder body.
 * The body remains the exact maintained schema-v1 wire contract, while these
 * Seorak-owned headers bind it to this installation's durable authority state.
 */
export const DEVICE_AUTHORITY_REVISION_HEADER =
  "x-seorak-device-authority-revision";
export const DEVICE_TOKEN_GENERATION_HEADER =
  "x-seorak-device-token-generation";
/**
 * Immutable worker generation embedded in a remotely started ActivityKit
 * instance. Per-activity observations echo it so a delayed callback can never
 * be inferred as belonging to whichever generation happens to be current.
 */
export const DEVICE_LIVE_GENERATION_HEADER =
  "x-seorak-live-generation";

/**
 * Serve-mode metadata for the worker's cached aggregate responses. The value
 * describes the BODY on this response, not merely whether the request itself
 * succeeded:
 *
 * - `fresh`: the body matches the current aggregate version (or a 304 confirms
 *   the caller's body still does);
 * - `revalidating`: last-known-good bytes were served while a rebuild runs;
 * - `stale`: last-known-good bytes were served after a synchronous build failed;
 * - `refused`: the requested window exceeded the worker's safe build budget;
 * - `unavailable`: no aggregate body exists while stored rollups catch up.
 *
 * The two legacy names predate this shared contract. New workers emit both
 * during the native-client cutover; readers accept either so an updated client
 * remains honest against an older owner cell.
 */
export const AGGREGATE_CACHE_STATUS_HEADER = "x-seorak-cache-status";
export const LEGACY_AGGREGATE_CACHE_STATUS_HEADERS = {
  overview: "x-seorak-overview",
  developerModel: "x-seorak-model",
} as const;
export type AggregateCacheStatus =
  | "fresh"
  | "revalidating"
  | "stale"
  | "refused"
  | "unavailable"
  | "unknown";

interface ReadableHeaders {
  get(name: string): string | null;
}

export function readAggregateCacheStatus(
  headers: ReadableHeaders,
  legacyHeader?: string,
): AggregateCacheStatus {
  const value =
    headers.get(AGGREGATE_CACHE_STATUS_HEADER) ??
    (legacyHeader ? headers.get(legacyHeader) : null);
  if (value === null) return "fresh";
  if (
    value === "fresh" ||
    value === "revalidating" ||
    value === "stale" ||
    value === "refused" ||
    value === "unavailable"
  ) {
    return value;
  }
  return "unknown";
}

export function isAggregateCacheStale(status: AggregateCacheStatus): boolean {
  return status !== "fresh";
}

/**
 * The `Authorization` header for a request, or `{}` when there is nothing real to
 * send. One token authorizes both reads and writes today (the owner sets
 * `SEORAK_READ_KEY` and `SEORAK_INGEST_KEY` to the same value); an OPEN worker
 * ignores the header and an ARMED worker 401s without it.
 *
 * The token is passed in rather than read from storage, because storage is the
 * genuinely per-surface part: dogfood web compatibility, the collector's plist
 * or env, and mobile's app-only Keychain. Product web uses an HttpOnly session
 * and therefore calls this with no bearer after exchange.
 */
export function bearerHeader(token?: string | null): Record<string, string> {
  const t = typeof token === "string" ? token.trim() : "";
  return t ? { authorization: `Bearer ${t}` } : {};
}

/**
 * Headers for a conditional GET: the bearer plus `If-None-Match` when the caller
 * holds an ETag from a previous 200. An unchanged window then costs a bare 304
 * instead of a rebuilt aggregate body, which is what lets a dashboard tab, a
 * terminal session, and a phone all poll without burning the read budget.
 */
export function conditionalGetHeaders(
  token?: string | null,
  etag?: string | null,
): Record<string, string> {
  const headers = bearerHeader(token);
  const tag = typeof etag === "string" ? etag.trim() : "";
  if (tag) headers["if-none-match"] = tag;
  return headers;
}

/**
 * What an HTTP status means to a surface, in the vocabulary the user sees.
 *
 * - `ok` carries a body.
 * - `notModified` means the caller's cached copy still stands.
 * - `locked` means the read gate is armed and the token is missing or wrong, so
 *   the fix is a key, not the URL. The worker only ever answers 401 for this.
 * - `notFound` means the id is outside the worker's window.
 * - `error` is everything else, including a 5xx.
 *
 * A thrown fetch (offline, bad host, timeout) never reaches here: it has no
 * status, and each surface already models it as unreachable.
 */
export type WorkerReadOutcome = "ok" | "notModified" | "locked" | "notFound" | "error";

export function classifyWorkerStatus(status: number): WorkerReadOutcome {
  if (status === 304) return "notModified";
  if (status === 401) return "locked";
  if (status === 404) return "notFound";
  if (status >= 200 && status < 300) return "ok";
  return "error";
}

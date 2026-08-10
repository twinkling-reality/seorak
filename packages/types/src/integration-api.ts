/**
 * Versioned contracts for third-party private reads and deliberately published
 * public projections.
 *
 * This boundary is intentionally separate from the first-party worker DTOs.
 * Every reference here is minted for the integration API; none is an owner-cell
 * database key, collector identifier, or salted capture identifier. Likewise,
 * these contracts carry projections and aggregate evidence only — never events,
 * prompts, commands, paths, diffs, or tool output.
 */

export const INTEGRATION_API_VERSION = "v1" as const;
export type IntegrationApiVersion = typeof INTEGRATION_API_VERSION;

export const INTEGRATION_SCOPES = [
  "period:read",
  "sessions:read",
  "replay:read",
] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

/** Opaque references minted at this external boundary. Their values are not storage keys. */
export type ExternalProjectRef = string;
export type ExternalSessionRef = string;
export type ExternalCursor = string;
export type ExternalCredentialRef = string;
export type ExternalResultRef = string;

/** A URL the issuer must validate as HTTPS before persistence or rendering. */
export type HttpsUrl = `https://${string}`;
export type IntegrationIsoTimestamp = string;
/** Calendar date (`YYYY-MM-DD`), interpreted as UTC by v1. */
export type IntegrationDate = string;

export interface IntegrationDateRange {
  from: IntegrationDate;
  through: IntegrationDate;
}

export interface IntegrationRateLimit {
  /** Sustained per-credential budget. Must be a positive integer. */
  requestsPerMinute: number;
  /** Short burst allowance within the sustained budget. Must be a positive integer. */
  burst: number;
}

export interface IntegrationCredentialRestrictions {
  /** External project references only; an omitted list permits every visible project. */
  projectRefs?: readonly ExternalProjectRef[];
  /** Inclusive UTC date restriction; omitted means no additional date restriction. */
  dateRange?: IntegrationDateRange;
}

export interface IntegrationCredentialIssueRequest {
  apiVersion: IntegrationApiVersion;
  /** Logical resource-server audience; checked on every use. */
  audience: string;
  scopes: readonly IntegrationScope[];
  /** Required: v1 does not issue permanent integration credentials. */
  expiresAt: IntegrationIsoTimestamp;
  restrictions?: IntegrationCredentialRestrictions;
  rateLimit: IntegrationRateLimit;
}

export interface IntegrationCredentialIssueResult {
  apiVersion: IntegrationApiVersion;
  credentialRef: ExternalCredentialRef;
  /** Returned once. Persistence layers store only its verifier/hash. */
  secret: string;
  audience: string;
  scopes: readonly IntegrationScope[];
  issuedAt: IntegrationIsoTimestamp;
  expiresAt: IntegrationIsoTimestamp;
  restrictions?: IntegrationCredentialRestrictions;
  rateLimit: IntegrationRateLimit;
}

/** Secret-free lifecycle metadata shown only to the authenticated owner. */
export interface IntegrationCredentialSummary {
  apiVersion: IntegrationApiVersion;
  credentialRef: ExternalCredentialRef;
  audience: string;
  scopes: readonly IntegrationScope[];
  issuedAt: IntegrationIsoTimestamp;
  expiresAt: IntegrationIsoTimestamp;
  lastUsedAt: IntegrationIsoTimestamp | null;
  revokedAt: IntegrationIsoTimestamp | null;
  restrictions?: IntegrationCredentialRestrictions;
  rateLimit: IntegrationRateLimit;
}

export interface IntegrationCredentialList {
  apiVersion: IntegrationApiVersion;
  credentials: readonly IntegrationCredentialSummary[];
}

/** Authenticated-owner catalog used to choose an opaque project restriction. */
export interface IntegrationProjectOption {
  projectRef: ExternalProjectRef;
  label: string;
}

export interface IntegrationProjectList {
  apiVersion: IntegrationApiVersion;
  projects: readonly IntegrationProjectOption[];
}

export type IntegrationAvailabilityState =
  | "available"
  | "partial"
  | "unavailable";

export type IntegrationAvailabilityReason =
  | "not-captured"
  | "not-retained"
  | "not-yet-computed"
  | "outside-credential-restriction"
  | "temporarily-unavailable"
  | "result-limit";

export interface IntegrationAvailability {
  state: IntegrationAvailabilityState;
  /** Null when fully available; otherwise a stable machine-readable explanation. */
  reason: IntegrationAvailabilityReason | null;
}

export type IntegrationCoverageOmission =
  | "outside-retention"
  | "capture-unavailable"
  | "projection-pending"
  | "credential-restriction"
  | "result-limit";

/** What rows and time the returned claim actually covers. */
export interface IntegrationCoverage {
  requested: IntegrationDateRange;
  observed: IntegrationDateRange | null;
  matchedSessionCount: number;
  includedSessionCount: number;
  complete: boolean;
  omissions: readonly IntegrationCoverageOmission[];
}

export type IntegrationFreshnessState = "fresh" | "stale" | "revalidating";

export interface IntegrationFreshness {
  state: IntegrationFreshnessState;
  generatedAt: IntegrationIsoTimestamp;
  /** Latest source observation included, or null for an honest-empty result. */
  dataThrough: IntegrationIsoTimestamp | null;
  /** Boundary after which a caller must describe the projection as stale. */
  staleAt: IntegrationIsoTimestamp;
}

/** Mandatory metadata on every private read, including honest-empty responses. */
export interface IntegrationReadMetadata {
  apiVersion: IntegrationApiVersion;
  availability: IntegrationAvailability;
  coverage: IntegrationCoverage;
  freshness: IntegrationFreshness;
}

export interface PrivatePeriodMetrics {
  sessionCount: number;
  completedSessionCount: number;
  toolCallCount: number;
  /** Null until a complete prompt-count carrier covers the requested window. */
  promptCount: number | null;
  /** Null until a complete token carrier covers the requested window. */
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  shippedChangeRate: number | null;
}

export interface PrivatePeriodDto extends IntegrationReadMetadata {
  period: IntegrationDateRange;
  /** Null is the credential-visible portfolio; otherwise an external project ref. */
  projectRef: ExternalProjectRef | null;
  metrics: PrivatePeriodMetrics | null;
}

export type PrivateSessionStatus = "active" | "ended";

export interface PrivateSessionSummaryDto {
  sessionRef: ExternalSessionRef;
  projectRef: ExternalProjectRef;
  agent: string;
  status: PrivateSessionStatus;
  startedAt: IntegrationIsoTimestamp;
  endedAt: IntegrationIsoTimestamp | null;
  elapsedSeconds: number;
  toolCallCount: number;
  /** Session pages do not scan raw event rows merely to manufacture this leg. */
  promptCount: number | null;
  costUsd: number | null;
}

export interface PrivateSessionPageDto extends IntegrationReadMetadata {
  items: readonly PrivateSessionSummaryDto[];
  /** Opaque external keyset cursor. Null means this page is terminal. */
  nextCursor: ExternalCursor | null;
}

export interface PrivateSessionDto extends IntegrationReadMetadata {
  /** Null when `availability.state` is `unavailable`. */
  session: PrivateSessionSummaryDto | null;
}

export type PrivateSessionEndReason =
  | "clear"
  | "resume"
  | "logout"
  | "prompt_input_exit"
  | "bypass_permissions_disabled"
  | "other";

export interface PrivateOutcomeMeasure {
  commitsLanded: number | null;
  uncommitted: {
    filesTouched: number;
    linesAdded: number;
    linesRemoved: number;
    generatedLinesExcluded: number;
  } | null;
  lineSurvival: {
    rung: "3d";
    fate: "retained" | "overwritten" | "unreachable" | "unknown";
    rate: number | null;
    linesAuthored: number;
    linesSurviving: number;
    commitsChecked: number;
  } | null;
  errorCount: number | null;
  firstErrorAt: IntegrationIsoTimestamp | null;
  endReason: PrivateSessionEndReason | null;
}

export interface PrivateOutcomeDto extends IntegrationReadMetadata {
  sessionRef: ExternalSessionRef;
  /** Null means the outcome is unavailable or has not matured, never zero. */
  outcome: PrivateOutcomeMeasure | null;
}

export const INTEGRATION_REPLAY_LENSES = [
  "tool-mix",
  "verification",
  "cadence",
  "session-detail",
] as const;
export type PrivateReplayLensName = (typeof INTEGRATION_REPLAY_LENSES)[number];

/** Closed private MCP catalog shared by every resource-server implementation. */
export const PRIVATE_MCP_TOOL_NAMES = [
  "period_summary",
  "list_sessions",
  "get_session_outcome",
  "replay_lens",
] as const;
export type PrivateMcpToolName = (typeof PRIVATE_MCP_TOOL_NAMES)[number];

export interface PrivateMcpPeriodSummaryInput {
  rangeDays: 7 | 30 | 90;
}

export interface PrivateMcpListSessionsInput {
  cursor?: string;
  limit?: number;
}

export interface PrivateMcpSessionOutcomeInput {
  sessionRef: ExternalSessionRef;
}

export interface PrivateMcpReplayLensInput {
  sessionRef: ExternalSessionRef;
  lens: PrivateReplayLensName;
}

export const PRIVATE_MCP_TOOL_SCOPES = {
  period_summary: "period:read",
  list_sessions: "sessions:read",
  get_session_outcome: "sessions:read",
  replay_lens: "replay:read",
} as const satisfies Record<PrivateMcpToolName, IntegrationScope>;

export const PRIVATE_MCP_JSON_OBJECT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  description: "Versioned Seorak private-query result envelope.",
} as const;

const PRIVATE_MCP_READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

/**
 * Publish-safe protocol data only. SDK adapters, authorization, and query
 * execution remain owned by the plane packages that consume this catalog.
 */
export const PRIVATE_MCP_TOOL_CATALOG = [
  {
    name: "period_summary",
    description:
      "Return a grounded Seorak summary for one supported period without raw captured content.",
    inputSchema: {
      type: "object",
      properties: {
        rangeDays: {
          type: "integer",
          enum: [7, 30, 90],
          description: "Supported period length in whole days.",
        },
      },
      required: ["rangeDays"],
      additionalProperties: false,
    },
    annotations: PRIVATE_MCP_READ_ONLY_ANNOTATIONS,
  },
  {
    name: "list_sessions",
    description:
      "List bounded, content-free session summaries using opaque pagination.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: {
          type: "string",
          pattern: "^cur_[0-9a-f]{32}_[0-9a-f]{64}$",
          description: "Opaque cursor returned by a previous list_sessions call.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of sessions to return.",
        },
      },
      additionalProperties: false,
    },
    annotations: PRIVATE_MCP_READ_ONLY_ANNOTATIONS,
  },
  {
    name: "get_session_outcome",
    description:
      "Return a grounded outcome for an opaque external session reference.",
    inputSchema: {
      type: "object",
      properties: {
        sessionRef: {
          type: "string",
          pattern: "^ses_[0-9a-f]{32}$",
          description:
            "Opaque external session reference returned by list_sessions.",
        },
      },
      required: ["sessionRef"],
      additionalProperties: false,
    },
    annotations: PRIVATE_MCP_READ_ONLY_ANNOTATIONS,
  },
  {
    name: "replay_lens",
    description:
      "Return one allowlisted Replay lens result for an opaque external session reference.",
    inputSchema: {
      type: "object",
      properties: {
        sessionRef: {
          type: "string",
          pattern: "^ses_[0-9a-f]{32}$",
          description:
            "Opaque external session reference returned by list_sessions.",
        },
        lens: {
          type: "string",
          enum: INTEGRATION_REPLAY_LENSES,
          description: "Allowlisted Replay lens identifier.",
        },
      },
      required: ["sessionRef", "lens"],
      additionalProperties: false,
    },
    annotations: PRIVATE_MCP_READ_ONLY_ANNOTATIONS,
  },
] as const satisfies readonly {
  name: PrivateMcpToolName;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  annotations: {
    readonly readOnlyHint: true;
    readonly destructiveHint: false;
    readonly idempotentHint: true;
  };
}[];

export type PrivateReplayLensLevel = "period" | "project" | "session";
export type PrivateReplayLensTone = "neutral" | "positive" | "warning" | "negative";
export type PrivateReplayLensUnit =
  | "count"
  | "percent"
  | "usd"
  | "seconds"
  | "milliseconds"
  | "tokens"
  | "none";

export type PrivateReplayLensTarget =
  | { kind: "period"; period: IntegrationDateRange }
  | { kind: "project"; projectRef: ExternalProjectRef }
  | { kind: "session"; sessionRef: ExternalSessionRef };

export interface PrivateReplayLensMetric {
  key: string;
  label: string;
  value: number | boolean | null;
  unit: PrivateReplayLensUnit;
  tone?: PrivateReplayLensTone;
}

export interface PrivateReplayLensRow {
  /** Optional opaque result reference for paging or selection; never a source-row key. */
  resultRef?: ExternalResultRef;
  label: string;
  metrics: readonly PrivateReplayLensMetric[];
  share?: number;
  elapsedMs?: number;
  target?: Exclude<PrivateReplayLensTarget, { kind: "period" }>;
}

export interface PrivateReplayLensResult {
  lens: PrivateReplayLensName;
  level: PrivateReplayLensLevel;
  target: PrivateReplayLensTarget;
  headline: string | null;
  rows: readonly PrivateReplayLensRow[];
  emptyReason: string | null;
  loadedSessionCount: number;
  momentCount: number;
  nextCursor: ExternalCursor | null;
}

export interface PrivateReplayLensDto extends IntegrationReadMetadata {
  /** Null when `availability.state` is `unavailable`. */
  result: PrivateReplayLensResult | null;
}

export const PUBLICATION_SURFACES = ["web", "search", "api", "mcp"] as const;
export type PublicationSurface = (typeof PUBLICATION_SURFACES)[number];

export const PUBLIC_PROFILE_FIELDS = [
  "displayName",
  "headline",
  "bio",
  "location",
  "avatarUrl",
  "contactUrl",
] as const;
export type PublicProfileField = (typeof PUBLIC_PROFILE_FIELDS)[number];

export const PUBLIC_PROJECT_FIELDS = [
  "name",
  "summary",
  "role",
  "startedOn",
  "endedOn",
  "projectUrl",
  "sourceUrl",
  "technologies",
] as const;
export type PublicProjectField = (typeof PUBLIC_PROJECT_FIELDS)[number];

export const PUBLIC_PROJECT_EVIDENCE_FIELDS = [
  "sessionCount",
  "toolCallCount",
  "shippedChangeRate",
  "lineSurvivalRate",
] as const;
export type PublicProjectEvidenceField =
  (typeof PUBLIC_PROJECT_EVIDENCE_FIELDS)[number];

export type PublicProfileSurfaceGrant =
  | { enabled: false; fields: readonly [] }
  | { enabled: true; fields: readonly PublicProfileField[] };

export type PublicProjectSurfaceGrant =
  | { enabled: false; fields: readonly []; evidence: readonly [] }
  | {
      enabled: true;
      fields: readonly PublicProjectField[];
      evidence: readonly PublicProjectEvidenceField[];
    };

/** Each surface has an independent decision and independent field allowlist. */
export type PublicProfilePublicationGrants = {
  [Surface in PublicationSurface]: PublicProfileSurfaceGrant;
};

/** Search can therefore expose less than web, and API/MCP remain separate opt-ins. */
export type PublicProjectPublicationGrants = {
  [Surface in PublicationSurface]: PublicProjectSurfaceGrant;
};

export interface PublicProfileValues {
  displayName?: string;
  headline?: string;
  bio?: string;
  location?: string;
  avatarUrl?: HttpsUrl;
  contactUrl?: HttpsUrl;
}

export interface PublicProjectValues {
  name?: string;
  summary?: string;
  role?: string;
  startedOn?: IntegrationDate;
  endedOn?: IntegrationDate | null;
  projectUrl?: HttpsUrl;
  sourceUrl?: HttpsUrl;
  technologies?: readonly string[];
}

export type PublicEvidenceUnit = "count" | "percent";

export interface PublicProjectEvidenceMeasure {
  value: number | null;
  unit: PublicEvidenceUnit;
  /** Whether the source could support this claim, including a stable capability-gap reason. */
  availability: IntegrationAvailability;
  /** Denominator behind a rate, or the counted population behind a count. */
  sampleSize: number;
  coverage: {
    period: IntegrationDateRange;
    complete: boolean;
  };
  generatedAt: IntegrationIsoTimestamp;
  /** Evidence freshness travels with the frozen claim instead of being inferred by a reader. */
  freshness: IntegrationFreshness;
}

export type PublicProjectEvidence = Partial<
  Record<PublicProjectEvidenceField, PublicProjectEvidenceMeasure>
>;

export interface PublicPublicationStamp {
  apiVersion: IntegrationApiVersion;
  /** Monotonic optimistic-concurrency version of this publication. */
  publicationVersion: number;
  publishedAt: IntegrationIsoTimestamp;
  updatedAt: IntegrationIsoTimestamp;
  /** Set only on a tombstone/audit representation; revoked items are not public reads. */
  revokedAt: IntegrationIsoTimestamp | null;
}

/**
 * Owner-managed publication manifest. A public surface must emit the corresponding
 * projection below, never this candidate-value manifest directly.
 */
export interface PublicProfilePublicationDto extends PublicPublicationStamp {
  profileSlug: string;
  grants: PublicProfilePublicationGrants;
  profile: PublicProfileValues;
}

/** Owner-managed project publication manifest, joined to a profile by public slug only. */
export interface PublicProjectPublicationDto extends PublicPublicationStamp {
  profileSlug: string;
  projectSlug: string;
  grants: PublicProjectPublicationGrants;
  project: PublicProjectValues;
  evidence: PublicProjectEvidence;
}

/** Surface-specific output after the target surface's field allowlist is applied. */
export interface PublicProfileProjectionDto extends PublicPublicationStamp {
  surface: PublicationSurface;
  profileSlug: string;
  fields: Partial<PublicProfileValues>;
}

/** Surface-specific output after both field and evidence allowlists are applied. */
export interface PublicProjectProjectionDto extends PublicPublicationStamp {
  surface: PublicationSurface;
  profileSlug: string;
  projectSlug: string;
  fields: Partial<PublicProjectValues>;
  evidence: PublicProjectEvidence;
}

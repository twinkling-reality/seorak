import type {
  IntegrationAvailability,
  IntegrationDate,
  IntegrationDateRange,
  IntegrationFreshness,
  PublicProfilePublicationDto,
  PublicProfilePublicationGrants,
  PublicProfileValues,
  PublicProjectEvidenceField,
  PublicProjectPublicationDto,
  PublicProjectPublicationGrants,
  PublicProjectValues,
  PublicPublicationStamp,
} from "./integration-api.ts";

/**
 * Private owner commands and the public-only delivery envelope are deliberately
 * different contracts. Only `PublicPublicationDelivery` may cross from an
 * owner cell to the public directory.
 */
export const PUBLICATION_MANAGEMENT_VERSION = "v1" as const;
export type PublicationManagementVersion =
  typeof PUBLICATION_MANAGEMENT_VERSION;

export const PUBLICATION_EVIDENCE_RANGE_DAYS = [7, 30, 90] as const;
export type PublicationEvidenceRangeDays =
  (typeof PUBLICATION_EVIDENCE_RANGE_DAYS)[number];

export const PUBLICATION_ACTIVITY_RANGE_DAYS = [30, 90, 365] as const;
export type PublicationActivityRangeDays =
  (typeof PUBLICATION_ACTIVITY_RANGE_DAYS)[number];

/** Portable token-usage card window. Not used as calendar intensity. */
export const PUBLICATION_TOKEN_USAGE_RANGE_DAYS = [30, 90] as const;
export type PublicationTokenUsageRangeDays =
  (typeof PUBLICATION_TOKEN_USAGE_RANGE_DAYS)[number];

export const PUBLIC_ACTIVITY_FIELDS = ["calendar", "streak"] as const;
export type PublicActivityField = (typeof PUBLIC_ACTIVITY_FIELDS)[number];

/**
 * Grantable token-usage projection fields. `series` is the daily chart;
 * `totals` is the period sum. Search never receives either.
 */
export const PUBLIC_TOKEN_USAGE_FIELDS = ["series", "totals"] as const;
export type PublicTokenUsageField = (typeof PUBLIC_TOKEN_USAGE_FIELDS)[number];

/** Agents the public token-usage card may split into lines. */
export const PUBLIC_TOKEN_USAGE_AGENTS = ["claude-code", "codex"] as const;
export type PublicTokenUsageAgent = (typeof PUBLIC_TOKEN_USAGE_AGENTS)[number];

export type PublicationUnavailablePolicy = "refuse" | "publish-unavailable";

export type PublicActivitySurfaceGrant =
  | { enabled: false; fields: readonly [] }
  | { enabled: true; fields: readonly PublicActivityField[] };

/** Search never indexes or ranks calendar intensity or streak length. */
export interface PublicActivityPublicationGrants {
  web: PublicActivitySurfaceGrant;
  search: { enabled: false; fields: readonly [] };
  api: PublicActivitySurfaceGrant;
  mcp: PublicActivitySurfaceGrant;
}

export type PublicTokenUsageSurfaceGrant =
  | { enabled: false; fields: readonly [] }
  | { enabled: true; fields: readonly PublicTokenUsageField[] };

/** Search never indexes or ranks token usage. */
export interface PublicTokenUsagePublicationGrants {
  web: PublicTokenUsageSurfaceGrant;
  search: { enabled: false; fields: readonly [] };
  api: PublicTokenUsageSurfaceGrant;
  mcp: PublicTokenUsageSurfaceGrant;
}

export interface OwnerPublicationTokenUsageSelection {
  rangeDays: PublicationTokenUsageRangeDays;
  grants: PublicTokenUsagePublicationGrants;
  unavailable: PublicationUnavailablePolicy;
}

/**
 * Private source selection. `sourceProjectId` is an owner-cell identifier and
 * is forbidden from every public bundle, receipt, log, and directory row.
 */
export interface OwnerPublicationProjectSelection {
  sourceProjectId: string;
  projectSlug: string;
  project: PublicProjectValues;
  grants: PublicProjectPublicationGrants;
  evidence: {
    fields: readonly PublicProjectEvidenceField[];
    rangeDays: PublicationEvidenceRangeDays;
    unavailable: PublicationUnavailablePolicy;
  };
  /** Opt-in frozen token-usage series for this project. Null omits the embed. */
  tokenUsage: OwnerPublicationTokenUsageSelection | null;
}

export interface OwnerPublicationActivitySelection {
  /** IANA timezone used to freeze calendar-day boundaries. */
  timeZone: string;
  rangeDays: PublicationActivityRangeDays;
  grants: PublicActivityPublicationGrants;
  unavailable: PublicationUnavailablePolicy;
}

/**
 * Strict, owner-authored input. It intentionally contains no measured value,
 * coverage, freshness, session, event, or delivery field.
 */
export interface OwnerPublicationManifest {
  apiVersion: PublicationManagementVersion;
  /** Client idempotency key for saving this exact private manifest. */
  commandId: string;
  /** Optimistic revision of the locally saved manifest; zero creates it. */
  expectedRevision: number;
  profileSlug: string;
  profile: PublicProfileValues;
  grants: PublicProfilePublicationGrants;
  activity: OwnerPublicationActivitySelection | null;
  /** Opt-in profile-wide frozen token-usage series. Null omits the embed. */
  tokenUsage: OwnerPublicationTokenUsageSelection | null;
  projects: readonly OwnerPublicationProjectSelection[];
}

export type PublicActivityCoverageState =
  | "complete"
  | "partial"
  | "unavailable";

export interface PublicActivityCalendarDay {
  date: IntegrationDate;
  /**
   * Distinct sessions observed on this local calendar day. Null means no count
   * can be claimed. Zero is valid only with complete coverage.
   */
  distinctSessionCount: number | null;
  /** False is valid only for complete coverage with a measured zero. */
  active: boolean | null;
  coverage: PublicActivityCoverageState;
  availability: IntegrationAvailability;
}

export type PublicActivityStreak =
  | {
      status: "known";
      days: number;
      start: IntegrationDate | null;
      through: IntegrationDate;
      blockedAt: null;
      completeActiveDaysSinceBoundary: number;
    }
  | {
      status: "unknown";
      days: null;
      start: null;
      through: IntegrationDate;
      /** First partial/unavailable day reached while walking backward. */
      blockedAt: IntegrationDate;
      /** Honest lower bound; never presented as the streak length. */
      completeActiveDaysSinceBoundary: number;
    };

/** Frozen activity evidence; readers never recompute it from project evidence. */
export interface PublicActivityPublicationDto extends PublicPublicationStamp {
  profileSlug: string;
  timeZone: string;
  period: IntegrationDateRange;
  grants: PublicActivityPublicationGrants;
  days: readonly PublicActivityCalendarDay[];
  streak: PublicActivityStreak;
  generatedAt: string;
  freshness: IntegrationFreshness;
}

/** Grant-filtered activity read; publication grants never leave the directory. */
export interface PublicActivityProjectionDto extends PublicPublicationStamp {
  surface: "web" | "api" | "mcp";
  profileSlug: string;
  timeZone: string;
  period: IntegrationDateRange;
  fields: {
    calendar?: {
      days: readonly PublicActivityCalendarDay[];
      generatedAt: string;
      freshness: IntegrationFreshness;
    };
    streak?: PublicActivityStreak;
  };
}

/**
 * One calendar day of published token usage. Counts are input+output tokens.
 * Null totals mean the day cannot be claimed; never treat unavailable as zero.
 */
export interface PublicTokenUsageDay {
  date: IntegrationDate;
  byAgent: Partial<Record<PublicTokenUsageAgent, number>>;
  /** Sum of byAgent for that day, or null when coverage cannot support a total. */
  total: number | null;
  coverage: PublicActivityCoverageState;
  availability: IntegrationAvailability;
}

export interface PublicTokenUsageTotals {
  total: number | null;
  byAgent: Partial<Record<PublicTokenUsageAgent, number>>;
  availability: IntegrationAvailability;
  sampleSize: number;
  coverage: {
    period: IntegrationDateRange;
    complete: boolean;
  };
}

/**
 * Frozen token-usage series for the portable embed. Readers never recompute it
 * from private history. Distinct from activity calendar intensity.
 */
export interface PublicTokenUsagePublicationDto extends PublicPublicationStamp {
  profileSlug: string;
  /** Null means profile-wide; set for a project-scoped embed. */
  projectSlug: string | null;
  rangeDays: PublicationTokenUsageRangeDays;
  period: IntegrationDateRange;
  grants: PublicTokenUsagePublicationGrants;
  days: readonly PublicTokenUsageDay[];
  totals: PublicTokenUsageTotals;
  generatedAt: string;
  freshness: IntegrationFreshness;
}

/** Grant-filtered token-usage read; publication grants never leave the directory. */
export interface PublicTokenUsageProjectionDto extends PublicPublicationStamp {
  surface: "web" | "api" | "mcp";
  profileSlug: string;
  projectSlug: string | null;
  rangeDays: PublicationTokenUsageRangeDays;
  period: IntegrationDateRange;
  fields: {
    series?: {
      days: readonly PublicTokenUsageDay[];
      generatedAt: string;
      freshness: IntegrationFreshness;
    };
    totals?: PublicTokenUsageTotals;
  };
}

/** Project freeze plus optional project-scoped token-usage embed. */
export type PublicProjectPublicationBundleDto = PublicProjectPublicationDto & {
  tokenUsage: PublicTokenUsagePublicationDto | null;
};

/** One complete desired public generation, suitable for one atomic D1 apply. */
export interface PublicPublicationBundle {
  apiVersion: PublicationManagementVersion;
  generation: number;
  profile: PublicProfilePublicationDto;
  activity: PublicActivityPublicationDto | null;
  /** Profile-wide token-usage freeze; null omits the profile embed. */
  tokenUsage: PublicTokenUsagePublicationDto | null;
  /** Complete desired project set; omission removes a previously current project. */
  projects: readonly PublicProjectPublicationBundleDto[];
}

export interface PublicPublicationApplyDelivery {
  apiVersion: PublicationManagementVersion;
  operation: "apply";
  deliveryId: string;
  generation: number;
  /** Previously desired public slug to tombstone atomically when it changes. */
  previousProfileSlug: string | null;
  /** SHA-256 of the canonical apply content (previous slug plus public bundle). */
  contentDigest: string;
  bundle: PublicPublicationBundle;
}

export interface PublicPublicationRevokeDelivery {
  apiVersion: PublicationManagementVersion;
  operation: "revoke";
  deliveryId: string;
  generation: number;
  /** SHA-256 of the canonical revocation content. */
  contentDigest: string;
  profileSlug: string;
  /** Last generation this tombstone supersedes; zero is allowed before first apply. */
  previousGeneration: number;
  revokedAt: string;
}

export type PublicPublicationDelivery =
  | PublicPublicationApplyDelivery
  | PublicPublicationRevokeDelivery;

export interface PublicPublicationApplyReceipt {
  apiVersion: PublicationManagementVersion;
  operation: PublicPublicationDelivery["operation"];
  deliveryId: string;
  generation: number;
  contentDigest: string;
  disposition: "applied" | "already-applied";
  appliedAt: string;
}

export type OwnerPublicationDeliveryState =
  | "saved"
  | "queued"
  | "delivering"
  | "retrying"
  | "applied"
  | "failed";

/** Public-safe status for the owner UI; it never includes manifest contents. */
export interface OwnerPublicationStatus {
  apiVersion: PublicationManagementVersion;
  savedRevision: number;
  generatedVersion: number;
  appliedVersion: number;
  /**
   * Oldest unresolved generation that must complete before later applies can
   * advance. A later revoke supersedes every older unresolved delivery, so the
   * revoke itself becomes the blocker. Null means no delivery is outstanding.
   */
  blockingGeneration: number | null;
  state: OwnerPublicationDeliveryState;
  operation: PublicPublicationDelivery["operation"] | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  appliedAt: string | null;
}

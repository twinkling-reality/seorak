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

export const PUBLIC_ACTIVITY_FIELDS = ["calendar", "streak"] as const;
export type PublicActivityField = (typeof PUBLIC_ACTIVITY_FIELDS)[number];

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

/** One complete desired public generation, suitable for one atomic D1 apply. */
export interface PublicPublicationBundle {
  apiVersion: PublicationManagementVersion;
  generation: number;
  profile: PublicProfilePublicationDto;
  activity: PublicActivityPublicationDto | null;
  /** Complete desired project set; omission removes a previously current project. */
  projects: readonly PublicProjectPublicationDto[];
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

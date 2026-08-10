// Web-local schema + type surface.
//
// This is the single import site the web layer uses for the OverviewSnapshot
// family and its zod guards. It re-exports the canonical, publish-safe types
// from @seorak/types (the worker and web agree on these), plus the web's zod
// schemas (./schemas) that validate worker responses and back demo fixtures.
//
// The overview family can carry responsible-member attribution on live Shared
// rows. It deliberately has no person-ranked aggregate, conflict, memory, or
// conversation contracts.

// ── Canonical types from @seorak/types ──────────────
export type {
  OverviewSnapshot,
  UsageSnapshot,
  OutcomesSnapshot,
  ActivitySnapshot,
  ToolsSnapshot,
  DailyPoint,
  PeriodDelta,
  ProjectRollup,
  EndReasonCount,
  HourBucket,
  ToolCallRollup,
  ModelRollup,
  AgentRollup,
  AgentDailyPoint,
  AgentHourPoint,
  AgentCoverage,
  AgentModelRollup,
  AgentOutcomeRollup,
  SessionCapabilities,
  RepoMomentum,
  RepoTemperature,
  PortfolioMomentum,
  CodebaseProjectSplit,
  VerificationRollup,
  Intervention,
  SessionSummary,
  Keyframe,
  KeyframeKind,
  ReplayActivityBucket,
  ReplayMoment,
  ReplaySession,
  ReplayTotals,
} from '@seorak/types';

// ── Zod schemas + helpers (web-local) ───────────────
// overviewSnapshotSchema, sessionSummarySchema, createEmptyOverview,
// validateResponse, and the family schemas all come through here.
export * from './schemas/index.js';

import { liveSnapshotSchema, overviewSnapshotSchema } from './schemas/index.js';
import { validateResponse } from './schemas/index.js';
import type { OverviewSnapshot } from '@seorak/types';
import type { LiveSnapshot } from './schemas/index.js';

/**
 * Validate an unknown worker payload as the current OverviewSnapshot contract.
 * Any missing or malformed required field throws so polling preserves a prior
 * snapshot as stale or surfaces a cold schema error. Narrow forward-compatible
 * enum catches remain inside the schema for additive values.
 */
export function validateOverview(data: unknown): OverviewSnapshot {
  return validateResponse(overviewSnapshotSchema, data, 'overview');
}

/** Validate the fast `/live` head. Invalid data is a failed refresh, never an
 * empty ready board. */
export function validateLive(data: unknown): LiveSnapshot {
  return validateResponse(liveSnapshotSchema, data, 'live');
}

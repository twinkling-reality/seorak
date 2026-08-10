import {
  INTEGRATION_API_VERSION,
  INTEGRATION_REPLAY_LENSES,
  SESSION_OUTCOME_MAX_ROWS,
  WIDEST_OVERVIEW_RANGE_DAYS,
  type ExternalCursor,
  type ExternalProjectRef,
  type ExternalSessionRef,
  type IntegrationCoverage,
  type IntegrationDateRange,
  type IntegrationReadMetadata,
  type PrivateOutcomeDto,
  type PrivatePeriodDto,
  type PrivateReplayLensDto,
  type PrivateReplayLensName,
  type PrivateSessionPageDto,
  type PrivateSessionSummaryDto,
  type SessionCapabilities,
} from "@seorak/types";
import {
  assertLocalIntegrationPersonalAuthority,
  ensureLocalIntegrationProjectRefIn,
  listLocalIntegrationSessionPage,
  localIntegrationObservedWindowIn,
  readLocalIntegrationSessionIn,
  resolveLocalIntegrationSessionRefIn,
  type LocalIntegrationPrincipal,
  type LocalIntegrationReadBoundary,
} from "./local-integration-store.ts";
import { buildLocalIntegrationReplayLens } from "./local-integration-replay-lenses.ts";
import {
  buildLocalOverviewOn,
  buildLocalReplayOnDatabase,
  buildLocalSessionOutcomeOnDatabase,
  localSessionRowToSummary,
} from "./local-projection.ts";
import { openLocalHistory, type LocalSessionRow } from "./local-store.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const FRESHNESS_MS = 5 * 60_000;
export const LOCAL_PRIVATE_REPLAY_ROW_BUDGET = 10_000;

export interface LocalPrivateQueryOptions {
  directory?: string;
  now?: Date;
}

interface LocalBoundary extends LocalIntegrationReadBoundary {
  restricted: boolean;
}

function queryNow(principal: LocalIntegrationPrincipal, proposed: Date | undefined): Date {
  return new Date(Math.max(
    proposed?.getTime() ?? Date.now(),
    Date.parse(principal.authorizedAt),
  ));
}

function querySnapshot<T>(
  directory: string | undefined,
  operation: (database: import("node:sqlite").DatabaseSync) => T,
): T {
  const database = openLocalHistory(directory);
  database.exec("BEGIN IMMEDIATE");
  try {
    assertLocalIntegrationPersonalAuthority(database);
    const result = operation(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the query/provenance failure.
    }
    throw error;
  } finally {
    database.close();
  }
}

function isoDate(value: string): string {
  return value.slice(0, 10);
}

function dateRange(from: string, through: string): IntegrationDateRange {
  return { from: isoDate(from), through: isoDate(through) };
}

function boundaryFor(
  principal: LocalIntegrationPrincipal,
  now: Date,
  requestedDays: 7 | 30 | 90 = WIDEST_OVERVIEW_RANGE_DAYS,
): LocalBoundary {
  const requestedSince = new Date(now.getTime() - requestedDays * DAY_MS).toISOString();
  const requestedUntil = now.toISOString();
  const readableSince = [requestedSince, principal.restrictions.dataNotBefore]
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1)!;
  const readableUntil = [requestedUntil, principal.restrictions.dataNotAfter]
    .filter((value): value is string => value !== null)
    .sort()[0]!;
  return {
    credentialId: principal.credentialId,
    repoId: principal.restrictions.repoId,
    requestedSince,
    requestedUntil,
    confidentialSince: principal.restrictions.dataNotBefore,
    confidentialUntil: principal.restrictions.dataNotAfter,
    restricted: readableSince !== requestedSince || readableUntil !== requestedUntil,
  };
}

function metadata(
  boundary: LocalBoundary,
  generatedAt: Date,
  options: {
    matched: number;
    included: number;
    observedFrom: string | null;
    observedThrough: string | null;
    unavailable?: "not-captured" | "not-retained" | "not-yet-computed" |
      "outside-credential-restriction" | "temporarily-unavailable" | "result-limit";
    limited?: boolean;
    dataThrough?: string | null;
  },
): IntegrationReadMetadata {
  const unavailable = options.unavailable !== undefined;
  const omissions = [
    ...(boundary.restricted ? (["credential-restriction"] as const) : []),
    ...(options.limited ? (["result-limit"] as const) : []),
  ];
  const coverage: IntegrationCoverage = {
    requested: dateRange(boundary.requestedSince, boundary.requestedUntil),
    observed: options.observedFrom && options.observedThrough
      ? dateRange(options.observedFrom, options.observedThrough)
      : null,
    matchedSessionCount: options.matched,
    includedSessionCount: options.included,
    complete: !unavailable && omissions.length === 0,
    omissions,
  };
  return {
    apiVersion: INTEGRATION_API_VERSION,
    availability: unavailable
      ? { state: "unavailable", reason: options.unavailable! }
      : options.limited || boundary.restricted
        ? {
            state: "partial",
            reason: options.limited ? "result-limit" : "outside-credential-restriction",
          }
        : { state: "available", reason: null },
    coverage,
    freshness: {
      state: "fresh",
      generatedAt: generatedAt.toISOString(),
      dataThrough: options.dataThrough ?? options.observedThrough,
      staleAt: new Date(generatedAt.getTime() + FRESHNESS_MS).toISOString(),
    },
  };
}

function sessionSummary(
  row: LocalSessionRow,
  sessionRef: ExternalSessionRef,
  projectRef: ExternalProjectRef,
  nowMs: number,
  declaredCapabilities: SessionCapabilities | undefined,
): PrivateSessionSummaryDto {
  const summary = localSessionRowToSummary(row, nowMs, null, declaredCapabilities);
  return {
    sessionRef,
    projectRef,
    agent: summary.agent,
    status: summary.status === "ended" ? "ended" : "active",
    startedAt: summary.startedAt,
    endedAt: row.endedAt,
    elapsedSeconds: summary.elapsedSeconds,
    toolCallCount: summary.toolCallCount,
    promptCount: null,
    costUsd: summary.costUsd,
  };
}

function withSnapshotBoundary(
  current: LocalBoundary,
  snapshot: LocalIntegrationReadBoundary,
): LocalBoundary {
  const readableSince = [snapshot.requestedSince, snapshot.confidentialSince]
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1)!;
  const readableUntil = [snapshot.requestedUntil, snapshot.confidentialUntil]
    .filter((value): value is string => value !== null)
    .sort()[0]!;
  return {
    ...current,
    ...snapshot,
    restricted:
      readableSince !== snapshot.requestedSince || readableUntil !== snapshot.requestedUntil,
  };
}

export function queryLocalPrivatePeriod(
  principal: LocalIntegrationPrincipal,
  rangeDays: 7 | 30 | 90,
  options: LocalPrivateQueryOptions = {},
): PrivatePeriodDto {
  const now = queryNow(principal, options.now);
  const boundary = boundaryFor(principal, now, rangeDays);
  return querySnapshot(options.directory, (database) => {
    const projectRef = principal.restrictions.repoId === null
      ? null
      : ensureLocalIntegrationProjectRefIn(
          database,
          principal.restrictions.repoId,
          now.toISOString(),
        );
    if (boundary.restricted) {
      return {
        ...metadata(boundary, now, {
          matched: 0,
          included: 0,
          observedFrom: null,
          observedThrough: null,
          unavailable: "outside-credential-restriction",
        }),
        period: dateRange(boundary.requestedSince, boundary.requestedUntil),
        projectRef,
        metrics: null,
      };
    }

    const snapshot = buildLocalOverviewOn(database, {
      rangeDays,
      nowMs: now.getTime(),
    });
    const observed = localIntegrationObservedWindowIn(
      database,
      boundary,
      now.getTime(),
    );
    const project = principal.restrictions.repoId === null
      ? undefined
      : snapshot.usage.projects.find(
          (candidate) => candidate.repoId === principal.restrictions.repoId,
        );
    const metrics = project !== undefined
      ? {
          sessionCount: project.sessions,
          completedSessionCount: Math.max(0, project.sessions - project.activeSessions),
          toolCallCount: project.toolCalls,
          promptCount: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: project.costUsd,
          shippedChangeRate: project.shipRate,
        }
      : principal.restrictions.repoId !== null
        ? {
            sessionCount: 0,
            completedSessionCount: 0,
            toolCallCount: 0,
            promptCount: null,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            shippedChangeRate: null,
          }
        : {
            sessionCount: snapshot.usage.totals.sessions,
            completedSessionCount: snapshot.outcomes.endedCount,
            toolCallCount: snapshot.usage.totals.toolCalls,
            promptCount: null,
            inputTokens: null,
            outputTokens: null,
            costUsd: snapshot.usage.cost.totalUsd,
            shippedChangeRate: snapshot.outcomes.shipRate,
          };
    return {
      ...metadata(boundary, now, {
        matched: observed.count,
        included: observed.count,
        observedFrom: observed.first,
        observedThrough: observed.last,
        dataThrough: observed.last,
      }),
      period: dateRange(boundary.requestedSince, boundary.requestedUntil),
      projectRef,
      metrics,
    };
  });
}

export function queryLocalPrivateSessions(
  principal: LocalIntegrationPrincipal,
  input: { limit: number; cursor: ExternalCursor | null } & LocalPrivateQueryOptions,
): PrivateSessionPageDto {
  const now = queryNow(principal, input.now);
  const boundary = boundaryFor(principal, now);
  const page = listLocalIntegrationSessionPage(boundary, {
    limit: input.limit,
    cursor: input.cursor,
    ...(input.directory === undefined ? {} : { directory: input.directory }),
    nowMs: now.getTime(),
  });
  const effective = withSnapshotBoundary(boundary, page.boundary);
  const generatedAt = new Date(page.queryTime);
  const first = page.rows.at(-1)?.session.lastEventAt ?? null;
  const last = page.rows[0]?.session.lastEventAt ?? null;
  return {
    ...metadata(effective, generatedAt, {
      matched: page.totalMatched,
      included: page.rows.length,
      observedFrom: first,
      observedThrough: last,
      limited: page.totalMatched > page.rows.length,
    }),
    items: page.rows.map((row) =>
      sessionSummary(
        row.session,
        row.sessionRef,
        row.projectRef,
        generatedAt.getTime(),
        row.declaredCapabilities,
      )),
    nextCursor: page.nextCursor,
  };
}

type Lookup =
  | { visible: true; session: LocalSessionRow; boundary: LocalBoundary }
  | {
      visible: false;
      boundary: LocalBoundary;
      cause: "not-retained" | "outside-credential-restriction";
    };

function visibleSessionOn(
  database: import("node:sqlite").DatabaseSync,
  principal: LocalIntegrationPrincipal,
  sessionRef: ExternalSessionRef,
  now: Date,
): Lookup {
  const boundary = boundaryFor(principal, now);
  const sessionId = resolveLocalIntegrationSessionRefIn(database, sessionRef);
  const session = sessionId === null
    ? null
    : readLocalIntegrationSessionIn(database, sessionId);
  if (session === null) return { visible: false, boundary, cause: "not-retained" };
  if (boundary.repoId !== null && session.repoId !== boundary.repoId) {
    return { visible: false, boundary, cause: "outside-credential-restriction" };
  }
  if (
    (boundary.confidentialSince !== null && session.startedAt < boundary.confidentialSince) ||
    (boundary.confidentialUntil !== null && session.lastEventAt > boundary.confidentialUntil) ||
    (boundary.confidentialUntil !== null &&
      boundary.confidentialUntil < now.toISOString() &&
      session.endedAt === null)
  ) {
    return { visible: false, boundary, cause: "outside-credential-restriction" };
  }
  if (
    session.lastEventAt < boundary.requestedSince ||
    session.lastEventAt > boundary.requestedUntil
  ) {
    return {
      visible: false,
      boundary,
      cause: boundary.restricted ? "outside-credential-restriction" : "not-retained",
    };
  }
  return { visible: true, session, boundary };
}

export function queryLocalPrivateOutcome(
  principal: LocalIntegrationPrincipal,
  sessionRef: ExternalSessionRef,
  options: LocalPrivateQueryOptions = {},
): PrivateOutcomeDto {
  const now = queryNow(principal, options.now);
  return querySnapshot(options.directory, (database) => {
    const lookup = visibleSessionOn(database, principal, sessionRef, now);
    if (!lookup.visible) {
      return {
        ...metadata(lookup.boundary, now, {
          matched: 0,
          included: 0,
          observedFrom: null,
          observedThrough: null,
          unavailable: lookup.cause,
        }),
        sessionRef,
        outcome: null,
      };
    }
    const outcome = buildLocalSessionOutcomeOnDatabase(
      database,
      lookup.session.sessionId,
      {
        nowMs: now.getTime(),
        rowBudget: SESSION_OUTCOME_MAX_ROWS,
        window: {
          startedAt: lookup.session.startedAt,
          lastEventAt: lookup.session.lastEventAt,
        },
      },
    );
    return {
      ...metadata(lookup.boundary, now, {
        matched: 1,
        included: outcome === null ? 0 : 1,
        observedFrom: lookup.session.lastEventAt,
        observedThrough: lookup.session.lastEventAt,
        ...(outcome === null ? { unavailable: "not-yet-computed" as const } : {}),
      }),
      sessionRef,
      outcome: outcome === null
        ? null
        : {
            commitsLanded: outcome.commitsLanded,
            uncommitted: outcome.uncommitted,
            lineSurvival: outcome.lineSurvival,
            errorCount: outcome.errorCount,
            firstErrorAt: outcome.firstErrorAt,
            endReason: outcome.endReason,
          },
    };
  });
}

export function queryLocalPrivateReplayLens(
  principal: LocalIntegrationPrincipal,
  sessionRef: ExternalSessionRef,
  lens: PrivateReplayLensName,
  options: LocalPrivateQueryOptions = {},
): PrivateReplayLensDto {
  if (!(INTEGRATION_REPLAY_LENSES as readonly string[]).includes(lens)) {
    throw new TypeError("unsupported integration Replay lens");
  }
  const now = queryNow(principal, options.now);
  return querySnapshot(options.directory, (database) => {
    const lookup = visibleSessionOn(database, principal, sessionRef, now);
    if (!lookup.visible) {
      return {
        ...metadata(lookup.boundary, now, {
          matched: 0,
          included: 0,
          observedFrom: null,
          observedThrough: null,
          unavailable: lookup.cause,
        }),
        result: null,
      };
    }
    const replay = buildLocalReplayOnDatabase(database, lookup.session.sessionId, {
      nowMs: now.getTime(),
      rowBudget: LOCAL_PRIVATE_REPLAY_ROW_BUDGET,
      window: {
        startedAt: lookup.session.startedAt,
        lastEventAt: lookup.session.lastEventAt,
      },
      integrationMeasurements: true,
    });
    return {
      ...metadata(lookup.boundary, now, {
        matched: 1,
        included: replay === null ? 0 : 1,
        observedFrom: lookup.session.lastEventAt,
        observedThrough: lookup.session.lastEventAt,
        ...(replay === null ? { unavailable: "not-retained" as const } : {}),
      }),
      result: replay === null
        ? null
        : buildLocalIntegrationReplayLens(replay, sessionRef, lens),
    };
  });
}

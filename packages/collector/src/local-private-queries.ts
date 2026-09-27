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
  type PrivateSessionDto,
  type PrivateSessionPageDto,
  type PrivateSessionResolveInput,
  type PrivateSessionSummaryDto,
  type SessionCapabilities,
} from "@seorak/types";
import {
  assertLocalIntegrationPersonalAuthority,
  ensureLocalIntegrationProjectRefIn,
  ensureLocalIntegrationSessionRefIn,
  listLocalIntegrationSessionPage,
  localIntegrationObservedWindowIn,
  readLocalDeclaredCapabilitiesIn,
  readLocalIntegrationSessionByNativeIn,
  readLocalIntegrationSessionIn,
  resolveLocalIntegrationSessionRefIn,
  type LocalIntegrationPrincipal,
  type LocalIntegrationReadBoundary,
} from "./local-integration-store.ts";
import { buildLocalIntegrationReplayLens } from "./local-integration-replay-lenses.ts";
import {
  buildLocalOverviewProjectionOn,
  buildLocalReplayOnDatabase,
  buildLocalSessionOutcomeOnDatabase,
  localSessionRowToSummary,
} from "./local-projection.ts";
import {
  openLocalHistory,
  readLocalSessionLaunchersIn,
  type LocalSessionRow,
} from "./local-store.ts";

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

type LocalDatabase = import("node:sqlite").DatabaseSync;

/**
 * One connection for the whole query, opened and closed exactly once.
 *
 * Split out of `querySnapshot` so a query that must WRITE something before it
 * reads can do both on the same connection without opening a second one. See
 * `queryLocalPrivatePeriod` for the only query that does.
 */
function withQueryConnection<T>(
  directory: string | undefined,
  operation: (database: LocalDatabase) => T,
): T {
  const database = openLocalHistory(directory);
  try {
    return operation(database);
  } finally {
    database.close();
  }
}

/**
 * A READ transaction, and deliberately not the write transaction this used to
 * open.
 *
 * `BEGIN IMMEDIATE` takes SQLite's write lock at the first statement and holds
 * it until COMMIT. That was invisible while these callbacks were short, and it
 * stopped being invisible when `queryLocalPrivatePeriod` folded the whole
 * overview inside one: measured on the author's 345,764-row history on
 * 2026-09-09, `buildLocalOverviewProjectionOn` takes 2,312 ms at 90 days and
 * 2,568 ms at 30, so an API read held the write lock for two and a half seconds.
 * The collector's own capture appends queue behind that lock and start failing
 * once the 5,000 ms `busy_timeout` in `openLocalHistory` expires. A read that
 * can cost the user their capture is a correctness defect wearing a performance
 * defect's clothes.
 *
 * `BEGIN DEFERRED` takes a READ snapshot at the first read and holds THAT, which
 * is the property these callbacks actually need: every row a query folds comes
 * from one instant, so a page and its metadata cannot disagree. In WAL mode a
 * reader does not block a writer at all, so capture keeps appending underneath.
 *
 * The provenance assertion stays INSIDE the snapshot, because what it certifies
 * is the shape of the rows being read, not the shape of the file at some other
 * moment.
 */
function querySnapshotOn<T>(
  database: LocalDatabase,
  operation: (database: LocalDatabase) => T,
): T {
  database.exec("BEGIN DEFERRED");
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
  }
}

/**
 * The short write transaction, held for one statement rather than across a fold.
 *
 * `ensureLocalIntegrationProjectRefIn` is the only write reached through THESE
 * helpers, which is a narrower claim than it first looks and is the one that
 * matters: it is an `INSERT OR IGNORE` plus a `SELECT`, so giving it its own
 * transaction is what lets the read above stop being one. The private query
 * layer does write elsewhere. `listLocalIntegrationSessionPage` opens its own
 * connection and its own `BEGIN IMMEDIATE` around a cursor clock update and
 * per-row reference inserts, and it never passes through here.
 *
 * This is the fifth two-line copy of the same helper in this package
 * (`local-store.ts`, `local-sync-store.ts`, `local-integration-store.ts` and
 * `session-cursors.ts` hold the others, all module-private). Folding the five
 * into one is a change of its own; it is not this one.
 */
function queryWriteStepOn<T>(
  database: LocalDatabase,
  operation: (database: LocalDatabase) => T,
): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the write failure.
    }
    throw error;
  }
}

function querySnapshot<T>(
  directory: string | undefined,
  operation: (database: LocalDatabase) => T,
): T {
  return withQueryConnection(directory, (database) =>
    querySnapshotOn(database, operation),
  );
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
  launcher: string | null,
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
    launcher,
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
  return withQueryConnection(options.directory, (database) => {
    // Provenance FIRST, and outside both transactions, so a history whose
    // authority shape has changed is refused before this query writes anything.
    // That ordering is what it was inside the single write transaction, and the
    // suite pins it: "reasserts Personal authority at every canonical query
    // entrypoint" expects the throw from this entry point too.
    assertLocalIntegrationPersonalAuthority(database);
    // The project reference is an allocation, not a measurement: an
    // `INSERT OR IGNORE` plus a `SELECT`, idempotent per repo. It takes the
    // write lock on its own and gives it straight back, which is the whole
    // point of separating it from the fold below.
    //
    // Separating it also makes the allocation DURABLE across a failed fold,
    // where the single transaction used to roll it back. That is deliberate and
    // harmless: the reference is an idempotent per-repo identifier, not a
    // measurement, so a committed one that no response ever carried is simply
    // the id the next call will be handed.
    const restrictedRepoId = principal.restrictions.repoId;
    const projectRef = restrictedRepoId === null
      ? null
      : queryWriteStepOn(database, (writable) =>
          ensureLocalIntegrationProjectRefIn(
            writable,
            restrictedRepoId,
            now.toISOString(),
          ),
        );
    // A restricted credential reads nothing, so it opens no snapshot. The
    // answer is the boundary and the reference, both already in hand.
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

    return querySnapshotOn(database, () => {
      const projection = buildLocalOverviewProjectionOn(database, {
        rangeDays,
        nowMs: now.getTime(),
      });
      const snapshot = projection.snapshot;
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
      const periodTokens = principal.restrictions.repoId === null
        ? projection.periodTokens
        : project === undefined
          ? null
          : projection.periodTokensByRepo.get(project.repoId) ?? null;
      const metrics = project !== undefined
        ? {
            sessionCount: project.sessions,
            completedSessionCount: Math.max(0, project.sessions - project.activeSessions),
            toolCallCount: project.toolCalls,
            promptCount: null,
            inputTokens: periodTokens?.inputTokens ?? null,
            outputTokens: periodTokens?.outputTokens ?? null,
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
              inputTokens: periodTokens?.inputTokens ?? null,
              outputTokens: periodTokens?.outputTokens ?? null,
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
        row.launcher,
      )),
    nextCursor: page.nextCursor,
  };
}

type Lookup =
  | { visible: true; session: LocalSessionRow; boundary: LocalBoundary }
  | {
      visible: false;
      boundary: LocalBoundary;
      cause: "not-captured" | "not-retained" | "outside-credential-restriction";
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
  return visibilityOf(session, boundary, now);
}

/**
 * The credential's restrictions applied to one found session. Shared by the
 * sessionRef lookup and the native-identity resolve, so both refuse exactly the
 * same sessions for exactly the same reasons.
 */
function visibilityOf(
  session: LocalSessionRow,
  boundary: LocalBoundary,
  now: Date,
): Lookup {
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

/**
 * Resolve a session the caller already knows by its agent's own identity (ADR 007).
 *
 * The caller brings the native id; this answers with the same content-free summary
 * `list_sessions` would have shown for that session, including its opaque
 * `sessionRef`, under exactly the visibility rules every sessionRef read uses. The
 * native id is a lookup key and nothing more: it is not echoed, stored, audited, or
 * written into any reference.
 *
 * A miss is `unavailable: not-captured`. This history holds no session under that
 * identity, and it cannot say why: the agent may not have reached a hook yet, the
 * launching program may have switched capture off, or the id was never a session
 * here. A caller that launched the session moments ago should retry; `freshness`
 * says how current the answer is.
 */
export function queryLocalPrivateResolveSession(
  principal: LocalIntegrationPrincipal,
  input: PrivateSessionResolveInput,
  options: LocalPrivateQueryOptions = {},
): PrivateSessionDto {
  const now = queryNow(principal, options.now);
  return withQueryConnection(options.directory, (database) => {
    const found = querySnapshotOn(database, (snapshot) => {
      const boundary = boundaryFor(principal, now);
      const session = readLocalIntegrationSessionByNativeIn(
        snapshot,
        input.agent,
        input.nativeSessionId,
      );
      if (session === null) {
        return { visible: false, boundary, cause: "not-captured" } as const;
      }
      const lookup = visibilityOf(session, boundary, now);
      if (!lookup.visible) return lookup;
      return {
        ...lookup,
        declared: readLocalDeclaredCapabilitiesIn(snapshot, [session.sessionId])
          .get(session.sessionId),
        launcher: readLocalSessionLaunchersIn(snapshot, [session.sessionId])
          .get(session.sessionId) ?? null,
      };
    });
    if (!found.visible) {
      return {
        ...metadata(found.boundary, now, {
          matched: 0,
          included: 0,
          observedFrom: null,
          observedThrough: null,
          unavailable: found.cause,
        }),
        session: null,
      };
    }
    // Minting on read has precedent: a session page mints the references it
    // returns. This is the same pair of INSERT OR IGNOREs, for one session.
    const at = now.toISOString();
    const refs = queryWriteStepOn(database, (writer) => ({
      sessionRef: ensureLocalIntegrationSessionRefIn(writer, found.session.sessionId, at),
      projectRef: ensureLocalIntegrationProjectRefIn(writer, found.session.repoId, at),
    }));
    return {
      ...metadata(found.boundary, now, {
        matched: 1,
        included: 1,
        observedFrom: found.session.lastEventAt,
        observedThrough: found.session.lastEventAt,
      }),
      session: sessionSummary(
        found.session,
        refs.sessionRef,
        refs.projectRef,
        now.getTime(),
        found.declared,
        found.launcher,
      ),
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
    // `kinds: "replay"` in so many words. A credentialed third party reads the
    // hosted lens, `REPLAY_KIND_PREDICATE` and nothing else, which is narrower
    // than the first-party all-event sequence the plane serves. It used to be
    // implied by passing a row budget; implying it meant the plane could not
    // bound its own read without also changing the answer.
    const replay = buildLocalReplayOnDatabase(database, lookup.session.sessionId, {
      kinds: "replay",
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

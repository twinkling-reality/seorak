import {
  INTEGRATION_REPLAY_LENSES,
  type IntegrationScope,
} from "@seorak/types";
import {
  authorizeLocalIntegrationCredential,
  InvalidLocalIntegrationCursorError,
  LocalIntegrationAuthorityChangedError,
  LocalIntegrationCursorCapacityError,
  LocalIntegrationPageChangedError,
  recordLocalIntegrationQueryAudit,
  type LocalIntegrationDenialReason,
  type LocalIntegrationPrincipal,
} from "./local-integration-store.ts";
import type { LocalPlaneRoute } from "./local-plane-routes.ts";
import {
  queryLocalPrivateOutcome,
  queryLocalPrivatePeriod,
  queryLocalPrivateReplayLens,
  queryLocalPrivateSessions,
} from "./local-private-queries.ts";
import {
  LocalReplayTooLargeError,
  LocalSessionOutcomeTooLargeError,
} from "./local-projection.ts";

type ApiRoute = Extract<LocalPlaneRoute, { authority: "api" }>;

export interface LocalPrivateHttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly value: unknown;
}

function denied(
  reason: LocalIntegrationDenialReason,
  scope: IntegrationScope,
): LocalPrivateHttpResponse {
  if (reason === "scope") {
    return {
      status: 403,
      headers: {
        "www-authenticate": `Bearer error="insufficient_scope", scope="${scope}"`,
      },
      value: { error: "insufficient_scope" },
    };
  }
  if (reason === "rate_limited" || reason === "route_rate_limited") {
    return {
      status: 429,
      headers: { "retry-after": "60" },
      value: { error: "too_many_requests" },
    };
  }
  return {
    status: 401,
    headers: { "www-authenticate": "Bearer error=\"invalid_token\"" },
    value: { error: "unauthorized" },
  };
}

function audit(
  principal: LocalIntegrationPrincipal,
  route: ApiRoute,
  response: LocalPrivateHttpResponse,
  result: "ok" | "unavailable" | "refused" | "protocol_error" | "internal_error",
  options: { directory?: string; nowMs: number },
): void {
  const value = response.value as {
    coverage?: { includedSessionCount?: unknown };
  };
  const returned = value?.coverage?.includedSessionCount;
  recordLocalIntegrationQueryAudit(principal, {
    operation: route.route === "period"
      ? "period_summary"
      : route.route === "sessions"
      ? "list_sessions"
      : route.route === "outcome"
      ? "get_session_outcome"
      : "replay_lens",
    result,
    httpStatus: response.status,
    returnedCount: typeof returned === "number" && Number.isSafeInteger(returned)
      ? returned
      : null,
    responseBytes: Buffer.byteLength(`${JSON.stringify(response.value)}\n`, "utf8"),
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    nowMs: options.nowMs,
  });
}

function resultKind(value: unknown): "ok" | "unavailable" {
  const availability = value !== null && typeof value === "object"
    ? (value as { availability?: { state?: unknown } }).availability
    : undefined;
  return availability?.state === "unavailable" ? "unavailable" : "ok";
}

function cursorRefusal(error: unknown): boolean {
  return error instanceof InvalidLocalIntegrationCursorError ||
    error instanceof LocalIntegrationAuthorityChangedError ||
    error instanceof LocalIntegrationCursorCapacityError ||
    error instanceof LocalIntegrationPageChangedError;
}

/** Authenticate and dispatch one already-classified private HTTP API read. */
export function handleLocalPrivateApi(
  route: ApiRoute,
  authorization: string | undefined,
  audience: string,
  options: { directory?: string; now?: () => Date } = {},
): LocalPrivateHttpResponse {
  const now = options.now?.() ?? new Date();
  const admission = authorizeLocalIntegrationCredential(authorization, {
    audience,
    scope: route.scope,
    routeClass: route.routeClass,
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    nowMs: now.getTime(),
  });
  if (!admission.ok) return denied(admission.reason, route.scope);

  const principal = admission.principal;
  const queryOptions = {
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    now,
  };
  let response: LocalPrivateHttpResponse;
  try {
    if (route.route === "period") {
      const days = Number(route.url.searchParams.get("days"));
      if (days !== 7 && days !== 30 && days !== 90) {
        response = { status: 400, value: { error: "days must be 7, 30, or 90" } };
        audit(principal, route, response, "protocol_error", {
          ...queryOptions,
          nowMs: now.getTime(),
        });
        return response;
      }
      response = {
        status: 200,
        value: queryLocalPrivatePeriod(principal, days, queryOptions),
      };
    } else if (route.route === "sessions") {
      const rawLimit = route.url.searchParams.get("limit");
      const limit = rawLimit === null ? 50 : Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        response = {
          status: 400,
          value: { error: "limit must be an integer from 1 to 100" },
        };
        audit(principal, route, response, "protocol_error", {
          ...queryOptions,
          nowMs: now.getTime(),
        });
        return response;
      }
      response = {
        status: 200,
        value: queryLocalPrivateSessions(principal, {
          ...queryOptions,
          limit,
          cursor: route.url.searchParams.get("cursor"),
        }),
      };
    } else if (route.route === "outcome") {
      response = {
        status: 200,
        value: queryLocalPrivateOutcome(principal, route.sessionRef, queryOptions),
      };
    } else {
      if (!(INTEGRATION_REPLAY_LENSES as readonly string[]).includes(route.lens)) {
        response = { status: 400, value: { error: "Replay lens unsupported" } };
        audit(principal, route, response, "protocol_error", {
          ...queryOptions,
          nowMs: now.getTime(),
        });
        return response;
      }
      response = {
        status: 200,
        value: queryLocalPrivateReplayLens(
          principal,
          route.sessionRef,
          route.lens as (typeof INTEGRATION_REPLAY_LENSES)[number],
          queryOptions,
        ),
      };
    }
  } catch (error) {
    if (cursorRefusal(error)) {
      response = {
        status: 409,
        value: { error: "session page cursor invalid or changed" },
      };
      audit(principal, route, response, "refused", {
        ...queryOptions,
        nowMs: now.getTime(),
      });
      return response;
    }
    if (
      error instanceof LocalSessionOutcomeTooLargeError ||
      error instanceof LocalReplayTooLargeError
    ) {
      response = {
        status: 413,
        value: { error: "private integration result too large" },
      };
      audit(principal, route, response, "refused", {
        ...queryOptions,
        nowMs: now.getTime(),
      });
      return response;
    }
    response = { status: 500, value: { error: "private integration query failed" } };
    audit(principal, route, response, "internal_error", {
      ...queryOptions,
      nowMs: now.getTime(),
    });
    return response;
  }
  audit(principal, route, response, resultKind(response.value), {
    ...queryOptions,
    nowMs: now.getTime(),
  });
  return response;
}

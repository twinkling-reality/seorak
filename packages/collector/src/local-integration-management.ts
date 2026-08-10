import {
  INTEGRATION_API_VERSION,
  INTEGRATION_SCOPES,
  type IntegrationCredentialIssueResult,
} from "@seorak/types";
import {
  createLocalIntegrationCredential,
  LocalIntegrationAuthorityChangedError,
  LocalIntegrationCredentialLimitError,
  LOCAL_INTEGRATION_REQUESTS_PER_MINUTE,
  resolveLocalIntegrationProjectRef,
} from "./local-integration-store.ts";

type InputRecord = Record<string, unknown>;
export const LOCAL_INTEGRATION_OWNER_COMMAND_MAX_BYTES = 16 * 1024;

export class LocalIntegrationCredentialRequestError extends Error {
  readonly responseMessage: string;
  readonly status: 400 | 409;

  constructor(responseMessage: string, status: 400 | 409) {
    super(responseMessage);
    this.name = "LocalIntegrationCredentialRequestError";
    this.responseMessage = responseMessage;
    this.status = status;
  }
}

function invalid(message = "integration credential request invalid"): never {
  throw new LocalIntegrationCredentialRequestError(message, 400);
}

function record(value: unknown): InputRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as InputRecord
    : null;
}

function hasExactKeys(
  value: InputRecord,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key));
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function canonicalAudience(origin: string, path: "/api/v1" | "/mcp/private"): string {
  const base = new URL(origin);
  if (base.origin !== origin || base.pathname !== "/" || base.search || base.hash) {
    throw new TypeError("local integration origin must be canonical");
  }
  return new URL(path, `${origin}/`).toString();
}

/** Strict operator-side parsing and issuance for either local resource server. */
export function issueLocalIntegrationCredential(
  origin: string,
  value: unknown,
  options: { directory?: string; nowMs?: number } = {},
): IntegrationCredentialIssueResult {
  const input = record(value);
  if (
    !input ||
    !hasExactKeys(
      input,
      ["apiVersion", "audience", "scopes", "expiresAt", "restrictions", "rateLimit"],
      ["apiVersion", "audience", "scopes", "expiresAt", "rateLimit"],
    ) ||
    input.apiVersion !== INTEGRATION_API_VERSION ||
    typeof input.audience !== "string" ||
    typeof input.expiresAt !== "string" ||
    !Array.isArray(input.scopes) ||
    input.scopes.length === 0 ||
    input.scopes.some((scope) =>
      typeof scope !== "string" ||
      !(INTEGRATION_SCOPES as readonly string[]).includes(scope)) ||
    new Set(input.scopes).size !== input.scopes.length
  ) {
    invalid();
  }

  const scopes = input.scopes as unknown[];
  const apiAudience = canonicalAudience(origin, "/api/v1");
  const mcpAudience = canonicalAudience(origin, "/mcp/private");
  if (input.audience !== apiAudience && input.audience !== mcpAudience) {
    invalid("integration credential audience invalid");
  }

  const rateLimit = record(input.rateLimit);
  if (
    !rateLimit ||
    !hasExactKeys(rateLimit, ["requestsPerMinute", "burst"], ["requestsPerMinute", "burst"]) ||
    rateLimit.requestsPerMinute !== LOCAL_INTEGRATION_REQUESTS_PER_MINUTE ||
    rateLimit.burst !== LOCAL_INTEGRATION_REQUESTS_PER_MINUTE
  ) {
    invalid("integration credential rate limit invalid");
  }

  let repoId: string | undefined;
  let projectRefs: readonly string[] | undefined;
  let dataNotBefore: string | undefined;
  let dataNotAfter: string | undefined;
  if (input.restrictions !== undefined) {
    const restrictions = record(input.restrictions);
    if (!restrictions || !hasExactKeys(restrictions, ["projectRefs", "dateRange"], [])) {
      invalid("integration credential restrictions invalid");
    }
    if (restrictions.projectRefs !== undefined) {
      if (
        !Array.isArray(restrictions.projectRefs) ||
        restrictions.projectRefs.length !== 1 ||
        typeof restrictions.projectRefs[0] !== "string"
      ) {
        invalid("one project restriction is supported in v1");
      }
      projectRefs = [restrictions.projectRefs[0]];
      repoId = resolveLocalIntegrationProjectRef(
        restrictions.projectRefs[0],
        options.directory,
      ) ?? undefined;
      if (repoId === undefined) invalid("project restriction not found");
    }
    if (restrictions.dateRange !== undefined) {
      const range = record(restrictions.dateRange);
      if (
        !range ||
        !hasExactKeys(range, ["from", "through"], ["from", "through"]) ||
        !calendarDate(range.from) ||
        !calendarDate(range.through) ||
        range.from > range.through
      ) {
        invalid("integration credential date restriction invalid");
      }
      dataNotBefore = `${range.from}T00:00:00.000Z`;
      dataNotAfter = `${range.through}T23:59:59.999Z`;
    }
  }

  try {
    const created = createLocalIntegrationCredential({
      audience: input.audience,
      scopes: INTEGRATION_SCOPES.filter((scope) => scopes.includes(scope)),
      expiresAt: input.expiresAt,
      ...(repoId === undefined ? {} : { repoId }),
      ...(dataNotBefore === undefined ? {} : { dataNotBefore }),
      ...(dataNotAfter === undefined ? {} : { dataNotAfter }),
      ...(options.directory === undefined ? {} : { directory: options.directory }),
      ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    });
    return {
      apiVersion: INTEGRATION_API_VERSION,
      credentialRef: `icr_${created.credentialId}`,
      secret: created.token,
      audience: created.audience,
      scopes: created.scopes,
      issuedAt: created.createdAt,
      expiresAt: created.expiresAt,
      ...(projectRefs === undefined && dataNotBefore === undefined
        ? {}
        : {
            restrictions: {
              ...(projectRefs === undefined ? {} : { projectRefs }),
              ...(dataNotBefore === undefined
                ? {}
                : {
                    dateRange: {
                      from: dataNotBefore.slice(0, 10),
                      through: dataNotAfter!.slice(0, 10),
                    },
                  }),
            },
          }),
      rateLimit: {
        requestsPerMinute: LOCAL_INTEGRATION_REQUESTS_PER_MINUTE,
        burst: LOCAL_INTEGRATION_REQUESTS_PER_MINUTE,
      },
    };
  } catch (error) {
    if (error instanceof LocalIntegrationCredentialRequestError) throw error;
    if (error instanceof LocalIntegrationAuthorityChangedError) {
      throw new LocalIntegrationCredentialRequestError("personal workspace required", 409);
    }
    if (error instanceof LocalIntegrationCredentialLimitError) {
      throw new LocalIntegrationCredentialRequestError(
        "integration credential limit reached",
        409,
      );
    }
    if (error instanceof TypeError) invalid();
    throw error;
  }
}

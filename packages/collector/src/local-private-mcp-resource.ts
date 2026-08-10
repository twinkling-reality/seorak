import {
  isLegacyRequest,
  isJsonContentType,
  type AuthInfo,
  type JSONObject,
} from "@modelcontextprotocol/server";
import {
  PRIVATE_MCP_TOOL_SCOPES,
  type IntegrationScope,
  type PrivateMcpToolName,
} from "@seorak/types";
import {
  authorizeLocalIntegrationCredential,
  recordLocalIntegrationQueryAudit,
  type LocalIntegrationDenialReason,
  type LocalIntegrationPrincipal,
  type LocalIntegrationRouteClass,
} from "./local-integration-store.ts";
import {
  createLocalPrivateMcpHandler,
  createLocalPrivateMcpQueryHandlers,
  createLocalPrivateMcpValidationHandler,
  signalLocalPrivateMcpQueryRefusals,
} from "./local-private-mcp.ts";

export const LOCAL_PRIVATE_MCP_MAX_REQUEST_BYTES = 64 * 1_024;
export const LOCAL_PRIVATE_MCP_MAX_RESPONSE_BYTES = 256 * 1_024;
export const LOCAL_PRIVATE_MCP_PROTOCOL_VERSION = "2026-07-28";

export interface LocalPrivateMcpResourceServerOptions {
  /** Fixed canonical endpoint, for example `http://127.0.0.1:4318/mcp/private`. */
  resourceServerUrl: URL | string;
  directory?: string;
  now?: () => Date;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

export interface LocalPrivateMcpResourceServer {
  readonly resourceServerUrl: URL;
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

type JsonRecord = Record<string, unknown>;

interface RequestClassification {
  tool: PrivateMcpToolName | null;
  requiredScope: IntegrationScope | null;
  routeClass: LocalIntegrationRouteClass;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "[::1]";
}

/** Validate the exact resource audience accepted by the local MCP bearer plane. */
export function canonicalLocalPrivateMcpResource(value: string | URL): URL {
  const input = typeof value === "string" ? value : value.toString();
  const resource = new URL(input);
  if (
    (resource.protocol !== "https:" &&
      !(resource.protocol === "http:" && isLoopback(resource.hostname))) ||
    resource.username !== "" ||
    resource.password !== "" ||
    resource.search !== "" ||
    resource.hash !== "" ||
    resource.pathname !== "/mcp/private" ||
    resource.toString() !== input
  ) {
    throw new TypeError(
      "resource must be a canonical HTTPS or loopback HTTP /mcp/private URL",
    );
  }
  return resource;
}

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function errorResponse(
  status: number,
  code: number,
  message: string,
  id: string | number | null = null,
): Response {
  return noStore(
    Response.json(
      { jsonrpc: "2.0", id, error: { code, message } },
      { status },
    ),
  );
}

async function responseWithinBound(
  response: Response,
  maxBytes: number,
  oversizeMessage: string,
): Promise<{ response: Response; bytes: number; oversized: boolean }> {
  const bytes = (await response.clone().arrayBuffer()).byteLength;
  if (bytes <= maxBytes) return { response, bytes, oversized: false };

  const protocolError = errorResponse(500, -32603, oversizeMessage);
  if ((await protocolError.clone().arrayBuffer()).byteLength <= maxBytes) {
    return { response: protocolError, bytes, oversized: true };
  }
  return {
    response: noStore(new Response(null, { status: 500 })),
    bytes,
    oversized: true,
  };
}

function bearerResponse(
  status: 401 | 403,
  error: "invalid_token" | "insufficient_scope",
  scope?: IntegrationScope,
): Response {
  const parameters = [`error=\"${error}\"`];
  if (scope !== undefined) parameters.push(`scope=\"${scope}\"`);
  return noStore(
    Response.json(
      {
        error,
        error_description: error === "invalid_token"
          ? "Invalid or expired local integration credential"
          : "Insufficient local integration scope",
      },
      {
        status,
        headers: { "WWW-Authenticate": `Bearer ${parameters.join(", ")}` },
      },
    ),
  );
}

function routeMismatch(request: Request, resource: URL): Response | null {
  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== resource.origin) {
    return errorResponse(421, -32600, "Request origin does not match MCP resource");
  }
  if (requestUrl.toString() !== resource.toString()) {
    return noStore(Response.json({ error: "not_found" }, { status: 404 }));
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== resource.origin) {
    return errorResponse(403, -32600, "Origin is not permitted");
  }
  return null;
}

function acceptsJson(value: string | null): boolean {
  if (value === null) return false;
  return value.split(",").some((candidate) => {
    const [mediaType, ...parameters] = candidate.trim().split(";");
    const quality = parameters
      .map((parameter) => parameter.trim().toLowerCase())
      .find((parameter) => parameter.startsWith("q="));
    const accepted = quality === undefined || Number(quality.slice(2)) > 0;
    return mediaType?.toLowerCase() === "application/json" && accepted;
  });
}

async function boundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: JsonRecord } | { ok: false; response: Response }> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      return {
        ok: false,
        response: errorResponse(400, -32600, "Invalid Content-Length"),
      };
    }
    if (length > maxBytes) {
      return {
        ok: false,
        response: errorResponse(413, -32600, "MCP request body too large"),
      };
    }
  }

  const bytes = await request.clone().arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    return {
      ok: false,
      response: errorResponse(413, -32600, "MCP request body too large"),
    };
  }
  try {
    const value = record(JSON.parse(new TextDecoder().decode(bytes)));
    if (value === null) {
      return {
        ok: false,
        response: errorResponse(400, -32600, "MCP request must be one JSON object"),
      };
    }
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      response: errorResponse(400, -32700, "Invalid JSON"),
    };
  }
}

function classifyRequest(body: JsonRecord): RequestClassification {
  if (body.method !== "tools/call") {
    return { tool: null, requiredScope: null, routeClass: "read" };
  }
  const name = record(body.params)?.name;
  if (typeof name !== "string" || !Object.hasOwn(PRIVATE_MCP_TOOL_SCOPES, name)) {
    return { tool: null, requiredScope: null, routeClass: "read" };
  }
  const tool = name as PrivateMcpToolName;
  return {
    tool,
    requiredScope: PRIVATE_MCP_TOOL_SCOPES[tool],
    routeClass: tool === "list_sessions" ? "read" : "aggregate",
  };
}

function modernProtocolHeaderOmission(
  request: Request,
  body: JsonRecord,
): Response | null {
  if (request.headers.has("mcp-protocol-version")) return null;
  const metadata = record(record(body.params)?._meta);
  const bodyVersion = metadata?.["io.modelcontextprotocol/protocolVersion"];
  if (typeof bodyVersion !== "string") return null;
  const candidateId = body.id;
  const id = typeof candidateId === "string" ||
      (typeof candidateId === "number" && Number.isFinite(candidateId)) ||
      candidateId === null
    ? candidateId as string | number | null
    : null;
  return errorResponse(
    400,
    -32020,
    "Missing required MCP-Protocol-Version header",
    id,
  );
}

function authorizationResponse(
  reason: LocalIntegrationDenialReason,
  requiredScope: IntegrationScope | null,
): Response {
  if (reason === "scope" && requiredScope !== null) {
    return bearerResponse(403, "insufficient_scope", requiredScope);
  }
  if (reason === "rate_limited" || reason === "route_rate_limited") {
    return noStore(
      Response.json(
        {
          error: "too_many_requests",
          error_description: "Local integration request rate exceeded",
        },
        { status: 429, headers: { "Retry-After": "60" } },
      ),
    );
  }
  return bearerResponse(401, "invalid_token");
}

function auditResult(response: Response, value: unknown, refused: boolean) {
  const envelope = record(value);
  const result = record(envelope?.result);
  const structured = record(result?.structuredContent);
  const availability = record(structured?.availability);
  const coverage = record(structured?.coverage);
  const returnedCount = coverage?.includedSessionCount;
  const protocolError = !response.ok || envelope?.error !== undefined ||
    result?.isError === true;
  return {
    result: refused
      ? "refused" as const
      : protocolError
      ? "protocol_error" as const
      : availability?.state === "unavailable"
        ? "unavailable" as const
        : "ok" as const,
    returnedCount: typeof returnedCount === "number" &&
        Number.isSafeInteger(returnedCount) && returnedCount >= 0
      ? returnedCount
      : null,
  };
}

function authInfoFor(
  token: string,
  principal: LocalIntegrationPrincipal,
  resource: URL,
): AuthInfo {
  return {
    token,
    clientId: `local-static-${principal.credentialId}`,
    scopes: [...principal.scopes],
    expiresAt: Math.floor(Date.parse(principal.expiresAt) / 1_000),
    resource,
  };
}

function validateBound(value: number, name: string, ceiling: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
    throw new TypeError(
      `${name} must be a positive safe integer no greater than ${ceiling}`,
    );
  }
}

/**
 * Build the fetch-native static-bearer MCP resource server embedded by the
 * local plane. This is not OAuth: it serves no discovery metadata and accepts only the distinct
 * exact-audience `srkx_` integration principal issued by the owner plane.
 */
export function createLocalPrivateMcpResourceServer(
  options: LocalPrivateMcpResourceServerOptions,
): LocalPrivateMcpResourceServer {
  const resourceServerUrl = canonicalLocalPrivateMcpResource(
    options.resourceServerUrl,
  );
  const maxRequestBytes = options.maxRequestBytes ??
    LOCAL_PRIVATE_MCP_MAX_REQUEST_BYTES;
  const maxResponseBytes = options.maxResponseBytes ??
    LOCAL_PRIVATE_MCP_MAX_RESPONSE_BYTES;
  validateBound(
    maxRequestBytes,
    "maxRequestBytes",
    LOCAL_PRIVATE_MCP_MAX_REQUEST_BYTES,
  );
  validateBound(
    maxResponseBytes,
    "maxResponseBytes",
    LOCAL_PRIVATE_MCP_MAX_RESPONSE_BYTES,
  );

  const principals = new WeakMap<AuthInfo, LocalIntegrationPrincipal>();
  const refusals = new WeakSet<AuthInfo>();
  const validationHandler = createLocalPrivateMcpValidationHandler();
  const handler = createLocalPrivateMcpHandler((context) => {
    const principal = context.authInfo === undefined
      ? undefined
      : principals.get(context.authInfo);
    if (principal === undefined) {
      throw new Error("local private MCP handler requires an admitted principal");
    }
    return signalLocalPrivateMcpQueryRefusals(
      createLocalPrivateMcpQueryHandlers(principal, {
        ...(options.directory === undefined
          ? {}
          : { directory: options.directory }),
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
      () => refusals.add(context.authInfo!),
    );
  });

  return {
    resourceServerUrl,
    async fetch(request): Promise<Response> {
      const mismatch = routeMismatch(request, resourceServerUrl);
      if (mismatch !== null) return mismatch;
      if (request.method !== "POST") {
        return noStore(
          new Response("Method Not Allowed", {
            status: 405,
            headers: { Allow: "POST" },
          }),
        );
      }
      if (!isJsonContentType(request.headers.get("content-type"))) {
        return errorResponse(415, -32600, "Content-Type must be application/json");
      }
      if (!acceptsJson(request.headers.get("accept"))) {
        return errorResponse(406, -32600, "Accept must include application/json");
      }
      const parsed = await boundedJsonBody(request, maxRequestBytes);
      if (!parsed.ok) return parsed.response;

      // server@2.0.0 currently accepts this omission, but the 2026-07-28 POST
      // contract requires the header. Keep the guard this narrow; every other
      // modern envelope/header decision belongs to the official SDK below.
      const missingProtocol = modernProtocolHeaderOmission(request, parsed.value);
      if (missingProtocol !== null) {
        return (await responseWithinBound(
          missingProtocol,
          maxResponseBytes,
          "MCP validation response exceeds response budget",
        )).response;
      }

      let officialMethodNotFound: Response | null = null;
      if (!(await isLegacyRequest(request, parsed.value))) {
        const validation = await validationHandler.fetch(request, {
          parsedBody: parsed.value,
        });
        if (!validation.ok) {
          const bounded = await responseWithinBound(
            validation,
            maxResponseBytes,
            "MCP validation response exceeds response budget",
          );
          if (validation.status !== 404) return noStore(bounded.response);
          officialMethodNotFound = bounded.response;
        }
      }
      const classification = classifyRequest(parsed.value);
      const authorization = request.headers.get("authorization");
      const admitted = authorizeLocalIntegrationCredential(authorization ?? undefined, {
        audience: resourceServerUrl.toString(),
        scope: classification.requiredScope,
        routeClass: classification.routeClass,
        ...(options.directory === undefined ? {} : { directory: options.directory }),
        ...(options.now === undefined ? {} : { nowMs: options.now().getTime() }),
      });
      if (!admitted.ok) {
        return authorizationResponse(admitted.reason, classification.requiredScope);
      }
      if (officialMethodNotFound !== null) {
        return noStore(officialMethodNotFound);
      }

      const token = authorization!.trim().replace(/^Bearer[ \t]+/i, "");
      const authInfo = authInfoFor(token, admitted.principal, resourceServerUrl);
      principals.set(authInfo, admitted.principal);

      let response: Response;
      try {
        response = await handler.fetch(request, {
          authInfo,
          parsedBody: parsed.value,
        });
      } catch {
        if (classification.tool !== null) {
          recordLocalIntegrationQueryAudit(admitted.principal, {
            operation: classification.tool,
            result: refusals.has(authInfo) ? "refused" : "internal_error",
            httpStatus: 500,
            returnedCount: null,
            responseBytes: null,
            ...(options.directory === undefined
              ? {}
              : { directory: options.directory }),
            ...(options.now === undefined ? {} : { nowMs: options.now().getTime() }),
          });
        }
        return (await responseWithinBound(
          errorResponse(500, -32603, "MCP request failed"),
          maxResponseBytes,
          "MCP error response exceeds response budget",
        )).response;
      }

      const bounded = await responseWithinBound(
        response,
        maxResponseBytes,
        "MCP result exceeds response budget",
      );
      if (bounded.oversized) {
        if (classification.tool !== null) {
          recordLocalIntegrationQueryAudit(admitted.principal, {
            operation: classification.tool,
            result: "oversized",
            httpStatus: 500,
            returnedCount: null,
            responseBytes: bounded.bytes,
            ...(options.directory === undefined
              ? {}
              : { directory: options.directory }),
            ...(options.now === undefined
              ? {}
              : { nowMs: options.now().getTime() }),
          });
        }
        return bounded.response;
      }
      const bytes = bounded.bytes;

      if (classification.tool !== null) {
        let decoded: JSONObject | null = null;
        try {
          decoded = await response.clone().json() as JSONObject;
        } catch {
          // The official JSON response mode should always be decodable. Audit
          // the contradiction as a protocol error without storing its body.
        }
        const outcome = auditResult(response, decoded, refusals.has(authInfo));
        recordLocalIntegrationQueryAudit(admitted.principal, {
          operation: classification.tool,
          result: outcome.result,
          httpStatus: response.status,
          returnedCount: outcome.returnedCount,
          responseBytes: bytes,
          ...(options.directory === undefined ? {} : { directory: options.directory }),
          ...(options.now === undefined ? {} : { nowMs: options.now().getTime() }),
        });
      }
      return noStore(response);
    },
    close: async () => {
      await validationHandler.close();
      await handler.close();
    },
  };
}

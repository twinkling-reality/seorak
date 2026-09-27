import type { IntegrationScope } from "@seorak/types";
import type { LocalIntegrationRouteClass } from "./local-integration-store.ts";

export type LocalPlaneRoute =
  | { readonly authority: "ordinary"; readonly url: URL }
  | {
      readonly authority: "management";
      readonly route: "inventory";
      readonly url: URL;
    }
  | {
      readonly authority: "management";
      readonly route: "projects";
      readonly url: URL;
    }
  | {
      readonly authority: "management";
      readonly route: "issue";
      readonly url: URL;
    }
  | {
      readonly authority: "management";
      readonly route: "revoke";
      readonly credentialId: string;
      readonly url: URL;
    }
  | {
      readonly authority: "api";
      readonly route: "period";
      readonly scope: "period:read";
      readonly routeClass: "aggregate";
      readonly url: URL;
    }
  | {
      readonly authority: "api";
      readonly route: "sessions";
      readonly scope: "sessions:read";
      readonly routeClass: "read";
      readonly url: URL;
    }
  | {
      readonly authority: "api";
      readonly route: "resolve";
      readonly scope: "sessions:read";
      readonly routeClass: "read";
      readonly url: URL;
    }
  | {
      readonly authority: "api";
      readonly route: "outcome";
      readonly sessionRef: string;
      readonly scope: IntegrationScope;
      readonly routeClass: LocalIntegrationRouteClass;
      readonly url: URL;
    }
  | {
      readonly authority: "api";
      readonly route: "replay";
      readonly sessionRef: string;
      readonly lens: string;
      readonly scope: IntegrationScope;
      readonly routeClass: LocalIntegrationRouteClass;
      readonly url: URL;
    }
  | { readonly authority: "mcp"; readonly url: URL }
  | {
      readonly authority: "reserved-refusal";
      readonly status: 404 | 405;
      readonly allow?: string;
      readonly url: URL | null;
    };

const SESSION_REF = "ses_[0-9a-f]{32}";
const CREDENTIAL_REF = "icr_([0-9a-f]{32})";
const OUTCOME = new RegExp(`^/api/v1/sessions/(${SESSION_REF})/outcome$`);
const REPLAY = new RegExp(`^/api/v1/sessions/(${SESSION_REF})/replay/([^/]+)$`);
const REVOKE = new RegExp(`^/integrations/${CREDENTIAL_REF}$`);

const DISCOVERY_NAMESPACES = [
  "/.well-known/oauth-protected-resource/mcp/private",
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
] as const;

function isNamespace(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function refusal(
  status: 404 | 405,
  url: URL | null,
  allow?: string,
): LocalPlaneRoute {
  return {
    authority: "reserved-refusal",
    status,
    ...(allow === undefined ? {} : { allow }),
    url,
  };
}

function methodRoute<T extends LocalPlaneRoute>(
  method: string,
  expected: "GET" | "POST" | "DELETE",
  route: T,
): T | LocalPlaneRoute {
  return method === expected ? route : refusal(405, route.url, expected);
}

/**
 * Classify the untouched HTTP request target once, before any authority is
 * selected. Integration namespaces accept only their canonical spellings;
 * aliases and normalized variants are quarantined instead of falling through
 * to ordinary routing or the dashboard document. Ordinary routes retain their
 * established URL spellings, including the dashboard's trailing slash.
 */
export function classifyLocalPlaneRequestTarget(
  rawTarget: string | undefined,
  rawMethod: string | undefined,
): LocalPlaneRoute {
  if (
    rawMethod === undefined ||
    rawTarget === undefined ||
    !rawTarget.startsWith("/") ||
    rawTarget.startsWith("//") ||
    rawTarget.includes("#")
  ) {
    return refusal(404, null);
  }
  const method = rawMethod;
  const rawPath = rawTarget.split("?", 1)[0]!;
  let decodedPath: string | null = null;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    // Invalid escapes are refused below when the raw spelling enters a
    // reserved namespace. Ordinary routing keeps its pre-activation behavior.
  }
  let url: URL;
  try {
    url = new URL(rawTarget, "http://seorak.invalid");
  } catch {
    return refusal(404, null);
  }
  const path = url.pathname;
  const lower = path.toLowerCase();
  const reservedRoots = ["/integrations", "/api", "/mcp", ...DISCOVERY_NAMESPACES];
  const couldEnterReserved = [rawPath, decodedPath, path].some((candidate) => {
    if (candidate === null) return false;
    let normalized = candidate.replaceAll("\\", "/").replace(/\/{2,}/g, "/");
    try {
      normalized = new URL(normalized, "http://seorak.invalid").pathname;
    } catch {
      // The raw spelling still participates below.
    }
    const candidateLower = normalized.toLowerCase();
    return reservedRoots.some((root) => isNamespace(candidateLower, root));
  });
  if (
    couldEnterReserved &&
    (
      decodedPath === null ||
      rawPath.includes("%") ||
      rawPath.includes("\\") ||
      rawPath.includes("//") ||
      (rawPath !== "/" && rawPath.endsWith("/")) ||
      url.pathname !== rawPath ||
      decodedPath.split("/").some((segment) => segment === "." || segment === "..")
    )
  ) {
    return refusal(404, url);
  }
  if (
    lower !== path &&
    reservedRoots.some((root) => isNamespace(lower, root))
  ) {
    return refusal(404, url);
  }
  if (DISCOVERY_NAMESPACES.some((root) => isNamespace(path, root))) {
    return refusal(404, url);
  }

  if (isNamespace(path, "/integrations")) {
    if (url.search !== "") return refusal(404, url);
    if (path === "/integrations") {
      if (method === "GET") {
        return { authority: "management", route: "inventory", url };
      }
      if (method === "POST") {
        return { authority: "management", route: "issue", url };
      }
      return refusal(405, url, "GET, POST");
    }
    if (path === "/integrations/projects") {
      return methodRoute(method, "GET", {
        authority: "management",
        route: "projects",
        url,
      });
    }
    const revoke = REVOKE.exec(path);
    if (revoke !== null) {
      return methodRoute(method, "DELETE", {
        authority: "management",
        route: "revoke",
        credentialId: revoke[1]!,
        url,
      });
    }
    return refusal(404, url);
  }

  if (isNamespace(path, "/api")) {
    if (path === "/api/v1/period-summary") {
      return methodRoute(method, "GET", {
        authority: "api",
        route: "period",
        scope: "period:read",
        routeClass: "aggregate",
        url,
      });
    }
    if (path === "/api/v1/sessions") {
      return methodRoute(method, "GET", {
        authority: "api",
        route: "sessions",
        scope: "sessions:read",
        routeClass: "read",
        url,
      });
    }
    // POST, so the agent's native session id travels in the body and never in a
    // URL (ADR 007). Checked before OUTCOME, whose ses_ pattern it cannot match.
    if (path === "/api/v1/sessions/resolve") {
      if (url.search !== "") return refusal(404, url);
      return methodRoute(method, "POST", {
        authority: "api",
        route: "resolve",
        scope: "sessions:read",
        routeClass: "read",
        url,
      });
    }
    const outcome = OUTCOME.exec(path);
    if (outcome !== null) {
      return methodRoute(method, "GET", {
        authority: "api",
        route: "outcome",
        sessionRef: outcome[1]!,
        scope: "sessions:read",
        routeClass: "aggregate",
        url,
      });
    }
    const replay = REPLAY.exec(path);
    if (replay !== null) {
      return methodRoute(method, "GET", {
        authority: "api",
        route: "replay",
        sessionRef: replay[1]!,
        lens: replay[2]!,
        scope: "replay:read",
        routeClass: "aggregate",
        url,
      });
    }
    return refusal(404, url);
  }

  if (isNamespace(path, "/mcp")) {
    if (url.search !== "") return refusal(404, url);
    if (path === "/mcp/private") {
      return method === "POST"
        ? { authority: "mcp", url }
        : refusal(405, url, "POST");
    }
    return refusal(404, url);
  }

  return { authority: "ordinary", url };
}

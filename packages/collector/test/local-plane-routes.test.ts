import { describe, expect, it } from "vitest";
import { classifyLocalPlaneRequestTarget } from "../src/local-plane-routes.ts";

describe("local plane closed route classification", () => {
  it("selects only the exact management family", () => {
    expect(classifyLocalPlaneRequestTarget("/integrations", "GET")).toMatchObject({
      authority: "management",
      route: "inventory",
    });
    expect(classifyLocalPlaneRequestTarget("/integrations", "POST")).toMatchObject({
      authority: "management",
      route: "issue",
    });
    expect(classifyLocalPlaneRequestTarget("/integrations/projects", "GET")).toMatchObject({
      authority: "management",
      route: "projects",
    });
    expect(classifyLocalPlaneRequestTarget(
      `/integrations/icr_${"a".repeat(32)}`,
      "DELETE",
    )).toMatchObject({
      authority: "management",
      route: "revoke",
      credentialId: "a".repeat(32),
    });
  });

  it("pins the four API reads to scopes and route budgets", () => {
    expect(classifyLocalPlaneRequestTarget(
      "/api/v1/period-summary?days=7",
      "GET",
    )).toMatchObject({
      authority: "api",
      route: "period",
      scope: "period:read",
      routeClass: "aggregate",
    });
    expect(classifyLocalPlaneRequestTarget("/api/v1/sessions?limit=2", "GET"))
      .toMatchObject({
        authority: "api",
        route: "sessions",
        scope: "sessions:read",
        routeClass: "read",
      });
    expect(classifyLocalPlaneRequestTarget(
      `/api/v1/sessions/ses_${"b".repeat(32)}/outcome`,
      "GET",
    )).toMatchObject({
      authority: "api",
      route: "outcome",
      scope: "sessions:read",
      routeClass: "aggregate",
    });
    expect(classifyLocalPlaneRequestTarget(
      `/api/v1/sessions/ses_${"c".repeat(32)}/replay/tool-mix`,
      "GET",
    )).toMatchObject({
      authority: "api",
      route: "replay",
      scope: "replay:read",
      routeClass: "aggregate",
    });
  });

  it("reserves every integration namespace alias and child", () => {
    for (const [target, method] of [
      ["/api/v1", "GET"],
      ["/api/v1/sessions/", "GET"],
      ["/api/v1//sessions", "GET"],
      ["/api/v1/%2e%2e/live", "GET"],
      ["/ordinary/%2e%2e/api/v1/sessions", "GET"],
      ["/ordinary\\..\\mcp\\private", "POST"],
      ["/%61pi/v1/sessions", "GET"],
      ["/API/v1/sessions", "GET"],
      ["/mcp/private/child", "POST"],
      ["/integrations/not-a-ref", "DELETE"],
      ["https://127.0.0.1/api/v1/sessions", "GET"],
      ["/api/v1/%ZZ", "GET"],
    ] as const) {
      expect(classifyLocalPlaneRequestTarget(target, method).authority, target)
        .toBe("reserved-refusal");
    }
  });

  it("preserves established ordinary URL spellings", () => {
    for (const target of [
      "/dashboard/",
      "/dashboard//compare",
      "/assets/a%20b.js",
      "/ordinary\\path",
      "/ordinary/%ZZ",
    ]) {
      expect(classifyLocalPlaneRequestTarget(target, "GET").authority, target)
        .toBe("ordinary");
    }
  });

  it("fails closed when the request method is absent", () => {
    expect(classifyLocalPlaneRequestTarget("/api/v1/sessions", undefined)).toMatchObject({
      authority: "reserved-refusal",
      status: 404,
    });
  });

  it("quarantines local OAuth and OpenID discovery without selecting auth", () => {
    for (const target of [
      "/.well-known/oauth-protected-resource/mcp/private",
      "/.well-known/oauth-protected-resource/mcp/private/child",
      "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration",
    ]) {
      expect(classifyLocalPlaneRequestTarget(target, "GET")).toMatchObject({
        authority: "reserved-refusal",
        status: 404,
      });
    }
  });

  it("gives the exact MCP resource only POST", () => {
    expect(classifyLocalPlaneRequestTarget("/mcp/private", "POST")).toMatchObject({
      authority: "mcp",
    });
    for (const method of ["GET", "DELETE", "PUT"]) {
      expect(classifyLocalPlaneRequestTarget("/mcp/private", method)).toMatchObject({
        authority: "reserved-refusal",
        status: 405,
        allow: "POST",
      });
    }
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { INTEGRATION_API_VERSION } from "@seorak/types";
import {
  issueLocalIntegrationCredential,
  LocalIntegrationCredentialRequestError,
} from "../src/local-integration-management.ts";
import {
  listLocalIntegrationCredentials,
  listLocalIntegrationProjects,
  revokeLocalIntegrationCredential,
} from "../src/local-integration-store.ts";
import { appendLocalEvent } from "../src/local-store.ts";
import { localHistoryFixture } from "./support/local-history-fixture.ts";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const ORIGIN = "http://127.0.0.1:4318";
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function seeded(): string {
  const directory = mkdtempSync(join(tmpdir(), "seorak-management-"));
  temporary.push(directory);
  for (const event of localHistoryFixture()) appendLocalEvent(event, directory);
  return directory;
}

function request(
  audience: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    apiVersion: INTEGRATION_API_VERSION,
    audience,
    scopes: ["period:read", "sessions:read", "replay:read"],
    expiresAt: "2026-09-08T12:00:00.000Z",
    rateLimit: { requestsPerMinute: 60, burst: 60 },
    ...overrides,
  };
}

describe("local integration owner management", () => {
  it("issues separate exact-audience API and MCP grants and inventories no secret", () => {
    const directory = seeded();
    const api = issueLocalIntegrationCredential(
      ORIGIN,
      request(`${ORIGIN}/api/v1`),
      { directory, nowMs: NOW },
    );
    const mcp = issueLocalIntegrationCredential(
      ORIGIN,
      request(`${ORIGIN}/mcp/private`),
      { directory, nowMs: NOW + 1 },
    );
    expect(api.secret).toMatch(/^srkx_[0-9a-f]{32}_[0-9a-f]{64}$/);
    expect(mcp.secret).toMatch(/^srkx_[0-9a-f]{32}_[0-9a-f]{64}$/);
    expect(api.secret).not.toBe(mcp.secret);

    const inventory = listLocalIntegrationCredentials({ directory, nowMs: NOW + 2 });
    expect(inventory.credentials.map(({ audience }) => audience).sort()).toEqual([
      `${ORIGIN}/api/v1`,
      `${ORIGIN}/mcp/private`,
    ]);
    expect(JSON.stringify(inventory)).not.toContain(api.secret);
    expect(JSON.stringify(inventory)).not.toContain(mcp.secret);

    expect(revokeLocalIntegrationCredential(api.credentialRef.slice(4), {
      directory,
      nowMs: NOW + 3,
    })).toBe(true);
    expect(listLocalIntegrationCredentials({ directory, nowMs: NOW + 4 }))
      .toMatchObject({
        credentials: expect.arrayContaining([
          expect.objectContaining({
            credentialRef: api.credentialRef,
            revokedAt: new Date(NOW + 3).toISOString(),
          }),
        ]),
      });
  });

  it("resolves one opaque project and inclusive UTC date restriction", () => {
    const directory = seeded();
    const [project] = listLocalIntegrationProjects({ directory, nowMs: NOW }).projects;
    const issued = issueLocalIntegrationCredential(
      ORIGIN,
      request(`${ORIGIN}/api/v1`, {
        restrictions: {
          projectRefs: [project!.projectRef],
          dateRange: { from: "2026-01-02", through: "2026-01-03" },
        },
      }),
      { directory, nowMs: NOW },
    );
    expect(issued.restrictions).toEqual({
      projectRefs: [project!.projectRef],
      dateRange: { from: "2026-01-02", through: "2026-01-03" },
    });
  });

  it("rejects aliases, foreign audiences, hidden keys, and noncanonical limits", () => {
    const directory = seeded();
    const invalid = [
      request(`${ORIGIN}/api/v1/`),
      request("http://localhost:4318/api/v1"),
      request(`${ORIGIN}/mcp/private?x=1`),
      request(`${ORIGIN}/api/v1`, { extra: true }),
      request(`${ORIGIN}/api/v1`, { rateLimit: { requestsPerMinute: 60, burst: 61 } }),
    ];
    for (const value of invalid) {
      expect(() => issueLocalIntegrationCredential(ORIGIN, value, {
        directory,
        nowMs: NOW,
      })).toThrow(LocalIntegrationCredentialRequestError);
    }
  });
});

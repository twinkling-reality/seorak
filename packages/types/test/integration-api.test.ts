import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  INTEGRATION_API_VERSION,
  INTEGRATION_REPLAY_LENSES,
  INTEGRATION_SCOPES,
  PRIVATE_MCP_TOOL_CATALOG,
  PRIVATE_MCP_TOOL_NAMES,
  PRIVATE_MCP_TOOL_SCOPES,
  PUBLICATION_SURFACES,
  PUBLIC_PROFILE_FIELDS,
  PUBLIC_PROJECT_EVIDENCE_FIELDS,
  PUBLIC_PROJECT_FIELDS,
  type IntegrationCredentialIssueRequest,
  type PrivatePeriodDto,
  type PublicProfilePublicationDto,
  type PublicProjectPublicationDto,
} from "../src/index.ts";

const range = { from: "2026-07-01", through: "2026-07-31" } as const;
const freshness = {
  state: "fresh",
  generatedAt: "2026-08-01T00:00:00.000Z",
  dataThrough: "2026-07-31T23:59:59.000Z",
  staleAt: "2026-08-01T00:05:00.000Z",
} as const;
const coverage = {
  requested: range,
  observed: range,
  matchedSessionCount: 4,
  includedSessionCount: 4,
  complete: true,
  omissions: [],
} as const;

test("the v1 scope vocabulary is closed and least-privilege", () => {
  assert.equal(INTEGRATION_API_VERSION, "v1");
  assert.deepEqual([...INTEGRATION_SCOPES], [
    "period:read",
    "sessions:read",
    "replay:read",
  ]);

  const request: IntegrationCredentialIssueRequest = {
    apiVersion: INTEGRATION_API_VERSION,
    audience: "seorak:private-api",
    scopes: ["period:read"],
    expiresAt: "2026-09-01T00:00:00.000Z",
    restrictions: { projectRefs: ["project_public_ref"], dateRange: range },
    rateLimit: { requestsPerMinute: 30, burst: 5 },
  };
  assert.equal(request.expiresAt, "2026-09-01T00:00:00.000Z");
  assert.deepEqual(request.restrictions?.projectRefs, ["project_public_ref"]);
});

test("private reads make availability, coverage, and freshness explicit", () => {
  const period: PrivatePeriodDto = {
    apiVersion: INTEGRATION_API_VERSION,
    availability: { state: "available", reason: null },
    coverage,
    freshness,
    period: range,
    projectRef: null,
    metrics: {
      sessionCount: 4,
      completedSessionCount: 3,
      toolCallCount: 19,
      promptCount: 7,
      inputTokens: 1_000,
      outputTokens: 400,
      costUsd: 1.25,
      shippedChangeRate: 2 / 3,
    },
  };

  assert.equal(period.availability.state, "available");
  assert.equal(period.coverage.complete, true);
  assert.equal(period.freshness.state, "fresh");
  assert.equal(period.projectRef, null);
});

test("replay exposes the canonical lens allowlist, not events", () => {
  assert.deepEqual([...INTEGRATION_REPLAY_LENSES], [
    "tool-mix",
    "verification",
    "cadence",
    "session-detail",
  ]);
});

test("private MCP publishes one closed read-only catalog and scope map", () => {
  assert.deepEqual([...PRIVATE_MCP_TOOL_NAMES], [
    "period_summary",
    "list_sessions",
    "get_session_outcome",
    "replay_lens",
  ]);
  assert.deepEqual(
    PRIVATE_MCP_TOOL_CATALOG.map(({ name }) => name),
    [...PRIVATE_MCP_TOOL_NAMES],
  );
  assert.deepEqual(PRIVATE_MCP_TOOL_SCOPES, {
    period_summary: "period:read",
    list_sessions: "sessions:read",
    get_session_outcome: "sessions:read",
    replay_lens: "replay:read",
  });

  for (const tool of PRIVATE_MCP_TOOL_CATALOG) {
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }

  const sessions = PRIVATE_MCP_TOOL_CATALOG.find(
    ({ name }) => name === "list_sessions",
  );
  const outcome = PRIVATE_MCP_TOOL_CATALOG.find(
    ({ name }) => name === "get_session_outcome",
  );
  assert.deepEqual(
    sessions?.inputSchema.properties.cursor.pattern,
    "^cur_[0-9a-f]{32}_[0-9a-f]{64}$",
  );
  assert.deepEqual(
    outcome?.inputSchema.properties.sessionRef.pattern,
    "^ses_[0-9a-f]{32}$",
  );
});

test("publication surfaces and their field/evidence vocabularies are explicit", () => {
  assert.deepEqual([...PUBLICATION_SURFACES], ["web", "search", "api", "mcp"]);
  assert.deepEqual([...PUBLIC_PROFILE_FIELDS], [
    "displayName",
    "headline",
    "bio",
    "location",
    "avatarUrl",
    "contactUrl",
  ]);
  assert.deepEqual([...PUBLIC_PROJECT_FIELDS], [
    "name",
    "summary",
    "role",
    "startedOn",
    "endedOn",
    "projectUrl",
    "sourceUrl",
    "technologies",
  ]);
  assert.deepEqual([...PUBLIC_PROJECT_EVIDENCE_FIELDS], [
    "sessionCount",
    "toolCallCount",
    "shippedChangeRate",
    "lineSurvivalRate",
  ]);
});

test("web, search, API, and MCP publication grants are independent", () => {
  const profile: PublicProfilePublicationDto = {
    apiVersion: INTEGRATION_API_VERSION,
    publicationVersion: 3,
    publishedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T01:00:00.000Z",
    revokedAt: null,
    profileSlug: "ada",
    grants: {
      web: { enabled: true, fields: ["displayName", "contactUrl"] },
      search: { enabled: true, fields: ["displayName"] },
      api: { enabled: false, fields: [] },
      mcp: { enabled: false, fields: [] },
    },
    profile: {
      displayName: "Ada",
      contactUrl: "https://example.com/contact",
    },
  };

  const project: PublicProjectPublicationDto = {
    apiVersion: INTEGRATION_API_VERSION,
    publicationVersion: 1,
    publishedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    revokedAt: null,
    profileSlug: "ada",
    projectSlug: "compiler",
    grants: {
      web: {
        enabled: true,
        fields: ["name", "summary"],
        evidence: ["sessionCount"],
      },
      search: { enabled: true, fields: ["name"], evidence: [] },
      api: { enabled: false, fields: [], evidence: [] },
      mcp: { enabled: false, fields: [], evidence: [] },
    },
    project: { name: "Compiler", summary: "A public project." },
    evidence: {
      sessionCount: {
        value: 4,
        unit: "count",
        availability: { state: "available", reason: null },
        sampleSize: 4,
        coverage: { period: range, complete: true },
        generatedAt: "2026-08-01T00:00:00.000Z",
        freshness,
      },
    },
  };

  assert.deepEqual(profile.grants.api, { enabled: false, fields: [] });
  assert.deepEqual(project.grants.mcp, {
    enabled: false,
    fields: [],
    evidence: [],
  });
  assert.equal(profile.profile.contactUrl?.startsWith("https://"), true);
});

test("the external contract declares no internal identifier-shaped fields", () => {
  const source = readFileSync(
    new URL("../src/integration-api.ts", import.meta.url),
    "utf8",
  );
  const forbiddenProperty = /^\s*(?:readonly\s+)?(?:owner|member|session|repo|device|tenant)Id\??\s*:/gim;
  assert.doesNotMatch(source, forbiddenProperty);
  assert.doesNotMatch(source, /\brawEvents?\??\s*:/i);
});

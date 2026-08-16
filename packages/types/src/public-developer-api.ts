import {
  PUBLIC_PROFILE_FIELDS,
  PUBLIC_PROJECT_EVIDENCE_FIELDS,
  PUBLIC_PROJECT_FIELDS,
  type ExternalCursor,
  type PublicProfileField,
  type PublicProfileProjectionDto,
  type PublicProjectEvidenceField,
  type PublicProjectField,
  type PublicProjectProjectionDto,
} from "./integration-api.ts";
import {
  PUBLIC_TOKEN_USAGE_FIELDS,
  type PublicTokenUsageField,
} from "./publication-management.ts";

export const PUBLIC_DIRECTORY_API_PREFIX = "/v1" as const;
export const PUBLIC_API_SEARCH_PATH = "/v1/search" as const;
export const PUBLIC_API_PROFILE_PATH = "/v1/profiles/:profileSlug" as const;
export const PUBLIC_API_ACTIVITY_PATH =
  "/v1/profiles/:profileSlug/activity" as const;
export const PUBLIC_API_TOKEN_USAGE_PATH =
  "/v1/profiles/:profileSlug/token-usage" as const;
export const PUBLIC_API_PROFILE_PROJECTS_PATH =
  "/v1/profiles/:profileSlug/projects" as const;
export const PUBLIC_API_PROJECT_PATH =
  "/v1/profiles/:profileSlug/projects/:projectSlug" as const;
export const PUBLIC_API_PROJECT_TOKEN_USAGE_PATH =
  "/v1/profiles/:profileSlug/projects/:projectSlug/token-usage" as const;
export const PUBLIC_API_DOCS_PATH = "/docs/api" as const;

export const PUBLIC_WEB_API_PREFIX = "/v1/web" as const;
export const PUBLIC_WEB_SEARCH_PATH = "/v1/web/search" as const;
export const PUBLIC_WEB_PROFILE_PATH =
  "/v1/web/profiles/:profileSlug" as const;
export const PUBLIC_WEB_ACTIVITY_PATH =
  "/v1/web/profiles/:profileSlug/activity" as const;
export const PUBLIC_WEB_TOKEN_USAGE_PATH =
  "/v1/web/profiles/:profileSlug/token-usage" as const;
export const PUBLIC_WEB_TOKEN_USAGE_SVG_PATH =
  "/v1/web/profiles/:profileSlug/usage.svg" as const;
export const PUBLIC_WEB_PROFILE_PROJECTS_PATH =
  "/v1/web/profiles/:profileSlug/projects" as const;
export const PUBLIC_WEB_PROJECT_PATH =
  "/v1/web/profiles/:profileSlug/projects/:projectSlug" as const;
export const PUBLIC_WEB_PROJECT_TOKEN_USAGE_PATH =
  "/v1/web/profiles/:profileSlug/projects/:projectSlug/token-usage" as const;
export const PUBLIC_WEB_PROJECT_TOKEN_USAGE_SVG_PATH =
  "/v1/web/profiles/:profileSlug/projects/:projectSlug/usage.svg" as const;

export const PUBLIC_DIRECTORY_PAGE_DEFAULT = 10;
export const PUBLIC_DIRECTORY_PAGE_MAX = 20;

/** Public slug grammar shared by every public path parameter and MCP tool input. */
export const PUBLIC_SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$" as const;
export const PUBLIC_SLUG_MAX_LENGTH = 63;
export const PUBLIC_SEARCH_TEXT_MIN_LENGTH = 2;
export const PUBLIC_SEARCH_TEXT_MAX_LENGTH = 80;
export const PUBLIC_CURSOR_MAX_LENGTH = 512;

export interface PublicHttpDocParameter {
  name: string;
  kind: "path" | "query";
  required: boolean;
  note: string;
  /** Wire type. Absent means string, which is what a path or query defaults to. */
  type?: "string" | "integer";
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface PublicHttpDocEndpoint {
  id: string;
  method: "GET";
  path: string;
  /** Short label for a reference sidebar. A full path does not fit one. */
  navLabel: string;
  summary: string;
  parameters: readonly PublicHttpDocParameter[];
}

/**
 * Executable public HTTP catalog shared by the resource server and website docs.
 *
 * `as const satisfies` keeps each `id` a literal, so anything documented per
 * endpoint can be typed `Record<PublicHttpEndpointId, …>` and fail to compile
 * when an endpoint is added without it.
 */
export const PUBLIC_HTTP_DOC_ENDPOINTS = [
  {
    id: "search",
    method: "GET",
    navLabel: "Search",
    path: PUBLIC_API_SEARCH_PATH,
    summary:
      "Search profiles and projects that enabled both public search and API disclosure.",
    parameters: [
      {
        name: "q",
        kind: "query",
        required: true,
        note: "Search text, 2 to 80 characters.",
        type: "string",
        minLength: PUBLIC_SEARCH_TEXT_MIN_LENGTH,
        maxLength: PUBLIC_SEARCH_TEXT_MAX_LENGTH,
      },
      {
        name: "limit",
        kind: "query",
        required: false,
        note: `Page size from 1 to ${PUBLIC_DIRECTORY_PAGE_MAX}. Defaults to ${PUBLIC_DIRECTORY_PAGE_DEFAULT}.`,
        type: "integer",
        minimum: 1,
        maximum: PUBLIC_DIRECTORY_PAGE_MAX,
      },
      {
        name: "cursor",
        kind: "query",
        required: false,
        note: "Opaque nextCursor from the same search surface and query.",
        type: "string",
        minLength: 1,
        maxLength: PUBLIC_CURSOR_MAX_LENGTH,
      },
    ],
  },
  {
    id: "profile",
    method: "GET",
    navLabel: "Get profile",
    path: PUBLIC_API_PROFILE_PATH,
    summary: "Read one current profile projection when its public API grant is enabled.",
    parameters: [
      {
        name: "profileSlug",
        kind: "path",
        required: true,
        note: "The public profile slug.",
        type: "string",
        maxLength: PUBLIC_SLUG_MAX_LENGTH,
        pattern: PUBLIC_SLUG_PATTERN,
      },
    ],
  },
  {
    id: "activity",
    method: "GET",
    navLabel: "Get activity",
    path: PUBLIC_API_ACTIVITY_PATH,
    summary:
      "Read the frozen activity calendar or streak fields selected for public API disclosure.",
    parameters: [
      {
        name: "profileSlug",
        kind: "path",
        required: true,
        note: "The public profile slug.",
        type: "string",
        maxLength: PUBLIC_SLUG_MAX_LENGTH,
        pattern: PUBLIC_SLUG_PATTERN,
      },
    ],
  },
  {
    id: "projects",
    method: "GET",
    navLabel: "List projects",
    path: PUBLIC_API_PROFILE_PROJECTS_PATH,
    summary:
      "List API-enabled projects under one current profile. Search permission is not required.",
    parameters: [
      {
        name: "profileSlug",
        kind: "path",
        required: true,
        note: "The public profile slug.",
        type: "string",
        maxLength: PUBLIC_SLUG_MAX_LENGTH,
        pattern: PUBLIC_SLUG_PATTERN,
      },
      {
        name: "limit",
        kind: "query",
        required: false,
        note: `Page size from 1 to ${PUBLIC_DIRECTORY_PAGE_MAX}. Defaults to ${PUBLIC_DIRECTORY_PAGE_DEFAULT}.`,
        type: "integer",
        minimum: 1,
        maximum: PUBLIC_DIRECTORY_PAGE_MAX,
      },
      {
        name: "cursor",
        kind: "query",
        required: false,
        note: "Opaque nextCursor from this profile's project listing.",
        type: "string",
        minLength: 1,
        maxLength: PUBLIC_CURSOR_MAX_LENGTH,
      },
    ],
  },
  {
    id: "project",
    method: "GET",
    navLabel: "Get project",
    path: PUBLIC_API_PROJECT_PATH,
    summary: "Read one current project projection and only its selected evidence fields.",
    parameters: [
      {
        name: "profileSlug",
        kind: "path",
        required: true,
        note: "The public profile slug.",
        type: "string",
        maxLength: PUBLIC_SLUG_MAX_LENGTH,
        pattern: PUBLIC_SLUG_PATTERN,
      },
      {
        name: "projectSlug",
        kind: "path",
        required: true,
        note: "The public project slug.",
        type: "string",
        maxLength: PUBLIC_SLUG_MAX_LENGTH,
        pattern: PUBLIC_SLUG_PATTERN,
      },
    ],
  },
  {
    id: "tokenUsage",
    method: "GET",
    navLabel: "Get token usage",
    path: PUBLIC_API_TOKEN_USAGE_PATH,
    summary:
      "Read the frozen profile-wide token-usage series when its public API grant is enabled.",
    parameters: [
      {
        name: "profileSlug",
        kind: "path",
        required: true,
        note: "The public profile slug.",
        type: "string",
        maxLength: PUBLIC_SLUG_MAX_LENGTH,
        pattern: PUBLIC_SLUG_PATTERN,
      },
    ],
  },
  {
    id: "projectTokenUsage",
    method: "GET",
    navLabel: "Get project token usage",
    path: PUBLIC_API_PROJECT_TOKEN_USAGE_PATH,
    summary:
      "Read the frozen project-scoped token-usage series when its public API grant is enabled.",
    parameters: [
      {
        name: "profileSlug",
        kind: "path",
        required: true,
        note: "The public profile slug.",
        type: "string",
        maxLength: PUBLIC_SLUG_MAX_LENGTH,
        pattern: PUBLIC_SLUG_PATTERN,
      },
      {
        name: "projectSlug",
        kind: "path",
        required: true,
        note: "The public project slug.",
        type: "string",
        maxLength: PUBLIC_SLUG_MAX_LENGTH,
        pattern: PUBLIC_SLUG_PATTERN,
      },
    ],
  },
] as const satisfies readonly PublicHttpDocEndpoint[];

/** Every documented read, as a literal union. */
export type PublicHttpEndpointId = (typeof PUBLIC_HTTP_DOC_ENDPOINTS)[number]['id'];

export const PUBLIC_MCP_PATH = "/mcp/public" as const;
export const PUBLIC_MCP_TOOL_NAMES = [
  "search_public_profiles",
  "search_public_projects",
  "get_public_profile",
  "get_public_activity",
  "get_public_token_usage",
  "get_public_project",
  "get_public_project_token_usage",
  "list_public_profile_projects",
] as const;
export type PublicMcpToolName = (typeof PUBLIC_MCP_TOOL_NAMES)[number];

export const PUBLIC_MCP_TOOL_DESCRIPTIONS: Readonly<Record<PublicMcpToolName, string>> = {
  search_public_profiles:
    "Search profiles that independently permit both public search discovery and MCP disclosure.",
  search_public_projects:
    "Search projects that independently permit both public search discovery and MCP disclosure.",
  get_public_profile:
    "Get one stored public profile projection when its MCP grant is enabled.",
  get_public_activity:
    "Get the frozen calendar or streak fields explicitly granted to public MCP for a profile.",
  get_public_token_usage:
    "Get the frozen profile-wide token-usage series when its MCP grant is enabled.",
  get_public_project:
    "Get one stored public project projection when its MCP grant is enabled.",
  get_public_project_token_usage:
    "Get the frozen project-scoped token-usage series when its MCP grant is enabled.",
  list_public_profile_projects:
    "List projects under a public profile when each project's MCP grant is enabled; search permission is not required.",
};

export interface PublicMcpToolParameter {
  name: string;
  type: "string" | "integer";
  required: boolean;
  note: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

const MCP_SEARCH_INPUT: readonly PublicMcpToolParameter[] = [
  {
    name: "query",
    type: "string",
    required: true,
    note: "Public directory search text.",
    minLength: PUBLIC_SEARCH_TEXT_MIN_LENGTH,
    maxLength: PUBLIC_SEARCH_TEXT_MAX_LENGTH,
  },
  {
    name: "cursor",
    type: "string",
    required: false,
    note: "Opaque cursor returned by the same search tool.",
    minLength: 1,
    maxLength: PUBLIC_CURSOR_MAX_LENGTH,
  },
  {
    name: "limit",
    type: "integer",
    required: false,
    note: "Maximum number of public projections to return.",
    minimum: 1,
    maximum: PUBLIC_DIRECTORY_PAGE_MAX,
  },
];

const MCP_PROFILE_SLUG: PublicMcpToolParameter = {
  name: "profileSlug",
  type: "string",
  required: true,
  note: "Public profile slug.",
  minLength: 1,
  maxLength: PUBLIC_SLUG_MAX_LENGTH,
  pattern: PUBLIC_SLUG_PATTERN,
};

/**
 * Executable MCP input catalog.
 *
 * The public MCP server compiles its JSON Schemas from this table, and the
 * website renders the same table, so a documented tool argument cannot describe
 * something the runtime does not validate.
 */
const MCP_PROJECT_SLUG: PublicMcpToolParameter = {
  name: "projectSlug",
  type: "string",
  required: true,
  note: "Public project slug under the selected profile.",
  minLength: 1,
  maxLength: PUBLIC_SLUG_MAX_LENGTH,
  pattern: PUBLIC_SLUG_PATTERN,
};

export const PUBLIC_MCP_TOOL_INPUTS: Readonly<
  Record<PublicMcpToolName, readonly PublicMcpToolParameter[]>
> = {
  search_public_profiles: MCP_SEARCH_INPUT,
  search_public_projects: MCP_SEARCH_INPUT,
  get_public_profile: [MCP_PROFILE_SLUG],
  get_public_activity: [MCP_PROFILE_SLUG],
  get_public_token_usage: [MCP_PROFILE_SLUG],
  get_public_project: [MCP_PROFILE_SLUG, MCP_PROJECT_SLUG],
  get_public_project_token_usage: [MCP_PROFILE_SLUG, MCP_PROJECT_SLUG],
  list_public_profile_projects: [
    {
      ...MCP_PROFILE_SLUG,
      note: "Public profile slug whose current projects should be listed.",
    },
    {
      name: "cursor",
      type: "string",
      required: false,
      note: "Opaque cursor returned by this listing tool.",
      minLength: 1,
      maxLength: PUBLIC_CURSOR_MAX_LENGTH,
    },
    {
      name: "limit",
      type: "integer",
      required: false,
      note: "Maximum number of public project projections to return.",
      minimum: 1,
      maximum: PUBLIC_DIRECTORY_PAGE_MAX,
    },
  ],
};

export const PUBLIC_DIRECTORY_ERROR_CODES = [
  "bad_request",
  "not_found",
  "not_published",
  "unauthorized",
  "forbidden",
  "conflict",
  "generation_conflict",
  "version_conflict",
  "rate_limited",
  "unavailable",
] as const;

export const PUBLIC_DIRECTORY_READ_ERROR_CODES = [
  "bad_request",
  "not_published",
  "rate_limited",
  "unavailable",
] as const satisfies readonly (typeof PUBLIC_DIRECTORY_ERROR_CODES)[number][];

/**
 * HTTP status per public read error.
 *
 * The resource server is the runtime authority; this table exists so the
 * reference and the generated OpenAPI document cannot describe a status the
 * routes do not return. `public-docs.test.ts` drives the real routes and
 * asserts they agree, so the two cannot drift silently.
 */
export const PUBLIC_DIRECTORY_READ_ERROR_STATUS: Readonly<
  Record<(typeof PUBLIC_DIRECTORY_READ_ERROR_CODES)[number], number>
> = {
  bad_request: 400,
  not_published: 404,
  rate_limited: 429,
  unavailable: 503,
};

export const PUBLIC_DIRECTORY_READ_ERROR_NOTES: Readonly<
  Record<(typeof PUBLIC_DIRECTORY_READ_ERROR_CODES)[number], string>
> = {
  bad_request: "A path, query, cursor, or bounded request is invalid.",
  not_published: "No current projection is available to this public surface.",
  rate_limited: "The public read budget is exhausted. Honor Retry-After when present.",
  unavailable: "A required hosted dependency or security binding is unavailable.",
};

export type PublicDirectorySearchItem =
  | { kind: "profile"; profile: PublicProfileProjectionDto }
  | { kind: "project"; project: PublicProjectProjectionDto };

export interface PublicDirectorySearchResponse {
  apiVersion: "v1";
  items: readonly PublicDirectorySearchItem[];
  nextCursor: ExternalCursor | null;
}

export interface PublicProfileProjectsResponse {
  apiVersion: "v1";
  profileSlug: string;
  items: readonly PublicProjectProjectionDto[];
  nextCursor: ExternalCursor | null;
}

/* ── Executable response catalog ──────────────────────────────────────────────
 *
 * What a public read SENDS BACK, in the same shape the input catalogs above
 * already use. Documenting only the request is what made this surface look
 * thinner than it is: the interesting part of a Seorak read is the evidence
 * envelope — `availability`, `coverage`, `sampleSize`, `freshness` — which is
 * exactly what a consumer must understand to avoid reading a missing
 * measurement as a zero.
 *
 * The grant-controlled subtrees are BUILT FROM the allowlist arrays
 * (`PUBLIC_PROFILE_FIELDS`, `PUBLIC_PROJECT_FIELDS`,
 * `PUBLIC_PROJECT_EVIDENCE_FIELDS`), so a newly grantable field appears in the
 * reference without anyone remembering to add it, and a removed one cannot
 * outlive its runtime.
 */

export interface PublicDocField {
  name: string;
  /** The wire type a consumer reads, e.g. `string`, `number | null`, `object[]`. */
  type: string;
  /** Present only when the publisher's allowlist selected it. */
  optional?: boolean;
  note: string;
  /** A closed value set a consumer may branch on. */
  values?: readonly string[];
  /** Fields of a nested object, or of an array's element. */
  fields?: readonly PublicDocField[];
}

const AVAILABILITY_FIELDS: readonly PublicDocField[] = [
  {
    name: "state",
    type: "string",
    note: "Whether the source could support the claim at all.",
    values: ["available", "partial", "unavailable"],
  },
  {
    name: "reason",
    type: "string | null",
    note: "Null when fully available; otherwise a stable capability gap. Never treat a gap as a zero.",
    values: [
      "not-captured",
      "not-retained",
      "not-yet-computed",
      "outside-credential-restriction",
      "temporarily-unavailable",
      "result-limit",
    ],
  },
];

const FRESHNESS_FIELDS: readonly PublicDocField[] = [
  {
    name: "state",
    type: "string",
    note: "Freshness travels with the frozen claim rather than being inferred by the reader.",
    values: ["fresh", "stale", "revalidating"],
  },
  { name: "generatedAt", type: "string", note: "When this projection was derived." },
  {
    name: "dataThrough",
    type: "string | null",
    note: "Latest source observation included, or null for an honest-empty result.",
  },
  {
    name: "staleAt",
    type: "string",
    note: "Boundary after which a caller must describe the projection as stale.",
  },
];

const DATE_RANGE_FIELDS: readonly PublicDocField[] = [
  { name: "from", type: "string", note: "First day in range, as a calendar date." },
  { name: "through", type: "string", note: "Last day in range, inclusive." },
];

const PUBLICATION_STAMP_FIELDS: readonly PublicDocField[] = [
  { name: "apiVersion", type: "string", note: "Always v1 on this surface." },
  {
    name: "publicationVersion",
    type: "integer",
    note: "Monotonic version of the publication behind this projection.",
  },
  { name: "publishedAt", type: "string", note: "When the publication first became public." },
  { name: "updatedAt", type: "string", note: "When the current projection was written." },
  {
    name: "revokedAt",
    type: "string | null",
    note: "Always null on a public read; a revoked item is not served.",
  },
];

const SURFACE_FIELD: PublicDocField = {
  name: "surface",
  type: "string",
  note: "Which grant produced this projection. Each surface is a separate decision.",
  values: ["web", "api", "mcp"],
};

/** The envelope every selected measurement carries, so a value is never bare. */
export const PUBLIC_MEASUREMENT_FIELDS: readonly PublicDocField[] = [
  {
    name: "value",
    type: "number | null",
    note: "Null when the measurement could not be supported. Read availability before this.",
  },
  { name: "unit", type: "string", note: "How to render the value.", values: ["count", "percent"] },
  {
    name: "availability",
    type: "object",
    note: "Whether the claim could be supported, and why not when it could not.",
    fields: AVAILABILITY_FIELDS,
  },
  {
    name: "sampleSize",
    type: "integer",
    note: "Denominator behind a rate, or the counted population behind a count.",
  },
  {
    name: "coverage",
    type: "object",
    note: "The window the measurement describes, and whether that window is whole.",
    fields: [
      { name: "period", type: "object", note: "Measured window.", fields: DATE_RANGE_FIELDS },
      {
        name: "complete",
        type: "boolean",
        note: "False means the window has gaps, so the value is a floor rather than a total.",
      },
    ],
  },
  { name: "generatedAt", type: "string", note: "When this measurement was frozen." },
  { name: "freshness", type: "object", note: "Age of the frozen claim.", fields: FRESHNESS_FIELDS },
];

const PROFILE_VALUE_NOTES: Readonly<Record<PublicProfileField, string>> = {
  displayName: "Public display name.",
  headline: "One-line self description.",
  bio: "Longer self description.",
  location: "Free-text location.",
  avatarUrl: "HTTPS avatar image.",
  contactUrl: "HTTPS contact destination.",
};

const PROJECT_VALUE_NOTES: Readonly<Record<PublicProjectField, string>> = {
  name: "Public project name.",
  summary: "What the project is.",
  role: "The publisher's role on it.",
  startedOn: "Calendar date the period opens.",
  endedOn: "Calendar date the period closes, or null while ongoing.",
  projectUrl: "HTTPS destination for the project itself.",
  sourceUrl: "HTTPS destination for its source.",
  technologies: "Declared technologies, as a string array.",
};

const PROJECT_EVIDENCE_NOTES: Readonly<Record<PublicProjectEvidenceField, string>> = {
  sessionCount: "Distinct agent sessions attributed to the project.",
  toolCallCount: "Tool calls attributed to the project.",
  shippedChangeRate: "Share of changes that reached the branch.",
  lineSurvivalRate: "Share of changed lines still on the branch later.",
};

const PROFILE_VALUE_TYPES: Readonly<Record<PublicProfileField, string>> = {
  displayName: "string",
  headline: "string",
  bio: "string",
  location: "string",
  avatarUrl: "string",
  contactUrl: "string",
};

const PROJECT_VALUE_TYPES: Readonly<Record<PublicProjectField, string>> = {
  name: "string",
  summary: "string",
  role: "string",
  startedOn: "string",
  endedOn: "string | null",
  projectUrl: "string",
  sourceUrl: "string",
  technologies: "string[]",
};

const PROFILE_VALUE_FIELDS: readonly PublicDocField[] = PUBLIC_PROFILE_FIELDS.map((name) => ({
  name,
  type: PROFILE_VALUE_TYPES[name],
  optional: true,
  note: PROFILE_VALUE_NOTES[name],
}));

const PROJECT_VALUE_FIELDS: readonly PublicDocField[] = PUBLIC_PROJECT_FIELDS.map((name) => ({
  name,
  type: PROJECT_VALUE_TYPES[name],
  optional: true,
  note: PROJECT_VALUE_NOTES[name],
}));

const PROJECT_EVIDENCE_SUBFIELDS: readonly PublicDocField[] =
  PUBLIC_PROJECT_EVIDENCE_FIELDS.map((name) => ({
    name,
    type: "object",
    optional: true,
    note: PROJECT_EVIDENCE_NOTES[name],
    fields: PUBLIC_MEASUREMENT_FIELDS,
  }));

export const PUBLIC_PROFILE_RESPONSE_FIELDS: readonly PublicDocField[] = [
  ...PUBLICATION_STAMP_FIELDS,
  SURFACE_FIELD,
  { name: "profileSlug", type: "string", note: "The public profile slug." },
  {
    name: "fields",
    type: "object",
    note: "Only the values this surface's allowlist selected. An absent key was not granted.",
    fields: PROFILE_VALUE_FIELDS,
  },
];

export const PUBLIC_PROJECT_RESPONSE_FIELDS: readonly PublicDocField[] = [
  ...PUBLICATION_STAMP_FIELDS,
  SURFACE_FIELD,
  { name: "profileSlug", type: "string", note: "Slug of the profile that owns the project." },
  { name: "projectSlug", type: "string", note: "The public project slug." },
  {
    name: "fields",
    type: "object",
    note: "Only the values this surface's allowlist selected.",
    fields: PROJECT_VALUE_FIELDS,
  },
  {
    name: "evidence",
    type: "object",
    note: "Only the measurements this surface's allowlist selected, each in a full envelope.",
    fields: PROJECT_EVIDENCE_SUBFIELDS,
  },
];

const ACTIVITY_DAY_FIELDS: readonly PublicDocField[] = [
  { name: "date", type: "string", note: "The calendar day, in the profile's time zone." },
  {
    name: "distinctSessionCount",
    type: "integer | null",
    note: "Null unless the day can be claimed. Zero is valid only with complete coverage.",
  },
  {
    name: "active",
    type: "boolean | null",
    note: "False is valid only for a complete day with a measured zero.",
  },
  {
    name: "coverage",
    type: "string",
    note: "How much of the day the record can account for.",
    values: ["complete", "partial", "unavailable"],
  },
  {
    name: "availability",
    type: "object",
    note: "Why a day could not be claimed, when it could not.",
    fields: AVAILABILITY_FIELDS,
  },
];

const ACTIVITY_STREAK_FIELDS: readonly PublicDocField[] = [
  {
    name: "status",
    type: "string",
    note: "Unknown means the walk backward hit a day it could not account for.",
    values: ["known", "unknown"],
  },
  { name: "days", type: "integer | null", note: "Streak length, or null when status is unknown." },
  { name: "start", type: "string | null", note: "First day of the streak, when it is known." },
  { name: "through", type: "string", note: "Last day considered." },
  {
    name: "blockedAt",
    type: "string | null",
    note: "First partial or unavailable day reached while walking backward.",
  },
  {
    name: "completeActiveDaysSinceBoundary",
    type: "integer",
    note: "Honest lower bound. Never present this as the streak length.",
  },
];

export const PUBLIC_ACTIVITY_RESPONSE_FIELDS: readonly PublicDocField[] = [
  ...PUBLICATION_STAMP_FIELDS,
  SURFACE_FIELD,
  { name: "profileSlug", type: "string", note: "The public profile slug." },
  { name: "timeZone", type: "string", note: "IANA zone the calendar days are bucketed in." },
  { name: "period", type: "object", note: "Window the calendar covers.", fields: DATE_RANGE_FIELDS },
  {
    name: "fields",
    type: "object",
    note: "Only the frozen activity this surface's allowlist selected.",
    fields: [
      {
        name: "calendar",
        type: "object",
        optional: true,
        note: "Frozen day-by-day record. Readers never recompute it.",
        fields: [
          { name: "days", type: "object[]", note: "One entry per day in the period.", fields: ACTIVITY_DAY_FIELDS },
          { name: "generatedAt", type: "string", note: "When the calendar was frozen." },
          { name: "freshness", type: "object", note: "Age of the frozen calendar.", fields: FRESHNESS_FIELDS },
        ],
      },
      {
        name: "streak",
        type: "object",
        optional: true,
        note: "Frozen streak state, including its honest-unknown form.",
        fields: ACTIVITY_STREAK_FIELDS,
      },
    ],
  },
];

const TOKEN_USAGE_DAY_FIELDS: readonly PublicDocField[] = [
  { name: "date", type: "string", note: "The calendar day the tokens were observed on." },
  {
    name: "byAgent",
    type: "object",
    note: "Input+output tokens for each published agent that day. Absent keys were not measured.",
    fields: [
      { name: "claude-code", type: "integer", optional: true, note: "Claude Code tokens that day." },
      { name: "codex", type: "integer", optional: true, note: "Codex tokens that day." },
    ],
  },
  {
    name: "total",
    type: "integer | null",
    note: "Sum of byAgent for that day, or null when coverage cannot support a total.",
  },
  {
    name: "coverage",
    type: "string",
    note: "How much of the day the record can account for.",
    values: ["complete", "partial", "unavailable"],
  },
  {
    name: "availability",
    type: "object",
    note: "Why a day could not be claimed, when it could not.",
    fields: AVAILABILITY_FIELDS,
  },
];

const TOKEN_USAGE_FIELD_NOTES: Readonly<Record<PublicTokenUsageField, string>> = {
  series: "Frozen day-by-day token series. Readers never recompute it from private history.",
  totals: "Period sum across the frozen window, with availability and coverage.",
};

export const PUBLIC_TOKEN_USAGE_RESPONSE_FIELDS: readonly PublicDocField[] = [
  ...PUBLICATION_STAMP_FIELDS,
  SURFACE_FIELD,
  { name: "profileSlug", type: "string", note: "The public profile slug." },
  {
    name: "projectSlug",
    type: "string | null",
    note: "Null for a profile-wide series; set for a project-scoped embed.",
  },
  {
    name: "rangeDays",
    type: "integer",
    note: "Frozen window length in days.",
    values: ["30", "90"],
  },
  { name: "period", type: "object", note: "Window the series covers.", fields: DATE_RANGE_FIELDS },
  {
    name: "fields",
    type: "object",
    note: "Only the frozen token-usage fields this surface's allowlist selected.",
    fields: PUBLIC_TOKEN_USAGE_FIELDS.map((name) =>
      name === "series"
        ? {
            name,
            type: "object",
            optional: true,
            note: TOKEN_USAGE_FIELD_NOTES[name],
            fields: [
              {
                name: "days",
                type: "object[]",
                note: "One entry per day in the period.",
                fields: TOKEN_USAGE_DAY_FIELDS,
              },
              { name: "generatedAt", type: "string", note: "When the series was frozen." },
              {
                name: "freshness",
                type: "object",
                note: "Age of the frozen series.",
                fields: FRESHNESS_FIELDS,
              },
            ],
          }
        : {
            name,
            type: "object",
            optional: true,
            note: TOKEN_USAGE_FIELD_NOTES[name],
            fields: [
              {
                name: "total",
                type: "integer | null",
                note: "Period total, or null when the sum cannot be claimed.",
              },
              {
                name: "byAgent",
                type: "object",
                note: "Period totals by agent.",
                fields: [
                  {
                    name: "claude-code",
                    type: "integer",
                    optional: true,
                    note: "Claude Code period total.",
                  },
                  { name: "codex", type: "integer", optional: true, note: "Codex period total." },
                ],
              },
              {
                name: "availability",
                type: "object",
                note: "Whether the period total could be supported.",
                fields: AVAILABILITY_FIELDS,
              },
              {
                name: "sampleSize",
                type: "integer",
                note: "Number of days that contributed a measured total.",
              },
              {
                name: "coverage",
                type: "object",
                note: "The window the total describes.",
                fields: [
                  { name: "period", type: "object", note: "Measured window.", fields: DATE_RANGE_FIELDS },
                  {
                    name: "complete",
                    type: "boolean",
                    note: "False means the window has gaps, so the value is a floor.",
                  },
                ],
              },
            ],
          }
    ),
  },
];

const NEXT_CURSOR_FIELD: PublicDocField = {
  name: "nextCursor",
  type: "string | null",
  note: "Opaque cursor for the next page, or null on the last page.",
};

export const PUBLIC_SEARCH_RESPONSE_FIELDS: readonly PublicDocField[] = [
  { name: "apiVersion", type: "string", note: "Always v1 on this surface." },
  {
    name: "items",
    type: "object[]",
    note: "Matches in rank order. An empty array is a successful answer, not an error.",
    fields: [
      {
        name: "kind",
        type: "string",
        note: "Which projection the entry carries.",
        values: ["profile", "project"],
      },
      {
        name: "profile",
        type: "object",
        optional: true,
        note: "Present when kind is profile.",
        fields: PUBLIC_PROFILE_RESPONSE_FIELDS,
      },
      {
        name: "project",
        type: "object",
        optional: true,
        note: "Present when kind is project.",
        fields: PUBLIC_PROJECT_RESPONSE_FIELDS,
      },
    ],
  },
  NEXT_CURSOR_FIELD,
];

export const PUBLIC_PROFILE_PROJECTS_RESPONSE_FIELDS: readonly PublicDocField[] = [
  { name: "apiVersion", type: "string", note: "Always v1 on this surface." },
  { name: "profileSlug", type: "string", note: "The profile whose projects were listed." },
  {
    name: "items",
    type: "object[]",
    note: "Project projections under this profile.",
    fields: PUBLIC_PROJECT_RESPONSE_FIELDS,
  },
  NEXT_CURSOR_FIELD,
];

/**
 * Response shape per documented HTTP endpoint.
 *
 * Keyed by the id union rather than by `string`: a new endpoint without a
 * documented response is a compile error, not a page that quietly renders no
 * response table.
 */
export const PUBLIC_HTTP_RESPONSE_FIELDS: Readonly<
  Record<PublicHttpEndpointId, readonly PublicDocField[]>
> = {
  search: PUBLIC_SEARCH_RESPONSE_FIELDS,
  profile: PUBLIC_PROFILE_RESPONSE_FIELDS,
  activity: PUBLIC_ACTIVITY_RESPONSE_FIELDS,
  projects: PUBLIC_PROFILE_PROJECTS_RESPONSE_FIELDS,
  project: PUBLIC_PROJECT_RESPONSE_FIELDS,
  tokenUsage: PUBLIC_TOKEN_USAGE_RESPONSE_FIELDS,
  projectTokenUsage: PUBLIC_TOKEN_USAGE_RESPONSE_FIELDS,
};

/** `structuredContent` shape per MCP tool. Same projections as the HTTP reads. */
export const PUBLIC_MCP_TOOL_RESULTS: Readonly<
  Record<PublicMcpToolName, readonly PublicDocField[]>
> = {
  search_public_profiles: PUBLIC_SEARCH_RESPONSE_FIELDS,
  search_public_projects: PUBLIC_SEARCH_RESPONSE_FIELDS,
  get_public_profile: PUBLIC_PROFILE_RESPONSE_FIELDS,
  get_public_activity: PUBLIC_ACTIVITY_RESPONSE_FIELDS,
  get_public_token_usage: PUBLIC_TOKEN_USAGE_RESPONSE_FIELDS,
  get_public_project: PUBLIC_PROJECT_RESPONSE_FIELDS,
  get_public_project_token_usage: PUBLIC_TOKEN_USAGE_RESPONSE_FIELDS,
  list_public_profile_projects: PUBLIC_PROFILE_PROJECTS_RESPONSE_FIELDS,
};

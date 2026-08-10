import {
  INTEGRATION_API_VERSION,
  INTEGRATION_SCOPES,
  type IntegrationCredentialIssueRequest,
  type IntegrationCredentialIssueResult,
  type IntegrationCredentialList,
  type IntegrationCredentialRestrictions,
  type IntegrationCredentialSummary,
  type IntegrationRateLimit,
  type IntegrationProjectList,
} from '@seorak/types';
import { API_BASE } from './api.js';
import { controlAuthHeader } from './token.js';
import type { DataPlaneOperator } from '@seorak/types/data-plane';

type FetchLike = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function scopes(value: unknown): IntegrationCredentialSummary['scopes'] | null {
  if (!Array.isArray(value) || value.length < 1 || value.some(
    (scope) => typeof scope !== 'string' ||
      !(INTEGRATION_SCOPES as readonly string[]).includes(scope),
  ) || new Set(value).size !== value.length) return null;
  return value as IntegrationCredentialSummary['scopes'];
}

function rateLimit(value: unknown): IntegrationRateLimit | null {
  const input = record(value);
  if (!input || Object.keys(input).length !== 2 ||
      !Number.isSafeInteger(input.requestsPerMinute) ||
      (input.requestsPerMinute as number) < 1 ||
      !Number.isSafeInteger(input.burst) || (input.burst as number) < 1) return null;
  return input as unknown as IntegrationRateLimit;
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function restrictions(value: unknown): IntegrationCredentialRestrictions | undefined | null {
  if (value === undefined) return undefined;
  const input = record(value);
  if (!input || Object.keys(input).some((key) =>
    key !== 'projectRefs' && key !== 'dateRange')) return null;
  let projectRefs: readonly string[] | undefined;
  if (input.projectRefs !== undefined) {
    if (!Array.isArray(input.projectRefs) || input.projectRefs.length !== 1 ||
        typeof input.projectRefs[0] !== 'string' ||
        !/^prj_[0-9a-f]{32}$/.test(input.projectRefs[0])) return null;
    projectRefs = [input.projectRefs[0]];
  }
  let dateRange: IntegrationCredentialRestrictions['dateRange'];
  if (input.dateRange !== undefined) {
    const range = record(input.dateRange);
    if (!range || Object.keys(range).length !== 2 ||
        !calendarDate(range.from) || !calendarDate(range.through) ||
        range.from > range.through) return null;
    dateRange = { from: range.from, through: range.through };
  }
  return {
    ...(projectRefs === undefined ? {} : { projectRefs }),
    ...(dateRange === undefined ? {} : { dateRange }),
  };
}

function summary(value: unknown): IntegrationCredentialSummary | null {
  const input = record(value);
  const parsedScopes = scopes(input?.scopes);
  const parsedRestrictions = restrictions(input?.restrictions);
  const parsedRateLimit = rateLimit(input?.rateLimit);
  if (!input || input.apiVersion !== INTEGRATION_API_VERSION ||
      typeof input.credentialRef !== 'string' ||
      !/^icr_[0-9a-f]{32}$/.test(input.credentialRef) ||
      typeof input.audience !== 'string' || !parsedScopes ||
      typeof input.issuedAt !== 'string' || typeof input.expiresAt !== 'string' ||
      (input.lastUsedAt !== null && typeof input.lastUsedAt !== 'string') ||
      (input.revokedAt !== null && typeof input.revokedAt !== 'string') ||
      parsedRestrictions === null || !parsedRateLimit) return null;
  return {
    apiVersion: INTEGRATION_API_VERSION,
    credentialRef: input.credentialRef,
    audience: input.audience,
    scopes: parsedScopes,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    lastUsedAt: input.lastUsedAt as string | null,
    revokedAt: input.revokedAt as string | null,
    ...(parsedRestrictions === undefined ? {} : { restrictions: parsedRestrictions }),
    rateLimit: parsedRateLimit,
  };
}

export function parseIntegrationCredentialList(value: unknown): IntegrationCredentialList {
  const input = record(value);
  if (!input || input.apiVersion !== INTEGRATION_API_VERSION ||
      !Array.isArray(input.credentials)) {
    throw new Error('Private integration response is invalid.');
  }
  const credentials = input.credentials.map(summary);
  if (credentials.some((credential) => credential === null)) {
    throw new Error('Private integration response is invalid.');
  }
  return { apiVersion: INTEGRATION_API_VERSION, credentials: credentials as IntegrationCredentialSummary[] };
}

export function parseIntegrationProjectList(value: unknown): IntegrationProjectList {
  const input = record(value);
  if (!input || input.apiVersion !== INTEGRATION_API_VERSION || !Array.isArray(input.projects)) {
    throw new Error('Private integration response is invalid.');
  }
  const seen = new Set<string>();
  const projects = input.projects.map((value) => {
    const project = record(value);
    if (!project || typeof project.projectRef !== 'string' ||
        !/^prj_[0-9a-f]{32}$/.test(project.projectRef) ||
        seen.has(project.projectRef) || typeof project.label !== 'string' ||
        project.label.trim().length < 1 || project.label.length > 120) {
      throw new Error('Private integration response is invalid.');
    }
    seen.add(project.projectRef);
    return { projectRef: project.projectRef, label: project.label };
  });
  return { apiVersion: INTEGRATION_API_VERSION, projects };
}

function parseIssue(value: unknown): IntegrationCredentialIssueResult {
  const input = record(value);
  const parsedScopes = scopes(input?.scopes);
  const parsedRestrictions = restrictions(input?.restrictions);
  const parsedRateLimit = rateLimit(input?.rateLimit);
  if (!input || input.apiVersion !== INTEGRATION_API_VERSION ||
      typeof input.credentialRef !== 'string' ||
      !/^icr_[0-9a-f]{32}$/.test(input.credentialRef) ||
      typeof input.secret !== 'string' ||
      !/^srkx_[0-9a-f]{32}_[0-9a-f]{64}$/.test(input.secret) ||
      typeof input.audience !== 'string' || !parsedScopes ||
      typeof input.issuedAt !== 'string' || typeof input.expiresAt !== 'string' ||
      parsedRestrictions === null || !parsedRateLimit) {
    throw new Error('Private integration response is invalid.');
  }
  return {
    apiVersion: INTEGRATION_API_VERSION,
    credentialRef: input.credentialRef,
    secret: input.secret,
    audience: input.audience,
    scopes: parsedScopes,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    ...(parsedRestrictions === undefined ? {} : { restrictions: parsedRestrictions }),
    rateLimit: parsedRateLimit,
  };
}

async function json(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Private integration request failed (${response.status}).`);
  return response.json();
}

export function createIntegrationApi(options: { baseUrl?: string; fetch?: FetchLike } = {}) {
  const base = options.baseUrl ?? API_BASE;
  const fetchImpl = options.fetch ?? fetch;
  const url = (path: string) => `${base.replace(/\/$/, '')}${path}`;
  return {
    async list(signal?: AbortSignal): Promise<IntegrationCredentialList> {
      const response = await fetchImpl(url('/integrations'), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: controlAuthHeader(),
        ...(signal ? { signal } : {}),
      });
      return parseIntegrationCredentialList(await json(response));
    },
    async projects(signal?: AbortSignal): Promise<IntegrationProjectList> {
      const response = await fetchImpl(url('/integrations/projects'), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: controlAuthHeader(),
        ...(signal ? { signal } : {}),
      });
      return parseIntegrationProjectList(await json(response));
    },
    async issue(request: IntegrationCredentialIssueRequest): Promise<IntegrationCredentialIssueResult> {
      const response = await fetchImpl(url('/integrations'), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', ...controlAuthHeader() },
        body: JSON.stringify(request),
      });
      return parseIssue(await json(response));
    },
    async revoke(credentialRef: string): Promise<void> {
      const response = await fetchImpl(url(`/integrations/${encodeURIComponent(credentialRef)}`), {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', ...controlAuthHeader() },
        body: '{}',
      });
      await json(response);
    },
  };
}

export const integrationApi = createIntegrationApi();

export function privateIntegrationAudienceAt(
  servedOrigin: string,
  target: 'api' | 'mcp',
  operator: DataPlaneOperator | null,
): string {
  if (target === 'mcp' && operator === 'seorak-managed') {
    throw new TypeError('managed MCP uses OAuth, not a static integration credential');
  }
  if (operator !== 'local-machine') {
    return new URL(target === 'api' ? '/api/v1' : '/mcp/private', servedOrigin).toString();
  }
  const canonical = new URL(servedOrigin);
  canonical.protocol = 'http:';
  canonical.hostname = '127.0.0.1';
  return new URL(target === 'api' ? '/api/v1' : '/mcp/private', canonical.origin).toString();
}

export function privateApiAudience(operator: DataPlaneOperator | null = null): string {
  // Self-hosted and managed planes use their exact served origin. Loopback is
  // deliberately different: a dashboard opened through `localhost` still
  // names the trusted listener audience at canonical `127.0.0.1:<port>`.
  return privateIntegrationAudienceAt(window.location.origin, 'api', operator);
}

export function privateMcpAudience(operator: DataPlaneOperator): string {
  return privateIntegrationAudienceAt(window.location.origin, 'mcp', operator);
}

export function codexPrivateMcpSetup(resourceUrl: string): string {
  const resource = new URL(resourceUrl);
  if ((resource.protocol !== 'http:' && resource.protocol !== 'https:') ||
      resource.username !== '' || resource.password !== '' ||
      resource.pathname !== '/mcp/private' || resource.search !== '' || resource.hash !== '' ||
      resource.toString() !== resourceUrl) {
    throw new TypeError('MCP resource URL must be the exact canonical /mcp/private URL.');
  }
  // A canonical URL cannot contain a literal double quote. Double quotes keep
  // IPv6 brackets literal in POSIX shells and form one argv value in cmd.exe
  // and PowerShell, without placing the bearer secret in the command itself.
  return `codex mcp add seorak --url "${resourceUrl}" --bearer-token-env-var SEORAK_MCP_TOKEN`;
}

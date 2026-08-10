// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeCsrfToken } from './token.js';
import {
  codexPrivateMcpSetup,
  createIntegrationApi,
  parseIntegrationCredentialList,
  parseIntegrationProjectList,
  privateApiAudience,
  privateIntegrationAudienceAt,
  privateMcpAudience,
} from './integrationApi.js';

const summary = {
  apiVersion: 'v1',
  credentialRef: `icr_${'a'.repeat(32)}`,
  audience: 'https://owner.example.test/api/v1',
  scopes: ['period:read'],
  issuedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  rateLimit: { requestsPerMinute: 60, burst: 60 },
};

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('integrationApi', () => {
  it('uses owner CSRF authority for list, one-time issuance, and revocation', async () => {
    writeCsrfToken('private-integration-csrf');
    const issued = {
      ...summary,
      secret: `srkx_${'a'.repeat(32)}_${'b'.repeat(64)}`,
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        apiVersion: 'v1', credentials: [summary],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        apiVersion: 'v1', projects: [{ projectRef: `prj_${'c'.repeat(32)}`, label: 'Project' }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify(issued), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    const api = createIntegrationApi({
      baseUrl: 'https://owner.example.test',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await api.list();
    await api.projects();
    await api.issue({
      apiVersion: 'v1',
      audience: summary.audience,
      scopes: ['period:read'],
      expiresAt: summary.expiresAt,
      rateLimit: summary.rateLimit,
    });
    await api.revoke(summary.credentialRef);

    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['https://owner.example.test/integrations', 'GET'],
      ['https://owner.example.test/integrations/projects', 'GET'],
      ['https://owner.example.test/integrations', 'POST'],
      [`https://owner.example.test/integrations/${summary.credentialRef}`, 'DELETE'],
    ]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.headers).toMatchObject({ 'x-seorak-csrf': 'private-integration-csrf' });
      expect(init.credentials).toBe('same-origin');
    }
    expect(fetchImpl.mock.calls[3]![1]).toMatchObject({
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
      body: '{}',
    });
  });

  it('uses the canonical listener host for local audiences without changing self-hosted', () => {
    expect(privateIntegrationAudienceAt(
      'http://localhost:4318',
      'api',
      'local-machine',
    )).toBe('http://127.0.0.1:4318/api/v1');
    expect(privateIntegrationAudienceAt(
      'http://localhost:4318',
      'mcp',
      'local-machine',
    )).toBe('http://127.0.0.1:4318/mcp/private');

    expect(privateIntegrationAudienceAt(
      'https://seorak.example:8443',
      'api',
      'self-hosted',
    )).toBe('https://seorak.example:8443/api/v1');
    expect(privateIntegrationAudienceAt(
      'https://seorak.example:8443',
      'mcp',
      'self-hosted',
    )).toBe(
      'https://seorak.example:8443/mcp/private',
    );
    expect(() => privateIntegrationAudienceAt(
      'https://managed.example',
      'mcp',
      'seorak-managed',
    )).toThrow(
      'managed MCP uses OAuth',
    );
  });

  it('quotes canonical MCP resources as one argv value across supported shells', () => {
    expect(codexPrivateMcpSetup('https://[::1]:8443/mcp/private')).toBe(
      'codex mcp add seorak --url "https://[::1]:8443/mcp/private" ' +
      '--bearer-token-env-var SEORAK_MCP_TOKEN',
    );
    expect(codexPrivateMcpSetup('https://seorak.example:8443/mcp/private')).toBe(
      'codex mcp add seorak --url "https://seorak.example:8443/mcp/private" ' +
      '--bearer-token-env-var SEORAK_MCP_TOKEN',
    );
    for (const malformed of [
      'https://user@seorak.example/mcp/private',
      'https://seorak.example:443/mcp/private',
      'https://seorak.example/mcp/private/',
      'https://seorak.example/mcp/private?token=secret',
      'https://seorak.example/mcp/private#fragment',
      'https://seorak.example/api/v1',
    ]) {
      expect(() => codexPrivateMcpSetup(malformed)).toThrow('exact canonical /mcp/private');
    }
  });

  it('rejects malformed or internal-looking owner inventory rows', () => {
    expect(() => parseIntegrationCredentialList({
      apiVersion: 'v1',
      credentials: [{ ...summary, credentialRef: 'internal-row-id' }],
    })).toThrow('Private integration response is invalid.');
    expect(() => parseIntegrationCredentialList({
      apiVersion: 'v1',
      credentials: [{
        ...summary,
        restrictions: { projectRefs: ['a'.repeat(64)] },
      }],
    })).toThrow('Private integration response is invalid.');
    expect(() => parseIntegrationProjectList({
      apiVersion: 'v1',
      projects: [{ projectRef: 'a'.repeat(64), label: 'Internal id' }],
    })).toThrow('Private integration response is invalid.');
  });
});

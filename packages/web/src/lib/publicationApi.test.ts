// @vitest-environment jsdom

import type { OwnerPublicationManifest } from '@seorak/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeCsrfToken } from './token.js';
import {
  createPublicationApi,
  parsePublicPresenceDocument,
  PUBLICATION_API_PATHS,
} from './publicationApi.js';

function status(
  state: 'saved' | 'queued' | 'delivering' | 'retrying' | 'applied' | 'failed' = 'saved',
  operation: 'apply' | 'revoke' | null = null,
) {
  return {
    apiVersion: 'v1' as const,
    savedRevision: 3,
    generatedVersion: 2,
    appliedVersion: state === 'applied' ? 2 : 1,
    blockingGeneration: ['queued', 'delivering', 'retrying', 'failed'].includes(state)
      ? 2
      : null,
    state,
    operation,
    attemptCount: 0,
    nextAttemptAt: null,
    lastErrorCode: null,
    appliedAt: state === 'applied' ? '2026-08-02T12:00:00.000Z' : null,
  };
}

function manifest(): OwnerPublicationManifest {
  return {
    apiVersion: 'v1',
    commandId: 'cmd_0123456789abcdef0123456789abcdef',
    expectedRevision: 2,
    profileSlug: 'ada-lovelace',
    profile: { displayName: 'Ada Lovelace' },
    grants: {
      web: { enabled: true, fields: ['displayName'] },
      search: { enabled: false, fields: [] },
      api: { enabled: false, fields: [] },
      mcp: { enabled: false, fields: [] },
    },
    activity: null,
    projects: [],
  };
}

function responseBody(overrides: Record<string, unknown> = {}) {
  return {
    manifest: manifest(),
    status: status(),
    availableProjects: [
      { sourceProjectId: 'a'.repeat(64), label: 'Analytical Engine' },
    ],
    ...overrides,
  };
}

function fakeFetch(body = responseBody()) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('publicationApi', () => {
  it('uses authenticated owner-cell routes and CSRF-protected mutation requests', async () => {
    writeCsrfToken('csrf-proof-for-public-presence');
    const fetchImpl = fakeFetch();
    const api = createPublicationApi({
      baseUrl: 'https://owner.example.test/',
      fetch: fetchImpl,
    });

    await api.load();
    await api.save(manifest());
    await api.publish(3);
    await api.revoke({
      commandId: 'cmd_fedcba9876543210fedcba9876543210',
      expectedGeneration: 2,
    });
    await api.retry(2);

    const calls = vi.mocked(fetchImpl).mock.calls;
    expect(calls.map(([url]) => url)).toEqual([
      `https://owner.example.test${PUBLICATION_API_PATHS.document}`,
      `https://owner.example.test${PUBLICATION_API_PATHS.manifest}`,
      `https://owner.example.test${PUBLICATION_API_PATHS.publish}`,
      `https://owner.example.test${PUBLICATION_API_PATHS.revoke}`,
      `https://owner.example.test${PUBLICATION_API_PATHS.retry(2)}`,
    ]);
    expect(calls.map(([, init]) => init?.method)).toEqual([
      'GET', 'PUT', 'POST', 'POST', 'POST',
    ]);

    for (const [, init] of calls) {
      expect(init?.headers).toMatchObject({
        'x-seorak-csrf': 'csrf-proof-for-public-presence',
      });
      expect(JSON.stringify(init)).not.toMatch(/publisher|secret|token/i);
    }
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual(manifest());
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({ manifestRevision: 3 });
    expect(JSON.parse(String(calls[3]?.[1]?.body))).toEqual({
      commandId: 'cmd_fedcba9876543210fedcba9876543210',
      expectedGeneration: 2,
    });
    expect(calls[4]?.[1]?.body).toBeUndefined();
  });

  it('normalizes an applied revocation into an explicit revoked UI state', () => {
    const document = parsePublicPresenceDocument(responseBody({
      status: status('applied', 'revoke'),
    }));

    expect(document.status.state).toBe('revoked');
    expect(document.status.operation).toBe('revoke');
  });

  it('rejects malformed status and private project-catalog responses', () => {
    expect(() => parsePublicPresenceDocument(responseBody({
      status: { ...status(), generatedVersion: -1 },
    }))).toThrow('Public presence response is invalid.');
    expect(() => parsePublicPresenceDocument(responseBody({
      status: { ...status('failed'), blockingGeneration: 3 },
    }))).toThrow('Public presence response is invalid.');
    expect(() => parsePublicPresenceDocument(responseBody({
      availableProjects: [{ sourceProjectId: 'not-an-owner-id', label: 'Project' }],
    }))).toThrow('Public presence response is invalid.');
  });
});

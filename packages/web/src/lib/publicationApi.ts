import type {
  OwnerPublicationManifest,
  OwnerPublicationStatus,
} from '@seorak/types';
import { API_BASE } from './api.js';
import { authHeader, controlAuthHeader } from './token.js';

export const PUBLICATION_API_PATHS = {
  document: '/public-presence/manifest',
  manifest: '/public-presence/manifest',
  publish: '/public-presence/publish',
  revoke: '/public-presence/revoke',
  retry: (generation: number) => `/public-presence/deliveries/${generation}/retry`,
} as const;

export type PublicPublicationState =
  | OwnerPublicationStatus['state']
  | 'revoked';

/** UI-facing name; an applied revoke is normalized to the explicit revoked state. */
export type PublicPublicationStatus = Omit<OwnerPublicationStatus, 'state'> & {
  state: PublicPublicationState;
};

/** Private project selector returned only by the authenticated owner-cell API. */
export interface PublicPresenceProjectOption {
  sourceProjectId: string;
  label: string;
}

export interface PublicPresenceDocument {
  manifest: OwnerPublicationManifest | null;
  status: PublicPublicationStatus;
  availableProjects: readonly PublicPresenceProjectOption[];
}

export interface PublicPresenceApi {
  load(options?: { signal?: AbortSignal }): Promise<PublicPresenceDocument>;
  save(manifest: OwnerPublicationManifest): Promise<PublicPresenceDocument>;
  publish(manifestRevision: number): Promise<PublicPresenceDocument>;
  revoke(input: {
    commandId: string;
    expectedGeneration: number;
  }): Promise<PublicPresenceDocument>;
  retry(generation: number): Promise<PublicPresenceDocument>;
}

export class PublicationApiError extends Error {
  constructor(readonly status: number) {
    super(`Public presence request failed (${status}).`);
    this.name = 'PublicationApiError';
  }
}

type FetchLike = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseStatus(value: unknown): PublicPublicationStatus | null {
  const input = record(value);
  if (!input || input.apiVersion !== 'v1' ||
      !Number.isSafeInteger(input.savedRevision) || (input.savedRevision as number) < 0 ||
      !Number.isSafeInteger(input.generatedVersion) || (input.generatedVersion as number) < 0 ||
      !Number.isSafeInteger(input.appliedVersion) || (input.appliedVersion as number) < 0 ||
      (input.blockingGeneration !== null && (
        !Number.isSafeInteger(input.blockingGeneration) ||
        (input.blockingGeneration as number) < 1 ||
        (input.blockingGeneration as number) > (input.generatedVersion as number)
      )) ||
      !['saved', 'queued', 'delivering', 'retrying', 'applied', 'failed', 'revoked']
        .includes(String(input.state)) ||
      (input.operation !== null && input.operation !== 'apply' && input.operation !== 'revoke') ||
      !Number.isSafeInteger(input.attemptCount) || (input.attemptCount as number) < 0 ||
      (input.nextAttemptAt !== null && typeof input.nextAttemptAt !== 'string') ||
      (input.lastErrorCode !== null && typeof input.lastErrorCode !== 'string') ||
      (input.appliedAt !== null && typeof input.appliedAt !== 'string')) return null;
  const state = input.state === 'applied' && input.operation === 'revoke'
    ? 'revoked'
    : input.state as PublicPublicationState;
  const outstanding = ['queued', 'delivering', 'retrying', 'failed'].includes(state);
  if (outstanding !== (input.blockingGeneration !== null)) return null;
  return { ...input, state } as unknown as PublicPublicationStatus;
}

function parseManifest(value: unknown): OwnerPublicationManifest | null | undefined {
  if (value === null) return null;
  const input = record(value);
  if (!input || input.apiVersion !== 'v1' ||
      typeof input.commandId !== 'string' ||
      !Number.isSafeInteger(input.expectedRevision) ||
      typeof input.profileSlug !== 'string' || !record(input.profile) ||
      !record(input.grants) ||
      (input.activity !== null && !record(input.activity)) ||
      (input.tokenUsage !== null && input.tokenUsage !== undefined &&
        !record(input.tokenUsage)) ||
      !Array.isArray(input.projects)) return undefined;
  return value as OwnerPublicationManifest;
}

export function parsePublicPresenceDocument(value: unknown): PublicPresenceDocument {
  const input = record(value);
  const manifest = parseManifest(input?.manifest);
  const status = parseStatus(input?.status);
  if (!input || manifest === undefined || !status || !Array.isArray(input.availableProjects)) {
    throw new Error('Public presence response is invalid.');
  }
  const availableProjects: PublicPresenceProjectOption[] = [];
  const ids = new Set<string>();
  for (const value of input.availableProjects) {
    const option = record(value);
    if (!option || typeof option.sourceProjectId !== 'string' ||
        !/^[0-9a-f]{64}$/.test(option.sourceProjectId) ||
        typeof option.label !== 'string' || option.label.trim().length === 0 ||
        option.label.length > 120 || ids.has(option.sourceProjectId)) {
      throw new Error('Public presence response is invalid.');
    }
    ids.add(option.sourceProjectId);
    availableProjects.push({
      sourceProjectId: option.sourceProjectId,
      label: option.label,
    });
  }
  return { manifest, status, availableProjects };
}

function join(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path}`;
}

export function createPublicationApi(options: {
  baseUrl?: string;
  fetch?: FetchLike;
} = {}): PublicPresenceApi {
  const baseUrl = options.baseUrl ?? API_BASE;
  const fetchImpl = options.fetch ?? fetch;

  async function request(
    path: string,
    init: RequestInit,
  ): Promise<PublicPresenceDocument> {
    const response = await fetchImpl(join(baseUrl, path), {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      ...init,
    });
    if (!response.ok) throw new PublicationApiError(response.status);
    return parsePublicPresenceDocument(await response.json());
  }

  return {
    load(options = {}) {
      return request(PUBLICATION_API_PATHS.document, {
        method: 'GET',
        // The publication document includes the owner's saved manifest and
        // private project catalog. The worker intentionally classifies this as
        // an owner-control read, so browser sessions must prove same-origin
        // intent with the session CSRF token even though the request is a GET.
        headers: controlAuthHeader(),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    },
    save(manifest) {
      return request(PUBLICATION_API_PATHS.manifest, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...controlAuthHeader(),
        },
        body: JSON.stringify(manifest),
      });
    },
    publish(manifestRevision) {
      return request(PUBLICATION_API_PATHS.publish, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...controlAuthHeader(),
        },
        body: JSON.stringify({ manifestRevision }),
      });
    },
    revoke(input) {
      return request(PUBLICATION_API_PATHS.revoke, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...controlAuthHeader(),
        },
        body: JSON.stringify(input),
      });
    },
    retry(generation) {
      return request(PUBLICATION_API_PATHS.retry(generation), {
        method: 'POST',
        headers: controlAuthHeader(),
      });
    },
  };
}

export const publicationApi = createPublicationApi();

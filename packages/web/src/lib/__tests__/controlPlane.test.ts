/**
 * controlPlane.test.ts — where the account origin comes from, and what happens
 * when there is none.
 *
 * The failure that matters is a request leaving for a host the user did not
 * choose. It used to be possible by construction: `VITE_CONTROL_PLANE_URL` was
 * baked at build time, so a published bundle would carry one operator's account
 * host to every install that ran it. These cases pin the replacement — the
 * serving plane's own descriptor — and, just as importantly, pin that ABSENT
 * resolves to nothing rather than to a default that happens to work here.
 *
 * Driven through the real probe rather than a stubbed module, because the
 * property under test spans the wire: a descriptor arrives, `@seorak/types`
 * validates the origin, and only then may a surface navigate to it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seorakRoutes } from '@seorak/types';
import {
  DATA_PLANE_PROTOCOL_VERSION,
  type DataPlaneStatus,
} from '@seorak/types/data-plane';
import { API_BASE } from '../api.js';
import { probeDataPlane } from '../dataPlane.js';
import {
  configuredControlPlaneUrl,
  hasConfiguredControlPlane,
} from '../controlPlane.js';

function managedStatus(controlPlaneUrl?: string): DataPlaneStatus {
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: {
      protocolVersion: DATA_PLANE_PROTOCOL_VERSION,
      authority: 'remote',
      operator: 'seorak-managed',
      surfaces: ['overview'],
      credentialRequired: true,
      ...(controlPlaneUrl === undefined ? {} : { controlPlaneUrl }),
    },
    coverage: null,
    lifecycle: null,
    rebaseline: null,
  };
}

function localStatus(): DataPlaneStatus {
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: {
      protocolVersion: DATA_PLANE_PROTOCOL_VERSION,
      authority: 'local',
      operator: 'local-machine',
      surfaces: ['overview'],
      credentialRequired: false,
    },
    coverage: null,
    lifecycle: null,
    rebaseline: null,
  };
}

function plane(path: string, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) =>
      String(input) === `${API_BASE}${path}`
        ? new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('configuredControlPlaneUrl', () => {
  it('is the origin the serving plane named', async () => {
    plane(
      seorakRoutes.compactSyncDataPlane(),
      managedStatus('https://control.example'),
    );
    await probeDataPlane();
    expect(configuredControlPlaneUrl()).toBe('https://control.example');
    expect(hasConfiguredControlPlane()).toBe(true);
  });

  it('is nothing on a local plane, which belongs to no account service', async () => {
    plane(seorakRoutes.localDataPlane(), localStatus());
    await probeDataPlane();
    expect(configuredControlPlaneUrl()).toBe('');
    expect(hasConfiguredControlPlane()).toBe(false);
  });

  it('is nothing when a remote plane names none', async () => {
    plane(seorakRoutes.compactSyncDataPlane(), managedStatus());
    await probeDataPlane();
    expect(configuredControlPlaneUrl()).toBe('');
    expect(hasConfiguredControlPlane()).toBe(false);
  });

  it('is nothing when no plane answered at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    await probeDataPlane();
    expect(configuredControlPlaneUrl()).toBe('');
    expect(hasConfiguredControlPlane()).toBe(false);
  });

  it('is nothing when a plane names an origin the contract refuses', async () => {
    // A path, a query, or embedded credentials would each turn "where accounts
    // live" into somewhere else, so the parser refuses the descriptor and the
    // app reads an unknown plane rather than a redirect target.
    plane(
      seorakRoutes.compactSyncDataPlane(),
      managedStatus('https://control.example/oauth/start/apple'),
    );
    await probeDataPlane();
    expect(configuredControlPlaneUrl()).toBe('');
  });

  it('cannot be supplied by the build, only by the plane', async () => {
    // The point of the whole change: one published artifact, no baked origin.
    // Setting the retired variable must not resurrect a build-time path.
    vi.stubEnv('VITE_CONTROL_PLANE_URL', 'https://baked.example');
    plane(seorakRoutes.localDataPlane(), localStatus());
    await probeDataPlane();
    expect(configuredControlPlaneUrl()).toBe('');
    vi.unstubAllEnvs();
  });
});

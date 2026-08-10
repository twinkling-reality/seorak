/**
 * dataPlane.test.ts — the probe that decides whether this dashboard needs a
 * sign-in at all, and which plane it is reading.
 *
 * The failure that matters is not "the probe broke". It is "the probe let the
 * app in when it should not have": entering without a credential against a
 * plane that requires one, or against a malformed body claiming to be local.
 * Every case below is written from that direction.
 *
 * THE STUB ANSWERS ONE PATH. It used to answer every URL, which is precisely why
 * this suite could not see that the probe asked a worker for `/data-plane` — a
 * path no worker registers — and reported every Pro deployment as silent. A stub
 * that does not know which route it is answering cannot fail when the route is
 * wrong, so the plane fakes below serve exactly the path the real plane serves
 * and 404 everything else.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seorakRoutes } from '@seorak/types';
import {
  DATA_PLANE_PROTOCOL_VERSION,
  type DataPlaneStatus,
} from '@seorak/types/data-plane';
import { API_BASE } from '../api.js';
import {
  currentDataPlane,
  currentPlaneServes,
  entersWithoutSignIn,
  probeDataPlane,
} from '../dataPlane.js';

function localStatus(): DataPlaneStatus {
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: {
      protocolVersion: DATA_PLANE_PROTOCOL_VERSION,
      authority: 'local',
      operator: 'local-machine',
      surfaces: ['live', 'overview', 'sessions', 'session', 'replay', 'settings'],
      credentialRequired: false,
    },
    coverage: null,
    lifecycle: null,
    rebaseline: null,
  };
}

function managedStatus(): DataPlaneStatus {
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: {
      protocolVersion: DATA_PLANE_PROTOCOL_VERSION,
      authority: 'remote',
      operator: 'seorak-managed',
      surfaces: ['overview'],
      credentialRequired: true,
    },
    coverage: null,
    lifecycle: null,
    rebaseline: null,
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A plane that serves the descriptor at ONE path and 404s every other. */
function plane(path: string, body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) =>
      String(input) === `${API_BASE}${path}`
        ? json(body, status)
        : json({ error: 'not found' }, 404),
    ),
  );
}

/** A deployment that serves the descriptor at no path at all. */
function silentPlane(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ error: 'not found' }, 404)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeDataPlane', () => {
  it('reads a local descriptor and lets the app enter with no sign-in', async () => {
    plane(seorakRoutes.localDataPlane(), localStatus());
    const status = await probeDataPlane();
    expect(status).not.toBeNull();
    expect(entersWithoutSignIn(status)).toBe(true);
  });

  it('reads the descriptor at the path a WORKER registers', async () => {
    // The defect this pins: a Pro customer's dashboard talks to a worker, which
    // serves the descriptor only at `/sync/v1/data-plane`. Probing the local
    // path alone answered null and Settings told them the deployment does not
    // report its data plane.
    plane(seorakRoutes.compactSyncDataPlane(), managedStatus());
    const status = await probeDataPlane();
    expect(status).not.toBeNull();
    expect(status!.descriptor.operator).toBe('seorak-managed');
    expect(entersWithoutSignIn(status)).toBe(false);
  });

  it('returns null when the deployment serves no descriptor at either path', async () => {
    silentPlane();
    expect(await probeDataPlane()).toBeNull();
    expect(entersWithoutSignIn(null)).toBe(false);
  });

  it('returns null when the transport fails, rather than assuming anything', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    expect(await probeDataPlane()).toBeNull();
  });

  it('refuses a malformed body instead of reading a partial descriptor', async () => {
    plane(seorakRoutes.localDataPlane(), {
      schemaVersion: 1,
      descriptor: { authority: 'local' },
    });
    expect(await probeDataPlane()).toBeNull();
  });

  it('never enters without a credential against a credentialed remote plane', async () => {
    plane(seorakRoutes.localDataPlane(), managedStatus());
    const status = await probeDataPlane();
    expect(status).not.toBeNull();
    expect(entersWithoutSignIn(status)).toBe(false);
  });

  it('rejects a body that claims local authority while demanding a credential', async () => {
    // The shared parser refuses this outright, so the open-entry path cannot be
    // reached by asserting `authority: "local"` on a gated plane.
    plane(seorakRoutes.localDataPlane(), {
      schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
      descriptor: {
        protocolVersion: DATA_PLANE_PROTOCOL_VERSION,
        authority: 'local',
        operator: 'local-machine',
        surfaces: ['overview'],
        credentialRequired: true,
      },
      coverage: null,
      lifecycle: null,
      rebaseline: null,
    });
    expect(await probeDataPlane()).toBeNull();
  });
});

describe('currentDataPlane', () => {
  it('exposes the surfaces the plane declared, and only those', async () => {
    plane(seorakRoutes.localDataPlane(), localStatus());
    await probeDataPlane();
    const surfaces = currentDataPlane()!.descriptor.surfaces;
    expect(surfaces).toContain('overview');
    // Absent means unavailable HERE, which is what stops a view rendering an
    // unserved surface as measured emptiness.
    expect(surfaces).not.toContain('developerModel');
    expect(surfaces).not.toContain('interventions');
  });
});

describe('currentPlaneServes', () => {
  it('reports an unserved surface as unavailable', async () => {
    plane(seorakRoutes.localDataPlane(), localStatus());
    await probeDataPlane();
    expect(currentPlaneServes('overview')).toBe(true);
    expect(currentPlaneServes('developerModel')).toBe(false);
    expect(currentPlaneServes('deliveryHealth')).toBe(false);
  });

  it('treats an UNKNOWN plane as no claim either way', async () => {
    // Every worker predating the contract serves no descriptor. Reading that as
    // "serves nothing" would blank surfaces that work perfectly well.
    silentPlane();
    await probeDataPlane();
    expect(currentPlaneServes('developerModel')).toBe(true);
  });
});

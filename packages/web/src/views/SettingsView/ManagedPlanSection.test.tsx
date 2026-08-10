// @vitest-environment jsdom
//
// THE PROBE IS NOT MOCKED HERE. It used to be, and that is the whole reason this
// section shipped telling every Pro customer "this deployment does not report
// which data plane it serves": the probe asked a worker for a path only the
// collector serves, and a `vi.mock` of `probeDataPlane` cannot see a wrong URL.
// These render against the real probe and a plane fake that answers exactly the
// path its real counterpart registers, so the route contract is under test too.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seorakRoutes } from '@seorak/types';
import {
  DATA_PLANE_SURFACES,
  type DataPlaneStatus,
} from '@seorak/types/data-plane';
import { API_BASE } from '../../lib/api.js';
import ManagedPlanSection from './ManagedPlanSection.js';

vi.mock('../../lib/demoMode.js', () => ({ isDemoActive: () => false }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A plane that serves the descriptor at ONE path and 404s every other. */
function servedAt(path: string, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) =>
      String(input) === `${API_BASE}${path}`
        ? json(body, 200)
        : json({ error: 'not found' }, 404),
    ),
  );
}

/** A deployment that describes itself at no path at all. */
function servedNowhere(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ error: 'not found' }, 404)),
  );
}

/** The contract's own list rather than a copy, so "a plane that answers
 *  everything" keeps meaning that after a surface is added. */
const ALL_SURFACES = DATA_PLANE_SURFACES;

function managedRecoveryStatus(): DataPlaneStatus {
  return {
    schemaVersion: 1,
    descriptor: {
      protocolVersion: 1,
      authority: 'remote',
      operator: 'seorak-managed',
      surfaces: [...ALL_SURFACES],
      credentialRequired: true,
    },
    coverage: {
      schemaVersion: 1,
      state: 'recovery',
      synchronizedThrough: '2026-08-01T00:00:00.000Z',
      pendingFrom: '2026-08-01T00:00:00.000Z',
      backlog: { sessions: 3, hours: 2, archives: 1 },
      lastAcceptedAt: '2026-08-01T00:00:00.000Z',
      lastAttemptAt: '2026-08-01T00:00:00.000Z',
      lastError: null,
      managedCopyComplete: false,
      observedAt: '2026-08-02T00:00:00.000Z',
    },
    lifecycle: {
      schemaVersion: 1,
      phase: 'recovery',
      paidThroughAt: '2026-08-01T00:00:00.000Z',
      remoteServiceEndsAt: '2026-08-01T00:00:00.000Z',
      hostedDeletionAt: '2026-08-31T00:00:00.000Z',
      recoveryExportAvailable: true,
      resumesExistingCopy: true,
      observedAt: '2026-08-02T00:00:00.000Z',
    },
    rebaseline: null,
  };
}

function localStatus(): DataPlaneStatus {
  return {
    schemaVersion: 1,
    descriptor: {
      protocolVersion: 1,
      authority: 'local',
      operator: 'local-machine',
      surfaces: [...ALL_SURFACES],
      credentialRequired: false,
    },
    coverage: null,
    lifecycle: null,
    rebaseline: null,
  };
}

async function render() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ManagedPlanSection />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { host, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ManagedPlanSection', () => {
  it('renders the downgrade promise with both exact dates', async () => {
    // Served at the WORKER's path, which is the only place a managed plane
    // answers. A section that could not read it here is the defect.
    servedAt(seorakRoutes.compactSyncDataPlane(), managedRecoveryStatus());
    const view = await render();
    const text = view.host.textContent ?? '';

    expect(text).toContain('Managed service ended on August 1, 2026');
    expect(text).toContain('read-only and downloadable until August 31, 2026');
    expect(text).toContain('You can download the managed copy now');
    expect(text).toContain(
      'Subscribing again before the deletion date resumes the copy that already exists',
    );
    expect(text).toContain(
      'Local capture, history, statistics, replay, reports, export, and local alerts continue',
    );

    // A partial managed copy must never read as the complete record.
    expect(text).toContain('This is not the complete record');
    expect(view.host.querySelector('[data-testid="managed-plan-coverage"]')).not.toBeNull();
    expect(view.host.querySelector('[data-testid="managed-plan-lifecycle"]')).not.toBeNull();

    view.unmount();
  });

  it('shows no subscription or sync claim on a local plane', async () => {
    servedAt(seorakRoutes.localDataPlane(), localStatus());
    const view = await render();
    const text = view.host.textContent ?? '';

    expect(text).toContain('Free, on this computer');
    expect(text).toContain('You are reading the complete local record');
    expect(view.host.querySelector('[data-testid="managed-plan-coverage"]')).toBeNull();
    expect(view.host.querySelector('[data-testid="managed-plan-lifecycle"]')).toBeNull();
    expect(text).not.toMatch(/subscription|deleted|downloadable/i);

    view.unmount();
  });

  it('treats a plane that reports nothing as unavailable, not as no plan', async () => {
    servedNowhere();
    const view = await render();
    const text = view.host.textContent ?? '';

    expect(text).toContain('does not report which data plane it serves');
    expect(text).not.toMatch(/\bFree\b|\bPro\b/);

    view.unmount();
  });

  it('names a required rebaseline without implying local loss', async () => {
    const status = managedRecoveryStatus();
    status.rebaseline = {
      schemaVersion: 1,
      required: true,
      baselineEpoch: 2,
      reason: 'hosted-copy-deleted',
      managedCopyEmptySince: '2026-08-31T00:00:00.000Z',
      issuedAt: '2026-08-31T00:00:00.000Z',
    };
    servedAt(seorakRoutes.compactSyncDataPlane(), status);
    const view = await render();
    const text = view.host.textContent ?? '';

    expect(text).toContain('asked for a fresh copy');
    expect(text).toContain('nothing local is removed');

    view.unmount();
  });
});

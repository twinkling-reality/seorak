import { describe, expect, it } from 'vitest';
import {
  DATA_PLANE_SURFACES,
  type DataPlaneStatus,
  type ManagedLifecycleWindow,
  type ManagedSyncCoverage,
} from '@seorak/types/data-plane';
import {
  completenessSummary,
  coverageSummary,
  formatExactInstant,
  lifecycleSummary,
  operatorSummary,
  planLabel,
  unavailableSurfacesSummary,
} from './managedPlanCopy.js';

/** The contract's own list, not a copy of it. A hand-written duplicate silently
 *  stops meaning "a plane that answers everything" the moment a surface is
 *  added, which is how `publication` slipped past this file once already. */
const SURFACES = DATA_PLANE_SURFACES;

function localStatus(): DataPlaneStatus {
  return {
    schemaVersion: 1,
    descriptor: {
      protocolVersion: 1,
      authority: 'local',
      operator: 'local-machine',
      surfaces: [...SURFACES],
      credentialRequired: false,
    },
    coverage: null,
    lifecycle: null,
    rebaseline: null,
  };
}

function coverage(overrides: Partial<ManagedSyncCoverage> = {}): ManagedSyncCoverage {
  return {
    schemaVersion: 1,
    state: 'current',
    synchronizedThrough: '2026-08-01T12:00:00.000Z',
    pendingFrom: null,
    backlog: { sessions: 0, hours: 0, archives: 0 },
    lastAcceptedAt: '2026-08-01T12:00:00.000Z',
    lastAttemptAt: '2026-08-01T12:00:00.000Z',
    lastError: null,
    managedCopyComplete: true,
    observedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

function lifecycle(
  overrides: Partial<ManagedLifecycleWindow> = {},
): ManagedLifecycleWindow {
  return {
    schemaVersion: 1,
    phase: 'active',
    paidThroughAt: '2026-09-01T00:00:00.000Z',
    remoteServiceEndsAt: null,
    hostedDeletionAt: null,
    recoveryExportAvailable: false,
    resumesExistingCopy: true,
    observedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

function managedStatus(
  parts: {
    coverage?: ManagedSyncCoverage | null;
    lifecycle?: ManagedLifecycleWindow | null;
  } = {},
): DataPlaneStatus {
  return {
    schemaVersion: 1,
    descriptor: {
      protocolVersion: 1,
      authority: 'remote',
      operator: 'seorak-managed',
      surfaces: [...SURFACES],
      credentialRequired: true,
    },
    coverage: parts.coverage === undefined ? coverage() : parts.coverage,
    lifecycle: parts.lifecycle === undefined ? lifecycle() : parts.lifecycle,
    rebaseline: null,
  };
}

describe('formatExactInstant', () => {
  it('renders a contractual date in UTC, or nothing at all', () => {
    expect(formatExactInstant('2026-09-01T00:00:00.000Z')).toBe(
      'September 1, 2026 at 12:00 AM',
    );
    expect(formatExactInstant(null)).toBeNull();
    expect(formatExactInstant('not a date')).toBeNull();
  });
});

describe('operator and plan labels', () => {
  it('never describes a self-hosted plane as metered by Seorak', () => {
    const status = managedStatus();
    status.descriptor.operator = 'self-hosted';
    status.lifecycle = null;
    expect(operatorSummary(status)).toContain('a service you operate');
    expect(operatorSummary(status)).toContain('does not meter');
    expect(planLabel(status)).toBe('Free, remote access you operate');
  });

  it('names the local machine as the thing being read', () => {
    expect(operatorSummary(localStatus())).toContain('your own computer');
    expect(planLabel(localStatus())).toBe('Free, on this computer');
  });
});

describe('completenessSummary', () => {
  it('lets the local plane claim the complete record', () => {
    expect(completenessSummary(localStatus())).toBe(
      'You are reading the complete local record.',
    );
  });

  it('lets a caught-up managed copy claim completeness with its instant', () => {
    expect(completenessSummary(managedStatus())).toBe(
      'The remote copy holds every local record, synchronized through August 1, 2026 at 12:00 PM UTC.',
    );
  });

  it('refuses completeness while a backlog is draining', () => {
    const status = managedStatus({
      coverage: coverage({
        state: 'backfilling',
        managedCopyComplete: false,
        pendingFrom: '2026-07-01T00:00:00.000Z',
        backlog: { sessions: 12, hours: 3, archives: 1 },
      }),
    });
    const summary = completenessSummary(status);
    expect(summary).toContain('This is not the complete record');
    expect(summary).toContain('on the computer that captured it');
  });

  it('refuses completeness when coverage is missing entirely', () => {
    const status = managedStatus({ coverage: null });
    expect(completenessSummary(status)).toContain('This is not the complete record');
  });

  it('will not call a surface complete that the plane does not answer', () => {
    const status = localStatus();
    status.descriptor.surfaces = ['live'];
    expect(completenessSummary(status, 'overview')).toBe(
      'This plane does not answer the dashboard, so there is nothing here to call complete.',
    );
    expect(completenessSummary(status, 'live')).toBe(
      'You are reading the complete local record.',
    );
  });
});

describe('unavailableSurfacesSummary', () => {
  it('says nothing when the plane answers everything', () => {
    expect(unavailableSurfacesSummary(localStatus())).toBeNull();
  });

  it('names missing surfaces as unavailable rather than empty', () => {
    const status = localStatus();
    status.descriptor.surfaces = ['live', 'overview', 'sessions'];
    const summary = unavailableSurfacesSummary(status);
    expect(summary).toContain('does not answer');
    expect(summary).toContain('delivery health');
    expect(summary).toContain('unavailable here, not empty');
  });

  it('reads as a sentence with exactly one missing surface', () => {
    const status = localStatus();
    status.descriptor.surfaces = SURFACES.filter(
      (surface) => surface !== 'deliveryHealth',
    );
    expect(unavailableSurfacesSummary(status)).toBe(
      'This plane does not answer delivery health. Those are unavailable here, not empty.',
    );
  });

  it('reads as a sentence in both places the integrations label is quoted', () => {
    // A label is only correct in the sentences it lands in, and there are two
    // of them with different grammar. Pinned because a surface added without
    // reading them both is exactly how a label that parses becomes prose that
    // does not.
    const status = localStatus();
    status.descriptor.surfaces = SURFACES.filter(
      (surface) => surface !== 'integrations',
    );
    expect(unavailableSurfacesSummary(status)).toBe(
      'This plane does not answer private API access. Those are unavailable here, not empty.',
    );
    expect(completenessSummary(status, 'integrations')).toBe(
      'This plane does not answer private API access, so there is nothing here to call complete.',
    );
  });
});

describe('coverageSummary', () => {
  it('reports a draining backlog with its measured counts', () => {
    const lines = coverageSummary(
      coverage({
        state: 'backfilling',
        managedCopyComplete: false,
        pendingFrom: '2026-07-01T00:00:00.000Z',
        backlog: { sessions: 12, hours: 1, archives: 1 },
      }),
    );
    expect(lines[0]).toContain('Synchronized through August 1, 2026');
    expect(lines[1]).toBe('Still to send: 12 sessions, 1 hour summary, 1 archive.');
    expect(lines.at(-1)).toContain('Your computer keeps capturing');
  });

  it('says an unmeasurable backlog is unknown rather than zero', () => {
    const lines = coverageSummary(
      coverage({
        state: 'backfilling',
        managedCopyComplete: false,
        pendingFrom: '2026-07-01T00:00:00.000Z',
        backlog: null,
      }),
    );
    expect(lines.join(' ')).toContain('cannot be measured right now');
    expect(lines.join(' ')).not.toMatch(/\b0 (sessions|archives)\b/);
  });

  it('says a copy that acknowledged nothing holds nothing', () => {
    const lines = coverageSummary(
      coverage({
        state: 'backfilling',
        synchronizedThrough: null,
        lastAcceptedAt: null,
        managedCopyComplete: false,
        pendingFrom: '2026-07-01T00:00:00.000Z',
        backlog: { sessions: 4, hours: 0, archives: 0 },
      }),
    );
    expect(lines[0]).toContain('the remote copy holds nothing so far');
  });

  it('names a coarse reason when uploads pause on the storage allowance', () => {
    const lines = coverageSummary(
      coverage({
        state: 'paused',
        managedCopyComplete: false,
        lastError: {
          reason: 'capacity',
          at: '2026-08-02T00:00:00.000Z',
          retriable: true,
        },
      }),
    );
    expect(lines[0]).toBe('Uploads are paused because of the published storage allowance.');
    expect(lines.join(' ')).toContain('Your computer keeps capturing');
  });

  it('separates a blocked copy from a paused one', () => {
    const lines = coverageSummary(
      coverage({
        state: 'blocked',
        managedCopyComplete: false,
        lastError: {
          reason: 'local-state',
          at: '2026-08-02T00:00:00.000Z',
          retriable: false,
        },
      }),
    );
    expect(lines[0]).toContain('local sync state that needs repair');
    expect(lines[0]).toContain('Retrying on its own will not clear it');
  });

  it('never prints a stand-in phrase where a measured instant belongs', () => {
    // A copy claiming completeness always has an acknowledged instant, so the
    // caught-up line must never fall back to prose that sounds like one.
    for (const state of ['current', 'backfilling', 'paused', 'blocked', 'recovery'] as const) {
      const lines = coverageSummary(
        coverage({
          state,
          synchronizedThrough: null,
          lastAcceptedAt: null,
          managedCopyComplete: false,
          pendingFrom: state === 'backfilling' ? '2026-07-01T00:00:00.000Z' : null,
          backlog:
            state === 'backfilling'
              ? { sessions: 1, hours: 0, archives: 0 }
              : { sessions: 0, hours: 0, archives: 0 },
        }),
      );
      expect(lines.join(' ')).not.toContain('an acknowledged instant');
      expect(lines.join(' ')).not.toMatch(/through\s+UTC/);
    }
  });

  it('says a deleted copy holds nothing', () => {
    const lines = coverageSummary(
      coverage({
        state: 'deleted',
        synchronizedThrough: null,
        managedCopyComplete: false,
      }),
    );
    expect(lines[0]).toBe('The managed copy has been deleted. It holds nothing.');
  });
});

describe('lifecycleSummary', () => {
  it('states both exact dates during the recovery window', () => {
    const lines = lifecycleSummary(
      lifecycle({
        phase: 'recovery',
        remoteServiceEndsAt: '2026-08-01T00:00:00.000Z',
        hostedDeletionAt: '2026-08-31T00:00:00.000Z',
        recoveryExportAvailable: true,
      }),
    );
    const text = lines.join(' ');
    expect(text).toContain('Managed service ended on August 1, 2026');
    expect(text).toContain('read-only and downloadable until August 31, 2026');
    expect(text).toContain('is deleted after that');
    expect(text).toContain('You can download the managed copy now');
    expect(text).toContain('only this computer holds the key');
    expect(text).toContain('Subscribing again before the deletion date resumes the copy');
  });

  it('never offers a download outside the recovery window', () => {
    const text = lifecycleSummary(lifecycle({ phase: 'active' })).join(' ');
    expect(text).toContain('Managed service is active');
    expect(text).toContain('Paid through September 1, 2026');
    expect(text).not.toContain('download');
  });

  it('names what stops when service is ending, and what does not', () => {
    const text = lifecycleSummary(
      lifecycle({
        phase: 'ending',
        remoteServiceEndsAt: '2026-08-15T00:00:00.000Z',
      }),
    ).join(' ');
    expect(text).toContain('Uploads, remote reads, and alerts stop on August 15, 2026');
    expect(text).toContain(
      'Local capture, history, statistics, replay, reports, export, and local alerts continue',
    );
  });

  const deleted = () =>
    lifecycle({
      phase: 'deleted',
      recoveryExportAvailable: false,
      resumesExistingCopy: false,
    });

  it('never promises a rebuild it cannot perform when the reach is unknown', () => {
    const text = lifecycleSummary(deleted()).join(' ');
    expect(text).toContain('has been deleted');
    expect(text).toContain('starts wherever that history still reaches');
    expect(text).toContain('cannot be restored from Seorak');
    // The unqualified promise the earlier draft made.
    expect(text).not.toContain('builds a fresh copy from your local history.');
    expect(text).not.toContain('download');
  });

  it('names the exact reach when local history is known to cover it', () => {
    const text = lifecycleSummary(deleted(), {
      localHistoryFrom: '2026-01-15T00:00:00.000Z',
    }).join(' ');
    expect(text).toContain('reaches back to January 15, 2026');
    expect(text).toContain('Nothing before that is restored');
  });

  it('says plainly when local history no longer reaches back', () => {
    const text = lifecycleSummary(deleted(), { localHistoryFrom: null }).join(' ');
    expect(text).toContain('no longer holds history reaching back');
    expect(text).toContain('rebuilds only from what is still on this machine');
    expect(text).toContain('exists only where you exported it');
    expect(text).not.toMatch(/reaches back to \w+ \d+, \d{4}/);
  });

  it('says plainly that nothing is hosted when there is no subscription', () => {
    const lines = lifecycleSummary(
      lifecycle({
        phase: 'none',
        paidThroughAt: null,
        resumesExistingCopy: false,
      }),
    );
    expect(lines).toEqual([
      'No managed subscription. Seorak is not hosting anything for you.',
    ]);
  });
});

describe('the copy rules that apply to every line', () => {
  const everyLine = [
    operatorSummary(localStatus()),
    operatorSummary(managedStatus()),
    completenessSummary(localStatus()),
    completenessSummary(managedStatus()),
    ...coverageSummary(coverage()),
    ...coverageSummary(coverage({ state: 'recovery', managedCopyComplete: false })),
    ...lifecycleSummary(lifecycle()),
    ...lifecycleSummary(
      lifecycle({
        phase: 'recovery',
        remoteServiceEndsAt: '2026-08-01T00:00:00.000Z',
        hostedDeletionAt: '2026-08-31T00:00:00.000Z',
        recoveryExportAvailable: true,
      }),
    ),
  ];

  it('uses no middot and never says signal', () => {
    for (const line of everyLine) {
      expect(line).not.toContain('·');
      expect(line).not.toMatch(/\bsignals?\b/i);
    }
  });

  it('never promises unlimited storage or end-to-end encryption', () => {
    for (const line of everyLine) {
      expect(line).not.toMatch(/unlimited|end-to-end/i);
    }
  });

  it('never says local data is lost, deleted, or at risk', () => {
    const localClaims = everyLine.filter((line) => /local/i.test(line));
    for (const line of localClaims) {
      expect(line).not.toMatch(/local (history|record|capture)[^.]*\b(lost|deleted|removed)\b/i);
    }
  });
});

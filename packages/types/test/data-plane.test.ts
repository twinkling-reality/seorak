import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DATA_PLANE_PROTOCOL_VERSION,
  DATA_PLANE_SURFACES,
  MANAGED_ARCHIVE_ALLOWANCE,
  MANAGED_RECOVERY_WINDOW_DAYS,
  backlogIsEmpty,
  parseControlPlaneOrigin,
  parseDataPlaneDescriptor,
  parseDataPlaneStatus,
  parseManagedLifecycleWindow,
  parseManagedSyncCoverage,
  parseRebaselineAcknowledgement,
  parseRebaselineDirective,
  planeReadsAreComplete,
  planeServes,
  remoteCopyCoversEverything,
  type DataPlaneDescriptor,
  type ManagedLifecycleWindow,
  type ManagedSyncCoverage,
  type RebaselineDirective,
} from "../src/data-plane.ts";

const NOW = "2026-08-02T12:00:00.000Z";

function localDescriptor(
  overrides: Partial<DataPlaneDescriptor> = {},
): Record<string, unknown> {
  return {
    protocolVersion: DATA_PLANE_PROTOCOL_VERSION,
    authority: "local",
    operator: "local-machine",
    surfaces: [...DATA_PLANE_SURFACES],
    credentialRequired: false,
    ...overrides,
  };
}

function managedDescriptor(
  overrides: Partial<DataPlaneDescriptor> = {},
): Record<string, unknown> {
  return {
    protocolVersion: DATA_PLANE_PROTOCOL_VERSION,
    authority: "remote",
    operator: "seorak-managed",
    surfaces: [...DATA_PLANE_SURFACES],
    credentialRequired: true,
    ...overrides,
  };
}

function coverage(
  overrides: Partial<ManagedSyncCoverage> = {},
): Record<string, unknown> {
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    state: "current",
    synchronizedThrough: "2026-08-02T11:59:00.000Z",
    pendingFrom: null,
    backlog: { sessions: 0, hours: 0, archives: 0 },
    lastAcceptedAt: "2026-08-02T11:59:30.000Z",
    lastAttemptAt: "2026-08-02T11:59:30.000Z",
    lastError: null,
    managedCopyComplete: true,
    observedAt: NOW,
    ...overrides,
  };
}

function lifecycle(
  overrides: Partial<ManagedLifecycleWindow> = {},
): Record<string, unknown> {
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    phase: "active",
    // Before the paid-through date, so the default is a live subscription. Tests
    // that move into recovery override it, because money cannot be paid through
    // a date past the one where the copy is already gone.
    paidThroughAt: "2026-07-01T00:00:00.000Z",
    remoteServiceEndsAt: null,
    hostedDeletionAt: null,
    recoveryExportAvailable: false,
    resumesExistingCopy: true,
    observedAt: NOW,
    ...overrides,
  };
}

function directive(
  overrides: Partial<RebaselineDirective> = {},
): Record<string, unknown> {
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    required: true,
    baselineEpoch: 2,
    reason: "hosted-copy-deleted",
    managedCopyEmptySince: NOW,
    issuedAt: NOW,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Descriptor                                                                 */
/* -------------------------------------------------------------------------- */

test("a local plane parses and needs no credential", () => {
  const parsed = parseDataPlaneDescriptor(localDescriptor());
  assert.ok(parsed);
  assert.equal(parsed.authority, "local");
  assert.equal(parsed.credentialRequired, false);
});

test("a local plane may not demand a credential", () => {
  assert.equal(
    parseDataPlaneDescriptor(localDescriptor({ credentialRequired: true })),
    null,
  );
});

test("a local plane may not be operated by anyone else", () => {
  assert.equal(
    parseDataPlaneDescriptor(localDescriptor({ operator: "seorak-managed" })),
    null,
  );
  assert.equal(
    parseDataPlaneDescriptor(localDescriptor({ operator: "self-hosted" })),
    null,
  );
});

test("a remote plane may not claim to be the local machine", () => {
  assert.equal(
    parseDataPlaneDescriptor(
      managedDescriptor({ operator: "local-machine" }),
    ),
    null,
  );
});

test("a self-hosted remote plane is a first-class descriptor", () => {
  const parsed = parseDataPlaneDescriptor(
    managedDescriptor({ operator: "self-hosted" }),
  );
  assert.ok(parsed);
  assert.equal(parsed.operator, "self-hosted");
});

test("descriptor surfaces are a closed, unique, non-empty set", () => {
  assert.equal(parseDataPlaneDescriptor(localDescriptor({ surfaces: [] })), null);
  assert.equal(
    parseDataPlaneDescriptor(
      localDescriptor({ surfaces: ["overview", "overview"] as never }),
    ),
    null,
  );
  assert.equal(
    parseDataPlaneDescriptor(localDescriptor({ surfaces: ["billing"] as never })),
    null,
  );
});

test("descriptor rejects unknown and missing keys", () => {
  assert.equal(
    parseDataPlaneDescriptor({ ...localDescriptor(), extra: 1 }),
    null,
  );
  const { operator: _dropped, ...withoutOperator } = localDescriptor();
  assert.equal(parseDataPlaneDescriptor(withoutOperator), null);
});

test("a descriptor with no control plane names none", () => {
  const parsed = parseDataPlaneDescriptor(localDescriptor());
  assert.ok(parsed);
  assert.equal("controlPlaneUrl" in parsed, false);
  assert.equal(parsed.controlPlaneUrl, undefined);
});

test("a plane may name the account origin its surfaces navigate to", () => {
  const parsed = parseDataPlaneDescriptor(
    managedDescriptor({ controlPlaneUrl: "https://control.example" }),
  );
  assert.ok(parsed);
  assert.equal(parsed.controlPlaneUrl, "https://control.example");
});

test("a local plane may name one too, because a paid install reads locally", () => {
  const parsed = parseDataPlaneDescriptor(
    localDescriptor({ controlPlaneUrl: "https://control.example" }),
  );
  assert.ok(parsed);
  assert.equal(parsed.controlPlaneUrl, "https://control.example");
});

test("a malformed control plane origin refuses the whole descriptor", () => {
  for (const bad of [
    "",
    "not a url",
    "http://control.example",
    "https://user:pw@control.example",
    "https://control.example/oauth/start/apple",
    "https://control.example/?next=elsewhere",
    "https://control.example/#fragment",
    "javascript:alert(1)",
    null,
    42,
  ]) {
    assert.equal(
      parseDataPlaneDescriptor(managedDescriptor({ controlPlaneUrl: bad as never })),
      null,
      `expected refusal for ${JSON.stringify(bad)}`,
    );
  }
});

test("a control plane origin keeps only scheme, host, and port", () => {
  assert.equal(
    parseControlPlaneOrigin("https://control.example/"),
    "https://control.example",
  );
  assert.equal(
    parseControlPlaneOrigin("https://control.example:8443/"),
    "https://control.example:8443",
  );
  // Loopback over http is the development and self-hosted control plane.
  assert.equal(
    parseControlPlaneOrigin("http://127.0.0.1:8790/"),
    "http://127.0.0.1:8790",
  );
  assert.equal(
    parseControlPlaneOrigin("http://localhost:8790/"),
    "http://localhost:8790",
  );
  assert.equal(parseControlPlaneOrigin("http://192.168.1.4:8790/"), null);
});

/* -------------------------------------------------------------------------- */
/* Coverage                                                                   */
/* -------------------------------------------------------------------------- */

test("a caught-up managed copy may claim completeness", () => {
  const parsed = parseManagedSyncCoverage(coverage());
  assert.ok(parsed);
  assert.equal(parsed.managedCopyComplete, true);
  assert.equal(remoteCopyCoversEverything(parsed), true);
});

test("completeness requires a measured empty backlog", () => {
  assert.equal(parseManagedSyncCoverage(coverage({ backlog: null })), null);
  assert.equal(
    parseManagedSyncCoverage(
      coverage({ backlog: { sessions: 3, hours: 0, archives: 0 } }),
    ),
    null,
  );
});

test("completeness requires an acknowledged instant", () => {
  assert.equal(
    parseManagedSyncCoverage(coverage({ synchronizedThrough: null })),
    null,
  );
});

test("completeness requires nothing still pending", () => {
  assert.equal(
    parseManagedSyncCoverage(coverage({ pendingFrom: NOW })),
    null,
  );
});

test("only a caught-up state may claim completeness", () => {
  for (const state of ["backfilling", "paused", "blocked", "recovery"] as const) {
    assert.equal(
      parseManagedSyncCoverage(coverage({ state })),
      null,
      `${state} must not claim a complete managed copy`,
    );
  }
});

test("partial coverage parses and reports itself as partial", () => {
  const parsed = parseManagedSyncCoverage(
    coverage({
      state: "backfilling",
      backlog: { sessions: 412, hours: 30, archives: 7 },
      pendingFrom: "2026-05-01T00:00:00.000Z",
      managedCopyComplete: false,
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.managedCopyComplete, false);
  assert.equal(remoteCopyCoversEverything(parsed), false);
  assert.equal(backlogIsEmpty(parsed.backlog), false);
});

test("backfilling with an empty backlog is a contradiction", () => {
  assert.equal(
    parseManagedSyncCoverage(
      coverage({ state: "backfilling", managedCopyComplete: false }),
    ),
    null,
  );
});

test("an unmeasurable backlog stays null rather than zero-filled", () => {
  const parsed = parseManagedSyncCoverage(
    coverage({
      state: "blocked",
      backlog: null,
      managedCopyComplete: false,
      lastError: { reason: "local-state", at: NOW, retriable: false },
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.backlog, null);
  assert.equal(remoteCopyCoversEverything(parsed), false);
});

test("a stopped state must record why it stopped", () => {
  // `blocked` asserts that retrying will not help, which is an actionable claim
  // the payload has to substantiate. `paused` names a retriable condition.
  for (const state of ["paused", "blocked"] as const) {
    assert.equal(
      parseManagedSyncCoverage(
        coverage({ state, backlog: null, managedCopyComplete: false, lastError: null }),
      ),
      null,
      `${state} without a recorded reason leaves a surface unable to explain itself`,
    );
  }
});

test("nothing can be observed after the moment of observation", () => {
  const beyond = "2099-01-01T00:00:00.000Z";
  for (const field of [
    "synchronizedThrough",
    "pendingFrom",
    "lastAcceptedAt",
    "lastAttemptAt",
  ] as const) {
    assert.equal(
      parseManagedSyncCoverage(
        coverage({ [field]: beyond, managedCopyComplete: false, state: "paused",
          lastError: { reason: "network", at: NOW, retriable: true } } as never),
      ),
      null,
      `${field} in the future is the completeness overclaim spelled as a timestamp`,
    );
  }
});

test("a never-connected plane cannot have acknowledged anything", () => {
  assert.equal(
    parseManagedSyncCoverage(
      coverage({ state: "not-connected", managedCopyComplete: false }),
    ),
    null,
  );
  const parsed = parseManagedSyncCoverage(
    coverage({
      state: "not-connected",
      synchronizedThrough: null,
      lastAcceptedAt: null,
      backlog: null,
      managedCopyComplete: false,
    }),
  );
  assert.ok(parsed);
});

test("a deleted managed copy holds nothing", () => {
  assert.equal(
    parseManagedSyncCoverage(
      coverage({ state: "deleted", managedCopyComplete: false }),
    ),
    null,
  );
  const parsed = parseManagedSyncCoverage(
    coverage({
      state: "deleted",
      synchronizedThrough: null,
      pendingFrom: "2026-01-01T00:00:00.000Z",
      backlog: null,
      managedCopyComplete: false,
    }),
  );
  assert.ok(parsed);
});

test("a sync error carries a coarse reason, never provider prose", () => {
  const parsed = parseManagedSyncCoverage(
    coverage({
      state: "paused",
      managedCopyComplete: false,
      lastError: { reason: "capacity", at: NOW, retriable: true },
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.lastError?.reason, "capacity");
  assert.equal(
    parseManagedSyncCoverage(
      coverage({
        state: "paused",
        managedCopyComplete: false,
        lastError: { reason: "D1 overloaded", at: NOW, retriable: true },
      }),
    ),
    null,
  );
});

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

test("an active subscription parses", () => {
  const parsed = parseManagedLifecycleWindow(lifecycle());
  assert.ok(parsed);
  assert.equal(parsed.phase, "active");
  assert.equal(parsed.recoveryExportAvailable, false);
});

test("the never-subscribed phase carries no dates or promises", () => {
  const parsed = parseManagedLifecycleWindow(
    lifecycle({
      phase: "none",
      paidThroughAt: null,
      resumesExistingCopy: false,
    }),
  );
  assert.ok(parsed);
  assert.equal(
    parseManagedLifecycleWindow(lifecycle({ phase: "none" })),
    null,
    "a never-subscribed home cannot resume an existing copy",
  );
});

test("recovery names both exact dates the customer was told to expect", () => {
  const parsed = parseManagedLifecycleWindow(
    lifecycle({
      phase: "recovery",
      remoteServiceEndsAt: "2026-08-01T00:00:00.000Z",
      hostedDeletionAt: "2026-08-31T00:00:00.000Z",
      recoveryExportAvailable: true,
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.recoveryExportAvailable, true);
  assert.equal(parsed.resumesExistingCopy, true);

  assert.equal(
    parseManagedLifecycleWindow(
      lifecycle({
        phase: "recovery",
        remoteServiceEndsAt: "2026-08-01T00:00:00.000Z",
        hostedDeletionAt: null,
        recoveryExportAvailable: true,
      }),
    ),
    null,
  );
});

test("the parser enforces the documented recovery-window length", () => {
  const endsAt = "2026-08-01T00:00:00.000Z";
  const windowed = (deletionAt: string): unknown =>
    parseManagedLifecycleWindow(
      lifecycle({
        phase: "recovery",
        remoteServiceEndsAt: endsAt,
        hostedDeletionAt: deletionAt,
        recoveryExportAvailable: true,
      }),
    );

  const exact = new Date(
    Date.parse(endsAt) + MANAGED_RECOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  assert.ok(windowed(exact), "the documented window must parse");

  // Ordering alone is satisfied by one second. A customer told they have 30
  // days to retrieve their data must actually have them.
  assert.equal(windowed("2026-08-01T00:00:01.000Z"), null);
  assert.equal(windowed("2026-08-29T00:00:00.000Z"), null);
  // Both dates are shown exactly, so an undocumented longer window is also a
  // surprise rather than a kindness.
  assert.equal(windowed("2026-10-01T00:00:00.000Z"), null);
});

test("money cannot be paid through a date past the deletion", () => {
  assert.equal(
    parseManagedLifecycleWindow(
      lifecycle({
        phase: "recovery",
        paidThroughAt: "2099-01-01T00:00:00.000Z",
        remoteServiceEndsAt: "2026-08-01T00:00:00.000Z",
        hostedDeletionAt: "2026-08-31T00:00:00.000Z",
        recoveryExportAvailable: true,
      }),
    ),
    null,
  );
});

test("only recovery may offer a managed export", () => {
  for (const phase of ["active", "grace", "ending", "deleted"] as const) {
    assert.equal(
      parseManagedLifecycleWindow(
        lifecycle({
          phase,
          remoteServiceEndsAt: "2026-08-01T00:00:00.000Z",
          hostedDeletionAt: "2026-08-31T00:00:00.000Z",
          recoveryExportAvailable: true,
          resumesExistingCopy: phase !== "deleted",
        }),
      ),
      null,
      `${phase} must not advertise a recovery export`,
    );
  }
});

test("after deletion nothing can be resumed or exported", () => {
  const parsed = parseManagedLifecycleWindow(
    lifecycle({
      phase: "deleted",
      remoteServiceEndsAt: "2026-08-01T00:00:00.000Z",
      hostedDeletionAt: "2026-08-31T00:00:00.000Z",
      recoveryExportAvailable: false,
      resumesExistingCopy: false,
    }),
  );
  assert.ok(parsed);
  assert.equal(
    parseManagedLifecycleWindow(
      lifecycle({
        phase: "deleted",
        remoteServiceEndsAt: "2026-08-01T00:00:00.000Z",
        hostedDeletionAt: "2026-08-31T00:00:00.000Z",
        resumesExistingCopy: true,
      }),
    ),
    null,
  );
});

test("deletion cannot precede the end of service", () => {
  assert.equal(
    parseManagedLifecycleWindow(
      lifecycle({
        phase: "recovery",
        remoteServiceEndsAt: "2026-08-31T00:00:00.000Z",
        hostedDeletionAt: "2026-08-01T00:00:00.000Z",
        recoveryExportAvailable: true,
      }),
    ),
    null,
  );
});

/* -------------------------------------------------------------------------- */
/* Rebaseline                                                                 */
/* -------------------------------------------------------------------------- */

test("a rebaseline directive names a reason and a monotonic epoch", () => {
  const parsed = parseRebaselineDirective(directive());
  assert.ok(parsed);
  assert.equal(parsed.baselineEpoch, 2);
  assert.equal(parsed.reason, "hosted-copy-deleted");
});

test("a directive without a reason is not a directive", () => {
  assert.equal(parseRebaselineDirective(directive({ reason: null })), null);
  assert.equal(
    parseRebaselineDirective(directive({ required: false })),
    null,
    "a reason with no requirement would narrate a reset that is not happening",
  );
});

test("the inert directive is representable", () => {
  const parsed = parseRebaselineDirective(
    directive({
      required: false,
      reason: null,
      baselineEpoch: 0,
      managedCopyEmptySince: null,
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.required, false);
});

test("a required directive cannot sit at the zero epoch", () => {
  assert.equal(parseRebaselineDirective(directive({ baselineEpoch: 0 })), null);
});

test("an acknowledgement proves the reset happened", () => {
  const parsed = parseRebaselineAcknowledgement({
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    baselineEpoch: 2,
    installationId: "install-abc",
    checkpointsReset: true,
    localHistoryFrom: "2026-01-01T00:00:00.000Z",
    acknowledgedAt: NOW,
  });
  assert.ok(parsed);
  assert.equal(parsed.checkpointsReset, true);
});

test("an acknowledgement that did not reset checkpoints is refused", () => {
  assert.equal(
    parseRebaselineAcknowledgement({
      schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
      baselineEpoch: 2,
      installationId: "install-abc",
      checkpointsReset: false,
      localHistoryFrom: null,
      acknowledgedAt: NOW,
    }),
    null,
  );
});

test("missing local history is acknowledged honestly, not hidden", () => {
  const parsed = parseRebaselineAcknowledgement({
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    baselineEpoch: 3,
    installationId: "install-abc",
    checkpointsReset: true,
    localHistoryFrom: null,
    acknowledgedAt: NOW,
  });
  assert.ok(parsed);
  assert.equal(parsed.localHistoryFrom, null);
});

/* -------------------------------------------------------------------------- */
/* Composite status                                                           */
/* -------------------------------------------------------------------------- */

test("a Free local plane carries no coverage, lifecycle, or directive", () => {
  const parsed = parseDataPlaneStatus({
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: localDescriptor(),
    coverage: null,
    lifecycle: null,
    rebaseline: null,
  });
  assert.ok(parsed);
  assert.equal(planeReadsAreComplete(parsed, "overview"), true);
});

test("completeness is asked per surface, never of the plane as a whole", () => {
  const parsed = parseDataPlaneStatus({
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: localDescriptor({ surfaces: ["overview"] }),
    coverage: null,
    lifecycle: null,
    rebaseline: null,
  });
  assert.ok(parsed);
  assert.equal(planeServes(parsed, "overview"), true);
  assert.equal(planeServes(parsed, "interventions"), false);
  assert.equal(planeReadsAreComplete(parsed, "overview"), true);
  // A plane that does not answer a surface cannot be complete for it. Local
  // authority over raw history says nothing about a surface it does not serve.
  assert.equal(planeReadsAreComplete(parsed, "interventions"), false);
});

test("local reads are complete even while a managed backlog drains", () => {
  const parsed = parseDataPlaneStatus({
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: localDescriptor(),
    coverage: coverage({
      state: "backfilling",
      backlog: { sessions: 90, hours: 12, archives: 2 },
      pendingFrom: "2026-06-01T00:00:00.000Z",
      managedCopyComplete: false,
    }),
    lifecycle: null,
    rebaseline: null,
  });
  assert.ok(parsed);
  assert.equal(planeReadsAreComplete(parsed, "overview"), true);
  assert.equal(remoteCopyCoversEverything(parsed.coverage), false);
});

test("a managed plane mid-backfill is not a complete read", () => {
  const parsed = parseDataPlaneStatus({
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: managedDescriptor(),
    coverage: coverage({
      state: "backfilling",
      backlog: { sessions: 90, hours: 12, archives: 2 },
      pendingFrom: "2026-06-01T00:00:00.000Z",
      managedCopyComplete: false,
    }),
    lifecycle: lifecycle(),
    rebaseline: null,
  });
  assert.ok(parsed);
  assert.equal(planeReadsAreComplete(parsed, "overview"), false);
});

test("a lapsed subscriber reading locally can still see the deletion date", () => {
  // The local plane is the default authority for every install including Pro,
  // so this is the surface someone is actually looking at when the countdown
  // matters most. Refusing the window here would make the single most important
  // thing to tell that person unrepresentable.
  const parsed = parseDataPlaneStatus({
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: localDescriptor(),
    coverage: coverage({
      state: "recovery",
      managedCopyComplete: false,
      backlog: null,
      pendingFrom: "2026-07-15T00:00:00.000Z",
    }),
    lifecycle: lifecycle({
      phase: "recovery",
      paidThroughAt: "2026-08-01T00:00:00.000Z",
      remoteServiceEndsAt: "2026-08-01T00:00:00.000Z",
      hostedDeletionAt: "2026-08-31T00:00:00.000Z",
      recoveryExportAvailable: true,
    }),
    rebaseline: null,
  });
  assert.ok(parsed);
  assert.equal(parsed.lifecycle?.hostedDeletionAt, "2026-08-31T00:00:00.000Z");
  assert.equal(parsed.lifecycle?.recoveryExportAvailable, true);
  // And the local record itself is still complete throughout.
  assert.equal(planeReadsAreComplete(parsed, "overview"), true);
});

test("a lifecycle phase past none must come with observed coverage", () => {
  assert.equal(
    parseDataPlaneStatus({
      schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
      descriptor: localDescriptor(),
      coverage: null,
      lifecycle: lifecycle({ phase: "active" }),
      rebaseline: null,
    }),
    null,
  );
});

test("a self-hosted plane can never describe a billing window", () => {
  assert.equal(
    parseDataPlaneStatus({
      schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
      descriptor: managedDescriptor({ operator: "self-hosted" }),
      coverage: coverage(),
      lifecycle: lifecycle(),
      rebaseline: null,
    }),
    null,
  );
});

test("a self-hosted plane still reports sync coverage", () => {
  const parsed = parseDataPlaneStatus({
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: managedDescriptor({ operator: "self-hosted" }),
    coverage: coverage(),
    lifecycle: null,
    rebaseline: null,
  });
  assert.ok(parsed);
  assert.equal(parsed.lifecycle, null);
  assert.equal(remoteCopyCoversEverything(parsed.coverage), true);
});

test("a rebaseline directive needs coverage saying what there is to rebuild", () => {
  assert.equal(
    parseDataPlaneStatus({
      schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
      descriptor: localDescriptor(),
      coverage: null,
      lifecycle: null,
      rebaseline: directive(),
    }),
    null,
  );
  // The collector acts on the directive and reads its own local plane, so the
  // local plane relays it. What it may not do is narrate a rebuild with no
  // observed sync relationship beside it.
  const parsed = parseDataPlaneStatus({
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: localDescriptor(),
    coverage: coverage({
      state: "deleted",
      synchronizedThrough: null,
      backlog: null,
      managedCopyComplete: false,
      pendingFrom: "2026-01-01T00:00:00.000Z",
    }),
    lifecycle: null,
    rebaseline: directive(),
  });
  assert.ok(parsed);
  assert.equal(parsed.rebaseline?.reason, "hosted-copy-deleted");
});

test("a self-hosted plane is never metered and never rebaselined by Seorak", () => {
  for (const extra of [
    { lifecycle: lifecycle(), rebaseline: null },
    { lifecycle: null, rebaseline: directive() },
  ]) {
    assert.equal(
      parseDataPlaneStatus({
        schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
        descriptor: managedDescriptor({ operator: "self-hosted" }),
        coverage: coverage(),
        ...extra,
      }),
      null,
    );
  }
});

test("a malformed nested member fails the whole status", () => {
  assert.equal(
    parseDataPlaneStatus({
      schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
      descriptor: managedDescriptor(),
      coverage: coverage({ state: "nonsense" as never }),
      lifecycle: lifecycle(),
      rebaseline: null,
    }),
    null,
  );
});

/* -------------------------------------------------------------------------- */
/* Published allowance                                                        */
/* -------------------------------------------------------------------------- */

test("the managed archive allowance is a finite published number", () => {
  assert.ok(Number.isSafeInteger(MANAGED_ARCHIVE_ALLOWANCE.monthlyUploadBytes));
  assert.ok(Number.isSafeInteger(MANAGED_ARCHIVE_ALLOWANCE.retainedBytes));
  assert.ok(MANAGED_ARCHIVE_ALLOWANCE.monthlyUploadBytes > 0);
  assert.ok(
    MANAGED_ARCHIVE_ALLOWANCE.retainedBytes >
      MANAGED_ARCHIVE_ALLOWANCE.monthlyUploadBytes,
  );
});

/*
 * "The allowance equals the budget the cost model actually prices" used to be
 * asserted here, by reading `scripts/hosted-cost-model.mjs` as TEXT and
 * scraping `HARD_PER_HOME_BUDGETS` out of it with a regular expression.
 *
 * It is asserted on the OTHER SIDE of that edge instead, in
 * `scripts/hosted-cost-model.test.mjs`, which imports both this constant and
 * the budgets and compares them as values: `allowance.monthlyUploadGb ===
 * HARD_PER_HOME_BUDGETS.newArchiveGb`, and the same for the retained cap. Same
 * invariant, no regex, and the arrow points the way ADR 005 decision 1 says
 * every boundary-crossing arrow points: the private cost model reads the public
 * contract, not the reverse. The cost model is private, so this file was the
 * one thing in @seorak/types that could not run in the public core.
 */

/**
 * Plan and managed-copy copy, derived from the shared data-plane contract.
 *
 * Two rules run through every sentence here:
 *
 * 1. A partial managed copy is never described as complete. The only
 *    completeness answers come from `planeReadsAreComplete` and
 *    `remoteCopyCoversEverything`; this module never re-derives them.
 * 2. Nothing local is ever at risk. Every managed transition says what stops,
 *    and every one of them says the local record continues.
 *
 * Unmeasured values stay unmeasured: a null backlog reads as unknown, never as
 * zero, and a copy that has acknowledged nothing covers nothing rather than
 * covering the beginning of time.
 */

import {
  DATA_PLANE_SURFACES,
  planeReadsAreComplete,
  planeServes,
  remoteCopyCoversEverything,
  type DataPlaneStatus,
  type DataPlaneSurface,
  type ManagedLifecycleWindow,
  type ManagedSyncCoverage,
  type ManagedSyncErrorReason,
} from '@seorak/types/data-plane';

/**
 * The read this section speaks for. Completeness is per-surface in the shared
 * contract, so a summary has to name the surface it is answering about rather
 * than implying one answer covers the plane.
 */
export const PLAN_SUMMARY_SURFACE: DataPlaneSurface = 'overview';

const SURFACE_LABELS: Record<DataPlaneSurface, string> = {
  live: 'live sessions',
  overview: 'the dashboard',
  sessions: 'session history',
  session: 'session detail',
  sessionOutcome: 'session outcomes',
  replay: 'replay',
  interventions: 'watches',
  settings: 'settings',
  developerModel: 'the developer model',
  deliveryHealth: 'delivery health',
  publication: 'public presence',
  integrations: 'private API access',
};

/**
 * An exact instant, in UTC so it reads the same everywhere it is quoted. These
 * are contractual dates a customer was told to expect, not relative timings.
 */
export function formatExactInstant(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(parsed);
}

/** Who runs the plane this dashboard is reading. */
export function operatorSummary(status: DataPlaneStatus): string {
  switch (status.descriptor.operator) {
    case 'local-machine':
      return 'This dashboard reads your own computer. No account, and nothing is uploaded.';
    case 'self-hosted':
      return 'This dashboard reads a service you operate. Seorak does not meter, cap, or bill a service it does not run.';
    case 'seorak-managed':
      return 'Seorak operates the service this dashboard reads.';
  }
}

/**
 * Whether what is on screen is the whole record. The local plane can say yes
 * unconditionally because it holds the authoritative raw history; a remote
 * plane has to have measured it.
 */
export function completenessSummary(
  status: DataPlaneStatus,
  surface: DataPlaneSurface = PLAN_SUMMARY_SURFACE,
): string {
  if (!planeServes(status, surface)) {
    return `This plane does not answer ${SURFACE_LABELS[surface]}, so there is nothing here to call complete.`;
  }
  if (status.descriptor.authority === 'local') {
    return 'You are reading the complete local record.';
  }
  if (planeReadsAreComplete(status, surface)) {
    const through = formatExactInstant(status.coverage?.synchronizedThrough ?? null);
    return through
      ? `The remote copy holds every local record, synchronized through ${through} UTC.`
      : 'The remote copy holds every local record.';
  }
  return 'This is not the complete record. The complete history is on the computer that captured it.';
}

/**
 * Surfaces this plane does not answer. Absent is not empty: a surface missing
 * from the descriptor has to be named as unavailable rather than rendered as a
 * measured zero somewhere else in the app.
 */
export function unavailableSurfaces(status: DataPlaneStatus): DataPlaneSurface[] {
  return DATA_PLANE_SURFACES.filter((surface) => !planeServes(status, surface));
}

export function unavailableSurfacesSummary(status: DataPlaneStatus): string | null {
  const missing = unavailableSurfaces(status);
  if (missing.length === 0) return null;
  const labels = missing.map((surface) => SURFACE_LABELS[surface]);
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  return `This plane does not answer ${list}. Those are unavailable here, not empty.`;
}

function reasonPhrase(reason: ManagedSyncErrorReason): string {
  switch (reason) {
    case 'network':
      return 'a network problem';
    case 'authority':
      return 'an authorization problem';
    case 'service-unavailable':
      return 'the service being unavailable';
    case 'capacity':
      return 'the published storage allowance';
    case 'protocol':
      return 'a protocol mismatch';
    case 'local-state':
      return 'local sync state that needs repair';
  }
}

function backlogPhrase(coverage: ManagedSyncCoverage): string {
  if (coverage.backlog === null) {
    return 'How much is left to send cannot be measured right now.';
  }
  const parts = [
    `${coverage.backlog.sessions} session${coverage.backlog.sessions === 1 ? '' : 's'}`,
    `${coverage.backlog.hours} hour summar${coverage.backlog.hours === 1 ? 'y' : 'ies'}`,
    `${coverage.backlog.archives} archive${coverage.backlog.archives === 1 ? '' : 's'}`,
  ];
  return `Still to send: ${parts.join(', ')}.`;
}

/** What the remote copy actually holds, stated as measurement, not reassurance. */
export function coverageSummary(coverage: ManagedSyncCoverage): string[] {
  const through = formatExactInstant(coverage.synchronizedThrough);
  const lines: string[] = [];

  switch (coverage.state) {
    case 'not-connected':
      lines.push('No remote copy is configured, so nothing has been uploaded.');
      return lines;
    case 'backfilling':
      lines.push(
        through
          ? `Uploading earlier history. Synchronized through ${through} UTC.`
          : 'Uploading earlier history. Nothing has been acknowledged yet, so the remote copy holds nothing so far.',
      );
      lines.push(backlogPhrase(coverage));
      break;
    case 'current':
      // The completeness claim is gated on an instant that exists, not on a
      // phrase that stands in for one. `parseManagedSyncCoverage` already
      // refuses completeness without an acknowledged instant, so `through` is
      // non-null here; requiring it structurally means that if the guarantee
      // ever weakened, this falls to the honest branch instead of printing a
      // sentence that sounds measured and is not.
      lines.push(
        remoteCopyCoversEverything(coverage) && through
          ? `Caught up. Synchronized through ${through} UTC.`
          : `Caught up as of the last check, but the copy is not confirmed complete.${
              through ? ` Synchronized through ${through} UTC.` : ''
            }`,
      );
      break;
    case 'paused':
      lines.push(
        `Uploads are paused because of ${
          coverage.lastError ? reasonPhrase(coverage.lastError.reason) : 'a condition that should clear'
        }.`,
      );
      if (through) lines.push(`Synchronized through ${through} UTC.`);
      break;
    case 'blocked':
      lines.push(
        `Uploads need attention because of ${
          coverage.lastError ? reasonPhrase(coverage.lastError.reason) : 'a condition that needs repair'
        }. Retrying on its own will not clear it.`,
      );
      if (through) lines.push(`Synchronized through ${through} UTC.`);
      break;
    case 'recovery':
      lines.push('Managed service has ended. The managed copy is read-only.');
      if (through) lines.push(`It holds your history through ${through} UTC.`);
      break;
    case 'deleted':
      lines.push('The managed copy has been deleted. It holds nothing.');
      break;
  }

  lines.push('Your computer keeps capturing and reading everything, either way.');
  return lines;
}

/**
 * How far the local record still reaches, when that is known.
 *
 * This mirrors `RebaselineAcknowledgement.localHistoryFrom`, which is nullable
 * for exactly this reason: the collector reports what it can actually resend,
 * and null means local history no longer reaches back. `undefined` is a third
 * state and it matters here, because the lifecycle window alone does not carry
 * this fact. Unknown must not be narrated as either outcome.
 */
export interface LocalHistoryReach {
  /** ISO instant local history reaches back to, or null when it does not. */
  localHistoryFrom?: string | null;
}

/** The exact dates a customer was promised, and what each one does. */
export function lifecycleSummary(
  lifecycle: ManagedLifecycleWindow,
  reach: LocalHistoryReach = {},
): string[] {
  const paidThrough = formatExactInstant(lifecycle.paidThroughAt);
  const serviceEnds = formatExactInstant(lifecycle.remoteServiceEndsAt);
  const deletion = formatExactInstant(lifecycle.hostedDeletionAt);
  const lines: string[] = [];

  switch (lifecycle.phase) {
    case 'none':
      lines.push('No managed subscription. Seorak is not hosting anything for you.');
      return lines;
    case 'active':
      lines.push('Managed service is active.');
      if (paidThrough) lines.push(`Paid through ${paidThrough} UTC.`);
      break;
    case 'grace':
      lines.push('A payment did not go through. Managed service is still running.');
      if (serviceEnds) lines.push(`It stops on ${serviceEnds} UTC unless payment succeeds.`);
      break;
    case 'ending':
      lines.push('Managed service is set to end and has not ended yet.');
      if (serviceEnds) lines.push(`Uploads, remote reads, and alerts stop on ${serviceEnds} UTC.`);
      break;
    case 'recovery':
      lines.push(
        serviceEnds
          ? `Managed service ended on ${serviceEnds} UTC. Uploads, remote reads, and alerts have stopped.`
          : 'Managed service has ended. Uploads, remote reads, and alerts have stopped.',
      );
      if (deletion) {
        lines.push(
          `The managed copy is read-only and downloadable until ${deletion} UTC, and is deleted after that.`,
        );
      }
      break;
    case 'deleted':
      lines.push('The managed copy has been deleted.');
      // A rebuild can only resend what the local record still holds. Promising
      // "a fresh copy from your local history" without that qualifier claims a
      // recovery Seorak cannot perform when the history no longer reaches back.
      if (reach.localHistoryFrom === undefined) {
        lines.push(
          'A new subscription rebuilds it from your local history, and the rebuilt copy starts wherever that history still reaches. Anything your computer no longer holds cannot be restored from Seorak.',
        );
      } else if (reach.localHistoryFrom === null) {
        lines.push(
          'Your computer no longer holds history reaching back to the start of the deleted copy. A new subscription rebuilds only from what is still on this machine, and the earlier record exists only where you exported it.',
        );
      } else {
        const from = formatExactInstant(reach.localHistoryFrom);
        lines.push(
          from
            ? `A new subscription rebuilds it from your local history, which reaches back to ${from} UTC. Nothing before that is restored.`
            : 'A new subscription rebuilds it from your local history, and the rebuilt copy starts wherever that history still reaches.',
        );
      }
      break;
  }

  if (lifecycle.recoveryExportAvailable) {
    lines.push('You can download the managed copy now. Archive files are encrypted, and only this computer holds the key that opens them.');
  }
  if (lifecycle.resumesExistingCopy && lifecycle.phase !== 'active') {
    lines.push('Subscribing again before the deletion date resumes the copy that already exists.');
  }
  lines.push(
    'Local capture, history, statistics, replay, reports, export, and local alerts continue on every plan.',
  );
  return lines;
}

/** The plan label. Deliberately not a claim about what a plan may buy. */
export function planLabel(status: DataPlaneStatus): string {
  if (status.descriptor.operator === 'seorak-managed') {
    return status.lifecycle?.phase === 'active' ? 'Pro, operated by Seorak' : 'Managed';
  }
  return status.descriptor.operator === 'self-hosted'
    ? 'Free, remote access you operate'
    : 'Free, on this computer';
}

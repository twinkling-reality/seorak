/**
 * Types for the overview polling subsystem. Single /overview source — no team
 * context, no dashboard/context split, no WebSocket bridge (overview is
 * polling-only).
 */

import type { Intervention, OverviewSnapshot, SessionSummary } from '../apiSchemas.js';
import type { HostedGate } from '../hostedGate.js';

export type DataStatus = 'idle' | 'loading' | 'ready' | 'stale' | 'error';

export interface PollingState {
  overviewData: OverviewSnapshot | null;
  overviewStatus: DataStatus;
  /** Fired interventions from GET /interventions, polled alongside /overview.
   *  `[]` means nothing fired only when interventionsStatus is `ready`. */
  interventions: Intervention[];
  interventionsStatus: DataStatus;
  pollError: string | null;
  /** The cell answered 402: this owner's plan does not include the capability
   *  the read needs. Deliberately NOT `pollError` — a plan gate is a settled
   *  answer, not a failure, and rendering it as one told a first-time Free
   *  signup their product was broken. Cleared only when a read succeeds. */
  hostedGate: HostedGate | null;
  lastUpdate: Date | null;
  /** Consecutive API failures — drives slow-mode polling at 3+. */
  consecutiveFailures: number;
  /** Fresh live-session board from GET /live, polled on its OWN adaptive cadence
   *  (fast while a session is live, slow when idle) so the board feels live
   *  without polling the heavy /overview body fast (DATA-LAYER §ADR-002/006).
   *  `null` until the first /live lands — the board falls back to overview.live
   *  until then, so it is never empty on first paint. */
  liveSessions: SessionSummary[] | null;
  /** Server compute time of the last /live response — the "updated N ago" source. */
  liveGeneratedAt: string | null;
  liveStatus: DataStatus;
}

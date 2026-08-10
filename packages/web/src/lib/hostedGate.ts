/**
 * Telling a plan gate apart from a breakage.
 *
 * A hosted cell answers 402 with the capability the owner has not bought, and
 * the dashboard used to render that as "Could not load your overview" over a
 * raw `402`. A first-time Free signup was therefore told their product is
 * broken at the exact moment they were actually being told what Pro adds — and
 * because it climbed the failure ladder like an outage, the poll loop kept
 * asking a question whose answer cannot change until the plan does.
 *
 * Free is complete and local-first by design (docs/VISION.md). Nothing here
 * implies the owner has lost anything: every local capability is untouched, and
 * the only thing behind this gate is the cell reading their history remotely.
 */

/** One hosted capability, exactly as `@seorak/types` names it on the wire. */
export interface HostedGate {
  capability: string;
  title: string;
  hint: string;
}

/** Copy per capability. The KEY IS THE WIRE VALUE, so an unrecognised one falls
 *  back to a true sentence rather than a blank or a guess. */
const CAPABILITY_COPY: Record<string, { title: string; hint: string }> = {
  remoteVisibility: {
    title: 'Reading your history here is a Pro capability',
    hint: 'Your sessions are still captured and complete on this computer. Pro adds reading them from anywhere — this dashboard and your phone.',
  },
  managedSync: {
    title: 'Managed sync is a Pro capability',
    hint: 'Capture keeps running locally. Pro adds keeping this cell in step with your computers.',
  },
  hostedReplay: {
    title: 'Replay from the cell is a Pro capability',
    hint: 'Replay still works locally against your own event log. Pro adds replaying from the hosted copy.',
  },
  pushNotifications: {
    title: 'Away alerts are a Pro capability',
    hint: 'Your stats are unchanged. Pro adds telling you about them while you are away from the keyboard.',
  },
  liveActivities: {
    title: 'Live Activities are a Pro capability',
    hint: 'Your stats are unchanged. Pro adds a live session on your phone lock screen.',
  },
  interventionAlerts: {
    title: 'Nudges are a Pro capability',
    hint: 'Seorak still measures every session. Pro adds acting on what it measured.',
  },
};

function copyFor(capability: string): { title: string; hint: string } {
  return (
    CAPABILITY_COPY[capability] ?? {
      title: 'This is a Pro capability',
      hint: 'Your local capture, history, statistics, and replay are unaffected.',
    }
  );
}

/**
 * Recognise a hosted entitlement gate on a thrown fetch error.
 *
 * Returns null for everything else, including a 402 whose body the cell did not
 * shape as expected: a gate we cannot name is better reported as the failure it
 * looks like than as a confident sentence about a capability we guessed.
 */
export function hostedGateFor(error: unknown): HostedGate | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as { status?: unknown; capability?: unknown };
  if (record.status !== 402) return null;
  if (typeof record.capability !== 'string' || record.capability.length === 0) {
    return null;
  }
  return { capability: record.capability, ...copyFor(record.capability) };
}

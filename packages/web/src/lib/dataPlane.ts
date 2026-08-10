// Which data plane is this dashboard reading from?
//
// There is ONE primary UI and it speaks ONE route contract. What changes
// underneath it is the AUTHORITY: the user's own machine on loopback, a worker
// they operate, or a Seorak-managed one. The plane descriptor is the single read
// that says which, and it is what lets the Free product open with no account:
// a local plane is the machine that owns the history, requires no operator
// credential, and therefore has nothing to sign in to. Optional scoped
// integration credentials are a distinct external principal.
//
// TWO PATHS, because there are two planes. The collector serves the descriptor
// at `/data-plane`; a worker serves it at `/sync/v1/data-plane`, deliberately
// outside its hosted capability gate. Neither serves the other's path. This
// probe used to ask only for the local one, so every Pro customer opening
// Settings read "this deployment does not report which data plane it serves"
// about a worker that reports it perfectly well. The paths come from
// `seorakRoutes` rather than from literals here so the three packages that must
// agree share one source.
//
// The probe is deliberately forgiving. A plane that does not answer either path,
// answers with anything malformed, or answers with a credentialed remote
// descriptor leaves the app on its existing sign-in path — an unknown authority
// is never treated as an open one.

import { seorakRoutes } from '@seorak/types';
import {
  parseDataPlaneStatus,
  planeServes,
  type DataPlaneStatus,
  type DataPlaneSurface,
} from '@seorak/types/data-plane';
import { API_BASE } from './api.js';
import { authHeader } from './token.js';

/** Boot must not hang on a plane that accepts the connection and never answers. */
const PROBE_TIMEOUT_MS = 3000;

/** Local first: it is the account-free entry path, asked before any sign-in. */
const DESCRIPTOR_PATHS = [
  seorakRoutes.localDataPlane(),
  seorakRoutes.compactSyncDataPlane(),
] as const;

let probed: DataPlaneStatus | null = null;

/** One path, answered or not. A miss and a transport failure are the same fact
 *  here: this plane did not describe itself at this path. */
async function readDescriptor(path: string): Promise<DataPlaneStatus | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      cache: 'no-store',
      // The same credential every other read sends. An armed worker answers the
      // descriptor route with `read` authority, so a probe with no header reads
      // 401 and reports the plane as silent when it is merely locked.
      headers: authHeader(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok ? parseDataPlaneStatus(await res.json()) : null;
  } catch {
    return null;
  }
}

/**
 * Read the plane descriptor, or null when this deployment serves one at neither
 * path (every worker predating the contract, and any transport failure).
 */
export async function probeDataPlane(): Promise<DataPlaneStatus | null> {
  // EVERY path writes the cache, including the failures. A probe that only
  // recorded its successes would leave the previous descriptor standing after
  // the plane went away or changed underneath the app, and every later
  // "does this plane serve X?" would be answered by an authority that is no
  // longer there. A stale yes is worse than an honest unknown.
  for (const path of DESCRIPTOR_PATHS) {
    const status = await readDescriptor(path);
    if (status) {
      probed = status;
      return probed;
    }
  }
  probed = null;
  return null;
}

/** The last successfully parsed descriptor, for surfaces that need to say what
 *  this plane can and cannot answer. Null before the first successful probe. */
export function currentDataPlane(): DataPlaneStatus | null {
  return probed;
}

/**
 * Whether the app may enter with no sign-in.
 *
 * True ONLY for a local plane with no operator credential. Integration grants
 * are separate exact-audience principals and do not gate app entry.
 * `parseDataPlaneStatus` already refuses a local descriptor that claims to
 * require an operator credential, so this cannot be reached by a malformed
 * remote plane asserting `authority: "local"`.
 */
export function entersWithoutSignIn(status: DataPlaneStatus | null): boolean {
  return (
    status !== null &&
    status.descriptor.authority === 'local' &&
    !status.descriptor.credentialRequired
  );
}

/**
 * Whether a read surface is served by the plane this app is on.
 *
 * A surface ABSENT from the descriptor is genuinely unavailable here and must
 * be presented that way, never as measured emptiness. The membership test comes
 * from `@seorak/types` so there is ONE implementation of that rule; what this
 * wrapper adds is the null policy, which the contract deliberately does not
 * have an opinion about: an UNKNOWN plane (no descriptor — every worker
 * predating the contract) is not a claim either way, so it answers true and the
 * surface's own error handling stands.
 *
 * A view that does nothing special still degrades honestly, because the plane
 * refuses an unserved route outright (501) rather than answering it empty.
 */
export function currentPlaneServes(surface: DataPlaneSurface): boolean {
  return probed === null || planeServes(probed, surface);
}

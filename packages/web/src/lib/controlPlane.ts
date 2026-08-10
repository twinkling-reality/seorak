/**
 * The control plane the SERVING PLANE says it belongs to, or none.
 *
 * There is no default and no build-time origin, in development or anywhere
 * else. A control plane is a service somebody operates: identity, billing, and
 * account deletion all live there, and this tree ships without one. The origin
 * therefore arrives at RUNTIME, on the `/data-plane` descriptor the app already
 * probes at boot, which is the one channel that can answer differently for a
 * managed cell and for the same bundle running on a self-hoster's loopback.
 *
 * It used to be `VITE_CONTROL_PLANE_URL`, and that could not survive being
 * published: a bundle has exactly one build, so a baked origin would make every
 * self-hosted install carry Seorak's account host and reach for it the moment
 * someone pressed a sign-in button. `@seorak/types` constrains the value to a
 * bare origin before it is ever navigated to.
 *
 * A plane that has not been probed, or that names no control plane, has NONE.
 * That is a state the surfaces render: `EntryView` disables the three OAuth
 * buttons and leaves the operator-token path, and `SettingsView` withholds
 * account deletion and keeps a logout local. Falling back to a Seorak host
 * instead would send a request somewhere the user did not choose.
 *
 * Exported so this is the ONE place the origin is resolved. It was previously
 * copied inline into `EntryView`, which is how two callers end up disagreeing
 * about whether a plane is configured.
 */

import { currentDataPlane } from './dataPlane.js';

export function configuredControlPlaneUrl(): string {
  return currentDataPlane()?.descriptor.controlPlaneUrl ?? '';
}

export function hasConfiguredControlPlane(): boolean {
  return Boolean(configuredControlPlaneUrl());
}

/** Continue a dashboard logout at the control plane after the worker session is revoked. */
export function continueControlPlaneLogout(): boolean {
  const controlPlaneUrl = configuredControlPlaneUrl();
  if (!controlPlaneUrl) return false;
  window.location.assign(`${controlPlaneUrl}/logout`);
  return true;
}

/** Begin the control plane's reauthenticated, two-confirmation deletion flow. */
export function continueControlPlaneAccountDeletion(): boolean {
  const controlPlaneUrl = configuredControlPlaneUrl();
  if (!controlPlaneUrl) return false;
  window.location.assign(`${controlPlaneUrl}/account/delete`);
  return true;
}

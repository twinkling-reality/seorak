/**
 * The one origin the dashboard talks to, and its own module.
 *
 * THE DASHBOARD READS THE ORIGIN THAT SERVED IT, always. Two cases and both are
 * same-origin:
 *   1. dev → `/api`, proxied to the local plane (see vite.config.ts), so the
 *      browser stays same-origin and the plane needs no CORS.
 *   2. prod → `''` (same-origin ROOT). The dashboard is served BY the plane it
 *      reads — the collector's loopback plane, a self-hosted binding, or a
 *      worker serving it as static assets — so `/overview` etc. hit that plane
 *      directly: zero CORS, CSP `connect-src 'self'`.
 *
 * There is deliberately no third case. `VITE_WORKER_URL` used to name a worker
 * on a DIFFERENT origin, and a build-time origin cannot survive publication: one
 * artifact has one build, so a baked host would ship to every install that ran
 * it and send that install's reads somewhere nobody chose. The origin is not
 * something the `/data-plane` descriptor can hand back either, because the
 * descriptor is fetched FROM it. Resolving it from the document is the runtime
 * answer, and it is the one that cannot point off the machine.
 *
 * WHY IT IS NOT IN `api.ts`. The render error boundary needs this base and
 * nothing else, and it sits in the ENTRY chunk. Importing the API client for one
 * string pulled the client and the `@seorak/types` barrel in behind it and blew
 * the entry ceiling by 38,128 bytes. `api.ts` re-exports both names, so callers
 * that already have the client keep importing from there and there is still one
 * definition.
 */

export function resolveApiBase(env: { dev: boolean }): string {
  return env.dev ? '/api' : '';
}

/** The resolved base every request in this app is prefixed with. The data-plane
 *  probe (lib/dataPlane.ts) reaches the SAME origin the reads do — a probe
 *  against a different base would answer for a plane the app is not actually
 *  reading from. */
export const API_BASE = resolveApiBase({ dev: import.meta.env.DEV });

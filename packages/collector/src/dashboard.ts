/**
 * dashboard.ts — PURE: where the web dashboard lives, derived from the worker
 * URL. Its own module rather than a corner of `cli.ts` because BOTH the CLI
 * (which prints a signed-in link after `init`) and the terminal session (whose
 * whole second half is a door to the dashboard) need it, and importing the CLI
 * from the session it launches would be a cycle.
 */

/** The ORIGIN that serves the dashboard. A local worker has no bundled UI, so we
 *  point at the Vite dev server on :5173; a deployed worker serves the web build as
 *  its own static assets (same origin), so the worker URL is the origin. NOTE: the
 *  dashboard SPA mounts at `/dashboard` (App.tsx / marketing paths.ts), and `/` is
 *  the marketing site, so callers building a deep link use `dashboardDeepLink`. */
export function dashboardUrl(workerUrl: string): string {
  return workerUrl.includes("localhost") || workerUrl.includes("127.0.0.1")
    ? "http://localhost:5173"
    : workerUrl;
}

/** The deep link to the dashboard SPA (`<origin>/dashboard`), optionally carrying a
 *  one-click sign-in `#token` fragment. The fragment must ride
 *  a `/dashboard` URL: the token consumer (`readTokenFromHash`) only runs when the
 *  dashboard chunk mounts, which `/` (marketing) never does. Pure.
 *
 *  Pass a token only where the link is printed ONCE, into scrollback. A surface
 *  that keeps the link on screen (the live session) must omit it. */
export function dashboardDeepLink(workerUrl: string, token?: string): string {
  const base = `${dashboardUrl(workerUrl)}/dashboard`;
  return token ? `${base}#token=${encodeURIComponent(token)}` : base;
}

import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import {
  chunkBudget,
  cspHeaders,
  dataPlaneProtocol,
  publicAssets,
} from "./scripts/buildPlugins.js";

/**
 * THE DASHBOARD ENTRY. `dashboard/index.html` to `src/main.tsx` to
 * `DashboardApp`, and nothing else.
 *
 * This is the public core's primary UI and the artifact the collector's loopback
 * plane serves. It builds Seorak's own website not at all: no marketing router,
 * no blog, no pricing, no legal pages, and no `build:discovery`, which is what
 * makes the public directory origin irrelevant to this artifact. Seorak's site is
 * `vite.site.config.ts`, and it is private.
 *
 * The dashboard reads ONE route contract from whichever data plane is serving
 * it: the collector's loopback plane on this machine, or a worker. In dev we
 * proxy `/api/*` so the browser stays same-origin and neither needs CORS (see
 * DEV_API_TARGET below for which one, and why the default changed). In prod it
 * reads the origin that served it, and there is no build variable that can
 * change that.
 *
 * `host: true` binds all interfaces (incl. IPv6 on macOS). Safari resolves
 * `localhost` to ::1 first; without this, dynamic/static module fetches to
 * localhost:5173 can fail with "Importing a module script failed" while Chrome
 * falls back to 127.0.0.1.
 */

const WEB_ROOT = import.meta.dirname;

/**
 * Byte ceilings for the chunks a visitor actually waits on, in emitted UTF-8
 * bytes (the on-disk size, not gzip — gzip varies with the compressor build,
 * raw bytes do not).
 *
 * WHY THIS GATE EXISTS. `DashboardApp` grew from 472,057 to 565,124 bytes across
 * five commits on 2026-07-27 and nobody noticed, because nothing in the build
 * failed. The growth was real and traceable — a second full zod runtime (v4,
 * reached through `@seorak/types`' `push.ts` and `event-validation.ts`) landed
 * beside the v3 runtime `packages/web/src/lib/schemas/*` already uses — but it
 * was found by an audit weeks later instead of by the commit that caused it.
 *
 * WHY THE CEILING IS NOT ZERO-SLACK. Chunk bytes move on almost every commit, so
 * an exact ceiling would fail the build on ordinary work and get switched off.
 * The ceiling is the measured size plus a 1% allowance, rounded up to the next
 * 1,000 bytes: routine edits pass, and another 93,000-byte dependency cannot
 * arrive unannounced. Raising it is allowed and expected; raising it silently is
 * what this prevents.
 *
 * THE DASHBOARD'S ENTRY CHUNK IS NOW THE DASHBOARD. Before the entry split this
 * config budgeted a startup chunk of 285,000 that was the marketing shell, plus a
 * lazily-imported `DashboardApp` of 475,000, because one document had to decide
 * at runtime which half to mount. This entry has nothing to decide, so
 * `DashboardApp` is a static import and lands in the entry chunk. The number
 * below is a different measurement of a different thing rather than a raised
 * ceiling: it is what someone opening `/dashboard` waits on, and it is one
 * download where there used to be two in sequence.
 *
 * Measured 2026-08-04 at the entry split:
 *   entry:index   680,327 raw / 208,750 gzip  → 688,000
 *
 * What that replaced, for a visitor opening `/dashboard`: a 282,706-byte startup
 * chunk followed by a 450,110-byte dynamic import, 732,816 bytes over two
 * sequential requests. The 51,376-byte difference is the marketing router shell
 * and its route table leaving the path; the lazy views (Replay, Settings,
 * Agents, Model, Compare, and the rest) are still their own chunks and are
 * unchanged. This is a boundary change that happens to weigh less, not a
 * performance change.
 */
const DASHBOARD_ENTRY_CEILING = 688_000;

/**
 * What the dashboard artifact carries out of `public/`, named explicitly rather
 * than copied wholesale. `assets/stack` is the language, framework, package
 * manager, category, and branch-work iconography `lib/visualMeta.ts` addresses by
 * root-absolute path; `fonts` is what the `@font-face` block in `app.css` names;
 * `assets/dashboard-icon.svg` is the tab icon this document links.
 *
 * What is deliberately absent: `assets/og-image.*`, `assets/logo-mark.svg`,
 * `assets/seorak-icon.svg`, and `assets/favicon.svg`, the marketing site's
 * social card and brand artwork, which the ownership map places private. A
 * wholesale `publicDir` copy put all of them in every dashboard build.
 *
 * THE FAVICON WAS HERE UNTIL C0, and it is the reason the dashboard could not be
 * built from the public file set at all: this list is public, the brand file is
 * private, and the build failed copying it the moment the private half was not
 * present. The entry document now links the neutral mark instead.
 */
const DASHBOARD_PUBLIC_ASSETS = ["assets/stack", "assets/dashboard-icon.svg", "fonts"];

/**
 * Where `/api/*` goes in dev.
 *
 * The default is the COLLECTOR'S LOCAL PLANE on 4317, not the worker, because
 * that is the Free path and it is the one that must work with nothing else
 * running: `npm run dev:web` against a machine that has only `seorak init`
 * gives the primary dashboard, no account, no worker, no Cloudflare.
 *
 * `SEORAK_DEV_API` overrides it, so the worker-backed loop is one env var:
 *
 *     SEORAK_DEV_API=http://localhost:8787 npm run dev:web
 *
 * It stays a PROXY rather than pointing the browser straight at the plane. A
 * loopback service that accepts cross-origin requests is a real hazard on a
 * developer machine — any page you visit could read it — so the plane grants no
 * CORS at all and refuses a foreign `Origin`. Same-origin through the proxy
 * costs nothing and keeps that refusal absolute. It also matches production,
 * where the packaging shell serves the built assets and the plane on one
 * loopback origin and `API_BASE` is `''`.
 */
const DEV_API_TARGET = process.env.SEORAK_DEV_API ?? "http://127.0.0.1:4317";

export default defineConfig(({ command }) => ({
  root: resolve(WEB_ROOT, "dashboard"),
  // `root` also moves where Vite looks for `.env` files. Keep that at the package
  // root so the build and `public-build-guard.mjs`, which loads env from there,
  // see the same environment. The dashboard declares no build variable at all.
  envDir: WEB_ROOT,
  // The dev server still serves the whole `public/` tree: a dev server is not an
  // artifact, and a missing font in development is noise rather than a boundary
  // question. The BUILD takes the named subset above.
  publicDir: command === "build" ? false : resolve(WEB_ROOT, "public"),
  plugins: [
    react(),
    publicAssets(resolve(WEB_ROOT, "public"), DASHBOARD_PUBLIC_ASSETS),
    // Only the DASHBOARD entry declares this. It is the artifact a data plane
    // serves and `@seorak/dashboard` publishes; the site entry is Seorak's
    // website and nothing resolves a protocol version from it.
    dataPlaneProtocol(),
    cspHeaders(),
    chunkBudget({ entry: DASHBOARD_ENTRY_CEILING }),
  ],
  build: {
    outDir: resolve(WEB_ROOT, "dist-dashboard"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: DEV_API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
}));

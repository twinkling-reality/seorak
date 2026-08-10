export * from "./api.ts";
export * from "./client-auth.ts";
export * from "./event-protocol.ts";
export * from "./capabilities.ts";
export * from "./capture.ts";
export * from "./chat.ts";
export * from "./live-activity-settings.ts";
export * from "./events.ts";
export * from "./identity.ts";
export * from "./pricing.ts";
export * from "./session.ts";
export * from "./intervention.ts";
export * from "./notification-catalog.ts";
export * from "./notification-availability.ts";
export * from "./notification-settings.ts";
export * from "./project-themes.ts";
export * from "./project-merges.ts";
export * from "./project-glance.ts";
export * from "./project-archive.ts";
export * from "./summary.ts";
export * from "./projections.ts";
export * from "./overview.ts";
export * from "./usage-allowance.ts";
export * from "./replay.ts";
export * from "./outcome.ts";
export * from "./developer-model.ts";
export * from "./delivery-health.ts";
export * from "./entitlements.ts";
export * from "./compact-sync.ts";
export * from "./widgets.ts";
export * from "./workspace.ts";
export * from "./integration-api.ts";
export * from "./publication-management.ts";
export * from "./public-developer-api.ts";

// DELIBERATELY NOT RE-EXPORTED HERE: "./event-validation.ts" and "./push.ts".
//
// Both build zod schemas at module scope, so `export *` over them gives Rollup a
// side effect it cannot prove pure and no consumer can tree-shake them away.
// Measured, that put a SECOND complete zod runtime (v4, beside the v3 the web
// already had) plus the iOS push wire contract into the browser's dashboard
// chunk: 93,058 bytes for an ingest-event validator and an APNs payload shape
// that the dashboard never calls.
//
// They are still first-class, just on their own subpaths, which already exist in
// this package's exports map:
//
//     import { ... } from "@seorak/types/event-validation";
//     import { ... } from "@seorak/types/push";
//
// The rule generalizes: anything whose module scope RUNS code belongs on a
// subpath, not in this barrel, because a barrel is imported by every surface
// including the one shipped over the network to a browser.

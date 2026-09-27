/**
 * local-plane.ts — the loopback data plane the primary UI reads from.
 *
 * There is ONE primary product UI. It reads the public route contract in
 * `@seorak/types` (`seorakRoutes`), and this module answers that contract from
 * `history.sqlite` on 127.0.0.1. That is the whole point: a Free install serves
 * the same dashboard against the same paths as a hosted one, so there is never a
 * second, simplified local product to maintain or to disappoint the user with.
 *
 * NO OPERATOR CREDENTIAL ON LOOPBACK. The default binding is loopback on the machine that
 * OWNS the history, so a credential would only gate the user away from their own
 * disk (`parseDataPlaneDescriptor` refuses a local descriptor that claims
 * otherwise). The hardening that replaces it is positional, not secret:
 *   - the listener binds 127.0.0.1 and never a routable interface;
 *   - the `Host` header must name loopback, so a DNS-rebound page cannot reach
 *     it under an attacker-controlled name;
 *   - a cross-origin `Origin` is refused outright, and no CORS header is ever
 *     sent, so another site's script can neither read a response nor preflight
 *     a write;
 *   - ordinary first-party routes allow GET plus the single PUT `/settings`;
 *   - owner integration commands and MCP POSTs live in separately classified,
 *     exact route families with their own authority and body bounds;
 *   - every response is `no-store` + `nosniff`.
 *
 * THE SELF-HOSTED BINDING. `startSelfHostedPlane` binds a routable interface and
 * terminates TLS, which destroys every premise above at once. It is off unless
 * explicitly and completely configured, and what replaces the loopback
 * ownership argument lives in `plane-binding.ts` with the full reasoning in
 * `docs/reference/self-hosted-plane-hardening.md`. Both bindings share one
 * rule: `admitRequestPosition` runs ONCE before the raw request target,
 * credentials, or history are inspected. The closed classifier then selects
 * operator, API, or MCP authority without rerunning that positional decision.
 *
 * HONEST SURFACES. `GET /data-plane` lists only what this plane actually serves.
 * A surface it cannot derive is ABSENT from that list and its route answers 501,
 * so the UI presents it as unavailable from this plane rather than rendering an
 * empty measured section. What is and is not derivable is documented in
 * local-projection.ts.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createSecureServer, type Server as SecureServer } from "node:https";
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import {
  DATA_PLANE_PROTOCOL_VERSION,
  backlogIsEmpty,
  type DataPlaneStatus,
  type DataPlaneSurface,
  type ManagedSyncCoverage,
} from "@seorak/types/data-plane";
import {
  SESSION_MATERIALIZATION_MAX_ROWS,
  SESSION_OUTCOME_MAX_ROWS,
  SESSION_PAGE_DEFAULT_LIMIT,
  SESSION_PAGE_MAX_LIMIT,
  SETTINGS_FAMILIES,
  coerceCaptureSettings,
  coerceLiveActivitySettings,
  coerceNotificationSettings,
  coerceProjectArchive,
  coerceProjectMerges,
  coerceProjectThemes,
  isOverviewRangeDays,
  OVERVIEW_RANGE_DAYS,
  PRIVATE_SESSION_RESOLVE_MAX_BODY_BYTES,
  type SessionMaterializationRefusal,
  type ReplaySession,
  type SessionOutcome,
  type SessionOutcomeRefusal,
  type SettingsDocument,
  type SettingsFamily,
} from "@seorak/types";
import {
  localManagedLifecycleWindow,
  localManagedSyncCoverage,
} from "./compact-sync.ts";
import { listLocalInterventions } from "./local-intervention.ts";
import {
  issueLocalIntegrationCredential,
  LOCAL_INTEGRATION_OWNER_COMMAND_MAX_BYTES,
  LocalIntegrationCredentialRequestError,
} from "./local-integration-management.ts";
import {
  listLocalIntegrationCredentials,
  listLocalIntegrationProjects,
  revokeLocalIntegrationCredential,
} from "./local-integration-store.ts";
import {
  classifyLocalPlaneRequestTarget,
  type LocalPlaneRoute,
} from "./local-plane-routes.ts";
import { handleLocalPrivateApi } from "./local-private-http.ts";
import {
  createLocalPrivateMcpResourceServer,
  LOCAL_PRIVATE_MCP_MAX_REQUEST_BYTES,
  type LocalPrivateMcpResourceServer,
} from "./local-private-mcp-resource.ts";
import {
  buildLocalDeveloperModel,
  buildLocalLive,
  buildLocalOverview,
  buildLocalReplay,
  buildLocalSessionOutcome,
  buildLocalSessionPage,
  buildLocalSessionSummary,
  LocalLiveMaterializationTooLargeError,
  LocalReplayTooLargeError,
  LocalSessionOutcomeTooLargeError,
} from "./local-projection.ts";
import {
  ProjectionMemo,
  projectionMemoKey,
} from "./local-projection-cache.ts";
import { ProjectionThread } from "./local-projection-thread.ts";
import type { ProjectionJob } from "./local-projection-worker.ts";
import { openLocalHistory } from "./local-store.ts";
import { localHistoryThrough } from "./local-sync-store.ts";
import { collectorPackageRoot } from "./package-layout.ts";
import { captureSettingsPath, localSettingsPath } from "./paths.ts";
import {
  admitOperatorRequest,
  admitRequestPosition,
  LOOPBACK_BINDING,
  type PlaneBinding,
  type SelfHostedBinding,
} from "./plane-binding.ts";

export const DEFAULT_LOCAL_PLANE_PORT = 4317;
/** How long a shutdown waits for in-flight requests before dropping sockets. */
const LOCAL_PLANE_SHUTDOWN_GRACE_MS = 250;

/**
 * Event rows one ROUTABLE replay read may scan before it is refused.
 *
 * Not in `@seorak/types` beside `SESSION_OUTCOME_MAX_ROWS`, and the reason is
 * about the TYPE rather than the field. The hosted replay refusal does put
 * `maxRows` on the wire, but it does so from an inline object literal with no
 * `WorkerErrorCode` and no declared refusal interface
 * (`registerProductReadRoutes.ts`), unlike the outcome route, whose
 * `SessionOutcomeRefusal` is a shared type that both ends must agree on and
 * that therefore has to hold its own bound. There is no type here to share,
 * only a number. So this is a local bound that MATCHES a remote one rather than
 * a contract both ends read, and nothing mechanical holds the two together.
 *
 * The number is 10,000 because two implementations already chose it for this
 * exact read: `REPLAY_EVENT_ROW_BUDGET` in the worker, and
 * `LOCAL_PRIVATE_REPLAY_ROW_BUDGET` for the private integration API. A third
 * value here would mean the same request is refused at three different sizes
 * depending on which door it came through.
 */
export const SESSION_REPLAY_MAX_ROWS = 10_000;

/**
 * Process-wide memo for the plane's projections, keyed on the event high-water
 * mark. See local-projection-cache.ts for why this is safe against the two
 * clock-dependent legs a snapshot carries and why a hit is honest rather than
 * stale.
 *
 * Module scope rather than per-binding on purpose: the loopback and self-hosted
 * bindings answer for the SAME history on the same machine, so a projection one
 * computed is one the other would recompute identically. The directory is in the
 * key, so two planes over two histories still cannot read each other's entries.
 */
const projectionMemo = new ProjectionMemo<unknown>();

/**
 * The thread the projections actually run on. Module scope for the same reason
 * the memo is: one history, one machine, one builder. See
 * local-projection-thread.ts for why it is a single worker and why every failure
 * falls back inline.
 */
const projectionThread = new ProjectionThread();

/**
 * Read-through: memo, then the worker, then an inline build.
 *
 * The high-water mark makes any appended event a miss, so this never shortens
 * the distance between capture and the screen; what it removes is rebuilding an
 * identical projection for a reader polling every 30s while nothing is being
 * captured. `inline` is the same fold on this thread, taken only when the worker
 * cannot run at all, which is the old behaviour rather than an outage.
 */
async function serveProjection<T>(
  kind: ProjectionJob["kind"],
  directory: string | undefined,
  parameters: unknown,
  job: (nowMs: number) => ProjectionJob,
  inline: (nowMs: number) => T,
): Promise<T> {
  const highWater = historyHighWater(directory);
  const memoKey =
    highWater === null
      ? null
      : projectionMemoKey({ kind, directory, parameters, highWater });
  // One instant for both the window this build anchors at and the memo age, so
  // a cached entry cannot claim to cover a window it was not built for.
  const nowMs = Date.now();
  if (memoKey !== null) {
    const hit = projectionMemo.get(memoKey, nowMs);
    if (hit !== null) return hit as T;
  }
  let value: T;
  try {
    value = (await projectionThread.build(job(nowMs), memoKey ?? kind)) as T;
  } catch {
    value = inline(nowMs);
  }
  // Stamped with the instant the build STARTED, so an entry can never claim to
  // be fresher than the data it folded.
  if (memoKey !== null) projectionMemo.set(memoKey, nowMs, value);
  return value;
}

/** The high-water mark the memo keys on. Its own connection because the read is
 *  0-3ms to open and 0ms to run, which is the whole reason this is affordable to
 *  check before every build. Returns null when the history cannot be opened at
 *  all, which makes the caller skip the memo and take the normal build path
 *  rather than serve something it could not verify. */
function historyHighWater(directory: string | undefined): number | null {
  try {
    const database = openLocalHistory(directory);
    try {
      const row = database
        .prepare("SELECT COALESCE(MAX(local_seq), 0) AS high_water FROM local_event")
        .get() as { high_water?: unknown } | undefined;
      const value = Number(row?.high_water);
      return Number.isFinite(value) ? value : null;
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
}

/**
 * The same-origin CSRF proof the dashboard echoes on owner writes.
 *
 * Minted once per process and never written to disk: it is not a credential to
 * be stolen and replayed later, it is proof that the caller received a response
 * from THIS plane, which a cross-site request cannot do without a CORS grant
 * the plane never issues. `parseBrowserSessionBody` in the web client requires
 * at least 32 characters, so the length is a contract, not a preference.
 */
let mintedCsrfToken: string | null = null;
function csrfToken(): string {
  mintedCsrfToken ??= randomBytes(32).toString("base64url");
  return mintedCsrfToken;
}

/**
 * What this plane can answer from local capture today. `deliveryHealth` is
 * deliberately absent and can never join the list from here: it reports on a
 * delivery path, and the collector has none, so there is no health to report
 * rather than a derivation still owed.
 *
 * `publication` is absent for a third reason: publishing to the public directory
 * needs an operated directory to publish TO, which a loopback plane is not and
 * will never be. Being ON the contract is still what matters — it is how the
 * dashboard withholds the Settings tab honestly instead of rendering a control
 * whose every call 404s.
 *
 * `integrations` is atomic here. Owner management, the four versioned HTTP
 * reads, and the official stateless MCP resource are mounted through one closed
 * classifier before the descriptor names the surface. API and MCP credentials
 * are distinct exact-audience `srkx_` grants; the self-hosted operator bearer
 * remains confined to first-party and management routes.
 */
export const LOCAL_PLANE_SURFACES: readonly DataPlaneSurface[] = [
  "live",
  "overview",
  "sessions",
  "session",
  "sessionOutcome",
  "replay",
  "settings",
  "developerModel",
  "interventions",
  "integrations",
];

/**
 * The local plane's own descriptor, plus the managed relationship when there is
 * one.
 *
 * The local plane is the DEFAULT authority for every install, Free and Pro
 * alike, which means a lapsed subscriber is reading here at exactly the moment
 * the deletion countdown matters most. So it relays the managed lifecycle
 * window and the sync coverage the compact-sync layer maintains, rather than
 * making the one thing that person needs to know unrepresentable on the surface
 * they are actually looking at.
 *
 * An account-free install has never observed a managed plane, so both read null
 * — the honest answer, not a fabricated `none` phase. The contract requires
 * coverage beside any lifecycle phase past `none`, so the two travel together.
 */
export function localDataPlaneStatus(
  options: { directory?: string; nowMs?: number } = {},
): DataPlaneStatus {
  // ONE instant for both reads. Each defaults to `Date.now()` on its own, so
  // leaving it unpinned would let the lifecycle phase and the coverage state be
  // computed microseconds apart — and those two are exactly the pair that must
  // agree, because a phase past `none` is only representable with coverage
  // beside it. Resolving it here also makes the whole response reproducible
  // from a test clock.
  const at = { ...options, nowMs: options.nowMs ?? Date.now() };
  const lifecycle = localManagedLifecycleWindow(at);
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: {
      protocolVersion: DATA_PLANE_PROTOCOL_VERSION,
      authority: "local",
      operator: "local-machine",
      surfaces: [...LOCAL_PLANE_SURFACES],
      credentialRequired: false,
    },
    coverage: lifecycle === null ? null : localManagedSyncCoverage(at),
    lifecycle,
    // A rebaseline directive is the MANAGED side's instruction. The local plane
    // relays what it observed and never invents one for itself.
    rebaseline: null,
  };
}

/**
 * The same plane, described as a self-hosted operator sees it.
 *
 * Two differences from `localDataPlaneStatus`, and both are structural.
 *
 * NO LIFECYCLE, NO REBASELINE, EVER. `parseDataPlaneStatus` refuses either on a
 * `self-hosted` operator, and that refusal is what keeps "Seorak never meters a
 * service you run" true by construction rather than by policy. The LOCAL builder
 * above correctly relays the managed window, because a lapsed subscriber reads
 * locally at exactly the moment the deletion countdown matters. Same machine,
 * same history, different plane, and only one of the two may describe a billing
 * window.
 *
 * COVERAGE IS MEASURED, NOT ASSERTED. This binding serves the same
 * `history.sqlite` the loopback binding serves, so the "remote copy" the UI is
 * reading IS the local record. Every clause the shared parser demands for
 * completeness is answered from that fact rather than claimed: nothing is queued
 * between the UI and the rows, zero local records are absent from what this plane
 * serves, and `synchronizedThrough` is a real `MAX(at)` that errs early rather
 * than late. The alternative, a null coverage, would make `planeReadsAreComplete`
 * report a self-hoster's complete record as possibly partial, which is the same
 * honesty bug pointed the other way.
 *
 * This is the one claim here that a future change could turn into a lie: if a
 * self-hosted plane ever served a COPY rather than this database, every line
 * below has to be re-derived from that copy.
 */
export function selfHostedDataPlaneStatus(
  options: { directory?: string; nowMs?: number } = {},
): DataPlaneStatus {
  const nowMs = options.nowMs ?? Date.now();
  const observedAt = new Date(nowMs).toISOString();
  const through = localHistoryThrough(options.directory);
  // A local clock behind the newest row is a reason to report less, never to
  // report an instant after the moment of observation, which the parser refuses.
  const synchronizedThrough =
    through !== null && Date.parse(through) <= nowMs ? through : null;
  const backlog = { sessions: 0, hours: 0, archives: 0 };
  const coverage: ManagedSyncCoverage = {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    state: "current",
    synchronizedThrough,
    pendingFrom: null,
    backlog,
    // Nothing was ever uploaded, so there is no acceptance ledger to report.
    // Synthesising one for a plane that reads in place would be exactly the
    // fabrication the coverage contract exists to prevent.
    lastAcceptedAt: null,
    lastAttemptAt: null,
    lastError: null,
    managedCopyComplete: synchronizedThrough !== null && backlogIsEmpty(backlog),
    observedAt,
  };
  return {
    schemaVersion: DATA_PLANE_PROTOCOL_VERSION,
    descriptor: {
      protocolVersion: DATA_PLANE_PROTOCOL_VERSION,
      authority: "remote",
      operator: "self-hosted",
      surfaces: [...LOCAL_PLANE_SURFACES],
      credentialRequired: true,
    },
    coverage,
    lifecycle: null,
    rebaseline: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Local settings                                                              */
/* -------------------------------------------------------------------------- */

type Coercer = (raw: unknown) => unknown;

const FAMILY_COERCERS: Record<SettingsFamily, Coercer> = {
  capture: coerceCaptureSettings,
  notifications: coerceNotificationSettings,
  liveActivity: coerceLiveActivitySettings,
  projectThemes: coerceProjectThemes,
  projectMerges: coerceProjectMerges,
  projectArchive: coerceProjectArchive,
};

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

/**
 * The capture family lives in `capture.json` because the short-lived hook
 * processes already read that file synchronously on every event. Keeping it
 * there means a toggle flipped in the dashboard reaches capture immediately and
 * there is exactly one on-machine authority for it, rather than a second copy to
 * drift.
 */
export function readLocalSettings(directory?: string): SettingsDocument {
  const stored = readJsonFile(localSettingsPath(directory));
  const record =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const document = {} as Record<SettingsFamily, unknown>;
  for (const family of SETTINGS_FAMILIES) {
    const raw =
      family === "capture"
        ? readJsonFile(captureSettingsPath(directory))
        : record[family];
    document[family] = FAMILY_COERCERS[family](raw);
  }
  return document as SettingsDocument;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A sparse family patch merges into the stored value, so one toggle never
 *  clobbers a sibling — the same deep-merge shape the worker's PUT applies. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = deepMerge(base[key], value);
  }
  return merged;
}

export function writeLocalSettings(
  patch: Record<string, unknown>,
  directory?: string,
): SettingsDocument {
  const current = readLocalSettings(directory);
  const stored = readJsonFile(localSettingsPath(directory));
  const record = isPlainObject(stored) ? { ...stored } : {};
  for (const family of SETTINGS_FAMILIES) {
    if (!Object.hasOwn(patch, family)) continue;
    const next = FAMILY_COERCERS[family](deepMerge(current[family], patch[family]));
    if (family === "capture") {
      writeJsonFile(captureSettingsPath(directory), next);
      continue;
    }
    record[family] = next;
  }
  writeJsonFile(localSettingsPath(directory), record);
  return readLocalSettings(directory);
}

/* -------------------------------------------------------------------------- */
/* Dashboard assets                                                            */
/* -------------------------------------------------------------------------- */

const ASSET_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  // Both font containers. `.woff` was missing, and an unmapped extension is a
  // 404 here rather than a served file with a guessed type, so the four product
  // faces the dashboard's @font-face block names have never loaded on this
  // plane: the local dashboard has always rendered in the fallback stack while
  // the same build rendered correctly from a worker. Found by loading the
  // artifact in a browser, which is the only place a font fallback is visible;
  // nothing in the suite could see it.
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * The published package that carries the built primary UI. Its one runtime
 * consumer is this collector, and this is the only place its name appears.
 */
const DASHBOARD_PACKAGE = "@seorak/dashboard";

/** What a dashboard artifact declares the protocol it was built against in. */
const DASHBOARD_PROTOCOL_MANIFEST = "data-plane-protocol.json";

/**
 * Where the packaged dashboard's assets are, asked of the module resolver
 * rather than computed from this file's own position.
 *
 * WHY RESOLUTION AND NOT PATH ARITHMETIC. The obvious implementation walks to a
 * sibling directory, and it is wrong in two reproducible ways. npm hoists by
 * default but NESTS whenever a version conflict makes it, so the sibling of this
 * package is not reliably the copy this package depends on, and a probe that
 * finds the wrong copy finds it silently. Yarn PnP has no `node_modules` layout
 * at all, so a path probe cannot work there under any conditions. `require.resolve`
 * asks the installed package manager which copy THIS module gets, which is the
 * question, and it answers correctly under nesting and under PnP alike.
 *
 * Returns null when the package is absent, which is an ordinary state: a source
 * checkout builds the dashboard in place, and the candidate below finds it.
 */
function packagedDashboardAssets(): string | null {
  try {
    const manifest = createRequire(import.meta.url).resolve(
      `${DASHBOARD_PACKAGE}/package.json`,
    );
    return join(dirname(manifest), "dist");
  } catch {
    return null;
  }
}

/**
 * What this installation found when it went looking for the primary UI.
 *
 * Three states, not two, because "present" is not the same as "servable": a
 * bundle built against a different data-plane protocol is worse than no bundle
 * at all, and it has to be distinguishable from both.
 */
export type DashboardBundle =
  | { readonly state: "ready"; readonly root: string }
  | { readonly state: "absent" }
  | {
      readonly state: "protocol-mismatch";
      readonly root: string;
      /** What the bundle declared, or null when it declared nothing readable. */
      readonly declared: number | null;
    };

/**
 * Locate the built primary dashboard and decide whether this plane may serve it.
 *
 * Nothing is fabricated when it is missing: the plane still serves the whole
 * route contract, and the caller says the bundle is not installed rather than
 * pretending a URL will open something.
 *
 * CANDIDATE ORDER. An explicit argument, then `SEORAK_WEB_DIST`, then the
 * resolved `@seorak/dashboard`, then a source checkout's sibling build. The two
 * package-relative probes this replaced were `dist/web`, a published layout
 * nothing ever wrote, and the checkout sibling; on an npm install both were
 * empty, which is why the published collector had no interface.
 *
 * The checkout candidate is `packages/web/dist-dashboard`, the DASHBOARD
 * artifact, and not `packages/web/dist`, which is the whole marketing website.
 * Before the web entry split there was only the combined build, so a source
 * checkout served this plane the blog, pricing, and the legal pages on
 * `127.0.0.1` alongside the dashboard. Those are Seorak's marketing site; they
 * are not the product, they are not what you asked a local plane for, and they
 * answered 200 on a loopback port that holds your history.
 *
 * THE PROTOCOL CHECK IS THE POINT OF THE THIRD STATE. A bundle freezes its copy
 * of `@seorak/types` when it is built; this collector resolves its own at
 * runtime. `parseDataPlaneStatus` compares the two constants with a strict
 * `!==`, so a mismatched bundle does not degrade, it reads this plane's
 * descriptor as unparseable, concludes the authority is unknown, and renders the
 * sign-in path. The account-free product would become a sign-in wall over a
 * machine that is holding the user's history four inches away, with nothing
 * anywhere saying why. Refusing by name costs the UI and keeps the explanation.
 */
export function resolveDashboardBundle(explicit?: string | null): DashboardBundle {
  if (explicit === null) return { state: "absent" };
  const candidates: string[] = [];
  if (explicit !== undefined) candidates.push(explicit);
  const configured = process.env.SEORAK_WEB_DIST;
  if (configured !== undefined && configured !== "" && isAbsolute(configured)) {
    candidates.push(configured);
  }
  const packaged = packagedDashboardAssets();
  if (packaged !== null) candidates.push(packaged);
  try {
    candidates.push(join(collectorPackageRoot(), "..", "web", "dist-dashboard"));
  } catch {
    // No package root means no checkout sibling to look beside. The resolved
    // package, if there is one, has already been offered.
  }
  for (const candidate of candidates) {
    const root = normalize(resolve(candidate));
    if (!existsSync(join(root, "index.html"))) continue;
    const declared = declaredProtocolVersion(root);
    if (declared !== DATA_PLANE_PROTOCOL_VERSION) {
      return { state: "protocol-mismatch", root, declared };
    }
    return { state: "ready", root };
  }
  return { state: "absent" };
}

/** What a bundle says it was built against, or null when it says nothing. */
function declaredProtocolVersion(root: string): number | null {
  try {
    const declared = (
      JSON.parse(
        readFileSync(join(root, DASHBOARD_PROTOCOL_MANIFEST), "utf8"),
      ) as { dataPlaneProtocolVersion?: unknown }
    ).dataPlaneProtocolVersion;
    return typeof declared === "number" ? declared : null;
  } catch {
    return null;
  }
}

/**
 * The named error a refused bundle gets, or null when there is nothing wrong.
 *
 * It says what was found, where, what is wrong with it, what the user would have
 * seen instead, and what to do. A refusal the reader cannot act on is the same
 * outage with extra steps.
 */
export function dashboardBundleRefusal(bundle: DashboardBundle): string | null {
  if (bundle.state !== "protocol-mismatch") return null;
  const declared =
    bundle.declared === null
      ? "declares no data-plane protocol version"
      : `declares data-plane protocol ${bundle.declared}`;
  return (
    `dashboard bundle refused: ${bundle.root} ${declared}, and this collector speaks ` +
    `${DATA_PLANE_PROTOCOL_VERSION}. Serving it would show a sign-in screen instead of this ` +
    `machine's history, because the dashboard cannot read a descriptor from a protocol it was ` +
    `not built against. The route contract is unaffected. Install a matching ${DASHBOARD_PACKAGE}, ` +
    `or point SEORAK_WEB_DIST at a bundle built from this collector's version.`
  );
}

/**
 * The asset root a plane may serve, or null. Every caller that only needs "is
 * there a UI here" asks this; `resolveDashboardBundle` is for the callers that
 * have to explain a refusal.
 */
export function resolveDashboardAssets(explicit?: string | null): string | null {
  const bundle = resolveDashboardBundle(explicit);
  return bundle.state === "ready" ? bundle.root : null;
}

interface ResolvedAsset {
  path: string;
  contentType: string;
  html: boolean;
}

function resolveAsset(root: string, pathname: string): ResolvedAsset | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const target = normalize(resolve(root, `.${decoded}`));
  if (target !== root && !target.startsWith(root + sep)) return null;
  const extension = extname(target).toLowerCase();
  const contentType = ASSET_CONTENT_TYPES[extension];
  if (contentType === undefined) return null;
  if (!existsSync(target)) return null;
  const stat = lstatSync(target);
  if (!stat.isFile()) return null;
  return { path: target, contentType, html: extension === ".html" };
}

/* -------------------------------------------------------------------------- */
/* HTTP plumbing                                                               */
/* -------------------------------------------------------------------------- */

const BASE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const DASHBOARD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MAX_REQUEST_BODY_BYTES = 256 * 1024;

/**
 * Only the self-hosted binding carries HSTS. On loopback the plane speaks plain
 * HTTP by design, and pinning `http://127.0.0.1` to https would make the local
 * dashboard unreachable in the browser that saw the header.
 */
function headersFor(binding: PlaneBinding): Record<string, string> {
  return binding.mode === "loopback"
    ? BASE_HEADERS
    : { ...BASE_HEADERS, "strict-transport-security": "max-age=31536000" };
}

function sendJson(
  binding: PlaneBinding,
  res: ServerResponse,
  status: number,
  value: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  res.writeHead(status, {
    ...headersFor(binding),
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  res.end(`${JSON.stringify(value)}\n`);
}

/** A surface this plane does not serve. The body names the plane so a client
 *  reports "unavailable from this plane", never "no data" — and it names the
 *  binding it actually arrived on, not the one the module is named after. */
function sendUnavailable(
  binding: PlaneBinding,
  res: ServerResponse,
  surface: string,
): void {
  sendJson(binding, res, 501, {
    error: "surface unavailable on this data plane",
    surface,
    authority: binding.mode === "loopback" ? "local" : "remote",
    operator: binding.mode === "loopback" ? "local-machine" : "self-hosted",
  });
}

/**
 * The `publication` surface's whole path space, matched by prefix rather than
 * by listing the five routes.
 *
 * A prefix is right here precisely because this plane implements NONE of them:
 * there is no behaviour to get wrong per route, and a sixth publication route
 * added on the hosted side must not silently fall through to the SPA fallback
 * or a 404 on this one. That holds on BOTH bindings: publishing needs an
 * operated directory to publish TO, which a self-hosted plane is no more than a
 * loopback one.
 */
function isPublicationPath(path: string): boolean {
  return path === "/public-presence" || path.startsWith("/public-presence/");
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_REQUEST_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readBodyBytes(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Buffer | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > maxBytes) {
      req.resume();
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export interface LocalPlaneOptions {
  /** Collector state directory override; defaults to `SEORAK_DIR`. */
  directory?: string;
  /** Built dashboard directory. `null` disables asset serving entirely. */
  assetsDirectory?: string | null;
  /** Injectable integration authority/query clock for deterministic gates. */
  integrationNow?: () => Date;
}

type ManagementRoute = Extract<LocalPlaneRoute, { authority: "management" }>;

function integrationNow(options: LocalPlaneOptions): Date {
  return options.integrationNow?.() ?? new Date();
}

function isJsonRequest(req: IncomingMessage): boolean {
  const contentType = req.headers["content-type"];
  return typeof contentType === "string" &&
    contentType.split(";", 1)[0]!.trim().toLowerCase() === "application/json";
}

function sendOperatorRequired(binding: PlaneBinding, res: ServerResponse): void {
  sendJson(binding, res, 401, { error: "credential required" }, {
    "www-authenticate": "Bearer",
  });
}

function sendReservedRefusal(
  binding: PlaneBinding,
  res: ServerResponse,
  route: Extract<LocalPlaneRoute, { authority: "reserved-refusal" }>,
): void {
  sendJson(
    binding,
    res,
    route.status,
    { error: route.status === 405 ? "method not allowed" : "not found" },
    route.allow === undefined ? {} : { allow: route.allow },
  );
}

async function handleIntegrationManagement(
  binding: PlaneBinding,
  route: ManagementRoute,
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
  options: LocalPlaneOptions,
  integrations: LocalIntegrationRuntime,
): Promise<void> {
  const directoryOption = options.directory === undefined
    ? {}
    : { directory: options.directory };
  const nowMs = integrationNow(options).getTime();
  try {
    if (route.route === "inventory") {
      sendJson(
        binding,
        res,
        200,
        listLocalIntegrationCredentials({ ...directoryOption, nowMs }),
      );
      return;
    }
    if (route.route === "projects") {
      sendJson(
        binding,
        res,
        200,
        listLocalIntegrationProjects({ ...directoryOption, nowMs }),
      );
      return;
    }
    if (!isJsonRequest(req)) {
      sendJson(binding, res, 415, { error: "content-type must be application/json" });
      return;
    }
    const bytes = await readBodyBytes(req, LOCAL_INTEGRATION_OWNER_COMMAND_MAX_BYTES);
    if (bytes === null) {
      sendJson(binding, res, 413, { error: "integration owner command too large" });
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      sendJson(binding, res, 400, { error: "integration owner command invalid" });
      return;
    }
    if (route.route === "issue") {
      const issued = issueLocalIntegrationCredential(origin, value, {
        ...directoryOption,
        nowMs,
      });
      integrations.guardIssuedCredentialResponse(res, () => {
        const cleanupNowMs = integrationNow(options).getTime();
        const revoked = revokeLocalIntegrationCredential(
          issued.credentialRef.slice("icr_".length),
          {
            ...directoryOption,
            nowMs: cleanupNowMs,
          },
        );
        if (revoked) return;
        const retained = listLocalIntegrationCredentials({
          ...directoryOption,
          nowMs: cleanupNowMs,
        }).credentials.find((credential) => credential.credentialRef === issued.credentialRef);
        if (
          retained !== undefined &&
          retained.revokedAt === null &&
          Date.parse(retained.expiresAt) > cleanupNowMs
        ) {
          throw new Error("undelivered integration credential remains active");
        }
      });
      sendJson(binding, res, 201, issued);
      return;
    }
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 0
    ) {
      sendJson(binding, res, 400, { error: "revocation command must be an empty object" });
      return;
    }
    const revoked = revokeLocalIntegrationCredential(route.credentialId, {
      ...directoryOption,
      nowMs,
    });
    sendJson(binding, res, revoked ? 200 : 404, { ok: revoked });
  } catch (error) {
    if (error instanceof LocalIntegrationCredentialRequestError) {
      sendJson(binding, res, error.status, { error: error.responseMessage });
      return;
    }
    sendJson(binding, res, 503, { error: "integration credential authority unavailable" });
  }
}

function incomingHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

async function sendFetchResponse(
  binding: PlaneBinding,
  res: ServerResponse,
  response: Response,
): Promise<void> {
  const headers: Record<string, string> = { ...headersFor(binding) };
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

export class LocalIntegrationRuntime {
  readonly #resources = new Map<string, LocalPrivateMcpResourceServer>();
  readonly #issuedResponses = new Set<Promise<void>>();
  readonly #options: LocalPlaneOptions;
  #issuedResponseFailure: Error | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(options: LocalPlaneOptions) {
    this.#options = options;
  }

  /**
   * A credential secret exists only in its 201 response. If shutdown or a
   * broken socket closes that response before Node accepts it for delivery,
   * revoke the grant before considering the request settled. The owner can
   * retry issuance without an unseen live credential surviving the cut.
   */
  guardIssuedCredentialResponse(res: ServerResponse, revoke: () => void): void {
    const revokeUndelivered = (): void => {
      try {
        revoke();
      } catch (error) {
        this.#issuedResponseFailure ??= error instanceof Error
          ? error
          : new Error("undelivered integration credential could not be revoked");
      }
    };
    // A peer can disappear after the body has been read but before synchronous
    // issuance returns. EventEmitter will not replay an already-emitted close,
    // so compensate immediately instead of registering a promise that can
    // neither deliver nor settle.
    if (res.destroyed || res.closed) {
      revokeUndelivered();
      return;
    }
    let finished = false;
    let settle!: () => void;
    const pending = new Promise<void>((resolvePending) => {
      settle = resolvePending;
    });
    const resolved = pending.finally(() => {
      this.#issuedResponses.delete(resolved);
    });
    this.#issuedResponses.add(resolved);
    res.once("finish", () => {
      finished = true;
      settle();
    });
    res.once("close", () => {
      try {
        if (!finished) revokeUndelivered();
      } finally {
        settle();
      }
    });
  }

  async serveMcp(
    binding: PlaneBinding,
    route: Extract<LocalPlaneRoute, { authority: "mcp" }>,
    req: IncomingMessage,
    res: ServerResponse,
    origin: string,
  ): Promise<void> {
    const resourceUrl = new URL("/mcp/private", `${origin}/`).toString();
    let resource = this.#resources.get(resourceUrl);
    if (resource === undefined) {
      resource = createLocalPrivateMcpResourceServer({
        resourceServerUrl: resourceUrl,
        ...(this.#options.directory === undefined
          ? {}
          : { directory: this.#options.directory }),
        ...(this.#options.integrationNow === undefined
          ? {}
          : { now: this.#options.integrationNow }),
      });
      this.#resources.set(resourceUrl, resource);
    }
    const bytes = await readBodyBytes(req, LOCAL_PRIVATE_MCP_MAX_REQUEST_BYTES);
    const body = bytes ?? Buffer.alloc(LOCAL_PRIVATE_MCP_MAX_REQUEST_BYTES + 1);
    const request = new Request(resourceUrl, {
      method: "POST",
      headers: incomingHeaders(req),
      body,
    });
    await sendFetchResponse(binding, res, await resource.fetch(request));
  }

  close(): Promise<void> {
    this.#closePromise ??= Promise.all([
      ...this.#issuedResponses,
      ...[...this.#resources.values()].map((resource) => resource.close()),
    ]).then(() => {
      if (this.#issuedResponseFailure !== null) throw this.#issuedResponseFailure;
    });
    return this.#closePromise;
  }
}

/** The request handler both bindings share. There is exactly one, so a route
 *  cannot exist on the routable socket without existing on loopback too. */
type PlaneRequestListener =
  ((req: IncomingMessage, res: ServerResponse) => void) &
  { closeIntegrations(): Promise<void> };

const serverIntegrationClosers = new WeakMap<Server | SecureServer, () => Promise<void>>();

function planeListener(
  binding: PlaneBinding,
  options: LocalPlaneOptions,
): PlaneRequestListener {
  const assets = resolveDashboardAssets(options.assetsDirectory);
  const integrations = new LocalIntegrationRuntime(options);
  const listener = ((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(binding, req, res, options, assets, integrations).catch(() => {
      if (!res.headersSent) {
        sendJson(binding, res, 500, { error: "data plane request failed" });
        return;
      }
      res.end();
    });
  }) as PlaneRequestListener;
  listener.closeIntegrations = () => integrations.close();
  return listener;
}

export function createLocalPlaneServer(options: LocalPlaneOptions = {}): Server {
  const listener = planeListener(LOOPBACK_BINDING, options);
  const server = createServer(listener);
  serverIntegrationClosers.set(server, listener.closeIntegrations);
  server.once("close", () => void listener.closeIntegrations());
  return server;
}

/**
 * The routable listener. TLS is terminated here, from the operator's own
 * certificate, and there is no code path that produces a plaintext one.
 */
export function createSelfHostedPlaneServer(
  binding: SelfHostedBinding,
  options: LocalPlaneOptions = {},
): SecureServer {
  const listener = planeListener(binding, options);
  const server = createSecureServer(
    { cert: binding.tls.cert, key: binding.tls.key, minVersion: "TLSv1.2" },
    listener,
  );
  serverIntegrationClosers.set(server, listener.closeIntegrations);
  server.once("close", () => void listener.closeIntegrations());
  return server;
}

async function handleRequest(
  binding: PlaneBinding,
  req: IncomingMessage,
  res: ServerResponse,
  options: LocalPlaneOptions,
  assets: string | null,
  integrations: LocalIntegrationRuntime,
): Promise<void> {
  // THE positional gate. It reads only socket/Host/Origin and runs once before
  // the raw request target, any credential, or local history is inspected.
  const position = admitRequestPosition(binding, req);
  if (!position.admitted) {
    sendJson(binding, res, 403, { error: "request origin rejected" });
    return;
  }

  const route = classifyLocalPlaneRequestTarget(req.url, req.method);
  if (route.authority === "reserved-refusal") {
    sendReservedRefusal(binding, res, route);
    return;
  }

  if (route.authority === "ordinary" || route.authority === "management") {
    if (admitOperatorRequest(binding, req) === "unauthenticated") {
      sendOperatorRequired(binding, res);
      return;
    }
  }
  if (route.authority === "management") {
    await handleIntegrationManagement(
      binding,
      route,
      req,
      res,
      position.origin,
      options,
      integrations,
    );
    return;
  }
  if (route.authority === "api") {
    // Only the resolve read has a body. It is read, bounded, before authorization,
    // so an oversized body is refused without buffering it; the handler still
    // authorizes before it parses a byte of it.
    const body = route.route === "resolve"
      ? {
          contentType: typeof req.headers["content-type"] === "string"
            ? req.headers["content-type"]
            : undefined,
          bytes: await readBodyBytes(req, PRIVATE_SESSION_RESOLVE_MAX_BODY_BYTES),
        }
      : undefined;
    const response = handleLocalPrivateApi(
      route,
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : undefined,
      new URL("/api/v1", `${position.origin}/`).toString(),
      {
        ...(options.directory === undefined ? {} : { directory: options.directory }),
        ...(options.integrationNow === undefined ? {} : { now: options.integrationNow }),
        ...(body === undefined ? {} : { body }),
      },
    );
    sendJson(binding, res, response.status, response.value, response.headers);
    return;
  }
  if (route.authority === "mcp") {
    await integrations.serveMcp(binding, route, req, res, position.origin);
    return;
  }

  const directory = options.directory;
  const method = req.method!;
  const url = route.url;
  const path = url.pathname;
  const directoryOption = directory === undefined ? {} : { directory };

  // Sign-out. There is no browser session to destroy on a plane that mints no
  // operator credential. The web client throws on any status other than
  // 2xx/400/401, so answering
  // 405 would turn "log out" into an unhandled rejection. The app clears its
  // own state and re-enters through the `/data-plane` probe, which is the
  // truthful outcome: you cannot be signed out of your own computer.
  if (method === "DELETE" && path === "/auth/session") {
    sendJson(binding, res, 200, { ok: true });
    return;
  }
  // Answered BEFORE the method allowlist, and for every method. Public presence
  // is a declared surface this plane does not serve, so 501 is the truthful
  // answer to all of `GET /manifest`, `PUT /manifest`, and the `POST` publish,
  // revoke, and retry calls. Letting the allowlist answer 405 first would say
  // "wrong verb for a route that lives here", which is the opposite of true.
  if (isPublicationPath(path)) {
    sendUnavailable(binding, res, "publication");
    return;
  }
  if (method !== "GET" && method !== "PUT") {
    sendJson(binding, res, 405, { error: "method not allowed" });
    return;
  }

  if (method === "PUT") {
    if (path !== "/settings") {
      sendJson(binding, res, 405, { error: "method not allowed" });
      return;
    }
    const body = await readBody(req);
    if (body === null) {
      sendJson(binding, res, 413, { error: "settings payload too large" });
      return;
    }
    let patch: unknown;
    try {
      patch = JSON.parse(body);
    } catch {
      patch = undefined;
    }
    if (!isPlainObject(patch)) {
      sendJson(binding, res, 400, { error: "settings payload must be an object" });
      return;
    }
    // `x-seorak-csrf` arrives on this write and is deliberately not verified,
    // on EITHER binding. The guard that matters already ran. A cross-site PUT
    // carrying `content-type: application/json` needs a CORS preflight this
    // plane never answers, and the positional gate refuses a foreign `Origin`
    // or `Host` outright. On the self-hosted binding the credential adds a second
    // structural reason: it is read from `Authorization` and nowhere else, and a
    // cross-site page cannot set that header without the same absent preflight,
    // so it can never ride along the way a cookie would. Checking a token the
    // app may not hold (the `/data-plane` entry path stores none) would refuse
    // the operator's own writes to prove something already proven.
    sendJson(binding, res, 200, writeLocalSettings(patch, directory));
    return;
  }

  switch (path) {
    case "/data-plane":
      // The self-hosted binding describes ITSELF, not the loopback plane it
      // shares a database with: `remote` / `self-hosted`, credential required,
      // and structurally no lifecycle window. See `selfHostedDataPlaneStatus`.
      sendJson(
        binding,
        res,
        200,
        binding.mode === "loopback"
          ? localDataPlaneStatus(directoryOption)
          : selfHostedDataPlaneStatus(directoryOption),
      );
      return;

    case "/health":
      sendJson(binding, res, 200, {
        ok: true,
        authority: binding.mode === "loopback" ? "local" : "remote",
      });
      return;

    case "/auth/check":
      // The dashboard's boot gate restores a session here before it will render
      // anything (DashboardApp -> authActions.restore -> restoreSession), and a
      // body it does not recognise drops the user on the sign-in screen. So the
      // plane answers with the session shape.
      //
      // That is not a fabricated credential. A loopback request from this
      // machine IS the authority — the descriptor says `credentialRequired:
      // false` for exactly that reason — and the `csrfToken` is a real
      // same-origin proof, minted per plane start and never persisted, which is
      // the one thing loopback position cannot supply on its own.
      //
      // On the self-hosted binding this route is reached ONLY by a caller that
      // already presented the credential, so a 200 here is the truthful answer
      // to "is this credential good?". A caller without one never arrives: the
      // closed classifier selected ordinary authority, then the operator gate
      // answered 401 before this handler or history work, which is exactly what
      // the dashboard's sign-in path reads as "ask for a credential".
      sendJson(binding, res, 200, { mode: "session", csrfToken: csrfToken() });
      return;

    case "/workspace":
      // A local plane is one person's own machine. There is no cell, no
      // membership, and nothing shared — which is exactly a Personal scope with
      // no other members, not an invented workspace.
      sendJson(binding, res, 200, { mode: "personal", members: [] });
      return;

    case "/live":
      // Budgeted on EVERY binding, unlike the session-outcome read which leaves
      // loopback unbounded on the argument that the caller is the person at the
      // keyboard. That argument is about fairness; this is about latency, and it
      // does not survive an endpoint the dashboard polls every 8 seconds on the
      // same thread that serves everything else. A board over budget refuses
      // rather than truncating, matching the worker's `/live` exactly.
      try {
        sendJson(
          binding,
          res,
          200,
          buildLocalLive({
            ...directoryOption,
            rowBudget: SESSION_MATERIALIZATION_MAX_ROWS,
          }),
        );
      } catch (error) {
        if (error instanceof LocalLiveMaterializationTooLargeError) {
          const refusal: SessionMaterializationRefusal = {
            error: "session materialization too large",
            code: "session_materialization_limit",
            detail:
              "The live board holds too many sessions for one complete response. No partial board was returned.",
            projectedRows: error.projectedRows,
            maxRows: error.rowBudget,
          };
          sendJson(binding, res, 413, refusal);
          return;
        }
        throw error;
      }
      return;

    case "/overview": {
      const requested = Number.parseInt(url.searchParams.get("days") ?? "", 10);
      // The worker falls back to the narrowest window for an unparseable
      // request; matching that keeps a bad query cheap rather than refused.
      const rangeDays = isOverviewRangeDays(requested)
        ? requested
        : OVERVIEW_RANGE_DAYS[0];
      // No ETag on purpose. The conditional GET exists to protect the hosted
      // aggregate's D1 read budget; on loopback there is no budget to protect,
      // and an ETag that never changes would be the lie that costs a refresh.
      // Read here rather than inside the projection so the projection stays a
      // pure function of (database, options) and the archive can be driven from
      // a test without a settings file on disk.
      // `SettingsDocument` is deliberately `Record<SettingsFamily, unknown>`, so
      // the coerce is what types this. It is idempotent — readLocalSettings has
      // already run it — and re-running costs one object walk per overview read.
      const archivedRepoIds = new Set(
        Object.keys(
          coerceProjectArchive(
            readLocalSettings(directoryOption.directory).projectArchive,
          ).byRepo,
        ),
      );
      sendJson(
        binding,
        res,
        200,
        await serveProjection(
          "overview",
          directoryOption.directory,
          { rangeDays, archivedRepoIds: [...archivedRepoIds].sort() },
          (nowMs) => ({
            kind: "overview",
            directory: directoryOption.directory ?? null,
            nowMs,
            rangeDays,
            archivedRepoIds: [...archivedRepoIds],
          }),
          (nowMs) =>
            buildLocalOverview({
              ...directoryOption,
              nowMs,
              rangeDays,
              archivedRepoIds,
            }),
        ),
      );
      return;
    }

    case "/sessions": {
      const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
      const limit = Number.isSafeInteger(rawLimit)
        ? Math.max(1, Math.min(SESSION_PAGE_MAX_LIMIT, rawLimit))
        : SESSION_PAGE_DEFAULT_LIMIT;
      sendJson(
        binding,
        res,
        200,
        buildLocalSessionPage({
          ...directoryOption,
          cursor: url.searchParams.get("cursor"),
          limit,
          repoId: url.searchParams.get("repoId"),
        }),
      );
      return;
    }

    case "/settings":
      sendJson(binding, res, 200, readLocalSettings(directory));
      return;

    case "/developer-model": {
      const requested = Number.parseInt(url.searchParams.get("days") ?? "", 10);
      const rangeDays = isOverviewRangeDays(requested)
        ? requested
        : OVERVIEW_RANGE_DAYS[0];
      const repoId = url.searchParams.get("repoId");
      sendJson(
        binding,
        res,
        200,
        await serveProjection(
          "developerModel",
          directoryOption.directory,
          { rangeDays, repoId },
          (nowMs) => ({
            kind: "developerModel",
            directory: directoryOption.directory ?? null,
            nowMs,
            rangeDays,
            repoId,
          }),
          (nowMs) =>
            buildLocalDeveloperModel({
              ...directoryOption,
              nowMs,
              rangeDays,
              repoId,
            }),
        ),
      );
      return;
    }

    case "/interventions":
      // The rolling day of what actually crossed a threshold on this machine.
      // The sweep that writes it runs in the daemon; this read never evaluates,
      // so opening the history cannot itself fire a watch. That is what keeps
      // the self-hosted binding incapable of posting a banner on the host: a
      // credentialed reader reads the ledger and never runs the engine.
      sendJson(binding, res, 200, listLocalInterventions(directoryOption));
      return;

    case "/delivery-health":
      sendUnavailable(binding, res, "deliveryHealth");
      return;

    default:
      break;
  }

  const outcome = path.match(/^\/sessions\/([^/]+)\/outcome$/);
  if (outcome !== null) {
    // The row budget is applied on the ROUTABLE binding only, and this is the
    // one route where the two bindings deliberately answer differently.
    //
    // Loopback keeps no budget for the reason stage A4 gave: it reads the local
    // file the user already owns, so a refusal would only withhold their own
    // history from them. That argument rests entirely on the caller being the
    // person at the keyboard, which loopback proves positionally. A routable
    // socket proves nothing of the kind: the caller is whoever holds the
    // credential, the scan is unbounded per session, and the response is a fixed
    // handful of counts either way, so the request is cheap and the work is not.
    // The hosted route refuses exactly that shape, and the refusal travels in the
    // shared `SessionOutcomeRefusal` wire form so no client learns a second
    // dialect.
    let built: SessionOutcome | null;
    try {
      built = buildLocalSessionOutcome(decodeURIComponent(outcome[1]!), {
        ...directoryOption,
        rowBudget: binding.mode === "loopback" ? null : SESSION_OUTCOME_MAX_ROWS,
      });
    } catch (error) {
      if (error instanceof LocalSessionOutcomeTooLargeError) {
        const refusal: SessionOutcomeRefusal = {
          error: "session outcome too large",
          code: "session_outcome_limit",
          detail:
            "This session has too many outcome events for one complete response. No partial outcome was returned.",
          projectedRows: error.projectedRows,
          maxRows: error.rowBudget,
        };
        sendJson(binding, res, 413, refusal);
        return;
      }
      throw error;
    }
    if (built === null) {
      sendJson(binding, res, 404, { error: "not found" });
      return;
    }
    sendJson(binding, res, 200, built);
    return;
  }

  const session = path.match(/^\/sessions\/([^/]+)$/);
  if (session !== null) {
    const summary = buildLocalSessionSummary(
      decodeURIComponent(session[1]!),
      directoryOption,
    );
    if (summary === null) {
      sendJson(binding, res, 404, { error: "not found" });
      return;
    }
    sendJson(binding, res, 200, summary);
    return;
  }

  const replay = path.match(/^\/replay\/([^/]+)$/);
  if (replay !== null) {
    // Budgeted on the ROUTABLE binding and not on loopback, which is the split
    // the outcome route earlier in this same switch already argues for and this
    // route did not have.
    //
    // It did not have it because it passed no `rowBudget` AT ALL, so the
    // default at `buildLocalReplay` applied and BOTH bindings read every row of
    // a session with no window. The outcome route's own comment says why that
    // is wrong on a socket: the caller is whoever holds the credential, the
    // scan is unbounded per session, and the request is cheap while the work is
    // not. Nothing in that argument was ever specific to outcomes.
    //
    // The budget counts ALL event kinds, because the first-party replay is the
    // all-event sequence (see `kinds` on `buildLocalReplayOnDatabase`); the
    // narrower integration lens tops out lower on the same session. Measured on
    // the author's history on 2026-09-09, the largest session of 5,605 holds
    // 10,316 rows and answers a replay in 47 to 88 ms over eleven warm runs on
    // an idle machine, and it is the ONLY session over this budget. The bound is
    // not there because tens of milliseconds are expensive. It is there because
    // nothing in the route said what the ceiling was, on a socket where the
    // caller is whoever holds the credential.
    //
    // The refusal body is the worker's, field for field
    // (`registerProductReadRoutes.ts`), so a client that already understands a
    // hosted replay refusal needs no second dialect for this one.
    let built: ReplaySession | null;
    try {
      built = buildLocalReplay(decodeURIComponent(replay[1]!), {
        ...directoryOption,
        rowBudget: binding.mode === "loopback" ? null : SESSION_REPLAY_MAX_ROWS,
      });
    } catch (error) {
      if (error instanceof LocalReplayTooLargeError) {
        sendJson(binding, res, 413, {
          error: "replay too large",
          detail:
            "This session has too many events for one honest replay. No partial timeline was returned.",
          projectedRows: error.projectedRows,
          maxRows: error.rowBudget,
        });
        return;
      }
      throw error;
    }
    if (built === null) {
      sendJson(binding, res, 404, { error: "not found" });
      return;
    }
    sendJson(binding, res, 200, built);
    return;
  }

  if (assets !== null) {
    // The local plane is the PRODUCT, not the marketing site. The artifact it
    // serves is the dashboard alone now, so `/` could render it directly; the
    // redirect stays so the address bar shows the canonical `/dashboard` and a
    // bookmark from here matches one taken from a cell.
    if (path === "/") {
      res.writeHead(302, { ...headersFor(binding), location: "/dashboard" });
      res.end();
      return;
    }
    if (serveAsset(binding, res, assets, path)) return;
  }
  sendJson(binding, res, 404, { error: "not found" });
}

/**
 * Paths the dashboard's own client router owns, and the ONLY ones the SPA
 * document may answer.
 *
 * This mirrors `parseLocation` in `packages/web/src/lib/router.ts`: `/dashboard`,
 * `/dashboard/project/<id>`, and `/dashboard/<view>`, plus the `.html` spelling
 * the plane also redirects to. It is deliberately a SHAPE test rather than a
 * view list, so adding a dashboard view does not require editing this file; a
 * view the bundle does not know still renders the app's own not-found, which is
 * the app answering for itself rather than the plane guessing.
 */
export function isDashboardAppPath(path: string): boolean {
  const normalized = path.replace(/\/+$/, "") || "/";
  if (normalized === "/dashboard" || normalized === "/dashboard.html") return true;
  return (
    normalized.startsWith("/dashboard/") || normalized.startsWith("/dashboard.html/")
  );
}

/**
 * The dashboard is a single-page app: an in-app PATH resolves to the same
 * document and the client router takes it from there. Two things must NOT.
 *
 * A request that names a FILE does not — a missing chunk must 404 rather than
 * come back as HTML, which is the "expected a JavaScript module, got text/html"
 * failure that looks like a bundler bug and is really a router falling back too
 * eagerly.
 *
 * And a request for a path this plane does not serve does not, which is the
 * load-bearing half. The fallback used to answer ANY extensionless path, so with
 * a bundle installed `/entitlements`, `/api/v1/period-summary`, `/mcp/private`,
 * `/integrations`, `/devices`, `/recovery/v1/manifest`, and `/auth/handoff` all
 * returned `200 text/html`. That is a fabricated success for a route this plane
 * has never implemented, and it contradicts the honest-surfaces contract at the
 * top of this file. It was invisible only because no published collector carries
 * a bundle yet; packaging one would have made every one of those routes lie.
 * Restricting the fallback to the dashboard's own paths is what keeps an
 * unimplemented route a 404 whether or not a bundle happens to be installed.
 *
 * The integration families are now mounted, but the same property remains:
 * one raw-target classifier selects `/integrations`, `/api/v1/*`, and
 * `/mcp/private` before ordinary routing, so none can fall through to the SPA
 * document. Their exact owner/API/MCP authority answers whether or not a bundle
 * is installed; aliases and child paths remain closed refusals.
 */
function serveAsset(
  binding: PlaneBinding,
  res: ServerResponse,
  root: string,
  path: string,
): boolean {
  const direct = path === "/" ? null : resolveAsset(root, path);
  const asset =
    direct ??
    (extname(path) === "" && isDashboardAppPath(path)
      ? resolveAsset(root, "/index.html")
      : null);
  if (asset === null) return false;
  res.writeHead(200, {
    ...headersFor(binding),
    "content-type": asset.contentType,
    ...(asset.html ? { "content-security-policy": DASHBOARD_CSP } : {}),
  });
  res.end(readFileSync(asset.path));
  return true;
}

export interface StartedLocalPlane {
  server: Server | SecureServer;
  /** Base URL of the route contract. */
  url: string;
  /** Where the primary dashboard opens, or null when no bundle is installed. */
  dashboardUrl: string | null;
  /**
   * Why there is no dashboard URL, when the reason is a bundle this plane
   * REFUSED rather than one it never found. Null in both healthy cases, so a
   * caller prints it whenever it is present and needs no third state of its own.
   */
  dashboardRefusal: string | null;
  /**
   * Shut the plane down and RESOLVE.
   *
   * `server.close()` alone stops accepting and then waits for every open
   * connection, and a browser tab polling `/live` holds a keep-alive socket
   * open indefinitely — which turns a `seorak stop` or a launchd SIGTERM into a
   * hang, and the daemon's clean-exit contract into a lie. Idle sockets are
   * closed explicitly so shutdown is bounded by the requests actually in
   * flight.
   */
  close(): Promise<void>;
}

export async function startLocalPlane(
  options: LocalPlaneOptions & { port?: number } = {},
): Promise<StartedLocalPlane> {
  const port = options.port ?? DEFAULT_LOCAL_PLANE_PORT;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("local plane port must be an integer from 1 to 65535");
  }
  const server = createLocalPlaneServer(options);
  await new Promise<void>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePort());
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;
  return started(server, `http://127.0.0.1:${boundPort}`, options);
}

/**
 * Bind the routable listener.
 *
 * Everything that makes this safe was already decided by
 * `resolveSelfHostedBinding`, which either produced an origin, a credential, and
 * TLS material together or threw. There is deliberately no option here to bind
 * without one of them: a caller holding a `SelfHostedBinding` is holding proof
 * that all three were present.
 */
export async function startSelfHostedPlane(
  binding: SelfHostedBinding,
  options: LocalPlaneOptions = {},
): Promise<StartedLocalPlane> {
  const server = createSelfHostedPlaneServer(binding, options);
  await new Promise<void>((resolveBind, reject) => {
    server.once("error", reject);
    server.listen(binding.port, binding.bindAddress, () => resolveBind());
  });
  return started(server, binding.origin, options);
}

function started(
  server: Server | SecureServer,
  url: string,
  options: LocalPlaneOptions,
): StartedLocalPlane {
  const bundle = resolveDashboardBundle(options.assetsDirectory);
  return {
    server,
    url,
    dashboardUrl: bundle.state === "ready" ? `${url}/dashboard` : null,
    dashboardRefusal: dashboardBundleRefusal(bundle),
    close: async () => {
      let grace: NodeJS.Timeout | null = null;
      await new Promise<void>((done, reject) => {
        server.close((error) => error === undefined ? done() : reject(error));
        server.closeIdleConnections();
        // Bound shutdown even if a caller stalls a body or response. A
        // one-time credential response that is cut before `finish` is guarded
        // above and revokes its grant, so forcing the socket cannot strand an
        // unseen live secret.
        grace = setTimeout(() => server.closeAllConnections(), LOCAL_PLANE_SHUTDOWN_GRACE_MS);
        grace.unref();
      });
      if (grace !== null) clearTimeout(grace);
      await serverIntegrationClosers.get(server)?.();
      // After the server, so a build still feeding an in-flight response is not
      // terminated out from under it. The worker is unref'd and its outstanding
      // requests fail into the inline fallback, so this bounds the thread rather
      // than being what makes shutdown safe.
      await projectionThread.close();
    },
  };
}

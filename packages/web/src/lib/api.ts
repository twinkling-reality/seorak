// Seorak worker API client. Talks to the worker's public HTTP API only — no
// worker internals. Product reads use the worker's HttpOnly browser session;
// dogfood retains the stored owner-lock token. Settings writes add a CSRF proof
// for sessions or the legacy bearer for dogfood. No build-time credential and
// no build-time origin exists.

import { API_BASE, resolveApiBase } from './apiBase.js';
import {
  authHeader,
  controlAuthHeader,
  readAuthToken,
} from './token.js';
import {
  LEGACY_AGGREGATE_CACHE_STATUS_HEADERS,
  SESSION_MATERIALIZATION_MAX_ROWS,
  SESSION_PAGE_MAX_LIMIT,
  bearerHeader,
  coerceCaptureSettings,
  coerceNotificationSettings,
  coerceProjectArchive,
  coerceProjectMerges,
  coerceProjectThemes,
  conditionalGetHeaders,
  readAggregateCacheStatus,
  seorakRoutes,
  type AggregateCacheStatus,
  type CaptureSettings,
  type Intervention,
  type NotificationSettings,
  type OverviewSnapshot,
  type PaletteToken,
  type ProjectArchive,
  type ProjectMerges,
  type ProjectThemes,
  type SessionPage,
  type SessionPageCursor,
  type SessionSummary,
  type SettingsDocument,
  type SettingsFamily,
  type WorkspaceContext,
} from '@seorak/types';

/** A partial NotificationSettings write — the same SPARSE shape the worker
 *  deep-merges server-side (any subset of signals / quietHours / perProject).
 *
 *  `null` at any depth is the worker's DELETE tombstone. It has to be spelled
 *  out here because omission already means "leave this alone", and a per-project
 *  override is inherited by being absent — so returning one to inherited is a
 *  deletion, and a patch that merely omits it merges back into the stored value
 *  and changes nothing. See `deepMerge` in the worker's notificationSettings.ts. */
type Tombstoned<T> = { [K in keyof T]?: T[K] extends object ? Tombstoned<T[K]> | null : T[K] | null };

type NotificationSettingsPatch = {
  signals?: Tombstoned<NotificationSettings['signals']>;
  quietHours?: Partial<NotificationSettings['quietHours']>;
  perProject?: Tombstoned<NotificationSettings['perProject']>;
  workspaceDelivery?: NotificationSettings['workspaceDelivery'];
};

/** The origin every path below is prefixed with, resolved in `apiBase.ts` so the
 *  entry chunk can reach it without pulling this client in behind it. Re-exported
 *  because most callers already import the client, and two import sites for one
 *  string is how two answers start. */
export { API_BASE, resolveApiBase };

interface FetchOptions {
  signal?: AbortSignal;
}

/**
 * The capability named by a 402, or null.
 *
 * Bounded and total: a gate that cannot be read must never turn a failed read
 * into a thrown parse error on top of it, and a body that is not the shape the
 * cell documents is treated as absent rather than half-believed.
 */
async function readGatedCapability(res: Response): Promise<string | null> {
  if (res.status !== 402) return null;
  try {
    const body: unknown = await res.clone().json();
    if (typeof body !== 'object' || body === null) return null;
    const capability = (body as { capability?: unknown }).capability;
    return typeof capability === 'string' && capability.length > 0 ? capability : null;
  } catch {
    return null;
  }
}

async function getJson(path: string, options: FetchOptions = {}): Promise<unknown> {
  const init: RequestInit = { headers: authHeader() };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const err = new Error(`GET ${path} failed: ${res.status}`) as Error & {
      status: number;
      refusal?: unknown;
    };
    err.status = res.status;
    // A REFUSAL carries its reason in the body, and a status code alone throws
    // that reason away. Both planes answer 413 with `detail`, `projectedRows`
    // and `maxRows` for a read they declined to serve partially, so keeping the
    // body is what lets a view say what was refused instead of printing a
    // number. Only for 413: every other failure here is a status, not a message.
    if (res.status === 413) {
      try {
        err.refusal = await res.json();
      } catch {
        // A refusal that is not JSON is still a refusal; the caller falls back
        // to its own wording.
      }
    }
    throw err;
  }
  return res.json();
}

/**
 * GET /auth/check — the owner-lock validation probe. Sends the candidate token as
 * `Authorization: Bearer <token>`; the worker 401s a wrong/absent token when armed
 * and 200s when it matches (or when the worker is open). Used by the auth store's
 * `authenticate()` so a pasted token is verified before we let the user in, instead
 * of the old accept-anything behavior. Returns true on 200, false on 401; other
 * failures (network/500) throw so the caller can surface a distinct message.
 */
export async function checkAuth(token: string, options: FetchOptions = {}): Promise<boolean> {
  const init: RequestInit = { headers: bearerHeader(token), cache: 'no-store' };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(`${API_BASE}${seorakRoutes.authCheck()}`, init);
  if (res.status === 401) return false;
  if (!res.ok) {
    const err = new Error(`GET /auth/check failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return true;
}

export interface BrowserSessionResult {
  csrfToken: string;
}

function parseBrowserSessionBody(value: unknown): BrowserSessionResult {
  const csrfToken =
    value && typeof value === 'object' && 'csrfToken' in value
      ? (value as { csrfToken?: unknown }).csrfToken
      : null;
  if (typeof csrfToken !== 'string' || csrfToken.length < 32) {
    throw new Error('browser session response invalid');
  }
  return { csrfToken };
}

/** Product path: the read bearer exists in JS only for this exchange. */
export async function createSession(
  token: string,
  options: FetchOptions = {},
): Promise<BrowserSessionResult | null> {
  const init: RequestInit = {
    method: 'POST',
    headers: bearerHeader(token),
    cache: 'no-store',
  };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(`${API_BASE}${seorakRoutes.authSession()}`, init);
  if (res.status === 409) return null;
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) {
    const error = new Error(`POST /auth/session failed: ${res.status}`) as Error & {
      status: number;
    };
    error.status = res.status;
    throw error;
  }
  return parseBrowserSessionBody(await res.json());
}

/** Product OAuth path: exchange a one-time URL-fragment handoff on the cell. */
export async function createSessionFromHandoff(
  handoffCode: string,
  options: FetchOptions = {},
): Promise<BrowserSessionResult> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handoffCode }),
    cache: 'no-store',
  };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(`${API_BASE}${seorakRoutes.authHandoff()}`, init);
  if (!res.ok) {
    const error = new Error(`POST /auth/handoff failed: ${res.status}`) as Error & {
      status: number;
    };
    error.status = res.status;
    throw error;
  }
  return parseBrowserSessionBody(await res.json());
}

export async function restoreSession(
  options: FetchOptions = {},
): Promise<BrowserSessionResult | null> {
  const init: RequestInit = { cache: 'no-store' };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(`${API_BASE}${seorakRoutes.authCheck()}`, init);
  if (res.status === 401) return null;
  if (!res.ok) return null;
  const body = (await res.json()) as { mode?: unknown };
  return body.mode === 'session' ? parseBrowserSessionBody(body) : null;
}

export async function deleteSession(): Promise<void> {
  const res = await fetch(`${API_BASE}${seorakRoutes.authSession()}`, {
    method: 'DELETE',
    headers: controlAuthHeader(),
    cache: 'no-store',
  });
  if (!res.ok && res.status !== 400 && res.status !== 401) {
    const error = new Error(`DELETE /auth/session failed: ${res.status}`) as Error & {
      status: number;
    };
    error.status = res.status;
    throw error;
  }
}

/** The result of a conditional GET /overview. */
export interface OverviewResult {
  /** true when the server answered 304 Not Modified — the caller KEEPS its prior
   *  snapshot (the body was not rebuilt server-side; this is the cheap path). */
  notModified: boolean;
  /** Raw JSON body to validate against the OverviewSnapshot schema. Absent on 304. */
  data?: unknown;
  /** The ETag to echo as If-None-Match on the next poll (null when the worker
   *  sent none — e.g. its meta table isn't migrated yet, so every poll is a full
   *  body and notModified is never true). */
  etag: string | null;
  /** Whether these bytes are current or a last-known-good response. */
  cacheStatus: AggregateCacheStatus;
}

/**
 * Conditional GET /overview?days=<7|30|90>. Sends `If-None-Match: <etag>` so an
 * unchanged poll comes back 304 — the worker skips the aggregate fan-out and we
 * keep the prior snapshot (DATA-LAYER-ARCHITECTURE §ADR-002, the property that
 * lets a tab stay open all day without burning the D1 free-tier read cap).
 * `cache: 'no-store'` so the browser doesn't transparently satisfy/!revalidate
 * the request from its own cache — we drive the 304 explicitly. The caller
 * validates `data` against the OverviewSnapshot zod schema.
 */
export async function fetchOverview(
  rangeDays: number,
  options: FetchOptions & { etag?: string | null } = {},
): Promise<OverviewResult> {
  const headers = conditionalGetHeaders(readAuthToken(), options.etag);
  const init: RequestInit = { headers, cache: 'no-store' };
  if (options.signal) init.signal = options.signal;

  const res = await fetch(`${API_BASE}${seorakRoutes.overview(rangeDays)}`, init);
  if (res.status === 304) {
    return {
      notModified: true,
      etag: options.etag ?? null,
      cacheStatus: readAggregateCacheStatus(
        res.headers,
        LEGACY_AGGREGATE_CACHE_STATUS_HEADERS.overview,
      ),
    };
  }
  if (!res.ok) {
    const err = new Error(`GET /overview?days=${rangeDays} failed: ${res.status}`) as Error & {
      status: number;
      capability?: string;
    };
    err.status = res.status;
    // A 402 names the hosted capability the owner has not bought. It is the one
    // failure body worth reading: without it the dashboard can only report the
    // number, and a plan gate rendered as a bare `402` reads as a breakage.
    const capability = await readGatedCapability(res);
    if (capability) err.capability = capability;
    throw err;
  }
  const cacheStatus = readAggregateCacheStatus(
    res.headers,
    LEGACY_AGGREGATE_CACHE_STATUS_HEADERS.overview,
  );
  return {
    notModified: false,
    data: await res.json(),
    etag: res.headers.get('etag'),
    cacheStatus,
  };
}

export interface DeveloperModelResult {
  notModified: boolean;
  data?: unknown;
  etag: string | null;
  cacheStatus: AggregateCacheStatus;
}

/** On-demand GET /developer-model — slow-loop portrait; not polled with /overview. */
export async function fetchDeveloperModel(
  rangeDays: number,
  options: FetchOptions & { etag?: string | null; repoId?: string | null } = {},
): Promise<DeveloperModelResult> {
  const headers = conditionalGetHeaders(readAuthToken(), options.etag);
  const init: RequestInit = { headers, cache: 'no-store' };
  if (options.signal) init.signal = options.signal;

  const path = seorakRoutes.developerModel(rangeDays, options.repoId);
  const res = await fetch(`${API_BASE}${path}`, init);
  if (res.status === 304) {
    return {
      notModified: true,
      etag: options.etag ?? null,
      cacheStatus: readAggregateCacheStatus(
        res.headers,
        LEGACY_AGGREGATE_CACHE_STATUS_HEADERS.developerModel,
      ),
    };
  }
  if (!res.ok) {
    const err = new Error(`GET /developer-model failed: ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
  const cacheStatus = readAggregateCacheStatus(
    res.headers,
    LEGACY_AGGREGATE_CACHE_STATUS_HEADERS.developerModel,
  );
  return {
    notModified: false,
    data: await res.json(),
    etag: res.headers.get('etag'),
    cacheStatus,
  };
}

/**
 * GET /live — the fresh, zero-D1 live-session head (DATA-LAYER §ADR-002). Polled
 * on its own fast adaptive cadence for the live feel, independent of the heavier
 * /overview body. No ETag/304: it is already one KV get, so a conditional GET
 * buys nothing. `cache: 'no-store'` so the browser can't serve a stale board from
 * its own cache. Returns the raw JSON; the caller validates it against
 * liveSnapshotSchema (`{ generatedAt, live }`).
 */
export async function fetchLive(options: FetchOptions = {}): Promise<unknown> {
  const init: RequestInit = { cache: 'no-store', headers: authHeader() };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(`${API_BASE}${seorakRoutes.live()}`, init);
  if (!res.ok) {
    const err = new Error(`GET /live failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** One bounded GET /sessions keyset page. */
export async function fetchSessionPage(
  cursor: SessionPageCursor | null = null,
  options: FetchOptions = {},
): Promise<SessionPage> {
  const data = await getJson(
    seorakRoutes.sessions({ cursor, limit: SESSION_PAGE_MAX_LIMIT }),
    options,
  );
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('GET /sessions: expected a page');
  }
  const page = data as Record<string, unknown>;
  if (
    !Array.isArray(page.sessions) ||
    page.sessions.length > SESSION_PAGE_MAX_LIMIT ||
    (page.nextCursor !== null && typeof page.nextCursor !== 'string')
  ) {
    throw new Error('GET /sessions: invalid page');
  }
  return page as unknown as SessionPage;
}

/** Traverse bounded worker pages for consumers that need the complete readable
 * session set. A repeated cursor is malformed rather than a plausible partial
 * list. */
export async function fetchSessions(options: FetchOptions = {}): Promise<SessionSummary[]> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sessions: SessionSummary[] = [];
    const seen = new Set<SessionPageCursor>();
    let cursor: SessionPageCursor | null = null;
    try {
      do {
        const page = await fetchSessionPage(cursor, options);
        if (
          sessions.length + page.sessions.length > SESSION_MATERIALIZATION_MAX_ROWS ||
          (sessions.length + page.sessions.length === SESSION_MATERIALIZATION_MAX_ROWS &&
            page.nextCursor !== null)
        ) {
          throw new Error('GET /sessions: materialization limit exceeded');
        }
        sessions.push(...page.sessions);
        cursor = page.nextCursor;
        if (cursor !== null && seen.has(cursor)) {
          throw new Error('GET /sessions: repeated cursor');
        }
        if (cursor !== null) seen.add(cursor);
      } while (cursor !== null);
      return sessions;
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status !== 409 || attempt === 2) throw error;
      // A projection changed between pages. Discard every partial row and
      // explicitly restart from the first page under the new collection epoch.
    }
  }
  throw new Error('GET /sessions: traversal did not settle');
}

/** The isolated cell this browser session currently inhabits. */
export async function fetchWorkspaceContext(
  options: FetchOptions = {},
): Promise<WorkspaceContext> {
  const data = await getJson(seorakRoutes.workspace(), options);
  if (!data || typeof data !== 'object') {
    throw new Error('GET /workspace: expected an object');
  }
  const record = data as Record<string, unknown>;
  if (
    (record.mode !== 'personal' && record.mode !== 'workspace') ||
    !Array.isArray(record.members)
  ) {
    throw new Error('GET /workspace: invalid context');
  }
  const members = record.members.map((value) => {
    if (!value || typeof value !== 'object') {
      throw new Error('GET /workspace: invalid member');
    }
    const member = value as Record<string, unknown>;
    if (
      typeof member.memberId !== 'string' ||
      typeof member.displayName !== 'string'
    ) {
      throw new Error('GET /workspace: invalid member');
    }
    return {
      memberId: member.memberId,
      displayName: member.displayName,
    };
  });
  if (
    record.mode === 'workspace' &&
    (typeof record.workspaceId !== 'string' ||
      typeof record.workspaceName !== 'string')
  ) {
    throw new Error('GET /workspace: invalid shared context');
  }
  const currentMember =
    record.currentMember && typeof record.currentMember === 'object'
      ? (record.currentMember as Record<string, unknown>)
      : null;
  return {
    mode: record.mode,
    ...(typeof record.workspaceId === 'string'
      ? { workspaceId: record.workspaceId }
      : {}),
    ...(typeof record.workspaceName === 'string'
      ? { workspaceName: record.workspaceName }
      : {}),
    ...(typeof record.controlPlaneUrl === 'string'
      ? { controlPlaneUrl: record.controlPlaneUrl }
      : {}),
    ...(currentMember &&
    typeof currentMember.memberId === 'string' &&
    typeof currentMember.displayName === 'string'
      ? {
          currentMember: {
            memberId: currentMember.memberId,
            displayName: currentMember.displayName,
          },
        }
      : {}),
    members,
  };
}

/** Explicitly join two machine-salted cards for the same workspace project. */
export async function claimWorkspaceProject(input: {
  canonicalRepoId: string;
  joiningRepoId: string;
}): Promise<void> {
  const res = await fetch(`${API_BASE}${seorakRoutes.workspaceProjectClaims()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...controlAuthHeader() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = new Error(`POST /workspace/project-claims failed: ${res.status}`) as Error & {
      status: number;
    };
    err.status = res.status;
    throw err;
  }
}

/** GET /interventions — the fired interventions the wedge engine has surfaced.
 *  Returns the raw JSON; the caller validates it against interventionsArraySchema
 *  (honest-empty [] when nothing has fired). */
export function fetchInterventions(options: FetchOptions = {}): Promise<unknown> {
  return getJson(seorakRoutes.interventions(), options);
}

/** GET /delivery-health. The settings surface validates the raw response through
 * pushDeliveryHealthSchema before it renders any operational claim. */
export function fetchPushDeliveryHealth(
  options: FetchOptions = {},
): Promise<unknown> {
  return getJson(seorakRoutes.deliveryHealth(), options);
}

/** GET /replay/:sessionId — the keyframe timeline for one past session. Returns
 *  the raw JSON; the caller validates it against replaySessionSchema (honest-
 *  empty keyframes:[] when the session produced no qualifying moments). The
 *  session id is path-encoded so an opaque id never breaks the URL. */
export function fetchReplay(sessionId: string, options: FetchOptions = {}): Promise<unknown> {
  return getJson(seorakRoutes.replay(sessionId), options);
}

/**
 * The `/settings` control plane, as ONE read and ONE write.
 *
 * The worker serves every settings family under a single GET /settings and
 * deep-merges any subset on PUT, so each family used to be a near-identical
 * ~35-line fetch/coerce pair here. They are two generics now (the same shape
 * mobile's settingsClient already uses), and a new family is one three-line
 * wrapper rather than another copy of the auth header and the error branch.
 *
 * Every read runs its family's `coerce*` helper because persisted settings are
 * sparse patches and can be malformed independently of the measured overview.
 * Never silently disable a default-on watch.
 */
async function getSettingsFamily<T>(
  family: SettingsFamily,
  coerce: (raw: unknown) => T,
  options: FetchOptions = {},
): Promise<T> {
  const data = (await getJson(seorakRoutes.settings(), options)) as Partial<SettingsDocument>;
  return coerce(data?.[family]);
}

/**
 * Write ONE family, sparsely. A product browser's session has this narrow control
 * permission only when accompanied by its same-origin CSRF proof; it never gains
 * collector ingest authority. Dogfood retains bearer behavior. The patch is
 * sparse and server-merged, so one toggle never clobbers a sibling family.
 */
async function putSettingsFamily<T>(
  family: SettingsFamily,
  patch: unknown,
  coerce: (raw: unknown) => T,
): Promise<T> {
  const res = await fetch(`${API_BASE}${seorakRoutes.settings()}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...controlAuthHeader() },
    body: JSON.stringify({ [family]: patch }),
  });
  if (!res.ok) {
    const err = new Error(`PUT /settings failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as Partial<SettingsDocument>;
  return coerce(data?.[family]);
}

/** The Data & capture toggles the collector enforces on-machine. */
export function fetchCaptureSettings(options: FetchOptions = {}): Promise<CaptureSettings> {
  return getSettingsFamily('capture', coerceCaptureSettings, options);
}

export function updateCaptureSettings(patch: Partial<CaptureSettings>): Promise<CaptureSettings> {
  return putSettingsFamily('capture', patch, coerceCaptureSettings);
}

/** The notification control plane: per-stat toggles and thresholds, quiet hours,
 *  and per-project mutes, all resolved by the worker when it evaluates a watch. */
export function fetchNotificationSettings(
  options: FetchOptions = {},
): Promise<NotificationSettings> {
  return getSettingsFamily('notifications', coerceNotificationSettings, options);
}

export function updateNotificationSettings(
  patch: NotificationSettingsPatch,
): Promise<NotificationSettings> {
  return putSettingsFamily('notifications', patch, coerceNotificationSettings);
}

// The per-project COLOR family (projectThemes) has no web client on purpose. The
// worker serves it and the phone writes it, via apps/mobile/src/lib/projectThemesApi.ts;
// the dashboard has never had a project-color surface. A read/write pair lived here
// with no caller, so it went rather than waiting for one.

/** A project-merge patch: map a duplicate repoId to the canonical repoId it folds
 *  into, or null to un-merge it (the coerce drops the null / self-map entry). */
type ProjectMergesPatch = {
  byRepo: Record<string, string | null>;
};

/** The project-ALIAS control plane, the repo-identity fragmentation fix. */
export function fetchProjectMerges(options: FetchOptions = {}): Promise<ProjectMerges> {
  return getSettingsFamily('projectMerges', coerceProjectMerges, options);
}

export function updateProjectMerges(patch: ProjectMergesPatch): Promise<ProjectMerges> {
  return putSettingsFamily('projectMerges', patch, coerceProjectMerges);
}

/** A project-archive patch: repoId → the archive entry, or null to RESTORE it
 *  (the coerce drops a null, and an entry with no parseable `archivedAt` too, so
 *  a corrupt row resolves to "not archived" — the state that shows you more). */
type ProjectArchivePatch = {
  byRepo: Record<string, { archivedAt: string } | null>;
};

/** Put a project away without deleting a thing. Distinct from a merge: a merge
 *  says two cards are ONE project, an archive says this project is real but not
 *  one you are working on. */
export function fetchProjectArchive(options: FetchOptions = {}): Promise<ProjectArchive> {
  return getSettingsFamily('projectArchive', coerceProjectArchive, options);
}

export function updateProjectArchive(patch: ProjectArchivePatch): Promise<ProjectArchive> {
  return putSettingsFamily('projectArchive', patch, coerceProjectArchive);
}

export type {
  CaptureSettings,
  Intervention,
  NotificationSettings,
  NotificationSettingsPatch,
  OverviewSnapshot,
  SessionSummary,
};

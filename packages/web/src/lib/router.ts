// Lightweight URL router for the dashboard SPA.
// Syncs navigation state to browser history for deep linking, back/forward,
// and bookmarkable URLs. Zero dependencies.
//
// URL structure (relative to dashboard base):
//   /               → overview
//   /project/:id    → per-repo view (id = repo id)
//   /compare        → period compare by default; explicit repo A/B in ?mode=repos
//   /agents         → cross-tool agent compare (Claude vs Codex)
//   /replay         → replay / keyframes (D1 event log is live; honest-empty per session until moments accrue)
//   /model          → developer model / introspection (slow loop; honest-empty until projection ships)
//   /settings       → settings view
//   /demo           → demo scenario catalog (dev / ?demo only)

import { useEffect, useSyncExternalStore } from 'react';

export type DashboardView =
  | 'overview'
  | 'project'
  | 'compare'
  | 'agents'
  | 'replay'
  | 'model'
  | 'settings'
  | 'demo';

export interface Route {
  view: DashboardView | 'not-found';
  /** Repo id when view === 'project'. */
  projectId: string | null;
}

export type AgentsSectionId =
  | 'verdict'
  | 'outcomes'
  | 'matrix'
  | 'where'
  | 'when'
  | 'models'
  | 'coverage';

export interface CompareNavigation {
  mode?: 'period' | 'repos';
  /** Stable repo id for a same-project period comparison. Omit for all work. */
  scope?: string | null;
  /** Stable repo ids for the explicit repo A/B mode. */
  a?: string | null;
  b?: string | null;
  range?: 7 | 30 | 90 | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let currentRoute = parseLocation();

function demoQuery(): string {
  const params = new URLSearchParams();
  const demo = new URLSearchParams(window.location.search).get('demo');
  if (demo !== null) params.set('demo', demo);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function parseLocation(): Route {
  const path = window.location.pathname
    .replace(/\/dashboard\.html\/?/, '/dashboard/')
    .replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) return { view: 'overview', projectId: null };
  if (segments[0] !== 'dashboard') return { view: 'not-found', projectId: null };
  if (segments.length === 1) return { view: 'overview', projectId: null };
  const route = segments[1];

  if (route === 'project' && segments.length === 3 && segments[2]) {
    const projectId = segments[2].trim();
    if (projectId.length > 0 && /^[\w.-]+$/.test(projectId)) {
      return { view: 'project', projectId };
    }
    return { view: 'not-found', projectId: null };
  }
  if (segments.length !== 2) return { view: 'not-found', projectId: null };
  if (route === 'compare') return { view: 'compare', projectId: null };
  if (route === 'agents') return { view: 'agents', projectId: null };
  if (route === 'replay') return { view: 'replay', projectId: null };
  if (route === 'model') return { view: 'model', projectId: null };
  if (route === 'settings') return { view: 'settings', projectId: null };
  if (route === 'demo') return { view: 'demo', projectId: null };
  return { view: 'not-found', projectId: null };
}

function emit() {
  currentRoute = parseLocation();
  for (const fn of listeners) fn();
}

function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return currentRoute;
}

/** Navigate to a new route, pushing a history entry. */
export function navigate(view: DashboardView, projectId?: string | null) {
  let path: string;
  if (view === 'project' && projectId) path = `/dashboard/project/${projectId}`;
  else if (view === 'compare') path = '/dashboard/compare';
  else if (view === 'agents') path = '/dashboard/agents';
  else if (view === 'replay') path = '/dashboard/replay';
  else if (view === 'model') path = '/dashboard/model';
  else if (view === 'settings') path = '/dashboard/settings';
  else if (view === 'demo') path = '/dashboard/demo';
  else path = '/dashboard';
  path += demoQuery();

  if (window.location.pathname + window.location.search !== path) {
    window.history.pushState(null, '', path);
    emit();
  }
}

/** Navigate to one canonical section of the Agents compare surface. */
export function navigateToAgents(section?: AgentsSectionId | null): void {
  const hash = section ? `#${section}` : '';
  const path = `/dashboard/agents${demoQuery()}${hash}`;
  if (window.location.pathname + window.location.search + window.location.hash !== path) {
    window.history.pushState(null, '', path);
    emit();
  }
}

/** Hook: returns the current route, re-renders on navigation. */
export function useRoute(): Route {
  useEffect(() => {
    window.addEventListener('popstate', emit);
    return () => window.removeEventListener('popstate', emit);
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Navigate to one complete Compare question. A bare destination means all work
 *  in the current seven-day window versus the immediately prior equal window.
 *  Repo A/B is an explicit secondary mode and all repo references are stable ids. */
export function navigateToCompare(options: CompareNavigation = {}): void {
  const params = new URLSearchParams(demoQuery());
  if (options.mode === 'repos') params.set('mode', 'repos');
  if (options.scope) params.set('scope', options.scope);
  if (options.a) params.set('a', options.a);
  if (options.b) params.set('b', options.b);
  if (options.range) params.set('range', String(options.range));
  const query = params.toString();
  const path = `/dashboard/compare${query ? `?${query}` : ''}`;
  if (window.location.pathname + window.location.search !== path) {
    window.history.pushState(null, '', path);
    emit();
  }
}

/** Navigate to Replay, optionally focused on one project + selected session. */
export function navigateToReplay(sessionId?: string | null, projectId?: string | null): void {
  const params = new URLSearchParams(demoQuery());
  if (projectId) params.set('projects', projectId);
  if (sessionId) params.set('sessions', sessionId);
  const query = params.toString();
  const path = `/dashboard/replay${query ? `?${query}` : ''}`;
  if (window.location.pathname + window.location.search !== path) {
    window.history.pushState(null, '', path);
    emit();
  }
}

/** Set or remove a query parameter, pushing a history entry. */
export function setQueryParam(key: string, value: string | null): void {
  setQueryParams({ [key]: value });
}

/** Set multiple query params in a single history entry. */
export function setQueryParams(params: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const next = url.pathname + url.search;
  if (window.location.pathname + window.location.search !== next) {
    window.history.pushState(null, '', next);
    emit();
  }
}

/** Hook: returns a single query param value, re-renders on navigation. */
export function useQueryParam(key: string): string | null {
  return useSyncExternalStore(subscribe, () =>
    new URLSearchParams(window.location.search).get(key),
  );
}

/** Hook: returns the canonical hash anchor without its leading '#'. */
export function useLocationHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash.replace(/^#/, ''));
}

/**
 * Detail-view drill-param keys. Each key opens a category-level detail view
 * inside OverviewView via `useDetailDrill(key)`. Reduced to the solo set:
 * live / usage / outcomes / activity / tools / codebase. Memory and
 * conversations drills are dropped (out of scope).
 */
export const DETAIL_DRILL_KEYS = [
  'live',
  'usage',
  'outcomes',
  'activity',
  'tools',
  'codebase',
] as const;

export type DetailViewKey = (typeof DETAIL_DRILL_KEYS)[number];

const DETAIL_AUX_KEYS = ['live-tab', 'q'] as const;

/**
 * Navigate atomically from any current detail view to a target detail view,
 * tab, and optional question. Clears every other detail drill param + the
 * shared `?q=` so the URL ends up with exactly one drill open.
 */
export function navigateToDetail(view: DetailViewKey, tab: string, q?: string): void {
  const params: Record<string, string | null> = {};
  for (const key of DETAIL_DRILL_KEYS) {
    if (key === view) {
      params[key] = view === 'live' ? '' : tab;
    } else {
      params[key] = null;
    }
  }
  for (const aux of DETAIL_AUX_KEYS) {
    if (aux === 'q') {
      params[aux] = q ?? null;
    } else if (aux === 'live-tab') {
      params[aux] = view === 'live' ? tab : null;
    } else {
      params[aux] = null;
    }
  }
  setQueryParams(params);
}

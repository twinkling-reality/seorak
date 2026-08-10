import type { Route } from '../lib/router.js';

export function marketingRouteKey(page: string, path: string): string {
  const normalized = path.replace(/\/+$/, '') || '/';
  if (page === 'surfaces') return `marketing:surfaces:${normalized}`;
  if (page === 'blog-post') return `marketing:blog-post:${normalized}`;
  /*
   * The developer reference is ONE key for all four of its page kinds
   * (`docs-api`, `docs-mcp`, and the two read routes), not one per read.
   *
   * Keying each read separately made selecting one from the rail remount the
   * route wrapper, so `routeEnter` faded the page from opacity 0 while the
   * page's own entrance animation faded the masthead, the rail, and the content
   * from opacity 0 underneath it. Two fades multiply, and over a near-white
   * field the result is a flash on a control the reader clicks repeatedly. The
   * chrome is identical between two reads and only the record changes, so it
   * swaps in place instead.
   */
  if (page.startsWith('docs-')) return 'marketing:docs';
  return `marketing:${page}`;
}

export function dashboardRouteKey(route: Route): string {
  if (route.view === 'project') return `dashboard:project:${route.projectId ?? ''}`;
  return `dashboard:${route.view}`;
}

export function dashboardDrillKey(host: 'overview' | 'project', drill: string | null): string {
  return drill ? `${host}:drill:${drill}` : `${host}:home`;
}


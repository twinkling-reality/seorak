/**
 * The dashboard's crash report shape (P1-19).
 *
 * Product deployments send the same content-free shape to their own worker.
 * Dogfood workers ignore that route, while the local console line remains useful.
 *
 * WHY THE OLD LINE WAS A PROBLEM. It was
 *   console.error(`[seorak] ${label} error:`, error, info.componentStack)
 * which serialized (a) the error message, (b) the error stack, and (c) React's
 * component stack. In a Vite dev build the component stack and the error stack both
 * contain `http://localhost:5173/src/...` frames — absolute module paths — and a
 * data-shape TypeError's message frequently quotes the offending value, which on
 * this dashboard is the owner's own session data. None of that belongs in a report
 * that a user might paste into an issue.
 *
 * So the report carries: a shape-checked section label, the error CLASS, and the
 * component stack DEPTH as a number. Never the message, the stack, or the frames.
 */

import { API_BASE } from '../../lib/apiBase.js';

export const RENDER_ERROR_SCHEMA = 'obs.v1';
export const RENDER_ERROR_SURFACE = 'web';

/**
 * Section labels are authored in JSX (`label="OverviewView"`), but at least one is
 * interpolated from a route-derived name, so the shape is enforced rather than
 * trusted: letters, digits and single spaces, bounded length. A label that fails
 * the shape becomes `unknown` instead of travelling verbatim.
 */
const LABEL_SHAPE = /^[A-Za-z][A-Za-z0-9 ]{0,31}$/;

/** Error class identifiers only. Digits, slashes, quotes, and spaces are what a
 *  path, a token, or a message would bring, and none of them pass. */
const ERROR_KIND_SHAPE = /^[A-Z][A-Za-z]{1,39}$/;

const KNOWN_ERROR_KINDS = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'AggregateError',
  'DOMException',
  'Unknown',
]);

export interface RenderErrorReport {
  schema: typeof RENDER_ERROR_SCHEMA;
  surface: typeof RENDER_ERROR_SURFACE;
  ev: 'render_error';
  label: string;
  errKind: string;
  /** How deep the failing tree was, as a count. Replaces the component stack. */
  stackDepth: number;
}

export function renderErrorLabel(label: string | undefined): string {
  if (typeof label !== 'string') return 'unknown';
  const trimmed = label.trim();
  return LABEL_SHAPE.test(trimmed) ? trimmed : 'unknown';
}

/** The error's CLASS. Never `error.message`, never `error.stack`. */
export function renderErrorKind(error: unknown): string {
  if (error === null || error === undefined || typeof error !== 'object') {
    return 'Unknown';
  }
  const name = (error as { name?: unknown }).name;
  const candidate =
    typeof name === 'string'
      ? name
      : ((error as { constructor?: { name?: unknown } }).constructor?.name ?? '');
  if (typeof candidate !== 'string') return 'Unknown';
  if (KNOWN_ERROR_KINDS.has(candidate)) return candidate;
  return ERROR_KIND_SHAPE.test(candidate) ? candidate : 'Unknown';
}

/**
 * React's component stack is one frame per line ("    at Foo (http://…)"). Only
 * the COUNT survives: it distinguishes "a leaf tile blew up" from "the whole view
 * blew up" without naming a single component or module.
 */
export function componentStackDepth(componentStack: string | null | undefined): number {
  if (typeof componentStack !== 'string') return 0;
  return componentStack.split('\n').filter((line) => line.trim().length > 0).length;
}


export function buildRenderErrorReport(
  label: string | undefined,
  error: unknown,
  componentStack: string | null | undefined,
): RenderErrorReport {
  return {
    schema: RENDER_ERROR_SCHEMA,
    surface: RENDER_ERROR_SURFACE,
    ev: 'render_error',
    label: renderErrorLabel(label),
    errKind: renderErrorKind(error),
    stackDepth: componentStackDepth(componentStack),
  };
}

/**
 * Local breadcrumb plus first-party delivery. Cookies authenticate product
 * sessions; no credential or user content is added to the report.
 */
export function reportRenderError(report: RenderErrorReport): void {
  console.error(JSON.stringify(report));
  if (typeof fetch !== 'function') return;
  // The plane that served this dashboard, resolved the one way every other read
  // resolves it. This line used to re-derive the base from `VITE_WORKER_URL`,
  // which meant a crash report could travel to a different origin than the data
  // it crashed on.
  void fetch(`${API_BASE}/client-reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => undefined);
}

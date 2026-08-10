// Browser auth storage. Product web keeps only a CSRF proof here after exchanging
// the read key for an HttpOnly session. `seorak_token` remains the explicit
// dogfood compatibility path and is never populated by a product exchange.

import { bearerHeader } from '@seorak/types';

export const TOKEN_KEY = 'seorak_token';

/** The `local` sentinel is the dev "continue without signing in" marker — it is NOT
 *  a real worker key, so it must never be sent as a Bearer credential. */
export const LOCAL_SENTINEL = 'local';
export const SESSION_SENTINEL = 'session';
const CSRF_KEY = 'seorak_session_csrf';

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(value: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, value);
  } catch {
    // Storage may be disabled; session-only auth still works.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function readCsrfToken(): string | null {
  try {
    return sessionStorage.getItem(CSRF_KEY);
  } catch {
    return null;
  }
}

export function writeCsrfToken(value: string): void {
  try {
    sessionStorage.setItem(CSRF_KEY, value);
  } catch {
    // The session remains read-only if session storage is unavailable.
  }
}

export function clearCsrfToken(): void {
  try {
    sessionStorage.removeItem(CSRF_KEY);
  } catch {
    // ignore
  }
}

/** The stored token, or null when there is nothing real to send (unset, or the
 *  `local` dev sentinel, which is a "continue without signing in" marker and not
 *  a credential). This is the one place the browser's storage meets the shared
 *  header helpers in `@seorak/types`. */
export function readAuthToken(): string | null {
  const t = readToken();
  return !t || t === LOCAL_SENTINEL || t === SESSION_SENTINEL ? null : t;
}

/** The `Authorization` header for a read, or `{}` when there is no real token to
 *  send. An open worker ignores the header; an armed worker requires it. */
export function authHeader(): Record<string, string> {
  return bearerHeader(readAuthToken());
}

export function controlAuthHeader(): Record<string, string> {
  const csrf = readCsrfToken();
  return {
    ...authHeader(),
    ...(csrf ? { 'x-seorak-csrf': csrf } : {}),
  };
}

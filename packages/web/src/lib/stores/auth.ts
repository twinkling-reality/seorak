import { createStore, useStore } from 'zustand';
import {
  clearCsrfToken,
  clearToken,
  readToken,
  SESSION_SENTINEL,
  writeCsrfToken,
  writeToken,
} from '../token.js';
import {
  checkAuth,
  createSession,
  createSessionFromHandoff,
  deleteSession,
  restoreSession,
} from '../api.js';
import {
  ensureUserProfile,
  writeStoredProfile,
  type UserProfile,
} from '../userProfile.js';

export type { UserProfile };

// One owner per deployment. Product boot restores an HttpOnly session and an
// explicit paste exchanges the read credential without persisting it. Dogfood
// keeps the legacy stored-token path for self-operated compatibility.

interface AuthState {
  token: string | null;
  user: UserProfile | null;
  sessionExpired: boolean;
  readTokenFromHash: () => string | null;
  readHandoffFromHash: () => string | null;
  getStoredToken: () => string | null;
  restore: () => Promise<boolean>;
  /** Immediate-ready: marks the single local user authenticated. */
  authenticate: (t?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  expireSession: () => void;
}

function clearAuthFragment(): void {
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
}

const authStore = createStore<AuthState>((set) => ({
  token: null,
  user: null,
  sessionExpired: false,

  readTokenFromHash() {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash;
    if (!hash.includes('token=')) return null;
    const match = hash.match(/token=([^&]+)/);
    if (!match || !match[1]) return null;
    // `seorak setup` URL-encodes the token in the #token fragment; decode it back to
    // the raw key (fall back to the raw match if it isn't valid encoding).
    clearAuthFragment();
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  },

  readHandoffFromHash() {
    if (typeof window === 'undefined') return null;
    const match = window.location.hash.match(/(?:^#|&)handoff=([^&]+)/);
    if (!match?.[1]) return null;
    clearAuthFragment();
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  },

  getStoredToken() {
    return readToken();
  },

  async restore() {
    const restored = await restoreSession();
    if (!restored) return false;
    clearToken();
    writeCsrfToken(restored.csrfToken);
    set({
      token: SESSION_SENTINEL,
      user: ensureUserProfile(),
      sessionExpired: false,
    });
    return true;
  },

  async authenticate(t?: string) {
    if (t) writeToken(t);
    set({ token: t ?? 'local', user: ensureUserProfile(), sessionExpired: false });
    return true;
  },

  async logout() {
    if (authStore.getState().token === SESSION_SENTINEL) {
      await deleteSession();
    }
    set({ token: null, user: null, sessionExpired: false });
    clearToken();
    clearCsrfToken();
  },

  expireSession() {
    set({ token: null, user: null, sessionExpired: true });
    clearToken();
    clearCsrfToken();
  },
}));

export function useAuthStore<T>(selector: (state: AuthState) => T): T {
  return useStore(authStore, selector);
}

export const authActions = {
  getState: (): AuthState => authStore.getState(),
  authenticate: (t?: string): Promise<boolean> => authStore.getState().authenticate(t),
  /** Explicit paste path (EntryView): validate the token against the worker's
   *  product /auth/session before entering. Dogfood falls back to /auth/check.
   *  Throws `unauthorized` on a 401; network/5xx failures propagate separately. */
  async signInWithToken(t: string): Promise<boolean> {
    const session = await createSession(t);
    if (session) {
      clearToken();
      writeCsrfToken(session.csrfToken);
      authStore.setState({
        token: SESSION_SENTINEL,
        user: ensureUserProfile(),
        sessionExpired: false,
      });
      return true;
    }
    const ok = await checkAuth(t);
    if (!ok) throw new Error('unauthorized');
    return authStore.getState().authenticate(t);
  },
  async signInWithHandoff(handoffCode: string): Promise<boolean> {
    const session = await createSessionFromHandoff(handoffCode);
    clearToken();
    writeCsrfToken(session.csrfToken);
    authStore.setState({
      token: SESSION_SENTINEL,
      user: ensureUserProfile(),
      sessionExpired: false,
    });
    return true;
  },
  logout: (): Promise<void> => authStore.getState().logout(),
  expireSession: (): void => authStore.getState().expireSession(),
  readTokenFromHash: (): string | null => authStore.getState().readTokenFromHash(),
  readHandoffFromHash: (): string | null => authStore.getState().readHandoffFromHash(),
  discardAuthFragment(): void {
    if (typeof window !== 'undefined') clearAuthFragment();
  },
  getStoredToken: (): string | null => authStore.getState().getStoredToken(),
  restore: (): Promise<boolean> => authStore.getState().restore(),
  subscribe: authStore.subscribe,

  updateUser(updates: Partial<UserProfile>): void {
    const current = authStore.getState().user;
    if (!current) return;
    const user = { ...current, ...updates };
    authStore.setState({ user });
    writeStoredProfile(user);
  },
};

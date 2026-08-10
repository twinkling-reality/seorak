import { createStore, useStore } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  systemTheme: ResolvedTheme;
  setTheme: (value: ThemePreference) => void;
}

interface UseThemeReturn {
  theme: ThemePreference;
  resolved: ResolvedTheme;
  setTheme: (value: ThemePreference) => void;
}

const STORAGE_KEY = 'seorak:theme';

function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Safari "Block all cookies" / strict privacy can throw on localStorage access.
  }
  return 'light';
}

function writeThemePreference(value: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Preference still applies for this session when storage is blocked.
  }
}

// Lazy access so module evaluation does not crash in test environments
// (jsdom omits matchMedia by default) or in any future SSR context.
function getDarkMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

function getSystemTheme(): ResolvedTheme {
  return getDarkMediaQuery()?.matches ? 'dark' : 'light';
}

function resolveTheme(preference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  return preference === 'system' ? systemTheme : preference;
}

function apply(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0e0f11' : '#ffffff';
}

const themeStore = createStore<ThemeState>((set, get) => ({
  preference: readThemePreference(),
  systemTheme: getSystemTheme(),
  setTheme: (value: ThemePreference) => {
    writeThemePreference(value);
    set({ preference: value });
    apply(resolveTheme(value, get().systemTheme));
  },
}));

let listenersInitialized = false;
let mediaCleanup: (() => void) | null = null;

function initThemeSideEffects(): void {
  if (listenersInitialized || typeof window === 'undefined') return;
  listenersInitialized = true;

  apply(resolveTheme(themeStore.getState().preference, themeStore.getState().systemTheme));

  themeStore.subscribe((state, prevState) => {
    const resolved = resolveTheme(state.preference, state.systemTheme);
    const prevResolved = resolveTheme(prevState.preference, prevState.systemTheme);
    if (resolved !== prevResolved) apply(resolved);
  });

  const mq = getDarkMediaQuery();
  if (!mq) return;
  const handler = (e: MediaQueryListEvent) => {
    themeStore.setState({ systemTheme: e.matches ? 'dark' : 'light' });
  };
  mq.addEventListener('change', handler);
  mediaCleanup = () => mq.removeEventListener('change', handler);
}

export function useTheme(): UseThemeReturn {
  initThemeSideEffects();
  const preference = useStore(themeStore, (s) => s.preference);
  const systemTheme = useStore(themeStore, (s) => s.systemTheme);
  const setTheme = useStore(themeStore, (s) => s.setTheme);
  const resolved = resolveTheme(preference, systemTheme);
  return { theme: preference, resolved, setTheme };
}

export const themeActions = {
  getState: (): ThemeState => themeStore.getState(),
  setTheme: (value: ThemePreference): void => themeStore.getState().setTheme(value),
  /** Test-only reset — restores default preference and reapplies resolved theme. */
  resetForTests: (preference: ThemePreference = 'light', systemTheme: ResolvedTheme = 'light'): void => {
    themeStore.setState({ preference, systemTheme });
    apply(resolveTheme(preference, systemTheme));
  },
  disposeForTests: (): void => {
    listenersInitialized = false;
    mediaCleanup?.();
    mediaCleanup = null;
  },
};

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query as reactive state. SSR-safe: returns false
 * without a `window`/`matchMedia`, and re-renders on every match change.
 * Extracted from the two dashboard shells (OverviewView + ProjectView), which
 * held byte-identical copies (audit D6).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** The dashboard mobile breakpoint (customize + drag are desktop-only below it). */
export const MOBILE_QUERY = '(max-width: 767px)';

/** True on the compact/mobile dashboard layout. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

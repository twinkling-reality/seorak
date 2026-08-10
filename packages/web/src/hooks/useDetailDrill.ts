import { useCallback } from 'react';
import { setQueryParam, useQueryParam } from '../lib/router.js';

export interface DetailDrill {
  /** The current query-param value, or null when not drilled in. A
   *  present empty string means "open but no focus hint". */
  param: string | null;
  /** True iff the detail view should render. */
  shifted: boolean;
  /** Clear the drill param - returns the user to the overview. */
  close: () => void;
}

/**
 * Wrap a single query-param as a detail-view drill. Replaces the
 * three-line `useQueryParam` + `shifted` + `close` block that every
 * category detail view repeats in OverviewView.
 *
 * Composes trivially with additional params a view may carry (e.g.,
 * Live's `live-tab`): call `useQueryParam('live-tab')` separately,
 * and wrap this drill's `close` to clear both.
 */
export function useDetailDrill(paramKey: string): DetailDrill {
  const param = useQueryParam(paramKey);
  const close = useCallback(() => {
    setQueryParam(paramKey, null);
  }, [paramKey]);
  return { param, shifted: param !== null, close };
}

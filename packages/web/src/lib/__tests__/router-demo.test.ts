// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { navigate, navigateToCompare, navigateToReplay } from '../router.js';

afterEach(() => {
  window.history.replaceState(null, '', '/dashboard');
});

describe('dashboard router demo query preservation', () => {
  it('preserves the active demo scenario on top-level navigation', () => {
    window.history.replaceState(null, '', '/dashboard?demo=high-cost&usage=projects');

    navigate('project', 'repo-seorak');

    expect(window.location.pathname + window.location.search).toBe(
      '/dashboard/project/repo-seorak?demo=high-cost',
    );
  });

  it('keeps demo while replacing compare-specific query params', () => {
    window.history.replaceState(null, '', '/dashboard/replay?demo=healthy&session=sess-1');

    navigateToCompare({
      mode: 'repos',
      a: 'repo-seorak',
      b: 'repo-mobile-surfaces',
      range: 30,
    });

    expect(window.location.pathname + window.location.search).toBe(
      '/dashboard/compare?demo=healthy&mode=repos&a=repo-seorak&b=repo-mobile-surfaces&range=30',
    );
  });

  it('writes a stable project-over-time comparison question', () => {
    window.history.replaceState(null, '', '/dashboard/project/repo-seorak?demo=healthy');

    navigateToCompare({ scope: 'repo-seorak', range: 30 });

    expect(window.location.pathname + window.location.search).toBe(
      '/dashboard/compare?demo=healthy&scope=repo-seorak&range=30',
    );
  });

  it('keeps demo while replacing replay-specific query params', () => {
    window.history.replaceState(null, '', '/dashboard/compare?demo=solo-cc&a=seorak&b=mobile-surfaces');

    navigateToReplay('sess-1', 'repo-seorak');

    expect(window.location.pathname + window.location.search).toBe(
      '/dashboard/replay?demo=solo-cc&projects=repo-seorak&sessions=sess-1',
    );
  });
});

// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyOverview } from '../../lib/schemas/common.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const overview = createEmptyOverview(7);

vi.mock('../../hooks/useOverview.js', () => ({
  useOverview: () => ({
    overview,
    isLoading: false,
    error: null,
    isStale: true,
  }),
  useAllowedRanges: () => [7, 30, 90] as const,
}));

vi.mock('../../lib/router.js', () => ({
  navigate: () => {},
  useLocationHash: () => '',
}));

import AgentsView from './AgentsView.js';

afterEach(() => {
  document.body.replaceChildren();
});

it('marks a retained agents snapshot stale after a failed refresh', () => {
  const zone = document.createElement('div');
  zone.id = 'bottom-floaters';
  const container = document.createElement('div');
  document.body.append(zone, container);
  const root = createRoot(container);

  act(() => root.render(<AgentsView />));

  const banner = zone.querySelector('[role="status"]');
  expect(banner?.textContent).toContain('Reconnecting');
  expect(banner?.textContent).toContain('Showing the last loaded snapshot');

  act(() => root.unmount());
});

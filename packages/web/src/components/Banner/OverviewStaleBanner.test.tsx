// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import OverviewStaleBanner from './OverviewStaleBanner.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

it('falls back inline when the shared floater zone is absent', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => root.render(<OverviewStaleBanner visible />));

  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    'Reconnecting',
  );

  act(() => root.unmount());
});

it('renders nothing for a fresh snapshot', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => root.render(<OverviewStaleBanner visible={false} />));
  expect(container.childElementCount).toBe(0);

  act(() => root.unmount());
});

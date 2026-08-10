// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderComponent(Component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<Component {...props} />);
  });

  return {
    container,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function loadViewHeader() {
  vi.resetModules();
  const mod = await import('./ViewHeader.js');
  return mod.default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ViewHeader', () => {
  it('renders the title in an h1', async () => {
    const ViewHeader = await loadViewHeader();
    const { container, unmount } = renderComponent(ViewHeader, { title: 'Settings' });

    const h1 = container.querySelector('h1');
    expect(h1.textContent).toBe('Settings');

    unmount();
  });

  it('renders eyebrow when provided', async () => {
    const ViewHeader = await loadViewHeader();
    const { container, unmount } = renderComponent(ViewHeader, {
      eyebrow: 'Configure',
      title: 'Settings',
    });

    expect(container.textContent).toContain('Configure');
    expect(container.textContent).toContain('Settings');

    unmount();
  });

  it('omits eyebrow when not provided', async () => {
    const ViewHeader = await loadViewHeader();
    const { container, unmount } = renderComponent(ViewHeader, { title: 'Tools' });

    expect(container.textContent).toBe('Tools');

    unmount();
  });

  it('renders a "Demo data" pill beside the eyebrow when demo is set (FOLLOW-UP #6)', async () => {
    const ViewHeader = await loadViewHeader();
    const { container, unmount } = renderComponent(ViewHeader, {
      eyebrow: 'Replay',
      title: 'Session replay',
      demo: true,
    });

    expect(container.textContent).toContain('Replay');
    expect(container.textContent).toContain('Demo data');

    unmount();
  });

  it('omits the demo pill by default (live view reads clean)', async () => {
    const ViewHeader = await loadViewHeader();
    const { container, unmount } = renderComponent(ViewHeader, {
      eyebrow: 'Replay',
      title: 'Session replay',
    });

    expect(container.textContent).not.toContain('Demo data');

    unmount();
  });
});

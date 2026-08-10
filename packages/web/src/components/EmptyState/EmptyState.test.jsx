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

async function load() {
  vi.resetModules();
  return (await import('./EmptyState.js')).default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('EmptyState', () => {
  it('renders title', async () => {
    const EmptyState = await load();
    const { container, unmount } = renderComponent(EmptyState, { title: 'Nothing here' });
    expect(container.textContent).toContain('Nothing here');
    unmount();
  });

  it('renders hint when provided', async () => {
    const EmptyState = await load();
    const { container, unmount } = renderComponent(EmptyState, {
      title: 'Empty',
      hint: 'Add items.',
    });
    expect(container.textContent).toContain('Add items.');
    unmount();
  });

  it('has role=status', async () => {
    const EmptyState = await load();
    const { container, unmount } = renderComponent(EmptyState, { title: 'Empty' });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    unmount();
  });
});

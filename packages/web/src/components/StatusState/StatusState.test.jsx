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
  return (await import('./StatusState.js')).default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('StatusState', () => {
  it('renders title', async () => {
    const StatusState = await load();
    const { container, unmount } = renderComponent(StatusState, { title: 'Loading...' });
    expect(container.textContent).toContain('Loading...');
    unmount();
  });

  it('renders hint when provided', async () => {
    const StatusState = await load();
    const { container, unmount } = renderComponent(StatusState, {
      title: 'Error',
      hint: 'Try again',
    });
    expect(container.textContent).toContain('Try again');
    unmount();
  });

  it('renders eyebrow and meta', async () => {
    const StatusState = await load();
    const { container, unmount } = renderComponent(StatusState, {
      title: 'Status',
      eyebrow: 'System',
      meta: '5s ago',
    });
    expect(container.textContent).toContain('System');
    expect(container.textContent).toContain('5s ago');
    unmount();
  });

  it('renders detail and action button', async () => {
    const onAction = vi.fn();
    const StatusState = await load();
    const { container, unmount } = renderComponent(StatusState, {
      title: 'Error',
      detail: 'Connection failed',
      actionLabel: 'Retry',
      onAction,
    });
    expect(container.textContent).toContain('Connection failed');
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(btn).not.toBeUndefined();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onAction).toHaveBeenCalled();
    unmount();
  });

  it('has role=status with aria-live=polite', async () => {
    const StatusState = await load();
    const { container, unmount } = renderComponent(StatusState, { title: 'Test' });
    const el = container.querySelector('[role="status"]');
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-live')).toBe('polite');
    unmount();
  });
});

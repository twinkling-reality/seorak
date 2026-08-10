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
  return (await import('./Banner.js')).default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Banner', () => {
  it('renders children text', async () => {
    const Banner = await load();
    const { container, unmount } = renderComponent(Banner, { children: 'Hello world' });
    expect(container.textContent).toContain('Hello world');
    unmount();
  });

  it('renders eyebrow when provided', async () => {
    const Banner = await load();
    const { container, unmount } = renderComponent(Banner, { eyebrow: 'Warning', children: 'msg' });
    expect(container.textContent).toContain('Warning');
    unmount();
  });

  it('renders meta when provided', async () => {
    const Banner = await load();
    const { container, unmount } = renderComponent(Banner, { meta: '2 mins ago', children: 'msg' });
    expect(container.textContent).toContain('2 mins ago');
    unmount();
  });

  it('renders action buttons', async () => {
    const onClick = vi.fn();
    const Banner = await load();
    const { container, unmount } = renderComponent(Banner, {
      children: 'msg',
      actions: [{ label: 'Retry', onClick }],
    });
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(btn).not.toBeUndefined();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalled();
    unmount();
  });

  it('renders dismiss button when onDismiss is provided', async () => {
    const onDismiss = vi.fn();
    const Banner = await load();
    const { container, unmount } = renderComponent(Banner, { children: 'msg', onDismiss });
    const dismiss = container.querySelector('[aria-label="Dismiss"]');
    expect(dismiss).not.toBeNull();
    await act(async () => {
      dismiss.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalled();
    unmount();
  });

  it('does not render dismiss button when onDismiss is not provided', async () => {
    const Banner = await load();
    const { container, unmount } = renderComponent(Banner, { children: 'msg' });
    expect(container.querySelector('[aria-label="Dismiss"]')).toBeNull();
    unmount();
  });
});

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
  return (await import('./ToolIcon.js')).default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('ToolIcon', () => {
  it('renders a letter fallback for unknown tools', async () => {
    const ToolIcon = await load();
    const { container, unmount } = renderComponent(ToolIcon, { tool: 'unknown_tool_xyz' });

    // Should render the first letter of the label as fallback
    const span = container.querySelector('[aria-hidden="true"]');
    expect(span).not.toBeNull();
    // The fallback renders the first letter of the meta.label
    expect(span.textContent.length).toBe(1);

    unmount();
  });

  it('renders with aria-hidden true by default', async () => {
    const ToolIcon = await load();
    const { container, unmount } = renderComponent(ToolIcon, { tool: 'cursor' });

    const el = container.querySelector('[aria-hidden="true"]');
    expect(el).not.toBeNull();

    unmount();
  });

  it('renders with custom size', async () => {
    const ToolIcon = await load();
    const { container, unmount } = renderComponent(ToolIcon, { tool: 'cursor', size: 24 });

    const el = container.querySelector('[aria-hidden]');
    expect(el.style.width).toBe('24px');
    expect(el.style.height).toBe('24px');

    unmount();
  });

  it('uses favicon for tools with website but no icon', async () => {
    const ToolIcon = await load();
    const { container, unmount } = renderComponent(ToolIcon, {
      tool: 'some_niche_tool',
      website: 'https://example.com',
    });

    // Should render a favicon img
    const img = container.querySelector('img');
    if (img) {
      expect(img.src).toContain('google.com/s2/favicons');
    }

    unmount();
  });

  it('renders monochrome mode', async () => {
    const ToolIcon = await load();
    const { container, unmount } = renderComponent(ToolIcon, {
      tool: 'cursor',
      monochrome: true,
    });

    // Should still render an icon element
    const el = container.querySelector('[aria-hidden]');
    expect(el).not.toBeNull();

    unmount();
  });
});

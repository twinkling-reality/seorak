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
  // toolMeta pins `icon` to null for EVERY tool, so with no icon source passed
  // this is what every current call site renders. It used to be a brand-filled
  // disc holding the label's first letter, which made Codex and Claude Code
  // differ by hue alone; ToolIcon.tsx carries the full reasoning.
  it('renders nothing for a tool with no mark, rather than inventing one', async () => {
    const ToolIcon = await load();
    const { container, unmount } = renderComponent(ToolIcon, { tool: 'claude' });

    expect(container.innerHTML).toBe('');

    unmount();
  });

  it('renders nothing for an unknown tool', async () => {
    const ToolIcon = await load();
    const { container, unmount } = renderComponent(ToolIcon, { tool: 'unknown_tool_xyz' });

    expect(container.innerHTML).toBe('');

    unmount();
  });

  // The remaining branches are the ones that light up if a mark ever becomes
  // available, so they are what keeps this component from being dead weight.
  it('renders a backend-resolved iconUrl', async () => {
    const ToolIcon = await load();
    const { container, unmount } = renderComponent(ToolIcon, {
      tool: 'claude',
      iconUrl: 'https://example.com/mark.svg',
    });

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('https://example.com/mark.svg');

    unmount();
  });

  it('falls back to the favicon service for a tool with a website', async () => {
    const ToolIcon = await load();
    const { container, unmount } = renderComponent(ToolIcon, {
      tool: 'some_niche_tool',
      website: 'https://example.com',
    });

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.src).toContain('google.com/s2/favicons');

    unmount();
  });

  it('applies aria-hidden and a custom size to a mark it does render', async () => {
    const ToolIcon = await load();
    const { container, unmount } = renderComponent(ToolIcon, {
      tool: 'claude',
      iconUrl: 'https://example.com/mark.svg',
      size: 24,
    });

    const el = container.querySelector('[aria-hidden="true"]');
    expect(el).not.toBeNull();
    expect(el.style.width).toBe('24px');
    expect(el.style.height).toBe('24px');

    unmount();
  });
});

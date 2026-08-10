// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatWidget } from '../shared.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('StatWidget drill layout', () => {
  it('keeps delta and drill arrow in the same statTrailing cluster', () => {
    const { container, unmount } = render(
      <StatWidget
        value="$279.04"
        delta={{ current: 279.04, previous: 228.81 }}
        deltaFormat="usd"
        deltaComparison="$279.04 this 30-day window vs $228.81 the 30 days before."
        onOpenDetail={vi.fn()}
        detailAriaLabel="Open usage detail · $279.04 cost"
      />,
    );

    const delta = container.querySelector('[class*="statInlineDelta"]');
    const arrow = container.querySelector('[class*="statDetailArrow"]');
    const trailing = container.querySelector('[class*="statTrailing"]');
    const button = container.querySelector('button[class*="statButton"]');

    expect(delta).not.toBeNull();
    expect(arrow).not.toBeNull();
    expect(trailing).not.toBeNull();
    expect(trailing.contains(delta)).toBe(true);
    expect(trailing.contains(arrow)).toBe(true);
    expect(delta.closest('[class*="statTrailing"]')).toBe(trailing);
    expect(arrow.closest('[class*="statTrailing"]')).toBe(trailing);

    const buttonChildren = Array.from(button.children);
    expect(buttonChildren).toHaveLength(2);
    expect(buttonChildren[0].className).toMatch(/heroStatValue/);
    expect(buttonChildren[1]).toBe(trailing);
    expect(buttonChildren).not.toContain(arrow);

    unmount();
  });
});

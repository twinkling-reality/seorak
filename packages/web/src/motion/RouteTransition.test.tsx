// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RouteTransition } from './RouteTransition.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RouteTransition', () => {
  it('ends enter animation with transform:none so fixed takeover screens stay visible', () => {
    const source = readFileSync(join(process.cwd(), 'src/motion/RouteTransition.module.css'), 'utf8');
    expect(source).toContain('transform: none');
    expect(source).not.toMatch(/transform:\s*translateY\(0\)/);
  });

  it('renders with preset none without leaving a transform on the wrapper', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <RouteTransition routeKey="test" preset="none" navType="initial">
          <div data-testid="child">ok</div>
        </RouteTransition>,
      );
    });

    const wrapper = container.querySelector('[data-route-transition="none"]') as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    const transform = getComputedStyle(wrapper!).transform;
    expect(transform === 'none' || transform === '').toBe(true);
    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe('ok');
  });
});

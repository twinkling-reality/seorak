// @vitest-environment jsdom

import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTabKeyboard } from './useTabKeyboard.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function TestHarness({ tabIds, initialTab }) {
  const [active, setActive] = useState(initialTab || tabIds[0]);
  const containerRef = useTabKeyboard(tabIds, setActive);

  return (
    <div ref={containerRef} data-testid="container">
      {tabIds.map((id) => (
        <button key={id} data-tab={id} data-testid={`tab-${id}`}>
          {id}
        </button>
      ))}
      <span data-testid="active">{active}</span>
      <input data-testid="text-input" />
      <textarea data-testid="text-area" />
    </div>
  );
}

function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
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

function pressKey(key, target) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  (target || document).dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useTabKeyboard', () => {
  it('advances tab on ArrowRight', () => {
    const { container, unmount } = render(<TestHarness tabIds={['a', 'b', 'c']} initialTab="a" />);

    act(() => {
      pressKey('ArrowRight');
    });
    expect(container.querySelector('[data-testid="active"]').textContent).toBe('b');

    act(() => {
      pressKey('ArrowRight');
    });
    expect(container.querySelector('[data-testid="active"]').textContent).toBe('c');

    unmount();
  });

  it('goes back on ArrowLeft', () => {
    const { container, unmount } = render(<TestHarness tabIds={['a', 'b', 'c']} initialTab="c" />);

    act(() => {
      pressKey('ArrowLeft');
    });
    expect(container.querySelector('[data-testid="active"]').textContent).toBe('b');

    act(() => {
      pressKey('ArrowLeft');
    });
    expect(container.querySelector('[data-testid="active"]').textContent).toBe('a');

    unmount();
  });

  it('wraps around forward (last -> first)', () => {
    const { container, unmount } = render(<TestHarness tabIds={['a', 'b', 'c']} initialTab="c" />);

    act(() => {
      pressKey('ArrowRight');
    });
    expect(container.querySelector('[data-testid="active"]').textContent).toBe('a');

    unmount();
  });

  it('wraps around backward (first -> last)', () => {
    const { container, unmount } = render(<TestHarness tabIds={['a', 'b', 'c']} initialTab="a" />);

    act(() => {
      pressKey('ArrowLeft');
    });
    expect(container.querySelector('[data-testid="active"]').textContent).toBe('c');

    unmount();
  });

  it('ignores arrow keys when an input is focused', () => {
    const { container, unmount } = render(<TestHarness tabIds={['a', 'b', 'c']} initialTab="a" />);

    const input = container.querySelector('[data-testid="text-input"]');
    act(() => {
      pressKey('ArrowRight', input);
    });
    expect(container.querySelector('[data-testid="active"]').textContent).toBe('a');

    unmount();
  });

  it('ignores arrow keys when a textarea is focused', () => {
    const { container, unmount } = render(<TestHarness tabIds={['a', 'b', 'c']} initialTab="a" />);

    const textarea = container.querySelector('[data-testid="text-area"]');
    act(() => {
      pressKey('ArrowRight', textarea);
    });
    expect(container.querySelector('[data-testid="active"]').textContent).toBe('a');

    unmount();
  });

  it('ignores non-arrow keys', () => {
    const { container, unmount } = render(<TestHarness tabIds={['a', 'b', 'c']} initialTab="a" />);

    act(() => {
      pressKey('Enter');
    });
    act(() => {
      pressKey('Tab');
    });
    act(() => {
      pressKey('ArrowUp');
    });
    expect(container.querySelector('[data-testid="active"]').textContent).toBe('a');

    unmount();
  });

  it('focuses the target tab button', () => {
    const { container, unmount } = render(<TestHarness tabIds={['a', 'b', 'c']} initialTab="a" />);

    act(() => {
      pressKey('ArrowRight');
    });

    const tabB = container.querySelector('[data-tab="b"]');
    expect(document.activeElement).toBe(tabB);

    unmount();
  });

  it('cleans up event listener on unmount', () => {
    const spy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<TestHarness tabIds={['a', 'b']} initialTab="a" />);

    unmount();

    const keydownCalls = spy.mock.calls.filter(([event]) => event === 'keydown');
    expect(keydownCalls.length).toBeGreaterThan(0);

    spy.mockRestore();
  });
});

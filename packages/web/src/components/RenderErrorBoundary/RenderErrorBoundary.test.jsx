// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderComponent(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    container,
    root,
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
  return (await import('./RenderErrorBoundary.js')).default;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function BrokenChild() {
  throw new Error('Test render error');
}

describe('RenderErrorBoundary', () => {
  it('renders children when no error', async () => {
    const RenderErrorBoundary = await load();
    const { container, unmount } = renderComponent(
      <RenderErrorBoundary>
        <div>Hello</div>
      </RenderErrorBoundary>,
    );
    expect(container.textContent).toContain('Hello');
    unmount();
  });

  it('shows fallback UI when child throws', async () => {
    const RenderErrorBoundary = await load();
    // Suppress React error logging during error boundary test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, unmount } = renderComponent(
      <RenderErrorBoundary>
        <BrokenChild />
      </RenderErrorBoundary>,
    );
    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).toContain('Try again');
    spy.mockRestore();
    unmount();
  });

  it('recovers on "Try again" click', async () => {
    const RenderErrorBoundary = await load();
    let shouldThrow = true;
    function MaybeBroken() {
      if (shouldThrow) throw new Error('Test');
      return <div>Recovered</div>;
    }

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, unmount } = renderComponent(
      <RenderErrorBoundary>
        <MaybeBroken />
      </RenderErrorBoundary>,
    );

    expect(container.textContent).toContain('Something went wrong');

    shouldThrow = false;
    const btn = container.querySelector('button');
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Recovered');
    spy.mockRestore();
    unmount();
  });

  it('uses custom fallback when provided', async () => {
    const RenderErrorBoundary = await load();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, unmount } = renderComponent(
      <RenderErrorBoundary
        fallback={({ reset }) => <button onClick={reset}>Custom fallback</button>}
      >
        <BrokenChild />
      </RenderErrorBoundary>,
    );
    expect(container.textContent).toContain('Custom fallback');
    spy.mockRestore();
    unmount();
  });

  it('resets error state when resetKey changes', async () => {
    const RenderErrorBoundary = await load();
    let shouldThrow = true;
    function MaybeBroken() {
      if (shouldThrow) throw new Error('Test');
      return <div>Working</div>;
    }

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <RenderErrorBoundary resetKey="a">
          <MaybeBroken />
        </RenderErrorBoundary>,
      );
    });

    expect(container.textContent).toContain('Something went wrong');

    // Change resetKey and stop throwing - boundary should reset
    shouldThrow = false;
    act(() => {
      root.render(
        <RenderErrorBoundary resetKey="b">
          <MaybeBroken />
        </RenderErrorBoundary>,
      );
    });

    expect(container.textContent).toContain('Working');

    spy.mockRestore();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('reports the crash as one structured line carrying the custom label', async () => {
    const RenderErrorBoundary = await load();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderComponent(
      <RenderErrorBoundary label="ProjectView">
        <BrokenChild />
      </RenderErrorBoundary>,
    );

    // React logs its own dev-mode line first; ours is the single JSON line. It
    // replaced `[seorak] <label> error:` plus the raw error and component stack,
    // both of which carried module paths — see renderErrorReport.ts.
    const reports = spy.mock.calls
      .map(([first]) => first)
      .filter((first) => typeof first === 'string' && first.startsWith('{'))
      .map((line) => JSON.parse(line));
    expect(reports).toEqual([
      {
        schema: 'obs.v1',
        surface: 'web',
        ev: 'render_error',
        label: 'ProjectView',
        errKind: 'Error',
        stackDepth: expect.any(Number),
      },
    ]);

    spy.mockRestore();
    unmount();
  });

  it('default fallback has role="status" for accessibility', async () => {
    const RenderErrorBoundary = await load();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, unmount } = renderComponent(
      <RenderErrorBoundary>
        <BrokenChild />
      </RenderErrorBoundary>,
    );

    const statusEl = container.querySelector('[role="status"]');
    expect(statusEl).not.toBeNull();

    spy.mockRestore();
    unmount();
  });

  it('recovery via custom fallback reset function works', async () => {
    const RenderErrorBoundary = await load();
    let shouldThrow = true;
    function MaybeBroken() {
      if (shouldThrow) throw new Error('Test');
      return <div>Back to normal</div>;
    }

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, unmount } = renderComponent(
      <RenderErrorBoundary
        fallback={({ reset }) => (
          <button data-testid="custom-reset" onClick={reset}>
            Reset
          </button>
        )}
      >
        <MaybeBroken />
      </RenderErrorBoundary>,
    );

    expect(container.textContent).toContain('Reset');

    shouldThrow = false;
    const btn = container.querySelector('[data-testid="custom-reset"]');
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Back to normal');

    spy.mockRestore();
    unmount();
  });
});

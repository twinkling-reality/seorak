// @vitest-environment jsdom

/**
 * The redaction guard for the dashboard's render-crash report.
 *
 * The boundary used to hand `error` and `info.componentStack` straight to
 * console.error. Both carry `http://localhost:5173/src/...` module paths in a dev
 * build, and a data-shape TypeError's message routinely quotes the value that broke
 * it — which on this dashboard is the owner's own session data. This drives the
 * boundary with a forbidden-pattern corpus and asserts none of it survives.
 */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRenderErrorReport,
  componentStackDepth,
  renderErrorKind,
  renderErrorLabel,
} from './renderErrorReport.js';
import RenderErrorBoundary from './RenderErrorBoundary.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Every class of value a dashboard crash report must never carry. */
const FORBIDDEN_VALUES: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'dev module url', value: 'http://localhost:5173/src/views/OverviewView.tsx' },
  { label: 'relative source path', value: 'src/components/CostTile/CostTile.tsx' },
  { label: 'absolute repo path', value: '/Users/owner/dev/Technology/seorak' },
  { label: 'repo name', value: 'seorak-private-client-work' },
  { label: 'salted repo hash', value: 'a'.repeat(64) },
  { label: 'session id', value: 'session-01JQ8XW5Z3K7VN4M2R9T6BHDPC' },
  { label: 'bearer token', value: 'seorak_read_9f3c8b21d4e6a70c5518fbb2' },
  { label: 'prompt text', value: 'refactor the auth middleware to use JWTs' },
  {
    label: 'serialized session payload',
    value: '{"repoId":"deadbeef","costUsd":12.5,"prompt":"fix the parser"}',
  },
];

const ALLOWED_LABELS = new Set([
  'OverviewView',
  'ProjectView',
  'CompareView',
  'AgentsView',
  'ReplayView',
  'ModelView',
  'SettingsView',
  'DemoView',
  'Sidebar',
  'Blog',
  'Pricing gradient',
  'Hero figure',
  'Render',
  'unknown',
]);

const ERROR_KIND_SHAPE = /^[A-Z][A-Za-z]{1,39}$/;

function renderWithCapture(element: React.ReactElement): {
  lines: string[];
  unmount: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  act(() => {
    root.render(element);
  });
  // Read before restoring: mockRestore clears the recorded calls, which would make
  // this guard pass against an empty corpus.
  const lines = spy.mock.calls.map((call) => String(call[0]));
  spy.mockRestore();
  return {
    lines,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('render error report redaction', () => {
  it.each(FORBIDDEN_VALUES)(
    'never emits a $label from a real boundary catch',
    ({ label, value }) => {
      function Broken(): never {
        const error = new TypeError(`Cannot read properties of undefined at ${value}`);
        error.stack = `TypeError: at ${value}\n    at Broken (${value}:12:5)`;
        throw error;
      }
      const { lines, unmount } = renderWithCapture(
        <RenderErrorBoundary label="OverviewView">
          <Broken />
        </RenderErrorBoundary>,
      );
      unmount();
      const ours = lines.filter((line) => line.startsWith('{'));
      expect(ours.length).toBeGreaterThan(0);
      for (const line of ours) {
        expect(line.includes(value), `${label} survived in: ${line}`).toBe(false);
      }
    },
  );

  it('emits a structured report with the class, the label, and a depth count', () => {
    function Broken(): never {
      throw new TypeError('sessions[0].repoId is undefined');
    }
    const { lines, unmount } = renderWithCapture(
      <RenderErrorBoundary label="ProjectView">
        <Broken />
      </RenderErrorBoundary>,
    );
    unmount();
    const reports = lines
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((report) => report.ev === 'render_error');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual({
      schema: 'obs.v1',
      surface: 'web',
      ev: 'render_error',
      label: 'ProjectView',
      errKind: 'TypeError',
      stackDepth: expect.any(Number),
    });
    expect(reports[0]!.stackDepth as number).toBeGreaterThan(0);
    // The message named a data field; the report must not.
    expect(JSON.stringify(reports[0])).not.toContain('repoId');
  });

  it('emits only whitelisted labels and shaped error classes', () => {
    for (const { value } of FORBIDDEN_VALUES) {
      const report = buildRenderErrorReport(value, new Error(value), value);
      expect(ALLOWED_LABELS.has(report.label)).toBe(true);
      expect(ERROR_KIND_SHAPE.test(report.errKind)).toBe(true);
      expect(JSON.stringify(report)).not.toContain(value);
    }
  });

  it('collapses an unshaped or overlong label rather than passing it through', () => {
    expect(renderErrorLabel('OverviewView')).toBe('OverviewView');
    expect(renderErrorLabel('Pricing gradient')).toBe('Pricing gradient');
    // The one interpolated label in the codebase is `${niceName} visual`; a benign
    // name passes, a path-shaped one does not.
    expect(renderErrorLabel('Live board visual')).toBe('Live board visual');
    expect(renderErrorLabel('src/views/Overview.tsx visual')).toBe('unknown');
    expect(renderErrorLabel('x'.repeat(64))).toBe('unknown');
    expect(renderErrorLabel(undefined)).toBe('unknown');
  });

  it('reduces an error to its class and collapses a disguised name', () => {
    expect(renderErrorKind(new TypeError('boom'))).toBe('TypeError');
    class DataShapeError extends Error {
      override name = 'DataShapeError';
    }
    expect(renderErrorKind(new DataShapeError('boom'))).toBe('DataShapeError');
    const disguised = new Error('boom');
    disguised.name = 'http://localhost:5173/src/x.tsx';
    expect(renderErrorKind(disguised)).toBe('Unknown');
    expect(renderErrorKind('a string')).toBe('Unknown');
    expect(renderErrorKind(null)).toBe('Unknown');
  });

  it('reduces a component stack to a frame count', () => {
    expect(
      componentStackDepth(
        '\n    at CostTile (http://localhost:5173/src/components/CostTile.tsx:8:3)' +
          '\n    at OverviewView (http://localhost:5173/src/views/OverviewView.tsx:20:5)',
      ),
    ).toBe(2);
    expect(componentStackDepth(null)).toBe(0);
    expect(componentStackDepth(undefined)).toBe(0);
  });

  it('sends only the redacted report to the first-party worker route', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    const sendBeacon = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, sendBeacon });
    function Broken(): never {
      throw new Error('boom');
    }
    const { unmount } = renderWithCapture(
      <RenderErrorBoundary label="Sidebar">
        <Broken />
      </RenderErrorBoundary>,
    );
    unmount();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/client-reports');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
    });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      schema: 'obs.v1',
      surface: 'web',
      ev: 'render_error',
      label: 'Sidebar',
      errKind: 'Error',
      stackDepth: expect.any(Number),
    });
    expect(sendBeacon).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

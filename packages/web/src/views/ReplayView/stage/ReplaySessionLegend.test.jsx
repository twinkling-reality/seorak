// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ReplaySessionLegend from './ReplaySessionLegend.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderLegend(props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ReplaySessionLegend {...props} />);
  });

  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const baseProps = {
  onFocusProject: vi.fn(),
  onClearFocus: vi.fn(),
  onToggleChartSession: vi.fn(),
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ReplaySessionLegend', () => {
  it('allows focusing a project even when it has one session', () => {
    const onFocusProject = vi.fn();
    const { container, unmount } = renderLegend({
      ...baseProps,
      items: [
        {
          selected: true,
          series: {
            key: 'series_alpha',
            label: 'alpha',
            status: '1 session',
            color: '#111',
            gradient: 'linear-gradient(#111, #333)',
            repoId: 'alpha',
            sessionIds: ['s1'],
            kind: 'project',
          },
        },
      ],
      focusedProjectId: null,
      onFocusProject,
    });

    const button = container.querySelector('button');
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(onFocusProject).toHaveBeenCalledWith('alpha');

    unmount();
  });

  it('toggles chart visibility without removing the legend row', () => {
    const onToggleChartSession = vi.fn();
    const { container, unmount } = renderLegend({
      ...baseProps,
      onToggleChartSession,
      items: [
        {
          selected: true,
          series: {
            key: 'series_s1',
            label: 'Session 1',
            status: 'ended',
            color: '#111',
            gradient: 'linear-gradient(#111, #333)',
            repoId: 'alpha',
            sessionIds: ['s1'],
            kind: 'session',
          },
        },
        {
          selected: false,
          series: {
            key: 'series_s2',
            label: 'Session 2',
            status: 'ended',
            color: '#222',
            gradient: 'linear-gradient(#222, #444)',
            repoId: 'alpha',
            sessionIds: ['s2'],
            kind: 'session',
          },
        },
      ],
      focusedProjectId: 'alpha',
    });

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');

    act(() => buttons[0].click());
    expect(onToggleChartSession).toHaveBeenCalledWith('s1');

    unmount();
  });

  it('shows overflow control when many sessions are in scope', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      selected: true,
      series: {
        key: `series_s${index}`,
        label: `Session ${index + 1}`,
        status: 'ended',
        color: '#111',
        gradient: 'linear-gradient(#111, #333)',
        repoId: 'alpha',
        sessionIds: [`s${index}`],
        kind: 'session',
      },
    }));

    const { container, unmount } = renderLegend({
      ...baseProps,
      items,
      focusedProjectId: 'alpha',
    });

    expect(container.textContent).toContain('+2 more');
    const moreButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('more'),
    );
    expect(moreButton).toBeTruthy();
    act(() => moreButton.click());
    expect(container.textContent).not.toContain('+2 more');

    unmount();
  });
});

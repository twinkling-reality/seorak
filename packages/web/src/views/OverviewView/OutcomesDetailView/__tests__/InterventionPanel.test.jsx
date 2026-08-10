// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { InterventionPanel } from '../panels/InterventionPanel.js';
import { createEmptyOverview } from '../../../../lib/apiSchemas.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function render(Component, props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Component {...props} />));
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

const overview = createEmptyOverview(7);

describe('InterventionPanel', () => {
  it('empty fired list: shows the watch limits + honest "nothing tripped", NOT the old "engine ships" lie', () => {
    const { container, unmount } = render(InterventionPanel, {
      overview,
      fired: [],
      firedStatus: 'ready',
    });
    const text = container.textContent;
    expect(text.toLowerCase()).toContain('nothing has tripped in the last 7 days');
    // The false copy must be gone — the engine fires today.
    expect(text).not.toContain('Detection turns on when the engine ships');
    expect(text).not.toContain('engine ships');
    expect(text).not.toMatch(/\bsignals?\b/i);
    unmount();
  });

  it('unavailable fired list never claims that nothing tripped', () => {
    const { container, unmount } = render(InterventionPanel, {
      overview,
      fired: [],
      firedStatus: 'error',
    });
    const text = container.textContent;
    expect(text).toContain('Watch history is unavailable');
    expect(text.toLowerCase()).not.toContain('nothing has tripped');
    unmount();
  });

  it('non-empty fired list: renders the real fired intervention body + a count', () => {
    const fired = [
      {
        kind: 'cost_spike',
        sessionId: 's-1',
        project: 'seorak',
        repoId: 'a'.repeat(64),
        triggeredAt: '2026-06-04T12:00:00.000Z',
        signalLabel: 'Cost spike',
        body: 'This seorak session has spent $5.20 so far.',
        deepLink: 'seorak://session/s-1',
        interruptionLevel: 'timeSensitive',
      },
    ];
    const { container, unmount } = render(InterventionPanel, {
      overview,
      fired,
      firedStatus: 'ready',
    });
    const text = container.textContent;
    expect(text).toContain('This seorak session has spent $5.20 so far.');
    expect(text).toContain('tripped a watch limit');
    expect(text).not.toMatch(/\bsignals?\b/i);
    unmount();
  });
});

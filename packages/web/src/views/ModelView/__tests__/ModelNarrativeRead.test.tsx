// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeveloperModelSnapshot } from '@seorak/types';

import ModelNarrativeRead from '../ModelNarrativeRead.js';
import { compileSnapshotToPresentation } from '../compileSnapshotToPresentation.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE: DeveloperModelSnapshot = {
  scope: { rangeDays: 30, maxRangeDays: 90, repoId: null, generatedAt: '2026-07-01T12:00:00.000Z' },
  focus: { projectFocus: [] },
  outcomes: {
    shipRate: null,
    lineSurvival: {
      rate: null,
      linesAuthored: 0,
      linesSurviving: 0,
      commitsChecked: 0,
      sessionsRated: 0,
      retained: 0,
      overwritten: 0,
      unknown: 0,
      unreachable: 0,
    },
    shipped: 0,
    shipDeterminable: 0,
    stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    endReasons: [],
  },
  activity: { hourlyDistribution: [], endReasonsByHour: [] },
  tools: { byTool: [], byModel: [], callStats: { errorRate: null, erroredCalls: 0, callsWithResult: 0 }, verification: [] },
};

/** A snapshot rich enough to compile a rhythm + focus + payoff read. */
const RICH: DeveloperModelSnapshot = {
  ...BASE,
  focus: { projectFocus: [{ repoId: 'abc', project: 'seorak', sessions: 12, share: 0.8 }] },
  activity: {
    hourlyDistribution: [
      { dow: 2, hour: 20, sessions: 8 },
      { dow: 3, hour: 21, sessions: 7 },
    ],
    endReasonsByHour: [],
  },
  outcomes: {
    ...BASE.outcomes,
    endReasons: [{ reason: 'clear', count: 6 }],
    lineSurvival: { ...BASE.outcomes.lineSurvival, rate: 0.72, sessionsRated: 4 },
  },
};

describe('ModelNarrativeRead', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(snapshot: DeveloperModelSnapshot, displayName = 'Glendon') {
    // Pinned to UTC so RICH's 20:00 and 21:00 buckets mean the same thing on every
    // machine. Without it these fixtures are read on the runner's clock, and the
    // "evening developer" this file queries for is an afternoon one in US-Pacific.
    const presentation = compileSnapshotToPresentation(snapshot, {
      displayName,
      offsetMinutes: 0,
    });
    act(() => {
      root!.render(<ModelNarrativeRead presentation={presentation} />);
    });
    return presentation;
  }

  it('renders the compiled prose with facet-colored insight terms', () => {
    render(RICH);
    const text = container!.textContent ?? '';
    expect(text).toContain('Glendon,');
    expect(text).toContain('evening developer');

    const terms = container!.querySelectorAll('button[data-annotation-term]');
    expect(terms.length).toBeGreaterThan(0);
    const evening = container!.querySelector('button[data-annotation-term="evening developer"]');
    expect(evening?.getAttribute('data-facet')).toBe('rhythm');
    // No spatial-connector artifacts survive the rewrite.
    expect(container!.querySelector('svg')).toBeNull();
  });

  it('points a focused term at the peek it opened, and stops once pinned', () => {
    // A `role="tooltip"` nothing references is not announced, so a reader tabbing
    // through the terms opened a peek and was never told what it said. Pinning
    // moves focus into the card itself, where describing the term with it too
    // would read the whole card out twice.
    render(RICH);
    const term = container!.querySelector<HTMLButtonElement>(
      'button[data-annotation-term="evening developer"]',
    )!;

    // React maps onFocus to the bubbling `focusin`, not `focus`.
    act(() => term.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    const described = term.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(container!.querySelector(`#${described}`)?.getAttribute('role')).toBe('tooltip');

    act(() => term.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(term.getAttribute('aria-describedby')).toBeNull();
    expect(container!.querySelector('[role="region"]')).not.toBeNull();
  });

  it('opens the cited detail in place on click and toggles it closed', () => {
    render(RICH);
    const evening = container!.querySelector<HTMLButtonElement>(
      'button[data-annotation-term="evening developer"]',
    )!;

    expect(container!.querySelector('[role="region"]')).toBeNull();

    act(() => evening.click());
    const detail = container!.querySelector('[role="region"]');
    expect(detail).not.toBeNull();
    // The header names what the card MEASURED, not its facet: "When you work" also
    // titled the weekday card, and the facet is already carried by the card's hue.
    expect(detail?.getAttribute('aria-label')).toBe('When you start');
    expect(detail?.textContent).toContain('in the evening');
    expect(evening.getAttribute('aria-expanded')).toBe('true');

    act(() => evening.click());
    expect(container!.querySelector('[role="region"]')).toBeNull();
    expect(evening.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows only one detail at a time', () => {
    render(RICH);
    const terms = container!.querySelectorAll<HTMLButtonElement>('button[data-annotation-term]');
    expect(terms.length).toBeGreaterThanOrEqual(2);

    act(() => terms[0].click());
    act(() => terms[1].click());

    expect(container!.querySelectorAll('[role="region"]').length).toBe(1);
  });

  // The pinned card used to carry a "Done" chip, which made a margin note look
  // like a dialog owed an answer. These are the three dismissals that replaced it.
  describe('dismissing a pinned annotation without a close button', () => {
    it('carries no close control at all', () => {
      render(RICH);
      const evening = container!.querySelector<HTMLButtonElement>(
        'button[data-annotation-term="evening developer"]',
      )!;
      act(() => evening.click());

      const card = container!.querySelector('[role="region"]')!;
      expect(card.querySelector('button')).toBeNull();
      expect(card.textContent).not.toContain('Done');
    });

    it('closes on Escape and hands focus back to the term', () => {
      render(RICH);
      const evening = container!.querySelector<HTMLButtonElement>(
        'button[data-annotation-term="evening developer"]',
      )!;
      act(() => evening.click());
      expect(container!.querySelector('[role="region"]')).not.toBeNull();

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });

      expect(container!.querySelector('[role="region"]')).toBeNull();
      // Losing focus into the void is what the button was quietly preventing.
      expect(document.activeElement).toBe(evening);
    });

    it('closes when the reader clicks away from the read', () => {
      render(RICH);
      const evening = container!.querySelector<HTMLButtonElement>(
        'button[data-annotation-term="evening developer"]',
      )!;
      act(() => evening.click());

      act(() => {
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      });

      expect(container!.querySelector('[role="region"]')).toBeNull();
    });

    it('stays open while the reader is clicking inside the card', () => {
      render(RICH);
      const evening = container!.querySelector<HTMLButtonElement>(
        'button[data-annotation-term="evening developer"]',
      )!;
      act(() => evening.click());

      const card = container!.querySelector('[role="region"]')!;
      act(() => {
        card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      });

      expect(container!.querySelector('[role="region"]')).not.toBeNull();
    });
  });

  // hoverLines were declared on every insight and rendered nowhere, so a peek and
  // a pin showed the identical wall of citations. Two tiers: gist, then receipts.
  describe('peek shows the gist, pinning shows the evidence', () => {
    function hover(term: string) {
      const el = container!.querySelector<HTMLButtonElement>(
        `button[data-annotation-term="${term}"]`,
      )!;
      act(() => {
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      return el;
    }

    it('a peek carries ONE line with the count, and no citation trail', () => {
      render(RICH);
      hover('evening developer');
      const peek = container!.querySelector('[role="tooltip"]')!;
      // The peek used to withhold the number, which put a card-shaped surface on
      // screen with a connector pointing at it and nothing checkable inside. It
      // reads as broken rather than as restraint. One sentence, with the count.
      expect(peek.textContent).toMatch(/\d+ of \d+ session starts were in the evening/);
      expect(peek.querySelectorAll('li')).toHaveLength(1);
      // The boundary, the derivation and the runners-up still belong to the pin.
      expect(peek.textContent).not.toMatch(/17:00/);
      expect(peek.textContent).not.toContain('when each session STARTED');
    });

    it('pinning replaces the gist with the counts and the boundary', () => {
      render(RICH);
      const evening = container!.querySelector<HTMLButtonElement>(
        'button[data-annotation-term="evening developer"]',
      )!;
      act(() => evening.click());
      const card = container!.querySelector('[role="region"]')!;
      // The denominator, so the claim can be checked...
      expect(card.textContent).toMatch(/of \d+ session starts/);
      // ...the boundary it was counted against...
      expect(card.textContent).toContain('17:00 to 21:59');
      // ...and how it was derived.
      expect(card.textContent).toContain('when each session STARTED');
    });
  });

  it('renders the forming read for a thin window', () => {
    render(BASE, 'You');
    const text = container!.textContent ?? '';
    expect(text).toContain('run your first agent sessions');
    // Forming preview terms are still interactive insight spans.
    expect(container!.querySelectorAll('button[data-annotation-term]').length).toBe(5);
  });
});

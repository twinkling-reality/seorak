import { describe, expect, it } from 'vitest';

import { tooltipPlacement, type TooltipPlacementInput } from '../tooltipPlacement.js';

const input = (over: Partial<TooltipPlacementInput> = {}): TooltipPlacementInput => ({
  displayY: 400,
  panelLeft: 900,
  stripTop: 800,
  tooltipWidth: 360,
  tooltipHeight: 300,
  viewportWidth: 1440,
  viewportHeight: 900,
  ...over,
});

describe('tooltipPlacement', () => {
  it('hides itself until both the row and the panel have been measured', () => {
    expect(tooltipPlacement(input({ displayY: null }))).toEqual({ display: 'none' });
    expect(tooltipPlacement(input({ panelLeft: null }))).toEqual({ display: 'none' });
  });

  it('sits to the left of the panel with a gap when there is room', () => {
    const placed = tooltipPlacement(input());
    expect(placed).toMatchObject({ left: 900 - 360 - 12, width: 360 });
  });

  it('centres on the hovered row', () => {
    const placed = tooltipPlacement(input({ displayY: 400, tooltipHeight: 200 })) as {
      top: number;
    };
    expect(placed.top).toBe(300);
  });

  it('never overlaps the command strip', () => {
    const placed = tooltipPlacement(
      input({ displayY: 780, stripTop: 700, tooltipHeight: 300 }),
    ) as { top: number; maxHeight: number };
    // bottomLimit = 700 − 12 = 688; the card's foot must stop there.
    expect(placed.top + Math.min(300, placed.maxHeight)).toBeLessThanOrEqual(688);
  });

  it('never runs off the top edge', () => {
    const placed = tooltipPlacement(input({ displayY: 20 })) as { top: number };
    expect(placed.top).toBe(16);
  });

  it('flips to the bottom rail rather than running off the left edge', () => {
    const placed = tooltipPlacement(input({ panelLeft: 300 }));
    expect(placed).not.toHaveProperty('left');
    expect(placed).toMatchObject({ right: 24, width: 440 });
  });

  it('hugs the edge on a phone-width viewport', () => {
    const placed = tooltipPlacement(input({ panelLeft: 300, viewportWidth: 390 }));
    expect(placed).toMatchObject({ right: 8, width: 390 - 32 });
  });

  it('keeps a floor of readable height even when the strip crowds the viewport', () => {
    const placed = tooltipPlacement(input({ stripTop: 40 })) as { maxHeight: number };
    expect(placed.maxHeight).toBe(160);
  });

  it('falls back to the default height when the card has not been measured', () => {
    const unmeasured = tooltipPlacement(input({ tooltipHeight: 0, displayY: 400 })) as {
      top: number;
    };
    const measured = tooltipPlacement(input({ tooltipHeight: 300, displayY: 400 })) as {
      top: number;
    };
    expect(unmeasured.top).toBe(measured.top);
  });

  it('treats an unmeasured strip as the viewport floor', () => {
    const placed = tooltipPlacement(input({ stripTop: null, displayY: 890 })) as { top: number };
    expect(placed.top + 300).toBeLessThanOrEqual(900 - 16);
  });
});

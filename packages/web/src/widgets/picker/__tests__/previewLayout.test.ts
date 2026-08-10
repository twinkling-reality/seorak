import { describe, expect, it } from 'vitest';

import { WIDGET_CATALOG, widgetColSpan, type WidgetDef } from '../../catalog/index.js';
import { previewLayout } from '../previewLayout.js';

const widget = (over: Partial<WidgetDef> = {}): WidgetDef => ({
  id: 'test-widget',
  name: 'Test widget',
  description: 'A widget for tests.',
  category: 'usage',
  scope: 'both',
  viz: 'stat',
  w: 3,
  h: 2,
  dataKeys: ['token_usage'],
  ...over,
});

describe('previewLayout', () => {
  it('never upscales a widget narrower than the tooltip', () => {
    const { scale, clippedRight } = previewLayout(widget({ w: 3 }));
    expect(scale).toBeLessThanOrEqual(1);
    expect(scale).toBeCloseTo(326 / 340, 5);
    expect(clippedRight).toBe(false);
  });

  it('holds the floor for a full-width widget and clips instead of shrinking further', () => {
    const { scale, clippedRight } = previewLayout(widget({ w: 12 }));
    expect(scale).toBe(0.34);
    // 1360 × 0.34 = 462.4, wider than the 326px content box: the fade is on.
    expect(clippedRight).toBe(true);
  });

  it('derives natural height from the row-span formula, not the raw h', () => {
    // rowSpan 3 → 3 × 80 + 2 × 24 = 288.
    expect(previewLayout(widget({ h: 3 })).naturalH).toBe(288);
    // h clamps to the 2..6 row-span tiers, so h=1 is still a 2-row widget.
    expect(previewLayout(widget({ h: 1 })).naturalH).toBe(184);
  });

  it('caps the frame at the tooltip ceiling', () => {
    const tall = previewLayout(widget({ w: 3, h: 6 }));
    expect(tall.frameHeight).toBe(180);
    const short = previewLayout(widget({ w: 3, h: 2 }));
    expect(short.frameHeight).toBe(Math.round(184 * short.scale));
    expect(short.frameHeight).toBeLessThan(180);
  });

  it('produces a usable frame for every widget the catalog ships', () => {
    for (const w of WIDGET_CATALOG) {
      const layout = previewLayout(w);
      expect(layout.naturalW).toBeGreaterThan(0);
      expect(layout.frameHeight).toBeGreaterThan(0);
      expect(layout.frameHeight).toBeLessThanOrEqual(180);
      expect(layout.scale).toBeGreaterThanOrEqual(0.34);
      expect(layout.scale).toBeLessThanOrEqual(1);
      // The aspect the preview claims must follow the span the cockpit renders.
      expect(layout.naturalW).toBe(previewLayout(widget({ w: widgetColSpan(w) })).naturalW);
    }
  });
});

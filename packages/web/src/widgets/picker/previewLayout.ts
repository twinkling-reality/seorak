/**
 * How the live preview is miniaturized. Pure arithmetic, split from the component so
 * the "shrink until it is noise, then clip instead" rule can be checked without a
 * layout engine.
 */
import { widgetColSpan, widgetRowSpan, type WidgetColSpan, type WidgetDef } from '../catalog/index.js';

/** Tooltip content width available to the preview (tooltip 360 − 16px
 *  padding × 2 − 1px frame border × 2). */
const PREVIEW_INNER_WIDTH = 326;
/** Representative cockpit render width per column span (~113px/col on a
 *  desktop canvas). Only sets the preview's aspect, not a layout contract. */
const PREVIEW_NATURAL_WIDTH: Record<WidgetColSpan, number> = {
  3: 340,
  4: 450,
  6: 680,
  8: 900,
  12: 1360,
};
/** Below this scale a body is pure noise, so wide widgets render at the
 *  floor and clip on the right (with a fade) instead of shrinking further. */
const PREVIEW_MIN_SCALE = 0.34;
const PREVIEW_MAX_HEIGHT = 180;

export interface PreviewLayout {
  naturalW: number;
  naturalH: number;
  scale: number;
  frameHeight: number;
  clippedRight: boolean;
}

export function previewLayout(widget: WidgetDef): PreviewLayout {
  const naturalW = PREVIEW_NATURAL_WIDTH[widgetColSpan(widget)];
  const rowSpan = widgetRowSpan(widget);
  // Cell min-height formula from catalog/types.ts: 80px row units, 24px gaps.
  const naturalH = rowSpan * 80 + (rowSpan - 1) * 24;
  const scale = Math.max(PREVIEW_MIN_SCALE, Math.min(1, PREVIEW_INNER_WIDTH / naturalW));
  const frameHeight = Math.min(Math.round(naturalH * scale), PREVIEW_MAX_HEIGHT);
  const clippedRight = naturalW * scale > PREVIEW_INNER_WIDTH + 1;
  return { naturalW, naturalH, scale, frameHeight, clippedRight };
}

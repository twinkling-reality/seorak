/**
 * Where the hover card lands. Pure geometry over measured rects, so the two rules
 * that matter — never overlap the command strip, and flip to the bottom rail rather
 * than run off the left edge — hold without a browser to prove them in.
 */

const VIEWPORT_PAD = 16;
const FLOATING_GAP = 12;
const PANEL_RIGHT = 24;
export const TOOLTIP_WIDTH = 360;
const TOOLTIP_WIDE_WIDTH = 440;
export const TOOLTIP_FALLBACK_HEIGHT = 300;
const TOOLTIP_MIN_HEIGHT = 160;

export interface TooltipPlacementInput {
  /** Vertical centre of the hovered row, or null when nothing is hovered. */
  displayY: number | null;
  /** The picker panel's rect; the card is placed relative to its left edge. */
  panelLeft: number | null;
  /** Top of the command strip, or null when it has not been measured. */
  stripTop: number | null;
  tooltipWidth: number;
  tooltipHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export type TooltipPlacement =
  | { display: 'none' }
  | { left: number; top: number; width: number; maxHeight: number }
  | { right: number; bottom: number; width: number; maxHeight: number };

export function tooltipPlacement(input: TooltipPlacementInput): TooltipPlacement {
  const { displayY, panelLeft } = input;
  if (displayY === null || panelLeft === null) return { display: 'none' };
  const tooltipW = input.tooltipWidth || TOOLTIP_WIDTH;
  const vh = input.viewportHeight;
  const vw = input.viewportWidth;
  const stripSafeTop = input.stripTop ?? vh;
  const bottomLimit = Math.max(
    VIEWPORT_PAD + TOOLTIP_MIN_HEIGHT,
    Math.min(vh - VIEWPORT_PAD, stripSafeTop - FLOATING_GAP),
  );
  const availableHeight = Math.max(TOOLTIP_MIN_HEIGHT, bottomLimit - VIEWPORT_PAD);
  const tooltipH = Math.min(input.tooltipHeight || TOOLTIP_FALLBACK_HEIGHT, availableHeight);
  const leftPos = panelLeft - tooltipW - FLOATING_GAP;
  const maxHeight = availableHeight;

  if (leftPos >= VIEWPORT_PAD) {
    const top = Math.max(
      VIEWPORT_PAD,
      Math.min(displayY - tooltipH / 2, bottomLimit - tooltipH),
    );
    return { left: leftPos, top, width: TOOLTIP_WIDTH, maxHeight };
  }

  const bottom = Math.max(VIEWPORT_PAD, vh - bottomLimit);
  const width = Math.min(TOOLTIP_WIDE_WIDTH, Math.max(240, vw - VIEWPORT_PAD * 2));
  return {
    right: vw <= 640 ? 8 : PANEL_RIGHT,
    bottom,
    width,
    maxHeight,
  };
}

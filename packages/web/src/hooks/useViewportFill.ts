import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Height that lets an element fill the viewport without the page scrolling.
 *
 * The dashboard shell scrolls at the document level, so filling "the rest of
 * the screen" is not `100dvh` minus a guess: the chrome above moves (banner
 * slot, wrapping breadcrumb) and the chrome BELOW is real too — the content
 * wrapper carries 88px of bottom padding, which is exactly how much the page
 * scrolled by before this accounted for it.
 *
 * So it measures both: collapse the element to zero, read where it sits and how
 * tall the document still is beneath that point, then take what is left.
 *
 * Returns null while the viewport is too small to be worth pinning — the caller
 * falls back to normal document flow, because pinning a tall surface on a small
 * screen is worse than letting the page scroll.
 *
 * These thresholds are mirrored by a media query in `DashboardApp.module.css`
 * (`.contentPinned`), which trims the shell's end-of-read bottom padding only
 * while a pinned view can actually use the height. Change one, change the other.
 */
/**
 * Layout the page still renders beneath an element: following siblings, and
 * every ancestor's bottom padding, border, and margin.
 *
 * Reading `document.scrollHeight` instead does not work here — the shell sets
 * `min-height: 100vh`, so the document never measures shorter than the viewport
 * and the slack is invisible from the outside. Walking the box tree is exact
 * and does not care what clamps sit above it.
 */
function spaceBelow(node: HTMLElement): number {
  let below = 0;
  let el: HTMLElement = node;

  while (el.parentElement && el !== document.body) {
    const parent = el.parentElement;
    for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
      const sibStyle = getComputedStyle(sib);
      if (sibStyle.position === 'absolute' || sibStyle.position === 'fixed') continue;
      below +=
        sib.getBoundingClientRect().height +
        (parseFloat(sibStyle.marginTop) || 0) +
        (parseFloat(sibStyle.marginBottom) || 0);
    }
    const parentStyle = getComputedStyle(parent);
    below +=
      (parseFloat(parentStyle.paddingBottom) || 0) +
      (parseFloat(parentStyle.borderBottomWidth) || 0);
    below += parseFloat(getComputedStyle(el).marginBottom) || 0;
    el = parent;
  }

  return below;
}

export function useViewportFill(
  ref: RefObject<HTMLElement | null>,
  { minHeight = 640, minWidth = 900 }: { minHeight?: number; minWidth?: number } = {},
): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => {
      if (window.innerHeight < minHeight || window.innerWidth < minWidth) {
        setHeight(null);
        return;
      }
      const rect = node.getBoundingClientRect();
      const next = Math.round(window.innerHeight - rect.top - spaceBelow(node));
      setHeight(next > 320 ? next : null);
    };

    measure();
    window.addEventListener('resize', measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      // Chrome above the element changing height moves our top edge.
      if (node.parentElement) observer.observe(node.parentElement);
    }
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [ref, minHeight, minWidth]);

  return height;
}

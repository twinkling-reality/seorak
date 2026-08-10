import { useEffect, useRef, type RefObject } from 'react';

/**
 * Vertical peer of useTabKeyboard. Listens for ArrowUp/ArrowDown/Home/
 * End on the document and moves selection through a vertical list of
 * items identified by a `data-question` attribute.
 *
 * Why global (document) listener rather than scoped to the nav: the
 * horizontal sibling lives on document too. A user on the detail page
 * expects arrow keys to nav without having to click into the sidebar
 * first. The trade-off is that ↑/↓ no longer scrolls the page via
 * keyboard while the hook is mounted - acceptable here because the
 * detail panel rarely exceeds the viewport and scroll via trackpad/
 * mouse wheel still works. Skip when focus is inside an editable
 * element so typing isn't hijacked.
 *
 * Wraps at both ends (Up from first → last, Down from last → first) to
 * match the horizontal hook's wrap-around behavior.
 */
export function useVerticalTabKeyboard(
  itemIds: string[],
  activeId: string | null,
  onSelect: (id: string) => void,
): RefObject<HTMLElement | null> {
  const containerRef = useRef<HTMLElement | null>(null);
  const idsRef = useRef<string[]>(itemIds);
  const activeRef = useRef<string | null>(activeId);

  useEffect(() => {
    idsRef.current = itemIds;
  });
  useEffect(() => {
    activeRef.current = activeId;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Home' && e.key !== 'End') {
        return;
      }
      // Leave typing alone. Without this, ↑/↓ inside a textarea would
      // nav the sidebar instead of moving the caret.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }

      const ids = idsRef.current;
      if (ids.length === 0) return;

      const current = activeRef.current;
      const curIdx = current ? ids.indexOf(current) : -1;
      let nextIdx = curIdx;
      if (e.key === 'ArrowDown') nextIdx = curIdx < 0 ? 0 : (curIdx + 1) % ids.length;
      else if (e.key === 'ArrowUp')
        nextIdx = curIdx < 0 ? 0 : (curIdx - 1 + ids.length) % ids.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = ids.length - 1;

      if (nextIdx === curIdx) return;
      e.preventDefault();
      const nextId = ids[nextIdx];
      onSelect(nextId);
      containerRef.current?.querySelector<HTMLElement>(`[data-question="${nextId}"]`)?.focus();
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onSelect]);

  return containerRef;
}

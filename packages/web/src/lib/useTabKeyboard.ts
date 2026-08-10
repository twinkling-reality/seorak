import { useRef, useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';

export function useTabKeyboard(
  tabIds: string[],
  setActiveTab: Dispatch<SetStateAction<string>>,
): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabIdsRef = useRef<string[]>(tabIds);
  useEffect(() => {
    tabIdsRef.current = tabIds;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      const ids = tabIdsRef.current;
      setActiveTab((prev: string) => {
        const cur = ids.indexOf(prev);
        const next =
          e.key === 'ArrowRight'
            ? ids[(cur + 1) % ids.length]
            : ids[(cur - 1 + ids.length) % ids.length];
        containerRef.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
        return next;
      });
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setActiveTab]);

  return containerRef;
}

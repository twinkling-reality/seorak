import { useEffect } from 'react';

/**
 * A single-letter toggle bound at the window. One definition of "not while the
 * reader is typing" — a second copy of that guard is how a shortcut ends up
 * firing inside a text field.
 */
export function useToggleHotkey({
  key,
  enabled = true,
  onToggle,
}: {
  /** Lower-case letter, matched without modifiers and case-insensitively. */
  key: string;
  enabled?: boolean;
  onToggle: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.isContentEditable) return;
      }
      if (event.key.toLowerCase() !== key) return;
      event.preventDefault();
      onToggle();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, key, onToggle]);
}

export function useCustomizeHotkey({
  enabled = true,
  onToggle,
}: {
  enabled?: boolean;
  onToggle: () => void;
}) {
  useToggleHotkey({ key: 'c', enabled, onToggle });
}

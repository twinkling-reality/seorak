// Lightweight hover/focus tooltip with an optional keyboard-shortcut chip.
// Replaces native `title=` on icon-only controls so we get consistent
// styling, faster reveal, and shortcut hints inline.
//
// Hover shows the tooltip after `delayMs` (default 280ms). Focus shows
// it immediately. Both hide synchronously to avoid feeling sluggish. On
// touch devices (`@media (hover: none)`), the tooltip is suppressed via
// CSS so it never appears.
//
// Placements: `top`/`bottom` render in-flow (absolute inside the wrapper),
// which is fine anywhere overflow is visible. `right` exists for triggers
// inside a scroll container (the collapsed sidebar rail is overflow-y: auto,
// which also clips horizontally) — it portals to <body> at a fixed position
// measured from the wrapper when the tooltip opens, and hides on any scroll
// or resize so the pill can never drift from its trigger.

import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

/** The trigger element a Tooltip can wrap (exported so conditional wrappers
 *  like the sidebar's RailTip can type their children identically). */
export type TooltipChild = ReactElement;

interface Props {
  label?: string;
  content?: ReactNode;
  shortcut?: string;
  placement?: 'top' | 'bottom' | 'right';
  delayMs?: number;
  /** Definition-length labels: wrap in a readable measure (~240px) instead of
   *  one enormous single-line pill. Leave off for short name/shortcut labels. */
  wrap?: boolean;
  children: TooltipChild;
}

export default function Tooltip({
  label,
  content,
  shortcut,
  placement = 'top',
  delayMs = 280,
  wrap = false,
  children,
}: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const [fixedPos, setFixedPos] = useState<{ left: number; top: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  const clearTimer = (): void => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = (): void => {
    if (placement === 'right') {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) setFixedPos({ left: rect.right + 8, top: rect.top + rect.height / 2 });
    }
    setOpen(true);
  };

  const showAfterDelay = (): void => {
    clearTimer();
    timerRef.current = window.setTimeout(show, delayMs);
  };

  const showNow = (): void => {
    clearTimer();
    show();
  };

  const hide = (): void => {
    clearTimer();
    setOpen(false);
  };

  useEffect(() => clearTimer, []);

  // The fixed-position pill is measured once on open; if the page (or the
  // trigger's scroll container) moves under it, hide rather than track.
  useEffect(() => {
    if (!open || placement !== 'right') return;
    const onMove = (): void => setOpen(false);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, placement]);

  const pill = (
    <span
      id={id}
      role="tooltip"
      className={`${styles.tooltip} ${styles[placement]} ${content ? styles.contentPanel : wrap ? styles.wrap : ''} ${open ? styles.open : ''}`}
      aria-hidden={!open}
      aria-label={content ? label : undefined}
      style={placement === 'right' && fixedPos ? fixedPos : undefined}
    >
      {content ?? (
        <>
          <span className={styles.label}>{label}</span>
          {shortcut ? <kbd className={styles.kbd}>{shortcut}</kbd> : null}
        </>
      )}
    </span>
  );

  return (
    <span
      ref={wrapperRef}
      className={styles.wrapper}
      onMouseEnter={showAfterDelay}
      onMouseLeave={hide}
      onFocus={showNow}
      onBlur={hide}
    >
      {children}
      {placement === 'right' ? open && fixedPos && createPortal(pill, document.body) : pill}
    </span>
  );
}

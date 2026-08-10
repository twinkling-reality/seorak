import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

import glass from '../surface/glass.module.css';
import styles from './ProjectDropdown.module.css';

/**
 * Portaled menu layer for ProjectDropdown. Kept in its own lazy chunk because
 * geometry and react-dom portal code are needed only while a picker is open, not
 * in the dashboard's startup path.
 */
export default function ProjectDropdownMenu({
  trigger,
  width,
  align,
  menuId,
  ariaLabel,
  maxHeight = 320,
  fixedWidth,
  onClose,
  onReady,
  children,
}: {
  trigger: HTMLButtonElement | null;
  width: 'auto' | 'fill';
  align: 'start' | 'end';
  menuId: string;
  ariaLabel?: string;
  /** Ceiling for the menu; still clamped to the room the viewport has. */
  maxHeight?: number;
  /** Overrides the trigger-derived width, for menus carrying two columns. */
  fixedWidth?: number;
  onClose: () => void;
  onReady: () => void;
  children: ReactNode;
}) {
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const announcedReady = useRef(false);

  useLayoutEffect(() => {
    if (!trigger) return;

    const positionMenu = () => {
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 12;
      const menuWidth =
        width === 'fill'
          ? rect.width
          : (fixedWidth ?? Math.min(320, Math.max(240, rect.width)));
      const preferredLeft = align === 'end' ? rect.right - menuWidth : rect.left;
      const left = Math.min(
        Math.max(viewportPadding, preferredLeft),
        Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding),
      );
      const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
      const roomAbove = rect.top - viewportPadding;
      const openAbove = roomBelow < 180 && roomAbove > roomBelow;
      const availableHeight = Math.max(120, openAbove ? roomAbove - 6 : roomBelow);

      setMenuStyle({
        left,
        width: menuWidth,
        maxHeight: Math.min(maxHeight, availableHeight),
        ...(openAbove
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      });
    };

    positionMenu();
    window.addEventListener('scroll', positionMenu, true);
    window.addEventListener('resize', positionMenu);
    return () => {
      window.removeEventListener('scroll', positionMenu, true);
      window.removeEventListener('resize', positionMenu);
    };
  }, [align, fixedWidth, maxHeight, trigger, width]);

  useLayoutEffect(() => {
    if (!menuStyle || announcedReady.current) return;
    announcedReady.current = true;
    onReady();
  }, [menuStyle, onReady]);

  if (!menuStyle) return null;

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        id={menuId}
        className={clsx(styles.menu, glass.sheetStrong, glass.rim)}
        style={menuStyle}
        role="menu"
        aria-label={ariaLabel}
      >
        <div className={styles.menuList}>{children}</div>
      </div>
    </>,
    document.body,
  );
}

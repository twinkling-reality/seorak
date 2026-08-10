import {
  lazy,
  Suspense,
  useCallback,
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import clsx from 'clsx';

import Toggle from '../controls/Toggle.js';
import glassTrigger from '../controls/glassTrigger.module.css';
import supCount from '../controls/supCount.module.css';
import glass from '../surface/glass.module.css';
import styles from './ProjectDropdown.module.css';

const ProjectDropdownMenu = lazy(() => import('./ProjectDropdownMenu.js'));

function Chevron() {
  return (
    <svg
      className={styles.chevron}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 3.5 L5 6.5 L8 3.5" />
    </svg>
  );
}


export function ProjectDropdownSwatch({
  style,
  className,
  size = 'md',
}: {
  style: CSSProperties;
  className?: string;
  size?: 'md' | 'lg';
}) {
  return (
    <span
      className={clsx(styles.swatch, size === 'lg' && styles.swatchLg, className)}
      style={style}
      aria-hidden="true"
    />
  );
}

export const ProjectDropdownItem = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function ProjectDropdownItem({ className, type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} className={clsx(styles.item, className)} {...props} />;
});

export function ProjectDropdownItemLabel({ children }: { children: ReactNode }) {
  return <span className={styles.itemLabel}>{children}</span>;
}

export function ProjectDropdownItemName({ children }: { children: ReactNode }) {
  return <span className={styles.itemName}>{children}</span>;
}

export function ProjectDropdownItemCount({ children }: { children: ReactNode }) {
  return <sup className={supCount.supCount}>{children}</sup>;
}

export function ProjectDropdownToggle({ on, mixed }: { on: boolean; mixed?: boolean }) {
  return <Toggle on={on} mixed={mixed ?? false} className={styles.itemToggle} />;
}

export function ProjectDropdownRadioCheck({ checked }: { checked: boolean }) {
  return (
    <span className={clsx(styles.radioCheck, checked && styles.radioCheckOn)} aria-hidden="true">
      {checked ? (
        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 5.5 L4 7.5 L8 2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  );
}

export function ProjectDropdownTriggerLabel({ children }: { children: ReactNode }) {
  return <span className={styles.triggerLabel}>{children}</span>;
}

export function ProjectDropdownStatic({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={clsx(styles.static, glass.sheet, glass.rim)} title={title}>
      {children}
    </span>
  );
}

export function ProjectDropdownStaticLabel({ children }: { children: ReactNode }) {
  return <span className={styles.staticLabel}>{children}</span>;
}

export default function ProjectDropdown({
  ariaLabel,
  trigger,
  children,
  width = 'auto',
  triggerSize = 'sm',
  menuAlign = 'start',
  open: openProp,
  active = false,
  onOpenChange,
  onOpen,
  triggerRef,
  menuAriaLabel,
  menuMaxHeight,
  menuWidth,
  ariaDescribedBy,
}: {
  ariaLabel: string;
  trigger: ReactNode;
  children: ReactNode;
  width?: 'auto' | 'fill';
  triggerSize?: 'sm' | 'lg';
  menuAlign?: 'start' | 'end';
  open?: boolean;
  /**
   * Engaged-looking while its menu is shut — for a trigger that also stands for
   * something it opened elsewhere, so pressing it again reads as closing that.
   */
  active?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpen?: () => void;
  triggerRef?: React.Ref<HTMLButtonElement>;
  menuAriaLabel?: string;
  /** Taller ceiling for menus that carry grouped catalogs, not a short list. */
  menuMaxHeight?: number;
  /** Fixed menu width, for menus whose rows carry a label and a description. */
  menuWidth?: number;
  ariaDescribedBy?: string;
}) {
  const [openUncontrolled, setOpenUncontrolled] = useState(false);
  const open = openProp ?? openUncontrolled;
  const setOpen = useCallback(
    (next: boolean | ((value: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(open) : next;
      onOpenChange?.(resolved);
      if (openProp === undefined) setOpenUncontrolled(resolved);
    },
    [onOpenChange, open, openProp],
  );
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const onOpenRef = useRef(onOpen);
  const menuId = useId();
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  function setButtonRef(node: HTMLButtonElement | null) {
    buttonRef.current = node;
    if (typeof triggerRef === 'function') triggerRef(node);
    else if (triggerRef) triggerRef.current = node;
  }

  return (
    <div className={clsx(styles.root, width === 'fill' && styles.rootFill)}>
      <button
        ref={setButtonRef}
        type="button"
        className={clsx(
          glassTrigger.glassTrigger,
          triggerSize === 'lg' && glassTrigger.glassTriggerLg,
          glass.sheet,
          glass.rim,
          width === 'fill' && glassTrigger.glassTriggerFill,
          (open || active) && glassTrigger.glassTriggerActive,
          // The chevron points up whenever pressing this collapses what is
          // showing — its own menu, or the surface it opened elsewhere.
          (open || active) && styles.triggerOpen,
        )}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-describedby={ariaDescribedBy}
      >
        {trigger}
        <Chevron />
      </button>
      {open && (
        <Suspense fallback={null}>
          <ProjectDropdownMenu
            trigger={buttonRef.current}
            width={width}
            align={menuAlign}
            menuId={menuId}
            ariaLabel={menuAriaLabel}
            {...(menuMaxHeight != null ? { maxHeight: menuMaxHeight } : {})}
            {...(menuWidth != null ? { fixedWidth: menuWidth } : {})}
            onClose={() => setOpen(false)}
            onReady={() => onOpenRef.current?.()}
          >
            {children}
          </ProjectDropdownMenu>
        </Suspense>
      )}
    </div>
  );
}

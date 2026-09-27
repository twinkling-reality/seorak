import { type ReactNode, useEffect, useState } from 'react';
import { BrandMark } from '../../brand/brand.js';
import styles from './DesktopShellGate.module.css';

/** Viewport min-width for the authenticated dashboard (grid + detail views). */
export const DASHBOARD_SHELL_MIN_WIDTH_PX = 1024;

function shellMediaQuery(): string {
  return `(min-width: ${DASHBOARD_SHELL_MIN_WIDTH_PX}px)`;
}

export function useDashboardShellWide(): boolean {
  const [wide, setWide] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(shellMediaQuery()).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(shellMediaQuery());
    const onChange = (): void => setWide(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return wide;
}

function NarrowDashboardNotice(): ReactNode {
  return (
    <div className={styles.shell} role="status" aria-live="polite">
      <div className={styles.inner}>
        <div className={styles.glyph} aria-hidden="true">
          <BrandMark size={44} />
        </div>
        <h1 className={styles.title}>This dashboard needs a wider screen</h1>
        <p className={styles.body}>
          The overview and detail panels need a laptop or tablet landscape, about{' '}
          {DASHBOARD_SHELL_MIN_WIDTH_PX}px or wider.
        </p>
        <a className={styles.marketLink} href="/">
          Back to the home page
        </a>
      </div>
    </div>
  );
}

/** When the viewport is too narrow, show an honest desktop-first gate instead of the grid shell. */
export function DesktopShellGate({
  wide,
  children,
}: {
  wide: boolean;
  children: ReactNode;
}): ReactNode {
  if (!wide) return <NarrowDashboardNotice />;
  return children;
}

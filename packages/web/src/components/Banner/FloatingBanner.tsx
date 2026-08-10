// Contextual page hints that float above content in the shared #bottom-floaters
// zone (same baseline as the minimized ChatBar FAB).

import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import Banner from './Banner.js';
import styles from './FloatingBanner.module.css';

interface BannerAction {
  label: string;
  onClick: () => void;
}

interface Props {
  variant?: 'error' | 'info' | 'success';
  eyebrow?: string;
  children: ReactNode;
  meta?: string;
  actions?: BannerAction[];
  onDismiss?: () => void;
}

function getFloaterZone(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('bottom-floaters');
}

export default function FloatingBanner({
  variant = 'info',
  eyebrow,
  children,
  meta,
  actions,
  onDismiss,
}: Props) {
  const zone = getFloaterZone();

  const node = (
    <div className={styles.shell}>
      <Banner
        variant={variant}
        compact
        eyebrow={eyebrow}
        meta={meta}
        actions={actions}
        onDismiss={onDismiss}
      >
        {children}
      </Banner>
    </div>
  );

  // index.html owns the shared floater zone. If that shell contract regresses,
  // keep the warning visible in place instead of silently erasing product truth.
  return zone ? createPortal(node, zone) : node;
}

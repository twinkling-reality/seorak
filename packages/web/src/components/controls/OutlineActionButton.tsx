import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './OutlineActionButton.module.css';

export interface OutlineActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  size?: 'md' | 'sm';
  tone?: 'default' | 'danger';
}

/** Secondary outline squircle — edit, retry, and other non-primary ink actions. */
export default function OutlineActionButton({
  children,
  size = 'md',
  tone = 'default',
  className,
  type = 'button',
  ...rest
}: OutlineActionButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        styles.button,
        size === 'sm' && styles.buttonSm,
        tone === 'danger' && styles.buttonDanger,
        className,
      )}
      {...rest}
    >
      <span className={styles.label}>{children}</span>
    </button>
  );
}

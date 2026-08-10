import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Banner.module.css';

interface BannerAction {
  label: string;
  onClick: () => void;
}

interface Props {
  variant?: 'error' | 'info' | 'success';
  /** Single-row layout for bottom floaters — eyebrow and copy stay on one line when space allows. */
  compact?: boolean;
  eyebrow?: string;
  children: ReactNode;
  meta?: string;
  actions?: BannerAction[];
  onDismiss?: () => void;
}

export default function Banner({
  variant = 'info',
  compact = false,
  eyebrow,
  children,
  meta,
  actions,
  onDismiss,
}: Props) {
  return (
    <div
      className={clsx(styles.banner, styles[variant], compact && styles.compact)}
      role="status"
      aria-live="polite"
    >
      <div className={styles.body}>
        {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
        <span className={styles.text}>{children}</span>
        {meta && <span className={styles.meta}>{meta}</span>}
        {actions?.map(({ label, onClick }) => (
          <button key={label} type="button" className={styles.action} onClick={onClick}>
            {label}
          </button>
        ))}
      </div>

      {onDismiss && (
        <button className={styles.dismiss} onClick={() => onDismiss()} aria-label="Dismiss">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 3l8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Pending.module.css';

interface PendingProps {
  label?: string;
  delayMs?: number;
  inline?: boolean;
}

function useDelayedVisible(delayMs: number): boolean {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const id = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);

  return visible;
}

export function RoutePending({
  label = 'Loading page',
  delayMs = 220,
}: Omit<PendingProps, 'inline'>): ReactNode {
  const visible = useDelayedVisible(delayMs);
  if (!visible) return null;
  return <Pending label={label} />;
}

export function InlinePending({
  label = 'Loading',
  delayMs = 160,
}: Omit<PendingProps, 'inline'>): ReactNode {
  const visible = useDelayedVisible(delayMs);
  if (!visible) return null;
  return <Pending label={label} inline />;
}

function Pending({ label, inline = false }: PendingProps): ReactNode {
  return (
    <div
      className={clsx(styles.pending, inline && styles.pendingInline)}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className={styles.pendingInner}>
        <span className={styles.label}>{label}</span>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} />
        </span>
      </span>
    </div>
  );
}


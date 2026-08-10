import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './EmptyState.module.css';

interface Props {
  title: string;
  hint?: ReactNode;
  large?: boolean;
}

export default function EmptyState({ title, hint = '', large = false }: Props) {
  const cls = clsx(styles.emptyState, large && styles.large);

  return (
    <div className={cls} role="status">
      <p className={styles.emptyTitle}>{title}</p>
      {hint && <p className={styles.emptyHint}>{hint}</p>}
    </div>
  );
}

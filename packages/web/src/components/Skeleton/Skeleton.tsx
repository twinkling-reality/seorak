import { createElement, type ReactNode, type ElementType } from 'react';
import clsx from 'clsx';
import styles from './Skeleton.module.css';

interface SkeletonLineProps {
  width?: string | number;
  height?: number;
  delay?: number;
}

export function SkeletonLine({ width = '100%', height = 14, delay = 0 }: SkeletonLineProps) {
  return <span className={styles.line} style={{ width, height, animationDelay: `${delay}ms` }} />;
}

interface SkeletonStatGridProps {
  count?: number;
}

export function SkeletonStatGrid({ count = 4 }: SkeletonStatGridProps) {
  return (
    <div className={styles.statGrid}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.statCell} style={{ animationDelay: `${i * 60}ms` }}>
          <SkeletonLine width={56} height={10} delay={i * 60} />
          <SkeletonLine width="60%" height={48} delay={i * 60 + 40} />
        </div>
      ))}
    </div>
  );
}

interface SkeletonRowsProps {
  count?: number;
  columns?: number;
}

export function SkeletonRows({ count = 4, columns = 3 }: SkeletonRowsProps) {
  return (
    <div className={styles.rows}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.row} style={{ animationDelay: `${i * 50}ms` }}>
          <SkeletonLine width="40%" height={12} delay={i * 50} />
          {Array.from({ length: columns - 1 }, (_, j) => (
            <SkeletonLine key={j} width={48} height={12} delay={i * 50 + 30} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface ShimmerTextProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}

export function ShimmerText({ children, as: Tag = 'h2', className = '' }: ShimmerTextProps) {
  return createElement(Tag, { className: clsx(styles.shimmerText, className) }, children);
}

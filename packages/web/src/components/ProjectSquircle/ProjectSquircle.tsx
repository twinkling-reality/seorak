import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';

import { projectGradient } from '../../lib/projectGradient.js';
import styles from './ProjectSquircle.module.css';

export type ProjectSquircleSize = 'xs' | 'sm' | 'md';

const SIZE_CLASS: Record<ProjectSquircleSize, string> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  md: styles.sizeMd,
};

/** Stable hash input for projectGradient — repoId when present, else display name. */
export function projectSquircleKey(repoId?: string | null, project?: string | null): string {
  return repoId || project || 'unknown';
}

export default function ProjectSquircle({
  projectKey,
  size = 'sm',
  active = false,
  className,
  style,
}: {
  /** repoId preferred; project display name is an acceptable fallback for the gradient hash. */
  projectKey: string;
  size?: ProjectSquircleSize;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={clsx(
        styles.projectSquircle,
        SIZE_CLASS[size],
        active && styles.active,
        className,
      )}
      style={{ ...style, background: projectGradient(projectKey) }}
      aria-hidden="true"
    />
  );
}

export function ProjectIdentity({
  projectKey,
  label,
  size = 'sm',
  active = false,
  className,
  labelClassName,
  title,
}: {
  projectKey: string;
  label: ReactNode;
  size?: ProjectSquircleSize;
  active?: boolean;
  className?: string;
  labelClassName?: string;
  title?: string;
}) {
  return (
    <span className={clsx(styles.identity, className)} title={title}>
      <ProjectSquircle projectKey={projectKey} size={size} active={active} />
      <span className={clsx(styles.identityLabel, labelClassName)}>{label}</span>
    </span>
  );
}

/**
 * The project identity mark set inline in answer prose. Same squircle the table
 * rows carry (same gradient key), but em-sized so it tracks whatever prose it
 * sits in and baseline-aligned so it reads as one word with the project name.
 * Use this instead of a bare <Metric> when an answer names a project, so the
 * sentence carries the same identity the rows below it do.
 */
export function ProjectInline({
  projectKey,
  label,
  title,
}: {
  projectKey: string;
  label: ReactNode;
  title?: string;
}) {
  return (
    <span className={styles.inline} title={title}>
      <span
        className={styles.inlineSquircle}
        style={{ background: projectGradient(projectKey) }}
        aria-hidden="true"
      />
      <span className={styles.inlineLabel}>{label}</span>
    </span>
  );
}

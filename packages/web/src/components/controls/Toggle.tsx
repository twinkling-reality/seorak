import clsx from 'clsx';

import styles from './Toggle.module.css';

export default function Toggle({
  on,
  mixed = false,
  className,
}: {
  on: boolean;
  /**
   * Some, but not all. Only meaningful on a control that stands for a set —
   * a master toggle reading "off" while part of its set is on is a small lie.
   */
  mixed?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx(styles.toggle, on && styles.toggleOn, !on && mixed && styles.toggleMixed, className)}
      aria-hidden="true"
    />
  );
}

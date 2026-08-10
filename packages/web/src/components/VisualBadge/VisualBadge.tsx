import clsx from 'clsx';
import { getVisualMeta, type VisualKind } from '../../lib/visualMeta.js';
import styles from './VisualBadge.module.css';

interface Props {
  kind: VisualKind;
  id: string;
  size?: number;
  className?: string;
  ariaHidden?: boolean;
}

/** Small brand badge for closed enums (language, framework, etc.). */
export default function VisualBadge({
  kind,
  id,
  size = 18,
  className = '',
  ariaHidden = true,
}: Props) {
  const meta = getVisualMeta(kind, id);

  if (meta.icon) {
    return (
      <span
        className={clsx(styles.badge, styles.masked, className)}
        style={{
          width: size,
          height: size,
          backgroundColor: meta.color,
          WebkitMaskImage: `url(${meta.icon})`,
          maskImage: `url(${meta.icon})`,
        }}
        aria-hidden={ariaHidden}
      />
    );
  }

  return (
    <span
      className={clsx(styles.badge, className)}
      style={{
        width: size,
        height: size,
        backgroundColor: meta.color,
        fontSize: meta.abbrev.length > 2 ? '0.48rem' : '0.58rem',
      }}
      aria-hidden={ariaHidden}
    >
      {meta.abbrev}
    </span>
  );
}

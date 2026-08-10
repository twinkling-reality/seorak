import styles from './SectionOverflow.module.css';

interface Props {
  count: number;
  label: string;
  onClick: () => void;
}

export default function SectionOverflow({ count, label, onClick }: Props) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      className={styles.sectionOverflow}
      onClick={onClick}
      aria-label={`View ${count} more ${label}`}
    >
      <span className={styles.label}>
        +{count} more {label}
      </span>
      <span className={styles.icon} aria-hidden="true">
        {'\u2192'}
      </span>
    </button>
  );
}

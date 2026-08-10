import clsx from 'clsx';
import styles from './StatusState.module.css';

interface Props {
  eyebrow?: string;
  title: string;
  hint?: string;
  detail?: string | null;
  meta?: string;
  tone?: 'neutral' | 'danger' | 'loading';
  actionLabel?: string;
  onAction?: (() => void) | null;
}

export default function StatusState({
  eyebrow,
  title,
  hint = '',
  detail = '',
  meta = '',
  tone = 'neutral',
  actionLabel = '',
  onAction = null,
}: Props) {
  const toneClass =
    tone === 'danger' ? styles.danger : tone === 'loading' ? styles.loading : styles.neutral;

  return (
    <section className={clsx(styles.state, toneClass)} role="status" aria-live="polite">
      <div className={styles.topline}>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </div>

      <h2 className={styles.title}>{title}</h2>
      {hint ? <p className={styles.hint}>{hint}</p> : null}

      {detail || (actionLabel && onAction) ? (
        <div className={styles.footer}>
          {detail ? <p className={styles.detail}>{detail}</p> : <span />}
          {actionLabel && onAction ? (
            <button type="button" className={styles.actionButton} onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

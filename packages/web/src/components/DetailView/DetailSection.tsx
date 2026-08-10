import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './DetailSection.module.css';

interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** Plain label. Use when the section is purely descriptive (no
   * question/answer framing applies). Prefer `question` for analytical
   * sections - every viz should answer a real user question. */
  label?: ReactNode;
  /** The question this section answers, in the user's voice. Replaces
   * `label` when provided. Short, active, something the reader would
   * actually ask: "Which tool edited more lines?", not "Tool breakdown". */
  question?: ReactNode;
  /** One-line plain-prose answer with the concrete finding leading the
   * sentence. Rendered between question and viz so readers can scan Q→A
   * for a 10-second read, or drop into the viz for depth. */
  answer?: ReactNode;
  /** The section body (usually a viz). Optional so a purely descriptive
   * `answer`/`label`-only section can render as a standalone intro line. */
  children?: ReactNode;
}

/**
 * One section inside a DetailView panel. The dominant structural primitive
 * in every detail view panel - "By tool", "Daily outcome mix", etc.
 *
 * Two framings:
 * - `question` + `answer` + viz: preferred for analytical sections. The
 *   editorial layer that keeps detail views from reading as a dump of
 *   visualizations.
 * - `label` + viz: fallback for purely descriptive sections (e.g. a
 *   note, a raw data table) where question framing would feel forced.
 */
export default function DetailSection({
  label,
  question,
  answer,
  children,
  className,
  ...rest
}: Props) {
  const title = question ?? label;
  return (
    <section className={clsx(styles.section, className)} {...rest}>
      {title && <span className={styles.label}>{title}</span>}
      {answer && <p className={styles.answer}>{answer}</p>}
      {children}
    </section>
  );
}

import type { ReactNode } from 'react';
import styles from './VizNote.module.css';

interface Props {
  children: ReactNode;
}

/**
 * A short interpretation caveat rendered *below* a question's viz, tagged so it
 * reads as an intentional annotation rather than trailing filler.
 *
 * This is deliberately NOT a second answer, and it is deliberately VISIBLE (not
 * an on-demand affordance like {@link AnswerNote}): it carries the one thing a
 * reader needs to keep the viz honest — "not a grade", "gaps are not zeros",
 * "volume, not value". A reader who never saw it could walk away with a FALSE
 * belief about the number, so it must stay on the surface; only its weight is
 * dialed down (a quiet "Note" tag beside a soft body) so it never competes with
 * the finding above the chart.
 *
 * Hard rule: one line, and only when the viz can be misread. Do not use it to
 * narrate a chart that is already clear, and never to pad thin data. If there is
 * no way to misread the viz, there is no note.
 */
export function VizNote({ children }: Props) {
  return (
    <div className={styles.note}>
      <span className={styles.tag}>Note</span>
      <span className={styles.body}>{children}</span>
    </div>
  );
}

export default VizNote;

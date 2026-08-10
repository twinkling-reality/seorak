import Tooltip from '../Tooltip/Tooltip.js';
import styles from './AnswerNote.module.css';

interface Props {
  /** The caveat, as plain text. Kept a string (not a node) on purpose: it is
   *  also the trigger's accessible name, so it must survive flattening. */
  children: string;
}

/**
 * An on-demand caveat, anchored to the end of a question's answer line.
 *
 * The sibling of {@link VizNote}, for a different job. VizNote carries a
 * caveat the reader needs BEFORE they can read the chart correctly -- what the
 * denominator is, that gaps are not zeros. Those stay visible. AnswerNote
 * carries a caveat the reader only needs if they go looking: an orthogonality
 * hint ("call share is not spend share"), which is really a pointer at a
 * SIBLING question rather than a guard against misreading this one.
 *
 * Rule of thumb: if a reader who never sees the note can walk away with a
 * false belief about the number, it is a VizNote. If they can only walk away
 * with an incomplete one, it is an AnswerNote.
 *
 * Accessibility: the pill is hover/focus-revealed and CSS-suppressed on touch,
 * so the caveat text is ALSO the trigger's aria-label. It is never hover-only
 * information.
 */
export function AnswerNote({ children }: Props) {
  // `label` + `wrap`, not `content`: a caveat is a definition-length string, and
  // only the label path picks up Tooltip's 240px readable measure. `content`
  // would floor the pill at its 168px min-width and stack it into a column.
  return (
    <Tooltip label={children} wrap delayMs={120}>
      <button type="button" className={styles.trigger} aria-label={children}>
        <span className={styles.glyph} aria-hidden="true">
          i
        </span>
      </button>
    </Tooltip>
  );
}

export default AnswerNote;

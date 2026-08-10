import { useEffect, useMemo, type ReactNode } from 'react';
import clsx from 'clsx';
import { useVerticalTabKeyboard } from '../../lib/useVerticalTabKeyboard.js';
import styles from './FocusedDetailView.module.css';

export interface FocusedQuestion {
  /** Stable identifier used in the URL (`?q=<id>`) and for keying. Must
   *  match `/^[a-z0-9-]+$/` so it stays URL-safe without encoding. */
  id: string;
  /** The question, in the user's voice. Short, active. Rendered both as
   *  the sidebar row heading and as the main-area title. */
  question: ReactNode;
  /** One-line plain-prose answer leading with the concrete finding.
   *  Rendered in the main area as the lead (24px). Not duplicated in
   *  the sidebar - the sidebar is a pure nav, the main area carries
   *  the finding. */
  answer: ReactNode;
  /** The viz that provides depth/support for the question. Gets the
   *  full remaining width of the main area when selected. */
  children: ReactNode;
}

interface Props {
  /** Active question by id. If unknown, falls back to the first entry. */
  activeId: string | null;
  /** Called on sidebar click. Parent should push URL state here so the
   *  selection is deep-linkable and survives back/forward navigation. */
  onSelect: (id: string) => void;
  /** Ordered list of questions. Empty array renders nothing, letting
   *  the caller show their own empty state. */
  questions: FocusedQuestion[];
}

/**
 * Focused detail layout: sidebar of selectable Q+A items on the left,
 * one viz at a time on the right. Replaces the old "dump N sections in
 * a column" shape.
 *
 * Why the sidebar exists:
 * - New users scan the Q+A column as a 10-second summary of the tab
 *   without clicking anything.
 * - Experienced users land directly on the question they're asking
 *   via deep link or keyboard nav.
 * - Vizzes get room to breathe - they own the full main column.
 *
 * Why the answer renders in BOTH sidebar and main area:
 * - Sidebar A is for scanning across questions.
 * - Main-area A is the lead above the viz so the reader doesn't have
 *   to glance back at the sidebar mid-chart. Same prose, two jobs.
 */
export default function FocusedDetailView({ activeId, onSelect, questions }: Props) {
  const active = useMemo(
    () => questions.find((q) => q.id === activeId) ?? questions[0] ?? null,
    [questions, activeId],
  );

  // If the URL pointed at an unknown/stale question id, correct it so
  // the address bar matches what's rendered. Keeps refresh/share sane
  // after a question is renamed or removed.
  useEffect(() => {
    if (!active) return;
    if (activeId && activeId !== active.id) onSelect(active.id);
  }, [active, activeId, onSelect]);

  if (!active) return null;

  return (
    <div className={styles.root}>
      <FocusedSidebar questions={questions} activeId={active.id} onSelect={onSelect} />

      <section className={styles.main} aria-live="polite">
        {/* Lead with the answer - the question is already highlighted in
         *  the sidebar, so repeating it here as a 24px h3 just steals
         *  attention from the finding. The answer IS the result. */}
        <p className={styles.mainAnswer}>{active.answer}</p>
        <div className={styles.viz}>{active.children}</div>
      </section>
    </div>
  );
}

/**
 * Sidebar extracted so the arrow-key hook can own its own element ref.
 * Keeping keyboard handling scoped to the nav - rather than the whole
 * FocusedDetailView root - prevents arrow keys from firing while the
 * user's focus is inside the viz (e.g., on a scatter dot or a table
 * cell).
 */
function FocusedSidebar({
  questions,
  activeId,
  onSelect,
}: {
  questions: FocusedQuestion[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const ids = useMemo(() => questions.map((q) => q.id), [questions]);
  const containerRef = useVerticalTabKeyboard(ids, activeId, onSelect);

  return (
    <nav
      className={styles.sidebar}
      aria-label="Questions"
      ref={containerRef as React.RefObject<HTMLElement>}
    >
      <ul className={styles.list}>
        {questions.map((q) => {
          const isActive = q.id === activeId;
          return (
            <li key={q.id} className={styles.listItem}>
              <button
                type="button"
                data-question={q.id}
                className={clsx(styles.item, isActive && styles.itemActive)}
                aria-current={isActive ? 'true' : undefined}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onSelect(q.id)}
              >
                <span className={styles.itemQuestion}>{q.question}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

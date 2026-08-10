/**
 * ChatAssistantMessage — assistant turn layout + enter motion.
 *
 * Body and citations share one reveal system (chatMotion.module.css) so
 * streaming or multi-part answers can extend the same primitives later.
 */

import clsx from 'clsx';
import type { ReactNode } from 'react';
import styles from './ChatAssistantMessage.module.css';
import motion from './chatMotion.module.css';

export function ChatAssistantMessage({
  body,
  citations,
}: {
  body: ReactNode;
  citations?: ReactNode;
}): ReactNode {
  return (
    <div className={styles.root}>
      <p className={clsx(styles.body, motion.textReveal)}>{body}</p>
      {citations ? (
        <div className={clsx(styles.citations, motion.textRevealDelayed)}>{citations}</div>
      ) : null}
    </div>
  );
}

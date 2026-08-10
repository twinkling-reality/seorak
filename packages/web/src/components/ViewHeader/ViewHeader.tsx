import type { ReactNode } from 'react';
import Eyebrow from '../Eyebrow/Eyebrow.js';
import styles from './ViewHeader.module.css';

interface Props {
  eyebrow?: string;
  title: ReactNode;
  /** Render a persistent "Demo data" pill beside the eyebrow (FOLLOW-UP #6). Set
   *  in demo mode so a screenshot of this view can never be mistaken for live —
   *  the floating DemoSwitcher pill alone can be cropped out of a screenshot. */
  demo?: boolean;
}

export default function ViewHeader({ eyebrow, title, demo = false }: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        {eyebrow &&
          (demo ? (
            <Eyebrow label={eyebrow} showPreview previewLabel="Demo data" />
          ) : (
            <span className={styles.eyebrow}>{eyebrow}</span>
          ))}
        <h1 className={styles.title}>{title}</h1>
      </div>
    </header>
  );
}

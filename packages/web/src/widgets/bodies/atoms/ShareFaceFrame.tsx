import type { ReactNode } from 'react';
import { StripFaceHead } from './StripFaceHead.js';
import { AnnotatedStrip, type AnnotatedStripProps } from './AnnotatedStrip.js';
import styles from './ShareFaceFrame.module.css';

/** StripFaceHead + AnnotatedStrip — no footer notes; derivation lives on hover. */
export function ShareFaceFrame({
  value,
  caption,
  headTitle,
  strip,
}: {
  value: ReactNode;
  caption: string;
  /** Trust-boundary / derivation hover on the head only. */
  headTitle?: string;
  strip: AnnotatedStripProps;
}) {
  return (
    <div className={styles.frame}>
      <StripFaceHead value={value} caption={caption} titleHint={headTitle} />
      <AnnotatedStrip {...strip} />
    </div>
  );
}

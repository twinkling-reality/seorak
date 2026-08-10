import type { CSSProperties } from 'react';
import styles from './DotMatrix.module.css';

interface Props {
  /** Sample size. Used to compute the fill ratio; also surfaced in the
   *  aria label so screen readers get the true count. */
  total: number;
  /** Items that hit the condition. `filled <= total`. */
  filled: number;
  /** Color for filled dots. Empty dots render as hollow rings. */
  color: string;
}

/**
 * Fixed 100-dot percentage matrix (10×10). Each dot = 1%. Scales to any
 * sample size without visual drift; the adjacent count label carries the
 * true N. Rounding preserves "any hit stays visible" and "anything under
 * 100% leaves one empty" so boundary cases don't misread as all-or-nothing.
 */
const COLS = 10;
const TOTAL_DOTS = 100;

export default function DotMatrix({ total, filled, color }: Props) {
  const rawPct = total > 0 ? (filled / total) * 100 : 0;
  let filledDots = Math.round(rawPct);
  if (filled > 0 && filledDots === 0) filledDots = 1;
  if (filled < total && filledDots === TOTAL_DOTS) filledDots = TOTAL_DOTS - 1;

  const ariaLabel = `${filled} of ${total} (${filledDots}%)`;
  return (
    <div
      className={styles.matrix}
      style={{ gridTemplateColumns: `repeat(${COLS}, 9px)` } as CSSProperties}
      aria-label={ariaLabel}
      role="img"
    >
      {Array.from({ length: TOTAL_DOTS }, (_, i) => {
        const isFilled = i < filledDots;
        return (
          <span
            key={i}
            className={styles.dot}
            style={{
              background: isFilled ? color : 'transparent',
              borderColor: isFilled ? 'transparent' : 'var(--soft)',
            }}
          />
        );
      })}
    </div>
  );
}

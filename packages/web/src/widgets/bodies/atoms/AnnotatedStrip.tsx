import clsx from 'clsx';
import { type CSSProperties, type ReactNode } from 'react';
import styles from './AnnotatedStrip.module.css';

export interface AnnotatedStripSegment {
  /** Stable identity for React keys + ARIA. */
  key: string;
  /** Raw magnitude. Drives segment width proportionally. */
  value: number;
  /** Background color. CSS var or hex — always a SOLID (a gradient renders
   *  the same entity as different colors per segment width). */
  color: string;
  /** Display name for the legend entry and the default hover title. */
  label: string;
}

export interface AnnotatedStripProps {
  segments: AnnotatedStripSegment[];
  /** ARIA label for the strip group. */
  ariaLabel?: string;
  /** Strip height in CSS pixels. Defaults to 16px. */
  stripHeight?: number;
  /** Optional className applied to the root wrapper. */
  className?: string;
  /**
   * Hover-tooltip text per segment. Defaults to `${label}: ${share}%`.
   * Pass a custom resolver when the title needs richer content.
   */
  titleFor?: (segment: AnnotatedStripSegment) => string;
  /**
   * Right-hand value for each legend entry. The legend (swatch + name +
   * value, below the strip) is the identity layer: the marks stay clean —
   * never text on a fill — every segment gets a named entry regardless of
   * how narrow it renders, and the value gives the quantitative context the
   * widths alone can't. Return null for an entry that carries no value
   * (e.g. a "+N more" tail whose label already is the fact).
   */
  legendValueFor: (segment: AnnotatedStripSegment) => ReactNode;
}

/**
 * Horizontal proportional strip + legend: the Share-face viz. Segments are
 * sized by `flexGrow: value` with 2px surface gaps between fills; identity
 * and quantity live in the legend row below (swatch + name + value), never
 * on the marks and never as a dangling callout. Hover titles carry the
 * full sentence per segment.
 *
 * Display-only by design: segments are inert spans. The former click-to-
 * spotlight path was removed — its only callers (tool-mix / model-mix) render
 * as wrapper-clickable tiles, so a segment click bubbled to the tile drill and
 * navigated away, making the spotlight unreachable (audit A4). A future
 * interactive strip should live in a non-wrapper context and stopPropagation.
 */
export function AnnotatedStrip({
  segments,
  ariaLabel,
  stripHeight = 16,
  className,
  titleFor,
  legendValueFor,
}: AnnotatedStripProps) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0 || segments.length === 0) return null;

  const title = (s: AnnotatedStripSegment): string =>
    titleFor ? titleFor(s) : `${s.label}: ${Math.round((s.value / total) * 100)}%`;

  return (
    <div
      className={clsx(styles.wrap, className)}
      style={{ '--strip-height': `${stripHeight}px` } as CSSProperties}
    >
      <div className={styles.strip} role={ariaLabel ? 'group' : undefined} aria-label={ariaLabel}>
        {segments.map((s, i) => {
          const segmentStyle: CSSProperties = {
            flexGrow: s.value,
            flexBasis: 0,
            minWidth: 2,
            background: s.color,
            '--cell-index': i,
          } as CSSProperties;
          return (
            <span
              key={s.key}
              className={styles.segment}
              style={segmentStyle}
              aria-label={title(s)}
              title={title(s)}
            />
          );
        })}
      </div>
      <div className={styles.legend}>
        {segments.map((s) => {
          const value = legendValueFor(s);
          return (
            <span key={s.key} className={styles.legendEntry} title={title(s)}>
              <span
                className={styles.legendSwatch}
                style={{ background: s.color }}
                aria-hidden="true"
              />
              <span className={styles.legendName}>{s.label}</span>
              {value != null && <span className={styles.legendValue}>{value}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

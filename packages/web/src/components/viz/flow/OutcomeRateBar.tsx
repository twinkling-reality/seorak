import type { CSSProperties, ReactNode } from 'react';
import styles from './OutcomeRateBar.module.css';

export interface RateBarLane {
  /** Stable identity for React keys + ARIA. */
  key: string;
  /** Legend name. Never printed on the fill (house rule: clean marks). */
  label: string;
  /** Raw magnitude in the bar's unit. Drives segment width proportionally. */
  value: number;
  /** Fill color. Defaults per role (see below); pass to override. Always a
   *  SOLID — a gradient renders one lane as different colors per width. */
  color?: string;
}

export interface OutcomeRateBarProps {
  /** Lanes that ENTER the rate — its denominator. Visual order = array order.
   *  The bracket beneath the bar spans exactly these. Conventionally the
   *  surviving/positive lane first (defaults to ink), the rest recessive. */
  rated: RateBarLane[];
  /** The unmeasured remainder: work we could not pass a verdict on. Drawn as a
   *  hatched lane OUTSIDE the bracket, never in an outcome color — "we couldn't
   *  see this" is not "this changed back". Omit or pass value 0 for no lane. */
  unmeasured?: RateBarLane;
  /** What the bracket spans, in the caller's voice (the panel owns prose). The
   *  rate itself lives in the answer sentence above; this NAMES the denominator
   *  the proportion is read over, e.g. "measured over 1,840 rated lines". */
  bracketLabel: ReactNode;
  /** Full-sentence text equivalent for screen readers. */
  ariaLabel: string;
  /** Legend value per lane (e.g. `count(v, 'line')`). Defaults to the number. */
  legendValueFor?: (lane: RateBarLane) => ReactNode;
  /** Bar height in px. Defaults to 22 (taller than a Share strip — this bar is
   *  the focal object of its question, not an inline summary). */
  barHeight?: number;
}

/**
 * OutcomeRateBar — the "rate with an unmeasured remainder" form.
 *
 * One horizontal mass bar on a common baseline. Its full width is a real
 * quantity (authored lines, checked commits, determinable sessions); the width
 * conserves what the data conserves, which is the property that makes it read
 * instantly (a Sankey's promise without a Sankey's ribbons). The rate's
 * denominator is drawn — a bracket under the RATED lanes — rather than asserted
 * in a parenthetical. The unmeasured remainder sits outside that bracket in a
 * hatched, colorless lane, so "we could not measure this" is never confused
 * with an outcome.
 *
 * Shared across the Outcomes questions that share this shape: `line-survival`
 * (unit: lines), `survived` (commits), `shipped` (sessions). A new one picks
 * this form; it does not invent a bar.
 *
 * Honesty: lanes are never green/red — persistence and shipping are not grades,
 * so a recessive lane means "changed back / didn't land", never "bad" (color is
 * never the sole status carrier; every lane is labeled in the legend). Lavender
 * is semantic elsewhere and appears on none of these. Gaps are not zeros: a
 * genuinely zero lane renders no segment, never a hairline standing in for data.
 */
export default function OutcomeRateBar({
  rated,
  unmeasured,
  bracketLabel,
  ariaLabel,
  legendValueFor,
  barHeight = 22,
}: OutcomeRateBarProps) {
  const ratedTotal = rated.reduce((s, l) => s + l.value, 0);
  const unmeasuredValue = unmeasured && unmeasured.value > 0 ? unmeasured.value : 0;
  const grandTotal = ratedTotal + unmeasuredValue;
  if (grandTotal <= 0) return null;

  // Default roles: first rated lane is the headline (ink), the rest recede
  // (soft). Callers can override per lane.
  const ratedColor = (lane: RateBarLane, i: number): string =>
    lane.color ?? (i === 0 ? 'var(--ink)' : 'var(--soft)');

  const legendValue = (lane: RateBarLane): ReactNode =>
    legendValueFor ? legendValueFor(lane) : lane.value.toLocaleString();

  const hasUnmeasured = unmeasuredValue > 0;

  return (
    <div
      className={styles.wrap}
      style={{ '--bar-height': `${barHeight}px` } as CSSProperties}
    >
      {/* The mass bar. Segments size by flexGrow; a 2px surface gap keeps
       *  same-adjacent fills from reading as one block. */}
      <div className={styles.bar} role="img" aria-label={ariaLabel}>
        {rated.map((lane, i) =>
          lane.value > 0 ? (
            <span
              key={lane.key}
              className={styles.segment}
              style={
                {
                  flexGrow: lane.value,
                  background: ratedColor(lane, i),
                  '--cell-index': i,
                } as CSSProperties
              }
            />
          ) : null,
        )}
        {hasUnmeasured && (
          <span
            key={unmeasured!.key}
            className={styles.unmeasured}
            style={{ flexGrow: unmeasuredValue, '--cell-index': rated.length } as CSSProperties}
          />
        )}
      </div>

      {/* Bracket: spans the rated lanes, naming the denominator the rate is
       *  read over. A spacer of exactly the unmeasured width keeps it aligned
       *  under the rated portion without measuring pixels. */}
      <div className={styles.bracketRow} aria-hidden="true">
        <div className={styles.bracketSpan} style={{ flexGrow: ratedTotal }}>
          <span className={styles.bracketLine} />
          <span className={styles.bracketLabel}>{bracketLabel}</span>
        </div>
        {hasUnmeasured && <div className={styles.bracketSpacer} style={{ flexGrow: unmeasuredValue }} />}
      </div>

      {/* Legend: identity + quantity, one entry per lane, wrapping as needed.
       *  Quantity never rides the fill. */}
      <div className={styles.legend}>
        {rated.map((lane, i) => (
          <span key={lane.key} className={styles.legendEntry}>
            <span
              className={styles.swatch}
              style={{ background: ratedColor(lane, i) }}
              aria-hidden="true"
            />
            <span className={styles.legendName}>{lane.label}</span>
            <span className={styles.legendValue}>{legendValue(lane)}</span>
          </span>
        ))}
        {hasUnmeasured && (
          <span className={styles.legendEntry}>
            <span className={`${styles.swatch} ${styles.swatchHatch}`} aria-hidden="true" />
            <span className={styles.legendName}>{unmeasured!.label}</span>
            <span className={styles.legendValue}>{legendValue(unmeasured!)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

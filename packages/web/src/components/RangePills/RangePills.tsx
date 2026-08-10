import { OVERVIEW_RANGE_DAYS } from '@seorak/types';
import clsx from 'clsx';
import styles from './RangePills.module.css';
import glass from '../surface/glass.module.css';

interface Props<T extends string | number> {
  value: T;
  onChange: (next: T) => void;
  options?: readonly T[];
  /** Suffix appended to numeric pill labels (default: 'd' for days) */
  suffix?: string;
  ariaLabel?: string;
  formatLabel?: (value: T) => string;
}

/** Callers that pass no `options` get the worker's supported windows, so the
 *  default pill row can never advertise a range `/overview` would refuse.
 *  Replay passes its own list because it also offers a 1-day window. */
const DEFAULT_OPTIONS = OVERVIEW_RANGE_DAYS;

function pillLabel<T extends string | number>(
  opt: T,
  suffix: string,
  formatLabel?: (value: T) => string,
): string {
  if (formatLabel) return formatLabel(opt);
  if (typeof opt === 'number') return `${opt}${suffix}`;
  return String(opt);
}

export default function RangePills<T extends string | number>({
  value,
  onChange,
  options = DEFAULT_OPTIONS as unknown as readonly T[],
  suffix = 'd',
  ariaLabel = 'Time range',
  formatLabel,
}: Props<T>) {
  return (
    <div
      className={clsx(styles.rangeSelector, glass.sheet, glass.rim)}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          className={clsx(styles.rangeButton, value === opt && styles.rangeActive)}
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
        >
          {pillLabel(opt, suffix, formatLabel)}
        </button>
      ))}
    </div>
  );
}

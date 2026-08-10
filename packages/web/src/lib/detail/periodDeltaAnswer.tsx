import type { PeriodDelta } from '../../lib/apiSchemas.js';
import { metric, priorWindowPhrase, windowPhrase } from '../voice/index.js';
import { hasPriorPeriodDelta, periodChangePct } from './periodDelta.js';

interface Props {
  delta: PeriodDelta;
  /** The measure, as a subject noun: "sessions", "added lines", "spend". */
  unit: string;
  rangeDays: number;
  /** Format each leg for display (defaults to locale string). */
  formatCurrent?: (n: number) => string;
}

/**
 * One-line prior-window comparison for FocusedDetailView answers. Warm and
 * second person, but strictly neutral: it reports the direction of the move
 * (up / down / about level), never grades it. Spells both windows rather than
 * the house-jargon deictic.
 */
export function PeriodDeltaAnswer({
  delta,
  unit,
  rangeDays,
  formatCurrent = (n) => n.toLocaleString(),
}: Props) {
  if (!hasPriorPeriodDelta(delta)) return null;
  const pct = periodChangePct(delta.current, delta.previous!);
  const magnitude = Math.abs(pct);
  const prior = (
    <>
      {metric(formatCurrent(delta.previous!))} {priorWindowPhrase(rangeDays)}
    </>
  );
  const changePhrase =
    pct === 0 ? (
      <>about level with {prior}</>
    ) : (
      <>
        {pct > 0 ? 'up' : 'down'} {metric(`${magnitude}%`)} from {prior}
      </>
    );
  return (
    <>
      Your {unit} moved to {metric(formatCurrent(delta.current))} over {windowPhrase(rangeDays)},{' '}
      {changePhrase}.
    </>
  );
}

/**
 * Voice primitives — ReactNode composers. Every number in an answer wears the
 * <Metric> mark (house style); these keep that mark, the pluralization, and the
 * honest "--" in one place so answers compose them instead of hand-building the
 * span + noun + null-guard each time.
 */
import { Fragment, type ReactNode } from 'react';

import { Metric, type MetricTone } from '../../components/DetailView/index.js';
import { fmtCount, formatCost } from '../../widgets/utils.js';
import { plural } from './text.js';

/** A number in prose, marked. Reach for this instead of a bare <Metric> so a
 *  tone is one argument, not a wrapper. */
export function metric(children: ReactNode, tone?: MetricTone): ReactNode {
  return <Metric tone={tone}>{children}</Metric>;
}

interface CountOpts {
  tone?: MetricTone;
  /** Irregular plural when "+s" is wrong. */
  many?: string;
}

/** "<Metric>3</Metric> sessions" — a marked count with an agreeing noun.
 *  Pluralization is structural here, so "across 1 sessions" cannot be written
 *  by hand in an answer. */
export function countMetric(n: number, one: string, opts: CountOpts = {}): ReactNode {
  return (
    <>
      <Metric tone={opts.tone}>{fmtCount(n)}</Metric> {plural(n, one, opts.many)}
    </>
  );
}

interface CostOpts {
  tone?: MetricTone;
  decimals?: number;
}

/** "<Metric>$0.84</Metric>" — a marked USD value; honest "--" for null (never a
 *  fabricated $0.00). */
export function cost(usd: number | null | undefined, opts: CostOpts = {}): ReactNode {
  return <Metric tone={opts.tone}>{formatCost(usd, opts.decimals ?? 2)}</Metric>;
}

/** Join prose nodes as a spoken list: "a", "a and b", "a, b, and c". Replaces
 *  the two hand-copied `joinNatural` helpers. */
export function naturalListNodes(items: ReactNode[]): ReactNode {
  return items.map((item, i) => {
    const sep =
      i === 0 ? '' : i === items.length - 1 ? (items.length === 2 ? ' and ' : ', and ') : ', ';
    return (
      <Fragment key={i}>
        {sep}
        {item}
      </Fragment>
    );
  });
}

interface AverageOpts {
  /** The sample size the average is taken over. */
  n: number;
  /** The already-marked per-unit value, e.g. cost(perSession). */
  per: ReactNode;
  /** The denominator noun; "session" by default. */
  unit?: string;
}

/**
 * The data-aware per-unit clause: "about <Metric>$1.86</Metric> per session".
 * Returns null at n <= 1 so a single-sample "average" never appears — the caller
 * drops the clause (and typically says "all in a single session" instead). This
 * is what structurally kills the n=1 "$0.84 each on average" bug class.
 */
export function averageClause({ n, per, unit = 'session' }: AverageOpts): ReactNode | null {
  if (n <= 1) return null;
  return (
    <>
      about {per} per {unit}
    </>
  );
}

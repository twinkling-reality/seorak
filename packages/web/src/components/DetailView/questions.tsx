import type { ReactNode } from 'react';

import type { FocusedQuestion } from './FocusedDetailView.js';
import { AnswerNote } from './AnswerNote.js';
import { VizNote } from './VizNote.js';
import {
  HeroStatRow,
  type HeroStatDef,
  DotMatrix,
  DeltaStat,
  BreakdownList,
  type BreakdownItem,
  Treemap,
  type TreemapItem,
  BenchmarkBars,
  type BenchmarkBarItem,
  ChurnBar,
  StackedArea,
  type StackedAreaEntry,
  HourHeatmap,
  type HourCell,
  type HourHeatmapPeak,
} from '../viz/index.js';
import { TrendSparkline, type TrendPoint } from '../../widgets/bodies/atoms/TrendSparkline.js';
import { DayBars } from '../../widgets/bodies/atoms/DayBars.js';
import { AnnotatedRing, type AnnotatedRingArc } from '../../widgets/bodies/atoms/AnnotatedRing.js';
import styles from './questions.module.css';

/**
 * Typed question templates — the depth layer for FocusedDetailView.
 *
 * Each builder takes the caller-authored `answer` (the finding, in the
 * user's voice) plus the data for exactly ONE viz, and returns a
 * {@link FocusedQuestion}. The template owns the viz choice and the two
 * caveat slots; the caller owns the prose.
 *
 * This is where the question -> viz contract lives. A given question SHAPE
 * maps to one viz vocabulary and nothing else:
 *
 *   VOLUME       -> volumeQuestion       -> HeroStatRow
 *   RATE         -> rateQuestion         -> DotMatrix
 *   DELTA        -> deltaQuestion        -> DeltaStat
 *   DISTRIBUTION -> distributionQuestion -> BreakdownList (open ranking)
 *                -> treemapQuestion      -> Treemap (long-tailed ranking, whole set)
 *                -> benchmarkBarsQuestion -> BenchmarkBars (ranking vs a reference line)
 *                -> churnQuestion         -> ChurnBar (two opposing flows + net)
 *                -> compositionQuestion  -> AnnotatedRing (closed set, part-to-whole)
 *   TIMELINE     -> trendQuestion        -> TrendSparkline (continuous single series)
 *                -> dayBarsQuestion      -> DayBars (discrete per-day counts)
 *                -> stackedTimelineQuestion -> StackedArea (categorical/time)
 *   RHYTHM       -> rhythmQuestion       -> HourHeatmap
 *   LIST / other -> listQuestion         -> caller-supplied children
 *
 * Guardrail: a viz must add a dimension the answer sentence cannot carry. If
 * the only viz would restate the number in the sentence, do not add one —
 * fold it into a sibling question. `listQuestion` is the escape hatch for a
 * genuinely compound viz (e.g. a rate headline plus a fate distribution), NOT
 * a way to dodge the mapping.
 */

/** Compose a viz with an optional interpretation caveat below it. */
function withNote(viz: ReactNode, note?: ReactNode): ReactNode {
  if (note == null) return viz;
  return (
    <>
      {viz}
      <VizNote>{note}</VizNote>
    </>
  );
}

/** Compose an answer with an optional on-demand caveat trailing the sentence. */
function withCaveat(answer: ReactNode, caveat?: string): ReactNode {
  if (caveat == null) return answer;
  return (
    <>
      {answer} <AnswerNote>{caveat}</AnswerNote>
    </>
  );
}

interface BaseConfig {
  /** URL-safe id (`?q=<id>`), must match /^[a-z0-9-]+$/. */
  id: string;
  /** The question in the user's voice. */
  question: ReactNode;
  /** One-line finding-first answer (usually built with <Metric>). */
  answer: ReactNode;
  /** Optional one-line caveat rendered below the viz. Only when the viz
   *  can be misread; never to pad thin data. */
  note?: ReactNode;
  /** Optional one-line caveat behind an info affordance on the answer line.
   *
   *  Use when the caveat is a POINTER, not a guard: the reader who misses it
   *  is merely incomplete, not wrong (e.g. "call share is not spend share",
   *  which really points at the sibling spend question). A caveat without
   *  which the viz is actively misread -- the denominator, gaps-vs-zeros --
   *  is a `note`, and stays visible. See AnswerNote.tsx. */
  caveat?: string;
}

/** VOLUME — a scalar or a small set of related scalars (counts, sums, or
 *  a derived per-unit average). 2-3 stats; never a single stat that just
 *  repeats the answer number. */
export function volumeQuestion(config: BaseConfig & { stats: HeroStatDef[] }): FocusedQuestion {
  const { id, question, answer, note, caveat, stats } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(<HeroStatRow stats={stats} direction="column" />, note),
  };
}

/** RATE — a single 0..1 proportion. The dot matrix gives the percentage a
 *  visual proportion the sentence cannot. Pass real `count` for an honest N
 *  in the aria label; otherwise the rate fills 100 dots.
 *
 *  Color defaults to neutral ink: persistence/share is not a grade. Only
 *  pass `color` when the metric is genuinely good/bad-directional (e.g. a
 *  stalled rate crossing a nudge threshold). */
export function rateQuestion(
  config: BaseConfig & {
    rate: number;
    count?: { filled: number; total: number };
    color?: string;
  },
): FocusedQuestion {
  const { id, question, answer, note, caveat, rate, count, color } = config;
  const filled = count ? count.filled : Math.round(rate * 100);
  const total = count ? count.total : 100;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(
      <DotMatrix total={total} filled={filled} color={color ?? 'var(--ink)'} />,
      note,
    ),
  };
}

/** DELTA — this window versus the prior window. Caller must gate on a real
 *  prior leg before calling. Direction is reported, never graded. */
export function deltaQuestion(
  config: BaseConfig & {
    current: number;
    previous: number;
    format?: (n: number) => string;
  },
): FocusedQuestion {
  const { id, question, answer, note, caveat, current, previous, format } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(
      <DeltaStat current={current} previous={previous} format={format} />,
      note,
    ),
  };
}

/** DISTRIBUTION — proportional shares across a category. Caller pre-sorts.
 *  When the caller caps a long ranking, pass `residue` (e.g. "9 more hours…")
 *  so the tail is named, not silently dropped — a capped list with no residue
 *  reads as "this is everything". Renders as a subordinate footnote below the
 *  bars, outside the list so it never reads as another data row. */
export function distributionQuestion(
  config: BaseConfig & { items: BreakdownItem[]; residue?: ReactNode },
): FocusedQuestion {
  const { id, question, answer, note, caveat, items, residue } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(
      <>
        <BreakdownList items={items} />
        {residue != null && <p className={styles.residue}>{residue}</p>}
      </>,
      note,
    ),
  };
}

/** DISTRIBUTION (long-tailed ranking) — an open ranking with a tail too long
 *  for a bar list. The treemap encodes magnitude as AREA, so the WHOLE set fits
 *  in fixed space: no top-K cap, no "+N more" residue, the tail's weight is
 *  visible rather than footnoted. Prefer this over `distributionQuestion` when
 *  the set routinely runs past ~a dozen rows (files, directories); keep the bar
 *  list when the ranking is short and reading each exact value matters. Caller
 *  pre-sorts; a non-positive value gets no tile (honest-empty). */
export function treemapQuestion(
  config: BaseConfig & { items: TreemapItem[]; ariaLabel?: string },
): FocusedQuestion {
  const { id, question, answer, note, caveat, items, ariaLabel } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(<Treemap items={items} ariaLabel={ariaLabel} />, note),
  };
}

/** DISTRIBUTION (closed composition) — a small, closed set of categories
 *  that sum to a meaningful whole (e.g. the lifecycle reasons every ended
 *  session falls into). The ring's center total + arc shares read as
 *  part-to-whole, which a ranked bar list cannot. Prefer this over
 *  `distributionQuestion` only when the set is closed and the whole is the
 *  point; keep bars for open rankings (top files, tools, models). */
export function compositionQuestion(
  config: BaseConfig & {
    arcs: AnnotatedRingArc[];
    centerValue?: ReactNode;
    centerEyebrow?: ReactNode;
    ariaLabel?: string;
  },
): FocusedQuestion {
  const { id, question, answer, note, caveat, arcs, centerValue, centerEyebrow, ariaLabel } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(
      <div className={styles.ringFrame}>
        <AnnotatedRing
          arcs={arcs}
          centerValue={centerValue}
          centerEyebrow={centerEyebrow}
          ariaLabel={ariaLabel}
          className={styles.ring}
        />
      </div>,
      note,
    ),
  };
}

/** TIMELINE (single series) — one value per day. Honest-empty by
 *  construction: null points are gaps, not zeros. */
export function trendQuestion(
  config: BaseConfig & {
    points: TrendPoint[];
    ariaLabel: string;
    formatValue?: (n: number) => string;
    color?: string;
  },
): FocusedQuestion {
  const { id, question, answer, note, caveat, points, ariaLabel, formatValue, color } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(
      <TrendSparkline
        points={points}
        ariaLabel={ariaLabel}
        formatValue={formatValue}
        color={color}
      />,
      note,
    ),
  };
}

/** TIMELINE (discrete) — one COUNT per day, drawn as bars on a common
 *  baseline. Use over `trendQuestion` when the series is a tally of discrete
 *  events (sessions, edits) rather than a continuous signal, so no slope
 *  between days is implied. Honest-empty by construction: null days are gaps. */
export function dayBarsQuestion(
  config: BaseConfig & {
    points: TrendPoint[];
    ariaLabel: string;
    formatValue?: (n: number) => string;
    color?: string;
  },
): FocusedQuestion {
  const { id, question, answer, note, caveat, points, ariaLabel, formatValue, color } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(
      <DayBars points={points} ariaLabel={ariaLabel} formatValue={formatValue} color={color} />,
      note,
    ),
  };
}

/** DISTRIBUTION (against a benchmark) — a ranking whose bars are read against
 *  one shared reference line (e.g. per-repo values vs the global average). Use
 *  over `distributionQuestion` when the finding is "who beats the benchmark, and
 *  by how far", not a bare ranking. The reference must be a real measured value. */
export function benchmarkBarsQuestion(
  config: BaseConfig & {
    items: BenchmarkBarItem[];
    reference: { value: number; label: string };
    ariaLabel: string;
  },
): FocusedQuestion {
  const { id, question, answer, note, caveat, items, reference, ariaLabel } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(
      <BenchmarkBars items={items} reference={reference} ariaLabel={ariaLabel} />,
      note,
    ),
  };
}

/** DISTRIBUTION (two opposing flows) — a pair of magnitudes whose DIFFERENCE is
 *  the finding (lines added vs removed, and the net they leave). Use over
 *  `benchmarkBarsQuestion` when there is no ranking and no reference, just two
 *  flows and their balance. Both bars share one baseline and scale; the net is
 *  drawn as the residual. Neither flow is graded (no red/green). */
export function churnQuestion(
  config: BaseConfig & {
    added: number;
    removed: number;
    formatValue?: (n: number) => string;
    ariaLabel?: string;
  },
): FocusedQuestion {
  const { id, question, answer, note, caveat, added, removed, formatValue, ariaLabel } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(
      <ChurnBar added={added} removed={removed} format={formatValue} ariaLabel={ariaLabel} />,
      note,
    ),
  };
}

/** TIMELINE (categorical over time) — one band per category, stacked by day
 *  or hour. */
export function stackedTimelineQuestion(
  config: BaseConfig & {
    entries: StackedAreaEntry[];
    unitLabel: string;
    ariaLabel: string;
    formatValue?: (n: number) => string;
  },
): FocusedQuestion {
  const { id, question, answer, note, caveat, entries, unitLabel, ariaLabel, formatValue } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(
      <StackedArea
        entries={entries}
        unitLabel={unitLabel}
        ariaLabel={ariaLabel}
        formatValue={formatValue}
      />,
      note,
    ),
  };
}

/** RHYTHM — a day-of-week x hour heatmap. Pass `peak` so the busiest cell the
 *  answer names is ringed in the grid — the viz should prove the finding, not
 *  leave the reader hunting for the cell the sentence points at. */
export function rhythmQuestion(
  config: BaseConfig & { cells: HourCell[]; cellSize?: number; peak?: HourHeatmapPeak | null },
): FocusedQuestion {
  const { id, question, answer, note, caveat, cells, cellSize, peak } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(
      <HourHeatmap data={cells} cellSize={cellSize ?? 16} peak={peak ?? null} />,
      note,
    ),
  };
}

/** LIST / escape hatch — caller supplies the children (a DetailTable, an
 *  event/Banner list, a compound rate+distribution, a threshold grid). Still
 *  gets the note slot so caveats stay consistent. Reach for a typed builder
 *  first; use this only when no single shape fits. */
export function listQuestion(config: BaseConfig & { children: ReactNode }): FocusedQuestion {
  const { id, question, answer, note, caveat, children } = config;
  return {
    id,
    question,
    answer: withCaveat(answer, caveat),
    children: withNote(children, note),
  };
}

import { COST_ESTIMATE_NOTE } from '@seorak/types';

import {
  FocusedDetailView,
  deltaQuestion,
  rateQuestion,
  trendQuestion,
  volumeQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { type HeroStatDef } from '../../../../components/viz/index.js';
import {
  PeriodDeltaAnswer,
  hasPriorPeriodDelta,
  modelSpendQuestion,
} from '../../../../lib/detail/index.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';
import {
  averageClause,
  cost as costNode,
  count,
  countMetric,
  fmtCount,
  formatCost,
  formatDay,
  metric,
  windowPhrase,
} from '../../../../lib/voice/index.js';

import styles from '../UsageDetailView.module.css';

/**
 * CostPanel — bound to `usage.cost` (+ `usage.dailyTrends`, `tools.byModel` for
 * the drill cuts), summed from the sessions currently held in KV. Honors the
 * single honesty gate on cost: `sessionsWithCost === 0` means "--", never
 * `$0.00`. The drill breaks the same total down two ways that reconcile to it:
 * by day (a day with no measured cost is a gap, never a zero) and by model
 * (mirrors the by-model unpriced honesty: when any model is unpriced the
 * breakdown shows token share and says so). There is no by-repo cut, since
 * `usage.projects[].costUsd` is a lossy attribution that does not sum to the
 * total. It does not render the period-over-period delta pill, though
 * `usage.cost.delta` is available in the snapshot.
 */
export function CostPanel({ overview }: { overview: OverviewSnapshot }) {
  const activeId = useQueryParam('q');
  const { cost, totals } = overview.usage;

  // Per-question honesty gates, NOT a single panel-level gate. Cost questions
  // (spend / spend-vs-prior / cost-per-edit / cost-by-day) gate on measured cost;
  // context-reuse gates on cacheReuseRatio and cost-by-model on byModel — both are
  // independent of priced cost (a session can report tokens, hence cache reuse and
  // token-share model spend, while no model is priced so sessionsWithCost is 0).
  // The old whole-panel `sessionsWithCost === 0` early-return meant the cache-reuse
  // tile drilled into a blank panel in exactly that case (audit A3). Panel-empty
  // now fires only when NO question survives its own gate.
  const hasCost = cost.sessionsWithCost > 0 && cost.totalUsd != null;
  const perSession =
    hasCost && totals.sessions > 0 ? cost.totalUsd! / totals.sessions : null;

  // Same total, broken down two ways that actually reconcile to it: by day (the
  // window cost series) and by model (mirrors the model breakdown, which sums to
  // this total). Each cut keeps its own honest-empty gate: a day with no measured
  // cost is a null point (a gap, not $0), and unpriced models fall back to token
  // share rather than a fabricated $0. There is deliberately no by-repo cut here:
  // usage.projects[].costUsd is a lossy attribution (no-repo and unpriced spend
  // drop out) that does not sum to this total, so it would not break the number
  // down. Repo scope lives on the Projects tab.
  const trends = overview.usage.dailyTrends;
  const costPoints = trends.map((d) => ({ day: d.day, value: d.costUsd }));
  const observedCostDays = costPoints.filter((p) => p.value != null).length;

  const questions: FocusedQuestion[] = [];

  const costPerEdit = overview.usage.costPerEdit;

  if (hasCost) {
    // Spend, its per-session and per-edit normalizations, and where it landed by
    // day — one question. The daily trend IS the spend's shape, so it is the viz;
    // the two normalizations ride the sentence rather than a flat stat stack.
    // (cost-per-edit and cost-by-day used to be separate near-duplicate questions.)
    const peak =
      observedCostDays >= 2
        ? trends.reduce(
            (best, d) => ((d.costUsd ?? -1) > (best.costUsd ?? -1) ? d : best),
            trends[0],
          )
        : null;

    const spendAnswer = (
      <>
        You spent {costNode(cost.totalUsd)}
        {(() => {
          const avg = averageClause({
            n: cost.sessionsWithCost,
            per: costNode(perSession),
          });
          return avg != null ? (
            <>
              {' '}
              over {windowPhrase(overview.rangeDays)}, {avg} across{' '}
              {countMetric(cost.sessionsWithCost, 'session')}
            </>
          ) : (
            <>, all in a single session</>
          );
        })()}
        {costPerEdit != null ? <>, and {costNode(costPerEdit)} per edit call</> : null}.
        {peak != null ? (
          <>
            {' '}
            Your priciest day was{' '}
            {metric(peak.costUsd != null ? formatCost(peak.costUsd, 2) : '--')} on{' '}
            {formatDay(peak.day)}.
          </>
        ) : null}
      </>
    );

    // The total is a known undercount when the worker dropped a priceable session
    // for want of a rate (`cost.costPartial`) or when a byModel row carries tokens
    // but no price — the widget face no longer carries a "partial" marker, so the
    // floor disclosure lives here, in the primary spend note. The explicit "Only X
    // of Y sessions" fallback below supersedes this generic clause when it fires.
    const isFloor =
      cost.costPartial === true ||
      overview.tools.byModel.some((m) => m.tokensTotal > 0 && m.costUsd == null);
    const floorClause = isFloor
      ? ' The total is a floor — some spend is unpriced or uncaptured.'
      : '';

    // A `note`, not a `caveat`: a reader who misses this is WRONG (they think they
    // are looking at a bill). We derive tokens x list price; nothing in the capture
    // path tells a subscription seat from an API key. See pricing.ts. The trend
    // adds the gaps-not-zeros guard (null days are breaks, never $0).
    const spendNote =
      peak != null ? (
        <>
          {COST_ESTIMATE_NOTE} Days with no measured cost are gaps, not zeros.{floorClause}
        </>
      ) : (
        <>
          {COST_ESTIMATE_NOTE}
          {floorClause}
        </>
      );

    if (peak != null) {
      questions.push(
        trendQuestion({
          id: 'spend',
          question: 'What did you spend?',
          answer: spendAnswer,
          points: costPoints,
          ariaLabel: `Daily spend across ${observedCostDays} days with cost`,
          formatValue: (n) => formatCost(n, 2),
          note: spendNote,
        }),
      );
    } else {
      // Too few costed days to trace a trend: fall back to the scalar hero. Each
      // stat carries just its value + label — no second caption line (a "window
      // average" under "per session" only restates it, and the cost-coverage
      // caveat is a floor on the WHOLE hero, so it rides the group note below,
      // not a per-stat subtitle).
      const heroStats: HeroStatDef[] = [
        { key: 'total', value: formatCost(cost.totalUsd!, 2), label: 'total spend' },
      ];
      if (perSession != null) {
        heroStats.push({
          key: 'per-session',
          value: formatCost(perSession, 2),
          label: 'per session',
        });
      }
      if (costPerEdit != null) {
        heroStats.push({
          key: 'per-edit',
          value: formatCost(costPerEdit, 2),
          label: 'per edit call',
        });
      }
      // Partial coverage makes the total a floor, not a full bill — say so once,
      // in the note, rather than tucking it under one stat.
      const fallbackNote =
        cost.sessionsWithCost < totals.sessions ? (
          <>
            {COST_ESTIMATE_NOTE} Only {fmtCount(cost.sessionsWithCost)} of{' '}
            {count(totals.sessions, 'session')} reported cost, so the total is a floor.
          </>
        ) : (
          spendNote
        );
      questions.push(
        volumeQuestion({
          id: 'spend',
          question: 'What did you spend?',
          answer: spendAnswer,
          stats: heroStats,
          note: fallbackNote,
        }),
      );
    }

    const costDelta = cost.delta;
    if (hasPriorPeriodDelta(costDelta)) {
      questions.push(
        deltaQuestion({
          id: 'spend-vs-prior',
          question: 'Did your spend shift?',
          answer: (
            <PeriodDeltaAnswer
              delta={costDelta!}
              unit="spend"
              rangeDays={overview.rangeDays}
              formatCurrent={(n) => formatCost(n, 2)}
            />
          ),
          current: costDelta!.current,
          previous: costDelta!.previous!,
          format: (n) => formatCost(n, 2),
        }),
      );
    }
  }

  const cacheRatio = overview.usage.cacheReuseRatio;
  if (cacheRatio != null) {
    const pct = Math.round(cacheRatio * 100);
    questions.push(
      rateQuestion({
        id: 'context-reuse',
        question: 'How much context was reused?',
        answer: (
          <>
            {metric(`${pct}%`)} of your input context came from cache over{' '}
            {windowPhrase(overview.rangeDays)}.
          </>
        ),
        rate: cacheRatio,
        // An interpretive hint about what the rate implies for spend, not a
        // guard against misreading the dots. On demand, like the model-calls
        // caveat.
        caveat: 'Lower reuse can mean higher token cost.',
      }),
    );
  }

  const modelQ = modelSpendQuestion(overview.tools.byModel, 'cost-by-model');
  if (modelQ) questions.push(modelQ);

  return (
    <FocusedDetailView
      questions={questions}
      activeId={activeId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

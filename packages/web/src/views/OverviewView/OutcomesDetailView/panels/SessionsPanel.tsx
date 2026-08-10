import { useMemo } from 'react';

import {
  FocusedDetailView,
  Metric,
  compositionQuestion,
  rateQuestion,
  stackedTimelineQuestion,
  listQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { OutcomeRateBar, type RateBarLane } from '../../../../components/viz/index.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';
import {
  endReasonStackEntries,
  totalEnded,
} from '../../../../widgets/bodies/atoms/endReasonStack.js';
import {
  count,
  countMetric,
  fmtCount,
  fmtPct,
  naturalListNodes,
} from '../../../../lib/voice/index.js';

import { endReasonLabel, endReasonColor } from '../format.js';
import styles from '../OutcomesDetailView.module.css';
import { SessionOutcomesList } from './SessionOutcomesList.js';

/**
 * OutcomesDetailView → SessionsPanel — what became of the sessions that ended.
 * The tab face is `endedCount`; every question here is a lens on that same
 * population, ordered as a narrative rather than a grab-bag:
 *
 *   how-ended     - the face partition. `outcomes.endReasons[]` (the six coarse
 *                   SessionEnd lifecycle reasons) sum back to endedCount. Empty
 *                   until the reducer persists `reason` (never a fake ring).
 *   shipped       - did the ended work land a commit? `outcomes.shipRate`.
 *   line-survival - did it last? line-level survival over a matured subset
 *                   (the revert-catching durability read).
 *   one-shot      - cadence: how often sessions skipped retry loops.
 *   ended-by-day  - the same reasons over time (retained event log, so its total
 *                   is NOT endedCount; leads with the dominant band, never a
 *                   competing window count).
 *   stuck         - shown ONLY when the stalled rate crosses its nudge threshold
 *                   (the one sanctioned live signal on a period surface).
 *   recent        - the per-session pending -> fate list.
 *
 * Each question is gated on real data and drops out honest-empty when its field
 * is absent. Seorak cannot measure completion, so nothing here is a completion
 * grade; low rates read as "more changed back", never "bad work".
 */
export function SessionsPanel({ overview }: { overview: OverviewSnapshot }) {
  const activeId = useQueryParam('q');
  const { endReasons, endedCount, stuckness, shipRate, lineSurvival, oneShotRate, bySession } =
    overview.outcomes;

  const reasons = useMemo(
    () => [...endReasons].filter((r) => r.count > 0).sort((a, b) => b.count - a.count),
    [endReasons],
  );
  const reasonsTotal = reasons.reduce((s, r) => s + r.count, 0);

  const questions: FocusedQuestion[] = [];

  if (reasons.length > 0 && reasonsTotal > 0) {
    const top = reasons[0];
    // Closed set: every ended session falls into one lifecycle reason, so the
    // reasons sum to a whole. A ring reads that part-to-whole (center total +
    // arc shares) better than a ranked bar list. Rankings (top files, tools,
    // models) stay on distributionQuestion / BreakdownList.
    questions.push(
      compositionQuestion({
        id: 'how-ended',
        question: 'How did sessions end?',
        answer: (
          <>
            <Metric tone="neutral">{endReasonLabel(top.reason)}</Metric>{' '}
            accounts for{' '}
            <Metric>{fmtPct(top.count / reasonsTotal, 0)}</Metric> of{' '}
            {countMetric(endedCount, 'ended session')}.
          </>
        ),
        arcs: reasons.map((r) => ({
          key: r.reason,
          value: r.count,
          color: endReasonColor(r.reason),
          label: endReasonLabel(r.reason),
        })),
        centerValue: fmtCount(reasonsTotal),
        centerEyebrow: 'ended',
        ariaLabel: 'How ended sessions broke down by lifecycle reason',
      }),
    );
  }

  // Ship rate — git ground-truth "did the work land?". null until a session.delta
  // determines shipping; never a fabricated 0%.
  if (shipRate != null) {
    const shipPct = Math.round(shipRate * 100);
    questions.push(
      rateQuestion({
        id: 'shipped',
        question: 'Did the work land?',
        answer: (
          <>
            <Metric tone="neutral">{shipPct}%</Metric> of the sessions that ended landed a commit.
          </>
        ),
        rate: shipRate,
        note: 'Git ground-truth, not a judgment.',
      }),
    );
  }

  // Line survival — the honest, revert-catching "did the work LAST?" read.
  // Line-level (surviving ÷ authored) over the RATED (retained+overwritten) fates,
  // floored at >=3 commits; null below the floor / until checks accrue (never a
  // fabricated 0%). Anti-grade: a low rate is "more changed back", NEVER "bad work".
  //
  // The viz is the SAMPLE, not the rate (the sentence already carries the rate).
  // A mass bar in ONE unit (lines) shows what the sentence cannot: the mass the
  // rate is read over (84% of 1,840 lines is a claim; 84% of 12 is noise, which is
  // why the >=3-commit floor exists) and the coverage (how many checked sessions
  // could be rated at all). The former session-fate BreakdownList was DELETED: it
  // counted a different unit (sessions) beneath a line rate, and its "still in
  // code" label fires whenever ONE authored line survived (git.ts derives
  // `retained` from `linesSurviving > 0`), which overclaims under a persistence
  // headline. Its honest content survives as the coverage note below.
  if (lineSurvival.rate != null) {
    const lsPct = Math.round(lineSurvival.rate * 100);
    const surviving = lineSurvival.linesSurviving;
    const changedBack = Math.max(0, lineSurvival.linesAuthored - lineSurvival.linesSurviving);
    const ratedLanes: RateBarLane[] = [
      { key: 'surviving', label: 'still on your branch', value: surviving, color: 'var(--ink)' },
      { key: 'changed-back', label: 'changed back', value: changedBack, color: 'var(--soft)' },
    ];
    // Coverage in SESSIONS (a different unit than the bar): how much of the checked
    // work could be rated. The unrated LINE lane (unreachable + unknown authored
    // lines) is not yet on the rollup, so today coverage is a note; when the field
    // lands it becomes the bar's hatched `unmeasured` lane (DETAIL-VIZ ADR-4).
    const sessionsUnrated = lineSurvival.unreachable + lineSurvival.unknown;
    const sessionsChecked = lineSurvival.sessionsRated + sessionsUnrated;
    // One line, one job (the VizNote rule): the coverage basis + the single
    // guard that keeps the bar honest — a revert reads as changed back, so a
    // low rate is persistence, not bad work. The mechanism (blame-based) and
    // the why-excluded detail are implementation, not caveat; they're dropped.
    const coverageNote =
      sessionsUnrated > 0 ? (
        <>
          Measured over <Metric>{lineSurvival.sessionsRated}</Metric> of{' '}
          {countMetric(sessionsChecked, 'checked session')}; a revert reads as changed back, which is
          persistence, not a grade.
        </>
      ) : (
        <>
          Measured over all {countMetric(sessionsChecked, 'checked session')}; a revert reads as
          changed back, which is persistence, not a grade.
        </>
      );
    questions.push(
      listQuestion({
        id: 'line-survival',
        question: 'Did the work last?',
        answer: (
          <>
            <Metric tone="neutral">{lsPct}%</Metric> of the lines you authored are still on your
            branch.
          </>
        ),
        // Persistence, not quality: neutral ink, never danger; lanes are never
        // outcome-colored (green/red would grade the work).
        children: (
          <OutcomeRateBar
            rated={ratedLanes}
            bracketLabel={`the rate is read over these ${count(lineSurvival.linesAuthored, 'rated line')}`}
            ariaLabel={`${surviving.toLocaleString()} of ${lineSurvival.linesAuthored.toLocaleString()} authored lines still on your branch (${lsPct}%); ${changedBack.toLocaleString()} changed back`}
            legendValueFor={(lane) => count(lane.value, 'line')}
          />
        ),
        note: coverageNote,
      }),
    );
  }

  if (oneShotRate != null) {
    const oneShotPct = Math.round(oneShotRate * 100);
    questions.push(
      rateQuestion({
        id: 'one-shot',
        question: 'How often did sessions skip retry loops?',
        answer: (
          <>
            <Metric tone="neutral">{oneShotPct}%</Metric> of ended sessions ran without a retry-loop
            shape.
          </>
        ),
        rate: oneShotRate,
        note: 'Cadence, not a success score.',
      }),
    );
  }

  // How endings move day by day — the same lifecycle reasons as how-ended, but as
  // a per-day stacked area (one band per reason). endReasonsByDay is the retained
  // event log (a session that resumes then clears is counted each time), so its
  // total is NOT the KV `endedCount` above: the copy leads with the dominant band,
  // never a window total that would conflict with that count. Honest-empty until
  // ends accrue, never a zero-filled day spine. (The by-clock-hour cut lives on the
  // Activity view's rhythm surface, not here — one endings-over-time cut, not two.)
  const byDay = overview.outcomes.endReasonsByDay;
  if (byDay.length > 0 && totalEnded(byDay) > 0) {
    const dayEntries = endReasonStackEntries(
      byDay.map((d) => ({ axis: d.day, reasons: d.reasons })),
    );
    const topBand = dayEntries.reduce(
      (best, e) => {
        const total = e.series.reduce((s, p) => s + p.value, 0);
        return total > best.total ? { label: e.label, total } : best;
      },
      { label: '', total: -1 },
    );
    // Sentence-start capitalization: the band label ("you closed it") is the
    // subject of the finding sentence, so it reads as prose, not a mid-line tag.
    const topBandLabel = topBand.label
      ? topBand.label.charAt(0).toUpperCase() + topBand.label.slice(1)
      : topBand.label;
    questions.push(
      stackedTimelineQuestion({
        id: 'ended-by-day',
        question: 'How did endings move day by day?',
        answer: (
          <>
            <Metric tone="neutral">{topBandLabel}</Metric> is the largest band across the window.
          </>
        ),
        entries: dayEntries,
        unitLabel: 'sessions ended / day',
        ariaLabel: 'How sessions ended, day by day (lifecycle reasons, not completion)',
        note: 'Each band is one way a session ended, day by day, not a completion grade.',
      }),
    );
  }

  // Stuck — the ONE sanctioned live signal on this period surface, and only when
  // the stalled rate crosses its nudge threshold. Below the threshold it drops out
  // (a permanent 0% row would assert a live in-flight rate the tab never promises;
  // the Watch tab owns live attention). Directional by design: a stalled rate
  // crossing the nudge line earns warn ink, and an alarm-level rate escalates to
  // danger. The number's tone and the DotMatrix color share ONE threshold so they
  // escalate together (a red bar under an amber number would read as two states).
  const STUCK_NUDGE_RATE = 0.15;
  const STUCK_ALARM_PCT = 40;
  if (stuckness.rate != null && stuckness.rate >= STUCK_NUDGE_RATE) {
    const ratePct = Math.round(stuckness.rate * 100);
    // The render gate above pins ratePct >= 15, so the tone starts at warning (the
    // old `>= 15 ? warning : neutral` neutral branch was dead) and steps to danger
    // at the alarm line, matching the viz color exactly.
    const alarm = ratePct >= STUCK_ALARM_PCT;
    questions.push(
      rateQuestion({
        id: 'stuck',
        question: 'Is anything stuck?',
        answer: (
          <>
            <Metric tone={alarm ? 'negative' : 'warning'}>{ratePct}%</Metric> of sessions
            stalled, <Metric>{fmtCount(stuckness.stuckCount)}</Metric> flagged for a nudge.
          </>
        ),
        rate: stuckness.rate,
        color: alarm ? 'var(--danger)' : 'var(--warn)',
      }),
    );
  }

  if (bySession.length > 0) {
    // Person-talking fate summary over the fates actually present (drops empty
    // ones), using each fate's own list label so the sentence matches the Status
    // column below. Not a partition claim: this is the recent subset, not all
    // endedCount, so it never asserts a sum against the face.
    const FATE_PROSE: Record<string, string> = {
      retained: 'still in the code',
      pending: 'still maturing',
      overwritten: 'changed back',
      unreachable: 'rewritten',
    };
    const fateClauses = (['retained', 'pending', 'overwritten', 'unreachable'] as const)
      .map((fate) => ({ fate, n: bySession.filter((r) => r.status === fate).length }))
      .filter((x) => x.n > 0)
      .map((x) => (
        <>
          <Metric>{fmtCount(x.n)}</Metric> {FATE_PROSE[x.fate]}
        </>
      ));
    questions.push(
      listQuestion({
        id: 'recent-outcomes',
        question: 'What became of recent sessions?',
        answer: (
          <>
            Of the {countMetric(bySession.length, 'most recent session')} that ended,{' '}
            {naturalListNodes(fateClauses)}.
          </>
        ),
        children: <SessionOutcomesList rows={bySession} />,
      }),
    );
  }

  if (questions.length === 0) {
    return (
      <span className={styles.empty}>
        Session outcomes fill in as sessions end, ship commits that last, and the stuck sweep flags
        silence.
      </span>
    );
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={activeId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

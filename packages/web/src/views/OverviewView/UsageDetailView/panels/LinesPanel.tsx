import {
  FocusedDetailView,
  Metric,
  churnQuestion,
  deltaQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import {
  PeriodDeltaAnswer,
  hasPriorPeriodDelta,
} from '../../../../lib/detail/index.js';
import EmptyState from '../../../../components/EmptyState/EmptyState.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';

import { countMetric, fmtCount, windowPhrase } from '../../../../lib/voice/index.js';

/**
 * LinesPanel — bound to `usage.lines`, the collector's ON-MACHINE line-delta
 * derivation (an LCS diff of each edit-tool payload, counted locally; only the
 * counts ever ship — CAPTURE-PRINCIPLE). This is agent EDIT VOLUME: an edit
 * that later gets reverted still counts here, while the repo-activity widgets stay
 * the git ground truth. `usage.lines` is null — and this panel stays honest —
 * until in-window tool.call events carry the derivation (older collector
 * versions don't emit it).
 */
export function LinesPanel({ overview }: { overview: OverviewSnapshot }) {
  const activeId = useQueryParam('q');
  const lines = overview.usage.lines;

  if (lines === null) {
    return (
      <EmptyState
        title={`No line counts in ${windowPhrase(overview.rangeDays)} yet`}
        hint="Line counts are derived on your machine from each edit's payload. Only the counts are sent, so Seorak still doesn't read your files. They fill in as an up-to-date collector records edits."
      />
    );
  }

  const net = lines.added - lines.removed;

  const volumeAnswer = (
    <>
      The agent added {countMetric(lines.added, 'line')} and removed{' '}
      <Metric>{fmtCount(lines.removed)}</Metric> over {windowPhrase(overview.rangeDays)}, a net of{' '}
      <Metric>
        {net >= 0 ? '+' : '−'}
        {fmtCount(Math.abs(net))}
      </Metric>
      .
    </>
  );

  const questions: FocusedQuestion[] = [
    churnQuestion({
      id: 'volume',
      question: 'How many lines did the agent write?',
      answer: volumeAnswer,
      // Added and removed are two flows on one scale, net the residual they
      // leave — near-equal is rework, added far past removed is greenfield.
      added: lines.added,
      removed: lines.removed,
      formatValue: fmtCount,
      ariaLabel: `${fmtCount(lines.added)} lines added, ${fmtCount(lines.removed)} removed, a net of ${net >= 0 ? '+' : '−'}${fmtCount(Math.abs(net))}`,
      // Volume, not value: counts happen on-machine and reverted edits still
      // land here, so this is not the repo's kept ground truth.
      note: 'Counted on your machine; reverted edits still count. This is volume, not value, so repo activity shows what the repo kept.',
    }),
  ];

  if (hasPriorPeriodDelta(lines.delta)) {
    questions.push(
      deltaQuestion({
        id: 'lines-vs-prior',
        question: 'Did edit-line volume shift?',
        answer: (
          <PeriodDeltaAnswer
            delta={lines.delta!}
            unit="added lines"
            rangeDays={overview.rangeDays}
          />
        ),
        current: lines.delta!.current,
        previous: lines.delta!.previous!,
        format: (n) => `+${fmtCount(n)}`,
      }),
    );
  }

  // No agent-vs-git comparison: agent volume is over the selected range while
  // every git aggregate we capture is the fixed ~7d momentum window, so the two
  // are not on a common scale (the window ratio alone accounts for most of the
  // gap). A two-bar comparison would imply "the work did not survive" when it is
  // mostly a longer window. Git ground truth lives on the Codebase / repo views.

  return (
    <FocusedDetailView
      questions={questions}
      activeId={activeId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

import {
  FocusedDetailView,
  Metric,
  churnQuestion,
  compositionQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';

import {
  countMetric,
  fmtCount,
  metric,
  plural,
  windowPhrase,
} from '../../../../lib/voice/index.js';
import styles from '../CodebaseDetailView.module.css';

export function GitPanel({ overview }: { overview: OverviewSnapshot }) {
  const activeId = useQueryParam('q');
  const stats = overview.codebase.commitStats;

  if (stats == null || (stats.commits === 0 && stats.filesTouched === 0)) {
    return (
      <span className={styles.empty}>
        Git counts fill in as repo activity accrues. Commits and files touched, never paths.
      </span>
    );
  }

  const net = stats.linesAdded - stats.linesDeleted;

  // "What did git show?" — commits and files touched ride the sentence; the
  // added-vs-deleted line churn (and its net) is the shape, so it gets the churn
  // bar. No commits-from-sessions comparison: that leg spans the selected range
  // while git's counts are its own trailing window, so a juxtaposition would read
  // as a ratio across mismatched windows (its own audit note said as much).
  const questions: FocusedQuestion[] = [
    churnQuestion({
      id: 'git-ground-truth',
      question: 'What did git show?',
      answer: (
        <>
          {countMetric(stats.commits, 'commit')} touched {countMetric(stats.filesTouched, 'file')} over{' '}
          {windowPhrase(stats.windowDays)}.
        </>
      ),
      added: stats.linesAdded,
      removed: stats.linesDeleted,
      formatValue: fmtCount,
      ariaLabel: `${fmtCount(stats.linesAdded)} lines added, ${fmtCount(stats.linesDeleted)} deleted, a net of ${net >= 0 ? '+' : '−'}${fmtCount(Math.abs(net))}`,
      note: 'Net lines are git ground truth, not agent edit volume; generated and lockfile lines are excluded.',
    }),
  ];

  // Counted vs excluded churn — a genuine part-to-whole: linesAdded/linesDeleted
  // are added+deleted over NON-ignored files, generatedLinesExcluded is added+
  // deleted over IGNORED (generated/lockfile) files, so the two are the SAME gross
  // measure and sum to total changed lines (audit C9). Only shown when something
  // was excluded (no arc otherwise).
  const countedChurn = stats.linesAdded + stats.linesDeleted;
  const excludedChurn = stats.generatedLinesExcluded;
  const totalChurn = countedChurn + excludedChurn;
  if (excludedChurn > 0 && totalChurn > 0) {
    const excludedPct = Math.round((excludedChurn / totalChurn) * 100);
    questions.push(
      compositionQuestion({
        id: 'generated-churn',
        question: 'How much churn was generated or lockfile noise?',
        answer: (
          <>
            {metric(fmtCount(excludedChurn))} generated or lockfile {plural(excludedChurn, 'line')}{' '}
            {plural(excludedChurn, 'was', 'were')} excluded, <Metric>{excludedPct}%</Metric> of the{' '}
            {countMetric(totalChurn, 'line')} git changed over {windowPhrase(stats.windowDays)}.
          </>
        ),
        // The question is about the EXCLUDED slice (center = excludedPct%), so it
        // carries the ink; the counted bulk is the neutral muted remainder it is
        // measured against. Accent stays reserved for live/selected, never a
        // static part-to-whole.
        arcs: [
          {
            key: 'counted',
            value: countedChurn,
            color: 'var(--viz-cat-other)',
            label: 'counted',
            muted: true,
          },
          { key: 'excluded', value: excludedChurn, color: 'var(--ink)', label: 'generated' },
        ],
        centerValue: `${excludedPct}%`,
        centerEyebrow: 'excluded',
        ariaLabel: 'Counted versus generated lines changed',
      }),
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

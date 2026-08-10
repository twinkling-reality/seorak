import {
  FocusedDetailView,
  Metric,
  distributionQuestion,
  rateQuestion,
  volumeQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { type HeroStatDef } from '../../../../components/viz/index.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';

import { countMetric, fmtCount, fmtPct, windowPhrase } from '../../../../lib/voice/index.js';
import { editCallRollup } from '../editTools.js';
import styles from '../UsageDetailView.module.css';

/**
 * EditsPanel — bound to `tools.byTool` filtered to the edit family
 * (Edit/Write/MultiEdit/NotebookEdit). An "edit" here is an edit-family TOOL
 * CALL from the hook stream — the same definition as the overview `edits`
 * widget — not an individual line edit. Honest-empty until the event log holds
 * in-window tool calls; never zero-filled.
 */
export function EditsPanel({ overview }: { overview: OverviewSnapshot }) {
  const activeId = useQueryParam('q');
  const { total, byTool, allCalls } = editCallRollup(overview);

  if (total === 0) {
    return (
      <span className={styles.empty}>
        No edit-tool calls captured in {windowPhrase(overview.rangeDays)}. Edits fill in as the
        event log records Edit/Write tool calls.
      </span>
    );
  }

  const topTool = byTool[0];
  const sessions = overview.usage.totals.sessions;
  // Edit-call intensity per session — a normalization lens parallel to the
  // Sessions tab's tool-density and Cost's per-session, not a restated total.
  const perSession = sessions > 0 ? Math.round((total / sessions) * 10) / 10 : null;

  // Scalar fallback for a single-tool account (no split to draw): the count and
  // its per-session intensity, two genuine scalars. When 2+ edit tools exist the
  // by-tool breakdown is the richer answer and this is unused.
  const heroStats: HeroStatDef[] = [
    {
      key: 'total',
      value: fmtCount(total),
      label: 'edit-tool calls',
    },
  ];
  if (perSession != null) {
    heroStats.push({
      key: 'per-session',
      value: String(perSession),
      label: 'per session',
    });
  }

  // "How much did you edit?" is answered by the by-tool breakdown: the bars
  // decompose the total (they sum to it), so the magnitude AND where it went read
  // at a glance. That is a better answer than a bare count, so the split is the
  // landing viz, not a separate question. A single-tool account has no split, so
  // it falls back to the scalar hero.
  const mixQuestion =
    topTool && byTool.length >= 2
      ? distributionQuestion({
          id: 'mix',
          question: 'How much did you edit?',
          answer: (
            <>
              You made {countMetric(total, 'edit call')} across {countMetric(sessions, 'session')},
              most of them with <Metric>{topTool.tool}</Metric>.
            </>
          ),
          items: byTool.map((t) => ({
            key: t.tool,
            label: t.tool,
            fillPct: (t.calls / total) * 100,
            fillColor: 'var(--ink)',
            value: `${fmtCount(t.calls)} calls`,
            title: `${fmtPct(t.calls / total)} of edit calls`,
          })),
        })
      : volumeQuestion({
          id: 'mix',
          question: 'How much did you edit?',
          answer: (
            <>
              You made {countMetric(total, 'edit call')} across {countMetric(sessions, 'session')}.
            </>
          ),
          stats: heroStats,
        });

  const questions: FocusedQuestion[] = [mixQuestion];

  // Editing as a proportion of the whole tool budget — a part-of-a-total shape,
  // so a DotMatrix (how big a slice of everything the agent did), never a
  // 2-slice edit/not-edit ring. Only when there are non-edit calls to be a share
  // OF: a 100% "share" would just restate the volume above.
  if (allCalls > total) {
    const share = total / allCalls;
    questions.push(
      rateQuestion({
        id: 'share',
        question: 'How much of all tool use was editing?',
        answer: (
          <>
            Editing made up <Metric>{fmtPct(share)}</Metric> of the{' '}
            {countMetric(allCalls, 'tool call')} the agent made.
          </>
        ),
        rate: share,
        count: { filled: total, total: allCalls },
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

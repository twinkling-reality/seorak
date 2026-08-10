import { useMemo } from 'react';

import {
  FocusedDetailView,
  Metric,
  treemapQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { codebaseFileLabel } from '../../../../lib/detail/index.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';

import { count, countMetric, fmtPct, windowPhrase } from '../../../../lib/voice/index.js';
import styles from '../CodebaseDetailView.module.css';

interface Props {
  overview: OverviewSnapshot;
  /** Overview-only: show cross-repo concentration when rows carry project splits. */
  showCrossRepo: boolean;
}

export function DirectoriesPanel({ overview, showCrossRepo }: Props) {
  const activeId = useQueryParam('q');
  const directories = overview.codebase.directories;

  const sorted = useMemo(
    () => [...directories].filter((d) => d.edits > 0).sort((a, b) => b.edits - a.edits),
    [directories],
  );

  if (sorted.length === 0) {
    return (
      <span className={styles.empty}>
        Directory heat fills in as edit-tool calls accrue over {windowPhrase(overview.rangeDays)}.
      </span>
    );
  }

  const top = sorted[0];
  const topSharePct = Math.round(top.share * 100);
  const repoCount = new Set(
    sorted.flatMap((d) => (d.projects ?? []).map((p) => p.repoId)),
  ).size;

  const questions: FocusedQuestion[] = [
    treemapQuestion({
      id: 'hot-directories',
      question: 'Where is edit activity concentrated?',
      answer: (
        <>
          <Metric>{codebaseFileLabel(top.label, top.dirId)}</Metric> holds{' '}
          <Metric>{topSharePct}%</Metric> of attributed edit calls.
        </>
      ),
      // Area = edits, so the whole directory tree fits and the hotspot dominates
      // by size instead of being one bar above a "+N more" line.
      items: sorted.map((d) => {
        const label = codebaseFileLabel(d.label, d.dirId);
        return {
          key: d.dirId,
          label,
          value: d.edits,
          valueLabel: count(d.edits, 'edit'),
          title: `${label}: ${count(d.edits, 'edit')}, ${fmtPct(d.share)} share`,
        };
      }),
      ariaLabel: 'Directories by edit count',
    }),
  ];

  if (showCrossRepo && repoCount > 1) {
    questions.push(
      treemapQuestion({
        id: 'cross-repo-spread',
        question: 'Are edits spread across repos or one hotspot?',
        answer: (
          <>
            Edit activity spans {countMetric(repoCount, 'repo')};{' '}
            <Metric>{codebaseFileLabel(top.label, top.dirId)}</Metric> is the hottest directory at{' '}
            <Metric>{topSharePct}%</Metric> of calls.
          </>
        ),
        items: sorted.flatMap((d) =>
          (d.projects ?? []).map((p) => {
            // No middot-joined facts on a label: name the directory, then its repo
            // with "in" so it reads as a place, not two stacked facts.
            const label = `${codebaseFileLabel(d.label, d.dirId)} in ${p.project}`;
            return {
              key: `${d.dirId}-${p.repoId}`,
              label,
              value: p.edits,
              valueLabel: count(p.edits, 'edit'),
              title: `${label}: ${count(p.edits, 'edit')}, ${count(p.sessions, 'session')}`,
            };
          }),
        ),
        ariaLabel: 'Directories by edits, split per repo',
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

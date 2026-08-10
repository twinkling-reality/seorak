import { useMemo } from 'react';

import {
  FocusedDetailView,
  Metric,
  compositionQuestion,
  distributionQuestion,
  treemapQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { codebaseFileLabel } from '../../../../lib/detail/index.js';
import { fileCategoryFill, fileCategoryLabel } from '../../../../lib/codebaseCategory.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';

import {
  count,
  countMetric,
  fmtCount,
  windowPhrase,
} from '../../../../lib/voice/index.js';
import styles from '../CodebaseDetailView.module.css';

export function FilesPanel({ overview }: { overview: OverviewSnapshot }) {
  const activeId = useQueryParam('q');
  const files = overview.codebase.files;
  const rework = overview.codebase.rework;

  const sortedFiles = useMemo(
    () => [...files].filter((f) => f.edits > 0).sort((a, b) => b.edits - a.edits),
    [files],
  );
  // Rank by line churn (added + removed), an axis orthogonal to edit-CALL count:
  // a file can be hot by calls yet light on lines (fiddly tweaks), or cold by
  // calls yet a large rewrite. linesAdded/linesRemoved are summed only over rows
  // carrying the on-machine derivation, so 0 = no measured lines → omit (never
  // read a measured 0 as "no change").
  const filesByLines = useMemo(
    () =>
      [...files]
        .filter((f) => f.linesAdded + f.linesRemoved > 0)
        .sort((a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved)),
    [files],
  );
  const sortedRework = useMemo(
    () => [...rework].filter((r) => r.sessions >= 2).sort((a, b) => b.sessions - a.sessions),
    [rework],
  );

  if (sortedFiles.length === 0 && sortedRework.length === 0) {
    return (
      <span className={styles.empty}>
        File heat fills in as edit-tool calls accrue over {windowPhrase(overview.rangeDays)}.
      </span>
    );
  }

  const questions: FocusedQuestion[] = [];

  if (sortedFiles.length > 0) {
    const top = sortedFiles[0];
    questions.push(
      treemapQuestion({
        id: 'hot-files',
        question: 'Which files saw the most edits?',
        answer: (
          <>
            You edited <Metric>{codebaseFileLabel(top.label, top.fileId)}</Metric> the most,{' '}
            {countMetric(top.edits, 'time')} across {countMetric(top.sessions, 'session')}.
          </>
        ),
        // The whole set as a treemap: area = edits, so every touched file is on
        // the map (no cap, no residue) and the eye reads how concentrated the
        // editing was. The small tiles name themselves on hover.
        items: sortedFiles.map((f) => {
          const label = codebaseFileLabel(f.label, f.fileId);
          return {
            key: f.fileId,
            label,
            value: f.edits,
            valueLabel: count(f.edits, 'edit'),
            title: `${label}: ${count(f.edits, 'edit')}, ${count(f.sessions, 'session')}`,
          };
        }),
        ariaLabel: 'Files by edit count',
      }),
    );
  }

  if (filesByLines.length > 0) {
    const top = filesByLines[0];
    const topTotal = top.linesAdded + top.linesRemoved;
    questions.push(
      treemapQuestion({
        id: 'files-by-lines',
        question: 'Which files changed the most, by lines?',
        answer: (
          <>
            <Metric>{codebaseFileLabel(top.label, top.fileId)}</Metric> saw the biggest change at{' '}
            {countMetric(topTotal, 'line')} (<Metric>+{fmtCount(top.linesAdded)}</Metric>{' '}
            / <Metric>−{fmtCount(top.linesRemoved)}</Metric>).
          </>
        ),
        note: 'A different order than by edit count; reverted edits still count as change.',
        items: filesByLines.map((f) => {
          const lines = f.linesAdded + f.linesRemoved;
          const label = codebaseFileLabel(f.label, f.fileId);
          return {
            key: f.fileId,
            label,
            value: lines,
            valueLabel: count(lines, 'line'),
            title: `${label}: +${fmtCount(f.linesAdded)} / −${fmtCount(f.linesRemoved)}`,
          };
        }),
        ariaLabel: 'Files by lines changed',
      }),
    );
  }

  if (sortedRework.length > 0) {
    const top = sortedRework[0];
    questions.push(
      treemapQuestion({
        id: 'rework',
        question: 'Which files keep coming back?',
        answer: (
          <>
            You kept coming back to <Metric>{codebaseFileLabel(top.label, top.fileId)}</Metric>,
            editing it {countMetric(top.edits, 'time')} across {countMetric(top.sessions, 'session')}.
          </>
        ),
        note: 'A review cue, not a grade.',
        items: sortedRework.map((r) => {
          const label = codebaseFileLabel(r.label, r.fileId);
          return {
            key: r.fileId,
            label,
            value: r.sessions,
            valueLabel: count(r.sessions, 'session'),
            title: `${label}: ${count(r.sessions, 'session')}, ${count(r.edits, 'edit')}`,
          };
        }),
        ariaLabel: 'Files by sessions returned to',
      }),
    );
  }

  // Work-mix axes (category + language), summed across the scope's repos from
  // usage.projects[].workMix. These ride the fileSignals opt-in, so workMix is
  // undefined on older collectors — the omit-when-empty gates render nothing
  // rather than a fabricated split (honest-empty, never a guessed category).
  const categoryTotals = new Map<string, number>();
  const languageTotals = new Map<string, number>();
  for (const p of overview.usage.projects) {
    for (const c of p.workMix?.fileCategoryMix ?? []) {
      categoryTotals.set(c.category, (categoryTotals.get(c.category) ?? 0) + c.editCalls);
    }
    for (const l of p.workMix?.fileLanguageMix ?? []) {
      languageTotals.set(l.language, (languageTotals.get(l.language) ?? 0) + l.editCalls);
    }
  }

  const categoryRows = [...categoryTotals.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  // Only with 2+ categories: a single-category ring is a 100% circle the answer
  // already states, not a split worth drawing (the Usage by-tool precedent).
  if (categoryRows.length >= 2) {
    const categoryTotal = categoryRows.reduce((s, [, n]) => s + n, 0);
    const [topCat, topCatN] = categoryRows[0];
    questions.push(
      compositionQuestion({
        id: 'file-categories',
        question: 'What kinds of files did the agent edit?',
        answer: (
          <>
            <Metric>{fileCategoryLabel(topCat)}</Metric> took{' '}
            <Metric>{Math.round((topCatN / categoryTotal) * 100)}%</Metric> of edit calls.
          </>
        ),
        arcs: categoryRows.map(([cat, n]) => ({
          key: cat,
          value: n,
          color: fileCategoryFill(cat),
          label: fileCategoryLabel(cat),
        })),
        centerValue: fmtCount(categoryTotal),
        centerEyebrow: 'edit calls',
        ariaLabel: 'Edit calls by file category',
      }),
    );
  }

  const languageRows = [...languageTotals.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  // Only with 2+ languages: a lone 100% bar restates the answer (as above).
  if (languageRows.length >= 2) {
    const languageTotal = languageRows.reduce((s, [, n]) => s + n, 0);
    const [topLang, topLangN] = languageRows[0];
    const others = languageRows.length - 1;
    questions.push(
      distributionQuestion({
        id: 'file-languages',
        question: 'Which languages did the agent edit in?',
        answer: (
          <>
            <Metric>{topLang}</Metric> led with {countMetric(topLangN, 'edit call')}, ahead of{' '}
            {countMetric(others, 'other language')}.
          </>
        ),
        items: languageRows.map(([lang, n]) => ({
          key: lang,
          label: lang,
          fillPct: languageTotal > 0 ? (n / languageTotal) * 100 : 0,
          fillColor: 'var(--ink)',
          value: count(n, 'edit'),
        })),
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

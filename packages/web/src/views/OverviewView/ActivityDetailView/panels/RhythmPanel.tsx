import { useMemo } from 'react';

import {
  FocusedDetailView,
  Metric,
  distributionQuestion,
  rhythmQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { type HourCell } from '../../../../components/viz/index.js';
import { aggregateSessionsByDow } from '../../../../lib/detail/index.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import { localizeHourBuckets } from '../../../../lib/localTime.js';
import { DAY_LABELS } from '../../../../widgets/utils.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';

import { count, countMetric, plural } from '../../../../lib/voice/index.js';

import { hourGlyph } from '../format.js';
import styles from '../ActivityDetailView.module.css';

interface Props {
  overview: OverviewSnapshot;
  /** Peak (dow, hour) cell, computed once in the parent for the tab value. */
  peakCell: { dow: number; hour: number; sessions: number } | null;
}

/**
 * ActivityDetailView → RhythmPanel — the solo coding-rhythm heatmap, bound to
 * `activity.hourlyDistribution[]` (pure session counts from `startedAt`). The
 * worker fills this from the retained event log; the array stays `[]` until
 * sessions accrue across hours — never zero-filled, so the honest empty state
 * fires instead of a fake all-cold grid that would imply you never code.
 */
export function RhythmPanel({ overview, peakCell }: Props) {
  const activeId = useQueryParam('q');

  const localized = useMemo(
    () => localizeHourBuckets(overview.activity.hourlyDistribution),
    [overview.activity.hourlyDistribution],
  );

  const cells: HourCell[] = useMemo(
    () =>
      localized
        .filter((h) => h.sessions > 0)
        .map((h) => ({ dow: h.dow, hour: h.hour, value: h.sessions })),
    [localized],
  );

  if (cells.length === 0) {
    return (
      <span className={styles.empty}>
        Your coding rhythm shows up here once sessions are retained over time.
      </span>
    );
  }

  const answer = peakCell ? (
    <>
      You peak <Metric>{DAY_LABELS[peakCell.dow]}</Metric> around{' '}
      <Metric>{hourGlyph(peakCell.hour)}</Metric> with {countMetric(peakCell.sessions, 'session')}.
    </>
  ) : (
    <>When sessions cluster across the week.</>
  );

  const questions: FocusedQuestion[] = [
    rhythmQuestion({
      id: 'when',
      question: 'When do you code?',
      answer,
      cells,
      cellSize: 16,
      // Ring the peak cell the face + answer both name ("Mon 10a"), so the
      // heatmap proves the finding instead of leaving it to hover.
      peak: peakCell ? { dow: peakCell.dow, hour: peakCell.hour } : null,
    }),
  ];

  const byDow = aggregateSessionsByDow(localized);
  if (byDow.length > 0) {
    const top = byDow[0];
    questions.push(
      distributionQuestion({
        id: 'busiest-days',
        question: 'Which days of the week are busiest?',
        answer: (
          <>
            <Metric>{DAY_LABELS[top.dow]}</Metric> leads with{' '}
            {countMetric(top.sessions, 'session start')}.
          </>
        ),
        items: byDow.map((d) => ({
          key: String(d.dow),
          label: DAY_LABELS[d.dow],
          fillPct: top.sessions > 0 ? (d.sessions / top.sessions) * 100 : 0,
          fillColor: 'var(--ink)',
          value: count(d.sessions, 'session'),
        })),
      }),
    );
  }

  // Hour-of-day marginal — the orthogonal projection to busiest-days (the
  // day-of-week marginal). A steady afternoon habit spread thin across many days
  // shows up here even when no single heatmap cell dominates. Same honest grid,
  // re-projected onto the clock; only populated hours appear (never a 24-hour
  // zero spine).
  const byHour = new Map<number, number>();
  for (const h of localized) {
    if (h.sessions > 0) byHour.set(h.hour, (byHour.get(h.hour) ?? 0) + h.sessions);
  }
  const hourRows = [...byHour.entries()].sort((a, b) => b[1] - a[1]);
  if (hourRows.length > 0) {
    const [peakHour, peakSessions] = hourRows[0];
    // A working day spans many hours, so the full ranking runs long. Cap to the
    // busiest handful (the answer already names the top hour) and name the tail
    // as a residue, per the ranked-list overflow protocol — never a silent drop.
    const HOUR_CAP = 8;
    const shownHours = hourRows.slice(0, HOUR_CAP);
    const hiddenHours = hourRows.length - shownHours.length;
    questions.push(
      distributionQuestion({
        id: 'hours-of-day',
        question: 'What hours of the day do you code most?',
        answer: (
          <>
            You start most sessions around <Metric>{hourGlyph(peakHour)}</Metric>, with{' '}
            {countMetric(peakSessions, 'start')} in that hour across the week.
          </>
        ),
        items: shownHours.map(([hour, sessions]) => ({
          key: String(hour),
          label: hourGlyph(hour),
          fillPct: peakSessions > 0 ? (sessions / peakSessions) * 100 : 0,
          fillColor: 'var(--ink)',
          value: count(sessions, 'session'),
        })),
        residue:
          hiddenHours > 0
            ? `${count(hiddenHours, 'more hour')} had sessions but ${
                plural(hiddenHours, "isn't", "aren't")
              } shown here.`
            : undefined,
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

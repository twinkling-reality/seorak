import { type Intervention } from '@seorak/types';

import {
  FocusedDetailView,
  Metric,
  distributionQuestion,
  listQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import {
  DetailTable,
  type DetailColumn,
  EntityTable,
  type EntityColumn,
} from '../../../../components/viz/index.js';
import {
  effectiveThresholds,
  groupFiredByKind,
  interventionKindLabel,
  sortFiredNewestFirst,
  thresholdCards,
  type ThresholdCard,
} from '../../../../lib/detail/index.js';
import { formatRelativeTime } from '../../../../lib/relativeTime.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';
import type { DataStatus } from '../../../../lib/stores/pollingTypes.js';
import { navigateToReplay, setQueryParam, useQueryParam } from '../../../../lib/router.js';
import { count, countMetric, windowPhrase } from '../../../../lib/voice/index.js';

import styles from '../OutcomesDetailView.module.css';

interface Props {
  overview: OverviewSnapshot;
  fired?: Intervention[];
  firedStatus: DataStatus;
}

const firedSignal = (e: Intervention) => e.signalLabel || interventionKindLabel(e.kind);

export function InterventionPanel({ overview, fired = [], firedStatus }: Props) {
  const activeId = useQueryParam('q');
  const thresholds = effectiveThresholds(overview.thresholds);
  const cards = thresholdCards(thresholds);
  const sortedFired = sortFiredNewestFirst(fired);
  const byKind = groupFiredByKind(fired);

  // ── What is Seorak watching for? — the eight limits as one reference table.
  // Signal, its trip limit, and why it matters. A table (not eight hero numbers)
  // holds heterogeneous limits — money, a rate, a duration, an either/or count,
  // event-driven — without the values overflowing into each other.
  //
  // Every column is fr-based, NOT minmax(_, auto): DetailTable renders the header
  // and each row as independent grids, so an `auto` track sizes to that row's own
  // content and drifts. The long either/or limit ("3 failed retries or 5 repeats")
  // blew its row's auto Limit track wide and shoved only that row's Why right. fr
  // tracks resolve identically across rows (same container width), so columns stay
  // locked; the Limit column wraps so the one long value stacks instead of pushing.
  const limitColumns: DetailColumn<ThresholdCard>[] = [
    { key: 'signal', header: 'Watch', width: 'minmax(110px, 0.9fr)', render: (c) => c.label },
    {
      key: 'limit',
      header: 'Limit',
      width: 'minmax(120px, 1fr)',
      wrap: true,
      render: (c) => <span className={styles.limit}>{c.value}</span>,
    },
    {
      key: 'why',
      header: 'Why',
      width: 'minmax(0, 1.8fr)',
      wrap: true,
      render: (c) => <span className={styles.subtle}>{c.hint}</span>,
    },
  ];

  const watchLimitsQuestion: FocusedQuestion = listQuestion({
    id: 'watch-limits',
    question: 'What is Seorak watching for?',
    // Populated or not, this answer describes what the limits ARE — the fire
    // count is what-fired's job, so repeating it here would be a second face.
    answer: (
      <>
        These are the limits Seorak nudges you about. A push reaches you the moment one trips, even
        when you&rsquo;re away from the keyboard.
      </>
    ),
    children: (
      <>
        <DetailTable
          columns={limitColumns}
          rows={cards}
          rowKey={(c) => c.kind}
          ariaLabel="Watch limits Seorak monitors"
        />
        {firedStatus === 'ready' && fired.length === 0 && (
          <p className={styles.watchNote}>
            Seorak is watching these now. Nothing has tripped in {windowPhrase(overview.rangeDays)}.
          </p>
        )}
        {firedStatus !== 'ready' && (
          <p className={styles.watchNote}>
            {firedStatus === 'idle' || firedStatus === 'loading'
              ? 'Checking watch history…'
              : firedStatus === 'stale'
                ? 'Showing the last complete watch history while Seorak retries.'
                : 'Watch history is unavailable right now. Seorak will retry.'}
          </p>
        )}
      </>
    ),
  });

  const questions: FocusedQuestion[] = [];

  if (fired.length > 0) {
    // ── What needed your attention? — the fires as a log, the whole row opening
    // Replay for that session. Same shared clickable table (EntityTable) the
    // outcomes list and LiveSessionsTable use: row hover + link + a Replay pill
    // that inverts on hover, not a lone button. The message column wraps so a
    // fire's sentence is never clipped.
    // fr maxes, not minmax(_, auto): independent-grid rows size an `auto` track to
    // their own content, so a wider-than-usual signal label or timestamp would
    // drift only its row's columns (the watch-limits table hit exactly this). fr
    // resolves identically across rows; the message column carries the wrap.
    const firedColumns: EntityColumn<Intervention>[] = [
      { key: 'signal', header: 'Watch', width: 'minmax(104px, 0.7fr)', render: firedSignal },
      { key: 'what', header: 'What happened', width: 'minmax(0, 2fr)', wrap: true, render: (e) => e.body },
      {
        key: 'when',
        header: 'When',
        width: 'minmax(72px, 0.5fr)',
        render: (e) => <span className={styles.subtle}>{formatRelativeTime(e.triggeredAt) ?? '--'}</span>,
      },
    ];

    questions.push(
      listQuestion({
        id: 'what-fired',
        question: 'What needed your attention?',
        answer: (
          <>
            {countMetric(fired.length, 'session')} tripped a watch limit over{' '}
            {windowPhrase(overview.rangeDays)}.
          </>
        ),
        children: (
          <EntityTable
            columns={firedColumns}
            rows={sortedFired}
            rowKey={(e) => `${e.sessionId}-${e.kind}-${e.triggeredAt}`}
            onRowClick={(e) => navigateToReplay(e.sessionId, e.repoId)}
            rowLabel={(e) => `Replay the ${firedSignal(e)} session`}
            actionLabel="Replay"
            ariaLabel="Sessions that tripped a watch limit"
          />
        ),
      }),
    );
  }

  if (byKind.length > 1) {
    const top = byKind[0];
    questions.push(
      distributionQuestion({
        id: 'by-kind',
        question: 'Which limits trip most?',
        answer: (
          <>
            <Metric>{top.label}</Metric> fired {countMetric(top.count, 'time')} over{' '}
            {windowPhrase(overview.rangeDays)}.
          </>
        ),
        items: byKind.map((row) => ({
          key: row.kind,
          label: row.label,
          fillPct: (row.count / byKind[0].count) * 100,
          fillColor: 'var(--ink)',
          value: count(row.count, 'fire'),
        })),
      }),
    );
  }

  questions.push(watchLimitsQuestion);

  return (
    <div className={styles.watch}>
      <FocusedDetailView
        questions={questions}
        activeId={activeId}
        onSelect={(id) => setQueryParam('q', id)}
      />
    </div>
  );
}

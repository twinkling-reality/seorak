import {
  FocusedDetailView,
  benchmarkBarsQuestion,
  dayBarsQuestion,
  deltaQuestion,
  volumeQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { type HeroStatDef } from '../../../../components/viz/index.js';
import {
  PeriodDeltaAnswer,
  hasPriorPeriodDelta,
  perSessionAverage,
} from '../../../../lib/detail/index.js';
import {
  ProjectInline,
  projectSquircleKey,
} from '../../../../components/ProjectSquircle/ProjectSquircle.js';
import { setQueryParam, useQueryParam } from '../../../../lib/router.js';
import type { OverviewSnapshot } from '../../../../lib/apiSchemas.js';
import {
  averageClause,
  count,
  countMetric,
  fmtCount,
  formatDay,
  metric,
  windowPhrase,
} from '../../../../lib/voice/index.js';

import styles from '../UsageDetailView.module.css';

/**
 * SessionsPanel — bound to `usage.totals` + `outcomes.endedCount`, summed from
 * the sessions currently held in KV. Live "active now" state belongs to the
 * live drill, not this period surface, so it is not shown here.
 * There is no completion/stall hero because Seorak has no completion
 * classification, so this is the honest subset: total sessions in the window
 * and ended count.
 */
export function SessionsPanel({ overview }: { overview: OverviewSnapshot }) {
  const activeId = useQueryParam('q');
  const { totals } = overview.usage;
  const { endedCount } = overview.outcomes;

  if (totals.sessions === 0) {
    return (
      <span className={styles.empty}>
        No sessions captured in {windowPhrase(overview.rangeDays)}.
      </span>
    );
  }

  const heroStats: HeroStatDef[] = [
    {
      key: 'total',
      value: fmtCount(totals.sessions),
      label: 'sessions',
    },
    {
      key: 'ended',
      value: fmtCount(endedCount),
      label: 'ended',
      sublabel: 'reached a terminal state',
    },
    {
      key: 'tool-calls',
      value: fmtCount(totals.toolCalls),
      label: 'tool calls',
      sublabel: 'across all sessions',
    },
  ];

  const trends = overview.usage.dailyTrends;
  const sessionPoints = trends.map((d) => ({ day: d.day, value: d.sessions }));
  // The daily rhythm is the one shape in this panel a number can't carry, so it
  // leads: the landing answers "how many" with the per-day bars, which also mark
  // the busiest day. A window too short to trace (<2 days) falls back to the
  // scalar hero — there is no rhythm to draw.
  const hasRhythm = trends.length >= 2;
  const peak = hasRhythm
    ? trends.reduce((best, d) => (d.sessions > best.sessions ? d : best), trends[0])
    : null;

  const volumeAnswer = (
    <>
      You ran {countMetric(totals.sessions, 'session')} over {windowPhrase(overview.rangeDays)}, and{' '}
      {metric(fmtCount(endedCount))} of them have ended.
      {peak != null ? (
        <>
          {' '}
          Your busiest day was {formatDay(peak.day)}, at {countMetric(peak.sessions, 'session')}.
        </>
      ) : null}
    </>
  );

  const questions: FocusedQuestion[] = [
    hasRhythm
      ? dayBarsQuestion({
          id: 'volume',
          question: 'How many sessions did you run?',
          answer: volumeAnswer,
          points: sessionPoints,
          ariaLabel: `Daily sessions across ${trends.length} days`,
          formatValue: (n) => count(n, 'session'),
        })
      : volumeQuestion({
          id: 'volume',
          question: 'How many sessions did you run?',
          answer: volumeAnswer,
          stats: heroStats,
        }),
  ];

  const sessionsDelta = totals.sessionsDelta;
  if (hasPriorPeriodDelta(sessionsDelta)) {
    questions.push(
      deltaQuestion({
        id: 'volume-vs-prior',
        question: 'Did your session volume shift?',
        answer: (
          <PeriodDeltaAnswer
            delta={sessionsDelta!}
            unit="sessions"
            rangeDays={overview.rangeDays}
          />
        ),
        current: sessionsDelta!.current,
        previous: sessionsDelta!.previous!,
        format: fmtCount,
      }),
    );
  }

  const avgTools = perSessionAverage(totals.toolCalls, totals.sessions);
  if (avgTools != null && totals.toolCalls > 0) {
    const rounded = Math.round(avgTools * 10) / 10;

    // Decompose tool-heaviness into per-repo INTENSITY — the variance a single
    // "N per session" cannot carry. Each ratio is a repo's own tool calls over
    // its own sessions (no cross-repo blend). The benchmark line AND the sentence
    // use the pooled average of these SAME repos, so the line always sits within
    // the bars and nothing here divides one population's calls by another's
    // session count. Needs >= 2 repos to rank, else the scalar hero stands.
    const byRepo = (overview.usage.projects ?? [])
      .filter((p) => p.sessions > 0 && p.toolCalls > 0)
      .map((p) => ({
        repoId: p.repoId,
        label: p.project,
        value: Math.round((p.toolCalls / p.sessions) * 10) / 10,
        toolCalls: p.toolCalls,
        sessions: p.sessions,
      }))
      .sort((a, b) => b.value - a.value);

    if (byRepo.length >= 2) {
      const pooledCalls = byRepo.reduce((s, p) => s + p.toolCalls, 0);
      const pooledSessions = byRepo.reduce((s, p) => s + p.sessions, 0);
      const pooled = Math.round((pooledCalls / pooledSessions) * 10) / 10;
      const heaviest = byRepo[0];
      questions.push(
        benchmarkBarsQuestion({
          id: 'tool-density',
          question: 'How tool-heavy were your sessions?',
          answer: (
            <>
              How hard your sessions leaned on tools varied by repo.{' '}
              <ProjectInline
                projectKey={projectSquircleKey(heaviest.repoId, heaviest.label)}
                label={heaviest.label}
                title={heaviest.label}
              />{' '}
              ran heaviest at {metric(heaviest.value.toLocaleString())} calls per session, against a{' '}
              {metric(pooled.toLocaleString())} average across your repos.
            </>
          ),
          items: byRepo.map(({ repoId, label, value }) => ({
            key: repoId,
            projectKey: repoId,
            label,
            value,
            display: value.toLocaleString(),
          })),
          reference: { value: pooled, label: `avg ${pooled.toLocaleString()}` },
          ariaLabel: `Tool calls per session by repo, against the ${pooled} average`,
        }),
      );
    } else {
      const perSession = averageClause({ n: totals.sessions, per: metric(rounded) });
      questions.push(
        volumeQuestion({
          id: 'tool-density',
          question: 'How tool-heavy were your sessions?',
          answer: (
            <>
              Your {countMetric(totals.sessions, 'session')} made{' '}
              {countMetric(totals.toolCalls, 'tool call')}
              {perSession != null ? <>, {perSession}</> : null}.
            </>
          ),
          stats: [
            { key: 'calls', value: fmtCount(totals.toolCalls), label: 'tool calls' },
            {
              key: 'avg',
              value: String(rounded),
              label: 'per session',
            },
          ],
        }),
      );
    }
  }

  return (
    <FocusedDetailView
      questions={questions}
      activeId={activeId}
      onSelect={(id) => setQueryParam('q', id)}
    />
  );
}

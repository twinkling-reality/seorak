import { useMemo, type ReactNode } from 'react';

import {
  FocusedDetailView,
  Metric,
  listQuestion,
  type FocusedQuestion,
} from '../../../../components/DetailView/index.js';
import { EntityTable, type EntityColumn } from '../../../../components/viz/index.js';
import {
  ProjectIdentity,
  ProjectInline,
  projectSquircleKey,
} from '../../../../components/ProjectSquircle/ProjectSquircle.js';
import { navigateToCompare, setQueryParam, useQueryParam } from '../../../../lib/router.js';
import type { ProjectRollup } from '../../../../lib/apiSchemas.js';

import {
  count,
  countMetric,
  fmtCount,
  formatCost,
  formatRelative,
} from '../../../../lib/voice/index.js';
import styles from '../UsageDetailView.module.css';

interface Props {
  projects: ProjectRollup[];
  /** Opens a repo's ProjectView. Keyed by the rollup's `repoId`. */
  onOpenProject: (project: string) => void;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * ProjectsPanel — per-repo comparison as ONE sortable table, three column
 * configs (DASHBOARD-CLARITY Precedent 2 / DETAIL-VIZ F1). The repos are the
 * rows; the old seven "which repo leads by X" questions were seven columns of
 * this one table shown one at a time, so they collapse into three coherent
 * cuts the reader sorts in place: activity (sessions / cost / recency), health
 * (ship / stuck / errors), and cost trend. Rows open the repo; two repos can be
 * compared explicitly in Compare's secondary repo mode.
 */
export function ProjectsPanel({ projects, onOpenProject }: Props) {
  const activeId = useQueryParam('q');

  const bySessions = useMemo(
    () => [...projects].sort((a, b) => b.sessions - a.sessions),
    [projects],
  );

  if (projects.length === 0) {
    return <span className={styles.empty}>No repository activity yet.</span>;
  }

  // The named repo in each answer carries the same identity squircle the rows
  // use (keyed off repoId, the app-wide project color key).
  const projectMark = (p: ProjectRollup) => (
    <ProjectInline
      projectKey={projectSquircleKey(p.repoId, p.project)}
      label={p.project}
      title={p.project}
    />
  );

  const repoCol: EntityColumn<ProjectRollup> = {
    key: 'repo',
    header: 'Repo',
    width: 'minmax(120px, 1.4fr)',
    render: (p) => (
      <ProjectIdentity
        projectKey={projectSquircleKey(p.repoId, p.project)}
        label={p.project || '--'}
        title={p.project}
      />
    ),
  };

  const openProps = {
    onRowClick: (p: ProjectRollup) => onOpenProject(p.repoId),
  };

  const compareAction =
    projects.length >= 2 ? (
      <button
        type="button"
        className={styles.compareCta}
        onClick={() => navigateToCompare({ mode: 'repos' })}
      >
        Choose two repos to compare
      </button>
    ) : null;

  // ── Activity: sessions / cost / recency ──────────────────────────────────
  const topSessions = bySessions[0];
  const activityCols: EntityColumn<ProjectRollup>[] = [
    repoCol,
    {
      key: 'sessions',
      header: 'Sessions',
      align: 'end',
      width: '88px',
      render: (p) => fmtCount(p.sessions),
      sortValue: (p) => p.sessions,
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'end',
      width: '96px',
      render: (p) => (p.costUsd != null ? formatCost(p.costUsd, 2) : '--'),
      sortValue: (p) => p.costUsd,
    },
    {
      key: 'recency',
      header: 'Last active',
      align: 'end',
      width: '112px',
      render: (p) => formatRelative(p.lastEventAt),
      sortValue: (p) => {
        const t = Date.parse(p.lastEventAt);
        return Number.isNaN(t) ? null : t;
      },
    },
  ];

  const questions: FocusedQuestion[] = [
    listQuestion({
      id: 'overview',
      question: 'Where is your work?',
      answer:
        topSessions && topSessions.sessions > 0 ? (
          <>
            Your work spans {countMetric(projects.length, 'repo')}, led by {projectMark(topSessions)}{' '}
            at {countMetric(topSessions.sessions, 'session')}.
          </>
        ) : (
          <>No sessions recorded against a repo yet.</>
        ),
      children: (
        <EntityTable
          columns={activityCols}
          rows={projects}
          rowKey={(p) => p.repoId}
          {...openProps}
          rowLabel={(p) => `Open ${p.project || 'repo'}, ${count(p.sessions, 'session')}`}
          defaultSort={{ key: 'sessions', dir: 'desc' }}
          ariaLabel="Repos by sessions, cost, and recency"
          action={compareAction}
        />
      ),
    }),
  ];

  // ── Health: ship / stuck / errors ────────────────────────────────────────
  const healthRepos = projects.filter(
    (p) => p.shipRate != null || p.stuckness.rate != null || p.errorRate != null,
  );
  if (healthRepos.length > 0) {
    const shipLead = [...healthRepos]
      .filter((p) => p.shipRate != null)
      .sort((a, b) => b.shipRate! - a.shipRate!)[0];
    const stuckLead = [...healthRepos]
      .filter((p) => p.stuckness.rate != null && p.stuckness.rate > 0)
      .sort((a, b) => b.stuckness.rate! - a.stuckness.rate!)[0];

    // Lead with the strongest shipper when shipping is measured; otherwise the
    // repo stalling most. One finding, and only from data that exists.
    let healthAnswer: ReactNode;
    if (shipLead?.shipRate != null) {
      healthAnswer = (
        <>
          {projectMark(shipLead)} lands commits in <Metric>{pct(shipLead.shipRate)}</Metric> of its
          finished sessions, the most of your {count(healthRepos.length, 'active repo')}.
        </>
      );
    } else if (stuckLead?.stuckness.rate != null) {
      healthAnswer = (
        <>
          {projectMark(stuckLead)} is stalling most, with <Metric>{pct(stuckLead.stuckness.rate)}</Metric>{' '}
          of its in-flight sessions stuck.
        </>
      );
    } else {
      healthAnswer = (
        <>Ship and stall rates are filling in across {countMetric(healthRepos.length, 'repo')}.</>
      );
    }

    const healthCols: EntityColumn<ProjectRollup>[] = [
      repoCol,
      {
        key: 'ship',
        header: 'Ships',
        align: 'end',
        width: '76px',
        render: (p) => (p.shipRate != null ? pct(p.shipRate) : '--'),
        sortValue: (p) => p.shipRate,
      },
      {
        key: 'stuck',
        header: 'Stuck',
        align: 'end',
        width: '76px',
        render: (p) => (p.stuckness.rate != null ? pct(p.stuckness.rate) : '--'),
        sortValue: (p) => p.stuckness.rate,
      },
      {
        key: 'errors',
        header: 'Errors',
        align: 'end',
        width: '76px',
        render: (p) => (p.errorRate != null ? pct(p.errorRate) : '--'),
        sortValue: (p) => p.errorRate,
      },
    ];

    questions.push(
      listQuestion({
        id: 'health',
        question: 'How are these repos holding up?',
        answer: healthAnswer,
        note: 'Ship is over finished sessions, stuck over in-flight, errors over tool calls that returned a result.',
        children: (
          <EntityTable
            columns={healthCols}
            rows={healthRepos}
            rowKey={(p) => p.repoId}
            {...openProps}
            rowLabel={(p) =>
              `Open ${p.project || 'repo'}, ${p.shipRate != null ? pct(p.shipRate) + ' ship' : 'ship not yet measured'}`
            }
            defaultSort={{ key: 'ship', dir: 'desc' }}
            ariaLabel="Repos by ship, stuck, and error rate"
          />
        ),
      }),
    );
  }

  // ── Cost trend: current window cost vs the prior window ──────────────────
  const trendRepos = projects.filter((p) => p.costDelta != null && p.costDelta.previous != null);
  if (trendRepos.length > 0) {
    const changeOf = (p: ProjectRollup) => p.costDelta!.current - p.costDelta!.previous!;
    const changeLead = [...trendRepos].sort((a, b) => changeOf(b) - changeOf(a))[0];
    const lead = changeLead.costDelta!;

    const trendCols: EntityColumn<ProjectRollup>[] = [
      repoCol,
      {
        key: 'current',
        header: 'Cost',
        align: 'end',
        width: '92px',
        render: (p) => formatCost(p.costDelta!.current, 2),
        sortValue: (p) => p.costDelta!.current,
      },
      {
        key: 'prior',
        header: 'Prior',
        align: 'end',
        width: '84px',
        render: (p) => formatCost(p.costDelta!.previous!, 2),
        sortValue: (p) => p.costDelta!.previous,
      },
      {
        key: 'change',
        header: 'Change',
        align: 'end',
        width: '96px',
        render: (p) => {
          const d = changeOf(p);
          return `${d >= 0 ? '+' : '−'}${formatCost(Math.abs(d), 2)}`;
        },
        sortValue: changeOf,
      },
    ];

    questions.push(
      listQuestion({
        id: 'cost-trend',
        question: 'Which repos are spending more?',
        answer: (
          <>
            {projectMark(changeLead)} moved the most, <Metric>{formatCost(lead.current, 2)}</Metric>{' '}
            vs <Metric>{formatCost(lead.previous!, 2)}</Metric> the prior window.
          </>
        ),
        children: (
          <EntityTable
            columns={trendCols}
            rows={trendRepos}
            rowKey={(p) => p.repoId}
            {...openProps}
            rowLabel={(p) => `Open ${p.project || 'repo'}, ${formatCost(p.costDelta!.current, 2)} cost`}
            defaultSort={{ key: 'change', dir: 'desc' }}
            ariaLabel="Repos by cost change versus the prior window"
          />
        ),
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

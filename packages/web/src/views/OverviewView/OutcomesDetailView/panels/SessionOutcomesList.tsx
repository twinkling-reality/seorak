import type { SessionOutcomeRow } from '@seorak/types';

import { EntityTable, type EntityColumn } from '../../../../components/viz/index.js';
import {
  ProjectIdentity,
  projectSquircleKey,
} from '../../../../components/ProjectSquircle/ProjectSquircle.js';
import {
  OUTCOME_STATUS_META,
  outcomeTimingCopy,
} from '../../../../widgets/bodies/lineSurvival.js';
import { navigateToReplay } from '../../../../lib/router.js';

import styles from '../OutcomesDetailView.module.css';

interface Props {
  rows: SessionOutcomeRow[];
}

/**
 * Per-session outcome rows (ADR-OA7) — pending → fate list for the outcomes
 * detail drill. Content-free: project basename + closed enum status only.
 */
export function SessionOutcomesList({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <span className={styles.empty}>
        Session outcomes fill in as sessions end and line-survival checks mature.
      </span>
    );
  }

  const now = Date.now();

  const columns: EntityColumn<SessionOutcomeRow>[] = [
    {
      key: 'project',
      header: 'Project',
      width: 'minmax(0, 1.2fr)',
      // The repo carries its identity squircle here, same as every other
      // project-bearing table (ProjectsPanel), keyed on repoId so the color
      // matches the repo everywhere else.
      render: (row) => (
        <ProjectIdentity
          projectKey={projectSquircleKey(row.repoId, row.project)}
          label={row.project || '--'}
          title={row.project}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        const meta = OUTCOME_STATUS_META[row.status];
        return <span style={{ color: meta.textColor }}>{meta.label}</span>;
      },
    },
    {
      key: 'timing',
      header: 'Timing',
      render: (row) => outcomeTimingCopy(row.endedAt, row.status, now) || '--',
    },
  ];

  // The whole row opens Replay for that session — the shared clickable-table
  // interaction (row hover + link + the Replay pill inverting on hover), not a
  // lone button in a static row. actionLabel renders the trailing viewPill.
  return (
    <EntityTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.sessionId}
      onRowClick={(row) => navigateToReplay(row.sessionId, row.repoId)}
      rowLabel={(row) => `Open replay for ${row.project || 'this session'}`}
      actionLabel="Replay"
      ariaLabel="Recent session outcomes"
    />
  );
}

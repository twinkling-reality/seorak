import { useMemo } from 'react';
import { DEFAULT_PROJECT_ARCHIVE, type ProjectArchive } from '@seorak/types';
import { fetchProjectArchive, updateProjectArchive } from '../../lib/api.js';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useSettingsSection } from '../../hooks/useSettingsSection.js';
import { formatRelativeTime } from '../../lib/relativeTime.js';
import OutlineActionButton from '../../components/controls/OutlineActionButton.js';
import styles from './SettingsView.module.css';

/*
 * Archive — put a project away without deleting anything.
 *
 * A SEPARATE panel from merges, not a second control inside it, because a panel
 * owns exactly one settings family and one `useSettingsSection` machine. Sharing
 * one would let a failed merge roll back an archive made in the same breath, and
 * `settingsSectionParity.test.jsx` holds every panel to that contract from the
 * outside.
 *
 * It is also a different claim. A MERGE asserts two cards are one project and
 * rewrites how work is grouped. An ARCHIVE asserts nothing about the data: the
 * sessions, cost and history stay, the work still counts in the global totals,
 * and the project simply stops appearing in the sidebar and the scope pickers.
 *
 * What it is FOR: a repo that is real git but disposable — a scratch clone, an
 * e2e fixture, an experiment. No capture-time rule should be guessing at that,
 * which is why this is a human judgment with a button rather than a heuristic.
 * Directories that were never repos at all need no judgment and are folded
 * automatically (see NON_REPO_PROJECT_ID).
 */

interface ProjectRow {
  repoId: string;
  project: string;
  sessions: number;
  lastEventAt: string;
  /** Stamped by the plane from `projectArchive`; absent means active. Archived
   *  rows still arrive in the overview PRECISELY so this panel can name them —
   *  a restore control needs the label, and the label lives on the rollup. */
  archived?: boolean;
}

/** Module-const fallback: deriving against a stable reference avoids the
 *  useSyncExternalStore loop a `?? []` inside the selector would cause. */
const EMPTY_PROJECTS: ProjectRow[] = [];

export default function ProjectArchiveSection() {
  const { state, applyChange } = useSettingsSection<ProjectArchive>({
    load: fetchProjectArchive,
    demoData: DEFAULT_PROJECT_ARCHIVE,
    unavailableReason: 'Worker unreachable. Archiving a project needs a running worker.',
    readOnlyNote:
      "This access token can read this worker, but it can't archive projects. Sign in with the worker's owner token to make changes here.",
    logLabel: 'project archive',
  });
  const overview = usePollingStore((s) => s.overviewData);
  const projects = (overview?.usage.projects as ProjectRow[] | undefined) ?? EMPTY_PROJECTS;

  /* Ordered by DORMANCY, not alphabetically.
   *
   * The job here is "find the ones that do not belong", and the answer is
   * always among the quiet ones: a scratch clone, an e2e fixture, an experiment
   * from months ago. Sorting A-Z buried `anos (0 sessions)` between two real
   * projects and made the reader check all eighteen rows. Least-used first, then
   * longest-untouched, puts every candidate at the top and lets you stop reading
   * as soon as the numbers get real. */
  const [active, archived] = useMemo(() => {
    const on: ProjectRow[] = [];
    const off: ProjectRow[] = [];
    for (const p of projects) (p.archived ? off : on).push(p);
    const dormantFirst = (a: ProjectRow, b: ProjectRow) =>
      a.sessions - b.sessions ||
      (a.lastEventAt || '').localeCompare(b.lastEventAt || '') ||
      a.project.localeCompare(b.project);
    return [[...on].sort(dormantFirst), [...off].sort(dormantFirst)];
  }, [projects]);

  function setArchived(row: ProjectRow, next: boolean): void {
    if (state.kind !== 'ready') return;
    const previous = state.data;
    const byRepo = { ...previous.byRepo };
    // Minted at the click, because the contract REFUSES an entry without a
    // parseable `archivedAt` rather than stamping "now" on the way in.
    const entry = { archivedAt: new Date().toISOString() };
    if (next) byRepo[row.repoId] = entry;
    else delete byRepo[row.repoId];
    applyChange({
      optimistic: { byRepo },
      // `null` is the RESTORE tombstone. Omitting the key would merge back into
      // the stored value and leave the project archived — the same trap the
      // per-project notification overrides hit.
      write: () => updateProjectArchive({ byRepo: { [row.repoId]: next ? entry : null } }),
      rollback: () => previous,
      savedNote: next ? `Archived ${row.project}.` : `Restored ${row.project}.`,
      pendingNote: 'Applying…',
      demoNote: next ? `Archived ${row.project}.` : `Restored ${row.project}.`,
    });
  }

  if (state.kind === 'unavailable') {
    return <span className={styles.settingsUnavailable}>{state.reason}</span>;
  }
  if (state.kind === 'loading') {
    return <span className={styles.notifyEmpty}>Loading…</span>;
  }

  const disabled = state.readOnly;

  return (
    <div className={styles.settingsPanel} data-testid="project-archive-controls">
      <div className={styles.settingsRowGroup}>
        <span className={styles.settingsRowLabel}>
          Archiving takes a project out of the sidebar and the scope pickers. Nothing is
          deleted: its sessions, cost and history are kept, and its work still counts in
          your totals.
        </span>
      </div>

      {active.length === 0 ? (
        <div className={styles.settingsRowGroup}>
          <span className={styles.settingsRowLabel}>No projects to archive yet.</span>
        </div>
      ) : (
        <div className={styles.settingsRowGroup} data-testid="project-archive-active">
          {active.map((p) => (
            <div key={p.repoId} className={styles.settingsRow} style={{ cursor: 'default' }}>
              <span className={styles.settingsRowLabel}>
                {p.project}
                {/* The two facts that decide it, in the order you weigh them:
                  * how much is here, and how long since you touched it. */}
                <span className={styles.settingsRowMeta}>
                  {p.sessions === 0
                    ? 'no sessions'
                    : `${p.sessions} ${p.sessions === 1 ? 'session' : 'sessions'}`}
                  {formatRelativeTime(p.lastEventAt)
                    ? `, last active ${formatRelativeTime(p.lastEventAt)}`
                    : ''}
                </span>
              </span>
              <OutlineActionButton
                size="sm"
                disabled={disabled}
                onClick={() => setArchived(p, true)}
              >
                Archive
              </OutlineActionButton>
            </div>
          ))}
        </div>
      )}

      {archived.length > 0 ? (
        <div className={styles.settingsRowGroup} data-testid="project-archive-archived">
          {archived.map((p) => (
            <div key={p.repoId} className={styles.settingsRow} style={{ cursor: 'default' }}>
              <span className={styles.settingsRowLabel}>
                {p.project}
                <span className={styles.settingsRowMeta}>archived</span>
              </span>
              <OutlineActionButton
                size="sm"
                disabled={disabled}
                onClick={() => setArchived(p, false)}
              >
                Restore
              </OutlineActionButton>
            </div>
          ))}
        </div>
      ) : null}

      {state.note ? <span className={styles.feedback}>{state.note}</span> : null}
    </div>
  );
}

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { DEFAULT_PROJECT_MERGES, type ProjectMerges } from '@seorak/types';
import {
  claimWorkspaceProject,
  fetchProjectMerges,
  updateProjectMerges,
} from '../../lib/api.js';
import { usePollingStore } from '../../lib/stores/polling.js';
import { useWorkspaceContext } from '../../lib/workspaceContext.js';
import { useSettingsSection } from '../../hooks/useSettingsSection.js';
import OutlineActionButton from '../../components/controls/OutlineActionButton.js';
import styles from './SettingsView.module.css';

/*
 * Projects — merge duplicate project cards into one canonical project. A single
 * repo fragments into several salted repoIds when its git origin changes (rename/
 * transfer) or its path changes (folder move / iCloud split); merging folds those
 * ids so the worker groups their sessions/cost/tokens under one card everywhere
 * (the aggregation resolves repoId → canonical before it rolls up). Load, optimistic
 * write, 401 read-only, and rollback are the shared useSettingsSection machine, the
 * same one Capture and Alerts run.
 *
 * Detection is safe and label-based: only cards that SHARE a basename are offered
 * as merge candidates (two genuinely different repos never auto-merge — the merge
 * is always an explicit click). A cross-name rename can be undone from "Active
 * merges" but is not auto-suggested (there is no honest signal two differently-
 * named cards are the same project).
 */

interface ProjectRow {
  repoId: string;
  project: string;
  lastEventAt: string;
  sessions: number;
  costUsd: number | null;
}

/** Module-const empty fallback: selecting `overviewData` (a stable store ref) and
 *  deriving projects against this constant avoids the useSyncExternalStore
 *  infinite loop a `?? []` inside the selector would cause while overviewData is
 *  still null (a fresh array every snapshot). */
const EMPTY_PROJECTS: ProjectRow[] = [];

export default function ProjectsSection() {
  const workspace = useWorkspaceContext();
  const { state, applyChange } = useSettingsSection<ProjectMerges>({
    load: fetchProjectMerges,
    demoData: DEFAULT_PROJECT_MERGES,
    unavailableReason: 'Worker unreachable — project merging needs a running worker.',
    readOnlyNote:
      "This access token can read this worker, but it can't merge projects. Sign in with the worker's owner token to make changes here.",
    logLabel: 'project merges',
  });
  // Manual merge picker (for renames ACROSS different names, which auto-detection
  // cannot safely suggest): fold `source` into `target`.
  const [manualSource, setManualSource] = useState('');
  const [manualTarget, setManualTarget] = useState('');
  const overview = usePollingStore((s) => s.overviewData);
  const projects = (overview?.usage.projects as ProjectRow[] | undefined) ?? EMPTY_PROJECTS;

  function write(
    optimistic: ProjectMerges,
    patch: { byRepo: Record<string, string | null> },
    savedNote: string,
    perform: () => Promise<ProjectMerges> = () => updateProjectMerges(patch),
  ): void {
    if (state.kind !== 'ready') return;
    const prev = state.data;
    applyChange({
      optimistic,
      write: perform,
      rollback: () => prev,
      savedNote,
      pendingNote: 'Applying…',
      // A merge in demo really does fold the cards locally, so the confirmation
      // is true without a worker.
      demoNote: savedNote,
    });
  }

  // Duplicate-basename groups from the (already-merged) project list: any label
  // carried by two or more distinct repoIds is a merge candidate.
  const duplicateGroups = useMemo(() => {
    const byLabel = new Map<string, ProjectRow[]>();
    for (const p of projects) {
      if (!p.repoId) continue;
      const arr = byLabel.get(p.project) ?? [];
      arr.push(p);
      byLabel.set(p.project, arr);
    }
    return [...byLabel.entries()].filter(([, rows]) => rows.length > 1);
  }, [projects]);

  function mergeGroup(rows: ProjectRow[]): void {
    if (state.kind !== 'ready') return;
    // Canonical = the most recently active card; fold the rest into it.
    const canonical = [...rows].sort((a, b) =>
      (b.lastEventAt || '').localeCompare(a.lastEventAt || ''),
    )[0]?.repoId;
    if (!canonical) return;
    const patch: Record<string, string> = {};
    for (const r of rows) if (r.repoId !== canonical) patch[r.repoId] = canonical;
    const optimistic: ProjectMerges = { byRepo: { ...state.data.byRepo, ...patch } };
    write(optimistic, { byRepo: patch }, 'Merged — the cards fold on the next refresh.');
  }

  function mergeManual(): void {
    if (state.kind !== 'ready') return;
    if (!manualSource || !manualTarget || manualSource === manualTarget) return;
    const patch = { [manualSource]: manualTarget };
    const optimistic: ProjectMerges = { byRepo: { ...state.data.byRepo, ...patch } };
    write(
      optimistic,
      { byRepo: patch },
      'Merged — the cards fold on the next refresh.',
      workspace?.mode === 'workspace'
        ? async () => {
            await claimWorkspaceProject({
              canonicalRepoId: manualTarget,
              joiningRepoId: manualSource,
            });
            return optimistic;
          }
        : undefined,
    );
    setManualSource('');
    setManualTarget('');
  }

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.project.localeCompare(b.project)),
    [projects],
  );

  function unmergeAll(): void {
    if (state.kind !== 'ready') return;
    const patch: Record<string, string | null> = {};
    for (const key of Object.keys(state.data.byRepo)) patch[key] = null;
    write({ byRepo: {} }, { byRepo: patch }, 'Unmerged — the cards split on the next refresh.');
  }

  if (state.kind === 'unavailable') {
    return <span className={styles.settingsUnavailable}>{state.reason}</span>;
  }
  if (state.kind === 'loading') {
    return <span className={styles.notifyEmpty}>Loading…</span>;
  }

  const mergeCount = Object.keys(state.data.byRepo).length;
  const controlsDisabled = state.readOnly;

  return (
    <div className={styles.settingsPanel} data-testid="projects-controls">
      {duplicateGroups.length === 0 ? (
        <div className={styles.settingsRowGroup}>
          <span className={styles.settingsRowLabel}>
            No duplicate projects detected. When one repo shows up as two cards (a rename or a
            move), the extra card appears here to merge.
          </span>
        </div>
      ) : (
        duplicateGroups.map(([label, rows]) => (
          <div key={label} className={styles.settingsRowGroup} data-testid="projects-dup-row">
            <div className={styles.settingsRow} style={{ cursor: 'default' }}>
              <span className={styles.settingsRowLabel}>
                “{label}” is {rows.length} cards ({rows.reduce((n, r) => n + (r.sessions || 0), 0)}{' '}
                sessions) — likely one project.
              </span>
              <OutlineActionButton
                size="sm"
                disabled={controlsDisabled}
                onClick={() => mergeGroup(rows)}
              >
                Merge
              </OutlineActionButton>
            </div>
          </div>
        ))
      )}

      <div className={styles.settingsRowGroup} data-testid="projects-manual-merge">
        <div className={styles.settingsRow} style={{ cursor: 'default' }}>
          <span className={styles.settingsRowLabel}>
            {workspace?.mode === 'workspace'
              ? 'Same repo on two machines? Explicitly join its two workspace project cards.'
              : 'Renamed to a different name? Fold one project card into another.'}
          </span>
        </div>
        <div className={styles.settingsRowDetail}>
          <div className={styles.settingsBoundFields}>
            <label className={styles.settingsBoundRow}>
              <span className={styles.settingsBoundLead}>Fold</span>
              <span
                className={clsx(
                  styles.settingsBoundChip,
                  styles.settingsBoundChipWide,
                  styles.settingsBoundChipSelect,
                )}
              >
                <select
                  className={styles.settingsBoundSelect}
                  value={manualSource}
                  disabled={controlsDisabled}
                  aria-label="Project to fold"
                  onChange={(e) => setManualSource(e.target.value)}
                >
                  <option value="">Select project…</option>
                  {sortedProjects.map((p) => (
                    <option key={p.repoId} value={p.repoId}>
                      {p.project} ({p.repoId.slice(0, 6)})
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className={styles.settingsBoundRow}>
              <span className={styles.settingsBoundLead}>Into</span>
              <span
                className={clsx(
                  styles.settingsBoundChip,
                  styles.settingsBoundChipWide,
                  styles.settingsBoundChipSelect,
                )}
              >
                <select
                  className={styles.settingsBoundSelect}
                  value={manualTarget}
                  disabled={controlsDisabled}
                  aria-label="Project to keep"
                  onChange={(e) => setManualTarget(e.target.value)}
                >
                  <option value="">Select project…</option>
                  {sortedProjects.map((p) => (
                    <option key={p.repoId} value={p.repoId}>
                      {p.project} ({p.repoId.slice(0, 6)})
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <OutlineActionButton
              size="sm"
              disabled={
                controlsDisabled ||
                !manualSource ||
                !manualTarget ||
                manualSource === manualTarget
              }
              onClick={mergeManual}
            >
              Merge
            </OutlineActionButton>
          </div>
        </div>
      </div>

      {mergeCount > 0 ? (
        <div className={styles.settingsRowGroup} data-testid="projects-active-merges">
          <div className={styles.settingsRow} style={{ cursor: 'default' }}>
            <span className={styles.settingsRowLabel}>
              {mergeCount} project {mergeCount === 1 ? 'card is' : 'cards are'} merged into another.
            </span>
            <OutlineActionButton size="sm" disabled={controlsDisabled} onClick={unmergeAll}>
              Unmerge all
            </OutlineActionButton>
          </div>
        </div>
      ) : null}

      {state.note ? <span className={styles.feedback}>{state.note}</span> : null}
    </div>
  );
}

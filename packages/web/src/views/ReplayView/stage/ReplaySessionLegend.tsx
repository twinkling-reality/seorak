import { useEffect, useState } from 'react';
import clsx from 'clsx';

import ProjectSquircle from '../../../components/ProjectSquircle/ProjectSquircle.js';
import type { LegendItem } from '../replayTransforms.js';
import supCount from '../../../components/controls/supCount.module.css';
import styles from './ReplaySessionLegend.module.css';

/** Collapsed legend rows before "+N more". */
export const LEGEND_VISIBLE_CAP = 8;

export default function ReplaySessionLegend({
  items,
  focusedProjectId,
  onFocusProject,
  onClearFocus,
  onToggleChartSession,
}: {
  items: LegendItem[];
  focusedProjectId: string | null;
  onFocusProject: (repoId: string) => void;
  onClearFocus: () => void;
  onToggleChartSession: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const drillDown = focusedProjectId != null;
  const overflowCount = items.length - LEGEND_VISIBLE_CAP;
  const collapsed = !expanded && overflowCount > 0;
  const visibleItems = collapsed ? items.slice(0, LEGEND_VISIBLE_CAP) : items;

  useEffect(() => {
    setExpanded(false);
  }, [focusedProjectId, items.length]);

  return (
    <div id="replay-session-legend" className={styles.legendWrap}>
      <ul
        className={clsx(
          styles.legend,
          collapsed && styles.legendCollapsed,
          items.length > 6 && styles.legendScrollable,
        )}
        aria-label="Replay sessions"
      >
        {visibleItems.map(({ series, selected }) => {
          const isFocused = focusedProjectId === series.repoId;
          const canFocusProject = series.kind === 'project';
          const sessionId = series.sessionIds[0];

          return (
            <li key={series.key}>
              <button
                type="button"
                className={clsx(
                  styles.legendButton,
                  isFocused && styles.legendButtonActive,
                  drillDown && series.kind === 'session' && !selected && styles.legendButtonUnselected,
                )}
                onClick={() => {
                  if (drillDown && series.kind === 'session' && sessionId) {
                    onToggleChartSession(sessionId);
                    return;
                  }
                  if (focusedProjectId && isFocused) {
                    onClearFocus();
                    return;
                  }
                  if (canFocusProject) onFocusProject(series.repoId);
                }}
                disabled={!canFocusProject && !drillDown}
                aria-pressed={drillDown && series.kind === 'session' ? selected : isFocused}
                aria-label={
                  drillDown && series.kind === 'session'
                    ? `${selected ? 'Hide' : 'Show'} ${series.label} on chart, ${series.status}`
                    : `${series.label}, ${series.status}`
                }
              >
                <ProjectSquircle projectKey={series.repoId} size="sm" />
                <span className={styles.legendLabel}>
                  <span className={styles.legendText}>{series.label}</span>
                  {series.statusSup ? (
                    <sup className={clsx(supCount.supCount, styles.legendCount)}>{series.statusSup}</sup>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
        {collapsed ? (
          <li>
            <button
              type="button"
              className={styles.legendMoreButton}
              onClick={() => setExpanded(true)}
              aria-label={`Show ${overflowCount} more sessions`}
            >
              +{overflowCount} more
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

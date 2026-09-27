import { type CSSProperties } from 'react';
import clsx from 'clsx';
import SectionEmpty from '../../components/SectionEmpty/SectionEmpty.js';
import { ProjectIdentity } from '../../components/ProjectSquircle/ProjectSquircle.js';
import { readinessSectionText } from './shared.js';
import SectionOverflow from '../../components/SectionOverflow/SectionOverflow.js';
import Tooltip from '../../components/Tooltip/Tooltip.js';
import { StripFaceHead } from './atoms/StripFaceHead.js';
import { navigateToDetail } from '../../lib/router.js';
import type { WidgetBodyProps, WidgetRegistry } from './types.js';
import styles from './MomentumWidgets.module.css';

/**
 * Repo activity — the cross-repo "which repos had commits this week" board,
 * rendered from usage.portfolio in the dashboard's standard table chrome (mono
 * headers, one left-alignment rule, per-row View pill, edge-to-edge minmax
 * tracks).
 *
 * ADR-1 (DASHBOARD-CLARITY): the worker's temperature enum is NOT rendered.
 * The judgment it compressed is stated as explicit numbers instead — each
 * row's shipped `baseline` (the repo's own one-window-ago reading) becomes a
 * signed files-touched delta under "vs prior Nd", and quiet repos carry
 * their days-dark in a dedicated "quiet for" column. `--` when the history is
 * too thin to compare (never a fabricated "steady"), "none reported" when there
 * is no quiet stretch to state. Anti-vanity: the head is breadth ("N of M repos moved"), never
 * "+X lines"; netLines is display-only and never a score.
 *
 * Honest-empty: portfolio.repos === [] renders the empty state, never a fake
 * board. Overflow: top MOMENTUM_REPOS_CAP rows + SectionOverflow into the
 * usage drill — no inner scroll, no silent truncation.
 */

// Simultaneous-visibility cap. The server sorts repos by files touched with
// quiet repos sinking, so the fold hides the tail, and the head's breadth
// count still states the whole portfolio.
const MOMENTUM_REPOS_CAP = 5;

function signedNet(n: number): string {
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString()}`; // proper minus sign
  return '0';
}

function MomentumWidget({ overview, capture, openProject }: WidgetBodyProps) {
  const portfolio = overview.usage.portfolio;
  const repos = portfolio.repos;

  if (repos.length === 0) {
    return (
      <SectionEmpty>
        {readinessSectionText(
          'momentum',
          overview,
          capture,
          'Repo activity fills in once Seorak sees a git commit.',
        )}
      </SectionEmpty>
    );
  }

  const visible = repos.slice(0, MOMENTUM_REPOS_CAP);
  const overflow = repos.length - visible.length;
  // This widget's window is git's own trailing window (portfolio.windowDays),
  // NOT the dashboard range pill — the caption states it so the breadth count
  // can't be misread as a 30d/90d figure. Meaning-changing caveat, kept.
  const days = portfolio.windowDays;
  // Named by day count at EVERY window: git's window is a rolling trailing
  // stretch, so "prior week" would misread as a calendar week at days === 7.
  const vsHeader = `Vs prior ${days}d`;

  return (
    <div className={styles.momentumFrame}>
      {/* "with commits", not "moved" (house jargon, fails the stranger test):
        * reposMoved is commits>0 OR filesTouched>0, and git.momentum's counts
        * are commit-derived (collector git.ts reads `git log --since`), so
        * "with commits" is the exact plain-language form of the judgment.
        * Keep in sync with the collector derivation. */}
      <StripFaceHead
        value={`${portfolio.reposMoved} of ${portfolio.reposTotal}`}
        caption={`${portfolio.reposTotal === 1 ? 'repo' : 'repos'} with commits in the past ${days} days`}
      />
      <div className={styles.momentumContainer}>
        <div className={styles.momentumTable}>
          <div className={styles.momentumHeader}>
            <span>Repo</span>
            <span>Files touched</span>
            <span className={styles.momentumNet}>Net lines</span>
            <span>{vsHeader}</span>
            <span>Quiet for</span>
            <span aria-hidden="true" />
          </div>
          <div className={styles.momentumBody}>
            {visible.map((r, i) => {
              const baseline = r.baseline;
              const delta = baseline === null ? null : r.filesTouched - baseline.filesTouched;
              const quietDays = r.temperature === 'quiet' && r.quietDays != null ? r.quietDays : null;
              return (
                <button
                  key={r.repoId}
                  type="button"
                  className={styles.momentumRow}
                  style={{ '--row-index': i } as CSSProperties}
                  onClick={() => openProject(r.repoId)}
                  aria-label={`Open ${r.repoLabel} project view`}
                >
                  <ProjectIdentity
                    projectKey={r.repoId}
                    label={r.repoLabel}
                    title={r.repoLabel}
                  />
                  <span
                    className={
                      r.filesTouched === 0 ? styles.momentumCellNumZero : styles.momentumCellNum
                    }
                  >
                    {r.filesTouched.toLocaleString()}
                  </span>
                  <span
                    className={clsx(
                      styles.momentumNet,
                      r.netLines === 0 ? styles.momentumCellNumZero : styles.momentumCellNum,
                    )}
                    title={
                      r.generatedLinesExcluded > 0
                        ? `${r.generatedLinesExcluded.toLocaleString()} generated/lockfile lines excluded`
                        : undefined
                    }
                  >
                    {signedNet(r.netLines)}
                  </span>
                  <span className={styles.momentumCell}>
                    {baseline === null || delta === null ? (
                      <Tooltip
                        label={`Not enough history yet to compare ${days}-day readings for this repo.`}
                        placement="right"
                        wrap
                      >
                        <span className={styles.momentumCellEmpty}>--</span>
                      </Tooltip>
                    ) : (
                      <Tooltip
                        label={`Touched ${r.filesTouched.toLocaleString()} ${
                          r.filesTouched === 1 ? 'file' : 'files'
                        } in the past ${days} days vs ${baseline.filesTouched.toLocaleString()} in the repo's prior ${days}-day reading.`}
                        placement="right"
                        wrap
                      >
                        <span
                          className={delta === 0 ? styles.momentumCellNumZero : styles.momentumCellNum}
                        >
                          {signedNet(delta)} {Math.abs(delta) === 1 ? 'file' : 'files'}
                        </span>
                      </Tooltip>
                    )}
                  </span>
                  <span className={styles.momentumCell}>
                    {quietDays === null ? (
                      // No quiet stretch to state: the repo is active, its recency is
                      // unknown, or its history is too thin to have been judged at all.
                      // The cell says only what is true of all three, and the tooltip
                      // carries it, the way both sibling cells already do.
                      <Tooltip
                        label={`No quiet stretch reported for ${r.repoLabel}.`}
                        placement="right"
                        wrap
                      >
                        <span className={styles.momentumCellEmpty}>none reported</span>
                      </Tooltip>
                    ) : (
                      <Tooltip
                        label={`No commits or file changes seen in ${r.repoLabel} for ${quietDays} ${
                          quietDays === 1 ? 'day' : 'days'
                        }.`}
                        placement="right"
                        wrap
                      >
                        <span className={styles.momentumCellNum}>{quietDays}d</span>
                      </Tooltip>
                    )}
                  </span>
                  <span className={styles.momentumViewButton}>View</span>
                </button>
              );
            })}
          </div>
          {overflow > 0 && (
            <div className={styles.momentumOverflow}>
              <SectionOverflow
                count={overflow}
                label={overflow === 1 ? 'repo' : 'repos'}
                onClick={() => navigateToDetail('usage', 'projects', 'overview')}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const momentumWidgets: WidgetRegistry = {
  momentum: MomentumWidget,
};

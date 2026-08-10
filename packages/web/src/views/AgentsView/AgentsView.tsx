import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RefObject } from 'react';
import clsx from 'clsx';

import {
  ProjectIdentity,
  projectSquircleKey,
} from '../../components/ProjectSquircle/ProjectSquircle.js';
import RangePills from '../../components/RangePills/RangePills.jsx';
import { ShimmerText, SkeletonLine, SkeletonRows } from '../../components/Skeleton/Skeleton.jsx';
import StatusState from '../../components/StatusState/StatusState.jsx';
import OverviewStaleBanner from '../../components/Banner/OverviewStaleBanner.jsx';
import ToolIcon from '../../components/ToolIcon/ToolIcon.js';
import ViewHeader from '../../components/ViewHeader/ViewHeader.jsx';
import glass from '../../components/surface/glass.module.css';
import { useAllowedRanges, useOverview } from '../../hooks/useOverview.js';
import { isDemoActive } from '../../lib/demoMode.js';
import { formatModel } from '../../lib/modelMeta.js';
import { navigate, useLocationHash } from '../../lib/router.js';
import { forceRefresh } from '../../lib/stores/polling.js';
import { getToolMeta } from '../../lib/toolMeta.js';
import { count, formatCost, formatTokens } from '../../lib/voice/index.js';

import { RANGES, type RangeDays } from '../OverviewView/overview-utils.js';

import AgentsHistoryChart from './AgentsHistoryChart.js';
import AgentsNarrativeRead from './AgentsNarrativeRead.js';
import AgentsRepoFilter from './AgentsRepoFilter.js';
import { aggregateAgentSeries } from './agentsScope.js';
import {
  buildAgentsCoverage,
  buildAgentsHistory,
  buildAgentsMatrix,
  buildAgentsNarrative,
  buildAgentsOutcomes,
  buildAgentsWhere,
  type AgentsNote,
  type AgentsNoteSection,
} from './agentsVerdict.js';
import styles from './AgentsView.module.css';

/** The evidence sections, and the lead each one opens with when no note is pinned. */
const PANELS: Array<{ id: AgentsNoteSection; title: string; lead: string }> = [
  {
    id: 'outcomes',
    title: 'Outcomes',
    lead: "What each tool's landed work actually did. Seorak traces committed lines back to the tool that wrote them and re-checks them against the branch three days later, so this comes from git rather than from either tool.",
  },
  {
    id: 'matrix',
    title: 'Why',
    lead: 'Side-by-side on what both tools can report honestly. Empty cells mean the agent did not emit that field, never a stand-in zero.',
  },
  {
    id: 'where',
    title: 'Where',
    lead: 'Edit volume by project for each agent. Repos that ran more than one tool sort first.',
  },
  {
    id: 'when',
    title: 'When',
    lead: 'Past activity only: sessions, edit lines, and call hours for each tool. It says when you reached for each one, never what to use next.',
  },
  {
    id: 'models',
    title: 'Models',
    lead: 'The models behind each tool this window. Unpriced models show tokens, never a fabricated $0.',
  },
  {
    id: 'coverage',
    title: 'Coverage',
    lead: "What each tool's capture reports today, and what it cannot. Every empty cell in Why traces back to a row here.",
  },
];

const PANEL_BY_ID = Object.fromEntries(PANELS.map((p) => [p.id, p])) as Record<
  AgentsNoteSection,
  (typeof PANELS)[number]
>;

/** Column header carrying the agent's brand mark; values below stay ink. */
function AgentHead({ id, label, leader }: { id: string; label: string; leader?: boolean }) {
  return (
    <span
      className={styles.agentHead}
      role="columnheader"
      data-leader={leader ? 'true' : undefined}
      style={{ '--agent-brand': getToolMeta(id).color } as CSSProperties}
    >
      <ToolIcon tool={id} size={13} className={styles.agentHeadIcon} />
      {label}
    </span>
  );
}

/**
 * The panel's caption, and the berth for a pinned note.
 *
 * At rest it carries the section's lead. Pin a term in the verdict and the note lands
 * here, wired back to the term it answers, instead of floating over the rows it
 * cites. When the note has rows to point at, it points: the rows below take the same
 * highlight the term has, and the note drops its citation lines rather than printing
 * the same numbers a few pixels above the table that already states them.
 */
function AgentsPanelHead({
  note,
  lead,
  onClose,
  headRef,
}: {
  note: AgentsNote | null;
  lead: string;
  onClose: () => void;
  headRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={headRef} className={styles.panelHead}>
      {note ? (
        <div
          className={clsx(styles.panelHeadNote, styles[`termSection_${note.section}`])}
          role="region"
          aria-label={note.label}
        >
          <div className={styles.noteHead}>
            <span
              className={styles.noteSwatch}
              data-section={note.section}
              aria-hidden="true"
            />
            <h2 className={styles.noteTitle}>{note.label}</h2>
            <button type="button" className={styles.noteClose} onClick={onClose}>
              Done
            </button>
          </div>

          <p className={styles.noteDetail}>{note.detail}</p>

          {!note.cites?.length && note.citations.length > 0 && (
            <ul className={styles.noteCitations}>
              {note.citations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className={styles.sectionLead}>{lead}</p>
      )}
    </div>
  );
}

/**
 * AgentsView — personal Claude vs Codex compare.
 *
 * An annotated verdict on the left, the evidence for it on the right, in one
 * composition. The panels are evidence FOR the verdict and never alternatives TO it:
 * the prose cites into them, so a panel that replaced the read would erase the
 * sentence its own numbers came from. Fair cells only (docs/specs/multi-tool.md
 * Appendix A). Always in the sidebar; thin windows show the second-tool empty state.
 */
export default function AgentsView() {
  // 7d matches OverviewView / ProjectView: the light, fast /overview build (≈10s vs
  // ≈38s for 30d) and no surface defaults to the heavy window. 30d/90d stay one pill away.
  const [rangeDays, setRangeDays] = useState<RangeDays>(7);
  const [picked, setPicked] = useState<AgentsNoteSection | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const { overview, isLoading, error, isStale } = useOverview(rangeDays);
  const ranges = useAllowedRanges();

  const splitRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  const locationHash = useLocationHash();

  useEffect(() => {
    const ids: AgentsNoteSection[] = ['outcomes', 'matrix', 'where', 'when', 'models', 'coverage'];
    setPicked(
      (ids as string[]).includes(locationHash) ? (locationHash as AgentsNoteSection) : null,
    );
  }, [locationHash]);

  // ── Repo scope ────────────────────────────────────────────────────────────
  // Empty selection == "All projects" == the GLOBAL head-to-head (which also counts
  // sessions attributed to no repo, so it is NOT the same as summing every repo).
  // A STRICT subset re-scopes every panel by re-aggregating those repos' per-repo
  // agent series client-side (aggregateAgentSeries) — sum counts, recompute rates,
  // no re-fetch. "All selected" collapses back to the global view.
  const allProjects = overview.usage.projects;
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);
  const isFiltered =
    selectedRepoIds.length > 0 && selectedRepoIds.length < allProjects.length;
  const scopedProjects = useMemo(
    () =>
      isFiltered
        ? allProjects.filter((p) => selectedRepoIds.includes(p.repoId))
        : allProjects,
    [isFiltered, allProjects, selectedRepoIds],
  );
  const repoOptions = useMemo(
    () => allProjects.map((p) => ({ repoId: p.repoId, project: p.project, sessions: p.sessions })),
    [allProjects],
  );
  const scope = useMemo(() => {
    if (!isFiltered) {
      return {
        byAgent: overview.tools.byAgent,
        agentOutcomes: overview.tools.agentOutcomes,
        agentOutcomesUnusable: overview.tools.agentOutcomesUnusable,
        byModel: overview.tools.byModel,
        agentModels: overview.tools.agentModels,
        agentDaily: overview.tools.agentDaily,
        agentHourly: overview.activity.agentHourly,
      };
    }
    return aggregateAgentSeries(scopedProjects);
    // overview.tools / .activity are stable across /live ticks (only overview.live is
    // swapped), so this does not re-aggregate every second while a session is live.
  }, [isFiltered, overview.tools, overview.activity, scopedProjects]);

  const byAgent = scope.byAgent;
  const agentOutcomes = scope.agentOutcomes;
  const unusableOutcomes = scope.agentOutcomesUnusable;
  const byModel = scope.byModel;
  const agentModels = scope.agentModels;
  const agentDaily = scope.agentDaily;
  const agentHourly = scope.agentHourly;
  const multiAgent = byAgent.length > 1;
  // The viewer's clock offset: cadence + hour charts speak local time and say so.
  const offsetMinutes = useMemo(() => new Date().getTimezoneOffset(), []);

  const narrative = useMemo(
    () =>
      buildAgentsNarrative(
        byAgent,
        scopedProjects,
        byModel,
        agentModels,
        agentHourly,
        offsetMinutes,
        agentOutcomes,
      ),
    [
      byAgent,
      scopedProjects,
      byModel,
      agentModels,
      agentHourly,
      offsetMinutes,
      agentOutcomes,
    ],
  );
  const outcomes = useMemo(
    () => buildAgentsOutcomes(byAgent.length ? agentOutcomes : [], byAgent, unusableOutcomes),
    [agentOutcomes, byAgent, unusableOutcomes],
  );

  // A pinned term IS a choice of evidence, so it drives the panel. If a range swap
  // rebuilds the narrative without this note, the pin quietly lapses rather than
  // holding a section open on a claim the window no longer makes.
  const pinnedNote = useMemo(
    () => (pinnedId ? narrative.notes.find((n) => n.id === pinnedId) ?? null : null),
    [pinnedId, narrative.notes],
  );
  // Picking a pill by hand is the other direction: you have left the note's section,
  // so the note lets go of the panel.
  const pickPanel = useCallback((section: AgentsNoteSection) => {
    setPicked(section);
    setPinnedId(null);
  }, []);
  const pin = useCallback((noteId: string | null) => setPinnedId(noteId), []);

  // Open on the strongest evidence the window actually holds. Outcomes is the only
  // thing here that says what the work was WORTH, so it leads when it has something
  // to say; when it does not, the page opens on Why rather than on an empty panel.
  const panel: AgentsNoteSection =
    pinnedNote?.section ?? picked ?? (outcomes.agents.length > 0 ? 'outcomes' : 'matrix');
  /** Rows the pinned note is citing: the table states them, so the note points. */
  const cited = useMemo(() => new Set(pinnedNote?.cites ?? []), [pinnedNote]);

  const matrix = useMemo(() => buildAgentsMatrix(byAgent), [byAgent]);
  const whereRows = useMemo(
    () => buildAgentsWhere(scopedProjects, matrix.agents.map((a) => a.id)),
    [scopedProjects, matrix.agents],
  );
  const coverageRows = useMemo(() => buildAgentsCoverage(byAgent), [byAgent]);
  const history = useMemo(
    () =>
      buildAgentsHistory(
        agentDaily,
        agentHourly,
        matrix.agents.map((a) => a.id),
        rangeDays,
        Date.now(),
        offsetMinutes,
        byAgent,
      ),
    [agentDaily, agentHourly, matrix.agents, rangeDays, offsetMinutes, byAgent],
  );
  const anyHistory = useMemo(
    () => history.maxSessions > 0 || history.maxLines > 0 || history.maxHourly > 0,
    [history],
  );

  const modelGroups = useMemo(() => {
    // Per-agent grouping, matrix order; each agent's rows ranked by tokens (the
    // metric every model-carrying row reports). An agent with no model rows
    // still gets a group with its honest empty line.
    const order = matrix.agents.map((a) => a.id);
    return order.map((agentId) => ({
      agentId,
      rows: agentModels
        .filter((m) => m.agent === agentId && (m.tokensTotal > 0 || m.calls > 0))
        .sort((a, b) => b.tokensTotal - a.tokensTotal),
    }));
  }, [agentModels, matrix.agents]);

  if (error && !byAgent.length && !isLoading) {
    return (
      <div className={styles.page}>
        <StatusState
          tone="danger"
          eyebrow="Agents unavailable"
          title="Could not load agent compare"
          hint="The overview is temporarily unavailable."
          detail={error}
          meta="Agents"
          actionLabel="Retry"
          onAction={forceRefresh}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ViewHeader eyebrow="Tools" title="Agents" demo={isDemoActive()} />

      <OverviewStaleBanner visible={isStale} />

      <div className={styles.toolbar}>
        <AgentsRepoFilter
          repos={repoOptions}
          selected={selectedRepoIds}
          onChange={setSelectedRepoIds}
        />
        <RangePills
          value={rangeDays}
          onChange={(v) => setRangeDays(v as RangeDays)}
          options={ranges}
        />
      </div>

      {isLoading ? (
        // The /overview aggregate is heavy (a cold build runs several seconds). Show a
        // skeleton while it lands rather than the honest-empty "no agent rows" split,
        // which reads as "you have no data" when the truth is "still loading".
        <div className={styles.split} aria-busy="true">
          <section className={styles.verdict}>
            <ShimmerText as="p">Comparing your agents…</ShimmerText>
            <div style={{ marginTop: 16 }}>
              <SkeletonLine width="90%" height={20} />
            </div>
            <div style={{ marginTop: 10 }}>
              <SkeletonLine width="75%" height={20} />
            </div>
          </section>
          <div className={styles.evidence}>
            <SkeletonRows count={5} columns={3} />
          </div>
        </div>
      ) : !multiAgent ? (
        <StatusState
          tone="neutral"
          eyebrow="Agents"
          title="Need a second tool in this window"
          hint="Agents fills in once Seorak has sessions from more than one agent, such as Claude Code and Codex."
          meta="Agents"
          actionLabel="Back to overview"
          onAction={() => navigate('overview')}
        />
      ) : (
        <div ref={splitRef} className={styles.split}>
          <section id="verdict" className={styles.verdict}>
            <AgentsNarrativeRead
              narrative={narrative}
              pinnedId={pinnedNote ? pinnedId : null}
              onPin={pin}
              splitRef={splitRef}
              headRef={headRef}
            />
          </section>

          <div className={styles.evidence}>
            <nav className={styles.panelPills} aria-label="Evidence sections">
              {PANELS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={clsx(
                    styles.panelPill,
                    glass.sheet,
                    glass.rim,
                    panel === p.id && styles.panelPillActive,
                  )}
                  onClick={() => pickPanel(p.id)}
                  aria-pressed={panel === p.id}
                >
                  <span className={styles.noteSwatch} data-section={p.id} aria-hidden="true" />
                  {p.title}
                </button>
              ))}
            </nav>

            <section
              id={panel}
              className={clsx(
                styles.panelBody,
                pinnedNote && styles[`termSection_${pinnedNote.section}`],
              )}
              aria-label={PANEL_BY_ID[panel].title}
            >
              {/* The head lives OUTSIDE the keyed swap on purpose. Pinning a term also
                  turns the panel, and if the head remounted with the body its DOM node
                  would be replaced mid-commit — the read measures the connector target
                  in a layout effect that runs before a later sibling's ref is attached,
                  so the wire would silently fail to draw on the very click that asked
                  for it. A stable head is what the connector is aimed at. */}
              <AgentsPanelHead
                note={pinnedNote}
                lead={PANEL_BY_ID[panel].lead}
                onClose={() => pin(null)}
                headRef={headRef}
              />

              <div key={panel} className={styles.panelSwap}>
              {panel === 'outcomes' &&
                (outcomes.agents.length === 0 ? (
                  <p className={styles.empty}>
                    Outcomes fill in once committed work matures, three days after it lands.
                  </p>
                ) : (
                  <>
                    <div
                      className={styles.table}
                      role="table"
                      aria-label="Agent outcomes from git"
                      style={{ '--agent-cols': outcomes.agents.length } as CSSProperties}
                    >
                      <div className={styles.headRow} role="row">
                        <span className={styles.metricHead} role="columnheader">
                          Outcome
                        </span>
                        {outcomes.agents.map((a) => (
                          <AgentHead key={a.id} id={a.id} label={a.label} />
                        ))}
                      </div>
                      {outcomes.rows.map((row, i) => (
                        <div
                          className={styles.row}
                          role="row"
                          key={row.id}
                          style={{ '--row-index': i } as CSSProperties}
                        >
                          <span
                            className={clsx(
                              styles.metricLabel,
                              cited.has(row.id) && styles.metricLabelCited,
                            )}
                            role="rowheader"
                            title={row.hint}
                          >
                            {row.label}
                          </span>
                          {row.cells.map((cell, ci) => (
                            <div
                              key={`${row.id}-${outcomes.agents[ci]?.id ?? ci}`}
                              className={cell.empty ? styles.cellEmpty : styles.cell}
                              role="cell"
                            >
                              {cell.text}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>

                    {/* Every way this compare could mislead, said out loud under the
                        evidence. A caveat you have to hover to find is a caveat you
                        meant to hide. */}
                    {outcomes.disclosures.map((line) => (
                      <p key={line} className={styles.disclosure}>
                        {line}
                      </p>
                    ))}
                  </>
                ))}

              {panel === 'matrix' && (
                <>
                  {matrix.agents.length === 0 ? (
                    <p className={styles.empty}>No agent rows in this window.</p>
                  ) : (
                    <div
                      className={styles.table}
                      role="table"
                      aria-label="Agent metric matrix"
                      style={{ '--agent-cols': matrix.agents.length } as CSSProperties}
                    >
                      <div className={styles.headRow} role="row">
                        <span className={styles.metricHead} role="columnheader">
                          Metric
                        </span>
                        {matrix.agents.map((a) => (
                          <AgentHead
                            key={a.id}
                            id={a.id}
                            label={a.label}
                            leader={narrative.leaderId === a.id}
                          />
                        ))}
                      </div>
                      {matrix.rows.map((row, i) => (
                        <div
                          className={styles.row}
                          role="row"
                          key={row.id}
                          style={{ '--row-index': i } as CSSProperties}
                        >
                          <span
                            className={clsx(
                              styles.metricLabel,
                              cited.has(row.id) && styles.metricLabelCited,
                            )}
                            role="rowheader"
                            title={row.hint}
                          >
                            {row.label}
                          </span>
                          {row.cells.map((cell, ci) => (
                            <div
                              key={`${row.id}-${matrix.agents[ci]?.id ?? ci}`}
                              className={cell.empty ? styles.cellEmpty : styles.cell}
                              role="cell"
                            >
                              {cell.text}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Every way this table could mislead, said out loud under the evidence.
                      The error row is the live one: the two agents' rates are measured over
                      different work, and a reader who does not know that has been misled by
                      a table we built. */}
                  {matrix.disclosures.map((line) => (
                    <p key={line} className={styles.disclosure}>
                      {line}
                    </p>
                  ))}
                </>
              )}

              {panel === 'where' &&
                (whereRows.length === 0 ? (
                  <p className={styles.empty}>
                    Per-project agent split fills in once sessions land in a repo.
                  </p>
                ) : (
                  <div
                    className={styles.table}
                    role="table"
                    aria-label="Agent by project"
                    style={{ '--agent-cols': matrix.agents.length } as CSSProperties}
                  >
                    <div className={styles.headRow} role="row">
                      <span className={styles.metricHead} role="columnheader">
                        Project
                      </span>
                      {matrix.agents.map((a) => (
                        <AgentHead key={a.id} id={a.id} label={a.label} />
                      ))}
                    </div>
                    {whereRows.map((row, i) => (
                      <div
                        className={styles.row}
                        role="row"
                        key={row.repoId}
                        style={{ '--row-index': i } as CSSProperties}
                      >
                        <span
                          className={styles.projectCell}
                          role="rowheader"
                          title={row.agentLabels}
                        >
                          <ProjectIdentity
                            projectKey={projectSquircleKey(row.repoId, row.project)}
                            label={row.project}
                            size="xs"
                          />
                          {row.multi ? <span className={styles.multiMark}>both</span> : null}
                        </span>
                        {row.cells.map((cell, ci) => (
                          <div
                            key={`${row.repoId}-${matrix.agents[ci]?.id ?? ci}`}
                            className={cell.empty ? styles.cellEmpty : styles.cell}
                            role="cell"
                          >
                            {cell.text}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}

              {panel === 'when' &&
                (!anyHistory ? (
                  <p className={styles.empty}>
                    The history charts fill in as sessions land in this window.
                  </p>
                ) : (
                  <AgentsHistoryChart series={history} />
                ))}

              {panel === 'models' &&
                (modelGroups.every((g) => g.rows.length === 0) ? (
                  <p className={styles.empty}>
                    Per-model spend fills in as the window&apos;s tool calls accrue.
                  </p>
                ) : (
                  modelGroups.map((group) => (
                    <div key={group.agentId} className={styles.modelGroup}>
                      <span
                        className={styles.modelGroupHead}
                        style={
                          { '--agent-brand': getToolMeta(group.agentId).color } as CSSProperties
                        }
                      >
                        <ToolIcon
                          tool={group.agentId}
                          size={13}
                          className={styles.agentHeadIcon}
                        />
                        {getToolMeta(group.agentId).label}
                      </span>
                      {group.rows.length === 0 ? (
                        <p className={styles.modelGroupEmpty}>
                          No model reporting from {getToolMeta(group.agentId).label} yet.
                          Coverage says why.
                        </p>
                      ) : (
                        <ul className={styles.modelList}>
                          {group.rows.map((m) => {
                            const unpriced = m.costUsd == null;
                            return (
                              <li key={`${m.agent}-${m.model}`} className={styles.modelRow}>
                                <span className={styles.modelName}>{formatModel(m.model)}</span>
                                <span className={styles.modelValue}>
                                  {unpriced
                                    ? `${formatTokens(m.tokensTotal)} tokens`
                                    : formatCost(m.costUsd, 2)}
                                </span>
                                <span className={styles.modelMeta}>
                                  {count(m.calls, 'call')}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ))
                ))}

              {panel === 'coverage' &&
                (coverageRows.length === 0 || matrix.agents.length === 0 ? (
                  <p className={styles.empty}>No agent rows in this window.</p>
                ) : (
                  <div
                    className={styles.table}
                    role="table"
                    aria-label="Reporting coverage by agent"
                    style={{ '--agent-cols': matrix.agents.length } as CSSProperties}
                  >
                    <div className={styles.headRow} role="row">
                      <span className={styles.metricHead} role="columnheader">
                        Reports
                      </span>
                      {matrix.agents.map((a) => (
                        <AgentHead key={a.id} id={a.id} label={a.label} />
                      ))}
                    </div>
                    {coverageRows.map((row, i) => (
                      <div
                        className={styles.row}
                        role="row"
                        key={row.id}
                        style={{ '--row-index': i } as CSSProperties}
                      >
                        <span
                          className={clsx(
                            styles.metricLabel,
                            cited.has(row.id) && styles.metricLabelCited,
                          )}
                          role="rowheader"
                          title={row.hint}
                        >
                          {row.label}
                        </span>
                        {row.cells.map((cell, ci) => (
                          <div
                            key={`${row.id}-${matrix.agents[ci]?.id ?? ci}`}
                            className={
                              cell.tone === 'can'
                                ? styles.cell
                                : cell.tone === 'partial'
                                  ? styles.cellPartial
                                  : styles.cellEmpty
                            }
                            role="cell"
                          >
                            {cell.text}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

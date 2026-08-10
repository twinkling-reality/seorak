import { useMemo } from 'react';

import { DetailView, type DetailTabDef } from '../../../components/DetailView/index.js';
import RangePills from '../../../components/RangePills/RangePills.jsx';
import { useAllowedRanges } from '../../../hooks/useOverview.js';
import { useTabs } from '../../../hooks/useTabs.js';
import type { OverviewSnapshot } from '../../../lib/apiSchemas.js';
import { fmtCount, formatCost } from '../../../lib/voice/index.js';

import { formatScope, type RangeDays } from '../overview-utils.js';
import { MISSING_DELTA, formatCountDelta, formatUsdDelta } from '../detailDelta.js';

import { editCallRollup } from './editTools.js';
import { SessionsPanel } from './panels/SessionsPanel.js';
import { EditsPanel } from './panels/EditsPanel.js';
import { LinesPanel } from './panels/LinesPanel.js';
import { CostPanel } from './panels/CostPanel.js';
import { ProjectsPanel } from './panels/ProjectsPanel.js';

/* UsageDetailView — volume + spend, bound to OverviewSnapshot.
 *
 * Tabs bind to real fields: Sessions (usage.totals + outcomes counts),
 * Edits (tools.byTool filtered to the edit family — an "edit" is an
 * edit-family tool call), Lines (usage.lines, the collector's on-machine
 * line-delta derivation; counts only), Cost (usage.cost, single honesty
 * gate), Projects (usage.projects).
 *
 * Tab deltas ride the worker's period-over-period legs ONLY (this window vs
 * the adjacent prior window — the one comparator every delta glyph means);
 * a tab without a prior-window aggregate renders MISSING_DELTA. That is the
 * intended honest behavior, not a bug. */

const BASE_USAGE_TABS = ['sessions', 'edits', 'lines', 'cost'] as const;
const USAGE_TABS = [...BASE_USAGE_TABS, 'projects'] as const;
type UsageTab = (typeof USAGE_TABS)[number];

function isUsageTab(value: string | null | undefined): value is UsageTab {
  return (USAGE_TABS as readonly string[]).includes(value ?? '');
}

interface Props {
  overview: OverviewSnapshot;
  initialTab?: string | null;
  onBack: () => void;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
  // Label for the back chevron. "Overview" on the cross-project surface,
  // "Project" when ProjectView mounts the same detail.
  backLabel?: string;
  /** Opening a repo from the Projects tab. When omitted, the Projects tab
   *  is not rendered (e.g. when this detail is already scoped to one repo). */
  onOpenProject?: (project: string) => void;
}

export default function UsageDetailView({
  overview,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
  backLabel = 'Overview',
  onOpenProject,
}: Props) {
  const ranges = useAllowedRanges();
  const hasProjectTab = onOpenProject != null;
  const { usage } = overview;

  const resolvedInitialTab: UsageTab = isUsageTab(initialTab)
    ? initialTab === 'projects' && !hasProjectTab
      ? 'sessions'
      : initialTab
    : 'sessions';
  const tabIds = hasProjectTab ? USAGE_TABS : BASE_USAGE_TABS;
  const tabControl = useTabs(tabIds as readonly UsageTab[], resolvedInitialTab);
  const { activeTab } = tabControl;

  const trends = usage.dailyTrends;
  const hasCost = usage.cost.sessionsWithCost > 0 && usage.cost.totalUsd != null;
  const editCalls = editCallRollup(overview);

  const vsPrior = `vs the prior ${rangeDays} days`;
  const tabs: Array<DetailTabDef<UsageTab>> = [
    {
      id: 'sessions',
      label: 'Sessions',
      value: fmtCount(usage.totals.sessions),
      // Real period-over-period session count from the event log (ADR-WS4/WS5):
      // both legs are distinct session.start counts over adjacent windows. '--'
      // when the prior window is unmeasured, never a half-window split standing
      // in for a true cross-window comparison.
      delta: formatCountDelta(usage.totals.sessionsDelta),
    },
    {
      id: 'edits',
      label: 'Edits',
      // Edit-family tool calls from the event log; '--' until in-window
      // tool.call rows exist (honest-empty, never a fabricated 0).
      value: editCalls.total > 0 ? fmtCount(editCalls.total) : '--',
      // rationale: no prior-window edits aggregate in the contract.
      delta: MISSING_DELTA,
    },
    {
      id: 'lines',
      // Added lines only, so the label says so rather than implying net lines.
      label: 'Lines added',
      // Added lines from the collector's on-machine derivation; '--' until
      // in-window rows carry it (older collectors don't emit the counts).
      value: usage.lines ? `+${fmtCount(usage.lines.added)}` : '--',
      delta:
        usage.lines?.delta && usage.lines.delta.previous != null
          ? {
              ...formatCountDelta({
                current: usage.lines.delta.current,
                previous: usage.lines.delta.previous,
              }),
              title: vsPrior,
            }
          : MISSING_DELTA,
    },
    {
      id: 'cost',
      label: 'Cost',
      value: hasCost ? formatCost(usage.cost.totalUsd, 2) : '--',
      delta:
        usage.cost.delta && usage.cost.delta.previous != null
          ? {
              ...formatUsdDelta(usage.cost.delta.current, usage.cost.delta.previous, 2),
              title: vsPrior,
            }
          : MISSING_DELTA,
    },
  ];
  if (hasProjectTab) {
    tabs.push({
      id: 'projects',
      label: 'Projects',
      value: fmtCount(usage.projects.length),
      // Categorical scope selector, not a period aggregate: the delta field is
      // omitted (a permanent placeholder would imply "not yet", not "never").
    });
  }

  const scopeSubtitle = useMemo(
    () => formatScope([{ count: usage.projects.length, singular: 'project' }]) || undefined,
    [usage.projects.length],
  );

  return (
    <DetailView
      backLabel={backLabel}
      onBack={onBack}
      title="usage"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={ranges} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="usage"
      tablistLabel="Usage sections"
    >
      {activeTab === 'sessions' && <SessionsPanel overview={overview} />}
      {activeTab === 'edits' && <EditsPanel overview={overview} />}
      {activeTab === 'lines' && <LinesPanel overview={overview} />}
      {activeTab === 'cost' && <CostPanel overview={overview} />}
      {activeTab === 'projects' && hasProjectTab && (
        <ProjectsPanel projects={usage.projects} onOpenProject={onOpenProject} />
      )}
    </DetailView>
  );
}

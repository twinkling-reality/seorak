import { useMemo } from 'react';

import { DetailView, type DetailTabDef } from '../../../components/DetailView/index.js';
import RangePills from '../../../components/RangePills/RangePills.jsx';
import { useAllowedRanges } from '../../../hooks/useOverview.js';
import { useTabs } from '../../../hooks/useTabs.js';
import type { OverviewSnapshot } from '../../../lib/apiSchemas.js';
import { fmtCount } from '../../../lib/voice/index.js';

import { formatScope, type RangeDays } from '../overview-utils.js';

import { ToolsPanel } from './panels/ToolsPanel.js';
import { ErrorsPanel } from './panels/ErrorsPanel.js';

/* ToolsDetailView — tool-call mix + errors (widget drill only).
 *
 * Cross-tool agent compare and per-model spend live on /dashboard/agents
 * (sidebar Agents). This drill keeps the in-session tool mix (Read/Edit/Bash)
 * and verification / error rate. */

const TOOLS_TABS = ['tools', 'errors'] as const;
type ToolsTab = (typeof TOOLS_TABS)[number];

function isToolsTab(value: string | null | undefined): value is ToolsTab {
  return (TOOLS_TABS as readonly string[]).includes(value ?? '');
}

interface Props {
  overview: OverviewSnapshot;
  initialTab?: string | null;
  onBack: () => void;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
  backLabel?: string;
}

export default function ToolsDetailView({
  overview,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
  backLabel = 'Overview',
}: Props) {
  const ranges = useAllowedRanges();
  const resolved: ToolsTab = isToolsTab(initialTab) ? initialTab : 'tools';
  const tabControl = useTabs(TOOLS_TABS, resolved);
  const { activeTab } = tabControl;

  const { byTool, callStats } = overview.tools;
  const distinctTools = useMemo(
    () => byTool.filter((t) => t.calls > 0).length,
    [byTool],
  );

  const tabs: Array<DetailTabDef<ToolsTab>> = [
    {
      id: 'tools',
      label: 'Tool calls',
      value: callStats.totalCalls > 0 ? fmtCount(callStats.totalCalls) : '--',
    },
    {
      id: 'errors',
      label: 'Error rate',
      value: callStats.errorRate != null ? `${Math.round(callStats.errorRate * 100)}%` : '--',
    },
  ];

  const scopeSubtitle = useMemo(
    () =>
      formatScope([
        { count: distinctTools, singular: 'tool' },
        { count: overview.usage.projects.length, singular: 'project' },
      ]) || undefined,
    [distinctTools, overview.usage.projects.length],
  );

  return (
    <DetailView
      backLabel={backLabel}
      onBack={onBack}
      title="tools"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={ranges} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="tools"
      tablistLabel="Tools sections"
    >
      {activeTab === 'tools' && <ToolsPanel overview={overview} />}
      {activeTab === 'errors' && <ErrorsPanel overview={overview} />}
    </DetailView>
  );
}

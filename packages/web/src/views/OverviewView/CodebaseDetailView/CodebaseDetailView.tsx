import { useMemo } from 'react';

import { DetailView, type DetailTabDef } from '../../../components/DetailView/index.js';
import RangePills from '../../../components/RangePills/RangePills.jsx';
import { useAllowedRanges } from '../../../hooks/useOverview.js';
import { useTabs } from '../../../hooks/useTabs.js';
import type { OverviewSnapshot } from '../../../lib/apiSchemas.js';
import { fmtCount } from '../../../lib/voice/index.js';

import { formatScope, type RangeDays } from '../overview-utils.js';

import { DirectoriesPanel } from './panels/DirectoriesPanel.js';
import { FilesPanel } from './panels/FilesPanel.js';
import { GitPanel } from './panels/GitPanel.js';

const CODEBASE_TABS = ['files', 'directories', 'git'] as const;
type CodebaseTab = (typeof CODEBASE_TABS)[number];

function isCodebaseTab(value: string | null | undefined): value is CodebaseTab {
  return (CODEBASE_TABS as readonly string[]).includes(value ?? '');
}

interface Props {
  overview: OverviewSnapshot;
  initialTab?: string | null;
  onBack: () => void;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
  backLabel?: string;
  /** When false (ProjectView), omit cross-repo concentration question. */
  showCrossRepo?: boolean;
}

export default function CodebaseDetailView({
  overview,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
  backLabel = 'Overview',
  showCrossRepo = true,
}: Props) {
  const ranges = useAllowedRanges();
  const resolved: CodebaseTab = isCodebaseTab(initialTab) ? initialTab : 'files';
  const tabControl = useTabs(CODEBASE_TABS, resolved);
  const { activeTab } = tabControl;

  const fileCount = overview.codebase.files.length;
  const dirCount = overview.codebase.directories.length;
  const gitCommits = overview.codebase.commitStats?.commits ?? 0;

  const tabs: Array<DetailTabDef<CodebaseTab>> = [
    {
      id: 'files',
      label: 'Files',
      value: fileCount > 0 ? fmtCount(fileCount) : '--',
    },
    {
      id: 'directories',
      label: 'Directories',
      value: dirCount > 0 ? fmtCount(dirCount) : '--',
    },
    {
      id: 'git',
      // Names the number, not the tool that produced it ("23 git" reads as nothing).
      label: 'Commits',
      value: gitCommits > 0 ? fmtCount(gitCommits) : '--',
    },
  ];

  const scopeSubtitle = useMemo(
    () => formatScope([{ count: overview.usage.projects.length, singular: 'project' }]) || undefined,
    [overview.usage.projects.length],
  );

  return (
    <DetailView
      backLabel={backLabel}
      onBack={onBack}
      title="codebase"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={ranges} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="codebase"
      tablistLabel="Codebase sections"
    >
      {activeTab === 'files' && <FilesPanel overview={overview} />}
      {activeTab === 'directories' && (
        <DirectoriesPanel overview={overview} showCrossRepo={showCrossRepo} />
      )}
      {activeTab === 'git' && <GitPanel overview={overview} />}
    </DetailView>
  );
}

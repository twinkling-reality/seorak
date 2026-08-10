import { useMemo } from 'react';

import { DetailView, type DetailTabDef } from '../../../components/DetailView/index.js';
import RangePills from '../../../components/RangePills/RangePills.jsx';
import { useAllowedRanges } from '../../../hooks/useOverview.js';
import { useTabs } from '../../../hooks/useTabs.js';
import { localizeHourBuckets } from '../../../lib/localTime.js';
import { DAY_LABELS } from '../../../widgets/utils.js';
import type { OverviewSnapshot } from '../../../lib/apiSchemas.js';

import { formatScope, type RangeDays } from '../overview-utils.js';

import { hourGlyph } from './format.js';
import { RhythmPanel } from './panels/RhythmPanel.js';

/* ActivityDetailView — WHEN sessions happen, bound to OverviewSnapshot.
 *
 *   rhythm  - the coding-rhythm heatmap (activity.hourlyDistribution),
 *             empty until sessions accrue across hours.
 *
 * Rhythm is the one real Activity cut. The work-mix and effective-hours tabs
 * were dropped: the contract carries no edit/file classification or
 * effectiveness grade, so their permanent locked "--" was a dead control, not
 * an honest empty. The rhythm value is a categorical peak cell, never
 * period-additive. */

const ACTIVITY_TABS = ['rhythm'] as const;
type ActivityTab = (typeof ACTIVITY_TABS)[number];

function isActivityTab(value: string | null | undefined): value is ActivityTab {
  return (ACTIVITY_TABS as readonly string[]).includes(value ?? '');
}

interface Props {
  overview: OverviewSnapshot;
  initialTab?: string | null;
  onBack: () => void;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
  backLabel?: string;
}

export default function ActivityDetailView({
  overview,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
  backLabel = 'Overview',
}: Props) {
  const ranges = useAllowedRanges();
  const resolved: ActivityTab = isActivityTab(initialTab) ? initialTab : 'rhythm';
  const tabControl = useTabs(ACTIVITY_TABS, resolved);
  const { activeTab } = tabControl;

  // Peak hour = the (dow, hour) bucket with the highest session count.
  // Drives the rhythm tab value; null (→ "--") when the distribution is
  // still empty (event log not yet landed).
  const peakCell = useMemo(() => {
    let best: { dow: number; hour: number; sessions: number } | null = null;
    // Localized to the viewer's timezone so "When · Mon 9p" matches the heatmap.
    for (const h of localizeHourBuckets(overview.activity.hourlyDistribution)) {
      if (h.sessions > 0 && (best === null || h.sessions > best.sessions)) {
        best = { dow: h.dow, hour: h.hour, sessions: h.sessions };
      }
    }
    return best;
  }, [overview.activity.hourlyDistribution]);

  const tabs: Array<DetailTabDef<ActivityTab>> = [
    {
      id: 'rhythm',
      label: 'When',
      value: peakCell ? `${DAY_LABELS[peakCell.dow]} ${hourGlyph(peakCell.hour)}` : '--',
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
      title="activity"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={ranges} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="activity"
      tablistLabel="Activity sections"
    >
      {activeTab === 'rhythm' && <RhythmPanel overview={overview} peakCell={peakCell} />}
    </DetailView>
  );
}

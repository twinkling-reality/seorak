import { useMemo } from 'react';

import { DetailView, type DetailTabDef } from '../../../components/DetailView/index.js';
import RangePills from '../../../components/RangePills/RangePills.jsx';
import { useAllowedRanges } from '../../../hooks/useOverview.js';
import { useTabs } from '../../../hooks/useTabs.js';
import type { Intervention, OverviewSnapshot } from '../../../lib/apiSchemas.js';
import { fmtCount } from '../../../lib/voice/index.js';
import type { DataStatus } from '../../../lib/stores/pollingTypes.js';

import { formatScope, type RangeDays } from '../overview-utils.js';

import { SessionsPanel } from './panels/SessionsPanel.js';
import { InterventionPanel } from './panels/InterventionPanel.js';

/* OutcomesDetailView — "how did the work end", bound to OverviewSnapshot.
 *
 * Seorak cannot measure whether work was "completed", so instead of a
 * completion rate it shows how sessions ended (coarse) — the six SessionEnd
 * lifecycle reasons, not completion — plus the stuckness signal — honest
 * end-of-work facts, not a judgment about success.
 *
 *   sessions  - end-reason distribution + stuckness (outcomes.endReasons,
 *               outcomes.stuckness). Renders empty until those land.
 *   watch     - the intervention surface. Shows the configured watch limits;
 *               real fired interventions once the worker returns them.
 *
 * Tab deltas are omitted: these outcome tabs are categorical or live state, not
 * period aggregates, so no delta pill is shown (a permanent placeholder would
 * imply "not yet" when the truth is "never"). */

const OUTCOMES_TABS = ['sessions', 'watch'] as const;
type OutcomesTab = (typeof OUTCOMES_TABS)[number];

function isOutcomesTab(value: string | null | undefined): value is OutcomesTab {
  return (OUTCOMES_TABS as readonly string[]).includes(value ?? '');
}

interface Props {
  overview: OverviewSnapshot;
  /** Real fired interventions from GET /interventions (honest-empty [] until the
   *  wedge engine fires). Threaded through to the watch panel. */
  fired?: Intervention[];
  firedStatus: DataStatus;
  initialTab?: string | null;
  onBack: () => void;
  rangeDays: RangeDays;
  onRangeChange: (next: RangeDays) => void;
  backLabel?: string;
}

export default function OutcomesDetailView({
  overview,
  fired = [],
  firedStatus,
  initialTab,
  onBack,
  rangeDays,
  onRangeChange,
  backLabel = 'Overview',
}: Props) {
  const ranges = useAllowedRanges();
  const resolved: OutcomesTab = isOutcomesTab(initialTab) ? initialTab : 'sessions';
  const tabControl = useTabs(OUTCOMES_TABS, resolved);
  const { activeTab } = tabControl;

  const { endedCount } = overview.outcomes;

  const tabs: Array<DetailTabDef<OutcomesTab>> = [
    {
      id: 'sessions',
      // Names what the number counts; the bare participle "Ended" read as "55 ended".
      label: 'Sessions ended',
      value: endedCount > 0 ? fmtCount(endedCount) : '--',
    },
    {
      id: 'watch',
      // The intervention tab. Shows the count of fired interventions the worker
      // surfaced this period ("--" when nothing has fired, honest, never a
      // fabricated 0). The engine fires today; this is the real count. The label
      // names that count -- "Watch" is the verb Settings uses for its alerts
      // section, and over a number it read as "4 watch".
      label: 'Interventions',
      value: fired.length > 0 ? fmtCount(fired.length) : '--',
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
      title="outcomes"
      subtitle={scopeSubtitle}
      actions={<RangePills value={rangeDays} onChange={onRangeChange} options={ranges} />}
      tabs={tabs}
      tabControl={tabControl}
      idPrefix="outcomes"
      tablistLabel="Outcomes sections"
    >
      {activeTab === 'sessions' && <SessionsPanel overview={overview} />}
      {activeTab === 'watch' && (
        <InterventionPanel
          overview={overview}
          fired={fired}
          firedStatus={firedStatus}
        />
      )}
    </DetailView>
  );
}

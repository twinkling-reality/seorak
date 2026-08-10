import { useMemo } from 'react';

import type { OverviewSnapshot } from '../../lib/apiSchemas.js';
import { compilePeriodClarity } from '../../periodClarity/compilePeriodClarity.js';
import { PeriodClarityReveal } from '../../components/PeriodClarityReveal/PeriodClarityReveal.js';

export default function LazyPeriodClarityReveal({
  overview,
  rangeDays,
  open,
  onOpenChange,
}: {
  overview: OverviewSnapshot;
  rangeDays: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const clarity = useMemo(
    () => compilePeriodClarity(overview, { days: rangeDays }),
    [overview, rangeDays],
  );

  return (
    <PeriodClarityReveal
      clarity={clarity}
      open={open}
      onOpenChange={onOpenChange}
      showTrigger={false}
    />
  );
}

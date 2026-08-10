import { useMemo } from 'react';

import { PeriodClarityReveal } from '../../components/PeriodClarityReveal/PeriodClarityReveal.js';
import { compileReplayClarity, type ReplayClarityContext } from './replayClarity.js';
import type { ReplayScopeSummary } from './replayReviewModel.js';

/** Replay's Summary read — the same reveal Overview opens, compiled from replay scope. */
export default function LazyReplayClarityReveal({
  scope,
  context,
  open,
  onOpenChange,
}: {
  scope: ReplayScopeSummary;
  context: ReplayClarityContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const clarity = useMemo(() => compileReplayClarity(scope, context), [scope, context]);

  return (
    <PeriodClarityReveal
      clarity={clarity}
      open={open}
      onOpenChange={onOpenChange}
      showTrigger={false}
    />
  );
}

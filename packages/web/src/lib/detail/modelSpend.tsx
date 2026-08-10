import type { ModelRollup } from '@seorak/types';

import {
  Metric,
  distributionQuestion,
  type FocusedQuestion,
} from '../../components/DetailView/index.js';
import { formatCost, formatTokens } from '../../widgets/utils.js';
import { formatModel } from '../modelMeta.js';
import { formatModelLong } from '../voice/index.js';

/**
 * The single source of truth for the "Where does spend go by model?"
 * question. It appears on both the Usage -> Cost tab and the Tools -> Models
 * tab; before this builder the logic + copy were copy-pasted in both panels
 * (they drifted apart on nothing but the URL id). Each tab now keeps its own
 * deep-link id and calls this.
 *
 * Honesty: `tools.byModel[].costUsd` is null (never 0) for an unpriced model.
 * When ANY model is unpriced we rank + break down by TOKEN share for every
 * row (so an unpriced model is never silently dropped to $0) and the answer
 * says so.
 *
 * Returns null when there is nothing honest to show (no models, or a
 * degenerate zero total) so the caller can fall through to its next question
 * or empty state.
 */
export function modelSpendQuestion(byModel: ModelRollup[], id: string): FocusedQuestion | null {
  if (byModel.length === 0) return null;

  const allPriced = byModel.every((m) => m.costUsd != null);
  const models = [...byModel].sort((a, b) =>
    allPriced ? (b.costUsd ?? 0) - (a.costUsd ?? 0) : b.tokensTotal - a.tokensTotal,
  );
  const metricTotal = models.reduce(
    (sum, m) => sum + (allPriced ? (m.costUsd ?? 0) : m.tokensTotal),
    0,
  );
  if (metricTotal <= 0) return null;

  const top = models[0];
  const topShare = Math.round(
    ((allPriced ? (top.costUsd ?? 0) : top.tokensTotal) / metricTotal) * 100,
  );

  return distributionQuestion({
    id,
    question: 'Where does spend go by model?',
    answer: (
      <>
        <Metric>{formatModelLong(top.model)}</Metric> leads{' '}
        {allPriced ? 'your spend' : 'your token use'} at <Metric>{topShare}%</Metric>
        {allPriced ? '.' : ' (some models are unpriced, so this shows token share).'}
      </>
    ),
    items: models.map((m) => ({
      key: m.model,
      label: formatModel(m.model),
      fillPct: ((allPriced ? (m.costUsd ?? 0) : m.tokensTotal) / metricTotal) * 100,
      fillColor: 'var(--ink)',
      value: m.costUsd != null ? formatCost(m.costUsd, 2) : `${formatTokens(m.tokensTotal)} tok`,
    })),
  });
}

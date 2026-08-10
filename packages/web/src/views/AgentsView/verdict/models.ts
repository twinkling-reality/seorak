/**
 * The verdict's trailing models sentence and the Models note behind it. Separate from
 * the rest of the prose because it is the only sentence whose UNIT changes with the
 * data: tokens when anything is unpriced, "measured spend" when a whole agent has no
 * dollar path, spend only when every leg is priced.
 */
import type { AgentModelRollup, ModelRollup } from '../../../lib/apiSchemas.js';
import { formatModel } from '../../../lib/modelMeta.js';
import { getToolMeta } from '../../../lib/toolMeta.js';
import { count, formatCost, formatTokens } from '../../../lib/voice/index.js';

import { mark, note, t, type AgentsNarrativeSegment, type AgentsNote } from './notes.js';

const MODELS_CAP = 3;

/** The majority model per agent, by tokens (the one metric every model-carrying
 *  row reports). null when the agent has no model rows or no majority. */
export function majorityModelByAgent(
  agentModels: AgentModelRollup[],
): Map<string, { model: string; share: number; tokensTotal: number }> {
  const byAgent = new Map<string, AgentModelRollup[]>();
  for (const m of agentModels) {
    if (m.tokensTotal <= 0) continue;
    const arr = byAgent.get(m.agent) ?? [];
    arr.push(m);
    byAgent.set(m.agent, arr);
  }
  const out = new Map<string, { model: string; share: number; tokensTotal: number }>();
  for (const [agent, rows] of byAgent) {
    const total = rows.reduce((s, m) => s + m.tokensTotal, 0);
    if (total <= 0) continue;
    const top = rows.reduce((m, x) => (x.tokensTotal > m.tokensTotal ? x : m));
    const share = top.tokensTotal / total;
    if (share >= 0.5) out.set(agent, { model: top.model, share, tokensTotal: top.tokensTotal });
  }
  return out;
}

/**
 * Trailing models sentence + note. When BOTH tools report models and each has a
 * majority model of its own, speak the pairing ("You run X on A and Y on B") —
 * the per-agent stack, from measured token shares. Otherwise fall back to the
 * window-wide share sentence. Honest either way: when any model is unpriced the
 * split is by tokens (never a stand-in $0); when a whole agent's cost is
 * unmeasured the sentence says "measured spend", not "spend"; no rows or no
 * measured metric means no sentence at all.
 */
export function buildModelsSentence(
  byModel: ModelRollup[],
  anyAgentUnpriced: boolean,
  agentModels: AgentModelRollup[],
  agentOrder: string[],
): { segments: AgentsNarrativeSegment[]; note: AgentsNote } | null {
  const majority = majorityModelByAgent(agentModels);
  const paired = agentOrder.filter((a) => majority.has(a));
  if (paired.length >= 2) {
    const [first, second] = paired;
    const a = majority.get(first)!;
    const b = majority.get(second)!;
    if (a.model !== b.model) {
      const pairNote: AgentsNote = {
        id: 'models',
        section: 'models',
        label: 'Models behind each tool',
        detail:
          'Each tool\'s majority model by measured tokens this window. Spend stays per-model below; an unpriced model is never a stand-in $0.',
        citations: paired.map((agent) => {
          const top = majority.get(agent)!;
          return `${getToolMeta(agent).label} ran ${Math.round(top.share * 100)}% of its tokens through ${formatModel(top.model)}`;
        }),
      };
      return {
        segments: [
          t(' You run '),
          mark(first),
          t(' on '),
          note('models', formatModel(a.model)),
          t(' and '),
          mark(second),
          t(` on ${formatModel(b.model)}.`),
        ],
        note: pairNote,
      };
    }
  }

  const anyUnpriced = byModel.some((m) => m.costUsd == null);
  const metric = (m: ModelRollup) => (anyUnpriced ? m.tokensTotal : (m.costUsd ?? 0));
  const ranked = byModel.filter((m) => metric(m) > 0).sort((a, b) => metric(b) - metric(a));
  const total = ranked.reduce((s, m) => s + metric(m), 0);
  if (ranked.length === 0 || total <= 0) return null;

  const top = ranked[0];
  const share = metric(top) / total;
  const unit = anyUnpriced ? 'tokens' : anyAgentUnpriced ? 'measured spend' : 'spend';
  const citations = ranked
    .slice(0, MODELS_CAP)
    .map((m) =>
      anyUnpriced
        ? `${formatModel(m.model)} used ${formatTokens(m.tokensTotal)} tokens across ${count(m.calls, 'call')}`
        : `${formatModel(m.model)} cost ${formatCost(m.costUsd, 2)} across ${count(m.calls, 'call')}`,
    );
  if (ranked.length > MODELS_CAP) {
    citations.push(`plus ${count(ranked.length - MODELS_CAP, 'more model')}`);
  }

  const modelsNote: AgentsNote = {
    id: 'models',
    section: 'models',
    label: 'Models behind the work',
    detail: anyUnpriced
      ? 'Some models in this window carried no priced tokens, so the split is by tokens instead of a stand-in $0.'
      : 'Cost is derived from each model\'s priced tokens in this window.',
    citations,
  };
  const term = note('models', formatModel(top.model));
  const segments =
    share >= 0.5
      ? [t(` Most of the window's ${unit} ran through `), term, t('.')]
      : [t(' '), term, t(` took the largest single share of the window's ${unit}.`)];
  return { segments, note: modelsNote };
}

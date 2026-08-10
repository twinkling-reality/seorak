import type { DeveloperModelSnapshot } from '@seorak/types';

import type { ModelInsight, ModelNarrativeSegment } from '../modelPresentationTypes.js';
import { PORTRAIT_PRODUCERS } from './registry.js';
import type {
  PortraitContext,
  PortraitParagraph,
  PortraitProducer,
  PortraitSentence,
} from './types.js';

export interface AssembledPortrait {
  /** Paragraph-separated segment stream, ready for the identity lead. */
  prose: ModelNarrativeSegment[];
  insights: ModelInsight[];
}

const PARAGRAPH_ORDER: readonly PortraitParagraph[] = ['identity', 'payoff'];

/**
 * How many sentences each paragraph may SPEAK.
 *
 * Every producer that could fire used to fire, so a rich window printed one
 * sentence per projection in a fixed order — complete, and a checklist. Read
 * back on real data it was six sentences the developer already knew about
 * themselves: what language they write, that they close the chat when they
 * finish. A portrait that only tells you what you already know is a receipt.
 *
 * The cut is what makes the page selective. Everything the read SPEAKS is still
 * fully checkable in its card; what changes is that being measurable no longer
 * entitles a projection to a sentence.
 */
const PARAGRAPH_LIMIT: Record<PortraitParagraph, number> = {
  identity: 3,
  payoff: 2,
};

interface Candidate {
  order: number;
  score: number;
  sentence: PortraitSentence;
}

/**
 * Run the producers, rank what they said, and join the survivors.
 *
 * The assembler owns exactly three things: WHICH sentences are worth the page,
 * which one opens a paragraph (so the opener can read as an opener), and the
 * blank line between paragraphs. It never edits inside a sentence. That is the
 * invariant that makes a new facet safe to add — the failure the old compiler
 * kept hitting was connective text being chosen by code that could not see the
 * clause it was joining to.
 *
 * Ranking is `weight × notability`, and the survivors are put BACK into registry
 * order before they are joined. Order is still the editorial decision and still
 * lives in the registry; ranking only decides who gets to be in the room, never
 * what the paragraph sounds like.
 */
export function assemblePortrait(
  snapshot: DeveloperModelSnapshot,
  ctx: PortraitContext,
  producers: readonly PortraitProducer[] = PORTRAIT_PRODUCERS,
): AssembledPortrait {
  const byParagraph = new Map<PortraitParagraph, Candidate[]>();

  producers.forEach((producer, order) => {
    const sentence = producer.produce(snapshot, ctx);
    if (!sentence) return;
    const list = byParagraph.get(producer.paragraph) ?? [];
    list.push({
      order,
      score: producer.weight * (sentence.notability ?? 0.5),
      sentence,
    });
    byParagraph.set(producer.paragraph, list);
  });

  const prose: ModelNarrativeSegment[] = [];
  const insights: ModelInsight[] = [];

  for (const paragraph of PARAGRAPH_ORDER) {
    const candidates = byParagraph.get(paragraph);
    if (!candidates || candidates.length === 0) continue;

    const kept = [...candidates]
      // Ties break by registry order, so the same window always reads the same.
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, PARAGRAPH_LIMIT[paragraph])
      .sort((a, b) => a.order - b.order);

    const segments: ModelNarrativeSegment[] = [];
    kept.forEach(({ sentence }, index) => {
      const opens = index === 0;
      const chosen = opens && sentence.leadSegments ? sentence.leadSegments : sentence.segments;
      segments.push(...chosen);
      // A dropped sentence takes its insights with it. An insight with no term in
      // the prose renders nothing at all, so keeping it would leave a card nobody
      // could open and inflate the count `portraitIsThin` gates the forming
      // fallback on.
      insights.push(...sentence.insights);
    });

    if (segments.length === 0) continue;
    if (prose.length > 0) prose.push({ type: 'text', text: '\n\n' });
    prose.push(...segments);
  }

  return { prose, insights };
}

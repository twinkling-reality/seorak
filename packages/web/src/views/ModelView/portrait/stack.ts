import type { DeveloperModelSnapshot } from '@seorak/types';

import { formatModelLong } from '../../../lib/modelMeta.js';
import type { ModelInsight } from '../modelPresentationTypes.js';
import { boundary, count, otherThings, rateOf, remainderText, runnersUp } from './evidence.js';
import { bestConcentration, isMajority, languageDisplayName } from './format.js';
import type { PortraitProducer, PortraitSentence } from './types.js';

/** Below this the model split is a handful of calls, not a choice. */
const MODEL_MIN_CALLS = 20;
/** And the leading model has to hold an outright majority to be named alone —
 *  "on Claude Opus" is a claim about where the work ran, not about where a
 *  plurality of it ran. */
const MODEL_SHARE = 0.5;
/**
 * The same floor for the language half of this sentence, which had none at all.
 *
 * `languageInsight` spoke as soon as one entry existed, so a developer who spent
 * the month in TypeScript and opened one `.rs` file was told "You worked mostly
 * in Rust" — and the card agreed with it at "100%, 1 of 1 edit calls". The model
 * half of the SAME sentence has carried a 20-call floor since it shipped; the
 * asymmetry was an oversight, not a decision (nothing in the doc comment below
 * defends it). Twenty edit calls is a fraction of one real session, so this costs
 * nothing on a live window and closes the first-run case.
 */
const LANGUAGE_MIN_CALLS = 20;

/** The leading language's share of edit calls, or null when nothing was measured. */
function languageShare(snapshot: DeveloperModelSnapshot): number | null {
  const mix = snapshot.identity?.fileLanguageMix ?? [];
  const ranked = [...mix].filter((l) => l.calls > 0).sort((a, b) => b.calls - a.calls);
  const total = ranked.reduce((sum, l) => sum + l.calls, 0);
  if (!ranked[0] || total === 0) return null;
  return ranked[0].calls / total;
}

function languageInsight(snapshot: DeveloperModelSnapshot): ModelInsight | null {
  const mix = snapshot.identity?.fileLanguageMix ?? [];
  const ranked = [...mix].filter((l) => l.calls > 0).sort((a, b) => b.calls - a.calls);
  const top = ranked[0];
  if (!top) return null;

  const total = ranked.reduce((sum, l) => sum + l.calls, 0);
  if (total < LANGUAGE_MIN_CALLS) return null;
  const name = languageDisplayName(top.language);
  const share = total > 0 ? top.calls / total : null;
  const others = ranked.slice(1);

  return {
    id: 'stack',
    facet: 'stack',
    linkedTerm: name,
    label: 'Which languages',
    hoverLines: [`${count(top.calls)} of ${count(total)} edit calls were ${name}.`],
    squircle: {
      // Was "You spent most of your edits in {name}", which the sentence above it
      // deliberately hedges to "most OFTEN in" whenever the leader is not a
      // majority — so the card contradicted the read at every share under 50%,
      // and did it on the one screen that exists to check the read.
      detail: remainderText({
        numerator: top.calls,
        denominator: total,
        unit: 'edit calls',
        rest: `were spread across ${otherThings(others.length, 'file kind')}`,
        whole: 'No other file kind Seorak recognizes was edited in this window.',
      }),
      citations: [
        {
          text:
            share !== null
              ? `${rateOf(share, top.calls, total, 'edit calls')} were ${name}`
              : `${name} led your edit calls`,
          field: 'identity.fileLanguageMix',
        },
        ...runnersUp(
          others,
          (l) => languageDisplayName(l.language),
          (l) => l.calls,
          'identity.fileLanguageMix',
          'calls',
        ),
        // Two boundaries, not one 182-character sentence with three clauses in it.
        // They are separate facts — what was counted, and what was left out — and
        // joined they were the longest line in the portrait and the least likely
        // to be read.
        boundary(
          'Counted from edit CALLS against each file kind, not from files changed or lines written',
          'identity.fileLanguageMix',
        ),
        boundary(
          'Only file kinds Seorak recognizes are counted, so edits to anything else are outside this number',
          'identity.fileLanguageMix',
        ),
      ],
    },
  };
}

function modelInsight(snapshot: DeveloperModelSnapshot): ModelInsight | null {
  const ranked = [...snapshot.tools.byModel]
    .filter((m) => m.calls > 0)
    .sort((a, b) => b.calls - a.calls);
  const top = ranked[0];
  if (!top) return null;

  const total = ranked.reduce((sum, m) => sum + m.calls, 0);
  if (total < MODEL_MIN_CALLS || top.calls <= total * MODEL_SHARE) return null;

  const name = formatModelLong(top.model);
  const others = ranked.slice(1);

  return {
    id: 'model-mix',
    facet: 'stack',
    linkedTerm: name,
    label: 'Which model',
    hoverLines: [`${count(top.calls)} of ${count(total)} model calls ran on ${name}.`],
    squircle: {
      // Was "The model most of your work ran on" — the header and the pulled term
      // in a noun phrase, with no verb and nothing measured.
      detail: remainderText({
        numerator: top.calls,
        denominator: total,
        unit: 'model calls',
        rest: `were spread across ${otherThings(others.length, 'model')}`,
        whole: 'No other model ran a call in this window.',
      }),
      citations: [
        {
          text: `${rateOf(top.calls / total, top.calls, total, 'model calls')} were ${name}`,
          field: 'tools.byModel',
        },
        ...runnersUp(
          others,
          (m) => formatModelLong(m.model),
          (m) => m.calls,
          'tools.byModel',
          'calls',
        ),
        // Calls, not cost. Which model you reach for is identity; what it cost is
        // period clarity, and Overview already answers that without a portrait
        // around it. That was a code comment and nothing else — this card was the
        // only one in the portrait with no boundary at all, so a reader had no way
        // to know whether "82%" was calls, tokens or spend.
        boundary(
          'Counted by call, not by tokens or by what the calls cost',
          'tools.byModel',
        ),
      ],
    },
  };
}

/**
 * Stack — what you touched, from the language mix of edit calls and the model the
 * work ran on.
 *
 * Edit calls, not files changed and not lines: the worker counts the calls an
 * agent made against each language because that is what the tool rollups measure.
 * The card says "edit calls" for the same reason, so the number a reader checks
 * is the number that was counted.
 *
 * `tools.byModel` shipped on every read and rendered nowhere before this. It sits
 * in the same sentence as the language rather than getting one of its own,
 * because "TypeScript, on Claude Sonnet" is one answer to what you worked with
 * and two sentences would have made the portrait a list.
 */
export const stackProducer: PortraitProducer = {
  id: 'stack',
  paragraph: 'identity',
  // The most "of course I do" facet in the portrait. A developer knows what
  // language they write; it earns its place only when the mix is unusual.
  weight: 0.45,
  produce(snapshot: DeveloperModelSnapshot): PortraitSentence | null {
    const language = languageInsight(snapshot);
    const model = modelInsight(snapshot);
    if (!language && !model) return null;

    // "mostly" only when it IS most of the edit calls; a leading language that is
    // a third of them is what you reached for most often, not what you mostly did.
    const lead = isMajority(languageShare(snapshot))
      ? 'You worked mostly in '
      : 'You worked most often in ';

    // A polyglot window is worth reading; "you wrote TypeScript again" is not.
    //
    // Both halves, and only the halves this window measured: a model-only sentence
    // used to score the neutral 0.5 off a null language share rather than off the
    // model split it is actually about.
    const models = snapshot.tools.byModel.filter((m) => m.calls > 0);
    const modelCalls = models.reduce((sum, m) => sum + m.calls, 0);
    const modelLead = models.reduce((best, m) => Math.max(best, m.calls), 0);
    const notability = bestConcentration([
      {
        share: languageShare(snapshot),
        categories: (snapshot.identity?.fileLanguageMix ?? []).filter((l) => l.calls > 0).length,
      },
      { share: modelCalls > 0 ? modelLead / modelCalls : null, categories: models.length },
    ]);

    if (language && model) {
      return {
        notability,
        insights: [language, model],
        segments: [
          { type: 'text', text: lead },
          { type: 'insight', insightId: language.id },
          { type: 'text', text: ', with ' },
          { type: 'insight', insightId: model.id },
          { type: 'text', text: '. ' },
        ],
      };
    }

    if (language) {
      return {
        notability,
        insights: [language],
        segments: [
          { type: 'text', text: lead },
          { type: 'insight', insightId: language.id },
          { type: 'text', text: '. ' },
        ],
      };
    }

    return {
      notability,
      insights: [model!],
      segments: [
        { type: 'text', text: 'Most of it ran on ' },
        { type: 'insight', insightId: model!.id },
        { type: 'text', text: '. ' },
      ],
      // "Most of IT" needs a preceding sentence to have named the work. With no
      // language mix, no rhythm and no focus, this producer opens the paragraph
      // and the entire portrait was "Hey, most of it ran on Claude Opus 5."
      leadSegments: [
        { type: 'text', text: 'Lately most of your work has run on ' },
        { type: 'insight', insightId: model!.id },
        { type: 'text', text: '. ' },
      ],
    };
  },
};

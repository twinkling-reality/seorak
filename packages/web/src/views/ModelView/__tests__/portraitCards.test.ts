/**
 * The card is the claim's receipt, and these are the properties a receipt has to
 * hold no matter which window produced it.
 *
 * `portraitReadability.test.ts` next door checks the PROSE — grammar, pronouns,
 * jargon, no digits in the read. Nothing checked the cards, and that is where the
 * owner found two defects in an hour by hovering: a body asserting "most" over a
 * number that was not most, and a bar that encoded nothing. Both were invisible
 * in the producer source, because the producer source is a module that already
 * knows what the number means. A rule that reads only the RENDERED card cannot
 * make that mistake.
 *
 * Every rule below is one defect class, and each is stated against the card's own
 * arithmetic rather than against a word list — a card may say "most" whenever it
 * has counted a majority, and never when it has not.
 */
import { describe, expect, it } from 'vitest';

import { compileSnapshotToPresentation } from '../compileSnapshotToPresentation.js';
import type { ModelInsight, ModelPresentation } from '../modelPresentationTypes.js';
import { VALUE_CASES, structuralMatrix } from '../../../../scripts/portraitMatrix.js';

interface Rendered {
  label: string;
  presentation: ModelPresentation;
}

function everyPortrait(): Rendered[] {
  const out: Rendered[] = structuralMatrix().map(({ label, snapshot }) => ({
    label,
    presentation: compileSnapshotToPresentation(snapshot, {
      displayName: 'Glendon',
      offsetMinutes: 0,
      priorOffsetMinutes: 0,
    }),
  }));
  for (const c of VALUE_CASES) {
    out.push({
      label: `value:${c.label}`,
      presentation: compileSnapshotToPresentation(c.snapshot, {
        displayName: 'Glendon',
        offsetMinutes: c.offsetMinutes ?? 0,
        priorOffsetMinutes: c.priorOffsetMinutes ?? c.offsetMinutes ?? 0,
      }),
    });
  }
  return out;
}

const PORTRAITS = everyPortrait();

function everyCard(): Array<{ label: string; insight: ModelInsight }> {
  return PORTRAITS.flatMap(({ label, presentation }) =>
    presentation.insights.map((insight) => ({ label, insight })),
  );
}

const CARDS = everyCard();

/** "1,204 of 3,900" → the fraction the card states about itself. Rates are
 *  written `41%, 1,204 of 3,900 …` so the counts are always there to find. */
function statedRatio(text: string): { n: number; d: number } | null {
  const m = /(\d[\d,]*)\s+of\s+(\d[\d,]*)/.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  const d = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return { n, d };
}

/** The ratio the card leads with — its first citation, or its peek when the
 *  first citation is a definition rather than a count. */
function leadRatio(insight: ModelInsight): { n: number; d: number } | null {
  for (const c of insight.squircle.citations) {
    const r = statedRatio(c.text);
    if (r) return r;
  }
  for (const line of insight.hoverLines) {
    const r = statedRatio(line);
    if (r) return r;
  }
  return null;
}

/** Card pairs that measure the same thing about different subjects, and so may
 *  share a header. Listed rather than inferred, so adding one is a decision. */
const SYMMETRIC = new Set(['second-project+top-project']);

describe('annotation card evidence', () => {
  it('renders a card for every insight in every portrait', () => {
    expect(CARDS.length).toBeGreaterThan(0);
  });

  it('never claims a majority the card has not counted', () => {
    // The defect: `dominantDaypart` clears at a 40% SHARE, and the body under it
    // read "You start most of your sessions in the afternoon" over 11 of 25. The
    // read's own prose already routes its adverbs through `format.isMajority`;
    // the cards did not, so the sentence hedged and the evidence overclaimed.
    const bad: string[] = [];
    for (const { label, insight } of CARDS) {
      const body = insight.squircle.detail ?? '';
      const ratio = leadRatio(insight);
      if (!ratio) continue;
      const share = ratio.n / ratio.d;
      if (/\b(most|mostly|majority|nearly all|almost all)\b/i.test(body) && share <= 0.5) {
        bad.push(`${label}: ${insight.id} body "${body}" over ${ratio.n} of ${ratio.d}`);
      }
      if (/\b(all of|every|each of)\b/i.test(body) && ratio.n < ratio.d) {
        bad.push(`${label}: ${insight.id} body claims totality over ${ratio.n} of ${ratio.d}`);
      }
      if (/\bhalf\b/i.test(body) && (share < 0.4 || share > 0.6)) {
        bad.push(`${label}: ${insight.id} body says "half" over ${ratio.n} of ${ratio.d}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never claims a majority in a peek the card has not counted', () => {
    const bad: string[] = [];
    for (const { label, insight } of CARDS) {
      for (const peek of insight.hoverLines) {
        const ratio = statedRatio(peek);
        if (!ratio) continue;
        if (/\b(most|mostly|majority)\b/i.test(peek) && ratio.n / ratio.d <= 0.5) {
          bad.push(`${label}: ${insight.id} peek "${peek}"`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('gives every card a peek and a body', () => {
    // A hover that puts a card-shaped surface on screen with a connector pointing
    // at it and nothing inside reads as broken, not as restraint. So does a pinned
    // card that opens straight into a bullet list.
    const bad: string[] = [];
    for (const { label, insight } of CARDS) {
      if (insight.hoverLines.length === 0) bad.push(`${label}: ${insight.id} has no peek`);
      if (!insight.squircle.detail) bad.push(`${label}: ${insight.id} has no body`);
      if (insight.squircle.citations.length === 0) bad.push(`${label}: ${insight.id} has no citation`);
    }
    expect(bad).toEqual([]);
  });

  it('never says the same thing twice on one card', () => {
    const norm = (t: string) => t.replace(/\s+/g, ' ').replace(/[.,]/g, '').trim().toLowerCase();
    const bad: string[] = [];
    for (const { label, insight } of CARDS) {
      const body = insight.squircle.detail ?? '';
      if (!body) continue;
      for (const peek of insight.hoverLines) {
        if (norm(body) === norm(peek)) bad.push(`${label}: ${insight.id} body is its peek: "${body}"`);
      }
      for (const cite of insight.squircle.citations) {
        if (norm(body) === norm(cite.text)) {
          bad.push(`${label}: ${insight.id} body is a citation: "${body}"`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('derives the body from the window rather than asserting it', () => {
    // THE rule this file exists for.
    //
    // The body is the only line on a pinned card that is not a citation, and every
    // one of them was a fixed string chosen by the producer's author. Fixed
    // strings fail in exactly two ways and both shipped: they restate the sentence
    // the reader just clicked ("Your week leans on a couple of days" under
    // «Tuesdays and Wednesdays»), or they assert an adverb the gate never measured
    // ("Most of your sessions ran here" over a 30% leader). The majority rules
    // above catch the second kind and are blind to the first.
    //
    // What catches both is asking whether the line is a MEASUREMENT: when the card
    // has counted something, its body has to carry a number of its own. Every one
    // of the eleven editorial bodies fails that and every derived one passes it,
    // and unlike a word-overlap score it has no threshold to argue about.
    //
    // Two exemptions, both principled. A card whose leader took the whole window
    // has no remainder to state, so its body is a negative fact with no number in
    // it. And the forming ghost cards measure nothing at all — they exist to name
    // the facets a first-run reader has yet to fill, and a number on one of them
    // would be the zero-fill the honesty rules forbid.
    const bad: string[] = [];
    for (const { label, insight } of CARDS) {
      if (insight.id.startsWith('forming-')) continue;
      const body = insight.squircle.detail ?? '';
      const ratio = leadRatio(insight);
      if (!ratio || ratio.n >= ratio.d) continue;
      if (!/\d/.test(body) && !/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(body)) {
        bad.push(`${label}: ${insight.id} body states no number over ${ratio.n} of ${ratio.d}: "${body}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never repeats a peek line verbatim as its first receipt', () => {
    // Peek and pin are two TIERS. When the first citation is the peek with the
    // full stop removed, pinning has added nothing at the top of the card and the
    // reader has to scan past a line they already read to reach new evidence.
    const norm = (t: string) => t.replace(/[.,]/g, '').trim().toLowerCase();
    const bad: string[] = [];
    for (const { label, insight } of CARDS) {
      for (const peek of insight.hoverLines) {
        for (const cite of insight.squircle.citations) {
          if (norm(peek) === norm(cite.text)) {
            bad.push(`${label}: ${insight.id} peek is citation: "${peek}"`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('binds every visual element to a number the card states', () => {
    // The bar renders only when BOTH `projectKey` and `share` are set, so a card
    // carrying a project hue and no share is the one focus card in the portrait
    // with no bar — an inconsistency a reader sees as a missing measurement. And
    // a bar filled to something other than what the card says is the defect the
    // owner already fixed once, in the other direction.
    const bad: string[] = [];
    for (const { label, insight } of CARDS) {
      const { projectKey, share } = insight.squircle;
      if (projectKey && share === undefined) {
        bad.push(`${label}: ${insight.id} has a project hue and no bar`);
      }
      if (share !== undefined && !projectKey) {
        bad.push(`${label}: ${insight.id} sets a share the renderer cannot draw`);
      }
      if (share !== undefined) {
        const ratio = leadRatio(insight);
        if (ratio && Math.abs(ratio.n / ratio.d - share) > 0.01) {
          bad.push(
            `${label}: ${insight.id} bar at ${(share * 100).toFixed(1)}% over a stated ${((ratio.n / ratio.d) * 100).toFixed(1)}%`,
          );
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps a runner-up line readable however long the tail is', () => {
    // `runnersUp` had no cap, so a developer with eleven active repos got a single
    // citation naming ten of them with their counts, 216 characters wide, in a
    // 340px margin card. A list that long is not evidence a person checks.
    const bad: string[] = [];
    for (const { label, insight } of CARDS) {
      for (const cite of insight.squircle.citations) {
        if (!cite.text.startsWith('Then ')) continue;
        if (cite.text.length > 150) {
          bad.push(`${label}: ${insight.id} runner-up line is ${cite.text.length} chars`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('never leaves a count reading as a plural of one', () => {
    const bad: string[] = [];
    for (const { label, insight } of CARDS) {
      const lines = [
        ...insight.hoverLines,
        insight.squircle.detail ?? '',
        ...insight.squircle.citations.map((c) => c.text),
      ];
      for (const line of lines) {
        if (/\b1\s+(sessions|starts|calls|runs|lines|commits|repos|days|checks)\b/.test(line)) {
          bad.push(`${label}: ${insight.id} "${line}"`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('gives each card open at the same time a header of its own', () => {
    // Headers were the facet name, so four cards in one read were all titled "How
    // you work" and two payoff cards that measure different things were both
    // "Whether it landed" — including the one about a session that has not ended,
    // which is not about landing at all. The hue already carries the facet; the
    // header is the only place the card can say what it measured.
    const bad: string[] = [];
    for (const { label, presentation } of PORTRAITS) {
      const seen = new Map<string, string[]>();
      for (const insight of presentation.insights) {
        const list = seen.get(insight.label) ?? [];
        list.push(insight.id);
        seen.set(insight.label, list);
      }
      for (const [header, ids] of seen) {
        if (ids.length <= 1) continue;
        // The tied-focus pair is the one legitimate collision: two cards, the same
        // measurement, two different projects. They are told apart by the coloured
        // project squircle in the header and by the term the reader pulled, and
        // giving one of them a different title would imply a different measurement.
        if (ids.length === 2 && SYMMETRIC.has(ids.slice().sort().join('+'))) continue;
        bad.push(`${label}: ${ids.join(' + ')} all titled "${header}"`);
      }
    }
    expect(bad).toEqual([]);
  });
});

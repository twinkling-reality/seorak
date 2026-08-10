/**
 * The read has to be readable, and "readable" here is four properties a machine
 * can actually check. This compiles the portrait over EVERY combination of which
 * producers fire — each one is independently silent, so the paragraph is an
 * emergent join and the defects live in the joins, not in any one producer.
 *
 * What it does NOT do is lint prose style. An earlier draft of this guard banned
 * "window" and demanded a finite verb in every hover line, which would have failed
 * shipped, correct copy and pressured producers to replace calibrated hedges
 * ("most often") with stronger claims. The four rules below are each traceable to
 * a defect that reached a reader.
 */
import { describe, expect, it } from 'vitest';

import { compileSnapshotToPresentation } from '../compileSnapshotToPresentation.js';
import type { ModelNarrativeSegment, ModelPresentation } from '../modelPresentationTypes.js';
// The matrix lives beside the harness that prints it (`scripts/portrait-cards.ts`).
// One definition, two readers: a guard that fails a build and a dump a person can
// read. They drifted apart the moment there were two copies, and the copy the
// human read was the one that did not gate anything.
import { LEGS, VALUE_CASES, structuralMatrix } from '../../../../scripts/portraitMatrix.js';

function textOf(segments: ModelNarrativeSegment[], p: ModelPresentation): string {
  const byId = new Map(p.insights.map((i) => [i.id, i]));
  return segments
    .map((s) =>
      s.type === 'text'
        ? s.text
        : s.type === 'identityLead'
          ? s.greeting
          : (byId.get(s.insightId)?.linkedTerm ?? '<<MISSING>>'),
    )
    .join('');
}

interface Portrait {
  label: string;
  presentation: ModelPresentation;
  text: string;
}

function compile(
  label: string,
  snapshot: Parameters<typeof compileSnapshotToPresentation>[0],
  offsetMinutes = 0,
  priorOffsetMinutes?: number,
): Portrait {
  const presentation = compileSnapshotToPresentation(snapshot, {
    displayName: 'Glendon',
    offsetMinutes,
    priorOffsetMinutes: priorOffsetMinutes ?? offsetMinutes,
  });
  return { label, presentation, text: textOf(presentation.prose, presentation) };
}

/**
 * Every compiled portrait: the structural matrix (which legs were measured,
 * merged and repo-scoped) plus the value matrix.
 *
 * The value half is not optional coverage. Structure alone compiles each card at
 * exactly one point in value-space, and the claims these guards check are about
 * the NUMBER — a body reading "most of your sessions ran here" is correct at 65%
 * and false at 30%, and the structural matrix only ever renders the 65%.
 */
function everyPortrait(): Portrait[] {
  const out = structuralMatrix().map(({ label, snapshot }) => compile(label, snapshot));
  for (const c of VALUE_CASES) {
    out.push(compile(`value:${c.label}`, c.snapshot, c.offsetMinutes ?? 0, c.priorOffsetMinutes));
  }
  return out;
}

const PORTRAITS = everyPortrait();

/**
 * Words that name a mechanism instead of describing the reader.
 *
 * Deliberately NOT applied to card citations: the evidence contract REQUIRES a
 * derivation there ("a blame check against the branch tip"), and hiding it would
 * trade a readable card for an uncheckable one. This is the prose, the pull terms
 * and the hover peek — the three tiers a reader meets before they ask for detail.
 */
const JARGON = [
  'line survival',
  'rollup',
  'delta',
  'one-shot',
  'daypart',
  'n-floor',
  'rung',
  'snapshot',
  'projection',
  'the worker',
  'determinable',
  'signal',
  'repo id',
  'utc',
];

describe('portrait readability', () => {
  it('covers every combination of which producers fired, and every gate boundary', () => {
    expect(PORTRAITS).toHaveLength(2 * 2 ** LEGS.length + VALUE_CASES.length);
  });

  it('never speaks a mechanism name in the prose, a pull term, or a hover peek', () => {
    const offenders: string[] = [];
    for (const { label, presentation, text } of PORTRAITS) {
      const surfaces = [
        text,
        ...presentation.insights.map((i) => i.linkedTerm),
        ...presentation.insights.flatMap((i) => i.hoverLines),
      ];
      for (const surface of surfaces) {
        for (const word of JARGON) {
          if (surface.toLowerCase().includes(word)) offenders.push(`${label}: "${surface}" (${word})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every measured number out of the read and in the cards', () => {
    // The compiler warns on this in dev; a warning nobody reads is not a guard.
    //
    // TEXT segments only, which is exactly what the shipped guard checks and
    // exactly what the rule is about — the templates must carry no measurement. A
    // pull term may legitimately contain a digit because it can be a proper noun
    // ("Claude Opus 5"), so terms are checked for the shapes a MEASUREMENT takes
    // instead: a percentage, or a count with a thousands separator.
    const bad: string[] = [];
    for (const { label, presentation } of PORTRAITS) {
      for (const segment of presentation.prose) {
        if (segment.type === 'text' && /\d/.test(segment.text)) {
          bad.push(`${label}: template carries a digit: ${segment.text}`);
        }
      }
      for (const insight of presentation.insights) {
        if (/\d+\s*%|\d,\d{3}/.test(insight.linkedTerm)) {
          bad.push(`${label}: ${insight.id} term carries a measurement: ${insight.linkedTerm}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('never opens a paragraph on a pronoun with nothing to bind to', () => {
    // The defect this exists for: eleven of twelve producers wrote only the
    // follow-on form of their sentence, so whichever one happened to fire first
    // inherited the opener slot with "It", "them" or "more of it" pointing at a
    // sentence that was never written. Reachable renders included the entire
    // portrait reading "Hey, most of them ran without doubling back."
    const bad: string[] = [];
    for (const { label, text } of PORTRAITS) {
      for (const paragraph of text.split('\n\n')) {
        // Strip the identity lead greeting ("Glendon, ") from the first paragraph.
        const opener = paragraph.replace(/^Glendon,\s*/, '').trimStart();
        if (/^(it|they|them|those|these|that|this)\b/i.test(opener)) {
          bad.push(`${label}: ${opener.slice(0, 80)}`);
        }
        if (/^most of (them|it)\b/i.test(opener)) bad.push(`${label}: ${opener.slice(0, 80)}`);
        if (/^(more|most|all) of it\b/i.test(opener)) bad.push(`${label}: ${opener.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never marks a contrast against a claim it did not make', () => {
    // "though" is only honest when the rhythm sentence named a DIFFERENT daypart.
    const bad: string[] = [];
    for (const { label, text, presentation } of PORTRAITS) {
      if (!text.includes('though')) continue;
      const named = presentation.insights.some((i) => i.id === 'daypart');
      if (!named) bad.push(`${label}: ${text}`);
    }
    expect(bad).toEqual([]);
  });

  it('leaves no unresolved insight reference and no broken punctuation', () => {
    const bad: string[] = [];
    for (const { label, text } of PORTRAITS) {
      if (text.includes('<<MISSING>>')) bad.push(`${label}: unresolved insight`);
      if (text.includes('·')) bad.push(`${label}: middot in product copy`);
      if (/\s\./.test(text)) bad.push(`${label}: space before a period`);
      if (/\.\./.test(text)) bad.push(`${label}: doubled period`);
      if (/,\s*,/.test(text)) bad.push(`${label}: doubled comma`);
      if (text.trim().length > 0 && !/[.!?]\s*$/.test(text)) bad.push(`${label}: unterminated: ${text.slice(-40)}`);
    }
    expect(bad).toEqual([]);
  });

  it('gives every rendered insight a term in the prose it can be opened from', () => {
    // An insight with no segment referencing it renders nothing at all, so its
    // evidence is unreachable while the prose still makes the claim.
    const bad: string[] = [];
    for (const { label, presentation } of PORTRAITS) {
      const referenced = new Set(
        presentation.prose.filter((s) => s.type === 'insight').map((s) => s.insightId),
      );
      for (const insight of presentation.insights) {
        if (!referenced.has(insight.id)) bad.push(`${label}: ${insight.id} has no term`);
      }
    }
    expect(bad).toEqual([]);
  });
});

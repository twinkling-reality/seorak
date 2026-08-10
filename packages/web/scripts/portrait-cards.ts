/**
 * portrait-cards — read the developer-model portrait the way a reader meets it.
 *
 * The producers are readable source and that is exactly the problem: an agent
 * reading `hoverLines: [...]` inside the module that computed the numbers will
 * fill in the context the module has and the reader does not. This prints the
 * card ALONE — the term you clicked, the header above it, the peek you saw
 * first, the body, the citations, and which visual fields are bound — so a claim
 * has to stand up with nothing around it.
 *
 * Run:
 *   npm run portrait --workspace @seorak/web             # every distinct card
 *   npm run portrait --workspace @seorak/web -- --flags  # mechanical findings only
 *   npm run portrait --workspace @seorak/web -- --prose  # the read, per value case
 *   npm run portrait --workspace @seorak/web -- --case focus-tied-low
 *   npm run portrait --workspace @seorak/web -- --real path/to/snapshot.json
 *
 * The matrix is `scripts/portraitMatrix.ts`: 1,024 structural combinations
 * (every subset of the nine legs, merged and repo-scoped) plus a value matrix
 * that walks each gate to its boundary. Structure alone cannot find a card whose
 * copy is only wrong at 34%.
 */
import { readFileSync } from 'node:fs';
import type { DeveloperModelSnapshot } from '@seorak/types';

import { compileSnapshotToPresentation } from '../src/views/ModelView/compileSnapshotToPresentation.js';
import type { ModelInsight, ModelPresentation } from '../src/views/ModelView/modelPresentationTypes.js';
import { buildPortraitContext } from '../src/views/ModelView/portrait/context.js';
import { PORTRAIT_PRODUCERS } from '../src/views/ModelView/portrait/registry.js';
import { structuralMatrix, VALUE_CASES } from './portraitMatrix.js';

// ── rendering ───────────────────────────────────────────────────────────────

function proseText(p: ModelPresentation): string {
  const byId = new Map(p.insights.map((i) => [i.id, i]));
  return p.prose
    .map((s) =>
      s.type === 'text'
        ? s.text
        : s.type === 'identityLead'
          ? s.greeting
          : `«${byId.get(s.insightId)?.linkedTerm ?? '<<MISSING>>'}»`,
    )
    .join('');
}

/** Everything a reader can see on one card, and nothing else. */
function cardLines(insight: ModelInsight): string[] {
  const { squircle } = insight;
  const out = [
    `  TERM    ${insight.linkedTerm}`,
    `  HEADER  ${insight.label}`,
  ];
  if (insight.hoverLines.length === 0) out.push('  PEEK    (none — hover renders an empty card)');
  for (const line of insight.hoverLines) out.push(`  PEEK    ${line}`);
  out.push(`  BODY    ${squircle.detail ?? '(none)'}`);
  if (squircle.citations.length === 0) out.push('  CITE    (none)');
  for (const c of squircle.citations) out.push(`  CITE    ${c.text}   [${c.field}]`);
  const visual: string[] = [];
  visual.push(squircle.projectKey ? `projectKey=${squircle.projectKey}` : 'projectKey=—');
  visual.push(squircle.share === undefined ? 'share=—' : `share=${squircle.share.toFixed(3)}`);
  visual.push(
    squircle.projectKey && squircle.share !== undefined
      ? 'BAR: filled'
      : squircle.projectKey
        ? 'BAR: none (projectKey without share)'
        : 'BAR: none',
  );
  out.push(`  VISUAL  ${visual.join('  ')}`);
  return out;
}

/** The identity of a card as a READER sees it. Two portraits that render the
 *  same words are one variant however many masks produced them. */
function cardKey(insight: ModelInsight): string {
  return JSON.stringify([
    insight.linkedTerm,
    insight.label,
    insight.hoverLines,
    insight.squircle.detail ?? null,
    insight.squircle.citations.map((c) => c.text),
    insight.squircle.projectKey ?? null,
    insight.squircle.share === undefined ? null : Math.round(insight.squircle.share * 1000),
  ]);
}

// ── mechanical findings ─────────────────────────────────────────────────────
//
// Not style linting. Each rule below is a shape that has already shipped a wrong
// card, or is the mechanical half of a judgement an agent then has to make.

/** Jargon the reader has never been taught. Citations are exempt: the evidence
 *  contract REQUIRES a derivation there. */
const JARGON = [
  'line survival', 'rollup', 'delta', 'one-shot', 'daypart', 'n-floor', 'rung',
  'snapshot', 'projection', 'the worker', 'determinable', 'signal', 'repo id', 'utc',
];

const MAJORITY_WORDS = /\b(most|mostly|majority|almost all|nearly all)\b/i;
const TOTALITY_WORDS = /\b(all of|every one of|always)\b/i;

/** "1,204 of 3,900" → 0.3087. The first ratio a card states about itself. */
function firstRatio(text: string): { n: number; d: number } | null {
  const m = /(\d[\d,]*)\s+of\s+(\d[\d,]*)/.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  const d = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return { n, d };
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

/** Share of the shorter line's content words that the longer one also has. */
function overlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  let hit = 0;
  for (const w of small) if (big.has(w)) hit += 1;
  return hit / small.size;
}

interface Finding {
  rule: string;
  insight: string;
  detail: string;
}

function findingsFor(insight: ModelInsight): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, detail: string) => out.push({ rule, insight: insight.id, detail });
  const { squircle } = insight;
  const body = squircle.detail ?? '';
  const cites = squircle.citations.map((c) => c.text);
  const ratio = firstRatio(cites[0] ?? '') ?? firstRatio(insight.hoverLines[0] ?? '');

  if (!squircle.detail) add('NO_BODY', 'pinned card renders header + citations only');
  if (insight.hoverLines.length === 0) add('NO_PEEK', 'hover renders a card with nothing in it');

  // A claim the card's own arithmetic contradicts.
  if (ratio && MAJORITY_WORDS.test(body) && ratio.n / ratio.d <= 0.5) {
    add(
      'BODY_OVERCLAIMS',
      `body says "${body}" while its own first citation is ${ratio.n} of ${ratio.d} (${Math.round((ratio.n / ratio.d) * 100)}%)`,
    );
  }
  if (ratio && TOTALITY_WORDS.test(body) && ratio.n < ratio.d) {
    add('BODY_OVERCLAIMS', `body claims totality at ${ratio.n} of ${ratio.d}`);
  }
  for (const peek of insight.hoverLines) {
    const pr = firstRatio(peek);
    if (pr && MAJORITY_WORDS.test(peek) && pr.n / pr.d <= 0.5) {
      add('PEEK_OVERCLAIMS', `peek says "${peek}" at ${pr.n} of ${pr.d}`);
    }
  }

  // The body is the one line that may add what the sentence did not.
  //
  // Word overlap alone is not enough to judge that: a REMAINDER is a complement
  // stated in the same vocabulary as the thing it complements ("the other 70
  // sessions" beside "30 of 100 sessions"), which scores as an echo and is the
  // opposite of one. So the overlap only counts when the body also fails to state
  // a number that appears nowhere else on the card.
  const cardNumbers = new Set(
    [...insight.hoverLines, ...cites].flatMap((t) => t.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, '')),
  );
  const bodyNumbers = (body.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, ''));
  const bodyAddsANumber = bodyNumbers.some((n) => !cardNumbers.has(n));
  if (!bodyAddsANumber) {
    for (const peek of insight.hoverLines) {
      if (body && overlap(body, peek) >= 0.6) {
        add('BODY_ECHOES_PEEK', `body "${body}" vs peek "${peek}"`);
      }
    }
    for (const cite of cites) {
      if (body && overlap(body, cite) >= 0.7) {
        add('BODY_ECHOES_CITATION', `body "${body}" vs citation "${cite}"`);
      }
    }
  }
  for (const peek of insight.hoverLines) {
    for (const cite of cites) {
      const norm = (t: string) => t.replace(/[.,]/g, '').trim().toLowerCase();
      if (norm(peek).startsWith(norm(cite)) || norm(cite).startsWith(norm(peek))) {
        add('PEEK_IS_CITATION', `peek "${peek}" is citation "${cite}"`);
      }
    }
  }

  // Visual binding.
  if (squircle.projectKey && squircle.share === undefined) {
    add('KEY_WITHOUT_SHARE', 'has a project hue but renders no bar, unlike its sibling cards');
  }
  if (squircle.share !== undefined && !squircle.projectKey) {
    add('SHARE_WITHOUT_KEY', 'share is set but the bar only renders with a projectKey');
  }
  if (squircle.share !== undefined && ratio) {
    const stated = ratio.n / ratio.d;
    if (Math.abs(stated - squircle.share) > 0.01) {
      add(
        'BAR_DISAGREES',
        `bar is filled to ${(squircle.share * 100).toFixed(1)}% while the card states ${(stated * 100).toFixed(1)}%`,
      );
    }
  }
  // ADVISORY, not a defect. The bar is drawn from `projectGradient(projectKey)`,
  // so it is a project's own hue and there is no equivalent mark for a language
  // or a daypart. Listed so the choice stays a choice: today only the focus cards
  // carry one, and every other card states a proportion with no visual at all.
  if (squircle.share === undefined && ratio && ratio.d > 0 && ratio.n <= ratio.d) {
    add('note:NO_BAR_BUT_PROPORTION', `card states a proportion (${ratio.n} of ${ratio.d}) and shows nothing`);
  }

  // Reader-facing tiers only.
  for (const surface of [insight.linkedTerm, ...insight.hoverLines, body]) {
    for (const word of JARGON) {
      if (surface.toLowerCase().includes(word)) add('JARGON', `"${surface}" contains "${word}"`);
    }
  }

  for (const line of [...insight.hoverLines, body, ...cites]) {
    const bad = /\b1\s+(sessions|starts|calls|runs|lines|commits|repos|days)\b/.exec(line);
    if (bad) add('PLURAL_ON_ONE', `"${line}"`);
  }
  for (const cite of cites) {
    if (cite.length > 160) add('CITATION_TOO_LONG', `${cite.length} chars: ${cite.slice(0, 90)}…`);
  }

  return out;
}

// ── drivers ─────────────────────────────────────────────────────────────────

interface Compiled {
  label: string;
  presentation: ModelPresentation;
}

function compile(
  label: string,
  snapshot: DeveloperModelSnapshot,
  offsetMinutes = 0,
  priorOffsetMinutes?: number,
): Compiled {
  return {
    label,
    presentation: compileSnapshotToPresentation(snapshot, {
      displayName: 'Glendon',
      offsetMinutes,
      priorOffsetMinutes: priorOffsetMinutes ?? offsetMinutes,
    }),
  };
}

function everyPortrait(): Compiled[] {
  const out = structuralMatrix().map(({ label, snapshot }) => compile(label, snapshot));
  for (const c of VALUE_CASES) {
    out.push(
      compile(`value:${c.label}`, c.snapshot, c.offsetMinutes ?? 0, c.priorOffsetMinutes),
    );
  }
  return out;
}

function printCards(portraits: Compiled[]) {
  const variants = new Map<
    string,
    { insight: ModelInsight; key: string; seen: number; examples: string[] }
  >();
  for (const { label, presentation } of portraits) {
    for (const insight of presentation.insights) {
      const key = `${insight.id}::${cardKey(insight)}`;
      const hit = variants.get(key);
      if (hit) {
        hit.seen += 1;
        if (hit.examples.length < 3) hit.examples.push(label);
      } else {
        variants.set(key, { insight, key, seen: 1, examples: [label] });
      }
    }
  }

  const byId = new Map<string, Array<{ insight: ModelInsight; seen: number; examples: string[] }>>();
  for (const v of variants.values()) {
    const list = byId.get(v.insight.id) ?? [];
    list.push(v);
    byId.set(v.insight.id, list);
  }

  for (const [id, list] of byId) {
    const facet = list[0].insight.facet;
    console.log(`\n${'═'.repeat(78)}`);
    console.log(`INSIGHT  ${id}   facet=${facet}   ${list.length} distinct card(s)`);
    console.log('═'.repeat(78));
    list
      .sort((a, b) => b.seen - a.seen)
      .forEach((v, i) => {
        console.log(`\n── variant ${i + 1}/${list.length}  (${v.seen} portraits, e.g. ${v.examples.join(' | ')})`);
        for (const line of cardLines(v.insight)) console.log(line);
      });
  }
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`${portraits.length} portraits compiled, ${byId.size} insights, ${variants.size} distinct cards.`);
}

function printFlags(portraits: Compiled[]) {
  // One finding per (rule, insight, detail): the same card renders in hundreds
  // of masks and a rule that fired once has fired.
  const seen = new Map<string, { finding: Finding; example: string; count: number }>();
  for (const { label, presentation } of portraits) {
    for (const insight of presentation.insights) {
      for (const f of findingsFor(insight)) {
        const key = `${f.rule}::${f.insight}::${f.detail}`;
        const hit = seen.get(key);
        if (hit) hit.count += 1;
        else seen.set(key, { finding: f, example: label, count: 1 });
      }
    }
    // Two open-at-a-time cards can still share a header inside one read, which
    // is what makes a header a category label rather than a title.
    const labels = new Map<string, string[]>();
    for (const insight of presentation.insights) {
      const list = labels.get(insight.label) ?? [];
      list.push(insight.id);
      labels.set(insight.label, list);
    }
    for (const [header, ids] of labels) {
      if (ids.length < 2) continue;
      const key = `header::${ids.join(',')}::${header}`;
      const hit = seen.get(key);
      if (hit) hit.count += 1;
      else {
        // The tied-focus pair legitimately shares a header: same measurement, two
        // subjects, told apart by the coloured project squircle beside the title.
        const rule =
          ids.slice().sort().join('+') === 'second-project+top-project'
            ? 'note:HEADER_SHARED_BY_A_PAIR'
            : 'HEADER_COLLISION';
        seen.set(key, {
          finding: { rule, insight: ids.join(','), detail: `all titled "${header}"` },
          example: label,
          count: 1,
        });
      }
    }
  }

  const byRule = new Map<string, Array<{ finding: Finding; example: string; count: number }>>();
  for (const entry of seen.values()) {
    const list = byRule.get(entry.finding.rule) ?? [];
    list.push(entry);
    byRule.set(entry.finding.rule, list);
  }

  const order = [...byRule.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [rule, list] of order) {
    console.log(`\n${rule}  (${list.length} distinct)`);
    for (const { finding, example, count } of list.sort((a, b) => b.count - a.count)) {
      console.log(`  · [${finding.insight}] ${finding.detail}`);
      console.log(`      seen in ${count} portraits, e.g. ${example}`);
    }
  }
  const total = [...seen.values()].length;
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`${total} distinct findings across ${portraits.length} portraits.`);
}

function printProse(portraits: Compiled[]) {
  for (const { label, presentation } of portraits) {
    console.log(`\n── ${label}${presentation.forming ? '  (FORMING)' : ''}`);
    console.log(`   ${proseText(presentation).replace(/\n\n/g, '\n   ')}`);
    console.log(`   cards: ${presentation.insights.map((i) => i.id).join(', ') || '(none)'}`);
  }
}

/**
 * What the ranking actually did, over every window in the matrix.
 *
 * `weight` and `notability` are editorial numbers and there is no way to argue
 * about them from the producer source: what matters is which sentences they cut,
 * how often, and in favour of what. This counts, per producer, the windows where
 * it HAD something to say and the windows where it was heard — and names the
 * sentences that beat it when it was not.
 */
function printRanking(portraits: Compiled[], snapshots: Array<{ label: string; snapshot: DeveloperModelSnapshot; offsetMinutes: number; priorOffsetMinutes: number }>) {
  interface Row {
    spoke: number;
    couldSpeak: number;
    scores: number[];
    beatenBy: Map<string, number>;
  }
  const rows = new Map<string, Row>();
  const row = (id: string) => {
    const hit = rows.get(id);
    if (hit) return hit;
    const fresh: Row = { spoke: 0, couldSpeak: 0, scores: [], beatenBy: new Map() };
    rows.set(id, fresh);
    return fresh;
  };

  const spokenIds = new Map<string, Set<string>>();
  for (const { label, presentation } of portraits) {
    spokenIds.set(label, new Set(presentation.insights.map((i) => i.id)));
  }

  for (const { label, snapshot, offsetMinutes, priorOffsetMinutes } of snapshots) {
    const ctx = buildPortraitContext(snapshot, offsetMinutes, priorOffsetMinutes);
    const fired: Array<{ id: string; paragraph: string; score: number; ids: string[] }> = [];
    for (const producer of PORTRAIT_PRODUCERS) {
      const sentence = producer.produce(snapshot, ctx);
      if (!sentence) continue;
      fired.push({
        id: producer.id,
        paragraph: producer.paragraph,
        score: producer.weight * (sentence.notability ?? 0.5),
        ids: sentence.insights.map((i) => i.id),
      });
    }
    const spoken = spokenIds.get(label) ?? new Set<string>();
    for (const candidate of fired) {
      const r = row(candidate.id);
      r.couldSpeak += 1;
      r.scores.push(candidate.score);
      // A sentence with no insights (the honest-empty survival line) is spoken
      // without leaving a card, so fall back to comparing scores in its paragraph.
      const heard =
        candidate.ids.length > 0
          ? candidate.ids.some((id) => spoken.has(id))
          : fired
              .filter((c) => c.paragraph === candidate.paragraph)
              .filter((c) => c.score > candidate.score).length < 2;
      if (heard) {
        r.spoke += 1;
        continue;
      }
      for (const winner of fired) {
        if (winner.paragraph !== candidate.paragraph) continue;
        if (winner.score <= candidate.score) continue;
        r.beatenBy.set(winner.id, (r.beatenBy.get(winner.id) ?? 0) + 1);
      }
    }
  }

  console.log('producer            spoke / could   median score   cut by');
  console.log('─'.repeat(78));
  for (const producer of PORTRAIT_PRODUCERS) {
    const r = rows.get(producer.id);
    if (!r || r.couldSpeak === 0) {
      console.log(`${producer.id.padEnd(20)}  never fired in this matrix`);
      continue;
    }
    const sorted = [...r.scores].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const beaten = [...r.beatenBy.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, n]) => `${id} (${n})`)
      .join(', ');
    console.log(
      `${producer.id.padEnd(20)}${String(r.spoke).padStart(5)} / ${String(r.couldSpeak).padEnd(6)}` +
        `${median.toFixed(3).padStart(10)}     ${beaten || '—'}`,
    );
  }
  console.log(`\nweight x notability, over ${snapshots.length} windows. "cut by" names the`);
  console.log('sentences that outscored it in its own paragraph when it went unheard.');
}

function printCase(label: string) {
  const hit = VALUE_CASES.find((c) => c.label === label);
  if (!hit) {
    console.error(`no such case: ${label}\navailable: ${VALUE_CASES.map((c) => c.label).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const { presentation } = compile(hit.label, hit.snapshot, hit.offsetMinutes ?? 0, hit.priorOffsetMinutes);
  console.log(`CASE  ${hit.label}\nPROBE ${hit.probes}\n`);
  console.log(`READ\n  ${proseText(presentation).replace(/\n\n/g, '\n\n  ')}\n`);
  for (const insight of presentation.insights) {
    console.log(`\n── ${insight.id} (${insight.facet})`);
    for (const line of cardLines(insight)) console.log(line);
    const findings = findingsFor(insight);
    for (const f of findings) console.log(`  ⚑ ${f.rule}: ${f.detail}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  const has = (flag: string) => argv.includes(flag);
  const valueOf = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const caseLabel = valueOf('--case');
  if (caseLabel) return printCase(caseLabel);

  const realPath = valueOf('--real');
  if (realPath) {
    const raw = JSON.parse(readFileSync(realPath, 'utf8')) as DeveloperModelSnapshot;
    const offset = Number(valueOf('--offset') ?? new Date().getTimezoneOffset());
    const compiled = compile(`real:${realPath}`, raw, offset);
    console.log(`READ (offsetMinutes=${offset})\n  ${proseText(compiled.presentation).replace(/\n\n/g, '\n\n  ')}\n`);
    for (const insight of compiled.presentation.insights) {
      console.log(`\n── ${insight.id} (${insight.facet})`);
      for (const line of cardLines(insight)) console.log(line);
      for (const f of findingsFor(insight)) console.log(`  ⚑ ${f.rule}: ${f.detail}`);
    }
    return;
  }

  const portraits = everyPortrait();
  if (has('--prose')) return printProse(portraits.filter((p) => p.label.startsWith('value:')));
  if (has('--flags')) return printFlags(portraits);
  if (has('--rank')) {
    const snapshots = [
      ...structuralMatrix().map((m) => ({ ...m, offsetMinutes: 0, priorOffsetMinutes: 0 })),
      ...VALUE_CASES.map((c) => ({
        label: `value:${c.label}`,
        snapshot: c.snapshot,
        offsetMinutes: c.offsetMinutes ?? 0,
        priorOffsetMinutes: c.priorOffsetMinutes ?? c.offsetMinutes ?? 0,
      })),
    ];
    return printRanking(portraits, snapshots);
  }
  printCards(portraits);
}

main();

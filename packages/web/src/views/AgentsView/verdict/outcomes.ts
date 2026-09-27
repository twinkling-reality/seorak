// ── Outcomes: the one place this page stops describing activity ──────────────
//
// Everything else on Agents is what a tool DID. This is what its work went on to
// BE: committed lines traced back to the agent that wrote them, then re-blamed
// against a live branch days later to see what survived. It comes from git, so it
// does not care which tool wrote a line, and it is the only surface here on which
// a real outcome claim can be earned.
//
// Two things gate what it is allowed to say, and both are load-bearing:
//
//   THE FLOOR      A rate under 500 attributed lines and 3 commits is a coin flip
//                  wearing a percentage sign (one average file swings a 100-line
//                  denominator by ±97 points). Below it the COUNTS still render
//                  and the rate reads honest-empty.
//
//   THE COVERAGE   A rate needs both legs; a COMPARE needs comparable coverage.
//                  Tools differ in how much of their editing Seorak can even see,
//                  so if one tool's traceable share is far below another's, the
//                  gap between their rates is a CAPTURE ARTIFACT and the compare
//                  is refused rather than dressed up.
//
// The panel and the verdict's outcome paragraph share this file on purpose: they
// are two renderings of ONE gate. Split apart, a future edit could loosen the
// floor or the coverage rule in the prose while the table beside it still refuses,
// and the page would contradict itself with a straight face.

import { AGENT_SURVIVAL_FLOOR } from '@seorak/types';

import type { AgentOutcomeRollup, AgentRollup } from '../../../lib/apiSchemas.js';
import { getToolMeta } from '../../../lib/toolMeta.js';
import { count, fmtCount, formatCost, naturalList } from '../../../lib/voice/index.js';

import { blank, text, type MatrixRow } from './cells.js';
import { rankAgents } from './metrics.js';
import { mark, note, t, type AgentsNarrativeSegment, type AgentsNote } from './notes.js';

/** Coverage gap (in points) past which two agents are no longer measured on
 *  comparable ground and the comparative claim is withheld. */
const COVERAGE_GAP = 0.2;

/** Survival gap (in points) under which neither agent's work is said to have held
 *  up better. Mirrors CLOSE_SHARE for the activity read. */
const CLOSE_SURVIVAL = 0.05;

/**
 * The survival rate this surface is willing to SHOW.
 *
 * The worker already applies the floor, and this re-applies it rather than trusting
 * it. That is deliberate. The floor is the one thing standing between a percentage
 * and a coin flip (one average file's fate swings a 100-line denominator by ±97
 * points), and a guarantee enforced in exactly one process is a guarantee that a
 * version skew, a cached payload, or a future edit can quietly break. The web holds
 * both counts, so the check is free. A rate that arrives violating the floor is a
 * bug, and the honest response to a bug is to withhold the number, not to render it.
 */
export function shownSurvivalRate(o: AgentOutcomeRollup): number | null {
  if (o.survivalRate === null) return null;
  if (o.linesAuthored < AGENT_SURVIVAL_FLOOR.lines) return null;
  if (o.commits < AGENT_SURVIVAL_FLOOR.commits) return null;
  return o.survivalRate;
}

/** What share of the lines in this agent's commits Seorak could place with SOME
 *  tool. `null` when it landed no commits (no denominator, never a 0%). */
export function agentTraceShare(o: AgentOutcomeRollup): number | null {
  const total = o.coverage.linesInCommits;
  if (total <= 0) return null;
  return (total - o.coverage.linesUnattributed) / total;
}

export interface AgentsOutcomes {
  agents: Array<{ id: string; label: string }>;
  rows: MatrixRow[];
  /** Plain-language disclosures under the table: what this compare cannot see,
   *  and whether the two rates sit on comparable ground. Never inside a hover. */
  disclosures: string[];
}

/**
 * buildAgentsOutcomes — the Outcomes panel.
 *
 * Rows are ordered so a reader meets the legs before the rate and the coverage
 * before they can act on either.
 */
export function buildAgentsOutcomes(
  outcomes: AgentOutcomeRollup[],
  byAgent: AgentRollup[],
  unusable = 0,
): AgentsOutcomes {
  // Rank by surviving lines: the agent with the most work that lasted leads. Fall
  // back to the activity ranking for an agent with no outcome row yet, so the
  // columns stay in the same order as every other panel on the page.
  const order = rankAgents(byAgent).map((a) => a.agent);
  const agents = order.map((id) => ({ id, label: getToolMeta(id).label }));
  const rowFor = (id: string) => outcomes.find((o) => o.agent === id) ?? null;

  // Nothing has matured anywhere: the panel has nothing to show at all.
  if (outcomes.length === 0 || agents.length === 0) {
    return { agents: [], rows: [], disclosures: [] };
  }

  const rows: MatrixRow[] = [
    {
      id: 'lines-lasted',
      label: 'Lines that lasted',
      hint: 'Committed lines this tool wrote that are still on the branch, over the committed lines it wrote. Both legs, because a survival percentage on its own hides how much work it is about.',
      cells: agents.map(({ id }) => {
        const o = rowFor(id);
        // No outcome row at all means nothing from this tool has cleared the
        // three-day check yet, which is a different empty from a matured tool that
        // has simply committed no lines. Both fill in; they fill in from different
        // things, so they do not share a cell.
        if (o === null) return blank('not matured yet');
        if (o.linesAuthored === 0) return blank('no lines yet');
        return text(`${fmtCount(o.linesSurviving)} of ${fmtCount(o.linesAuthored)}`);
      }),
    },
    {
      id: 'survival',
      label: 'Survival',
      hint: `Needs ${fmtCount(AGENT_SURVIVAL_FLOOR.lines)} attributed lines and ${AGENT_SURVIVAL_FLOOR.commits} commits before a percentage means anything. A lower rate means more of that work was changed back later, which is not the same as worse.`,
      cells: agents.map(({ id }) => {
        const o = rowFor(id);
        if (o === null) return blank('not matured yet');
        const rate = shownSurvivalRate(o);
        return rate === null ? blank('not enough yet') : text(`${Math.round(rate * 100)}%`);
      }),
    },
    {
      id: 'commits',
      label: 'Commits landed',
      hint: 'Distinct commits this tool got work into. A tool can carry a lot of lines across very few commits, and a rate over few commits is a small sample however many lines it holds.',
      cells: agents.map(({ id }) => {
        const o = rowFor(id);
        return o === null ? blank('not matured yet') : text(fmtCount(o.commits));
      }),
    },
    {
      id: 'cost-per-line',
      label: 'Cost per surviving line',
      hint: 'What you paid for work that lasted. Only a tool that reports priced tokens can fill this. A tool that reports no cost reads empty here, never a $0, because a $0 would say its work was free.',
      cells: agents.map(({ id }) => {
        const o = rowFor(id);
        const caps = byAgent.find((a) => a.agent === id)?.capabilities;
        // A tool that structurally cannot report cost says so, whether or not it has
        // outcomes yet: "none" and "unknown" are different cells, and this one will
        // never fill in, so an anonymous placeholder would be a promise we cannot keep.
        if (caps && caps.cost === 'none') return blank('reports no cost');
        if (o === null) return blank('not matured yet');
        if (o.costPerSurvivingLine === null) return blank('unpriced');
        return text(formatCost(o.costPerSurvivingLine, 4));
      }),
    },
    {
      id: 'traced',
      label: 'Lines Seorak could trace',
      hint: 'Of every line in the commits this tool landed work in, how many Seorak could place with some tool. The rest are your own hand edits, script-written files, or a gap in capture. Two tools can only be compared when this number is close.',
      cells: agents.map(({ id }) => {
        const o = rowFor(id);
        if (o === null) return blank('not matured yet');
        const total = o.coverage.linesInCommits;
        // No denominator because this tool landed no commits (agentTraceShare), which
        // is a different empty from "we have no outcome row for it at all" above.
        if (total <= 0) return blank('no commits yet');
        return text(`${fmtCount(total - o.coverage.linesUnattributed)} of ${fmtCount(total)}`);
      }),
    },
  ];

  return { agents, rows, disclosures: outcomeDisclosures(outcomes, agents, unusable) };
}

/**
 * The disclosures under the table. Every one of them is a way this compare could
 * mislead, said out loud rather than left for the reader to discover. They render
 * as prose under the evidence, never behind a hover, because a caveat you have to
 * find is a caveat you meant to hide.
 */
function outcomeDisclosures(
  outcomes: AgentOutcomeRollup[],
  agents: Array<{ id: string; label: string }>,
  unusable: number,
): string[] {
  const out: string[] = [];
  const rowFor = (id: string) => outcomes.find((o) => o.agent === id) ?? null;
  const rated = agents.filter(({ id }) => rowFor(id) !== null);

  // An agent with a column but no row. This is the FIRST state this surface ships in:
  // a survival check lands three days after the work does, so a tool you started using
  // this week has an empty column for a reason that is about the clock, not the tool.
  const waiting = agents.filter(({ id }) => rowFor(id) === null);
  if (waiting.length > 0) {
    out.push(
      `${naturalList(waiting.map((a) => a.label))} ran sessions in this window, but none of ${waiting.length > 1 ? 'their' : 'its'} committed work has matured past the three-day check yet. Outcomes fill in on their own.`,
    );
  }

  // Comparability — the gate on the whole compare (ADR-H9).
  if (rated.length > 1) {
    const shares = rated
      .map(({ id, label }) => ({ label, share: agentTraceShare(rowFor(id)!) }))
      .filter((x): x is { label: string; share: number } => x.share !== null);
    if (shares.length > 1) {
      const sorted = [...shares].sort((a, b) => b.share - a.share);
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      out.push(
        best.share - worst.share > COVERAGE_GAP
          ? `Seorak traced ${pct(best.share)} of the lines in ${best.label}'s commits but only ${pct(worst.share)} of ${worst.label}'s. That gap is about what Seorak can see, not about the tools, so the difference between their survival rates may be a capture artifact rather than a real one. Read the two rates on their own, not against each other.`
          : `Seorak traced ${pct(best.share)} of the lines in ${best.label}'s commits and ${pct(worst.share)} of ${worst.label}'s, so the two rates sit on comparable ground.`,
      );
    }
  }

  // The rewrite family: work we genuinely cannot follow. Excluded from every rate.
  const rewritten = rated
    .map(({ id, label }) => ({ label, n: rowFor(id)!.unreachableSessions }))
    .filter((x) => x.n > 0);
  if (rewritten.length > 0) {
    out.push(
      `${naturalList(rewritten.map((x) => `${count(x.n, 'session')} from ${x.label}`))} landed work that a squash, rebase, or reset has since rewritten. Those lines may well live on under a new commit, but Seorak cannot follow them there, so they are left out of the rates above rather than counted as dead.`,
    );
  }

  // The known conservative bias, and its direction. A moved file reads as dead at
  // its old path, so survival is a FLOOR.
  const moved = rated
    .map(({ id, label }) => ({ label, n: rowFor(id)!.filesGoneFromTip }))
    .filter((x) => x.n > 0);
  if (moved.length > 0) {
    out.push(
      `${naturalList(moved.map((x) => `${count(x.n, 'file')} from ${x.label}`))} no longer exist at the path they were written to. Their lines count as gone, which is right for a deletion and an undercount for a move, so these survival numbers are floors rather than ceilings.`,
    );
  }

  // The subset disclosure: rows nobody owns.
  if (unusable > 0) {
    out.push(
      `${count(unusable, 'session')} landed committed work in this window that Seorak could not attribute to any tool, so it is in neither column. Those rows still count toward the overall survival stat on Overview.`,
    );
  }

  return out;
}

/** Evidence card behind the verdict's outcome sentence. */
function survivalNote(outcomes: AgentOutcomeRollup[]): AgentsNote {
  return {
    id: 'survival',
    section: 'outcomes',
    label: 'Line survival',
    detail:
      'Seorak traces each committed line back to the tool that edited that file, then re-blames it against a live branch three days later. It comes from git, so it never asks a tool how it did.',
    cites: ['lines-lasted', 'survival', 'commits'],
    citations: outcomes.map((o) => {
      const label = getToolMeta(o.agent).label;
      if (o.linesAuthored === 0) return `${label} has no rated committed work yet`;
      const legs = `${fmtCount(o.linesSurviving)} of ${fmtCount(o.linesAuthored)} committed lines still on the branch`;
      const rate = shownSurvivalRate(o);
      return rate === null
        ? `${label}: ${legs}, too little to put a percentage on`
        : `${label}: ${legs} (${Math.round(rate * 100)}%), across ${count(o.commits, 'commit')}`;
    }),
  };
}

/**
 * The verdict's OUTCOME paragraph — the first sentence on this page that says
 * something about what the work was worth rather than how much of it there was.
 *
 * It is deliberately hard to make it say anything. A comparative claim needs BOTH
 * agents over the floor AND comparable coverage; anything short of that gets the
 * agents' own numbers stated separately, or nothing at all. This is the one place
 * a real superiority claim could be earned, which is exactly why it must not be
 * given away.
 */
export function buildOutcomeParagraph(
  outcomes: AgentOutcomeRollup[],
  byAgent: AgentRollup[],
): { segments: AgentsNarrativeSegment[]; note: AgentsNote } | null {
  if (outcomes.length === 0) return null;
  // Tools that ran this window but have nothing matured yet. Naming them matters: a
  // reader who sees one tool's survival and no mention of the other will assume the
  // other one failed, when in fact its check has simply not come due.
  const waiting = byAgent
    .map((a) => a.agent)
    .filter((id) => !outcomes.some((o) => o.agent === id));
  const card = survivalNote(outcomes);
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const rated = outcomes
    .map((o) => ({ o, rate: shownSurvivalRate(o) }))
    .filter((x): x is { o: AgentOutcomeRollup; rate: number } => x.rate !== null)
    .sort((a, b) => b.rate - a.rate);

  // Nothing is rateable yet: say what is accruing, and never a 0%.
  if (rated.length === 0) {
    const landed = outcomes.filter((o) => o.linesAuthored > 0);
    if (landed.length === 0) return null;
    const top = [...landed].sort((a, b) => b.linesAuthored - a.linesAuthored)[0];
    return {
      segments: [
        t('\n\nNo tool has landed enough committed work to rate yet. '),
        mark(top.agent),
        t(' is closest, with '),
        note('survival', `${fmtCount(top.linesAuthored)} attributed lines`),
        t(` against the ${fmtCount(AGENT_SURVIVAL_FLOOR.lines)} a survival rate needs.`),
      ],
      note: card,
    };
  }

  // One tool rateable: state its outcome, and say plainly why the other has none.
  if (rated.length === 1) {
    const solo = rated[0].o;
    const soloRate = rated[0].rate;
    const others = outcomes.filter((o) => o.agent !== solo.agent);
    const segments: AgentsNarrativeSegment[] = [
      t('\n\n'),
      mark(solo.agent),
      t(' kept '),
      note('survival', `${pct(soloRate)} of the ${fmtCount(solo.linesAuthored)} lines it committed`),
      t(` on the branch, across ${count(solo.commits, 'commit')}.`),
    ];
    if (others.length === 1) {
      const other = others[0];
      segments.push(
        t(' '),
        mark(other.agent),
        other.linesAuthored > 0
          ? t(
              ` has landed ${fmtCount(other.linesAuthored)} attributed lines so far, which is not enough to put a percentage on.`,
            )
          : t(' has not landed committed work Seorak can rate yet.'),
      );
    } else if (others.length > 1) {
      segments.push(t(' No other tool has landed enough committed work to rate.'));
    } else if (waiting.length === 1) {
      // The live day-one state: the other tool is running, its check is just not due.
      segments.push(
        t(' '),
        mark(waiting[0]),
        t(" has run sessions here too, but none of its committed work has matured past the three-day check yet."),
      );
    } else if (waiting.length > 1) {
      segments.push(
        t(' No other tool has committed work that has matured past the three-day check yet.'),
      );
    }
    return { segments, note: card };
  }

  // Two or more rateable. The comparative claim is now possible, and it is gated.
  const top = rated[0].o;
  const topRate = rated[0].rate;
  const second = rated[1].o;
  const secondRate = rated[1].rate;
  const topShare = agentTraceShare(top);
  const secondShare = agentTraceShare(second);
  const comparable =
    topShare !== null && secondShare !== null && Math.abs(topShare - secondShare) <= COVERAGE_GAP;

  if (!comparable) {
    // Coverage is not comparable, so the two rates are not measured on the same
    // ground. State both, refuse the compare, and say why in the same breath.
    return {
      segments: [
        t('\n\n'),
        mark(top.agent),
        t(' kept '),
        note('survival', `${pct(topRate)} of its ${fmtCount(top.linesAuthored)} committed lines`),
        t(' on the branch and '),
        mark(second.agent),
        t(` kept ${pct(secondRate)} of its ${fmtCount(second.linesAuthored)}. Those two rates are not measured on the same ground, though: Seorak could place far more of one tool's committed lines than the other's, so the gap between them may be a difference in what Seorak can see rather than in the work. Coverage below has the numbers.`),
      ],
      note: card,
    };
  }

  if (topRate - secondRate < CLOSE_SURVIVAL) {
    return {
      segments: [
        t("\n\nBoth tools' landed work held up about the same: "),
        mark(top.agent),
        t(` at ${pct(topRate)} of `),
        note('survival', `${fmtCount(top.linesAuthored)} committed lines`),
        t(', '),
        mark(second.agent),
        t(` at ${pct(secondRate)} of ${fmtCount(second.linesAuthored)}.`),
      ],
      note: card,
    };
  }

  // The real claim. It says what LASTED, not who is better: a lower rate means more
  // of that work was changed back, which is a fact about the work and not a grade.
  return {
    segments: [
      t('\n\nMore of '),
      mark(top.agent),
      t("'s landed work is still on the branch: "),
      note('survival', `${pct(topRate)} of its ${fmtCount(top.linesAuthored)} committed lines`),
      t(', against '),
      mark(second.agent),
      t(`'s ${pct(secondRate)} of ${fmtCount(second.linesAuthored)}. Seorak traced a comparable share of both tools' commits, so that is a real difference in what survived and not an artifact of what it could see.`),
    ],
    note: card,
  };
}

// ── Outcomes (HEAD-TO-HEAD Tier 2) ──────────────────────────────────────────
//
// This is the only place on the product where a real superiority claim becomes
// possible, so most of what follows tests what the page must REFUSE to say.

import { describe, expect, it } from 'vitest';

import type { AgentOutcomeRollup } from '../../../../lib/apiSchemas.js';
import { buildAgentsNarrative } from '../narrative.js';
import { buildAgentsOutcomes } from '../outcomes.js';
import { agent, outcome, readOut, TWO_AGENTS, withTrace } from './fixtures.js';

/** The cell for `agentId` in row `rowId` — positional indexing reads the wrong tool. */
function cellFor(o: ReturnType<typeof buildAgentsOutcomes>, rowId: string, agentId: string) {
  const col = o.agents.findIndex((a) => a.id === agentId);
  return o.rows.find((r) => r.id === rowId)!.cells[col];
}

describe('buildAgentsOutcomes — the panel', () => {
  it('shows BOTH legs of the survival rate as counts, never a bare percentage', () => {
    const o = buildAgentsOutcomes(
      [outcome('claude-code', { linesAuthored: 1000, linesSurviving: 700 })],
      TWO_AGENTS,
    );
    expect(cellFor(o, 'lines-lasted', 'claude-code').text).toBe('700 of 1,000');
    expect(cellFor(o, 'survival', 'claude-code').text).toBe('70%');
  });

  it('below the n-floor the COUNTS render and the rate reads honest-empty', () => {
    const o = buildAgentsOutcomes(
      [outcome('codex', { linesAuthored: 120, linesSurviving: 110, commits: 2 })],
      TWO_AGENTS,
    );
    // At 120 lines one average file's fate would swing the rate by tens of points.
    const rate = cellFor(o, 'survival', 'codex');
    expect(rate.empty).toBe(true);
    expect(rate.text).toBe('not enough yet');
    // ...but what WAS measured still shows.
    expect(cellFor(o, 'lines-lasted', 'codex').text).toBe('110 of 120');
  });

  it('a tool that cannot report cost reads the REASON, not a dash and never a $0', () => {
    const codex = agent('codex', {
      sessions: 3,
      toolCalls: 120,
      capabilities: {
        hasTokens: true,
        hasCacheTokens: false,
        cost: 'none',
        toolResult: 'both',
        endReason: false,
        duration: 'inferred',
        verification: 'none',
        costScope: 'call',
        usageWindow: 'none',
      },
    });
    const o = buildAgentsOutcomes(
      [outcome('codex', { linesAuthored: 800, linesSurviving: 600 })],
      [codex],
    );
    const cost = cellFor(o, 'cost-per-line', 'codex');
    expect(cost.empty).toBe(true);
    // "none" and "unknown" are DIFFERENT cells: a tool that structurally cannot report
    // cost is not the same as a number we happen not to have.
    expect(cost.text).toBe('reports no cost');
    expect(cost.text).not.toContain('$');
  });
});

describe('ADR-H9 — a compare needs comparable coverage', () => {
  const claude = withTrace(
    outcome('claude-code', { linesAuthored: 1000, linesSurviving: 700 }),
    0.85,
  );

  it('says the rates sit on comparable ground when they do', () => {
    const codex = withTrace(outcome('codex', { linesAuthored: 800, linesSurviving: 700 }), 0.9);
    const o = buildAgentsOutcomes([claude, codex], TWO_AGENTS, 0);
    expect(o.disclosures[0]).toContain('comparable ground');
  });

  it('REFUSES the compare when one tool is far less traceable than the other', () => {
    // Codex's shell edits carry no file identity, so most of its committed lines trace
    // to nobody. Its survival rate is still honest about what we saw, but the GAP
    // between the two rates would be a capture artifact.
    const codex = withTrace(outcome('codex', { linesAuthored: 800, linesSurviving: 760 }), 0.3);
    const o = buildAgentsOutcomes([claude, codex], TWO_AGENTS, 0);
    expect(o.disclosures[0]).toContain('capture artifact');
    expect(o.disclosures[0]).toContain('not against each other');

    // ...and the verdict must not make the comparative claim either.
    const n = buildAgentsNarrative(TWO_AGENTS, [], [], [], [], 0, [claude, codex]);
    const read = readOut(n);
    expect(read).toContain('not measured on the same ground');
    expect(read).not.toContain('More of');
  });

  it('makes the real comparative claim ONLY when coverage is comparable', () => {
    const codex = withTrace(outcome('codex', { linesAuthored: 800, linesSurviving: 760 }), 0.9);
    const read = readOut(buildAgentsNarrative(TWO_AGENTS, [], [], [], [], 0, [claude, codex]));
    // Codex kept 95% against Claude's 70%, on comparable ground. This is the one claim
    // Tier 2 earns, and it states what LASTED rather than which tool is better.
    expect(read).toContain("More of Codex's landed work is still on the branch");
    expect(read).toContain('comparable share');
    expect(read).not.toContain('better');
  });
});

describe('the verdict outcome paragraph', () => {
  it('never puts a percentage on a tool below the floor', () => {
    const claude = outcome('claude-code', { linesAuthored: 1200, linesSurviving: 800 });
    const codex = outcome('codex', { linesAuthored: 140, linesSurviving: 130, commits: 2 });
    const read = readOut(buildAgentsNarrative(TWO_AGENTS, [], [], [], [], 0, [claude, codex]));
    expect(read).toContain('not enough to put a percentage on');
    expect(read).not.toContain('93%'); // 130/140 — the rate that must not be spoken
  });

  it('says nothing comparative when nothing is rateable yet', () => {
    const read = readOut(
      buildAgentsNarrative(TWO_AGENTS, [], [], [], [], 0, [
        outcome('claude-code', { linesAuthored: 200, linesSurviving: 150, commits: 1 }),
      ]),
    );
    expect(read).toContain('No tool has landed enough committed work to rate yet');
  });
});

describe('outcome disclosures — every way this could mislead, said out loud', () => {
  it('discloses moved files as an UNDERCOUNT, so survival reads as a floor', () => {
    const o = buildAgentsOutcomes(
      [outcome('claude-code', { linesAuthored: 1000, linesSurviving: 700, filesGoneFromTip: 12 })],
      TWO_AGENTS,
    );
    const line = o.disclosures.find((d) => d.includes('no longer exist'))!;
    expect(line).toContain('undercount for a move');
    expect(line).toContain('floors rather than ceilings');
  });

  it('discloses rewritten work as EXCLUDED, never as dead', () => {
    const o = buildAgentsOutcomes(
      [outcome('codex', { linesAuthored: 900, linesSurviving: 700, unreachableSessions: 3 })],
      TWO_AGENTS,
    );
    const line = o.disclosures.find((d) => d.includes('rewritten'))!;
    expect(line).toContain('left out of the rates');
    expect(line).toContain('rather than counted as dead');
  });

  it('discloses when the compare is over a SUBSET', () => {
    const o = buildAgentsOutcomes(
      [outcome('claude-code', { linesAuthored: 1000, linesSurviving: 700 })],
      TWO_AGENTS,
      4,
    );
    expect(o.disclosures.some((d) => d.includes('could not attribute to any tool'))).toBe(true);
  });

  it('names a tool whose work has not matured, rather than dropping it from the compare', () => {
    // The FIRST state this surface ships in: a survival check lands three days after the
    // work does, so a tool you started using this week has an empty column. Dropping it
    // from the table entirely would read as "that tool did nothing".
    const o = buildAgentsOutcomes(
      [outcome('claude-code', { linesAuthored: 1000, linesSurviving: 700 })],
      TWO_AGENTS,
      0,
    );
    expect(o.agents.map((a) => a.id)).toEqual(['claude-code', 'codex']); // BOTH columns
    expect(cellFor(o, 'survival', 'codex').text).toBe('\u2014'); // honest-empty, not 0%
    expect(o.disclosures[0]).toContain('has matured past the three-day check');

    // ...and the verdict says so too, instead of leaving the reader to infer failure.
    const read = readOut(buildAgentsNarrative(TWO_AGENTS, [], [], [], [], 0, [
      outcome('claude-code', { linesAuthored: 1000, linesSurviving: 700 }),
    ]));
    expect(read).toContain('has run sessions here too');
    expect(read).toContain('matured past the three-day check');
  });

  it('stays quiet when there is genuinely nothing to disclose', () => {
    const o = buildAgentsOutcomes(
      [
        withTrace(outcome('claude-code', { linesAuthored: 1000, linesSurviving: 700 }), 0.85),
        withTrace(outcome('codex', { linesAuthored: 800, linesSurviving: 600 }), 0.88),
      ],
      TWO_AGENTS,
      0,
    );
    // Both rated, comparable coverage, nothing moved, nothing rewritten: one line, and
    // it is the comparability statement that licenses reading the two rates together.
    expect(o.disclosures).toHaveLength(1);
    expect(o.disclosures[0]).toContain('comparable ground');
  });
});

describe('the floor is enforced HERE too, not just upstream', () => {
  it('withholds a below-floor rate even when the worker sends one', () => {
    // The worker applies the floor. This proves the web does not merely trust it: a
    // stale worker, a cached payload, or a future edit could send a rate over too few
    // lines, and that number is a coin flip wearing a percentage sign. A guarantee
    // enforced in exactly one process is a guarantee a version skew can break.
    const rogue: AgentOutcomeRollup = {
      ...outcome('codex', { linesAuthored: 120, linesSurviving: 110, commits: 1 }),
      survivalRate: 0.9166, // over the line, and the floor says it must not be spoken
    };
    const o = buildAgentsOutcomes([rogue], TWO_AGENTS);
    expect(cellFor(o, 'survival', 'codex').text).toBe('not enough yet');

    const read = readOut(buildAgentsNarrative(TWO_AGENTS, [], [], [], [], 0, [rogue]));
    expect(read).not.toContain('92%');
    expect(read).not.toContain('91%');
  });
});

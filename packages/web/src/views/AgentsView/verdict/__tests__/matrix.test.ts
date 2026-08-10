import { describe, expect, it } from 'vitest';

import { buildAgentsMatrix } from '../matrix.js';
import { agent } from './fixtures.js';

describe('buildAgentsMatrix', () => {
  it('uses em dash for missing cost and tokens', () => {
    const m = buildAgentsMatrix([
      agent('claude-code', {
        sessions: 2,
        toolCalls: 10,
        tokensTotal: 1000,
        costUsd: 1.5,
        lines: { added: 10, removed: 2 },
      }),
      agent('codex', {
        sessions: 1,
        toolCalls: 3,
        tokensTotal: 0,
        costUsd: null,
        lines: { added: 4, removed: 1 },
      }),
    ]);
    expect(m.agents.map((a) => a.id)).toEqual(['claude-code', 'codex']);
    const cost = m.rows.find((r) => r.id === 'cost')!;
    expect(cost.cells[0].empty).toBe(false);
    expect(cost.cells[1]).toEqual({ text: '—', empty: true });
    const tokens = m.rows.find((r) => r.id === 'tokens')!;
    expect(tokens.cells[1].empty).toBe(true);
  });

  it('the error row shows BOTH legs as counts, never a bare percent', () => {
    const m = buildAgentsMatrix([
      agent('claude-code', {
        sessions: 40,
        toolCalls: 9412,
        lines: { added: 500, removed: 50 },
        errorRate: { rate: 489 / 9412, errored: 489, returned: 9412, calls: 9412 },
      }),
      agent('codex', {
        sessions: 4,
        toolCalls: 509,
        lines: { added: 40, removed: 4 },
        errorRate: { rate: 8 / 224, errored: 8, returned: 224, calls: 509 },
      }),
    ]);
    const errors = m.rows.find((r) => r.id === 'tool-errors')!;
    // The denominators DIFFER, and that is the whole hazard. A bare "5.2% vs 3.6%" hides
    // that Claude's is over 9,412 calls and Codex's is over 224 of the 509 it made.
    expect(errors.cells[0]).toEqual({ text: '5.2% (489 of 9,412)', empty: false });
    expect(errors.cells[1]).toEqual({ text: '3.6% (8 of 224)', empty: false });
  });

  it('an agent with no error rate reads em dash, never 0%', () => {
    const m = buildAgentsMatrix([
      agent('claude-code', { sessions: 2, toolCalls: 10, lines: { added: 10, removed: 2 } }),
      agent('codex', {
        sessions: 4,
        toolCalls: 60,
        lines: { added: 4, removed: 1 },
        errorRate: { rate: null, errored: 0, returned: 0, calls: 60 },
      }),
    ]);
    const errors = m.rows.find((r) => r.id === 'tool-errors')!;
    expect(errors.cells[0]).toEqual({ text: '—', empty: true }); // no field at all
    expect(errors.cells[1]).toEqual({ text: '—', empty: true }); // ran calls, reported none
  });

  it('a REAL but tiny error rate never rounds down to a fabricated 0%', () => {
    // The house convention is Math.round(x * 100), which would print "0%" for 4 errors in
    // 2,000 calls — a silent zero reading as "nothing ever fails here".
    const m = buildAgentsMatrix([
      agent('claude-code', {
        sessions: 20,
        toolCalls: 2000,
        lines: { added: 10, removed: 2 },
        errorRate: { rate: 4 / 2000, errored: 4, returned: 2000, calls: 2000 },
      }),
    ]);
    const errors = m.rows.find((r) => r.id === 'tool-errors')!;
    expect(errors.cells[0]!.text).toBe('0.2% (4 of 2,000)');
    expect(errors.cells[0]!.text).not.toContain('0% ');

    // And below one part in a thousand it says so rather than printing 0.0%.
    const tiny = buildAgentsMatrix([
      agent('claude-code', {
        sessions: 50,
        toolCalls: 50000,
        lines: { added: 10, removed: 2 },
        errorRate: { rate: 1 / 50000, errored: 1, returned: 50000, calls: 50000 },
      }),
    ]);
    expect(tiny.rows.find((r) => r.id === 'tool-errors')!.cells[0]!.text).toBe(
      '<0.1% (1 of 50,000)',
    );
  });

  it('DISCLOSES that a partial rate is not measured over the same work as a full one', () => {
    // The compare hazard, said out loud under the table. Without this, a reader scans
    // "5.2% vs 3.6%" and concludes Codex errors less, which the data does not support:
    // Codex is only being graded on its shell calls.
    const m = buildAgentsMatrix([
      agent('claude-code', {
        sessions: 40,
        toolCalls: 9412,
        lines: { added: 500, removed: 50 },
        errorRate: { rate: 489 / 9412, errored: 489, returned: 9412, calls: 9412 },
      }),
      agent('codex', {
        sessions: 4,
        toolCalls: 509,
        lines: { added: 40, removed: 4 },
        errorRate: { rate: 8 / 224, errored: 8, returned: 224, calls: 509 },
      }),
    ]);
    // Pinned in full, because this sentence IS the guard. If it stops reading like a
    // person talking, or stops saying the lower rate is not the better one, the table
    // goes back to quietly inviting the wrong conclusion.
    expect(m.disclosures).toEqual([
      'Codex only tells you how a call went on 224 of the 509 calls it made, so its error rate ' +
        'covers 44% of its work and says nothing about the rest. Claude Code reports on ' +
        'everything it runs. Both rates are real, but they are not measured over the same work, ' +
        'so the lower one is not the better one.',
    ]);
    const said = m.disclosures[0]!;
    expect(said).not.toContain('·'); // no middot separators in product copy
    expect(said).not.toContain('—'); // no em dashes in product copy
  });

  it('says nothing when every agent reports on everything it runs', () => {
    const m = buildAgentsMatrix([
      agent('claude-code', {
        sessions: 10,
        toolCalls: 100,
        lines: { added: 10, removed: 2 },
        errorRate: { rate: 0.05, errored: 5, returned: 100, calls: 100 },
      }),
    ]);
    expect(m.disclosures).toEqual([]);
  });

  it('an agent that reported NOTHING is disclosed as no rate, not a zero one', () => {
    const m = buildAgentsMatrix([
      agent('codex', {
        sessions: 4,
        toolCalls: 60,
        lines: { added: 4, removed: 1 },
        errorRate: { rate: null, errored: 0, returned: 0, calls: 60 },
      }),
    ]);
    expect(m.disclosures[0]).toContain('none of them reported whether it worked');
    expect(m.disclosures[0]).toContain('no error rate rather than a zero one');
  });

  it('DEPLOY DAY: a silent agent beside a fully-covered one discloses ONCE, and not as a compare', () => {
    // The literal shape prod is in the hour this ships, taken from a live /overview: every
    // Codex call in the window predates the stamping adapter, so Codex has 139 calls and not
    // one reported result, while Claude has reported on all 22,231 of its own. There is no
    // backfill, so this is the state the buyer actually sees first — and the demo, sitting at
    // ~44% coverage, never visits it.
    //
    // The trap is that "partial coverage" and "no coverage" are both `< 100%`. If coverage
    // were computed as 0/139 = 0 rather than null, Codex would fall into the PARTIAL branch
    // too, and the surface would print a comparison sentence — "both rates are real, but they
    // are not measured over the same work" — about an agent that HAS NO RATE. Two disclosures
    // for one fact, and the louder one incoherent.
    const m = buildAgentsMatrix([
      agent('claude-code', {
        sessions: 120,
        toolCalls: 22_231,
        lines: { added: 40_000, removed: 12_000 },
        errorRate: { rate: 0.014547525367570925, errored: 324, returned: 22_231, calls: 22_231 },
      }),
      agent('codex', {
        sessions: 6,
        toolCalls: 139,
        lines: { added: 900, removed: 200 },
        errorRate: { rate: null, errored: 0, returned: 0, calls: 139 },
      }),
    ]);

    expect(m.disclosures).toHaveLength(1);
    expect(m.disclosures[0]).toContain('139 tool calls');
    expect(m.disclosures[0]).toContain('no error rate rather than a zero one');
    // Not a compare. Nothing to compare it against.
    expect(m.disclosures[0]).not.toContain('Both rates are real');
    expect(m.disclosures[0]).not.toContain('0% of its work');

    // And the row itself: Claude's real rate renders, Codex's cell is a dash. A "0%" here
    // would read as "Codex never fails", the most flattering lie this surface could tell.
    const errors = m.rows.find((r) => r.id === 'tool-errors')!;
    const cellOf = (id: string) => errors.cells[m.agents.findIndex((a) => a.id === id)]!;
    expect(cellOf('claude-code').text).toContain('1.5%');
    expect(cellOf('codex').text).not.toContain('0');
    expect(cellOf('codex').text).not.toContain('%');
  });
});

import { describe, expect, it } from 'vitest';

import { buildAgentsCoverage } from '../coverage.js';
import { agent, CLAUDE_CAPS, CODEX_CAPS } from './fixtures.js';

describe('buildAgentsCoverage', () => {
  it('renders the contract legs, pairing tool errors with the captured data leg', () => {
    const rows = buildAgentsCoverage([
      agent('claude-code', {
        sessions: 10,
        toolCalls: 300,
        lines: { added: 500, removed: 50 },
        capabilities: CLAUDE_CAPS,
        erroredPresent: true,
      }),
      agent('codex', {
        sessions: 4,
        toolCalls: 60,
        capabilities: CODEX_CAPS,
        erroredPresent: false,
      }),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // rankAgents puts claude (measured lines) first. Neither agent carries the
    // measured error-rate legs, so neither is presented as captured.
    expect(byId['tool-errors'].cells[0]).toEqual({
      text: 'observable, not captured yet',
      tone: 'cannot',
    });
    expect(byId['tool-errors'].cells[1]).toEqual({
      text: 'observable, not captured yet',
      tone: 'cannot',
    });
    expect(byId['cost'].cells[1]).toEqual({ text: 'no dollar path', tone: 'cannot' });
    expect(byId['end-reason'].cells[1]).toEqual({ text: 'no recorded end', tone: 'cannot' });
    expect(byId['duration'].cells[0]).toEqual({ text: 'measured end', tone: 'can' });
    expect(byId['verification'].cells[1]).toEqual({ text: 'no result data', tone: 'cannot' });
  });

  it('PARTIAL coverage gets its own cell, never "pass and fail captured" (F9)', () => {
    // The lie this branch exists to prevent. Codex's real numbers: it reports a result on
    // 224 of the 509 calls it makes, because only its SHELL calls carry an exit code. Under
    // the old boolean, one errored flag was enough to render "pass and fail captured", which
    // over 44% coverage is a falsehood told with real data.
    const rows = buildAgentsCoverage([
      agent('claude-code', {
        sessions: 40,
        toolCalls: 9412,
        lines: { added: 500, removed: 50 },
        capabilities: CLAUDE_CAPS,
        erroredPresent: true,
        errorRate: { rate: 489 / 9412, errored: 489, returned: 9412, calls: 9412 },
      }),
      agent('codex', {
        sessions: 4,
        toolCalls: 509,
        capabilities: CODEX_CAPS,
        erroredPresent: true,
        errorRate: { rate: 8 / 224, errored: 8, returned: 224, calls: 509 },
      }),
    ]);
    const errors = rows.find((r) => r.id === 'tool-errors')!;

    // Claude reports on everything it runs.
    expect(errors.cells[0]).toEqual({ text: 'pass and fail captured', tone: 'can' });
    // Codex does not, and the cell says so, in its own tone.
    expect(errors.cells[1]).toEqual({ text: 'on 224 of 509 calls', tone: 'partial' });
    expect(errors.cells[1]!.tone).not.toBe('can');
  });

  it('an agent that ran calls but reported none reads "not captured", never a partial', () => {
    const rows = buildAgentsCoverage([
      agent('codex', {
        sessions: 4,
        toolCalls: 60,
        capabilities: CODEX_CAPS,
        erroredPresent: false,
        errorRate: { rate: null, errored: 0, returned: 0, calls: 60 },
      }),
    ]);
    const errors = rows.find((r) => r.id === 'tool-errors')!;
    expect(errors.cells[0]).toEqual({ text: 'observable, not captured yet', tone: 'cannot' });
  });
});

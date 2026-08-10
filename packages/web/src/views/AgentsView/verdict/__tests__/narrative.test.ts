import { describe, expect, it } from 'vitest';

import type { ProjectRollup } from '../../../../lib/apiSchemas.js';
import { buildAgentsNarrative } from '../narrative.js';
import { agent, hourPoint, model, noteById, readOut, TWO_PROJECTS } from './fixtures.js';

describe('buildAgentsNarrative', () => {
  const twoProjects = TWO_PROJECTS;

  it('leads with the edit-volume winner and cites both legs', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 10, toolCalls: 100, lines: { added: 900, removed: 100 } }),
        agent('codex', { sessions: 2, toolCalls: 20, lines: { added: 40, removed: 10 } }),
      ],
      twoProjects,
      [],
    );
    expect(n.leaderId).toBe('claude-code');
    const text = readOut(n);
    expect(text).toContain('Claude Code led your agent work');
    expect(text).toMatch(/95% of edit volume/);
    expect(text).toContain('across 2 projects');
    expect(text).toContain('Codex wrote the other 5%.');

    const edit = noteById(n, 'edit-volume')!;
    expect(edit.section).toBe('matrix');
    expect(edit.citations).toContain('Claude Code wrote +900 / −100 edit lines');
    expect(edit.citations).toContain('Codex wrote +40 / −10 edit lines');

    const where = noteById(n, 'projects')!;
    expect(where.section).toBe('where');
    expect(where.citations[0]).toBe('seorak saw Claude Code and Codex');
    expect(where.detail).toContain('1 project ran more than one tool');
  });

  it('says neither dominated when shares are close', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 5, toolCalls: 50, lines: { added: 52, removed: 0 } }),
        agent('codex', { sessions: 5, toolCalls: 50, lines: { added: 48, removed: 0 } }),
      ],
      twoProjects,
      [],
    );
    expect(n.leaderId).toBeNull();
    expect(readOut(n)).toMatch(/Neither tool dominated your edit volume/);
  });

  it('never claims a lead when only one tool reports lines', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 10, toolCalls: 100, lines: { added: 900, removed: 100 } }),
        agent('codex', { sessions: 2, toolCalls: 20 }),
      ],
      twoProjects,
      [],
    );
    expect(n.leaderId).toBeNull();
    const text = readOut(n);
    expect(text).toContain('only tool reporting edit lines');
    expect(text).toContain('once Codex reports line counts too');
    expect(noteById(n, 'edit-volume')!.citations).toContain(
      'Codex did not report line counts this window',
    );
  });

  it('falls back to sessions when no edit lines at all', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 8, toolCalls: 10 }),
        agent('codex', { sessions: 1, toolCalls: 2 }),
      ],
      [],
      [],
    );
    expect(n.leaderId).toBe('claude-code');
    expect(readOut(n)).toContain('ran more of your sessions');
    const sessions = noteById(n, 'sessions')!;
    expect(sessions.section).toBe('matrix');
    expect(sessions.citations).toContain('Claude Code ran 8 sessions');
  });

  it('splits models by tokens when any model is unpriced, never a $0', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 5, toolCalls: 50, lines: { added: 90, removed: 0 } }),
        agent('codex', { sessions: 5, toolCalls: 50, lines: { added: 40, removed: 0 } }),
      ],
      [],
      [
        model('model-a', { calls: 10, tokensTotal: 5000, costUsd: 12 }),
        model('model-b', { calls: 4, tokensTotal: 20000, costUsd: null }),
      ],
    );
    const text = readOut(n);
    expect(text).toContain("Most of the window's tokens ran through model-b");
    const models = noteById(n, 'models')!;
    expect(models.section).toBe('models');
    expect(models.citations).toContain('model-b used 20.0K tokens across 4 calls');
    expect(models.citations.join(' ')).not.toContain('$0.00');
  });

  it('speaks in spend when every model and agent is priced', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', {
          sessions: 5,
          toolCalls: 50,
          costUsd: 12,
          lines: { added: 90, removed: 0 },
        }),
        agent('codex', {
          sessions: 5,
          toolCalls: 50,
          costUsd: 3,
          lines: { added: 40, removed: 0 },
        }),
      ],
      [],
      [
        model('model-a', { calls: 10, tokensTotal: 5000, costUsd: 12 }),
        model('model-b', { calls: 4, tokensTotal: 2000, costUsd: 3 }),
      ],
    );
    const text = readOut(n);
    expect(text).toContain("Most of the window's spend ran through model-a");
    expect(noteById(n, 'models')!.citations).toContain('model-a cost $12.00 across 10 calls');
  });

  it('says measured spend when an agent leg has no priced total', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', {
          sessions: 5,
          toolCalls: 50,
          costUsd: 12,
          lines: { added: 90, removed: 0 },
        }),
        agent('codex', { sessions: 5, toolCalls: 50, lines: { added: 40, removed: 0 } }),
      ],
      [],
      [
        model('model-a', { calls: 10, tokensTotal: 5000, costUsd: 12 }),
        model('model-b', { calls: 4, tokensTotal: 2000, costUsd: 3 }),
      ],
    );
    expect(readOut(n)).toContain("Most of the window's measured spend ran through model-a");
  });

  it('omits the models sentence when no model rows carry a measured metric', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 8, toolCalls: 10 }),
        agent('codex', { sessions: 1, toolCalls: 2 }),
      ],
      [],
      [],
    );
    expect(noteById(n, 'models')).toBeUndefined();
  });

  it('every note term in the prose resolves to a note', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 10, toolCalls: 100, lines: { added: 900, removed: 100 } }),
        agent('codex', { sessions: 2, toolCalls: 20, lines: { added: 40, removed: 10 } }),
      ],
      twoProjects,
      [model('model-a', { calls: 10, tokensTotal: 5000, costUsd: 12 })],
    );
    const ids = new Set(n.notes.map((note) => note.id));
    for (const segment of n.segments) {
      if (segment.type === 'note') expect(ids.has(segment.noteId)).toBe(true);
    }
  });

  it('contrasts session shape, speaking n=1 as one session rather than an average', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 150, toolCalls: 552, lines: { added: 6342, removed: 1661 } }),
        agent('codex', { sessions: 1, toolCalls: 53, lines: { added: 95, removed: 21 } }),
      ],
      [],
      [],
    );
    const text = readOut(n);
    expect(text).toContain('You use them differently.');
    expect(text).toContain('Your one Codex session ran 53 tool calls');
    expect(text).toContain('Claude Code runs lighter at 4 per session');
    const shape = noteById(n, 'shape')!;
    expect(shape.section).toBe('matrix');
    expect(shape.citations).toContain('Codex made 53 tool calls across 1 session');
    expect(shape.citations).toContain('Claude Code made 552 tool calls across 150 sessions');
  });

  it('contrasts reach when one tool roams and the other stays put', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 10, toolCalls: 100, lines: { added: 900, removed: 100 } }),
        agent('codex', { sessions: 5, toolCalls: 50, lines: { added: 40, removed: 10 } }),
      ],
      twoProjects,
      [],
    );
    const text = readOut(n);
    expect(text).toContain('Codex stays in seorak; Claude Code roams both.');
    const reach = noteById(n, 'reach')!;
    expect(reach.section).toBe('where');
    expect(reach.citations).toContain('Claude Code ran in seorak and chinmeister');
    expect(reach.citations).toContain('Codex ran in seorak');
  });

  it('omits the fit paragraph when neither shape nor reach shows a real gap', () => {
    const evenProjects = [
      {
        project: 'seorak',
        repoId: 'r-1',
        byAgent: [
          agent('claude-code', { sessions: 5, toolCalls: 10 }),
          agent('codex', { sessions: 3, toolCalls: 6 }),
        ],
      },
      {
        project: 'chinmeister',
        repoId: 'r-2',
        byAgent: [
          agent('claude-code', { sessions: 5, toolCalls: 10 }),
          agent('codex', { sessions: 3, toolCalls: 6 }),
        ],
      },
    ] as ProjectRollup[];
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 10, toolCalls: 20, lines: { added: 90, removed: 0 } }),
        agent('codex', { sessions: 6, toolCalls: 12, lines: { added: 40, removed: 0 } }),
      ],
      evenProjects,
      [],
    );
    expect(readOut(n)).not.toContain('You use them differently');
  });

  it('stays honest-empty with a single agent', () => {
    const n = buildAgentsNarrative(
      [agent('claude-code', { sessions: 3, toolCalls: 5 })],
      [],
      [],
    );
    expect(n.leaderId).toBeNull();
    expect(n.notes).toHaveLength(0);
    expect(readOut(n)).toContain('second tool');
  });
});

describe('cadence fit sentence', () => {
  const byAgent = [
    agent('claude-code', { sessions: 10, toolCalls: 300 }),
    agent('codex', { sessions: 4, toolCalls: 60 }),
  ];
  // Claude spread across the day (UTC = local, offset 0); Codex all 17-21.
  const spreadClaude = [9, 11, 13, 15, 19].map((h) => hourPoint('claude-code', h, 20));
  const eveningCodex = [17, 18, 20].map((h) => hourPoint('codex', h, 20));

  it('speaks a concentrated tool against a spread one, in local dayparts', () => {
    const n = buildAgentsNarrative(byAgent, [], [], [], [...spreadClaude, ...eveningCodex], 0);
    expect(readOut(n)).toContain('Codex is your evening tool');
    expect(readOut(n)).toContain('Claude Code spreads through the day.');
    const note = noteById(n, 'cadence');
    expect(note?.section).toBe('when');
    expect(note?.citations.some((c) => c.includes('17:00 to 21:59'))).toBe(true);
  });

  it('stays silent when a tool has too few calls to call a cadence', () => {
    const thin = [hourPoint('codex', 20, 5)];
    const n = buildAgentsNarrative(byAgent, [], [], [], [...spreadClaude, ...thin], 0);
    expect(noteById(n, 'cadence')).toBeUndefined();
  });

  it('stays silent when both tools peak in the same daypart', () => {
    const sameClaude = [13, 14, 15].map((h) => hourPoint('claude-code', h, 30));
    const sameCodex = [13, 14, 16].map((h) => hourPoint('codex', h, 20));
    const n = buildAgentsNarrative(byAgent, [], [], [], [...sameClaude, ...sameCodex], 0);
    expect(noteById(n, 'cadence')).toBeUndefined();
  });
});

describe('edit-volume rounding edge', () => {
  it('speaks exact counts instead of a 100%/0% split when the second tool measured lines', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', {
          sessions: 10,
          toolCalls: 300,
          lines: { added: 70_000, removed: 490 },
        }),
        agent('codex', { sessions: 2, toolCalls: 3, lines: { added: 1, removed: 1 } }),
      ],
      [],
      [],
    );
    const text = readOut(n);
    expect(text).not.toContain('100% of edit volume');
    expect(text).not.toContain('other 0%');
    expect(text).toContain('nearly all edit volume');
    expect(text).toContain('Codex wrote 2 of the 70,492 measured lines.');
  });
});

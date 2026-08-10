import { describe, expect, it } from 'vitest';

import { majorityModelByAgent } from '../models.js';
import { buildAgentsNarrative } from '../narrative.js';
import { agent, agentModel, model, noteById, readOut } from './fixtures.js';

describe('models pairing sentence', () => {
  const byAgent = [
    agent('claude-code', {
      sessions: 10,
      toolCalls: 300,
      lines: { added: 500, removed: 50 },
      costUsd: 12,
    }),
    agent('codex', { sessions: 4, toolCalls: 60, lines: { added: 100, removed: 10 } }),
  ];

  it('speaks the per-agent pairing when each tool has its own majority model', () => {
    const n = buildAgentsNarrative(
      byAgent,
      [],
      [model('claude-opus-4-8', { tokensTotal: 900, costUsd: 3 })],
      [
        agentModel('claude-code', 'claude-opus-4-8', 900),
        agentModel('claude-code', 'claude-haiku-4-5', 100),
        agentModel('codex', 'gpt-5.5', 800),
      ],
      [],
      0,
    );
    // formatModel keeps an unmapped id verbatim — never a prettified guess.
    expect(readOut(n)).toContain('You run Claude Code on Opus 4.8 and Codex on gpt-5.5.');
    const note = noteById(n, 'models');
    expect(note?.citations.some((c) => c.includes('90%'))).toBe(true);
  });

  it('falls back to the window-share sentence when only one tool reports models', () => {
    const n = buildAgentsNarrative(
      byAgent,
      [],
      [model('claude-opus-4-8', { tokensTotal: 900, costUsd: 3 })],
      [agentModel('claude-code', 'claude-opus-4-8', 900)],
      [],
      0,
    );
    expect(readOut(n)).not.toContain('You run ');
    expect(readOut(n)).toContain('spend');
  });

  it('majorityModelByAgent needs a real majority, not merely a top row', () => {
    const split = majorityModelByAgent([
      agentModel('codex', 'gpt-5.5', 400),
      agentModel('codex', 'gpt-5.4-mini', 350),
      agentModel('codex', 'gpt-5.4', 250),
    ]);
    expect(split.has('codex')).toBe(false);
  });
});

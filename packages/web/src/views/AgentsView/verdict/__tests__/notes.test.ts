import { describe, expect, it } from 'vitest';

import { buildAgentsNarrative } from '../narrative.js';
import { narrativeParagraphs } from '../notes.js';
import { agent } from './fixtures.js';

describe('narrativeParagraphs', () => {
  it('splits at blank-line text nodes and keeps non-text segments intact', () => {
    const n = buildAgentsNarrative(
      [
        agent('claude-code', { sessions: 150, toolCalls: 552, lines: { added: 900, removed: 100 } }),
        agent('codex', { sessions: 1, toolCalls: 53, lines: { added: 40, removed: 10 } }),
      ],
      [],
      [],
    );
    const paragraphs = narrativeParagraphs(n.segments);
    expect(paragraphs).toHaveLength(2);
    const secondLead = paragraphs[1][0];
    expect(secondLead).toEqual({ type: 'text', text: 'You use them differently. ' });
    for (const p of paragraphs) {
      for (const s of p) {
        if (s.type === 'text') expect(s.text).not.toContain('\n\n');
      }
    }
  });
});

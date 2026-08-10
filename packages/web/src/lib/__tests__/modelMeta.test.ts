import { describe, expect, it } from 'vitest';

import { formatModel, formatModelLong } from '../modelMeta.js';

/**
 * The display contract for model ids. The compact form rides dense labels, the
 * long form rides answer prose (`formatDuration` vs `formatDurationLong`).
 *
 * The load-bearing half of this suite is the fallback: an id we cannot parse
 * must come back verbatim. A prettified name for an id we do not understand
 * would be a fabricated fact on an honesty-first surface.
 */
describe('formatModel / formatModelLong', () => {
  it.each([
    // The current generation, matching collector CURRENT_MODEL_IDS.
    ['claude-opus-4-8', 'Opus 4.8', 'Claude Opus 4.8'],
    ['claude-opus-4-7', 'Opus 4.7', 'Claude Opus 4.7'],
    ['claude-sonnet-4-6', 'Sonnet 4.6', 'Claude Sonnet 4.6'],
    ['claude-haiku-4-5', 'Haiku 4.5', 'Claude Haiku 4.5'],
    // A bare family prefix (also a MODEL_PRICES key) still names a real model.
    ['claude-opus-4', 'Opus 4', 'Claude Opus 4'],
    // A pinned snapshot date is a build, not a model the reader is choosing.
    ['claude-haiku-4-5-20251001', 'Haiku 4.5', 'Claude Haiku 4.5'],
    // Claude Code's context-window qualifier survives, so the 1M variant stays
    // distinguishable from its sibling row.
    ['claude-opus-4-8[1m]', 'Opus 4.8 (1M)', 'Claude Opus 4.8 (1M)'],
  ])('%s renders as %s / %s', (id, short, long) => {
    expect(formatModel(id)).toBe(short);
    expect(formatModelLong(id)).toBe(long);
  });

  it.each([
    // Claude Code stamps this on synthetic assistant turns.
    '<synthetic>',
    // A second tool's model, once multi-tool ships.
    'gpt-5-codex',
    // Family-last legacy shape: we do not claim to parse it.
    'claude-3-5-sonnet-20241022',
    // A family we have no name for.
    'claude-instant-1',
    // Shapes that look close but are not a plain major[.minor].
    'claude-opus-4-latest',
    'claude-opus',
    'claude-opus-4-8-9-1',
    // An unexplained bracket qualifier.
    'claude-opus-4-8[beta]',
    '',
  ])('passes %s through verbatim rather than inventing a name', (id) => {
    expect(formatModel(id)).toBe(id);
    expect(formatModelLong(id)).toBe(id);
  });

  it('never renders the string "undefined" or "null" for a missing id', () => {
    for (const empty of [null, undefined]) {
      expect(formatModel(empty)).toBe('');
      expect(formatModelLong(empty)).toBe('');
    }
  });

  it('does not depend on the caller lowercasing the id', () => {
    expect(formatModelLong('Claude-Opus-4-8')).toBe('Claude Opus 4.8');
  });
});

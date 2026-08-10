import { describe, expect, it } from 'vitest';
import { VIZ_SEQ_FILLS, vizSeqColor } from '../shareStripRamp.js';

describe('vizSeqColor', () => {
  it('returns distinct token slots for the first six ranks', () => {
    const colors = [0, 1, 2, 3, 4, 5].map((i) => vizSeqColor(i));
    expect(new Set(colors).size).toBe(6);
    expect(colors[0]).toBe('var(--viz-seq-1)');
    expect(colors[5]).toBe('var(--viz-seq-6)');
  });

  it('cycles after six segments', () => {
    expect(vizSeqColor(6)).toBe(VIZ_SEQ_FILLS[0]);
  });
});

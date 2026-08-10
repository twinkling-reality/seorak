import { describe, expect, it } from 'vitest';
import { arcPath, CX, CY, R, SW, GAP, DEG } from './svgArcs.js';

describe('svgArcs constants', () => {
  it('exports expected constants', () => {
    expect(CX).toBe(130);
    expect(CY).toBe(130);
    expect(R).toBe(58);
    expect(SW).toBe(13);
    expect(GAP).toBe(14);
    expect(DEG).toBeCloseTo(Math.PI / 180);
  });
});

describe('arcPath', () => {
  it('returns a valid SVG path string', () => {
    const path = arcPath(130, 130, 58, 0, 180);
    expect(path).toMatch(/^M /);
    expect(path).toContain(' A ');
  });

  it('sets large-arc flag to 1 when sweep > 180', () => {
    const path = arcPath(130, 130, 58, 0, 200);
    // The large arc flag is 1 when sweepDeg > 180
    expect(path).toContain(' 1 1 ');
  });

  it('sets large-arc flag to 0 when sweep <= 180', () => {
    const path = arcPath(130, 130, 58, 0, 90);
    expect(path).toContain(' 0 1 ');
  });

  it('handles small sweeps', () => {
    const path = arcPath(130, 130, 58, 0, 10);
    expect(path).toMatch(/^M /);
  });

  it('handles 360-degree sweep', () => {
    const path = arcPath(130, 130, 58, 0, 360);
    expect(path).toContain(' 1 1 ');
  });
});

import { describe, expect, it } from 'vitest';

import { formatCost } from '../utils.js';

// DA-12: a measured sub-cent cost must never read like no cost. `--` stays
// strictly null-only (never measured); a genuine measured 0 is "$0.00"; a
// positive value below the smallest unit shows "<$0.01".
describe('formatCost honesty (DA-12)', () => {
  it('null / undefined render the -- sentinel, never a dollar amount', () => {
    expect(formatCost(null)).toBe('--');
    expect(formatCost(undefined)).toBe('--');
  });

  it('a genuine measured zero stays $0.00', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('a measured sub-cent value renders <$0.01, not $0.00 and not the -- sentinel', () => {
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(0.004)).not.toBe(formatCost(null));
    expect(formatCost(0.004)).not.toBe('$0.00');
  });

  it('a value at or above one cent formats normally, with separators', () => {
    expect(formatCost(0.01)).toBe('$0.01');
    expect(formatCost(1.23)).toBe('$1.23');
    expect(formatCost(1234.5)).toBe('$1,234.50');
  });
});

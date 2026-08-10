import { describe, expect, it } from 'vitest';
import { projectGradient } from './projectGradient.js';

describe('projectGradient', () => {
  it('returns a CSS gradient string', () => {
    const result = projectGradient('t_abc');
    expect(result).toContain('radial-gradient');
    expect(result).toContain('linear-gradient');
  });

  it('returns deterministic output for the same input', () => {
    expect(projectGradient('t_1')).toBe(projectGradient('t_1'));
  });

  it('returns different gradients for different team IDs', () => {
    expect(projectGradient('t_1')).not.toBe(projectGradient('t_2'));
  });

  it('handles empty string', () => {
    const result = projectGradient('');
    expect(result).toContain('radial-gradient');
  });
});

import { describe, expect, it } from 'vitest';
import { generateHandle } from '../userProfile.js';

describe('generateHandle', () => {
  it('returns a handle that matches dashboard username rules', () => {
    for (let i = 0; i < 24; i++) {
      const handle = generateHandle();
      expect(handle).toMatch(/^[A-Za-z0-9_]{3,20}$/);
      expect(handle.length).toBeGreaterThanOrEqual(8);
    }
  });
});

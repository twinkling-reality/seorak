import { describe, expect, it } from 'vitest';

import { agentCadences, localHourOf } from '../clock.js';
import { hourPoint } from './fixtures.js';

describe('localHourOf', () => {
  it('shifts a UTC hour into the viewer clock (getTimezoneOffset convention)', () => {
    // UTC-4 (EDT): offset +240 → 01:00 UTC is 21:00 local the previous evening.
    expect(localHourOf(1, 240)).toBe(21);
    // UTC+2: offset -120 → 23:00 UTC is 01:00 local.
    expect(localHourOf(23, -120)).toBe(1);
    expect(localHourOf(12, 0)).toBe(12);
  });
});

describe('agentCadences', () => {
  it('shifts dayparts by the viewer offset', () => {
    // All codex calls at 01:00 UTC; viewer at UTC-4 → 21:00 local = evening.
    const cadence = agentCadences([hourPoint('codex', 1, 30)], 240);
    expect(cadence[0].top).toBe('evening');
  });
});

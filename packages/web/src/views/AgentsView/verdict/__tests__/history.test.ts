import { describe, expect, it } from 'vitest';

import type { AgentDailyPoint } from '../../../../lib/apiSchemas.js';
import { buildAgentsHistory } from '../history.js';
import { hourPoint } from './fixtures.js';

describe('buildAgentsHistory', () => {
  const NOW = Date.parse('2026-07-11T12:00:00.000Z');

  it('materializes the day spine; absent days are measured zeros, null lines stay null', () => {
    const daily: AgentDailyPoint[] = [
      { agent: 'claude-code', day: '2026-07-10', sessions: 3, lines: { added: 40, removed: 5 }, tokensTotal: null },
      { agent: 'codex', day: '2026-07-11', sessions: 1, lines: null, tokensTotal: null },
    ];
    const h = buildAgentsHistory(daily, [], ['claude-code', 'codex'], 7, NOW, 0);
    expect(h.days).toHaveLength(7);
    expect(h.days[6]).toBe('2026-07-11');
    const i10 = h.days.indexOf('2026-07-10');
    expect(h.sessions[i10]).toEqual([3, 0]);
    expect(h.lines[i10]).toEqual([45, 0]);
    // Codex ran on the 11th without reporting lines: null, never a zero bar.
    expect(h.lines[6][1]).toBeNull();
    expect(h.sessions[6]).toEqual([0, 1]);
    expect(h.maxSessions).toBe(3);
    expect(h.maxLines).toBe(45);
  });

  it('buckets hourly calls into the viewer clock', () => {
    const h = buildAgentsHistory([], [hourPoint('codex', 1, 9)], ['codex'], 7, NOW, 240);
    expect(h.hourly[21]).toEqual([9]);
    expect(h.maxHourly).toBe(9);
  });
});

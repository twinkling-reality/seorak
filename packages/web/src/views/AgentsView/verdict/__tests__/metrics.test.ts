import { describe, expect, it } from 'vitest';

import { agentEditVolume } from '../metrics.js';
import { agent } from './fixtures.js';

describe('agentEditVolume', () => {
  it('returns null when lines are absent', () => {
    expect(agentEditVolume(agent('codex', { sessions: 1, toolCalls: 1 }))).toBeNull();
  });
});

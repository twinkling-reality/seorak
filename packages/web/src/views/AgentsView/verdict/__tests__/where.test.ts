import { describe, expect, it } from 'vitest';

import type { ProjectRollup } from '../../../../lib/apiSchemas.js';
import { buildAgentsWhere } from '../where.js';
import { agent } from './fixtures.js';

describe('buildAgentsWhere', () => {
  it('marks multi-agent projects and aligns cells to agent order', () => {
    const projects = [
      {
        project: 'solo',
        repoId: 'r-solo',
        byAgent: [agent('claude-code', { sessions: 1, toolCalls: 1, lines: { added: 5, removed: 0 } })],
      },
      {
        project: 'both',
        repoId: 'r-both',
        byAgent: [
          agent('claude-code', { sessions: 2, toolCalls: 4, lines: { added: 20, removed: 2 } }),
          agent('codex', { sessions: 1, toolCalls: 2, lines: { added: 3, removed: 1 } }),
        ],
      },
    ] as ProjectRollup[];

    const rows = buildAgentsWhere(projects, ['claude-code', 'codex']);
    expect(rows[0].project).toBe('both');
    expect(rows[0].multi).toBe(true);
    expect(rows[0].cells[1].empty).toBe(false);
    expect(rows[1].cells[1].empty).toBe(true);
  });
});

/**
 * The three measurements every other verdict module reads off an agent row.
 *
 * They live together because they must agree: `rankAgents` decides the column order
 * for the matrix, the coverage ledger, the Where split, and the Outcomes panel, and
 * it ranks on `agentEditVolume`, so a change to what counts as measured volume has
 * to move all four at once or the columns stop lining up between panels.
 */
import type { AgentRollup } from '../../../lib/apiSchemas.js';
import { getToolMeta } from '../../../lib/toolMeta.js';

/** Edit-line volume; null when unmeasured (never treat as 0). */
export function agentEditVolume(a: AgentRollup): number | null {
  if (a.lines == null) return null;
  return a.lines.added + a.lines.removed;
}

/** The share of an agent's calls its error rate could actually observe, or null when the
 *  agent reports no error results at all. */
export function errorCoverage(a: AgentRollup): number | null {
  const e = a.errorRate;
  if (!e || e.calls === 0 || e.returned === 0) return null;
  return e.returned / e.calls;
}

/** Sort agents: edit volume desc, then tool calls, then label. */
export function rankAgents(byAgent: AgentRollup[]): AgentRollup[] {
  return [...byAgent].sort((a, b) => {
    const va = agentEditVolume(a) ?? -1;
    const vb = agentEditVolume(b) ?? -1;
    if (vb !== va) return vb - va;
    if (b.toolCalls !== a.toolCalls) return b.toolCalls - a.toolCalls;
    return getToolMeta(a.agent).label.localeCompare(getToolMeta(b.agent).label);
  });
}

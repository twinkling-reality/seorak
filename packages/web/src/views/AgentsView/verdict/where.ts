/**
 * The Where panel: edit volume per repo per agent. Keyed by repo rather than by
 * metric, which is why it is the one table with no disclosures of its own — it makes
 * no cross-tool claim, it just says where the work landed.
 */
import type { ProjectRollup } from '../../../lib/apiSchemas.js';
import { getToolMeta } from '../../../lib/toolMeta.js';
import { count, fmtCount } from '../../../lib/voice/index.js';

import { dash, text, type MatrixCell } from './cells.js';
import { agentEditVolume } from './metrics.js';

export interface WhereProjectRow {
  repoId: string;
  project: string;
  agentLabels: string;
  /** Per-agent edit volume strings aligned to matrix agent order, or — */
  cells: MatrixCell[];
  multi: boolean;
}

export function buildAgentsWhere(
  projects: ProjectRollup[],
  agentOrder: string[],
): WhereProjectRow[] {
  const withAgents = projects.filter((p) => p.byAgent.length > 0);
  return withAgents
    .map((p) => {
      const cells = agentOrder.map((agentId) => {
        const row = p.byAgent.find((a) => a.agent === agentId);
        if (!row) return dash();
        const vol = agentEditVolume(row);
        if (vol == null) {
          return row.sessions > 0 ? text(count(row.sessions, 'session')) : dash();
        }
        return text(`+${fmtCount(row.lines!.added)} / −${fmtCount(row.lines!.removed)}`);
      });
      return {
        repoId: p.repoId,
        project: p.project,
        agentLabels: p.byAgent.map((a) => getToolMeta(a.agent).label).join(', '),
        cells,
        multi: p.byAgent.length > 1,
      };
    })
    .sort((a, b) => Number(b.multi) - Number(a.multi) || a.project.localeCompare(b.project));
}

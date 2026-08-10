/**
 * The Why panel: the side-by-side on what both tools can report honestly, and the
 * disclosures that keep the error row from being read as a ranking.
 */
import type { AgentRollup } from '../../../lib/apiSchemas.js';
import { getToolMeta } from '../../../lib/toolMeta.js';
import { count, fmtCount, formatCost, formatTokens, naturalList } from '../../../lib/voice/index.js';

import { dash, text, type MatrixRow } from './cells.js';
import { errorCoverage, rankAgents } from './metrics.js';

export interface AgentsMatrix {
  agents: Array<{ id: string; label: string }>;
  rows: MatrixRow[];
  /** Plain-language disclosures under the table, same contract as the outcomes
   *  table's: every way this compare could mislead, said out loud. Never a hover. */
  disclosures: string[];
}

/**
 * A rate as a percent, to one decimal, with a floor that refuses to print a fabricated
 * zero. The house convention elsewhere is `Math.round(x * 100)`, which is right for a
 * share of tokens but wrong here: an error rate of 0.4% would round to "0%" and read as
 * "nothing ever fails", which is the silent-zero ban wearing a rounding error's face. A
 * genuine zero (no call errored) still prints 0%, because that one IS the measurement.
 */
function ratePercent(rate: number): string {
  if (rate > 0 && rate < 0.001) return '<0.1%';
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Fair-cell matrix. Cost/tokens stay — when an agent has no measured value
 * (silent-zero ban). Never invents a better/worse column.
 */
export function buildAgentsMatrix(byAgent: AgentRollup[]): AgentsMatrix {
  const agents = rankAgents(byAgent);
  const cols = agents.map((a) => ({
    id: a.agent,
    label: getToolMeta(a.agent).label,
  }));

  const rows: MatrixRow[] = [
    {
      id: 'edit-lines',
      label: 'Edit lines',
      hint: 'On-machine edit-tool line counts. The fairest cross-tool compare today.',
      cells: agents.map((a) => {
        if (a.lines == null) return dash();
        return text(`+${fmtCount(a.lines.added)} / −${fmtCount(a.lines.removed)}`);
      }),
    },
    {
      id: 'sessions',
      label: 'Sessions',
      hint: 'Sessions in this window keyed by agent.',
      cells: agents.map((a) => text(fmtCount(a.sessions))),
    },
    {
      id: 'tool-calls',
      label: 'Tool calls',
      hint: 'Call volume. Can diverge from edit-line share.',
      cells: agents.map((a) => text(fmtCount(a.toolCalls))),
    },
    {
      id: 'cost',
      label: 'Estimated cost',
      hint: 'Derived estimate when the agent emits priced tokens. Never a fabricated $0.',
      cells: agents.map((a) =>
        a.costUsd != null ? text(formatCost(a.costUsd, 2)) : dash(),
      ),
    },
    {
      id: 'tokens',
      label: 'Tokens',
      hint: 'Input + output when the agent emits tokens. Absent agents stay empty.',
      cells: agents.map((a) =>
        a.tokensTotal > 0 ? text(formatTokens(a.tokensTotal)) : dash(),
      ),
    },
    {
      id: 'tool-errors',
      label: 'Tool errors',
      hint: 'Errored calls over calls that reported a result. Both legs are counts, because a rate whose denominator you cannot see is not a measurement. A tool that reports on only some of its calls is disclosed under the table.',
      cells: agents.map((a) => {
        const e = a.errorRate;
        if (!e || e.rate === null) return dash();
        // Both legs, always. "3.6%" alone hides that the denominators differ between
        // agents, which is the whole hazard on this row.
        return text(`${ratePercent(e.rate)} (${fmtCount(e.errored)} of ${fmtCount(e.returned)})`);
      }),
    },
  ];

  return { agents: cols, rows, disclosures: matrixDisclosures(agents) };
}

/**
 * What this table cannot see, said under it rather than left for the reader to infer.
 *
 * The one that matters here is the error row. Claude observes a result on every tool it
 * runs; Codex observes one only on its shell calls, because its `exec` sandbox reports
 * nothing but "Script completed" and its patch events are success-only. So the two rates
 * are both real and are NOT measured over the same work, and a reader who scans the row
 * and concludes "Codex errors less" has been misled by a table we built. Say it plainly.
 */
function matrixDisclosures(agents: AgentRollup[]): string[] {
  const out: string[] = [];

  const partial = agents.filter((a) => {
    const c = errorCoverage(a);
    return c !== null && c < 0.995;
  });
  const full = agents.filter((a) => {
    const c = errorCoverage(a);
    return c !== null && c >= 0.995;
  });

  for (const a of partial) {
    const e = a.errorRate!;
    const label = getToolMeta(a.agent).label;
    const others = full.map((f) => getToolMeta(f.agent).label);
    const share = Math.round((e.returned / e.calls) * 100);
    const scope = `${label} only tells you how a call went on ${fmtCount(e.returned)} of the ${fmtCount(e.calls)} calls it made, so its error rate covers ${share}% of its work and says nothing about the rest.`;
    out.push(
      others.length > 0
        ? `${scope} ${naturalList(others)} ${others.length > 1 ? 'report' : 'reports'} on everything ${others.length > 1 ? 'they run' : 'it runs'}. Both rates are real, but they are not measured over the same work, so the lower one is not the better one.`
        : `${scope} Read it as a fact about those calls, not about everything it did.`,
    );
  }

  // An agent that ran calls but never reported a single result. Different cell from
  // "this tool has no error concept": we watched the work and it told us nothing.
  const silent = agents.filter((a) => a.errorRate && a.errorRate.returned === 0 && a.errorRate.calls > 0);
  for (const a of silent) {
    out.push(
      `${getToolMeta(a.agent).label} made ${count(a.errorRate!.calls, 'tool call')} in this window and none of them reported whether it worked, so it has no error rate rather than a zero one.`,
    );
  }

  return out;
}

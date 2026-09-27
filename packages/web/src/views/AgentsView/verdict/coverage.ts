// ── Coverage ledger — the reporting contract per agent, one row per leg ──

import type { AgentRollup } from '../../../lib/apiSchemas.js';
import { fmtCount } from '../../../lib/voice/index.js';

import { errorCoverage, rankAgents } from './metrics.js';

/**
 * `partial` is a THIRD state and not a shade of the other two, for the same reason "none"
 * and "unknown" are different cells: a tool that reports a result on 44% of its calls has
 * neither captured the leg nor failed to. Folding it into `can` claims a completeness it
 * does not have; folding it into `cannot` throws away a real measurement.
 */
export type CoverageTone = 'can' | 'partial' | 'cannot';

export interface CoverageCell {
  text: string;
  tone: CoverageTone;
}

export interface CoverageRow {
  id: string;
  label: string;
  hint: string;
  cells: CoverageCell[];
}

function can(text: string): CoverageCell {
  return { text, tone: 'can' };
}

function cannot(text: string): CoverageCell {
  return { text, tone: 'cannot' };
}

function partial(text: string): CoverageCell {
  return { text, tone: 'partial' };
}

type CurrentSessionCapabilities = AgentRollup['capabilities'];

/**
 * The capability ledger: what each agent's capture reports today and what it
 * cannot — the factual reason behind every empty compare cell. Contract legs
 * read the agent's latest declared capabilities; the error row pairs the
 * contract with the measured `errorRate` legs so "observable in principle" is
 * never dressed as "captured". The current worker resolves every stored session
 * to this complete ledger before the response reaches the web.
 */
export function buildAgentsCoverage(byAgent: AgentRollup[]): CoverageRow[] {
  const agents = rankAgents(byAgent);
  const cell = (
    a: AgentRollup,
    pick: (caps: CurrentSessionCapabilities, agent: AgentRollup) => CoverageCell,
  ): CoverageCell => pick(a.capabilities, a);

  return [
    {
      id: 'tokens',
      label: 'Tokens',
      hint: 'Whether the tool reports input and output token counts.',
      cells: agents.map((a) =>
        cell(a, (c) => (c.hasTokens ? can('reported') : cannot('not reported'))),
      ),
    },
    {
      id: 'cache-split',
      label: 'Cache split',
      hint: 'Cache-read tokens reported separately, what the cache reuse stat needs.',
      cells: agents.map((a) =>
        cell(a, (c) => (c.hasCacheTokens ? can('reported') : cannot('not reported'))),
      ),
    },
    {
      id: 'cost',
      label: 'Cost',
      hint: 'A dollar figure exists only where tokens can price it. Never a bill, never a stand-in $0.',
      cells: agents.map((a) =>
        cell(a, (c) =>
          c.cost === 'none' ? cannot('no dollar path') : can('derived from tokens'),
        ),
      ),
    },
    {
      id: 'tool-errors',
      label: 'Tool errors',
      hint: 'A rate needs both result legs. A tool that reports on only some of the calls it makes shows the share it could actually see, because a partial rate read as a complete one is the most damaging cell on this page.',
      cells: agents.map((a) =>
        cell(a, (c, agent) => {
          if (c.toolResult === 'both') {
            if (!agent.errorRate) return cannot('observable, not captured yet');
            const coverage = errorCoverage(agent);
            // Nothing landed this window. Observable in principle, not captured in fact.
            if (coverage === null) return cannot('observable, not captured yet');
            // PARTIAL, and this is the cell that would otherwise lie. Before this branch
            // existed, ANY agent with a single errored flag read "pass and fail captured",
            // which for a tool covering 44% of its calls is a falsehood told with real
            // data. Codex reports a result on its shell calls and on nothing else.
            if (coverage < 0.995) {
              const e = agent.errorRate;
              return partial(`on ${fmtCount(e.returned)} of ${fmtCount(e.calls)} calls`);
            }
            return can('pass and fail captured');
          }
          if (c.toolResult === 'failures-only') return cannot('failures only');
          if (c.toolResult === 'passes-only') return cannot('passes only');
          return cannot('no result data');
        }),
      ),
    },
    {
      id: 'verification',
      label: 'Verification runs',
      hint: 'Test, build, typecheck, lint pass rates. Success-only results would pin a fabricated 100%, so the rate stays off until both legs exist.',
      cells: agents.map((a) =>
        cell(a, (c) => {
          if (c.verification === 'both') return can('pass and fail runs');
          if (c.verification === 'failures-only') return cannot('failures only');
          if (c.verification === 'passes-only') return cannot('passes only');
          return cannot('no result data');
        }),
      ),
    },
    {
      id: 'end-reason',
      label: 'End reason',
      hint: 'Whether the tool says why a session ended.',
      cells: agents.map((a) =>
        cell(a, (c) => {
          if (c.endReason === true) return can('reports why it ended');
          return cannot('no recorded end');
        }),
      ),
    },
    {
      id: 'duration',
      label: 'Duration',
      hint: 'Measured end vs an idle-horizon estimate from the sweep that closes quiet sessions.',
      cells: agents.map((a) =>
        cell(a, (c) => {
          if (c.duration === 'measured') return can('measured end');
          return cannot('inferred from idle');
        }),
      ),
    },
  ];
}

// ── Cadence: when each tool's calls land, in the viewer's clock ──
//
// Split out because two unrelated surfaces depend on the SAME hour-shift: the When
// chart buckets calls into local hours, and the verdict's cadence sentence buckets
// them into local dayparts. If those two disagreed by an hour the chart would show a
// peak the sentence does not name.
//
// The daypart table and the hour shift now live in lib/localTime.ts, because the
// Model portrait needs the same two and had drifted its own copy. This module keeps
// only what is about AGENTS.

import type { AgentHourPoint } from '../../../lib/apiSchemas.js';
import { DAYPART_IDS, daypartOf, localHourOf } from '../../../lib/localTime.js';
import type { DaypartId } from '../../../lib/localTime.js';

export { daypartMeta, localHourOf } from '../../../lib/localTime.js';
export type { DaypartId } from '../../../lib/localTime.js';

/** An agent must carry at least this many in-window calls before its clock
 *  pattern is spoken — a handful of calls is not a cadence. */
export const CADENCE_MIN_CALLS = 24;
/** The top daypart must hold at least this share of the agent's own calls. */
export const CADENCE_SHARE = 0.5;

export interface AgentCadence {
  agent: string;
  calls: number;
  top: DaypartId;
  topCalls: number;
  topShare: number;
}

/** Per-agent daypart concentration from the UTC hour buckets, in the viewer's
 *  clock. Pure: the offset is injected (tests pin it; the view passes
 *  new Date().getTimezoneOffset()). */
export function agentCadences(
  agentHourly: AgentHourPoint[],
  offsetMinutes: number,
): AgentCadence[] {
  const perAgent = new Map<string, Map<DaypartId, number>>();
  const totals = new Map<string, number>();
  for (const point of agentHourly) {
    const part = daypartOf(localHourOf(point.hour, offsetMinutes));
    let parts = perAgent.get(point.agent);
    if (!parts) {
      parts = new Map();
      perAgent.set(point.agent, parts);
    }
    parts.set(part, (parts.get(part) ?? 0) + point.calls);
    totals.set(point.agent, (totals.get(point.agent) ?? 0) + point.calls);
  }
  const out: AgentCadence[] = [];
  for (const [agent, parts] of perAgent) {
    const calls = totals.get(agent) ?? 0;
    if (calls === 0) continue;
    let top: DaypartId = 'morning';
    let topCalls = -1;
    // Iterated in DAYPART_IDS order, not map order, so a tie resolves to the
    // earlier daypart deterministically rather than to whichever landed first.
    for (const id of DAYPART_IDS) {
      const n = parts.get(id) ?? 0;
      if (n > topCalls) {
        top = id;
        topCalls = n;
      }
    }
    out.push({ agent, calls, top, topCalls, topShare: topCalls / calls });
  }
  return out;
}

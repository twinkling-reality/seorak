// ── History series — past activity by day + clock hour, chart-ready ──

import type { AgentDailyPoint, AgentHourPoint, AgentRollup } from '../../../lib/apiSchemas.js';

import { localHourOf } from './clock.js';
import { agentRecordStarts } from './record.js';

export interface AgentsHistorySeries {
  /** Matrix agent order (leader first). */
  agents: string[];
  /** Full day spine, oldest → newest, over the picked window (UTC dates). */
  days: string[];
  /** sessions[dayIndex][agentIndex] — distinct sessions started (a real 0). */
  sessions: number[][];
  /** lines[dayIndex][agentIndex] — added+removed edit-line volume; null means
   *  the tool ran that day without reporting line counts (never a zero). */
  lines: (number | null)[][];
  /** hourly[localHour][agentIndex] — tool calls by the VIEWER's clock hour. */
  hourly: number[][];
  /**
   * recordStart[agentIndex] — the index into `days` where that agent's record BEGINS, 0 if
   * it predates the window, null if unknown. Without this the zero-filled spine below is a
   * lie: it hands every agent a 0 on every day, so a day Seorak was not watching a tool and
   * a day the tool did nothing come out of this function completely indistinguishable.
   */
  recordStart: (number | null)[];
  maxSessions: number;
  maxLines: number;
  maxHourly: number;
}

/**
 * Chart-ready per-agent history from `tools.agentDaily` + `activity.agentHourly`.
 * PAST ACTIVITY ONLY. The day spine is materialized so quiet days render as
 * honest gaps; a day absent from agentDaily is a measured nothing (sessions 0,
 * lines 0), while a present day whose lines are null stays null (ran, didn't
 * report). `nowMs` and the viewer offset are injected for purity.
 *
 * `byAgent` is here ONLY for `firstSeenAt`, and it is not optional in spirit: the zero-fill
 * above is only honest because `recordStart` tells the renderer which of those zeros were
 * never observed at all.
 */
export function buildAgentsHistory(
  agentDaily: AgentDailyPoint[],
  agentHourly: AgentHourPoint[],
  agentOrder: string[],
  rangeDays: number,
  nowMs: number,
  offsetMinutes: number,
  byAgent: AgentRollup[] = [],
): AgentsHistorySeries {
  const dayMs = 24 * 60 * 60 * 1000;
  const spineDays = Math.min(rangeDays, 90);
  const days: string[] = [];
  for (let i = spineDays - 1; i >= 0; i -= 1) {
    days.push(new Date(nowMs - i * dayMs).toISOString().slice(0, 10));
  }
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const agentIndex = new Map(agentOrder.map((a, i) => [a, i]));

  const sessions = days.map(() => agentOrder.map(() => 0));
  const lines = days.map(() => agentOrder.map<number | null>(() => 0));
  for (const p of agentDaily) {
    const di = dayIndex.get(p.day);
    const ai = agentIndex.get(p.agent);
    if (di === undefined || ai === undefined) continue;
    sessions[di][ai] = p.sessions;
    lines[di][ai] = p.lines === null ? null : p.lines.added + p.lines.removed;
  }

  const hourly = Array.from({ length: 24 }, () => agentOrder.map(() => 0));
  for (const p of agentHourly) {
    const ai = agentIndex.get(p.agent);
    if (ai === undefined) continue;
    hourly[localHourOf(p.hour, offsetMinutes)][ai] += p.calls;
  }

  const maxSessions = Math.max(0, ...sessions.flat());
  const maxLines = Math.max(0, ...lines.flat().map((v) => v ?? 0));
  const maxHourly = Math.max(0, ...hourly.flat());
  return {
    agents: agentOrder,
    days,
    sessions,
    lines,
    hourly,
    recordStart: agentRecordStarts(agentOrder, byAgent, days),
    maxSessions,
    maxLines,
    maxHourly,
  };
}

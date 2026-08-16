// Synthetic event-log / deep-capture fields (DEMO ONLY).
// These fields need either a retained event log (daily trends, hourly heatmap,
// end reasons) or deeper per-call / per-model capture the collector does not
// emit (per-tool split, per-model spend). The live path ships them empty; demo
// fabricates them so every widget has a populated state to render.

import type {
  DailyPoint,
  HourBucket,
  ToolCallRollup,
  ModelRollup,
  EndReasonCount,
  DailyEndReasons,
  HourlyEndReasons,
} from '@seorak/types';
import {
  wobble,
  hash,
  allocateIntegerShares,
  buildDaySpine,
  weekdayWeight,
} from '../rng.js';

export function buildDailyTrends(periodDays: number): DailyPoint[] {
  return buildDaySpine(periodDays).map((day, i) => {
    const weight = weekdayWeight(day);
    const sessions = Math.round(wobble(i * 3 + 11, 6, 3) * weight);
    // Honor the DailyPoint contract: costUsd is null (never 0 as a stand-in)
    // on a zero-session day, so the cost trend reads "no data" not "$0".
    const costUsd = sessions === 0 ? null : Math.round(sessions * (1.4 + hash(i * 5 + 2)) * 100) / 100;
    return { day, sessions, costUsd };
  });
}

// 7×24 session-count grid, peaking during weekday working hours.
export function buildHourlyDistribution(): HourBucket[] {
  const out: HourBucket[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const dayWeight = dow >= 1 && dow <= 5 ? 1.0 : 0.3;
    for (let hour = 0; hour < 24; hour++) {
      // Working-hours hump centered ~14:00.
      const workHump = Math.max(0, 1 - Math.abs(hour - 14) / 9);
      const sessions = Math.round(wobble(dow * 24 + hour + 100, 5, 4) * dayWeight * workHump);
      out.push({ dow, hour, sessions });
    }
  }
  return out;
}

// Per-tool call split — allocated against the real total tool-call count so the
// shares sum exactly to the headline number.
export function buildByTool(totalCalls: number): ToolCallRollup[] {
  // TEN tools on purpose: past the strip's top-7 fold, so the demo
  // exercises the "+N more" tail state (demo fixtures exist to exercise
  // every widget state, the overflow protocol's included).
  //
  // `other` is in the list because PRODUCTION SENDS IT. It is the aggregate
  // remainder for calls whose tool name the rollup did not keep, and on a real
  // window it is the second largest entry by call count. Omitting it here let the
  // Model portrait rank it as a tool and print "you spent more of it Bash and
  // Other than anything else" to a real reader, with every test green — a fixture
  // shaped by what we expected instead of what the sender emits cannot catch a
  // bug of this kind, it hides one.
  const tools = [
    { tool: 'Read', share: 30, sessions: 4 },
    { tool: 'other', share: 20, sessions: 4 },
    { tool: 'Edit', share: 22, sessions: 4 },
    { tool: 'Bash', share: 19, sessions: 4 },
    { tool: 'Grep', share: 11, sessions: 3 },
    { tool: 'Write', share: 7, sessions: 3 },
    { tool: 'TodoWrite', share: 4, sessions: 2 },
    { tool: 'WebFetch', share: 3, sessions: 2 },
    { tool: 'Glob', share: 2, sessions: 2 },
    { tool: 'Task', share: 2, sessions: 1 },
  ];
  const calls = allocateIntegerShares(totalCalls, tools.map((t) => t.share));
  return tools
    .map((t, i) => ({ tool: t.tool, calls: calls[i] ?? 0, sessions: t.sessions }))
    .filter((t) => t.calls > 0)
    .sort((a, b) => b.calls - a.calls);
}

// Per-model spend split, summing to the live board's real cost. Full minor
// versions, matching what a collector actually reports (the collector's own
// CURRENT_MODEL_IDS guard) — a bare `claude-opus-4` is a MODEL_PRICES family
// key, not an id any transcript carries.
export function buildByModel(totalCalls: number, totalCost: number): ModelRollup[] {
  const models = [
    { model: 'claude-opus-4-8', share: 58 },
    { model: 'claude-sonnet-4-6', share: 34 },
    { model: 'claude-haiku-4-5', share: 8 },
  ];
  const callSplit = allocateIntegerShares(totalCalls, models.map((m) => m.share));
  const sumShares = models.reduce((s, m) => s + m.share, 0);
  // Cents get the same largest-remainder split as calls so the rows SUM EXACTLY
  // to the cost they divide: independent per-row rounding drifts a penny on some
  // window totals, and a demo whose numbers do not add up teaches the reader to
  // distrust the real one.
  const centSplit = allocateIntegerShares(Math.round(totalCost * 100), models.map((m) => m.share));
  // Tokens track the same shares (small wobble) so calls, tokens, and cost tell
  // one story — and Opus holds a real majority for the models pairing sentence.
  return models.map((m, i) => ({
    model: m.model,
    calls: callSplit[i] ?? 0,
    tokensTotal: Math.round((360_000 * m.share) / sumShares) + wobble(i * 9 + 70, 6_000, 3_000),
    costUsd: (centSplit[i] ?? 0) / 100,
  }));
}

export function buildEndReasons(): EndReasonCount[] {
  return [
    { reason: 'clear', count: 38 },
    { reason: 'resume', count: 11 },
    { reason: 'logout', count: 4 },
    { reason: 'other', count: 2 },
  ];
}

// "How sessions ended, day by day" (DEMO ONLY) — a per-day reason mix over the
// window, weekday-weighted so the trend reads like a real working rhythm. Days
// with no ends are OMITTED (honest-empty: no zero-filled spine), mostly cleared
// with a few resume/logout/other, mirroring the point-in-time ring. The LIVE path
// derives this from the event log's session.end rows, honest-empty until ends land.
export function buildEndReasonsByDay(periodDays: number): DailyEndReasons[] {
  const out: DailyEndReasons[] = [];
  buildDaySpine(periodDays).forEach((day, i) => {
    const ended = Math.round(wobble(i * 7 + 3, 5, 2) * weekdayWeight(day));
    if (ended === 0) return; // no ends that day → omit (honest-empty)
    const clear = Math.max(1, Math.round(ended * 0.7));
    const resume = Math.round(ended * 0.2);
    const rest = Math.max(0, ended - clear - resume);
    const reasons: EndReasonCount[] = [{ reason: 'clear', count: clear }];
    if (resume > 0) reasons.push({ reason: 'resume', count: resume });
    if (rest > 0) reasons.push({ reason: i % 3 === 0 ? 'logout' : 'other', count: rest });
    out.push({ day, reasons });
  });
  return out;
}

// "How sessions ended, by hour" (DEMO ONLY) — a per-hour reason mix humped on
// late-afternoon/evening wrap-ups. Hours with no ends are OMITTED (honest-empty,
// no zero-filled 24-spine). A CADENCE lens, never an effectiveness grade. The LIVE
// path derives this from the event log's session.end UTC hours.
export function buildEndReasonsByHour(): HourlyEndReasons[] {
  const out: HourlyEndReasons[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const hump = Math.max(0, 1 - Math.abs(hour - 15) / 8);
    const ended = Math.round(wobble(hour + 50, 4, 2) * hump);
    if (ended === 0) continue;
    const clear = Math.max(1, Math.round(ended * 0.7));
    const rest = Math.max(0, ended - clear);
    const reasons: EndReasonCount[] = [{ reason: 'clear', count: clear }];
    if (rest > 0) reasons.push({ reason: hour % 2 ? 'resume' : 'logout', count: rest });
    out.push({ hour, reasons });
  }
  return out;
}

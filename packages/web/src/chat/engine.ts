/**
 * engine.ts — the chat engine seam + the v1 local stub.
 *
 * `ChatEngine` is the ONLY contract the shell (ChatProvider/ChatPanel) knows:
 * send a ChatRequest, get a ChatResponse. Phase B replaces `createStubChatEngine`
 * with an HTTP engine posting to the worker's /chat orchestrator; nothing in the
 * shell changes (the same one-swap discipline as the terminal's `chat()` stub).
 *
 * The stub answers from the polling store's snapshot — the SAME numbers the
 * dashboard widgets render — via keyword intent routing. Honesty contract
 * (identical to the widget bodies): a null/missing measurement is said plainly
 * ("not measured yet") and cited as `value: null` (rendered "--"); it is NEVER
 * zero-filled, and no number is ever invented. Questions outside the routed
 * intents get an honest "can't answer that yet", not a guess.
 */

import { getSignal } from '@seorak/types';
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatWindowDays,
  Intervention,
  OverviewSnapshot,
  SessionSummary,
  StatCitation,
} from '@seorak/types';

/** The seam every chat backend implements (stub today, worker POST /chat later). */
export interface ChatEngine {
  send(request: ChatRequest): Promise<ChatResponse>;
}

/** What the stub grounds against — the polling store's current snapshot. */
export interface ChatGrounding {
  overview: OverviewSnapshot | null;
  /** The fast /live board; null before the first poll (fall back to overview.live). */
  liveSessions: SessionSummary[] | null;
  interventions: Intervention[];
}

export interface StubAnswer {
  content: string;
  citations: StatCitation[];
}

// ── Formatting (mirrors the widget bodies' display rules) ──────────

function fmtUsd(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function toWindow(days: number | undefined): ChatWindowDays | undefined {
  return days === 7 || days === 30 || days === 90 ? days : undefined;
}

/** Build a citation from the cross-surface catalog; label falls back to the id
 *  so an uncataloged signal never crashes an answer. */
function cite(signalId: string, value: string | null, windowDays?: ChatWindowDays): StatCitation {
  return { signalId, label: getSignal(signalId)?.name ?? signalId, value, windowDays };
}

// ── Intent handlers ────────────────────────────────────────────────

type Handler = (o: OverviewSnapshot, g: ChatGrounding) => StubAnswer;

function liveIntent(o: OverviewSnapshot, g: ChatGrounding): StubAnswer {
  const board = g.liveSessions ?? o.live;
  const running = board.filter((s) => s.status !== 'ended');
  const citations = [cite('live-sessions', `${running.length} running`)];
  if (running.length === 0) {
    return { content: 'Nothing is running right now.', citations };
  }
  let content = `${plural(running.length, 'session')} running right now.`;
  const needsYou = running.find((s) => s.awaitingInput);
  const stuck = running.find((s) => s.status === 'stuck');
  if (needsYou) content += ` ${needsYou.project || 'One'} is waiting on you.`;
  else if (stuck) content += ` ${stuck.project || 'One'} looks stuck.`;
  return { content, citations };
}

function costIntent(o: OverviewSnapshot): StubAnswer {
  const days = toWindow(o.rangeDays);
  const { totalUsd, sessionsWithCost, delta } = o.usage.cost;
  if (totalUsd === null) {
    return {
      content: `No measured cost in the last ${o.rangeDays} days. Cost fills in once sessions report token usage.`,
      citations: [cite('cost', null, days)],
    };
  }
  let content = `You spent an estimated ${fmtUsd(totalUsd)} across ${plural(sessionsWithCost, 'session')} that reported token usage in the last ${o.rangeDays} days. That is derived from token counts at list prices, not a bill.`;
  if (delta && delta.previous !== null) {
    const dir =
      delta.current > delta.previous ? 'up from' : delta.current < delta.previous ? 'down from' : 'level with';
    content += ` That is ${dir} ${fmtUsd(delta.previous)} the ${o.rangeDays} days before.`;
  }
  return { content, citations: [cite('cost', fmtUsd(totalUsd), days)] };
}

function sessionsIntent(o: OverviewSnapshot): StubAnswer {
  const days = toWindow(o.rangeDays);
  const n = o.usage.totals.sessions;
  if (n === 0) {
    return {
      content: `No sessions in the last ${o.rangeDays} days.`,
      citations: [cite('sessions', '0', days)],
    };
  }
  const { activeCount, endedCount } = o.outcomes;
  return {
    content: `${plural(n, 'session')} in the last ${o.rangeDays} days. ${endedCount} ended, ${activeCount} still in flight.`,
    citations: [cite('sessions', String(n), days)],
  };
}

function shipIntent(o: OverviewSnapshot): StubAnswer {
  const days = toWindow(o.rangeDays);
  const rate = o.outcomes.shipRate;
  if (rate === null) {
    return {
      content: `Not enough ended sessions to measure ship rate in the last ${o.rangeDays} days yet.`,
      citations: [cite('ship-rate', null, days)],
    };
  }
  return {
    content: `Ship rate is ${fmtPct(rate)} for the last ${o.rangeDays} days. That is the share of ended sessions where a commit landed, counting only sessions where Seorak could tell.`,
    citations: [cite('ship-rate', fmtPct(rate), days)],
  };
}

function survivalIntent(o: OverviewSnapshot): StubAnswer {
  const days = toWindow(o.rangeDays);
  const ls = o.outcomes.lineSurvival;
  if (ls.rate === null) {
    return {
      content: 'Line survival has not matured yet. It needs a few checked commits before the rate is honest.',
      citations: [cite('line-survival', null, days)],
    };
  }
  return {
    content: `Line survival is ${fmtPct(ls.rate)} for the last ${o.rangeDays} days. ${ls.linesSurviving} of ${ls.linesAuthored} lines written are still on the branch, across ${plural(ls.sessionsRated, 'matured session')}.`,
    citations: [cite('line-survival', fmtPct(ls.rate), days)],
  };
}

function stuckIntent(o: OverviewSnapshot): StubAnswer {
  const days = toWindow(o.rangeDays);
  const { stuckness, oneShotRate, activeCount } = o.outcomes;
  let content: string;
  if (stuckness.stuckCount > 0) {
    content = `${plural(stuckness.stuckCount, 'in-flight session')} look${stuckness.stuckCount === 1 ? 's' : ''} stuck right now.`;
  } else if (activeCount === 0) {
    content = 'Nothing is in flight right now.';
  } else {
    content = 'Nothing looks stuck right now.';
  }
  if (oneShotRate !== null) {
    content += ` ${fmtPct(oneShotRate)} of your ended sessions ran without a retry loop in the last ${o.rangeDays} days.`;
  } else {
    content += ' Retry-loop data needs more ended sessions before it says anything.';
  }
  return {
    content,
    citations: [
      cite('stuckness', stuckness.rate !== null || stuckness.stuckCount > 0 ? `${stuckness.stuckCount} stuck` : null),
      cite('one-shot-rate', oneShotRate !== null ? fmtPct(oneShotRate) : null, days),
    ],
  };
}

function cacheIntent(o: OverviewSnapshot): StubAnswer {
  const days = toWindow(o.rangeDays);
  const ratio = o.usage.cacheReuseRatio;
  if (ratio === null) {
    return {
      content: 'Context reuse is not measured yet. It fills in once sessions report token usage.',
      citations: [cite('cache-reuse', null, days)],
    };
  }
  return {
    content: `Context reuse was ${fmtPct(ratio)} in the last ${o.rangeDays} days. That is the share of input your sessions read from cache instead of fresh tokens.`,
    citations: [cite('cache-reuse', fmtPct(ratio), days)],
  };
}

function projectsIntent(o: OverviewSnapshot): StubAnswer {
  const days = toWindow(o.rangeDays);
  const projects = o.usage.projects;
  if (projects.length === 0) {
    return {
      content: `No repo activity in the last ${o.rangeDays} days.`,
      citations: [cite('projects', null, days)],
    };
  }
  const byActivity = [...projects].sort((a, b) => b.sessions - a.sessions);
  const citations = [cite('projects', plural(projects.length, 'repo'), days)];
  if (projects.length === 1) {
    return {
      content: `All your sessions in the last ${o.rangeDays} days were in ${byActivity[0].project}.`,
      citations,
    };
  }
  const top = byActivity
    .slice(0, 3)
    .map((p) => `${p.project} (${plural(p.sessions, 'session')})`)
    .join(', ');
  return {
    content: `You worked in ${plural(projects.length, 'repo')} in the last ${o.rangeDays} days. Most active: ${top}.`,
    citations,
  };
}

function interventionsIntent(_o: OverviewSnapshot, g: ChatGrounding): StubAnswer {
  if (g.interventions.length === 0) {
    return {
      content: 'Seorak has not needed to notify you recently. Nothing has crossed a watch threshold.',
      citations: [],
    };
  }
  const latest = [...g.interventions].sort(
    (a, b) => Date.parse(b.triggeredAt) - Date.parse(a.triggeredAt),
  )[0];
  return {
    content: `Seorak notified you ${g.interventions.length === 1 ? 'once' : `${g.interventions.length} times`} recently. Latest: ${latest.signalLabel} on ${latest.project}.`,
    citations: [],
  };
}

function hoursIntent(o: OverviewSnapshot): StubAnswer {
  const days = toWindow(o.rangeDays);
  const buckets = o.activity.hourlyDistribution;
  if (buckets.length === 0) {
    return {
      content: 'Not enough session history to show a time-of-day pattern yet.',
      citations: [cite('heatmap', null, days)],
    };
  }
  const byHour = new Map<number, number>();
  for (const b of buckets) byHour.set(b.hour, (byHour.get(b.hour) ?? 0) + b.sessions);
  let peakHour = 0;
  let peakCount = 0;
  for (const [hour, count] of byHour) {
    if (count > peakCount) {
      peakHour = hour;
      peakCount = count;
    }
  }
  const hh = String(peakHour).padStart(2, '0');
  return {
    // Buckets are UTC clock hours (the dashboard's known caveat) — say so
    // rather than passing a UTC hour off as local time.
    content: `Your sessions most often start around ${hh}:00 UTC. ${plural(peakCount, 'session')} started in that hour over the last ${o.rangeDays} days.`,
    citations: [cite('heatmap', `${hh}:00 UTC`, days)],
  };
}

const HELP_CONTENT =
  'I answer questions grounded in your own record: cost, sessions, ship rate, line survival, retry loops, context reuse, repos, notifications, and what is live right now.';

const FALLBACK_CONTENT =
  'I cannot answer that yet. This early version handles direct stat questions. Try "what did I spend", "how many sessions", "is anything running", or "did my work ship".';

/** Ordered intent table — first pattern match wins. Specific intents come
 *  before the broad `sessions` catch so "did my sessions ship" routes to ship. */
const INTENTS: Array<{ pattern: RegExp; handle: Handler }> = [
  { pattern: /\b(live|running|right now|in flight|active)\b/, handle: liveIntent },
  { pattern: /\b(cost|spen[dt]|price|bill|dollar|usd)\b|\$/, handle: costIntent },
  { pattern: /\b(ship|shipped|commit|landed)\b/, handle: shipIntent },
  { pattern: /surviv|overwritten|changed back|still on the branch/, handle: survivalIntent },
  { pattern: /\b(stuck|loop|retr(y|ies|ied)|spinning)\b/, handle: stuckIntent },
  { pattern: /\b(cache|context reuse|reuse)\b/, handle: cacheIntent },
  { pattern: /\b(project|repo|repos|repositories)\b/, handle: projectsIntent },
  { pattern: /\b(notif|alert|interven|nudge|ping)/, handle: interventionsIntent },
  { pattern: /\b(hour|morning|evening|night|time of day|when do i)\b/, handle: hoursIntent },
  { pattern: /\b(session|sessions|how many|how much)\b/, handle: sessionsIntent },
];

/**
 * The pure grounded answerer. Exported for the honesty tests — everything it
 * says traces to a field of the snapshot or is an explicit "not measured /
 * can't answer"; there is no path that invents a number.
 */
export function answerFromSnapshot(question: string, g: ChatGrounding): StubAnswer {
  const q = question.toLowerCase();

  if (/what can you|^help\b|how do you work/.test(q)) {
    return { content: HELP_CONTENT, citations: [] };
  }

  if (!g.overview) {
    return {
      content: 'Your record has not loaded yet. Give it a second and ask again.',
      citations: [],
    };
  }

  for (const intent of INTENTS) {
    if (intent.pattern.test(q)) return intent.handle(g.overview, g);
  }
  return { content: FALLBACK_CONTENT, citations: [] };
}

let stubConversationSeq = 0;

/** Dev-only: the first empty-state suggestion uses this text and a built-in pause
 *  so you can preview the thinking shimmer without touching localStorage. */
export const CHAT_DEV_SLOW_SUGGESTION = 'What did I spend this week?';
const CHAT_DEV_SLOW_MS = 3500;

/** Dev-only: `localStorage.setItem('seorak.chatDelayMs', '3000')` delays every
 *  send. Ignored in production builds. */
function chatStubDelayMs(message: string): number {
  if (!import.meta.env.DEV) return 0;
  if (message === CHAT_DEV_SLOW_SUGGESTION) return CHAT_DEV_SLOW_MS;
  try {
    const raw = localStorage.getItem('seorak.chatDelayMs');
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function maybeChatStubDelay(message: string): Promise<void> {
  const ms = chatStubDelayMs(message);
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The v1 engine: answers locally from the polling store snapshot (no network,
 * no LLM). `getGrounding` is read fresh on every send so answers always track
 * the latest poll.
 */
export function createStubChatEngine(getGrounding: () => ChatGrounding): ChatEngine {
  const conversationId = `local-${++stubConversationSeq}`;
  let messageSeq = 0;
  return {
    async send(request: ChatRequest): Promise<ChatResponse> {
      await maybeChatStubDelay(request.message);
      const { content, citations } = answerFromSnapshot(request.message, getGrounding());
      const message: ChatMessage = {
        id: `stub-${conversationId}-${++messageSeq}`,
        role: 'assistant',
        content,
        citations: citations.length > 0 ? citations : undefined,
        createdAt: new Date().toISOString(),
      };
      return { message, conversationId: request.conversationId ?? conversationId };
    },
  };
}

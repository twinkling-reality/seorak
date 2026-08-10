// Honesty regression suite for the chat stub engine — the same discipline as
// the widget copy-honesty guards: a missing measurement must surface as an
// explicit null citation + plain "not measured" copy, NEVER a zero-fill or an
// invented number, and the copy must hold the voice rules (no em dashes, no
// "insight" language).

import { describe, expect, it } from 'vitest';
import type { OverviewSnapshot, SessionSummary } from '@seorak/types';
import { createEmptyOverview } from '../../lib/apiSchemas.js';
import { answerFromSnapshot, createStubChatEngine, type ChatGrounding } from '../engine.js';

function ground(
  overview: OverviewSnapshot | null,
  liveSessions: SessionSummary[] | null = null,
): ChatGrounding {
  return { overview, liveSessions, interventions: [] };
}

function liveSession(partial: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: 's-1',
    project: 'seorak',
    repoId: 'r-1',
    agent: 'claude-code',
    status: 'active',
    startedAt: '2026-07-01T10:00:00Z',
    lastEventAt: '2026-07-01T10:05:00Z',
    elapsedSeconds: 300,
    toolCallCount: 4,
    tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
    costUsd: 0.5,
    burnRateUsdPerMin: 0.1,
    ...partial,
  };
}

describe('answerFromSnapshot honesty', () => {
  it('says the record has not loaded instead of answering from nothing', () => {
    const a = answerFromSnapshot('what did I spend?', ground(null));
    expect(a.content).toMatch(/has not loaded/);
    expect(a.citations).toHaveLength(0);
  });

  it('never fabricates a dollar figure when cost is unmeasured', () => {
    const a = answerFromSnapshot('how much did this cost?', ground(createEmptyOverview(7)));
    expect(a.content).toContain('No measured cost in the last 7 days');
    expect(a.content).not.toMatch(/\$\d/);
    expect(a.citations[0]).toMatchObject({ signalId: 'cost', value: null, windowDays: 7 });
  });

  it('reports a real zero session count as an honest zero, not silence', () => {
    const a = answerFromSnapshot('how many sessions did I run?', ground(createEmptyOverview(7)));
    expect(a.content).toContain('No sessions in the last 7 days');
    expect(a.citations[0]).toMatchObject({ signalId: 'sessions', value: '0' });
  });

  it('declines a ship-rate percentage until it is measurable', () => {
    const a = answerFromSnapshot('did my work ship?', ground(createEmptyOverview(30)));
    expect(a.content).not.toMatch(/\d+%/);
    expect(a.citations[0]).toMatchObject({ signalId: 'ship-rate', value: null });
  });

  it('declines a line-survival percentage below the maturity floor', () => {
    const a = answerFromSnapshot('did my changes survive?', ground(createEmptyOverview(30)));
    expect(a.content).not.toMatch(/\d+%/);
    expect(a.citations[0]).toMatchObject({ signalId: 'line-survival', value: null });
  });

  it('answers cost from the snapshot when it is measured', () => {
    const o = createEmptyOverview(30);
    o.usage.cost = { totalUsd: 12.4, sessionsWithCost: 3, delta: null };
    const a = answerFromSnapshot('what did I spend?', ground(o));
    expect(a.content).toContain('$12.40');
    expect(a.content).toContain('3 sessions');
    expect(a.citations[0]).toMatchObject({ signalId: 'cost', value: '$12.40', windowDays: 30 });
  });

  it('frames one-shot as "ran without a retry loop", never a success rate', () => {
    const o = createEmptyOverview(30);
    o.outcomes.oneShotRate = 0.72;
    const a = answerFromSnapshot('am I stuck in retry loops?', ground(o));
    expect(a.content).toContain('ran without a retry loop');
    expect(a.content).not.toMatch(/first try|success rate/);
  });

  it('labels the busiest hour as UTC instead of passing it off as local time', () => {
    const o = createEmptyOverview(30);
    o.activity.hourlyDistribution = [
      { dow: 1, hour: 9, sessions: 4 },
      { dow: 2, hour: 9, sessions: 3 },
      { dow: 3, hour: 22, sessions: 1 },
    ];
    const a = answerFromSnapshot('what time of day do I work?', ground(o));
    expect(a.content).toContain('09:00 UTC');
  });

  it('counts the live board from the fast /live sessions when present', () => {
    const o = createEmptyOverview(30);
    const live = [
      liveSession({ sessionId: 'a' }),
      liveSession({ sessionId: 'b', status: 'stuck', project: 'juicysticky' }),
      liveSession({ sessionId: 'c', status: 'ended' }),
    ];
    const a = answerFromSnapshot('is anything running right now?', ground(o, live));
    expect(a.content).toContain('2 sessions running');
    expect(a.content).toContain('juicysticky looks stuck');
    expect(a.citations[0]).toMatchObject({ signalId: 'live-sessions', value: '2 running' });
  });

  it('admits when it cannot answer instead of guessing', () => {
    const a = answerFromSnapshot('write me a haiku about git', ground(createEmptyOverview(30)));
    expect(a.content).toContain('I cannot answer that yet');
    expect(a.citations).toHaveLength(0);
  });

  it('holds the voice rules across the whole intent space', () => {
    const questions = [
      'help',
      'what can you answer?',
      'what did I spend this week?',
      'is anything live?',
      'how many sessions?',
      'did my work ship?',
      'did my lines survive?',
      'am I stuck?',
      'how is my context reuse?',
      'which repos did I touch?',
      'why did seorak notify me?',
      'when do I work best?',
      'tell me a joke',
    ];
    for (const empty of [true, false]) {
      const o = createEmptyOverview(7);
      if (!empty) {
        o.usage.totals.sessions = 5;
        o.usage.cost = { totalUsd: 3.2, sessionsWithCost: 4, delta: { current: 3.2, previous: 1.1 } };
        o.outcomes.shipRate = 0.6;
        o.outcomes.oneShotRate = 0.5;
      }
      for (const q of questions) {
        const a = answerFromSnapshot(q, ground(o));
        expect(a.content, q).not.toContain('—'); // no em dashes in copy
        expect(a.content, q).not.toMatch(/insight|supercharge|empower/i);
      }
    }
  });
});

describe('createStubChatEngine', () => {
  it('wraps answers in the ChatResponse contract with a stable conversation id', async () => {
    const engine = createStubChatEngine(() => ground(createEmptyOverview(7)));
    const first = await engine.send({ message: 'how many sessions?' });
    expect(first.message.role).toBe('assistant');
    expect(first.message.content).toContain('No sessions in the last 7 days');
    const second = await engine.send({
      message: 'what did I spend?',
      conversationId: first.conversationId,
    });
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.message.id).not.toBe(first.message.id);
  });
});

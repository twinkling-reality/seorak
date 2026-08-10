/**
 * compilePeriodClarity — PURE. Overview Summary read: annotated prose with
 * facet notes (same interaction language as Model / Agents), contract twin of
 * terminal `windowSentences` for the spoken claims.
 */
import type { OverviewSnapshot, SessionSummary } from '@seorak/types';

import { getToolMeta } from '../lib/toolMeta.js';
import { formatModelLong } from '../lib/modelMeta.js';
import { count, fmtCount, naturalList, plural, windowPhrase } from '../lib/voice/index.js';

const MS_PER_DAY = 86_400_000;

/** Same narrative ramp categories Model / Agents use. */
export type SummaryFacet = 'live' | 'volume' | 'cost' | 'outcome' | 'caveat';

export interface SummaryNote {
  id: string;
  facet: SummaryFacet;
  label: string;
  detail: string;
  citations: string[];
  /** Optional project key for a ProjectSquircle instead of a facet swatch. */
  projectKey?: string;
}

export type SummarySegment =
  | { type: 'text'; text: string }
  | { type: 'term'; noteId: string; term: string };

export interface SummaryParagraph {
  /** Larger lead line (live attention) vs body. */
  role: 'lead' | 'body';
  segments: SummarySegment[];
}

export interface PeriodClarity {
  paragraphs: SummaryParagraph[];
  notes: SummaryNote[];
}

type AgentRow = OverviewSnapshot['tools']['byAgent'][number];

function agentLabel(id: string): string {
  return getToolMeta(id).label;
}

function projectName(project: string): string {
  return project.trim() ? project : 'an unlabeled project';
}

function magnitude(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return fmtCount(n);
}

function usdPhrase(n: number): string {
  return n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}

function pctPhrase(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

function monthDayPhrase(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function durationPhrase(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'an unknown time';
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return count(mins, 'minute');
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? count(hours, 'hour') : `${count(hours, 'hour')} ${count(rest, 'minute')}`;
}

const SPELLED = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function countAtSentenceStart(n: number, one: string, many?: string): string {
  const word = n >= 0 && n < SPELLED.length ? SPELLED[n]! : fmtCount(n);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} ${plural(n, one, many)}`;
}

function projectList(sessions: readonly SessionSummary[]): string {
  const names = [...new Set(sessions.map((s) => projectName(s.project)))];
  const max = 4;
  if (names.length <= max) return naturalList(names);
  return naturalList([...names.slice(0, max), `${names.length - max} more`]);
}

function shallowRecords(agents: readonly AgentRow[], nowMs: number, days: number): AgentRow[] {
  const windowStart = nowMs - days * MS_PER_DAY;
  return agents.filter((a) => {
    if (!a.firstSeenAt) return false;
    const t = Date.parse(a.firstSeenAt);
    return Number.isFinite(t) && t > windowStart;
  });
}

function t(text: string): SummarySegment {
  return { type: 'text', text };
}

function term(noteId: string, label: string): SummarySegment {
  return { type: 'term', noteId, term: label };
}

function paragraph(role: 'lead' | 'body', segments: SummarySegment[]): SummaryParagraph {
  return { role, segments };
}

export function compileLiveSentence(
  all: readonly SessionSummary[],
  nowMs: number,
): string {
  const live = all.filter((s) => s.status !== 'ended');
  const blocked = live.filter((s) => s.awaitingInput);
  const working = live.filter((s) => !s.awaitingInput);

  if (blocked.length === 0) {
    if (live.length === 0) return 'Nothing is running right now.';
    const verb = plural(live.length, 'is', 'are');
    return `${countAtSentenceStart(live.length, 'session')} ${verb} running, in ${projectList(live)}. Nothing needs you.`;
  }

  const head =
    blocked.length === 1
      ? blockedClaim(blocked[0]!, nowMs)
      : `${countAtSentenceStart(blocked.length, 'session')} need you, in ${projectList(blocked)}.`;
  if (working.length === 0) return head;
  const verb = plural(working.length, 'is', 'are');
  return `${head} ${countAtSentenceStart(working.length, 'other session')} ${verb} running, in ${projectList(working)}.`;
}

function blockedClaim(s: SessionSummary, nowMs: number): string {
  const waitedMs = Math.max(0, nowMs - Date.parse(s.lastEventAt));
  const name = projectName(s.project);
  if (!Number.isFinite(waitedMs)) return `${name} is waiting on you.`;
  return `${name} has been waiting on you for ${durationPhrase(waitedMs / 1000)}.`;
}

/** Spoken window claims as plain strings — honesty / terminal contract tests. */
export function compileWindowSentences(
  overview: OverviewSnapshot,
  nowMs: number,
  days: number,
): string[] {
  return compilePeriodClarity(overview, { nowMs, days }).paragraphs
    .filter((p) => p.role === 'body')
    .map((p) => p.segments.map((s) => (s.type === 'text' ? s.text : s.term)).join(''));
}

export function compilePeriodClarity(
  overview: OverviewSnapshot,
  options: { nowMs?: number; days?: number } = {},
): PeriodClarity {
  const nowMs = options.nowMs ?? Date.now();
  const days = options.days ?? overview.rangeDays;
  const agents = [...(overview.tools.byAgent ?? [])].sort((a, b) => b.tokensTotal - a.tokensTotal);
  const notes: SummaryNote[] = [];
  const paragraphs: SummaryParagraph[] = [];

  // ── Live ──────────────────────────────────────────
  const liveText = compileLiveSentence(overview.live, nowMs);
  const liveSessions = overview.live.filter((s) => s.status !== 'ended');
  const blocked = liveSessions.filter((s) => s.awaitingInput);
  const liveNote: SummaryNote = {
    id: 'live',
    facet: 'live',
    label: blocked.length > 0 ? 'Needs you' : 'Right now',
    detail:
      blocked.length > 0
        ? 'A session is waiting on a permission or reply. Step in while you can still change the hour.'
        : liveSessions.length > 0
          ? 'Sessions are running and nothing is blocked on you.'
          : 'Nothing is on the live board right now.',
    citations: liveSessions.map(
      (s) =>
        `${projectName(s.project)}, ${s.awaitingInput ? 'waiting on you' : 'running'}, ${agentLabel(s.agent)}`,
    ),
    projectKey: liveSessions[0]?.repoId,
  };
  notes.push(liveNote);

  const liveTerm =
    blocked.length > 0
      ? 'need you'
      : liveSessions.length > 0
        ? 'running'
        : 'Nothing is running';
  if (liveText.includes(liveTerm)) {
    const i = liveText.indexOf(liveTerm);
    paragraphs.push(
      paragraph('lead', [
        t(liveText.slice(0, i)),
        term('live', liveTerm),
        t(liveText.slice(i + liveTerm.length)),
      ]),
    );
  } else {
    paragraphs.push(paragraph('lead', [t(liveText)]));
  }

  // ── Volume ────────────────────────────────────────
  const sessionsN = overview.usage.totals.sessions;
  const projectsN = overview.usage.projects.length;
  const sessionsPhrase = count(sessionsN, 'session');
  const projectsPhrase = count(projectsN, 'project');
  notes.push({
    id: 'volume-sessions',
    facet: 'volume',
    label: 'Sessions',
    detail: `Activity across ${windowPhrase(days)}. Counts are from captured sessions, not a grade.`,
    citations: [
      `${sessionsPhrase} in ${windowPhrase(days)}`,
      `${projectsPhrase} with activity`,
    ],
  });
  paragraphs.push(
    paragraph('body', [
      t(`In ${windowPhrase(days)} you ran `),
      term('volume-sessions', sessionsPhrase),
      t(` across ${projectsPhrase}.`),
    ]),
  );

  const totalTokens = agents.reduce((n, a) => n + a.tokensTotal, 0);
  if (totalTokens > 0) {
    const tokenPhrase = `${magnitude(totalTokens)} tokens`;
    const agentCite = agents.map(
      (a) => `${agentLabel(a.agent)}, ${magnitude(a.tokensTotal)} tokens`,
    );
    notes.push({
      id: 'volume-tokens',
      facet: 'volume',
      label: 'Tokens',
      detail:
        agents.length >= 2
          ? 'Token split by agent in this window. Shares can look small when Seorak only started watching an agent mid-window.'
          : `All measured tokens in this window came from ${agentLabel(agents[0]!.agent)}.`,
      citations: agentCite,
    });

    if (agents.length >= 2) {
      const split = naturalList(
        agents.map((a) => `${magnitude(a.tokensTotal)} from ${agentLabel(a.agent)}`),
      );
      paragraphs.push(
        paragraph('body', [
          t('That used '),
          term('volume-tokens', tokenPhrase),
          t(`: ${split}.`),
        ]),
      );
      const shallow = shallowRecords(agents, nowMs, days);
      const since = shallow[0]?.firstSeenAt ? monthDayPhrase(shallow[0].firstSeenAt) : null;
      if (since && shallow.length < agents.length) {
        const who = naturalList(shallow.map((a) => agentLabel(a.agent)));
        notes.push({
          id: 'volume-depth',
          facet: 'caveat',
          label: 'Record depth',
          detail: `Seorak only started watching ${who} on ${since}, so their share of this window is smaller than it would be over a full record.`,
          citations: shallow.map(
            (a) =>
              `${agentLabel(a.agent)} first seen ${a.firstSeenAt ? monthDayPhrase(a.firstSeenAt) : 'unknown'}`,
          ),
        });
        paragraphs.push(
          paragraph('body', [
            t('Seorak only started watching '),
            term('volume-depth', who),
            t(` on ${since}, so ${plural(shallow.length, 'that share is', 'those shares are')} smaller than ${plural(shallow.length, 'it', 'they')} really would be.`),
          ]),
        );
      }
    } else {
      paragraphs.push(
        paragraph('body', [
          t('That used '),
          term('volume-tokens', tokenPhrase),
          t(`, all from ${agentLabel(agents[0]!.agent)}.`),
        ]),
      );
    }
  }

  // ── Cost ──────────────────────────────────────────
  const c = overview.usage.cost;
  if (c.totalUsd !== null && c.sessionsWithCost > 0) {
    const unpriced = (c.unpricedModels ?? []).map((m) => formatModelLong(m.model));
    const costTerm =
      unpriced.length === 0 ? `about ${usdPhrase(c.totalUsd)}` : `at least ${usdPhrase(c.totalUsd)}`;
    notes.push({
      id: 'cost',
      facet: 'cost',
      label: 'Cost',
      detail:
        unpriced.length === 0
          ? 'Estimated from captured tokens and list prices. Subscription vs API is not detected.'
          : 'This is a floor. Some models in the window have no public list price yet.',
      citations: [
        `${c.sessionsWithCost} priced ${plural(c.sessionsWithCost, 'session')}`,
        ...unpriced.map((m) => `${m} has no public price yet`),
      ],
    });
    paragraphs.push(
      paragraph('body', [
        t(unpriced.length === 0 ? 'That cost ' : 'It cost '),
        term('cost', costTerm),
        t('.'),
      ]),
    );
    if (unpriced.length > 0) {
      notes.push({
        id: 'cost-unpriced',
        facet: 'caveat',
        label: 'Unpriced models',
        detail: 'Tokens ran through models with no list price, so the total understates spend.',
        citations: unpriced.map((m) => `${m}, unpriced`),
      });
      paragraphs.push(
        paragraph('body', [
          term('cost-unpriced', naturalList(unpriced)),
          t(
            ` ${plural(unpriced.length, 'has', 'have')} no public price yet, so the real number is higher.`,
          ),
        ]),
      );
    }
  }

  // ── Outcomes ──────────────────────────────────────
  const { shipRate, lineSurvival } = overview.outcomes;
  const outcomeLegs: string[] = [];
  if (shipRate !== null) outcomeLegs.push(`${pctPhrase(shipRate)} of those sessions ended in a commit`);
  if (lineSurvival.rate !== null && lineSurvival.sessionsRated > 0) {
    outcomeLegs.push(
      `${pctPhrase(lineSurvival.rate)} of the lines you wrote are still in your code, checked across ${count(lineSurvival.sessionsRated, 'session')} old enough to tell`,
    );
  }
  if (outcomeLegs.length > 0) {
    const outcomeText = `${capitalize(naturalList(outcomeLegs))}.`;
    const termLabel =
      shipRate !== null ? pctPhrase(shipRate) : pctPhrase(lineSurvival.rate!);
    notes.push({
      id: 'outcome',
      facet: 'outcome',
      label: 'Did it land',
      detail:
        'Ship rate and line survival are measured from git after sessions end. They are about the work, not a person grade.',
      citations: [
        ...(shipRate !== null ? [`${pctPhrase(shipRate)} ended in a commit`] : []),
        ...(lineSurvival.rate !== null && lineSurvival.sessionsRated > 0
          ? [
              `${pctPhrase(lineSurvival.rate)} lines still in your code`,
              `${count(lineSurvival.sessionsRated, 'session')} old enough to tell`,
            ]
          : []),
      ],
    });
    if (outcomeText.includes(termLabel)) {
      const i = outcomeText.indexOf(termLabel);
      paragraphs.push(
        paragraph('body', [
          t(outcomeText.slice(0, i)),
          term('outcome', termLabel),
          t(outcomeText.slice(i + termLabel.length)),
        ]),
      );
    } else {
      paragraphs.push(paragraph('body', [term('outcome', 'outcomes'), t(`: ${outcomeText}`)]));
    }

    const blind = agents.filter((a) => !a.capabilities.endReason).map((a) => agentLabel(a.agent));
    if (blind.length > 0 && blind.length < agents.length) {
      const who = naturalList(blind);
      notes.push({
        id: 'outcome-coverage',
        facet: 'caveat',
        label: 'Coverage',
        detail: `Ship and survival cover Claude Code only, because ${who} never ${plural(blind.length, 'reports', 'report')} when a session ends.`,
        citations: blind.map((name) => `${name}, no session-end record`),
      });
      paragraphs.push(
        paragraph('body', [
          t('Both numbers cover Claude Code only, because '),
          term('outcome-coverage', who),
          t(` never ${plural(blind.length, 'reports', 'report')} when a session ends.`),
        ]),
      );
    }
  }

  return { paragraphs, notes };
}

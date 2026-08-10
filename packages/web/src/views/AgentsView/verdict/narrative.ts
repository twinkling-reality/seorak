/**
 * The verdict prose: the lead volume read, the fit paragraph, and the evidence cards
 * the terms in them open. The outcome paragraph and the models sentence are composed
 * in from their own modules, because each carries a gate the prose must not restate.
 */
import type {
  AgentHourPoint,
  AgentModelRollup,
  AgentOutcomeRollup,
  AgentRollup,
  ModelRollup,
  ProjectRollup,
} from '../../../lib/apiSchemas.js';
import { getToolMeta } from '../../../lib/toolMeta.js';
import { count, fmtCount, naturalList } from '../../../lib/voice/index.js';

import {
  agentCadences,
  daypartMeta,
  CADENCE_MIN_CALLS,
  CADENCE_SHARE,
} from './clock.js';
import { agentEditVolume, rankAgents } from './metrics.js';
import { buildModelsSentence } from './models.js';
import {
  mark,
  note,
  t,
  type AgentsNarrative,
  type AgentsNarrativeSegment,
  type AgentsNote,
} from './notes.js';
import { buildOutcomeParagraph } from './outcomes.js';

const CLOSE_SHARE = 0.1; // within 10pp → neither dominated

/** Edit-line evidence per agent; absent legs cited as unmeasured, never 0. */
function editVolumeNote(byAgent: AgentRollup[]): AgentsNote {
  return {
    id: 'edit-volume',
    section: 'matrix',
    label: 'Edit volume',
    detail:
      'Line counts are derived on your machine from each tool\'s edit calls. They are the fairest cross-tool compare Seorak has today.',
    cites: ['edit-lines'],
    citations: rankAgents(byAgent).map((a) => {
      const label = getToolMeta(a.agent).label;
      return a.lines != null
        ? `${label} wrote +${fmtCount(a.lines.added)} / −${fmtCount(a.lines.removed)} edit lines`
        : `${label} did not report line counts this window`;
    }),
  };
}

/** Session evidence per agent, for the no-line-counts fallback. */
function sessionsNote(byAgent: AgentRollup[]): AgentsNote {
  return {
    id: 'sessions',
    section: 'matrix',
    label: 'Sessions by agent',
    detail: 'Session counts in this window keyed by agent. Activity, not an outcome claim.',
    cites: ['sessions'],
    citations: [...byAgent]
      .sort((a, b) => b.sessions - a.sessions)
      .map((a) => `${getToolMeta(a.agent).label} ran ${count(a.sessions, 'session')}`),
  };
}

const WHERE_CAP = 4;

/** Which projects each tool touched; multi-tool repos first, residue for the rest. */
function whereNote(projects: ProjectRollup[]): AgentsNote | null {
  const withAgents = projects.filter((p) => p.byAgent.length > 0);
  if (withAgents.length === 0) return null;
  const multiCount = withAgents.filter((p) => p.byAgent.length > 1).length;
  const shown = [...withAgents]
    .sort(
      (a, b) =>
        Number(b.byAgent.length > 1) - Number(a.byAgent.length > 1) ||
        a.project.localeCompare(b.project),
    )
    .slice(0, WHERE_CAP);
  const citations = shown.map(
    (p) => `${p.project} saw ${naturalList(p.byAgent.map((a) => getToolMeta(a.agent).label))}`,
  );
  if (withAgents.length > WHERE_CAP) {
    citations.push(`plus ${count(withAgents.length - WHERE_CAP, 'more project')}`);
  }
  return {
    id: 'projects',
    section: 'where',
    label: 'Where the work landed',
    detail:
      multiCount > 0
        ? `${count(multiCount, 'project')} ran more than one tool this window; the rest stayed single-tool.`
        : 'No project ran more than one tool this window.',
    citations,
  };
}

const REACH_NAMES_CAP = 3;
const SHAPE_GAP = 2; // densest must be ≥2x the lightest before "denser" is claimed

/**
 * The cadence fit sentence: spoken only on a real measured gap, like the other
 * fit sentences. Both agents need CADENCE_MIN_CALLS, the focus agent must land
 * at least half its calls in one daypart, and the two tools' peak dayparts must
 * differ — nothing distinctive means no sentence. Clock hours are the viewer's
 * own (disclosed in the note); this mirrors your reach, never advises.
 */
function buildCadenceSentence(
  agentHourly: AgentHourPoint[],
  offsetMinutes: number,
): { segments: AgentsNarrativeSegment[]; note: AgentsNote } | null {
  const cadences = agentCadences(agentHourly, offsetMinutes).filter(
    (c) => c.calls >= CADENCE_MIN_CALLS,
  );
  if (cadences.length < 2) return null;
  const concentrated = cadences.filter((c) => c.topShare >= CADENCE_SHARE);
  if (concentrated.length === 0) return null;
  const focus = concentrated.reduce((m, c) => (c.topShare > m.topShare ? c : m));
  const others = cadences.filter((c) => c.agent !== focus.agent);
  if (others.some((c) => c.top === focus.top)) return null;

  const cadenceNote: AgentsNote = {
    id: 'cadence',
    section: 'when',
    label: 'When the calls land',
    detail:
      'Each tool\'s call volume by clock hour, in your browser\'s local time. This is when you reached for each one, not a recommendation.',
    citations: cadences.map((c) => {
      const meta = daypartMeta(c.top);
      return `${getToolMeta(c.agent).label} put ${fmtCount(c.topCalls)} of its ${count(c.calls, 'call')} in your ${meta.label} (${meta.range})`;
    }),
  };

  const focusMeta = daypartMeta(focus.top);
  const pct = Math.round(focus.topShare * 100);
  const other = others.reduce((m, c) => (c.calls > m.calls ? c : m));
  const otherConcentrated = other.topShare >= CADENCE_SHARE;
  const segments: AgentsNarrativeSegment[] = [
    mark(focus.agent),
    t(' is your '),
    note('cadence', `${focusMeta.label} tool`),
    t(`: ${pct}% of its calls land there; `),
    mark(other.agent),
    ...(otherConcentrated
      ? [t(` leans ${daypartMeta(other.top).label}.`)]
      : [t(' spreads through the day.')]),
  ];
  return { segments, note: cadenceNote };
}

/**
 * Second paragraph: how you use the tools differently — fit, from legs both
 * tools fully report (tool calls, sessions, per-project presence). This is the
 * indirect compare: your own revealed pattern per tool, never a "better tool"
 * recommendation and never an effectiveness claim. Each sentence gates on a
 * real measured gap; nothing distinctive means no paragraph.
 */
function buildFitParagraph(
  byAgent: AgentRollup[],
  projects: ProjectRollup[],
  agentHourly: AgentHourPoint[],
  offsetMinutes: number,
): { segments: AgentsNarrativeSegment[]; notes: AgentsNote[] } | null {
  const segments: AgentsNarrativeSegment[] = [];
  const notes: AgentsNote[] = [];

  // Session shape: tool calls per sitting. n=1 is spoken as "your one session",
  // never disguised as an average.
  const withCalls = byAgent
    .filter((a) => a.sessions > 0 && a.toolCalls > 0)
    .map((a) => ({ a, rate: a.toolCalls / a.sessions }));
  if (withCalls.length > 1) {
    const dense = withCalls.reduce((m, x) => (x.rate > m.rate ? x : m));
    const light = withCalls.reduce((m, x) => (x.rate < m.rate ? x : m));
    if (dense.rate >= light.rate * SHAPE_GAP) {
      notes.push({
        id: 'shape',
        section: 'matrix',
        label: 'Session shape',
        detail:
          'How much a sitting carries for each tool. This is activity shape, not effectiveness.',
        cites: ['tool-calls', 'sessions'],
        citations: rankAgents(byAgent)
          .filter((a) => a.sessions > 0)
          .map(
            (a) =>
              `${getToolMeta(a.agent).label} made ${count(a.toolCalls, 'tool call')} across ${count(a.sessions, 'session')}`,
          ),
      });
      const denseN = fmtCount(Math.round(dense.rate));
      const lightN = fmtCount(Math.round(light.rate));
      segments.push(
        ...(dense.a.sessions === 1
          ? [t('Your one '), mark(dense.a.agent), t(' session ran ')]
          : [t('A '), mark(dense.a.agent), t(' session averages ')]),
        note('shape', `${denseN} tool calls`),
        t('; '),
        ...(light.a.sessions === 1
          ? [t('your one '), mark(light.a.agent), t(` session ran ${lightN}.`)]
          : [mark(light.a.agent), t(` runs lighter at ${lightN} per session.`)]),
      );
    }
  }

  // Reach: where you already point each tool. Revealed preference, no ranking.
  const reach = byAgent
    .map((a) => ({
      a,
      list: projects.filter((p) => p.byAgent.some((x) => x.agent === a.agent)),
    }))
    .filter((x) => x.list.length > 0);
  if (reach.length > 1) {
    const wide = reach.reduce((m, x) => (x.list.length > m.list.length ? x : m));
    const narrow = reach.reduce((m, x) => (x.list.length < m.list.length ? x : m));
    if (wide.list.length >= 2 && wide.list.length > narrow.list.length) {
      notes.push({
        id: 'reach',
        section: 'where',
        label: 'Where you point each tool',
        detail:
          'Which repos each tool saw this window. This is where you already reach for each one, not a ranking.',
        citations: reach.map(({ a, list }) => {
          const names = list.map((p) => p.project);
          const shown = naturalList(names.slice(0, REACH_NAMES_CAP));
          const rest = names.length - REACH_NAMES_CAP;
          return `${getToolMeta(a.agent).label} ran in ${shown}${rest > 0 ? ` and ${count(rest, 'other')}` : ''}`;
        }),
      });
      if (segments.length) segments.push(t(' '));
      const narrowClause =
        narrow.list.length === 1
          ? t(` stays in ${narrow.list[0].project}`)
          : t(` keeps to ${count(narrow.list.length, 'project')}`);
      const totalWithAgents = projects.filter((p) => p.byAgent.length > 0).length;
      if (wide.list.length === totalWithAgents) {
        // The lead paragraph already says "across N projects"; flipping the
        // order and speaking "all N" avoids the same term twice.
        segments.push(
          mark(narrow.a.agent),
          narrowClause,
          t('; '),
          mark(wide.a.agent),
          t(' roams '),
          note('reach', wide.list.length === 2 ? 'both' : `all ${fmtCount(wide.list.length)}`),
          t('.'),
        );
      } else {
        segments.push(
          mark(wide.a.agent),
          t(' roams '),
          note('reach', count(wide.list.length, 'project')),
          t('; '),
          mark(narrow.a.agent),
          narrowClause,
          t('.'),
        );
      }
    }
  }

  // Cadence: when each tool's calls land (viewer-local dayparts), gated on the
  // same nothing-distinctive-means-silence rule as shape and reach.
  const cadence = buildCadenceSentence(agentHourly, offsetMinutes);
  if (cadence) {
    if (segments.length) segments.push(t(' '));
    segments.push(...cadence.segments);
    notes.push(cadence.note);
  }

  if (segments.length === 0) return null;
  return { segments: [t('\n\nYou use them differently. '), ...segments], notes };
}

/**
 * Capability-honest verdict compiled as annotated prose: plain text, inline
 * agent identity marks, and note terms whose citations open the Why/Where/
 * Models evidence. Fair data only (edit lines primary, sessions fallback);
 * never claims ship/survival superiority.
 */
export function buildAgentsNarrative(
  byAgent: AgentRollup[],
  projects: ProjectRollup[],
  byModel: ModelRollup[],
  agentModels: AgentModelRollup[] = [],
  agentHourly: AgentHourPoint[] = [],
  /** Viewer clock offset, Date.getTimezoneOffset() convention. Injected so the
   *  compiler stays pure; the view passes the browser's real offset. */
  offsetMinutes = 0,
  agentOutcomes: AgentOutcomeRollup[] = [],
): AgentsNarrative {
  if (byAgent.length <= 1) {
    return {
      segments: [
        t('Agent compare fills in once a second tool records sessions in this window.'),
      ],
      notes: [],
      leaderId: null,
    };
  }

  const segments: AgentsNarrativeSegment[] = [];
  const notes: AgentsNote[] = [];
  let leaderId: string | null = null;

  const where = whereNote(projects);
  const projectCount = projects.filter((p) => p.byAgent.length > 0).length;
  const whereClause: AgentsNarrativeSegment[] = where
    ? [t(' across '), note('projects', count(projectCount, 'project'))]
    : [];

  const measured = byAgent
    .map((a) => ({ agent: a, volume: agentEditVolume(a) }))
    .filter((x): x is { agent: AgentRollup; volume: number } => x.volume != null && x.volume > 0);

  if (measured.length > 1) {
    const total = measured.reduce((s, x) => s + x.volume, 0);
    const ranked = [...measured].sort((a, b) => b.volume - a.volume);
    const top = ranked[0];
    const share = top.volume / total;
    const pct = Math.round(share * 100);
    notes.push(editVolumeNote(byAgent));
    if (where) notes.push(where);

    if (share - ranked[1].volume / total < CLOSE_SHARE) {
      segments.push(
        t('Neither tool dominated your edit volume this window: '),
        mark(top.agent.agent),
        t(' led narrowly at '),
        note('edit-volume', `${pct}% of edit lines`),
        ...whereClause,
        t('.'),
      );
    } else {
      leaderId = top.agent.agent;
      // At the rounding edge (99.5%+ with the other tool still measured), a
      // "100% / other 0%" split would overclaim against real lines — speak the
      // exact counts instead of a rounded percent.
      const edge = 100 - pct === 0;
      segments.push(
        mark(top.agent.agent),
        t(' led your agent work this window, carrying '),
        note('edit-volume', edge ? 'nearly all edit volume' : `${pct}% of edit volume`),
        ...whereClause,
        t('. '),
      );
      if (ranked.length === 2) {
        segments.push(
          mark(ranked[1].agent.agent),
          edge
            ? t(` wrote ${fmtCount(ranked[1].volume)} of the ${fmtCount(total)} measured lines.`)
            : t(` wrote the other ${100 - pct}%.`),
        );
      } else {
        segments.push(t(`The rest split across ${count(ranked.length - 1, 'other tool')}.`));
      }
    }
  } else if (measured.length === 1) {
    // One tool measured lines; a 100% "lead" over unmeasured legs would be
    // dishonest, so say exactly what is and is not reported.
    const top = measured[0];
    const others = byAgent.filter((a) => a.agent !== top.agent.agent);
    notes.push(editVolumeNote(byAgent));
    if (where) notes.push(where);
    segments.push(
      mark(top.agent.agent),
      t(' is the only tool reporting edit lines this window, at '),
      note(
        'edit-volume',
        `+${fmtCount(top.agent.lines!.added)} / −${fmtCount(top.agent.lines!.removed)} lines`,
      ),
      ...whereClause,
      t('. A line-for-line compare fills in once '),
    );
    if (others.length === 1) {
      segments.push(mark(others[0].agent), t(' reports line counts too.'));
    } else {
      segments.push(t('the other tools report line counts too.'));
    }
  } else {
    // Fallback: sessions — still activity, not outcomes.
    const bySessions = [...byAgent].sort((a, b) => b.sessions - a.sessions);
    const sessTotal = bySessions.reduce((s, a) => s + a.sessions, 0);
    if (sessTotal === 0) {
      return {
        segments: [
          t('No agent activity in this window yet. Run sessions on more than one tool to fill the compare.'),
        ],
        notes: [],
        leaderId: null,
      };
    }
    const top = bySessions[0];
    const share = top.sessions / sessTotal;
    notes.push(sessionsNote(byAgent));
    if (share - bySessions[1].sessions / sessTotal < CLOSE_SHARE) {
      segments.push(
        t('Neither tool dominated '),
        note('sessions', 'session volume'),
        t(' this window. Edit lines are the fairer compare once both tools report them.'),
      );
    } else {
      leaderId = top.agent;
      segments.push(
        mark(top.agent),
        t(' ran more of your sessions this window, carrying '),
        note('sessions', `${Math.round(share * 100)}% of them`),
        t('. Edit lines are the fairer compare once both tools report them.'),
      );
    }
  }

  // The outcome paragraph reads SECOND: the volume lead above gives it its scale, and
  // the models / fit detail below is subordinate to it. It is the only claim on this
  // page that is about what the work was WORTH rather than how much of it there was.
  const outcome = buildOutcomeParagraph(agentOutcomes, byAgent);
  if (outcome) {
    segments.push(...outcome.segments);
    notes.push(outcome.note);
  }

  const models = buildModelsSentence(
    byModel,
    byAgent.some((a) => a.costUsd == null),
    agentModels,
    rankAgents(byAgent).map((a) => a.agent),
  );
  if (models) {
    segments.push(...models.segments);
    notes.push(models.note);
  }

  const fit = buildFitParagraph(byAgent, projects, agentHourly, offsetMinutes);
  if (fit) {
    segments.push(...fit.segments);
    notes.push(...fit.notes);
  }

  return { segments, notes, leaderId };
}

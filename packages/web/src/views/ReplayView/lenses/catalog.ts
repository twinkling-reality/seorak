// The lens catalog. Data only — no compute, no components.
//
// This is the file an API or MCP tool would serve as its schema: every entry
// says what the lens answers, which captured fields it reads, and where it
// applies. Keep `description` written for a reader who cannot see the screen.

import type { ReplayLensDef, ReplayLensGroup, ReplayLensQuestion } from './types.js';

const ALL_LEVELS = ['period', 'project', 'session'] as const;

/**
 * The three questions Replay answers, in reading order. Group headings for
 * every lens picker — and the reason a picker can stay readable past a dozen
 * lenses, since a reader scans one question at a time rather than one list.
 */
export const REPLAY_LENS_QUESTIONS: ReadonlyArray<{
  question: ReplayLensQuestion;
  label: string;
}> = [
  { question: 'what-happened', label: 'What happened' },
  { question: 'attention', label: 'Where attention spiked' },
  { question: 'revisit', label: 'Worth revisiting' },
];

export const REPLAY_LENSES: ReplayLensDef[] = [
  {
    id: 'tool-mix',
    name: 'Tools',
    description:
      'Which tools the agent actually used, how often each ran, and how many of those calls errored.',
    question: 'what-happened',
    viz: 'ranked-bars',
    dataKeys: ['moments.toolName', 'moments.errored', 'moments.costUsd'],
    levels: [...ALL_LEVELS],
    windowed: true,
    emptyHint: 'No tool calls were captured here. Tool-call logging fills this in.',
  },
  {
    id: 'cost-concentration',
    name: 'Cost',
    description:
      'Where the measured API cost went, by tool, and the single most expensive moments.',
    question: 'what-happened',
    viz: 'ranked-bars',
    dataKeys: ['moments.costUsd', 'moments.toolName'],
    levels: [...ALL_LEVELS],
    windowed: true,
    emptyHint: 'No per-moment cost was captured here, so cost cannot be attributed.',
  },
  {
    id: 'file-touch',
    name: 'Files',
    description:
      'What kind of files the work touched, by category and language family. Never file paths.',
    question: 'what-happened',
    viz: 'ranked-bars',
    dataKeys: ['moments.fileCategory', 'moments.fileLanguage'],
    levels: [...ALL_LEVELS],
    windowed: true,
    emptyHint: 'No file category or language was derived for the calls captured here.',
  },
  {
    id: 'rework',
    name: 'Rework',
    description:
      'Work the agent changed back within the session — where effort was spent and then discarded.',
    question: 'attention',
    viz: 'timeline-marks',
    dataKeys: ['moments.undoKind', 'moments.at'],
    levels: [...ALL_LEVELS],
    windowed: true,
    emptyHint: 'Nothing was changed back here. That is a real absence, not missing capture.',
  },
  {
    id: 'verification',
    name: 'Checks',
    description:
      'Verification runs over time and whether they passed — whether checks went red, and whether they came back.',
    question: 'attention',
    viz: 'timeline-marks',
    dataKeys: ['moments.verificationKind', 'moments.verificationPassed', 'moments.at'],
    levels: [...ALL_LEVELS],
    windowed: true,
    emptyHint: 'No verification runs were captured here.',
  },
  {
    id: 'interruptions',
    name: 'Waits',
    description:
      'How often the agent stopped for you, and how long it sat waiting before the next captured moment.',
    question: 'attention',
    viz: 'timeline-marks',
    dataKeys: ['moments.notificationType', 'moments.at'],
    levels: [...ALL_LEVELS],
    windowed: true,
    emptyHint: 'The agent never stopped for you here.',
  },
  {
    id: 'cadence',
    name: 'Cadence',
    description:
      'How the gaps between captured moments were distributed — whether the work ran in bursts or in stalls.',
    question: 'what-happened',
    viz: 'distribution',
    dataKeys: ['moments.at'],
    levels: [...ALL_LEVELS],
    windowed: true,
    emptyHint: 'Two or more captured moments are needed before a cadence exists.',
  },
  {
    id: 'projects',
    name: 'Projects',
    description:
      'Every project in the period with its sessions, elapsed time, cost, attention count, and when it first appeared.',
    question: 'what-happened',
    viz: 'table',
    dataKeys: ['totals', 'keyframes', 'sessions'],
    levels: ['period'],
    windowed: false,
    emptyHint: 'No projects are in this replay scope.',
  },
  {
    id: 'sessions',
    name: 'Sessions',
    description:
      'Every session in the current scope with its elapsed time, cost, tool calls, and attention count.',
    question: 'revisit',
    viz: 'table',
    dataKeys: ['totals', 'keyframes'],
    levels: ['period', 'project'],
    windowed: false,
    emptyHint: 'No sessions are in this replay scope.',
  },
  {
    id: 'session-detail',
    name: 'This session',
    description:
      'Totals for the focused session plus its keyframes in timeline order.',
    question: 'revisit',
    viz: 'stat-grid',
    dataKeys: ['totals', 'keyframes'],
    levels: ['session'],
    windowed: false,
    emptyHint: 'This session has no loaded replay.',
  },
  {
    id: 'session-compare',
    name: 'Compare sessions',
    description:
      'Two sessions side by side on the same measurements. Only attention and uncommitted files carry a direction.',
    question: 'revisit',
    viz: 'compare-rows',
    dataKeys: ['totals', 'keyframes'],
    levels: ['project', 'session'],
    windowed: false,
    emptyHint: 'Pick two sessions in the Sessions lens to compare them.',
  },
  {
    id: 'period-compare',
    name: 'Compare periods',
    description:
      'This range against the previous range of the same length, folded from session totals rather than replay payloads.',
    question: 'what-happened',
    viz: 'compare-rows',
    dataKeys: ['sessions'],
    levels: ['period'],
    windowed: false,
    emptyHint: 'Nothing was captured in the range before this one.',
  },
];

const BY_ID = new Map(REPLAY_LENSES.map((lens) => [lens.id, lens]));

export function replayLens(id: string): ReplayLensDef | null {
  return BY_ID.get(id) ?? null;
}

/** Lenses that have something to say at a level, in catalog order. */
export function lensesForLevel(level: ReplayLensDef['levels'][number]): ReplayLensDef[] {
  return REPLAY_LENSES.filter((lens) => lens.levels.includes(level));
}

/**
 * The level's lenses grouped by the question they answer. A question with no
 * lens at this level is omitted rather than rendered empty — an empty heading
 * would claim Replay asks a question here that it cannot answer.
 */
export function lensGroupsForLevel(level: ReplayLensDef['levels'][number]): ReplayLensGroup[] {
  const lenses = lensesForLevel(level);
  return REPLAY_LENS_QUESTIONS.map(({ question, label }) => ({
    question,
    label,
    lenses: lenses.filter((lens) => lens.question === question),
  })).filter((group) => group.lenses.length > 0);
}

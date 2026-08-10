/**
 * The snapshot matrix the portrait is judged against.
 *
 * Two populations, and they answer different questions.
 *
 * **The structural matrix** turns each producer's inputs on and off
 * independently, so every combination of which sentences fire is compiled at
 * least once. Producers are independently silent, so the paragraph is an
 * emergent join and the joins are where the grammar defects live.
 *
 * **The value matrix** holds the structure fixed and moves the NUMBERS to the
 * edges of the gates. That is the half the structural matrix cannot reach: a
 * leader at 65% and a leader at 34% produce the same shaped portrait and
 * different claims, and a card that says "most of your sessions ran here" is
 * only wrong on the second one. Every defect the owner found by hovering was of
 * that kind, so a fixture that only ever runs one point in value-space cannot
 * find the next one.
 *
 * Lives outside `src/` on purpose: it is fixture data, and nothing that ships to
 * a browser may import it.
 */
import type { DeveloperModelSnapshot } from '@seorak/types';

export const SURVIVAL = {
  rate: null as number | null,
  linesAuthored: 0,
  linesSurviving: 0,
  commitsChecked: 0,
  sessionsRated: 0,
  retained: 0,
  overwritten: 0,
  unreachable: 0,
  unknown: 0,
};

export const BASE: DeveloperModelSnapshot = {
  scope: { rangeDays: 30, maxRangeDays: 90, repoId: null, generatedAt: '2026-07-01T12:00:00.000Z' },
  focus: { projectFocus: [] },
  outcomes: {
    shipRate: null,
    lineSurvival: SURVIVAL,
    shipped: 0,
    shipDeterminable: 0,
    stuckness: { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] },
    endReasons: [],
  },
  activity: { hourlyDistribution: [], endReasonsByHour: [] },
  tools: { byTool: [], byModel: [], callStats: { errorRate: null, erroredCalls: 0, callsWithResult: 0 }, verification: [] },
};

/** One toggleable leg of a snapshot, so the matrix can turn each producer on and
 *  off independently. */
export interface PortraitLeg {
  name: string;
  apply: (s: DeveloperModelSnapshot) => void;
}

export const LEGS: PortraitLeg[] = [
  {
    name: 'rhythm',
    apply(s) {
      s.activity.hourlyDistribution = [
        { dow: 2, hour: 20, sessions: 8 },
        { dow: 3, hour: 21, sessions: 7 },
        { dow: 4, hour: 20, sessions: 2 },
      ];
    },
  },
  {
    name: 'focus',
    apply(s) {
      s.focus.projectFocus = [
        { repoId: 'r1', project: 'seorak', sessions: 11, share: 0.65 },
        { repoId: 'r2', project: 'feather', sessions: 6, share: 0.35 },
      ];
    },
  },
  {
    name: 'stack',
    apply(s) {
      s.identity = {
        ...(s.identity ?? {}),
        fileLanguageMix: [
          { language: 'typescript', calls: 120 },
          { language: 'css', calls: 40 },
        ],
      };
      s.tools.byModel = [
        { model: 'claude-opus-5', calls: 400 },
        { model: 'claude-sonnet-5', calls: 90 },
      ] as DeveloperModelSnapshot['tools']['byModel'];
    },
  },
  {
    name: 'craft',
    apply(s) {
      s.identity = {
        ...(s.identity ?? {}),
        branchWorkTypeMix: [
          { workType: 'feature', sessions: 9 },
          { workType: 'fix', sessions: 4 },
        ],
      };
      s.tools.byTool = [
        { tool: 'Read', calls: 300 },
        { tool: 'Edit', calls: 200 },
      ] as DeveloperModelSnapshot['tools']['byTool'];
      s.tools.callStats = { errorRate: 0.06, erroredCalls: 21, callsWithResult: 350 };
    },
  },
  {
    name: 'habits',
    apply(s) {
      s.tools.verification = [
        { kind: 'test', runs: 40, passed: 30 },
      ] as DeveloperModelSnapshot['tools']['verification'];
      s.outcomes.endReasons = [
        { reason: 'clear', count: 12 },
        { reason: 'resume', count: 3 },
      ];
    },
  },
  {
    name: 'survival',
    apply(s) {
      s.outcomes.lineSurvival = {
        ...SURVIVAL,
        rate: 0.81,
        linesAuthored: 900,
        linesSurviving: 729,
        commitsChecked: 20,
        sessionsRated: 14,
      };
      s.outcomes.shipRate = 0.68;
      s.outcomes.shipped = 17;
      s.outcomes.shipDeterminable = 25;
    },
  },
  {
    name: 'daypartPayoff',
    apply(s) {
      s.conditional = {
        lineSurvivalByStartHour: [
          { hour: 20, linesAuthored: 400, linesSurviving: 340, commitsChecked: 6, sessionsRated: 5 },
          { hour: 9, linesAuthored: 400, linesSurviving: 160, commitsChecked: 6, sessionsRated: 5 },
        ],
        shipByStartHour: [
          { hour: 20, shipped: 9, determinable: 10 },
          { hour: 9, shipped: 2, determinable: 10 },
        ],
      };
    },
  },
  {
    name: 'accrual',
    apply(s) {
      s.accrual = {
        sessions: 14,
        hourlyDistribution: [
          { dow: 2, hour: 9, sessions: 8 },
          { dow: 3, hour: 10, sessions: 6 },
        ],
        projectFocus: [
          { repoId: 'r2', project: 'feather', sessions: 10, share: 0.71 },
          { repoId: 'r1', project: 'seorak', sessions: 4, share: 0.29 },
        ],
        branchWorkTypeMix: [
          { workType: 'fix', sessions: 10 },
          { workType: 'feature', sessions: 2 },
        ],
        lineSurvival: {
          ...SURVIVAL,
          rate: 0.55,
          linesAuthored: 700,
          linesSurviving: 385,
          commitsChecked: 12,
          sessionsRated: 9,
        },
      };
    },
  },
  {
    name: 'friction',
    apply(s) {
      s.outcomes.stuckness = { rate: 0.1, stuckCount: 2, inFlight: 20, stuckSessionIds: ['a', 'b'] };
    },
  },
];

export function snapshotFor(mask: number, repoScoped: boolean): DeveloperModelSnapshot {
  const s: DeveloperModelSnapshot = JSON.parse(JSON.stringify(BASE));
  LEGS.forEach((leg, i) => {
    if (mask & (1 << i)) leg.apply(s);
  });
  if (repoScoped) s.scope.repoId = 'r1';
  return s;
}

/** Every combination of which legs were measured, merged and repo-scoped. */
export function structuralMatrix(): Array<{ label: string; snapshot: DeveloperModelSnapshot }> {
  const out: Array<{ label: string; snapshot: DeveloperModelSnapshot }> = [];
  for (const scoped of [false, true]) {
    for (let mask = 0; mask < 1 << LEGS.length; mask += 1) {
      const legs = LEGS.filter((_, i) => mask & (1 << i)).map((l) => l.name);
      out.push({
        label: `${scoped ? 'scoped' : 'merged'} [${legs.join(',') || 'empty'}]`,
        snapshot: snapshotFor(mask, scoped),
      });
    }
  }
  return out;
}

// ── The value matrix ────────────────────────────────────────────────────────
// Each entry starts from "everything measured" and moves ONE dimension to a gate
// boundary, so the card that speaks about that dimension is rendered at the
// number where its copy is most likely to be wrong.

const ALL_LEGS = (1 << LEGS.length) - 1;

function full(): DeveloperModelSnapshot {
  return snapshotFor(ALL_LEGS, false);
}

/**
 * A snapshot carrying only the named legs.
 *
 * The paragraph limit is three identity sentences and two payoff ones, and a cut
 * sentence takes its cards with it — so a case that measures EVERYTHING renders
 * the card of whichever facet won the ranking, which is precisely not the card
 * the case was written to inspect. Most value cases therefore turn on only what
 * their own sentence needs. The ones that deliberately keep the full snapshot
 * are testing the ranking itself.
 */
function only(...names: string[]): DeveloperModelSnapshot {
  let mask = 0;
  for (const name of names) {
    const i = LEGS.findIndex((l) => l.name === name);
    if (i < 0) throw new Error(`unknown leg: ${name}`);
    mask |= 1 << i;
  }
  return snapshotFor(mask, false);
}

function hours(spec: Array<[dow: number, hour: number, sessions: number]>) {
  return spec.map(([dow, hour, sessions]) => ({ dow, hour, sessions }));
}

export interface ValueCase {
  label: string;
  /** What this case is trying to catch, for the harness header. */
  probes: string;
  snapshot: DeveloperModelSnapshot;
  offsetMinutes?: number;
  priorOffsetMinutes?: number;
}

export const VALUE_CASES: ValueCase[] = [
  {
    label: 'daypart-plurality',
    probes: 'daypart leads 44% of starts — clears the 40% share and the 10% margin, and is NOT a majority',
    snapshot: (() => {
      const s = only('rhythm');
      // afternoon 11, evening 6, morning 5, night 3 → 44% lead, 18% margin.
      s.activity.hourlyDistribution = hours([
        [1, 14, 6], [2, 15, 5], [3, 20, 6], [4, 9, 5], [5, 2, 3],
      ]);
      return s;
    })(),
  },
  {
    label: 'daypart-landslide',
    probes: 'daypart holds 80% — the only shape where "most" is honest',
    snapshot: (() => {
      const s = only('rhythm');
      s.activity.hourlyDistribution = hours([[2, 20, 16], [3, 9, 2], [4, 14, 2]]);
      return s;
    })(),
  },
  {
    label: 'focus-plurality',
    probes: 'leader takes 30% of eleven repos — a clear lead, not a majority, and no tie',
    snapshot: (() => {
      const s = only('focus');
      s.focus.projectFocus = [
        { repoId: 'r1', project: 'seorak', sessions: 30, share: 0.3 },
        { repoId: 'r2', project: 'feather', sessions: 18, share: 0.18 },
        { repoId: 'r3', project: 'cleanerchat', sessions: 14, share: 0.14 },
        { repoId: 'r4', project: 'atlas', sessions: 10, share: 0.1 },
        { repoId: 'r5', project: 'kettle', sessions: 8, share: 0.08 },
        { repoId: 'r6', project: 'harbour', sessions: 7, share: 0.07 },
        { repoId: 'r7', project: 'moss', sessions: 5, share: 0.05 },
        { repoId: 'r8', project: 'flint', sessions: 3, share: 0.03 },
        { repoId: 'r9', project: 'quill', sessions: 2, share: 0.02 },
        { repoId: 'r10', project: 'birch', sessions: 2, share: 0.02 },
        { repoId: 'r11', project: 'ledger', sessions: 1, share: 0.01 },
      ];
      return s;
    })(),
  },
  {
    label: 'focus-tied-low',
    probes: 'two repos tie at 16% each of a long tail — the tied copy claims "a little under half"',
    snapshot: (() => {
      const s = only('focus');
      s.focus.projectFocus = [
        { repoId: 'r1', project: 'seorak', sessions: 16, share: 0.16 },
        { repoId: 'r2', project: 'feather', sessions: 15, share: 0.15 },
        { repoId: 'r3', project: 'cleanerchat', sessions: 14, share: 0.14 },
        { repoId: 'r4', project: 'atlas', sessions: 13, share: 0.13 },
        { repoId: 'r5', project: 'kettle', sessions: 12, share: 0.12 },
        { repoId: 'r6', project: 'harbour', sessions: 11, share: 0.11 },
        { repoId: 'r7', project: 'moss', sessions: 10, share: 0.1 },
        { repoId: 'r8', project: 'flint', sessions: 9, share: 0.09 },
      ];
      return s;
    })(),
  },
  {
    label: 'focus-tied-high',
    probes: 'two repos split 26/26 of two — the tie the copy was written for',
    snapshot: (() => {
      const s = only('focus');
      s.focus.projectFocus = [
        { repoId: 'r1', project: 'seorak', sessions: 26, share: 0.5 },
        { repoId: 'r2', project: 'feather', sessions: 26, share: 0.5 },
      ];
      return s;
    })(),
  },
  {
    label: 'focus-single-repo',
    probes: 'one tracked project — share is 1 by construction',
    snapshot: (() => {
      const s = only('focus');
      s.focus.projectFocus = [{ repoId: 'r1', project: 'seorak', sessions: 21, share: 1 }];
      return s;
    })(),
  },
  {
    label: 'focus-one-session-each',
    probes: 'singular units everywhere — "1 sessions" bugs',
    snapshot: (() => {
      const s = only('focus');
      s.focus.projectFocus = [
        { repoId: 'r1', project: 'seorak', sessions: 2, share: 0.5 },
        { repoId: 'r2', project: 'feather', sessions: 1, share: 0.25 },
        { repoId: 'r3', project: 'moss', sessions: 1, share: 0.25 },
      ];
      return s;
    })(),
  },
  {
    label: 'language-plurality',
    probes: 'leading language is 34% of a thirteen-language tail',
    snapshot: (() => {
      const s = only('stack');
      s.identity = {
        ...(s.identity ?? {}),
        fileLanguageMix: [
          { language: 'typescript', calls: 340 },
          { language: 'rust', calls: 180 },
          { language: 'css', calls: 120 },
          { language: 'markdown', calls: 90 },
          { language: 'swift', calls: 80 },
          { language: 'json', calls: 60 },
          { language: 'shell', calls: 50 },
          { language: 'python', calls: 30 },
          { language: 'sql', calls: 20 },
          { language: 'html', calls: 15 },
          { language: 'go', calls: 8 },
          { language: 'ruby', calls: 5 },
          { language: 'java', calls: 2 },
        ],
      };
      return s;
    })(),
  },
  {
    label: 'worktype-plurality',
    probes: 'leading work type is exactly 40% of classified sessions — the gate boundary',
    snapshot: (() => {
      const s = only('craft');
      s.identity = {
        ...(s.identity ?? {}),
        branchWorkTypeMix: [
          { workType: 'feature', sessions: 8 },
          { workType: 'fix', sessions: 6 },
          { workType: 'chore', sessions: 4 },
          { workType: 'refactor', sessions: 2 },
        ],
      };
      return s;
    })(),
  },
  {
    label: 'worktype-other-leads',
    probes: 'the unnamed bucket leads — must never be spoken, must stay on the card',
    snapshot: (() => {
      const s = only('craft');
      s.identity = {
        ...(s.identity ?? {}),
        branchWorkTypeMix: [
          { workType: 'other', sessions: 20 },
          { workType: 'feature', sessions: 6 },
          { workType: 'fix', sessions: 4 },
        ],
      };
      return s;
    })(),
  },
  {
    label: 'tools-with-other-bucket',
    probes: 'the real byTool shape: an `other` aggregate remainder as the #2 entry',
    snapshot: (() => {
      const s = only('craft');
      s.tools.byTool = [
        { tool: 'Read', calls: 41_204 },
        { tool: 'other', calls: 30_213 },
        { tool: 'Bash', calls: 22_800 },
        { tool: 'Edit', calls: 19_640 },
        { tool: 'Grep', calls: 9_120 },
      ] as DeveloperModelSnapshot['tools']['byTool'];
      s.tools.callStats = { errorRate: 0.041, erroredCalls: 2_476, callsWithResult: 60_390 };
      return s;
    })(),
  },
  {
    label: 'tools-unmapped-lead',
    probes: 'a leading tool with no activity verb — falls back to naming tools',
    snapshot: (() => {
      const s = only('craft');
      s.tools.byTool = [
        { tool: 'TodoWrite', calls: 900 },
        { tool: 'Read', calls: 400 },
      ] as DeveloperModelSnapshot['tools']['byTool'];
      return s;
    })(),
  },
  {
    label: 'verification-thin',
    probes: 'six test runs across sixty sessions — the adverb has to scale down',
    snapshot: (() => {
      const s = only('rhythm', 'habits');
      s.activity.hourlyDistribution = hours([[2, 20, 40], [3, 21, 12], [4, 20, 8]]);
      s.tools.verification = [
        { kind: 'test', runs: 6, passed: 4 },
        { kind: 'lint', runs: 2, passed: 2 },
      ] as DeveloperModelSnapshot['tools']['verification'];
      return s;
    })(),
  },
  {
    label: 'end-reason-plurality',
    probes: 'the leading end reason is 5 of 20 — a five-way partition, not a habit',
    snapshot: (() => {
      const s = only('habits');
      s.outcomes.endReasons = [
        { reason: 'clear', count: 5 },
        { reason: 'resume', count: 4 },
        { reason: 'prompt_input_exit', count: 4 },
        { reason: 'other', count: 4 },
        { reason: 'logout', count: 3 },
      ];
      return s;
    })(),
  },
  {
    label: 'survival-marginal',
    probes: 'survival at 51% — clears the gate and is not worth saying',
    snapshot: (() => {
      const s = only('survival');
      s.outcomes.lineSurvival = {
        ...SURVIVAL,
        rate: 0.51,
        linesAuthored: 1_402,
        linesSurviving: 715,
        commitsChecked: 31,
        sessionsRated: 22,
        unreachable: 4,
        unknown: 2,
      };
      return s;
    })(),
  },
  {
    label: 'survival-real-shape',
    probes: "the owner's real 30d survival: 68% over a five-figure line count",
    snapshot: (() => {
      const s = only('survival');
      s.outcomes.lineSurvival = {
        ...SURVIVAL,
        rate: 0.68,
        linesAuthored: 41_882,
        linesSurviving: 28_480,
        commitsChecked: 214,
        sessionsRated: 168,
        unreachable: 11,
        unknown: 3,
      };
      s.outcomes.shipRate = 0.71;
      s.outcomes.shipped = 149;
      s.outcomes.shipDeterminable = 210;
      return s;
    })(),
  },
  {
    label: 'friction-one-stuck',
    probes: 'exactly one quiet session — the singular copy path',
    snapshot: (() => {
      const s = only('friction');
      s.outcomes.stuckness = { rate: 0.02, stuckCount: 1, inFlight: 46, stuckSessionIds: ['a'] };
      return s;
    })(),
  },
  {
    label: 'friction-oneshot-dead',
    probes: 'the agentic reality: one-shot near zero, so only the quiet-session half can speak',
    snapshot: (() => {
      const s = only('friction');
      s.outcomes.stuckness = { rate: null, stuckCount: 0, inFlight: 0, stuckSessionIds: [] };
      return s;
    })(),
  },
  {
    label: 'daypart-payoff-disagree',
    probes: 'survival and shipping name DIFFERENT dayparts, and neither is the rhythm daypart',
    snapshot: (() => {
      const s = only('rhythm', 'daypartPayoff');
      s.activity.hourlyDistribution = hours([[2, 20, 14], [3, 21, 6], [4, 9, 2]]);
      s.conditional = {
        lineSurvivalByStartHour: [
          { hour: 9, linesAuthored: 900, linesSurviving: 810, commitsChecked: 9, sessionsRated: 7 },
          { hour: 14, linesAuthored: 800, linesSurviving: 400, commitsChecked: 8, sessionsRated: 6 },
          { hour: 20, linesAuthored: 700, linesSurviving: 350, commitsChecked: 7, sessionsRated: 6 },
        ],
        shipByStartHour: [
          { hour: 14, shipped: 18, determinable: 20 },
          { hour: 9, shipped: 8, determinable: 20 },
          { hour: 20, shipped: 6, determinable: 20 },
        ],
      };
      return s;
    })(),
  },
  {
    label: 'daypart-payoff-below-floor',
    probes: 'two dayparts rated, two below the floor — the coverage line',
    snapshot: (() => {
      const s = only('daypartPayoff');
      s.conditional = {
        lineSurvivalByStartHour: [
          { hour: 20, linesAuthored: 600, linesSurviving: 540, commitsChecked: 8, sessionsRated: 6 },
          { hour: 9, linesAuthored: 600, linesSurviving: 240, commitsChecked: 8, sessionsRated: 6 },
          { hour: 14, linesAuthored: 40, linesSurviving: 20, commitsChecked: 1, sessionsRated: 1 },
          { hour: 2, linesAuthored: 10, linesSurviving: 4, commitsChecked: 1, sessionsRated: 1 },
        ],
        shipByStartHour: [
          { hour: 20, shipped: 9, determinable: 12 },
          { hour: 9, shipped: 3, determinable: 12 },
          { hour: 14, shipped: 1, determinable: 2 },
        ],
      };
      return s;
    })(),
  },
  {
    label: 'shift-clock-change',
    probes: 'the two windows sat under different offsets — the daypart shift must decline',
    snapshot: full(),
    offsetMinutes: 480,
    priorOffsetMinutes: 420,
  },
  {
    label: 'shift-worktype-only',
    probes: 'no daypart or focus move — the work-type shift wins the one slot',
    snapshot: (() => {
      const s = only('craft', 'accrual');
      s.accrual = {
        ...s.accrual!,
        hourlyDistribution: hours([[2, 20, 9], [3, 21, 5]]),
        projectFocus: [
          { repoId: 'r1', project: 'seorak', sessions: 12, share: 0.7 },
          { repoId: 'r2', project: 'feather', sessions: 5, share: 0.3 },
        ],
        branchWorkTypeMix: [
          { workType: 'fix', sessions: 11 },
          { workType: 'feature', sessions: 2 },
        ],
      };
      return s;
    })(),
  },
  {
    label: 'trend-down',
    probes: 'survival fell — the anti-grade direction',
    snapshot: (() => {
      const s = only('survival', 'accrual');
      s.outcomes.lineSurvival = {
        ...SURVIVAL,
        rate: 0.58,
        linesAuthored: 2_400,
        linesSurviving: 1_392,
        commitsChecked: 30,
        sessionsRated: 20,
      };
      s.accrual = {
        ...s.accrual!,
        lineSurvival: {
          ...SURVIVAL,
          rate: 0.82,
          linesAuthored: 1_900,
          linesSurviving: 1_558,
          commitsChecked: 24,
          sessionsRated: 17,
        },
      };
      return s;
    })(),
  },
  {
    label: 'steady-week-flat',
    probes: 'a flat week — steadiest days must go quiet',
    snapshot: (() => {
      const s = only('rhythm');
      s.activity.hourlyDistribution = hours([
        [0, 20, 3], [1, 20, 3], [2, 20, 3], [3, 20, 3], [4, 20, 3], [5, 20, 3], [6, 20, 3],
      ]);
      return s;
    })(),
  },
  {
    label: 'steady-week-real',
    probes: "the owner's real weekday shape — three days inside the 0.75 band suppress the pair",
    snapshot: (() => {
      const s = only('rhythm');
      s.activity.hourlyDistribution = hours([
        [4, 20, 93], [3, 20, 91], [2, 20, 70], [1, 20, 44], [5, 20, 30], [6, 20, 12], [0, 20, 9],
      ]);
      return s;
    })(),
  },
  {
    label: 'remainder-of-one-identity',
    probes: 'exactly one of everything left over — the singular remainder body',
    snapshot: (() => {
      const s = only('rhythm', 'focus');
      s.activity.hourlyDistribution = hours([[2, 20, 5], [3, 9, 1]]);
      s.focus.projectFocus = [
        { repoId: 'r1', project: 'seorak', sessions: 5, share: 0.83 },
        { repoId: 'r2', project: 'feather', sessions: 1, share: 0.17 },
      ];
      return s;
    })(),
  },
  {
    label: 'remainder-of-one-payoff',
    probes: 'one line changed, one open session quiet — singular on the payoff cards',
    snapshot: (() => {
      const s = only('survival', 'friction');
      s.outcomes.lineSurvival = {
        ...SURVIVAL,
        rate: 0.99,
        linesAuthored: 100,
        linesSurviving: 99,
        commitsChecked: 9,
        sessionsRated: 7,
      };
      s.outcomes.stuckness = { rate: 0.5, stuckCount: 1, inFlight: 2, stuckSessionIds: ['a'] };
      return s;
    })(),
  },
  {
    label: 'focus-unattributed-gap',
    probes: "the owner's real shape: more session STARTS than sessions the log could put in a project",
    snapshot: (() => {
      const s = only('rhythm', 'focus');
      // 485 starts against 446 attributed sessions, the live 30-day gap.
      s.activity.hourlyDistribution = hours([
        [1, 9, 62], [2, 9, 44], [3, 9, 91], [4, 9, 96], [5, 9, 72], [6, 9, 63], [0, 9, 57],
      ]);
      s.focus.projectFocus = [
        { repoId: 'r1', project: '1321', sessions: 187, share: 0.419 },
        { repoId: 'r2', project: 'seorak', sessions: 120, share: 0.269 },
        { repoId: 'r3', project: 'feather', sessions: 139, share: 0.312 },
      ];
      return s;
    })(),
  },
  {
    label: 'everything-thin',
    probes: 'every leg present at its minimum — the forming boundary',
    snapshot: (() => {
      const s = full();
      s.activity.hourlyDistribution = hours([[2, 20, 2], [3, 9, 1]]);
      s.focus.projectFocus = [{ repoId: 'r1', project: 'seorak', sessions: 3, share: 1 }];
      s.identity = {
        fileLanguageMix: [{ language: 'rust', calls: 1 }],
        branchWorkTypeMix: [{ workType: 'feature', sessions: 1 }],
      };
      s.tools.byTool = [{ tool: 'Read', calls: 4 }] as DeveloperModelSnapshot['tools']['byTool'];
      s.tools.byModel = [{ model: 'claude-opus-5', calls: 9 }] as DeveloperModelSnapshot['tools']['byModel'];
      s.tools.verification = [{ kind: 'test', runs: 1, passed: 1 }] as DeveloperModelSnapshot['tools']['verification'];
      s.outcomes.endReasons = [{ reason: 'clear', count: 1 }];
      return s;
    })(),
  },
];

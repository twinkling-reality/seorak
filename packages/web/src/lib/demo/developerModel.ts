// Baseline demo DeveloperModelSnapshot. Derived from the same seed repos and
// window totals as createBaselineOverview so Overview and Model stay in lockstep
// under ?demo. DEMO ONLY — fabrication stays here; the live GET /developer-model
// path ships honest empties until real rollups accrue.

import type {
  DeveloperModelSnapshot,
  EndReasonCount,
  HourBucket,
  HourlyEndReasons,
  LineSurvivalStartHourBucket,
  ProjectFocusEntry,
  ShipStartHourBucket,
  VerificationRollup,
} from '@seorak/types';

import { WIDEST_OVERVIEW_RANGE_DAYS } from '@seorak/types';
import { createBaselineOverview, DEFAULT_PERIOD_DAYS } from './baseline.js';
import { allocateIntegerShares } from './rng.js';

/**
 * A LONG TAIL, because a real portfolio has one.
 *
 * This was three repos at 52/33/15. A real solo developer's thirty-day window on
 * this product carries twenty-one, most of them in the low single digits — and
 * the difference is not cosmetic. The portrait normalises how concentrated a
 * leader is against how many things could have won, so a three-repo fixture made
 * every leader look decisive and no fixture ever exercised the runner-up line at
 * the length a reader actually sees.
 */
const REPO_FOCUS_WEIGHTS = [
  { repoId: 'repo-seorak', project: 'seorak', share: 42 },
  { repoId: 'repo-mobile-surfaces', project: 'mobile-surfaces', share: 26 },
  { repoId: 'repo-feather', project: 'feather', share: 9 },
  { repoId: 'repo-halowake', project: 'halowake', share: 6 },
  { repoId: 'repo-orchescope', project: 'orchescope', share: 5 },
  { repoId: 'repo-workmap', project: 'workmap', share: 4 },
  { repoId: 'repo-kinetic-notes', project: 'kinetic-notes', share: 3 },
  { repoId: 'repo-chesstinker', project: 'chesstinker', share: 2 },
  { repoId: 'repo-yummycode', project: 'yummycode', share: 2 },
  { repoId: 'repo-peeknook', project: 'peeknook', share: 1 },
] as const;

/**
 * Language and branch mixes, as SHARES that scale with the window.
 *
 * Both used to be hardcoded absolute counts, identical at 7d, 30d and 90d, so a
 * ninety-day demo read "120 of 168 edit calls" beside thousands of tool calls.
 * The tails are long for the same reason the repo list is: a leading language is
 * only interesting relative to how many it beat.
 */
const LANGUAGE_WEIGHTS = [
  { language: 'typescript', share: 58 },
  { language: 'markdown', share: 11 },
  { language: 'swift', share: 9 },
  { language: 'css', share: 6 },
  { language: 'python', share: 5 },
  { language: 'javascript', share: 4 },
  { language: 'json', share: 3 },
  { language: 'shell', share: 2 },
  { language: 'yaml', share: 1 },
  { language: 'sql', share: 1 },
] as const;

/**
 * `other` is a third of this on purpose.
 *
 * The collector returns it for a trunk branch, a detached HEAD, or any prefix it
 * does not recognise — so on a real window it is the DOMINANT type for anyone who
 * commits on `main`, and the count a reader sees under "sessions" is a share of
 * only the classified ones. The fixture carried no `other` at all, so neither the
 * runner-up rendering nor the classified-denominator gap was ever exercised. It
 * stays a plurality rather than the lead here so the demo still shows the sentence
 * a buyer would see; the silent-on-`other` path is covered by unit tests instead.
 */
const WORK_TYPE_WEIGHTS = [
  { workType: 'feature', share: 46 },
  { workType: 'other', share: 28 },
  { workType: 'fix', share: 14 },
  { workType: 'chore', share: 8 },
  { workType: 'refactor', share: 4 },
] as const;

function buildLanguageMix(editCalls: number): Array<{ language: string; calls: number }> {
  const counts = allocateIntegerShares(editCalls, LANGUAGE_WEIGHTS.map((l) => l.share));
  return LANGUAGE_WEIGHTS.map((l, i) => ({ language: l.language, calls: counts[i] ?? 0 })).filter(
    (l) => l.calls > 0,
  );
}

function buildWorkTypeMix(classified: number): Array<{ workType: string; sessions: number }> {
  const counts = allocateIntegerShares(classified, WORK_TYPE_WEIGHTS.map((w) => w.share));
  return WORK_TYPE_WEIGHTS.map((w, i) => ({ workType: w.workType, sessions: counts[i] ?? 0 })).filter(
    (w) => w.sessions > 0,
  );
}

/**
 * The demo carries the end reasons the WORKER actually sends, verbatim.
 *
 * This used to scrub `resume` (and `bypass_permissions_disabled`) down to `other`, because
 * it was written to match a `schemas/developer-model.ts` enum that had drifted to four
 * values. The two agreed with each other and disagreed with production: the demo parsed
 * cleanly forever while the real snapshot failed on the first `resume` and blanked the
 * whole Model pillar. A fixture that is shaped by the reader's assumptions instead of the
 * sender's output cannot catch a contract bug; it hides one. Emit the real union.
 */
function sanitizeEndReasons(reasons: EndReasonCount[]): EndReasonCount[] {
  const merged = new Map<EndReasonCount['reason'], number>();
  for (const { reason, count } of reasons) {
    merged.set(reason, (merged.get(reason) ?? 0) + count);
  }
  return [...merged.entries()].map(([reason, count]) => ({ reason, count }));
}

function sanitizeEndReasonsByHour(rows: HourlyEndReasons[]): HourlyEndReasons[] {
  return rows.map((row) => ({ ...row, reasons: sanitizeEndReasons(row.reasons) }));
}

function normalizeRangeDays(rangeDays: number): 7 | 30 | 90 {
  if (rangeDays === 7 || rangeDays === 90) return rangeDays;
  return 30;
}

function stripPassRate(
  verification: VerificationRollup[],
): Omit<VerificationRollup, 'passRate'>[] {
  return verification.map(({ kind, runs, passed }) => ({ kind, runs, passed }));
}

/** Evening-heavy session starts — satisfies compiler rhythm + steady-days
 *  thresholds — with a real afternoon and morning tail, so the conditional
 *  payoff slices below have starts to be attributed to and the daypart fold has
 *  more than one bucket to compare.
 *
 *  The SHAPE is fixed and the TOTAL scales with the window. It used to be a
 *  hardcoded 39 sessions at every range while `projectFocus` allocated the real
 *  window total, so at 90d the rhythm card said "32 of 39 session starts" and the
 *  focus card two words later said "238 of 457" — the same window, the same noun,
 *  two totals an order of magnitude apart, in the fixture whose stated job is to
 *  keep Overview and Model in lockstep. */
const MODEL_HOUR_SHAPE = [
  { dow: 2, hour: 19, weight: 5 },
  { dow: 2, hour: 20, weight: 6 },
  { dow: 2, hour: 21, weight: 4 },
  { dow: 3, hour: 19, weight: 5 },
  { dow: 3, hour: 20, weight: 5 },
  { dow: 3, hour: 21, weight: 4 },
  { dow: 4, hour: 20, weight: 3 },
  { dow: 2, hour: 14, weight: 3 },
  { dow: 3, hour: 15, weight: 3 },
  { dow: 1, hour: 9, weight: 1 },
] as const;

function buildHourBuckets(
  shape: readonly { dow: number; hour: number; weight: number }[],
  totalSessions: number,
): HourBucket[] {
  const counts = allocateIntegerShares(totalSessions, shape.map((b) => b.weight));
  return shape
    .map((b, i) => ({ dow: b.dow, hour: b.hour, sessions: counts[i] ?? 0 }))
    .filter((b) => b.sessions > 0);
}

function buildModelHourlyDistribution(windowSessions: number): HourBucket[] {
  return buildHourBuckets(MODEL_HOUR_SHAPE, windowSessions);
}

function buildProjectFocus(windowSessions: number): ProjectFocusEntry[] {
  const counts = allocateIntegerShares(
    windowSessions,
    REPO_FOCUS_WEIGHTS.map((r) => r.share),
  );
  return REPO_FOCUS_WEIGHTS.map((r, i) => ({
    repoId: r.repoId,
    project: r.project,
    sessions: counts[i] ?? 0,
    share: windowSessions === 0 ? null : (counts[i] ?? 0) / windowSessions,
  })).sort((a, b) => b.sessions - a.sessions);
}

/**
 * Conditional outcome counts at UTC-hour grain — the same grain the worker ships,
 * so the demo exercises the fold and the n-floor rather than handing the compiler
 * a pre-decided answer.
 *
 * Shaped so the evening hours clear `CONDITIONAL_OUTCOME_FLOOR` and the morning
 * ones do NOT: the demo's whole job here is to show that a slice below its floor
 * reads honest-empty instead of printing a swingy percentage.
 */
function buildLineSurvivalByStartHour(): LineSurvivalStartHourBucket[] {
  return [
    // Morning: one rated commit, deliberately UNDER the three-commit floor, so the
    // read has to leave it unrated and say so on the card.
    { hour: 9, linesAuthored: 60, linesSurviving: 25, commitsChecked: 1, sessionsRated: 1 },
    // Afternoon: clears the floor at a visibly lower rate than the evening, which
    // is what gives the daypart clause something true to compare.
    { hour: 14, linesAuthored: 180, linesSurviving: 104, commitsChecked: 3, sessionsRated: 3 },
    { hour: 15, linesAuthored: 150, linesSurviving: 88, commitsChecked: 2, sessionsRated: 2 },
    { hour: 19, linesAuthored: 420, linesSurviving: 353, commitsChecked: 6, sessionsRated: 5 },
    { hour: 20, linesAuthored: 380, linesSurviving: 310, commitsChecked: 5, sessionsRated: 4 },
    { hour: 21, linesAuthored: 240, linesSurviving: 176, commitsChecked: 4, sessionsRated: 3 },
  ];
}

/**
 * Shaped so the evening beats the afternoon by more than sampling noise.
 *
 * It used to be 11-of-16 evening against 5-of-10 afternoon, which is an 19-point
 * gap on ten sessions — a coin flip, and `standoutDaypart` now correctly refuses
 * to call it a difference. A demo whose whole job is to exercise the real gates
 * has to clear them with a real margin rather than sit one session under one.
 */
function buildShipByStartHour(): ShipStartHourBucket[] {
  return [
    { hour: 9, shipped: 1, determinable: 2 },
    { hour: 14, shipped: 2, determinable: 6 },
    { hour: 15, shipped: 1, determinable: 4 },
    { hour: 19, shipped: 5, determinable: 6 },
    { hour: 20, shipped: 5, determinable: 6 },
    { hour: 21, shipped: 3, determinable: 4 },
  ];
}

/**
 * The prior adjacent window, shaped so the read has a real change to describe:
 * the same developer, a period earlier, when they still started in the MORNING
 * and were mostly fixing rather than building. Line survival is lower, so the
 * payoff trend has a direction too.
 *
 * Raw hour buckets, exactly as the worker ships them, so the demo exercises the
 * localize-then-compare path rather than handing the compiler a prior conclusion.
 */
const ACCRUAL_HOUR_SHAPE = [
  { dow: 2, hour: 9, weight: 5 },
  { dow: 2, hour: 10, weight: 4 },
  { dow: 3, hour: 9, weight: 5 },
  { dow: 3, hour: 10, weight: 3 },
  { dow: 4, hour: 20, weight: 2 },
] as const;

function buildAccrual(windowSessions: number): NonNullable<DeveloperModelSnapshot['accrual']> {
  // The prior window as a fraction of this one, scaled the same way, so
  // `accrual.sessions` and the accrual `projectFocus` counts divide against ONE
  // total. They did not: `sessions` was a hardcoded 19 while the focus counts came
  // off the window total, which is what made the shift card print "58%, 63 of 19".
  const priorSessions = Math.max(5, Math.round(windowSessions * 0.4));
  const hourlyDistribution = buildHourBuckets(ACCRUAL_HOUR_SHAPE, priorSessions);
  const sessions = hourlyDistribution.reduce((sum, b) => sum + b.sessions, 0);
  const focusCounts = allocateIntegerShares(sessions, [58, 29, 13]);
  return {
    sessions,
    hourlyDistribution,
    projectFocus: [
      {
        repoId: 'repo-mobile-surfaces',
        project: 'mobile-surfaces',
        sessions: focusCounts[0] ?? 0,
        share: sessions === 0 ? null : (focusCounts[0] ?? 0) / sessions,
      },
      {
        repoId: 'repo-seorak',
        project: 'seorak',
        sessions: focusCounts[1] ?? 0,
        share: sessions === 0 ? null : (focusCounts[1] ?? 0) / sessions,
      },
      {
        repoId: 'repo-feather',
        project: 'feather',
        sessions: focusCounts[2] ?? 0,
        share: sessions === 0 ? null : (focusCounts[2] ?? 0) / sessions,
      },
    ].filter((p) => p.sessions > 0),
    branchWorkTypeMix: [
      { workType: 'fix', sessions: 11 },
      { workType: 'feature', sessions: 4 },
    ],
    lineSurvival: {
      rate: 0.61,
      linesAuthored: 720,
      linesSurviving: 439,
      commitsChecked: 9,
      sessionsRated: 7,
      retained: 5,
      overwritten: 2,
      unreachable: 1,
      unknown: 0,
    },
  };
}

export function createBaselineDeveloperModel(
  rangeDays = DEFAULT_PERIOD_DAYS,
  overview?: ReturnType<typeof createBaselineOverview>,
): DeveloperModelSnapshot {
  const normalizedRange = normalizeRangeDays(rangeDays);
  const ov = overview ?? createBaselineOverview(normalizedRange);
  const windowSessions = ov.usage.totals.sessions;
  // The same call total the tool rollups divide by, so the language mix cannot
  // claim more edit calls than the window made.
  const windowCalls = ov.tools.byTool.reduce((sum, t) => sum + t.calls, 0);
  const hourlyDistribution = buildModelHourlyDistribution(windowSessions);

  return {
    scope: {
      rangeDays: normalizedRange,
      // Demo is unclamped, matching the baseline overview fixture.
      maxRangeDays: WIDEST_OVERVIEW_RANGE_DAYS,
      repoId: null,
      generatedAt: ov.generatedAt,
    },
    focus: { projectFocus: buildProjectFocus(windowSessions) },
    outcomes: {
      shipRate: ov.outcomes.shipRate,
      lineSurvival: ov.outcomes.lineSurvival,
      // The counts behind the two rates above, so the demo exercises the same
      // check-my-work path a real read gives a reader.
      shipped: Math.round(windowSessions * (ov.outcomes.shipRate ?? 0) * 0.8),
      shipDeterminable: Math.round(windowSessions * 0.8),
      stuckness: ov.outcomes.stuckness,
      endReasons: sanitizeEndReasons(ov.outcomes.endReasons),
    },
    activity: {
      hourlyDistribution,
      endReasonsByHour: sanitizeEndReasonsByHour(ov.activity.endReasonsByHour),
    },
    tools: {
      byTool: ov.tools.byTool,
      byModel: ov.tools.byModel,
      callStats: {
        errorRate: ov.tools.callStats.errorRate,
        // The counts behind the rate, on the same pattern as the two above: about
        // two thirds of a window's calls come back with a boolean success flag
        // (the rest are tools a capability gate says cannot report one), and the
        // errors are that denominator times the rate the fixture already states.
        callsWithResult: Math.round(windowCalls * 0.65),
        erroredCalls: Math.round(windowCalls * 0.65 * (ov.tools.callStats.errorRate ?? 0)),
      },
      verification: stripPassRate(ov.tools.verification),
    },
    identity: {
      // Both scale with the window. Edit calls run at roughly a fifth of the
      // window's tool calls, and about two thirds of sessions get a branch the
      // collector can classify — the rest are trunk or detached, which is what
      // makes the work-type denominator smaller than the session count.
      fileLanguageMix: buildLanguageMix(Math.max(20, Math.round(windowCalls * 0.2))),
      branchWorkTypeMix: buildWorkTypeMix(Math.max(3, Math.round(windowSessions * 0.65))),
    },
    conditional: {
      lineSurvivalByStartHour: buildLineSurvivalByStartHour(),
      shipByStartHour: buildShipByStartHour(),
    },
    accrual: buildAccrual(windowSessions),
  };
}

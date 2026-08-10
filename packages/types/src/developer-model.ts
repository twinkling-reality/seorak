import type { OverviewRangeDays } from "./api.ts";
import type { IsoTimestamp } from "./events.ts";
import type {
  EndReasonCount,
  HourBucket,
  HourlyEndReasons,
  LineSurvivalRollup,
  ModelRollup,
  OutcomesSnapshot,
  ToolCallRollup,
  VerificationRollup,
} from "./overview.ts";

/**
 * DeveloperModelSnapshot — slow-loop introspection read (docs/specs/introspection.md).
 * Identity-led period portrait: rhythm, focus, stack, shape, payoff. Worker-owned
 * projection; web compiles to prose + color-coded insights. Publish-safe: counts and
 * closed enums only. Honest-empty: optional fields absent until measured; rates null
 * below n-floors. Effectiveness = outcome | dimension, never volume | dimension.
 *
 * v0: GET /developer-model ships; web compiles snapshot to prose + insights.
 */

/** Scope for a developer-model read. Identity v1 = local install (no login). */
export interface DeveloperModelScope {
  rangeDays: OverviewRangeDays;
  /** The widest window this deployment's plan will build, so the Model range
   *  picker can narrow itself to what the worker will serve. Same contract as
   *  `OverviewSnapshot.maxRangeDays`; see docs/specs/pricing.md. */
  maxRangeDays: OverviewRangeDays;
  /** null = all repos merged; set = single ProjectRollup slice */
  repoId: string | null;
  generatedAt: IsoTimestamp;
}

/**
 * n-floors a conditional outcome slice must clear before its rate may be spoken.
 *
 * Shared because the split of work is split across two packages: the worker ships
 * the COUNTS (it cannot know the reader's timezone, so it cannot choose the
 * buckets), and the surface folds them into the reader's own dayparts and divides.
 * If each owned its own floor they would disagree about when a slice is sayable,
 * and the disagreement would show up as a percentage appearing on one surface and
 * not another over identical data.
 */
export const CONDITIONAL_OUTCOME_FLOOR = {
  /** Rated commits behind a line-survival slice. Matches the global line-survival
   *  floor: a slice must never be softer than the headline it sits under. */
  lineSurvivalCommits: 3,
  /** Sessions whose shipping the log could determine, within one bucket. */
  shipDeterminable: 5,
} as const;

/**
 * ── Why there is no `oneShotRate` here ──────────────────────────────────────
 *
 * There was, and it never rendered. A session counts as one-shot when the
 * run-length-encoded stream of its tool names visits each tool at most once, so
 * an agent that reads, edits and reads again has already failed it — and the
 * portrait only spoke the facet above 50%. On the owner's own log the rate is
 * **1.7% at 90 days, 2.3% at 30 and 1.8% at 7**: the sentence was unreachable by
 * a factor of twenty-five, and "without doubling back" described a retry loop the
 * measurement had never looked for.
 *
 * Removing it from THIS contract removes the read that fed it, which returns a
 * D1 statement to a build the op-budget test holds at its measured cost. The
 * measurement itself is untouched and still rendered where it has a reader:
 * `OverviewSnapshot.outcomes.oneShotRate`, the outcomes panel, Compare, and the
 * mobile home deck.
 */
export interface DeveloperModelOutcomes {
  shipRate: number | null;
  lineSurvival: LineSurvivalRollup;
  stuckness: OutcomesSnapshot["stuckness"];
  endReasons: EndReasonCount[];
  /**
   * The two counts `shipRate` is the quotient of.
   *
   * Always present, on the global read as well as a repo one. They used to ship
   * only when `scope.repoId` was set, which left the merged portrait with a bare
   * percentage and nothing under it: a surface could print "68% of finished
   * sessions shipped a change" and a reader had no way to ask 68% of how many.
   * A rate a reader cannot check is a claim, not a measurement.
   */
  shipped: number;
  /** Sessions whose delta could DETERMINE shipping. `shipRate` is null when 0. */
  shipDeterminable: number;
}

export interface DeveloperModelActivity {
  hourlyDistribution: HourBucket[];
  endReasonsByHour: HourlyEndReasons[];
}

export interface DeveloperModelTools {
  byTool: ToolCallRollup[];
  byModel: ModelRollup[];
  callStats: {
    errorRate: number | null;
    /**
     * The two counts `errorRate` is the quotient of.
     *
     * It was the last bare percentage in the portrait. The card under the tools
     * sentence printed "6% of the calls that reported whether they succeeded came
     * back an error" and a reader could not ask 6% of how many — the denominator
     * is neither every call nor every tool (a capability gate decides which tools
     * can report both legs), so it could not be inferred from anything else on the
     * read either. Same fix as `outcomes.shipped` / `shipDeterminable`.
     *
     * Zero extra D1: `errorRateFromBuckets` already sums both to divide them, and
     * the per-repo `ProjectRollup` has shipped `toolErrors` / `toolCallsReturned`
     * since it was cut. Only the global read threw them away.
     */
    erroredCalls: number;
    /** Calls that came back with a boolean success flag — the denominator. */
    callsWithResult: number;
  };
  /** Kind run counts only. Excludes passRate from the Model per honesty rules, so the
   *  type drops it too (the worker/demo builders strip it). */
  verification: Omit<VerificationRollup, "passRate">[];
}

/**
 * Line-survival counts for the sessions that STARTED in one UTC hour.
 *
 * The hour is the session's START, not the check's: the question the payoff facet
 * answers is "when I sit down at this time of day, does the work last", and the
 * survival check runs days later on the daemon's own schedule.
 */
export interface LineSurvivalStartHourBucket {
  /** UTC hour 0-23 of the session start. */
  hour: number;
  linesAuthored: number;
  linesSurviving: number;
  commitsChecked: number;
  sessionsRated: number;
}

/** Ship counts for the sessions that STARTED in one UTC hour. */
export interface ShipStartHourBucket {
  /** UTC hour 0-23 of the session start. */
  hour: number;
  /** Sessions whose delta landed at least one commit. */
  shipped: number;
  /** Sessions whose delta could DETERMINE shipping (start HEAD known). */
  determinable: number;
}

/**
 * Conditional outcomes — the payoff facet's "when does my work tend to last".
 *
 * COUNTS, at UTC-hour grain, never rates at a named bucket. Two reasons, and both
 * are load-bearing:
 *
 *  1. A rate cannot be re-bucketed. The reader's "evening" is a set of UTC hours
 *     that depends on where they are, and the worker does not know that — it
 *     never sees a timezone. Ship it a rate per worker-chosen bucket and the only
 *     honest thing a surface could do with it is show it in UTC.
 *  2. The n-floor has to be applied AFTER the fold. Twenty-four hourly slices
 *     will each fail a floor for a solo developer while the four dayparts they
 *     add up to clear it comfortably, so flooring at hour grain would suppress
 *     every slice that was actually measurable.
 *
 * Absent (not empty) when the window measured nothing to condition on.
 */
export interface DeveloperModelConditional {
  lineSurvivalByStartHour?: LineSurvivalStartHourBucket[];
  shipByStartHour?: ShipStartHourBucket[];
}

/** Per-repo session share for the Focus facet (v0). */
export interface ProjectFocusEntry {
  repoId: string;
  project: string;
  sessions: number;
  /** null when total window sessions is 0 — never zero-filled. */
  share: number | null;
}

export interface DeveloperModelFocus {
  projectFocus: ProjectFocusEntry[];
}

/**
 * v1 identity projections.
 *
 * There is deliberately no day-of-week rollup here. One shipped and was removed:
 * it summed sessions per UTC weekday, and a weekday is exactly the thing a
 * timezone shift moves — a Tuesday-evening session in US-Pacific is a Wednesday
 * in UTC. Because it collapsed the hour away, no surface could shift it back, so
 * it was a field that could only ever be wrong for a reader off UTC. The surfaces
 * derive weekdays from `activity.hourlyDistribution`, which keeps the hour and
 * can be localized.
 */
export interface DeveloperModelIdentity {
  fileLanguageMix?: Array<{ language: string; calls: number }>;
  branchWorkTypeMix?: Array<{ workType: string; sessions: number }>;
}

/**
 * Accrual — the same portrait one period earlier, so the read can answer "what
 * changed" and not just "what is".
 *
 * The window is the SAME adjacent split every other period-over-period leg on
 * this product uses (`PeriodDelta`, ADR-WS4/WS5): current is `[now-range, now)`
 * and this is `[now-2*range, now-range)`.
 *
 * ── Distributions, not conclusions ──────────────────────────────────────────
 * `hourlyDistribution` ships as raw UTC buckets rather than "you were a morning
 * developer then", for the same reason `conditional` ships counts: a daypart is a
 * fact about the reader's clock and the worker has never seen one. Shipping the
 * prior CONCLUSION would let the read compare a UTC daypart against a localized
 * one and announce a shift that never happened.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * There is no prior language, tool or model mix. Those come from the per-hour
 * ROLLUP reads, which are ~98% of this build's rows; doubling the window to give
 * one facet a memory would double the whole read path. Everything here rides the
 * session-grain scans instead, which are a rounding error by comparison and grow
 * with sessions rather than with call volume. That line is the reason accrual is
 * affordable at all, so it is written down rather than rediscovered.
 *
 * There is also no prior ship rate. Its legs are aggregated INSIDE a scan shared
 * with `/overview`, whose current-window membership is keyed on each delta row's
 * own timestamp; re-cutting that for a prior window would either change a rate
 * two surfaces have been showing or cost a second scan of the same rows. Survival
 * already gives the payoff facet a memory, and shipping can join it the next time
 * that scan changes shape for a reason of its own.
 *
 * Absent entirely when the prior window holds no session: a quiet fortnight and a
 * window from before capture existed are indistinguishable from the log alone, so
 * this is never a fabricated zero baseline.
 */
export interface DeveloperModelAccrual {
  /** Session starts in the prior window. The volume gate for everything below. */
  sessions: number;
  /** Prior-window UTC hour buckets, localized by the surface. */
  hourlyDistribution: HourBucket[];
  projectFocus: ProjectFocusEntry[];
  branchWorkTypeMix?: Array<{ workType: string; sessions: number }>;
  lineSurvival: LineSurvivalRollup;
}

/** Slow-loop introspection snapshot. Not Overview's widget grid or live board. */
export interface DeveloperModelSnapshot {
  scope: DeveloperModelScope;
  focus: DeveloperModelFocus;
  outcomes: DeveloperModelOutcomes;
  activity: DeveloperModelActivity;
  tools: DeveloperModelTools;
  /** v1 — absent until identity projections ship. */
  identity?: DeveloperModelIdentity;
  conditional?: DeveloperModelConditional;
  /** Absent when the prior adjacent window holds no session at all. */
  accrual?: DeveloperModelAccrual;
}

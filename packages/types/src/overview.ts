import type {
  AgentId,
  BranchWorkType,
  FileCategory,
  FileLanguage,
  Framework,
  IsoTimestamp,
  GitContext,
  PackageManager,
  RepoShape,
  SessionId,
  SessionEndReason,
  LineSurvivalFate,
} from "./events.ts";
import type { ResolvedSessionCapabilities } from "./capabilities.ts";
import type { InterventionThresholds } from "./intervention.ts";
import type { SessionSummary } from "./summary.ts";
import type { UsageAllowance } from "./usage-allowance.ts";
import type { NotificationAvailability } from "./notification-availability.ts";

/**
 * OverviewSnapshot — a people-ranking-free aggregate family for the web
 * dashboard: live sessions plus usage / outcomes / activity / tools rollups.
 * A live shared-workspace session may identify its responsible member, but no
 * aggregate is grouped or scored by person. There are no conflict, memory, or
 * conversation fields. Every field traces to real capture: current KV session
 * state plus the retained D1 event log (wired in production via EVENTS_DB). A
 * field is empty/null only until the rows it needs accrue, never zero-filled.
 * Publish-safe.
 */
export interface OverviewSnapshot {
  /** When the worker computed this snapshot. */
  generatedAt: IsoTimestamp;
  /** Window the aggregates cover (7 | 30 | 90). Echoes the ?days query, EXCEPT
   *  when the plan ceiling below narrowed it. */
  rangeDays: number;
  /**
   * The widest window this deployment's plan will build (docs/specs/pricing.md).
   * Advertised on every snapshot so a surface can narrow its own range picker to
   * what the worker will actually serve, which is what keeps the ceiling
   * invisible in normal use.
   *
   * It is a plan property rather than a per-request flag on purpose: a snapshot
   * for a given window is then identical whether the caller asked for that
   * window or was clamped down to it, so the aggregate cache stays correct
   * without a second key. A surface detects the clamp by comparing what it asked
   * for against this value, and says something true about it rather than
   * labelling 30 days of data as 90.
   */
  maxRangeDays: number;

  /** The real-time current sessions board (HERO). Shared rows name the responsible member. */
  live: SessionSummary[];

  usage: UsageSnapshot;
  outcomes: OutcomesSnapshot;
  activity: ActivitySnapshot;
  tools: ToolsSnapshot;
  codebase: CodebaseSnapshot;

  /** Content-free watch applicability from resident session capability facts.
   * Optional only for rolling compatibility with a worker predating the field;
   * current workers always emit it. Missing means unknown, never unavailable. */
  notificationAvailability?: NotificationAvailability;

  /** The intervention thresholds the worker's wedge engine is ACTUALLY watching
   *  this deploy — `DEFAULT_THRESHOLDS` overlaid with any per-deploy env overrides
   *  (FOLLOW-UP #3). Surfaced so the web's "what is Seorak watching for?" cards show
   *  the real limits, not the hardcoded defaults, when an operator has tuned them.
   *  Config, not measured data, so it is always present from a current worker
   *  and never has an honest-empty state. */
  thresholds: InterventionThresholds;

  /** Per-(tool, window) usage-headroom readings for the ambient surfaces — the
   *  rolling 5-hour + weekly Claude token windows today (see `UsageAllowance`).
   *  FIXED windows, independent of `rangeDays`. Honest-empty `[]` until the event
   *  log holds tool.call rows; each reading's ceiling/reset stay null until honestly
   *  known (see `UsageAllowance`). NOTHING RENDERS THESE since the menu bar was
   *  removed on 2026-08-08; web and mobile only round-trip them through contract
   *  parity (reference/menubar-purpose-decision.md, "What the removal orphaned"). */
  usageAllowances: UsageAllowance[];
}

/** Per-day point. Filled from the retained D1 event log (assembleDailyTrends over
 *  session.start + tool.call rows); the array is empty (not zero-filled) only until
 *  in-window rows accrue — widgets render an honest empty state, never a fake flat
 *  line. Carries ONLY the two
 *  members a rendered widget needs: `sessions` (the `sessions` trend) and
 *  `costUsd` (the `cost` trend). Per-day `tokensTotal`/`toolCalls` members were
 *  REMOVED — no widget renders a daily token or daily tool-call trend, so they
 *  would be unrendered fields. Re-add only alongside a named trend widget. */
export interface DailyPoint {
  /** ISO date YYYY-MM-DD. Bucketed by EACH EVENT's own `at` date, NOT by session
   *  start — a midnight-spanning session splits across days. */
  day: string;
  sessions: number;
  /** null when no cost was measured that day (never 0 as a stand-in). */
  costUsd: number | null;
  /** Input+output tokens that day (cache excluded), summed across per-call
   *  `models[]` rows AND each tool's session carrier; 0 means neither carrier
   *  measured tokens that day. Optional because the web widget layer never
   *  carried it, and NOTHING READS IT AT ALL since the menu bar went on
   *  2026-08-08. Still emitted; dropping it is a wire-contract decision
   *  (reference/menubar-purpose-decision.md, "What the removal orphaned"). */
  tokensTotal?: number;
}

export interface PeriodDelta {
  current: number;
  /** null suppresses the delta pill entirely (first period / no prior). */
  previous: number | null;
}

export interface UsageSnapshot {
  /** Immediate scalars, summed over the sessions currently held in KV within the
   *  window. `sessions` feeds the `sessions` scalar; `toolCalls` feeds the
   *  tool-mix summary row. A window `tokensTotal` aggregate was REMOVED — no
   *  widget renders a window token total (token throughput is a live-surface /
   *  mobile metric, not a web widget). Per-session token/cache figures remain on
   *  `live[].tokens.*` (inherited from SessionSummary) for any future tokens
   *  widget. */
  totals: {
    /**
     * Sessions that MEASURED something: a tool call, or a priced session carrier.
     *
     * This is the denominator of the panel it sits in. `toolCalls` and
     * `cost.totalUsd` beside it count only sessions that did work, and a surface
     * divides one by the other, so a session that produced neither would make
     * this the only member able to see it and every rate beside it wrong by the
     * size of the class. The rule is the one `outcomes.oneShotRate` already
     * carries ("ended sessions that ran a named tool") applied to the last member
     * that was missing it.
     *
     * It is NOT a claim about who opened the session. A start hook fires when an
     * agent process boots, before anyone has typed, and nothing on
     * `SessionStartEvent` says why it launched, so a developer who opened a
     * session and closed it without typing is excluded for exactly the same
     * reason another program's short-lived process is. Counting is the only
     * question being answered; attribution is not.
     *
     * The permanent local record is untouched and still holds every row. A
     * surface that reports this number is expected to SAY what it counts, the
     * same obligation project archiving carries.
     */
    sessions: number;
    toolCalls: number;
    /** Period-over-period session count (ADR-WS4/WS5). Both legs are distinct
     *  `session.start` counts over the SAME adjacent windows as `cost.delta`
     *  (current `[now-range, now)`, previous `[now-2*range, now-range)`), read
     *  from the retained D1 event log — the KV-derived `sessions` headline above
     *  windows by `lastEventAt` and cannot reconstruct a prior window, so the
     *  delta keeps its own clean event-log legs (same split as cost). `previous`
     *  is null (whole pill suppressed) when the prior window holds no
     *  `session.start` row — a quiet fortnight and a pre-log-era window are
     *  indistinguishable from the log alone, so it is never a fabricated 0
     *  baseline. The whole field is null without usable event-log history. */
    sessionsDelta: PeriodDelta | null;
  };
  cost: {
    /** Sum of costUsd over window; null when sessionsWithCost === 0. */
    totalUsd: number | null;
    /** sessions that reported any cost (for the "--" honesty gate). */
    sessionsWithCost: number;
    /** True when a session that COULD price its work (cost:'estimated') was excluded
     *  from `totalUsd` because no price could be derived (an unpriced model). The
     *  total then UNDERSTATES spend; surfaces mark it "partial", never present it as
     *  complete. Intentionally omitted when false so a complete total carries no
     *  redundant marker; the web normalizes that sparse current representation. */
    costPartial?: boolean;
    /**
     * The models in this window that we have NO PRICE ROW FOR, named, with the tokens
     * they burned. `costPartial` says the total understates spend; this says BY WHAT,
     * which is the difference between a shrug and an action.
     *
     * It exists because the boolean alone was not enough. This machine ran 3.49 BILLION
     * tokens through `claude-fable-5` while the pricing table had no row for it. Every
     * one priced to $0.00, the headline understated real spend by $5,225 (19%), the
     * surface dutifully said "partial", and nobody could tell WHICH model to add. A
     * capture product that silently under-reports the user's own bill has failed at the
     * one thing it exists to do.
     *
     * ONLY `unknown-model` appears here (the table is stale, a row is owed). A model we
     * know about and deliberately cannot price (`no-published-price` — a research preview
     * with no list rate) is permanently honest-empty and is NOT an action, so it stays out.
     *
     * Empty array when every model in the window priced. Derived from the tool.call rows
     * the build already scans, so it costs ZERO new D1 statements. @grounding cost
     */
    unpricedModels?: UnpricedModel[];
    /** current vs prior window. delta.current is summed from the sessions currently
     *  held in KV; delta.previous is filled from the retained D1 event log — the
     *  prior window [now-2*range, now-range) is summed via windowedCostFromRows
     *  (KV holds latest state only and cannot reconstruct a prior window). `previous`
     *  is null (whole pill suppressed) only when the prior or current window had no
     *  measured cost — never as a stand-in for a missing log. */
    delta: PeriodDelta | null;
  };
  /** Edit-tool line delta over the window, summed from tool.call rows that carry
   *  the collector's ON-MACHINE derivation (ToolCallEvent.linesAdded/linesRemoved
   *  — an LCS line-diff of the edit payload, counts only; CAPTURE-PRINCIPLE).
   *  This is AGENT EDIT VOLUME, deliberately distinct from `momentum`'s git
   *  ground-truth lines: an edit the agent later reverts still happened here,
   *  while momentum only counts what the repo actually shows. `delta` compares
   *  ADDED lines against the adjacent prior window (`previous` null when the
   *  prior window had no measured rows — pill suppressed). The whole object is
   *  null — never zero-filled — until in-window rows carry the fields (old
   *  collector versions don't). @grounding usage */
  lines: {
    added: number;
    removed: number;
    delta: PeriodDelta | null;
  } | null;
  /** Filled from the retained D1 event log via assembleDailyTrends; the array is
   *  empty only until in-window rows accrue. */
  dailyTrends: DailyPoint[];
  /** Per-repo comparator (the `projects` widget). One row per repo — rank by
   *  sessions / cost / recency. For paired A/B ("why did this repo feel different
   *  from that one?") see `docs/specs/multi-repo.md`.
   *  Summed from the sessions currently held in KV + event-log rollups. */
  projects: ProjectRollup[];
  /** Per-repo git ground-truth: files-touched + NET change over a trailing
   *  window. The latest snapshot per repo (cumulative `git.momentum` events,
   *  never summed). Honest-empty `[]` until git.momentum events land — never
   *  zero-filled. Carries the counts; rendering them as a visualization is a
   *  separate concern. @grounding outcome */
  momentum: RepoMomentum[];
  /** Cross-repo portfolio momentum: the breadth headline ("moved X of N repos;
   *  M went quiet") + a per-repo heating/cooling TEMPERATURE judged against each
   *  repo's OWN trailing baseline. Derived from the SAME `git.momentum` rows as
   *  `momentum`, but reads the trailing HISTORY (not just the latest snapshot) to
   *  compute the baseline. The worker emits COUNTS + the temperature enum only —
   *  the headline STRING and any "+X lines" framing are deliberately NOT here
   *  (anti-vanity: breadth is files-touched/commits/recency, never raw LOC).
   *  Honest-empty: `repos: []` + zero counts when there is no in-window history
   *  (same present-but-empty discipline as `momentum`). @grounding outcome */
  portfolio: PortfolioMomentum;
  /** 0..1 cache-reuse ratio = cacheRead / (cacheRead + input) summed across the
   *  sessions currently held in KV. `null` (never 0 as a stand-in) until a
   *  session has measurable tokens (denominator > 0). @grounding cost */
  cacheReuseRatio: number | null;
  /** Window cost ÷ edit-family tool.calls (rows carrying the on-machine line
   *  derivation). null — never $0 — when either side is unmeasured (no costed
   *  rows, or no edit calls in window). A deliberate 2026-06-09 reversal of the
   *  CAPTURE-PRINCIPLE "stays refused" call — decided by Glendon. @grounding cost */
  costPerEdit: number | null;
}

/**
 * RepoCharacter — latest-wins repo identity (shape, toolchain). Sourced from
 * git.momentum.repoShape and repo.toolchain events; NOT recomputed per 7/30/90
 * window. Omitted until at least one character signal lands.
 */
export interface RepoCharacter {
  repoShape?: RepoShape;
  packageManager?: PackageManager;
  framework?: Framework;
  /** Event time of the character snapshot (shape or toolchain, whichever is newer). */
  observedAt?: IsoTimestamp;
}

/**
 * RepoWorkMix — window-scoped work-shape mix for a repo (compare + Model identity).
 * Recomputed per overview window; honest-empty fields omitted.
 */
export interface RepoWorkMix {
  fileLanguageMix?: Array<{ language: FileLanguage; editCalls: number }>;
  branchWorkTypeMix?: Array<{ workType: BranchWorkType; sessions: number }>;
  fileCategoryMix?: Array<{ category: FileCategory; editCalls: number }>;
  /** Peak session-start bucket in this window; null when flat or no sessions. */
  peakHour?: { dow: number; hour: number; sessions: number } | null;
  /** Median ended-session duration in this window (seconds); null when none ended. */
  sessionDurationMedianSeconds?: number | null;
}

/**
 * The one row that carries work done OUTSIDE any git repository.
 *
 * An agent run in a home directory, in `/tmp`, or in a folder whose name is a
 * prompt fragment is not a project, and listing each as one buries the real
 * projects: a measured local record had 24 project rows of which 10 were this.
 * But the work is real tokens and real time, so it is FOLDED here rather than
 * discarded — honest-empty means not fabricating, not deleting.
 *
 * Every project-scoped leg on this row is honest by construction: none of the
 * git-derived measures (line survival, ship rate, commit attribution) can exist
 * for a non-repo, so they read empty here for the same reason they read empty
 * anywhere else — nothing measured them.
 *
 * The id is a fixed sentinel rather than a salted hash so it is stable across
 * machines and restarts, which is what lets per-project settings (theme,
 * archive) key off it like any other row. Its 64-hex shape matches a real
 * `repoId` so no surface needs a special case to render it.
 */
export const NON_REPO_PROJECT_ID = "0".repeat(64);

/** Label for `NON_REPO_PROJECT_ID`. Names the boundary that was crossed rather
 *  than the directories involved, because the directories are the noise. */
export const NON_REPO_PROJECT_LABEL = "Outside a repo";

export interface ProjectRollup {
  project: string;       // basename (display label)
  repoId: string;        // salted per-repo id — the grouping key; never the path
  /**
   * Set when the owner archived this project (`projectArchive`). Project LISTS
   * hide it; Settings still shows it, which is what makes the archive
   * reversible — a restore control needs the label, and the label only exists
   * on this rollup.
   *
   * STAMPED, not filtered out at the source, deliberately. Dropping the row
   * would mean the surface that offers "restore" has nothing but a repoId to
   * name it by, and its window totals would silently stop matching the global
   * ones. Absent means active: nothing is hidden until you hide it.
   */
  archived?: boolean;
  // Per-repo window rollups. Overview merges all repos; Project and period
  // Compare scope to one row; explicit repo A/B reads two rows side-by-side.
  sessions: number;
  /** Per-repo session-start period delta over symmetric adjacent windows. Both
   *  legs count distinct `session.start` session ids attributed to this repo.
   *  null on the KV-only path, whose last-active window cannot reconstruct start
   *  history; `previous` null when the prior event-log window has no starts, so a
   *  missing/quiet baseline is never presented as a measured zero. */
  sessionsDelta: PeriodDelta | null;
  activeSessions: number;
  toolCalls: number;
  tokensTotal: number;
  /** null (never 0) when no session in this repo reported cost — the per-repo
   *  silent-zero ban, mirroring AgentRollup.costUsd. A repo whose sessions are all
   *  `cost: 'none'` (or measured exactly $0) reads honest-empty, not a fabricated $0. */
  costUsd: number | null;
  lastEventAt: IsoTimestamp;
  /** Per-repo tool error rate (errored ÷ calls-that-returned a flag), the same
   *  definition as the global `tools.callStats.errorRate` grouped by repo. null
   *  (never 0) without the event log or until a call in this repo returns a boolean
   *  error signal — honest-empty, never a fabricated 0%. @grounding outcome */
  errorRate: number | null;
  /** Per-repo cache-reuse ratio (cacheRead ÷ (cacheRead + input)) over this repo's
   *  sessions, the same definition as the global `usage.cacheReuseRatio` grouped by
   *  repo. null (never 0) when the denominator is 0 — no honest signal yet. */
  cacheReuseRatio: number | null;
  /** Per-repo ship rate (sessions that landed a commit ÷ sessions whose shipping was
   *  determinable), the same definition as the global `outcomes.shipRate` grouped by
   *  repo. null (never 0) without the event log or until a session.delta in this repo
   *  can determine shipping — honest-empty. @grounding outcome */
  shipRate: number | null;
  /** Per-repo one-shot rate (ended sessions that ran without a retry loop ÷ ended
   *  sessions with tool calls), the same definition as the global `outcomes.oneShotRate`
   *  grouped by repo. null (never 0) without the event log / until a session ends. */
  oneShotRate: number | null;
  /** Per-repo cost period-over-period: the current-window cost and the prior-window
   *  cost (event-log priced legs, the SAME source as the global delta — distinct from
   *  the hybrid `costUsd` headline). null when this repo had no priced row in the
   *  current window (no trend to show); `previous` null when the prior window had none
   *  (the delta pill is suppressed, never a fabricated 0). */
  costDelta: { current: number; previous: number | null } | null;
  /** Per-repo session end-reason breakdown (the same lifecycle reasons as the
   *  global `outcomes.endReasons`, grouped by this repo). Honest-empty [] until a
   *  session in this repo ends with a recorded reason. */
  endReasons: EndReasonCount[];
  /** Per-repo stuckness (the same signal as the global `outcomes.stuckness`,
   *  grouped by this repo's in-flight sessions). rate null when this repo has no
   *  in-flight session; stuckCount 0 + [] until the cron flags one (never a
   *  fabricated 0). */
  stuckness: {
    rate: number | null;
    stuckCount: number;
    /** The denominator `rate` is taken over — this repo's sessions that have not
     *  ended. Same reason as `shipped` / `shipDeterminable`: a surface printing
     *  the rate alone leaves a reader no way to ask "of how many", and the only
     *  other way to recover it is `stuckCount / rate`, which is the reconstruction
     *  the evidence rules forbid. Zero D1 cost — the KV reduction already counts
     *  it to compute the rate. */
    inFlight: number;
    stuckSessionIds: string[];
  };
  /** Per-repo tool-call mix + per-model spend (the same as global `tools.byTool` /
   *  `tools.byModel`, grouped by this repo). Honest-empty [] until tool calls accrue. */
  byTool: ToolCallRollup[];
  byModel: ModelRollup[];
  /** Per-repo agent rollup (the same as global `tools.byAgent`, grouped by this
   *  repo). Honest-empty [] until sessions for an agent accrue here. Feeds the
   *  Agents → Projects matrix (Claude vs Codex by repo). `lines` stays null per
   *  agent until in-window edit rows carry the derivation (silent-zero ban). */
  byAgent: AgentRollup[];
  /** Per-repo session-start rhythm (the same dow x hour grid as the global
   *  `activity.hourlyDistribution`, grouped by this repo). Honest-empty [] until
   *  this repo's sessions accrue across hours. */
  hourlyDistribution: HourBucket[];
  /** Per-repo on-branch line survival (the same as global `outcomes.lineSurvival`,
   *  grouped by this repo). null until this repo accrues survival checks (never a
   *  fabricated 0). */
  lineSurvival: LineSurvivalRollup | null;
  /** Per-repo per-hour session-end reasons (the same as global
   *  `activity.endReasonsByHour`, grouped by this repo). Honest-empty [] until this
   *  repo's sessions end across hours. */
  endReasonsByHour: HourlyEndReasons[];
  /** Per-repo hot files (same as global `codebase.files`, scoped to this repo).
   *  Honest-empty [] until edit calls accrue. */
  codebaseFiles: FileHeat[];
  /** Per-repo directory heat (same as global `codebase.directories`). */
  codebaseDirectories: DirHeat[];
  /** Per-repo file rework (same as global `codebase.rework`). */
  codebaseRework: FileRework[];
  /** Per-repo verification failures by kind (same as global `tools.verification`). */
  verification: VerificationRollup[];

  // ── Per-repo AGENT series (the Agents surface, scoped) ─────────────────────
  // The same shapes as the global `tools.agentOutcomes` / `tools.agentModels` /
  // `tools.agentDaily` / `activity.agentHourly`, grouped by THIS repo. They carry
  // COUNTS (every rate's numerator + denominator), so the Agents page's repo
  // multi-select can re-aggregate any subset of repos client-side — Σnumerator /
  // Σdenominator per agent — without a re-fetch or a per-selection server build.
  // The current worker initializes these collections and counts before optional
  // event-log enrichment. Empty arrays and zero unusable rows are therefore real
  // current-contract values, not compatibility defaults.
  /** Per-repo, per-agent git line-survival head-to-head (same as global
   *  `tools.agentOutcomes`). */
  agentOutcomes: AgentOutcomeRollup[];
  /** Rated sessions in this repo Seorak could not attribute to any agent — the
   *  "in neither column" count the coverage note pairs with the table. */
  agentOutcomesUnusable: number;
  /** Per-repo, per-(agent, model) spend split (same as global `tools.agentModels`). */
  agentModels: AgentModelRollup[];
  /** Per-repo, per-(agent, day) activity (same as global `tools.agentDaily`). */
  agentDaily: AgentDailyPoint[];
  /**
   * THIS REPO'S OWN DAILY SERIES — the same shape and the same honesty contract as the
   * global `usage.dailyTrends`, grouped by this repo.
   *
   * It exists because a per-repo *window total* cannot be drawn as anything: surfaces
   * that want to show how a repo's spend or volume moved through the window previously
   * had only the GLOBAL trend, which is every repo added together and therefore says
   * nothing about the one on screen. Derived from the buckets the per-repo loop already
   * holds, so it costs no extra D1 read.
   *
   * Honest-empty, exactly like the global: a day with no activity is ABSENT rather than
   * zero-filled, and `costUsd` is null (never 0) on a day whose models were all unpriced.
   * `[]` on the KV-only path, which has no per-day derivation.
   */
  dailyTrends: DailyPoint[];
  /** Per-repo, per-(agent, hour) call cadence (same as global `activity.agentHourly`). */
  agentHourly: AgentHourPoint[];

  // ── Subset-merge substrate ─────────────────────────────────────────────────
  // The numerator/denominator COUNTS behind each per-repo RATE above, so a saved
  // scope over K repos recomputes the rate as Σnumerator / Σdenominator instead of
  // averaging per-repo rates (wrong for unequal sample sizes). Optional legs are
  // absent when their measurement/binding does not exist for the repo. Each pairs
  // with its rate's honesty rule; K=1 reads the rate directly.

  /** shipRate numerator: sessions in this repo that landed a commit. */
  shipped?: number;
  /** shipRate denominator: sessions whose shipping was determinable. shipRate null ⟺ 0. */
  shipDeterminable?: number;
  /** oneShotRate numerator: ended sessions that ran without a retry loop. */
  oneShots?: number;
  /** oneShotRate denominator: ended sessions with tool calls. oneShotRate null ⟺ 0. */
  oneShotDeterminable?: number;
  /** errorRate numerator: tool calls in this repo that returned an error flag. */
  toolErrors?: number;
  /** errorRate denominator: tool calls that returned a boolean flag. errorRate null ⟺ 0. */
  toolCallsReturned?: number;
  /** cacheReuseRatio numerator: cache-read tokens over this repo's sessions. */
  cacheReadTokens: number;
  /** cacheReuseRatio denominator leg: input tokens. cacheReuseRatio null ⟺ read+input 0. */
  cacheInputTokens: number;
  /** Edit-family tool calls (rows carrying a line delta or file signal) in this repo's
   *  window — the denominator behind cost-per-edit. Lets the Project view fill
   *  costPerEdit (window cost ÷ editCalls) and a subset merge divide Σcost by Σedits
   *  instead of averaging ratios. 0 until an edit call accrues. */
  editCalls?: number;
  /** Uncapped attributed directory-edit total (rows carrying a dirId) BEFORE the
   *  dirHeat top-N cap — the true denominator so a merged directory `share` divides by
   *  the real total, not the sum of capped rows. 0 until a dir-signalled edit accrues. */
  dirEditsTotal?: number;
  /** Commits landed during this repo's tracked sessions (session.delta commitsLanded
   *  summed — the same rows shipRate judges). null (never 0) when no in-window delta
   *  measured it, mirroring the global CommitStats.commitsFromSessions honest-empty. */
  commitsFromSessions?: number | null;
  /** Edit-tool line volume over this repo's window (added / removed) plus the prior
   *  window's added leg for the delta pill — the same definition as the global
   *  `usage.lines` grouped by repo. null until a measured edit lands. */
  lines?: { added: number; removed: number; priorAdded: number | null } | null;
  /** Latest-wins repo character (shape, toolchain) — independent of range pills. */
  character?: RepoCharacter;
  /** Window-scoped work-shape mix (languages, branch intent, peak hour). */
  workMix?: RepoWorkMix;
  /** Intervention fires in this repo over the window (attention pillar); 0 is real. */
  interventionFires?: number;
}

/**
 * CodebaseSnapshot — the file/directory axis, powered by the salted fileId
 * signal (CAPTURE-PRINCIPLE: repoId one level down — ids + counts ship, paths
 * never do). Labels are basenames and present only when the developer opted
 * into the default-OFF `fileLabels` capture toggle; widgets render the short
 * id when label is null. Every member is honest-empty ([]/null, never
 * zero-filled) until in-window rows carry the signal.
 */
export interface CodebaseSnapshot {
  /** Hot files: edit-family tool.calls grouped by fileId, hottest first. */
  files: FileHeat[];
  /** Edit concentration by directory (dirId), hottest first. */
  directories: DirHeat[];
  /** Recurrence: files edited in 2+ DISTINCT sessions in the window — the
   *  "same files churn across sessions" signal, most-recurrent first. */
  rework: FileRework[];
  /** Git ground-truth commit totals. null until git.momentum rows exist. */
  commitStats: CommitStats | null;
  /** Files being edited by CURRENT (non-ended) sessions. null until a live
   *  session's rows carry fileIds. */
  filesInPlay: FilesInPlay | null;
}

/** Per-repo edit/session split on a global (cross-repo) heat row. */
export interface CodebaseProjectSplit {
  repoId: string;
  project: string;
  edits: number;
  sessions: number;
}

export interface FileHeat {
  fileId: string;
  /** basename, only when the fileLabels opt-in shipped one. */
  label: string | null;
  edits: number;
  /** Summed ONLY over rows that carried the line derivation (0 = measured-zero
   *  is impossible for an edit, so 0 here means no measured rows). */
  linesAdded: number;
  linesRemoved: number;
  /** Distinct sessions that edited this file in-window. */
  sessions: number;
  /** On global (all-repos) rows: which repos contributed. Omitted on per-repo slices. */
  projects?: CodebaseProjectSplit[];
}

export interface DirHeat {
  dirId: string;
  label: string | null;
  edits: number;
  /** 0..1 share of the window's attributed edit calls. */
  share: number;
  /** On global (all-repos) rows: which repos contributed. Omitted on per-repo slices. */
  projects?: CodebaseProjectSplit[];
}

export interface FileRework {
  fileId: string;
  label: string | null;
  /** Distinct sessions (>= 2 by construction). */
  sessions: number;
  edits: number;
  /** On global (all-repos) rows: which repos contributed. Omitted on per-repo slices. */
  projects?: CodebaseProjectSplit[];
}

export interface CommitStats {
  /** Trailing window the per-repo momentum sweeps cover (days) — commit stats
   *  sum the LATEST momentum snapshot per repo, so this is their window, NOT
   *  the overview rangeDays. */
  windowDays: number;
  commits: number;
  filesTouched: number;
  linesAdded: number;
  linesDeleted: number;
  generatedLinesExcluded: number;
  /** Commits landed during tracked sessions (session.delta.commitsLanded summed
   *  over the overview window). null when no delta row measured it. */
  commitsFromSessions: number | null;
}

export interface FilesInPlay {
  distinctFiles: number;
  /** Hottest-first, capped server-side; `distinctFiles` is the uncapped count. */
  files: {
    fileId: string;
    label: string | null;
    /** Coarse file kind from the collector's on-machine derivation (closed
     *  enum, ships regardless of the fileLabels opt-in). null until in-window
     *  rows carry it (older collectors) — never a guessed bucket. */
    category: FileCategory | null;
    edits: number;
    lastEditedAt: IsoTimestamp;
    projects: { repoId: string; project: string; edits: number; sessions: number }[];
  }[];
}

export interface OutcomesSnapshot {
  /** Session-end reasons, not a completion rate, because Seorak cannot measure
   *  completion. Labeled "how sessions ended" and distributes ONLY over ENDED
   *  sessions' real reasons; in-flight sessions are NOT a bucket here (they live
   *  in `activeCount`). The session.end reducer now persists `reason` on session
   *  state (sessions.ts) and buildOverview buckets it (overview.ts) — so this is
   *  filled once ended sessions accrue. An ended session whose `reason` was never
   *  recorded (legacy rows, or a cron-reaped session with no session.end event) is
   *  OMITTED rather than bucketed, so the distribution is never fabricated;
   *  `endReasons = []` only until ended-with-reason sessions exist. The
   *  denominator is `endedCount`. */
  endReasons: EndReasonCount[];
  /** Sessions currently active vs ended in window. Summed from the sessions
   *  currently held in KV. */
  activeCount: number;
  endedCount: number;
  /** Becomes populated when the worker computes stuck (cron). Until then
   *  rate=null and stuckCount=0 — widget renders an honest empty state. */
  stuckness: {
    /** 0..1 fraction (stuck ÷ in-flight). UI multiplies by 100 to display. */
    rate: number | null;
    stuckCount: number;
    /**
     * The DENOMINATOR — sessions in this window that have not ended.
     *
     * `rate` shipped without it, so every surface showing stuckness showed a
     * percentage nobody could check: one stuck session out of two in-flight and
     * fifty out of a hundred are the same 50%, and they are not the same fact.
     * The developer-model card was the sharpest case — it states a count with no
     * denominator at all — and the only way to recover one from the wire was
     * `stuckCount / rate`, which prints a number nobody counted and is off by one
     * at any rounding boundary (see `portrait/evidence.ts`).
     *
     * Free: `reduceKvStates` already counts in-flight sessions to divide by, and
     * this ships the number it divided by rather than a second measurement.
     */
    inFlight: number;
    /** session ids the cron flagged stuck (for the intervention panel). */
    stuckSessionIds: string[];
  };
  /** "How sessions ended, day by day" (FOLLOW-UP #5 → the `outcome-trend` tile).
   *  Per-day session-end reason counts over the window, derived from the retained
   *  event log's `session.end` rows bucketed by each event's own `at` DATE. Now
   *  feedable because the worker retains the event log — only days that had at
   *  least one ended session appear (honest-empty: NO zero-filled day spine), and
   *  within a day only reasons with count > 0 are listed. `[]` without the log /
   *  until sessions end. LIFECYCLE, not completion. @grounding cadence */
  endReasonsByDay: DailyEndReasons[];
  /** one-shot rate — 0..1 fraction (UI multiplies by 100); derived from the
   *  retained, ordered (at, seq) tool-call event log. A CADENCE proxy: it measures
   *  the share of ended sessions that ran WITHOUT a tool-revisit retry SHAPE
   *  (isOneShot, eventlog.ts), NOT first-time-correctness — Seorak has no quality
   *  classifier, so the surfaced label must say "ran without a retry loop", never
   *  imply a success rate. null only until a qualifying ended session accrues
   *  (never 0 as a stand-in). */
  oneShotRate: number | null;
  /** Share of ENDED sessions that SHIPPED — a commit landed during the session
   *  (`session.delta.commitsLanded > 0`) — over sessions whose delta could
   *  determine it. The first git ground-truth "did the work land?" 0..1 (UI ×100);
   *  null until session.delta events with a known start HEAD land (never 0 as a
   *  stand-in). @grounding outcome */
  shipRate: number | null;
  /** On-branch LINE-survival — "did the work LAST?", one layer deeper than
   *  shipRate's "did it land?". The daemon re-checks each matured session's
   *  locally-remembered commits by BLAME against a live ref that contains them, and
   *  emits `session.linesurvival` COUNTS only; the worker sums them here. Blame-based,
   *  so a `git revert` reads `overwritten`, not survived. The deepest honest outcome
   *  signal. Honest-empty until line-survival checks accrue; work going away is
   *  "changed back", NEVER graded as bad. @grounding outcome */
  lineSurvival: LineSurvivalRollup;
  /** Per-session outcome rows (ADR-OA7) — the "outcome pending → fate" card source.
   *  The window's RECENT ended sessions joined to their on-branch line-survival
   *  fate: `status` is `'pending'` until the 3d check matures, then the structural
   *  fate. Most-recent-ended first, capped server-side (the cockpit card shows the
   *  recent set, not every session ever). Honest-empty `[]` until sessions end;
   *  NEVER a fabricated verdict (an outcome is unknowable at session end — OA7).
   *  @grounding outcome */
  bySession: SessionOutcomeRow[];
}

/**
 * SessionOutcomeRow — a per-session read-path outcome row (ADR-OA7), the atom behind
 * the cockpit "outcome pending → fate" card. Keyed on `sessionId` over the D1
 * `session.linesurvival` rows; it is NEVER a verdict stamped onto SessionState /
 * SessionSummary, because an outcome is unknowable at `session.end` and any default
 * would be a fabrication — the fate arrives asynchronously as the 3d rung lands.
 *
 * NOTE: this is the lightweight cockpit-card row, distinct from the richer
 * per-session `SessionOutcome` that ADR-OA9 reserves for the mobile-Detail read
 * (`GET /sessions/:id/outcome` → commits/uncommitted/errors + the line-survival
 * sub-object). Named `SessionOutcomeRow` so that future contract can own
 * `SessionOutcome` without a rename.
 *
 * Content-free by construction: the salted `repoId` keys it, `project` is the SAME
 * basename the live board already exposes per session, and `status` is a CLOSED
 * enum — no sha, path, diff, line, or branch crosses. Per-session line counts are
 * deliberately NOT carried (the floored aggregate in `LineSurvivalRollup` owns the
 * rate; exposing exact per-session counts on the world-open read adds a
 * re-identification handle for no card-level need). Passive only (ADR-OA8): a fate
 * is never a push. Anti-grade: `overwritten` is "changed back on this branch",
 * never "bad work" — persistence, not quality.
 */
export interface SessionOutcomeRow {
  /** The ended session this outcome is for. */
  sessionId: SessionId;
  /** basename(toplevel) display label — the SAME field the live board exposes per
   *  session; the salted `repoId` is the durable key, never the path. */
  project: string;
  repoId: string;
  /** When the session ended (the `session.end` time). Anchors the client-side
   *  "matures in N days" / "ended N ago" copy against the fixed 3d rung. */
  endedAt: IsoTimestamp;
  /** `'pending'` until a line-survival rung has landed for the session, then the
   *  on-branch fate. `unreachable`/`unknown` are the rewrite-family fates the
   *  aggregate rate excludes (honest-empty), surfaced here so a row is never
   *  mis-graded as "changed back". */
  status: "pending" | LineSurvivalFate;
}

/**
 * LineSurvivalRollup — on-branch LINE-survival aggregate. The rate is
 * LINE-level (surviving ÷ authored) over the RATED fates ONLY (`retained` +
 * `overwritten`); the rewrite family (`unreachable`/`unknown`) is carried as
 * separate honest-empty counts, NEVER folded into the rate. `rate: null` (never 0)
 * until the rated sessions' summed `commitsChecked` clears the floor (>= 3) — so n=1
 * never renders a swingy 0%/100% headline and a single-commit check is not
 * re-identifiable. Anti-grade: a low rate is "more changed back", never "bad work".
 */
export interface LineSurvivalRollup {
  /** 0..1 share of authored lines still surviving on-branch, over rated sessions
   *  (UI ×100); null below the >=3-commit floor or when no lines were authored. */
  rate: number | null;
  /** Authored lines over rated (retained+overwritten) sessions — the denominator. */
  linesAuthored: number;
  /** Of those, still surviving on-branch — the numerator. */
  linesSurviving: number;
  /** Landed commits across rated sessions (the floor basis). */
  commitsChecked: number;
  /** Distinct rated sessions (for the "across N matured sessions" copy). */
  sessionsRated: number;
  /** Fate split (session counts) — the two RATED outcomes (enter the rate)... */
  retained: number;
  overwritten: number;
  /** ...and the two EXCLUDED outcomes (honest-empty, never in the rate). */
  unreachable: number;
  unknown: number;
}

/**
 * DailyEndReasons — one day's session-end reason distribution (FOLLOW-UP #5,
 * `outcome-trend`). Bucketed by each `session.end`'s own `at` DATE from the event
 * log. Only days with at least one ended session appear (no zero-filled spine);
 * within a day, only reasons with count > 0 are listed. LIFECYCLE, not completion.
 */
export interface DailyEndReasons {
  /** ISO date YYYY-MM-DD. */
  day: string;
  reasons: EndReasonCount[];
}

/**
 * HourlyEndReasons — one clock-hour's session-end reason distribution
 * (FOLLOW-UP #5, `hourly-effectiveness`). Aggregated across all in-window days by
 * each `session.end`'s UTC hour. Only hours with at least one ended session appear.
 * "How sessions ended, by hour" — a CADENCE lens, never an "effectiveness" grade
 * (Seorak has no completion classifier; this is lifecycle reasons by hour).
 */
export interface HourlyEndReasons {
  /** 0-23 (UTC). */
  hour: number;
  reasons: EndReasonCount[];
}

export interface EndReasonCount {
  /** The LIFECYCLE values of SessionEndEvent.reason — how sessions ended (coarse), NOT
   *  completion or quality. "active" is NOT here: it is a live STATUS, never a value
   *  `reason` can take; mixing it into a "how sessions ended" distribution is a category
   *  error and double-counts against `activeCount`. The ring's denominator is `endedCount`
   *  (ended sessions only).
   *
   *  Aliased to `SessionEndReason`, NOT re-listed: this was a second hand-copy of the same
   *  union and a third copy in the web drifted off it. One definition, everything else
   *  derives. @grounding cadence */
  reason: SessionEndReason;
  count: number;
}

/**
 * RepoMomentum — the per-repo git ground-truth rollup the worker derives from
 * the LATEST `git.momentum` event per repo (cumulative snapshots, never summed).
 * COUNTS + ids/enum ONLY; carries no path (repoLabel is a basename) and no code.
 *
 * Anti-vanity headline: files-touched + NET change (`netLines`), with generated/
 * lockfile lines filtered and surfaced separately as `generatedLinesExcluded`.
 * Raw lines-of-code is NEVER a score. @grounding outcome (git ground-truth)
 */
export interface RepoMomentum {
  /** Stable per-repo id (sha256 of salt + origin/toplevel). Never the path. */
  repoId: string;
  /** basename(toplevel) ONLY — last path segment, never an absolute path. */
  repoLabel: string;
  /** The repo's git state at the snapshot (gates honest-empty git reads). */
  gitContext: GitContext;
  /** Trailing window the counts cover (mirrors the source event's windowDays). */
  windowDays: number;
  /** Commits in the window. */
  commits: number;
  /** Distinct NON-ignored paths changed in the window. The lead metric. */
  filesTouched: number;
  /** Lines added over NON-ignored files. */
  linesAdded: number;
  /** Lines deleted over NON-ignored files. */
  linesDeleted: number;
  /** NET change = linesAdded - linesDeleted. The honest headline, not raw LOC. */
  netLines: number;
  /** Added+deleted lines over IGNORED (generated/lockfile) files — surfaced so
   *  the anti-vanity exclusion is auditable, never silent. */
  generatedLinesExcluded: number;
}

/**
 * PortfolioMomentum — the cross-repo breadth + temperature board derived from
 * the `git.momentum` snapshot HISTORY in the event log (not just the latest
 * snapshot like `RepoMomentum`). Answers "across my N repos, how much moved this
 * week and where should attention go?" (CAPTURE-ROADMAP §the anchor).
 *
 * The worker emits COUNTS + the temperature enum ONLY. The breadth HEADLINE
 * string is the web's job, and NO "+X lines" magnitude is ever appended — breadth
 * is files-touched/commits/recency, never raw LOC (anti-vanity). Honest-empty:
 * `repos: []` + zero counts when there is no in-window git.momentum history.
 */
export interface PortfolioMomentum {
  /** Trailing window the breadth counts cover (mirrors the source snapshots'
   *  windowDays; the comparison unit, not the dashboard rangeDays). */
  windowDays: number;
  /** Distinct repos with any in-window git.momentum history. */
  reposTotal: number;
  /** Repos whose latest snapshot shows activity (commits>0 OR filesTouched>0). */
  reposMoved: number;
  /** reposTotal - reposMoved — repos that went quiet. "quiet", never "neglected". */
  reposQuiet: number;
  /** Per-repo temperature board. `[]` when there is no in-window history. */
  repos: RepoTemperature[];
}

/**
 * RepoTemperature — one repo judged against its OWN trailing baseline. The
 * verdict is computed by the worker from files-touched + commits + recency ONLY
 * — `netLines` is carried for display but is NEVER an input to the verdict
 * (anti-vanity). `temperature: null` is the HONEST verdict when the history is
 * too thin to judge a baseline (never a fabricated "steady"). @grounding outcome
 */
export interface RepoTemperature {
  /** Stable salted per-repo id (never the path). */
  repoId: string;
  /** basename(toplevel) ONLY — last path segment, never an absolute path. */
  repoLabel: string;
  /** The repo's git state at its latest snapshot. */
  gitContext: GitContext;
  /** heating/steady/cooling vs the repo's own baseline; "quiet" when the latest
   *  snapshot shows no activity; `null` when history is too thin to judge a
   *  baseline (never a fabricated "steady"). */
  temperature: "heating" | "steady" | "cooling" | "quiet" | null;
  /** Whole days since the repo's last ACTIVE snapshot when quiet (the "quiet N
   *  days" copy); `null` when the repo is active or recency is unknown. */
  quietDays: number | null;
  /** Current-window counts (latest snapshot). The lead metric is filesTouched. */
  commits: number;
  filesTouched: number;
  /** NET change = linesAdded - linesDeleted. Informational/display only — NEVER
   *  the temperature input, never a score. */
  netLines: number;
  /** Added+deleted lines over IGNORED (generated/lockfile) files — auditable. */
  generatedLinesExcluded: number;
  /** The trailing-baseline snapshot the temperature was judged against; `null`
   *  when no comparable prior snapshot exists (history too thin). */
  baseline: { commits: number; filesTouched: number } | null;
}

export interface ActivitySnapshot {
  /** 7×24 session-count grid from each session.start's `at`. Filled from the
   *  retained D1 event log via queryHourlyDistribution; empty only until in-window
   *  session.start rows accrue. */
  hourlyDistribution: HourBucket[];
  /** Per-agent clock-hour activity: tool.call counts bucketed by UTC hour, from
   *  the SAME single tool.call scan the other aggregates ride (zero extra reads).
   *  Hours are UTC like HourBucket — a surface speaking dayparts must shift to
   *  the viewer's clock and say so. Only (agent, hour) pairs with calls appear
   *  (no zero-filled 24-spine); `[]` without the log. Feeds the Agents cadence
   *  fit sentence. A CADENCE lens, never an effectiveness grade. @grounding session */
  agentHourly: AgentHourPoint[];
  /** "How sessions ended, by hour" (FOLLOW-UP #5 → the `hourly-effectiveness`
   *  tile). Session-end reason counts bucketed by UTC clock hour across the
   *  window, from the retained event log's `session.end` rows. Only hours with at
   *  least one ended session appear (honest-empty, no zero-filled 24-spine); `[]`
   *  without the log / until sessions end. A CADENCE lens (when sessions wrap up),
   *  NOT an effectiveness grade — Seorak has no completion classifier. */
  endReasonsByHour: HourlyEndReasons[];
}

export interface HourBucket {
  dow: number;   // 0-6
  hour: number;  // 0-23
  sessions: number;
}

/** One (agent, UTC hour) activity bucket — tool.call count. See
 *  ActivitySnapshot.agentHourly for the honesty contract. */
export interface AgentHourPoint {
  agent: AgentId;
  /** 0-23, UTC clock hour of the call's own `at`. */
  hour: number;
  calls: number;
}

export interface ToolsSnapshot {
  /** Per-tool call split, derived from the retained D1 event log's tool.call
   *  `toolName` counts (perToolCountsFromRows). KV alone could not produce this —
   *  it keeps only a scalar `toolCallCount` plus the LAST `currentTool`, so a split
   *  off current state would have to attribute every call to the last tool
   *  (fabrication). `[]` only until in-window tool.call rows accrue; the `tool-mix`
   *  widget renders empty until then. */
  byTool: ToolCallRollup[];
  /** Aggregate call stats. `totalCalls` is the only one of these summed from the
   *  sessions currently held in KV (sum of `toolCallCount` over resident
   *  sessions). `errorRate` is derived from the retained D1 event log's tool.call
   *  rows (errorRateFromRows over the collector's boolean `errored` flag, which
   *  keys off which hook fired — PostToolUse vs PostToolUseFailure — not output
   *  parsing). null only until a call has returned an honest boolean flag (rows
   *  from pre-`errored` collectors carry no signal); never 0 as a stand-in. */
  callStats: {
    totalCalls: number;
    /** 0..1 fraction (UI multiplies by 100). */
    errorRate: number | null;
  };
  /** Per-model spend, summed over each `tool.call`'s `models[]` items across the
   *  retained log. A single `tool.call` token delta can span multiple assistant
   *  turns using DIFFERENT models, so the collector buckets per `row.message.model`
   *  and the worker sums those buckets here. `ModelRollup.costUsd` is `null` (never
   *  0) for a model whose whole cost is unpriced (not in the price table), so an
   *  unpriced model reads honest-empty rather than a silent $0. Honest-empty `[]`
   *  until tool.call rows carry `models[]`. @grounding cost */
  byModel: ModelRollup[];
  /** Per-agent rollup parallel to `byTool`, keyed on the session's `agent`
   *  (docs/specs/multi-tool.md §capability model). Honest-empty `[]`; a solo all-claude-code
   *  user sees a single row. `AgentRollup.costUsd` is `number | null` PER AGENT
   *  (never 0): an agent whose sessions are all `cost: 'none'` reads honest-
   *  empty, never a blended cross-tool $0. The web MAY hide it when length <= 1
   *  (single-tool user) — a render choice, not a data fabrication. @grounding outcome */
  byAgent: AgentRollup[];
  /** Per-agent daily activity series (sessions started + edit-line delta by
   *  calendar day) from the SAME two scans the global trends ride (zero extra
   *  reads). PAST ACTIVITY ONLY — no forecasts, no effectiveness curves. A day
   *  with no activity for an agent is simply absent (no zero-filled spine);
   *  `lines` is null on a day whose rows carried no line fields (never {0,0}).
   *  `[]` without the log. Feeds the Agents history chart. @grounding session */
  agentDaily: AgentDailyPoint[];
  /** Per-(agent, model) split of the SAME per-model items behind `byModel` —
   *  which models each agent actually ran. Same honesty contract as ModelRollup:
   *  `costUsd` null (never 0) when the model is unpriced; `[]` until rows carry
   *  models[]. Feeds the Agents models sentence + per-agent grouping. @grounding cost */
  agentModels: AgentModelRollup[];
  /**
   * Per-agent OUTCOMES from git: surviving lines, commit landings, cost per surviving line,
   * and the coverage that bounds all three (HEAD-TO-HEAD Tier 2). Derived from the SAME
   * `session.linesurvival` scan the global rollup rides — zero extra reads.
   *
   * This is the only per-agent number on the product that is an outcome rather than an
   * activity count. Everything else in this snapshot says what an agent DID; this says what
   * its work went on to be. `[]` until commit-attributed survival rows land.
   *
   * The agent join goes through the session's `session.start` row, NEVER the survival row's
   * own `agent` column: the daemon writes those rows with no lifecycle event in the batch,
   * so the column is NULL, and NULL reads as claude-code. Joining on it would credit every
   * agent's survival to Claude — plausible, wrong, and invisible. @grounding outcome */
  agentOutcomes: AgentOutcomeRollup[];
  /**
   * Rated survival rows the per-agent split could NOT use, and which are therefore in
   * NOBODY's legs. Two causes: the session's agent could not be determined (dropped, never
   * defaulted), or the row predates git attribution and credits a whole session window
   * rather than the files the agent actually edited.
   *
   * Non-zero means `agentOutcomes` describes a SUBSET, and the surface says so rather than
   * presenting a partial compare as a complete one. It falls to zero on its own as the
   * pre-attribution rows age out of the window. @grounding outcome */
  agentOutcomesUnusable: number;
  /** Verification runs by kind (test/build/typecheck/lint), derived from the
   *  collector's verificationKind/verificationPassed flags in the retained log.
   *
   *  A RATE NEEDS BOTH LEGS. Claude Code's Bash `tool_response` carries no
   *  exit_code, but which-hook-fired IS the result signal: PostToolUse fires only
   *  on exit 0, and a non-zero exit routes to PostToolUseFailure instead
   *  (anthropics/claude-code#6371, closed "not planned"). Until 2026-07-09 the
   *  collector recorded only the FAILURE leg, so `passRate` was pinned at 0/null
   *  (measured: 3,034 passing runs carried no `verificationPassed` at all against
   *  37 recorded failures). `classifyVerificationCall` now records both legs.
   *
   *  TRANSITION: rows already in the retained log carry no result for passing
   *  runs, so `passRate` is a LOWER BOUND until the retention window has rolled
   *  past 2026-07-09. It understates, never overstates.
   *
   *  MULTI-TOOL: a tool that can observe only ONE leg must not populate this at
   *  all. Codex is the mirror hazard: its PostToolUse fires only on success and it
   *  has no failure hook, which would pin the rate at a fabricated 100%. Gate on
   *  the adapter's `toolResult` capability, never on the presence of rows.
   *  Empty `[]` until verification runs land. @grounding outcome */
  verification: VerificationRollup[];
}

export interface VerificationRollup {
  kind: "test" | "build" | "typecheck" | "lint";
  /** 0..1 fraction of runs that PASSED, over runs that returned a result (UI
   *  multiplies by 100); null when no run of this kind reported a result. Both
   *  legs are recorded as of 2026-07-09 (PostToolUse => pass, PostToolUseFailure
   *  => fail), so this is a real rate going forward, and a LOWER BOUND over rows
   *  logged before then. See the ToolsSnapshot.verification comment. */
  passRate: number | null;
  /** Runs of this kind that returned a result (the honest denominator). */
  runs: number;
  /** Runs of this kind that PASSED (the numerator behind passRate). Carried so a
   *  subset merge recomputes passRate = Σpassed / Σruns instead of averaging the
   *  per-repo rate, and so Compare reads the EXACT failed count (runs - passed)
   *  rather than a rounded reconstruction. On Claude-Code-only
   *  this is pinned at 0 (passing Bash runs report no result signal), mirroring the
   *  passRate note above — so `passed <= runs` always. */
  passed: number;
}

export interface ToolCallRollup {
  tool: string;       // tool name (Read/Edit/Bash/...) — NOT host_tool/vendor
  calls: number;
  sessions: number;
}

export interface ModelRollup {
  model: string;
  /** Number of per-model items summed (a tool.call spanning two models counts
   *  toward BOTH, so this is a model-item count, NOT a tool.call count — it does
   *  not sum to byTool totals). */
  calls: number;
  tokensTotal: number;
  /** null (never 0) when this model's whole cost is unpriced — an unpriced model
   *  reads honest-empty, not a silent $0. */
  costUsd: number | null;
}

/**
 * A model we have NO price row for, and the tokens it burned unpriced. The
 * actionable half of `costPartial` (usage.cost.unpricedModels).
 *
 * The fix for one of these is a single line in `MODEL_PRICES` plus a worker deploy.
 * The point of naming it is that nobody can fix a row they do not know is missing.
 */
export interface UnpricedModel {
  /** The model id verbatim, as the tool reported it. This is the string to add a row for. */
  model: string;
  /** Tokens this model burned in the window with no price applied. The size of the hole. */
  tokensTotal: number;
}

/** ModelRollup grouped one level finer: the same per-model items keyed by the
 *  agent whose session produced them. Same costUsd null contract. */
export interface AgentModelRollup {
  agent: AgentId;
  model: string;
  calls: number;
  tokensTotal: number;
  costUsd: number | null;
}

/** One (agent, day) activity point for the Agents history chart. PAST ACTIVITY
 *  ONLY. `lines` is null when no row that day carried the collector's line
 *  fields — unmeasured, never {0,0}. `tokensTotal` is input+output for that
 *  agent that day (Claude from tool.call / rollup_model; Codex from the
 *  session.tokens carrier). Null when unmeasured; 0 only when measured zero. */
export interface AgentDailyPoint {
  agent: AgentId;
  /** ISO date YYYY-MM-DD, bucketed by each event's OWN `at` date (UTC). */
  day: string;
  /** Distinct sessions STARTED that day. */
  sessions: number;
  lines: { added: number; removed: number } | null;
  /** Input+output tokens that day for this agent. Null when unmeasured. */
  tokensTotal: number | null;
}

/**
 * The n-floor for a PER-AGENT survival rate (HEAD-TO-HEAD §9, buyer-decided 2026-07-12).
 * Below it the COUNTS still render and the rate reads honest-empty.
 *
 * The arithmetic that set it: attributed work averages ~97 lines per file, so one file's
 * fate is the natural unit of noise. At a 100-line denominator one file moves the rate by
 * ±97 points, at 250 by ±39, at 500 by ±19, at 1,000 by ±10. 500 is where the rate stops
 * being a coin flip while still filling in within days of real use.
 *
 * Exported from `types` so the worker's gate and the web's "why is this empty" copy read the
 * SAME number. A surface that explains an empty cell with a floor the worker does not
 * actually apply is lying with the truth.
 */
export const AGENT_SURVIVAL_FLOOR = { lines: 500, commits: 3 } as const;

/**
 * The coverage split over every added line in the commits ONE agent landed work in. The
 * five buckets partition `linesInCommits` exactly, so no line is invented and none is lost.
 *
 * This is the ADR-H9 gate, and it is the reason it ships rather than being computed and
 * thrown away: **a rate needs both legs, and a COMPARE needs comparable coverage.** Agents
 * differ in how much of their editing we can even see (a tool that edits through a shell
 * carries no file identity, so its work lands in `linesUnattributed` rather than under its
 * name). If one agent's unattributed share is far above another's, the gap between their
 * headline numbers is a CAPTURE ARTIFACT, and rendering it as performance would be a lie.
 * The surface shows this beside the rate so the reader can see what the rate is *about*.
 */
export interface AgentCoverage {
  /** Every added line in those commits. The denominator the other four divide. */
  linesInCommits: number;
  /** Traced to THIS agent. */
  linesAuthored: number;
  /** Traced to a DIFFERENT agent, in a commit both contributed files to. */
  linesOtherAgents: number;
  /** In files two or more agents edited in the same window: owned by nobody, by design. */
  linesContested: number;
  /** Traced to NO agent: your own hand edits, script-written files, or a capture gap. */
  linesUnattributed: number;
}

/**
 * AgentOutcomeRollup — what an agent's landed work actually DID, from git (HEAD-TO-HEAD
 * Tier 2). The first per-agent number on this product that is an OUTCOME rather than an
 * activity count, and the only place a real superiority claim could ever be earned.
 *
 * Every rate here carries BOTH LEGS as counts, and every rate is `null` rather than 0 when a
 * leg is missing. Anti-grade throughout: a low survival rate means more of the work was
 * changed back, NOT that the agent is worse. Work that is genuinely un-traceable (a squash,
 * a rebase, a reset) is EXCLUDED and counted, never graded as death.
 * @grounding outcome
 */
export interface AgentOutcomeRollup {
  agent: AgentId;
  /** Committed lines attributed to this agent across its RATED sessions. The denominator,
   *  and it renders as a count BESIDE the rate, never behind it. */
  linesAuthored: number;
  /** Of those, still alive at the blame ref. The numerator. */
  linesSurviving: number;
  /** linesSurviving / linesAuthored. `null` below AGENT_SURVIVAL_FLOOR or with no rated
   *  lines — the counts still render. */
  survivalRate: number | null;
  /** Distinct commits this agent's rated work landed in (deduped across its sessions). */
  commits: number;
  /** Sessions with a rated survival leg (`retained` or `overwritten`). */
  sessionsRated: number;
  /** Spend across those rated sessions — the OTHER leg of costPerSurvivingLine, carried so
   *  the surface can show the division rather than assert the quotient. `null` (never 0)
   *  when the agent cannot price its work at all (`capabilities.cost === 'none'`, which is
   *  Codex today) or when no rated session reported a price. */
  ratedCostUsd: number | null;
  /** ratedCostUsd / linesSurviving. `null` whenever either leg is missing. NEVER $0: a
   *  `$0.00 per surviving line` for an agent that cannot report cost would read as "free",
   *  which is the most damaging lie available on this surface (ADR-H8). */
  costPerSurvivingLine: number | null;
  /** Sessions whose commits sit on no live ref (squash / rebase / reset). Their lines may
   *  well live on under a new sha, but we cannot trace them, so they are EXCLUDED from the
   *  rate: never credited, never graded as death. */
  unreachableSessions: number;
  /** Sessions with nothing rateable (no authored lines, or over the blame cap). Excluded. */
  unknownSessions: number;
  /** Attributed files absent at the blame ref. Their lines count 0 surviving, which is right
   *  for a deletion and an UNDER-count for a move, so this number bounds a KNOWN
   *  conservative bias. It is surfaced rather than corrected because it only ever
   *  understates survival, and the honest thing is to show which direction we are wrong in. */
  filesGoneFromTip: number;
  coverage: AgentCoverage;
}

/**
 * AgentRollup — per-agent rollup parallel to `ProjectRollup`, keyed on the
 * session's `agent`. Honest-empty `[]`; for v1 (claude-code only) it has one
 * row. `costUsd` is `number | null` PER AGENT (never 0): an agent whose sessions
 * are all `cost: 'none'` reads honest-empty rather than a blended cross-tool
 * $0 (the silent-zero ban). @grounding outcome
 */
export interface AgentRollup {
  agent: AgentId;
  sessions: number;
  activeSessions: number;
  toolCalls: number;
  tokensTotal: number;
  /** null when no session for this agent reported cost — never 0 as a stand-in. */
  costUsd: number | null;
  /**
   * Edit-tool line volume for this agent (on-machine derivation from `tool.call`
   * linesAdded/linesRemoved). The fairest cross-tool compare surface
   * (docs/specs/multi-tool.md Appendix A). null — never {0,0} — until in-window
   * rows for this agent carry the fields. Distinct from git repo-activity lines.
   */
  lines: { added: number; removed: number } | null;
  lastEventAt: IsoTimestamp;
  /**
   * The EARLIEST event the log holds for this agent, across the WHOLE log and NOT the
   * window. Deliberately asymmetric with `lastEventAt` (which is in-window), because the
   * two answer different questions: `lastEventAt` is "when was this agent last busy",
   * this is "how much of this agent do we actually have".
   *
   * It is the fact a cross-agent comparison cannot be honest without. Claude Code has
   * been in this log since 2026-06-05 and Codex only since 2026-07-12, so a 30-day view
   * puts a full Claude record beside a one-day Codex one. Without this, the surface
   * cannot tell the reader that, and "I barely use Codex" is the natural misreading of
   * what is really "Seorak barely watched Codex". Same both-legs rule as everywhere else,
   * applied to TIME: a comparison needs both agents observed over the same span, or it
   * needs to say out loud that they were not.
   *
   * NAMED FOR WHAT IT LITERALLY IS. Not `capturedSince` or `observedSince`: an agent
   * whose record starts inside the window might mean we only started WATCHING then, or
   * that you only started USING it then, and the event log genuinely cannot tell those
   * apart. So the field claims only the thing that is true either way — this is the first
   * time we saw it — and the copy above it says only that.
   *
   * Optional: absent on rollups built by a pre-field worker, which is honest (unknown),
   * never a fabricated "since the beginning of time".
   */
  firstSeenAt?: IsoTimestamp;
  /**
   * The agent's reporting contract, resolved from its LATEST in-window session's
   * declared capabilities (registry resolution for retained historical rows). Feeds the
   * Agents coverage ledger — the panel that explains every empty compare cell.
   * Current response projections always emit the complete resolved contract.
   */
  capabilities: ResolvedSessionCapabilities;
  /**
   * True when at least one in-window tool.call row for this agent carried a
   * boolean `errored` flag — i.e. error RESULTS were actually captured this
   * window, not merely observable in principle (`toolResult` is the contract;
   * this is the data). Lets the ledger say "not captured yet" honestly.
   */
  erroredPresent: boolean;
  /**
   * This agent's OWN tool-call error rate, with the coverage it was measured over
   * for that tool. Absent on rollups built by a pre-partition worker.
   *
   * The global `tools.callStats.errorRate` blends every agent, which was harmless
   * while one tool could report results and stopped being harmless the moment a
   * second could: Codex observes an error only on SHELL calls, Claude observes one
   * on every tool it runs. A blended rate over two different populations moves for
   * reasons that have nothing to do with anything getting worse. This is the
   * unblended number, and `returned / calls` is what stops it being read as more
   * complete than it is.
   */
  errorRate?: AgentErrorRate;
}

/**
 * A per-agent error rate AND the share of the agent's work it could actually see.
 *
 * A rate needs both legs shown as counts (multi-tool.md Appendix A), and a rate over
 * a SUBSET needs its subset disclosed too — otherwise "3.6% of calls errored" reads
 * as a statement about all of Codex's work when it is a statement about the 44% of it
 * that reports a result at all. `errored`/`returned` are the rate's two legs; `calls`
 * is the coverage denominator, so a surface can say "measured on 224 of 509 calls"
 * without recomputing anything.
 *
 * The counts also let a scoped subset merge honestly: Σerrored / Σreturned, never an
 * average of per-agent rates.
 */
export interface AgentErrorRate {
  /** `errored / returned`. null when `returned` is 0 — never 0 as a stand-in. */
  rate: number | null;
  /** Numerator: calls that reported a FAILED result. */
  errored: number;
  /** Denominator: calls that reported a result at all, either leg. */
  returned: number;
  /** Every ratable call this agent made in the window. `returned / calls` is the
   *  COVERAGE — the share of the agent's calls the rate could observe. Equal to
   *  `returned` for a tool that reports on everything it runs (claude-code). */
  calls: number;
}

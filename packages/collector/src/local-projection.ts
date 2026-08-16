/**
 * local-projection.ts — the collector's OWN read models over `history.sqlite`.
 *
 * ADR 001 assigns local projections to the collector, so this is a deliberate
 * second implementation of the same public contracts the worker serves, NOT an
 * accidental fork: `packages/collector` may depend on `@seorak/types` and node
 * builtins only, and the worker's projection is closed source. The duplication
 * is therefore structural, and `test/local-projection-parity.test.ts` is what
 * keeps the two answers agreeing on the fields this module populates.
 *
 * HONESTY CONTRACT. Every value below traces to a row in local history. Where a
 * derivation belongs to the worker (retry-shape classification, git line
 * attribution, the intervention cron), this module emits the contract's
 * documented honest-empty representation — `null` for a rate, `[]` for a
 * collection — and NEVER a zero-filled count. The surfaces that cannot be
 * derived at all are absent from the local plane's `DataPlaneStatus.surfaces`
 * (see local-plane.ts), so the UI presents them as unavailable rather than as
 * measured emptiness.
 *
 * WHAT IS POPULATED (measured):
 *   live, usage.totals, usage.cost, usage.lines, usage.dailyTrends,
 *   usage.projects, usage.momentum, usage.portfolio counts, cacheReuseRatio,
 *   costPerEdit, the whole codebase family, outcomes.endReasons /
 *   activeCount / endedCount / stuckness / endReasonsByDay / shipRate /
 *   lineSurvival / bySession, the whole activity family, tools.byTool /
 *   callStats / byModel / byAgent / agentDaily / agentModels / verification.
 *
 * The per-session `SessionOutcome` is derived here too, from the same rows: its
 * commit and churn legs from `session.delta`, its survival leg from the daemon's
 * `session.linesurvival` sweep, its error legs from the session's `tool.call`
 * stream, and its `endReason` from `session.end`. Each keeps the contract's own
 * null gate, so an immature session reads "outcome pending" rather than zeroed.
 *
 * WHAT IS DELIBERATELY HONEST-EMPTY (worker-owned derivations):
 *   notificationAvailability (omitted — absent means unknown),
 *   usageAllowances `[]`, outcomes.oneShotRate `null`, tools.agentOutcomes `[]`
 *   (with `agentOutcomesUnusable` counting the rated survival rows the absent
 *   split could not use), RepoTemperature.baseline `null` and its
 *   `temperature` `null` unless the latest snapshot is honestly `quiet`.
 *
 * TOKEN AND COST GRAIN. `SessionCapabilities.costScope` decides where a
 * session's money lives: `call` (Claude) sums `tool.call` rows, `session`
 * (Codex) reads the cumulative `session.tokens` carrier, whose per-model
 * snapshot is reconciled against what has already been counted so a snapshot is
 * never double counted and a window-straddling session is seeded from its last
 * snapshot before the window. `tokensTotal` is input + output everywhere, the
 * same billable-throughput definition `SessionSummary.tokens.total` uses.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  ABANDONED_THRESHOLD_MS,
  DEFAULT_THRESHOLDS,
  IDLE_THRESHOLD_MS,
  OVERVIEW_RANGE_DAYS,
  SESSION_PAGE_DEFAULT_LIMIT,
  SESSION_PAGE_MAX_LIMIT,
  STUCK_THRESHOLD_MS,
  WIDEST_OVERVIEW_RANGE_DAYS,
  canMeasureCacheReuse,
  canRateToolOutcomes,
  isOverviewRangeDays,
  priceModelUsage,
  pricesPerCall,
  resolveCapabilities,
  sessionToSummary,
  type AgentDailyPoint,
  type AgentHourPoint,
  type AgentId,
  type AgentModelRollup,
  type AgentRollup,
  type DailyPoint,
  type DeveloperModelSnapshot,
  type DirHeat,
  type EndReasonCount,
  type FileHeat,
  type FileRework,
  type HourBucket,
  type HourlyEndReasons,
  type Keyframe,
  type LineSurvivalFate,
  type LineSurvivalRollup,
  type LineSurvivalStartHourBucket,
  type ModelRollup,
  type OverviewSnapshot,
  type PeriodDelta,
  type ProjectFocusEntry,
  type ProjectRollup,
  type ReplayActivityBucket,
  type ReplayMoment,
  type ReplaySession,
  type RepoMomentum,
  type RepoTemperature,
  type ResolvedSessionCapabilities,
  type SessionCapabilities,
  type SessionEndReason,
  type SessionEvent,
  type SessionOutcome,
  type SessionOutcomeRow,
  type SessionPage,
  type SessionState,
  type SessionStatus,
  type SessionSummary,
  type ShipStartHourBucket,
  type ToolCallEvent,
  type ToolCallRollup,
  type UnpricedModel,
  type VerificationRollup,
} from "@seorak/types";
import { parseSessionEvent } from "@seorak/types/event-validation";
import {
  DISPLAYABLE_SESSION_SQL,
  listLocalSessionPage,
  mapLocalSessionRow,
  openLocalHistory,
  type LocalSessionRow,
} from "./local-store.ts";

/**
 * THE MANIFEST. Every top-level `OverviewSnapshot` field, classified.
 *
 * This exists because the prose above is a promise, and a promise in a comment
 * rots silently. `test/local-projection-parity.test.ts` reads THIS, not the
 * comment: it walks the keys of a real built snapshot and fails when a field is
 * in neither list, so a field added to the shared contract cannot arrive
 * unclassified. The plane's declared surfaces derive from it too, so the
 * descriptor, the code, and the documentation cannot drift apart.
 *
 * `measured` means local capture backs it. `honest-empty` means the derivation
 * belongs to the worker and this plane emits the contract's documented empty
 * value rather than a zero-filled count.
 */
export const LOCAL_OVERVIEW_MANIFEST = {
  measured: [
    "generatedAt",
    "rangeDays",
    "maxRangeDays",
    "live",
    "usage",
    "codebase",
    "outcomes",
    "activity",
    "tools",
    "thresholds",
  ],
  honestEmpty: [
    // Usage headroom rides `agent.quota`; no reading is derived locally yet.
    "usageAllowances",
    // OPTIONAL and absent: absent means unknown on this contract, and this
    // plane evaluates no watch applicability. Present in neither the built
    // snapshot nor the measured list, which is why the parity test checks the
    // type's own key set rather than only the object's.
    "notificationAvailability",
  ],
} as const;

/**
 * Nested fields the manifest classifies below the top level, because their
 * PARENT is measured but they individually are not. The parity test asserts
 * each one still holds its documented empty value, so "we left this out" stays
 * a decision under test rather than a regression nobody notices.
 */
export const LOCAL_OVERVIEW_HONEST_EMPTY_FIELDS = [
  // The retry-shape classifier is a worker derivation. 0 would read as
  // "nothing ran clean", which this plane cannot claim.
  "outcomes.oneShotRate",
  // Per-agent git line attribution is a worker derivation; the rows the split
  // could not use are DISCLOSED by `tools.agentOutcomesUnusable` rather than
  // dropped.
  "tools.agentOutcomes",
  // A repo temperature needs the repo's own trailing baseline. `quiet` is the
  // one verdict a single snapshot answers on its own.
  "usage.portfolio.repos[].baseline",
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Composite map keys join on NUL, which no agent, model, day, or id contains. */
const KEY_SEP = "\u0000";
/**
 * Top-N caps mirroring the worker's bounded aggregate rows.
 *
 * They said that and did not do it: all five were 40, against the worker's
 * 20/12/20/50/24, so the same events produced a different NUMBER OF ROWS on the
 * two planes. `FilesInPlay.files` names the cap in the contract itself ("Hottest-
 * first, capped server-side; `distinctFiles` is the uncapped count"), and the
 * caps are what a surface actually renders: `FilesPanel.tsx` draws the whole
 * array it is handed as a treemap on the stated grounds that then "every touched
 * file is on the map (no cap, no residue)", and `LiveWidgets.tsx` puts the rows
 * past its own top-4 into a tail whose LABEL count is real. So a truncation the
 * two planes disagree about is a different picture, not a different budget.
 *
 * The worker's numbers are the shipped contract and are therefore the ones that
 * are right here; whether 12 directories is the correct cap for either plane is
 * a product decision with its own justification to write. Each is pinned against
 * its worker counterpart in `local-projection-parity.test.ts`, because this
 * gate is private and does not travel with the package.
 */
/** `FILE_HEAT_LIMIT`, worker/src/eventlog/codebase.ts. */
const FILE_HEAT_LIMIT = 20;
/** `DIR_HEAT_LIMIT`, worker/src/eventlog/codebase.ts. */
const DIR_HEAT_LIMIT = 12;
/** `FILE_REWORK_LIMIT`, worker/src/eventlog/codebase.ts. */
const REWORK_LIMIT = 20;
/** `FILES_IN_PLAY_LIMIT`, worker/src/eventlog/codebase.ts — deliberately the
 *  LOOSEST of the five, because this list is a drill meant to be complete. */
const FILES_IN_PLAY_LIMIT = 50;
/** `SESSION_OUTCOME_CAP`, worker/src/overview.ts. */
const OUTCOME_ROW_LIMIT = 24;

export interface LocalReadOptions {
  directory?: string;
  nowMs?: number;
}

/* -------------------------------------------------------------------------- */
/* Event streaming                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Stream matching events rather than materializing them.
 *
 * A 90-day window over a permanent local history is the case that matters:
 * `.all()` would hold every payload in memory at once, and this database only
 * grows. `StatementSync.iterate` has been available since Node 22.13, below
 * this package's declared 22.18 engine floor, but the pinned `@types/node`
 * predates it — hence the narrow cast rather than a runtime fallback for a
 * platform the package does not support.
 */
function* streamEvents(
  database: DatabaseSync,
  sql: string,
  ...params: Array<string | number>
): Generator<SessionEvent> {
  const statement = database.prepare(sql) as unknown as {
    iterate(...values: Array<string | number>): Iterable<unknown>;
  };
  for (const row of statement.iterate(...params)) {
    const payload = (row as { payload_json?: unknown }).payload_json;
    let event: SessionEvent | null = null;
    try {
      event = parseSessionEvent(JSON.parse(String(payload)));
    } catch {
      event = null;
    }
    if (event !== null) yield event;
  }
}

const WINDOW_SQL = `
  SELECT payload_json FROM local_event
   WHERE at >= ? AND at < ?
   ORDER BY at, local_seq
`;

/* -------------------------------------------------------------------------- */
/* Session metadata                                                            */
/* -------------------------------------------------------------------------- */

interface SessionMeta {
  agent: AgentId;
  repoId: string;
  project: string;
  /** The registry-resolved contract the aggregates gate on. */
  capabilities: ResolvedSessionCapabilities;
  /** What the adapter actually DECLARED, or undefined when it declared nothing.
   *  `sessionToSummary` distinguishes the two: absent is unknown, and resolving
   *  it to the registry default before handing it over would turn "we do not
   *  know" into a claim. */
  declaredCapabilities: SessionCapabilities | undefined;
  startedAt: string | null;
  endedAt: string | null;
}

/** Memoized `sessionId -> meta`. The agent and repo come from the projected
 *  session row; the declared capability set only exists on the `session.start`
 *  payload, so it is read from the raw log and resolved through the shared
 *  registry exactly as the worker resolves a stored row. */
function sessionMetaReader(
  database: DatabaseSync,
): (sessionId: string) => SessionMeta {
  const cache = new Map<string, SessionMeta>();
  const sessionRow = database.prepare(
    "SELECT agent, repo_id, repo_label, started_at, ended_at FROM local_session WHERE session_id = ?",
  );
  const startRow = database.prepare(
    "SELECT payload_json FROM local_event WHERE session_id = ? AND kind = 'session.start' ORDER BY local_seq LIMIT 1",
  );
  return (sessionId: string): SessionMeta => {
    const hit = cache.get(sessionId);
    if (hit) return hit;
    const row = sessionRow.get(sessionId) as Record<string, unknown> | undefined;
    let declared: SessionEvent | null = null;
    const startPayload = startRow.get(sessionId) as
      | { payload_json?: unknown }
      | undefined;
    if (startPayload !== undefined) {
      try {
        declared = parseSessionEvent(JSON.parse(String(startPayload.payload_json)));
      } catch {
        declared = null;
      }
    }
    const agent = typeof row?.agent === "string" ? row.agent : "unknown";
    const declaredCapabilities =
      declared !== null && declared.kind === "session.start"
        ? declared.capabilities
        : undefined;
    const meta: SessionMeta = {
      agent,
      repoId: typeof row?.repo_id === "string" ? row.repo_id : "",
      project: typeof row?.repo_label === "string" ? row.repo_label : "",
      capabilities: resolveCapabilities(agent, declaredCapabilities),
      declaredCapabilities,
      startedAt: typeof row?.started_at === "string" ? row.started_at : null,
      endedAt: typeof row?.ended_at === "string" ? row.ended_at : null,
    };
    cache.set(sessionId, meta);
    return meta;
  };
}

/**
 * One session's resolved reporting contract, for callers outside this module.
 *
 * The intervention engine needs it to answer "can this agent supply the evidence
 * this signal is built on?", and it must get the SAME answer the projections do
 * — what the adapter declared, resolved through the shared registry — rather
 * than resolving the agent's default and quietly ignoring the declaration.
 */
export function localSessionCapabilities(
  database: DatabaseSync,
  sessionId: string,
): ResolvedSessionCapabilities {
  return sessionMetaReader(database)(sessionId).capabilities;
}

/* -------------------------------------------------------------------------- */
/* Accumulators                                                                */
/* -------------------------------------------------------------------------- */

interface TokenAcc {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function emptyTokens(): TokenAcc {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function addTokens(target: TokenAcc, delta: TokenAcc): void {
  target.input += delta.input;
  target.output += delta.output;
  target.cacheRead += delta.cacheRead;
  target.cacheWrite += delta.cacheWrite;
}

interface ModelAcc {
  calls: number;
  tokens: TokenAcc;
  costUsd: number;
  priced: boolean;
}

function modelAcc(): ModelAcc {
  return { calls: 0, tokens: emptyTokens(), costUsd: 0, priced: false };
}

interface DailyAcc {
  sessions: Set<string>;
  costUsd: number;
  costMeasured: boolean;
  tokens: TokenAcc;
}

interface AgentDailyAcc {
  agent: AgentId;
  day: string;
  sessions: Set<string>;
  linesAdded: number;
  linesRemoved: number;
  linesMeasured: boolean;
  /** Input+output tokens measured that day. Absent means unmeasured, not zero. */
  tokens: number | null;
}

interface AgentAcc {
  /** Sessions/calls/tokens for this agent's RESIDENT sessions — the same
   *  question the global scalars ask, one level finer, so `Σ byAgent.toolCalls`
   *  equals `tools.callStats.totalCalls` rather than a windowed subset of it. */
  resident: ResidentAcc;
  tokens: TokenAcc;
  costUsd: number;
  costMeasured: boolean;
  linesAdded: number;
  linesRemoved: number;
  linesMeasured: boolean;
  lastEventAt: string;
  firstSeenAt: string | null;
  capabilities: ResolvedSessionCapabilities;
  erroredPresent: boolean;
  errored: number;
  returned: number;
  calls: number;
}

interface FileAcc {
  label: string | null;
  edits: number;
  linesAdded: number;
  linesRemoved: number;
  sessions: Set<string>;
  projects: Map<string, { project: string; edits: number; sessions: Set<string> }>;
}

interface DirAcc {
  label: string | null;
  edits: number;
  projects: Map<string, { project: string; edits: number; sessions: Set<string> }>;
}

interface FilesInPlayAcc {
  label: string | null;
  category: string | null;
  edits: number;
  lastEditedAt: string;
  projects: Map<string, { project: string; edits: number; sessions: Set<string> }>;
}

interface SurvivalEntry {
  sessionId: string;
  fate: LineSurvivalFate;
  linesAuthored: number;
  linesSurviving: number;
  commitsChecked: number;
}

/** Survival checks keyed `sessionId\0rung`, so a re-emitted check REPLACES the
 *  version it supersedes instead of being summed on top of it. */
interface SurvivalAcc {
  entries: Map<string, SurvivalEntry>;
}

function survivalAcc(): SurvivalAcc {
  return { entries: new Map() };
}

/**
 * Record one survival check, LATEST WINS per `(sessionId, rung)`.
 *
 * Not a tidy-up. A session's attributed commit set legitimately GROWS — a file
 * it touched can be committed days after the session ended — so `survival.ts`
 * re-emits the UNION under a new deterministic eventId (the sha set is in the
 * seed) and BOTH rows are in local history. They are two versions of one answer,
 * not two answers, and summing them over-reports every leg: the fixture's
 * re-emit read 300 authored lines against a true 180, and `sessionsRated: 2` for
 * one session, which contradicts the field's own contract ("Distinct rated
 * sessions"). `survivalEventId`'s comment names `(sessionId, rung)` as the
 * reader's dedup key for exactly this reason.
 *
 * Events arrive in `(at, local_seq)` order, so the last write is the latest.
 */
function recordSurvival(
  acc: SurvivalAcc,
  event: Extract<SessionEvent, { kind: "session.linesurvival" }>,
): void {
  acc.entries.set(`${event.sessionId}${KEY_SEP}${event.rung}`, {
    sessionId: event.sessionId,
    fate: event.fate,
    linesAuthored: event.linesAuthored,
    linesSurviving: event.linesSurviving,
    commitsChecked: event.commitsChecked,
  });
}

/** Rated (retained|overwritten) deduped entries — the rows a per-agent split
 *  would have had to work from, which `tools.agentOutcomesUnusable` discloses. */
function ratedSurvivalEntries(acc: SurvivalAcc): SurvivalEntry[] {
  return [...acc.entries.values()].filter(
    (entry) => entry.fate === "retained" || entry.fate === "overwritten",
  );
}

/**
 * One aggregate shape used for BOTH the window total and each repo slice.
 * `ProjectRollup` mirrors the global snapshot field for field, so projecting
 * them from one accumulator is what keeps a repo row and the headline from
 * drifting apart.
 */
/**
 * The legs a RESIDENT-SESSION scalar is summed from, kept apart from the
 * event-stream accumulators beside them because they answer a different
 * question.
 *
 * `usage.totals.sessions` is "summed over the sessions currently held in KV
 * within the window", `tools.callStats.totalCalls` is "the sum of `toolCallCount`
 * over resident sessions", and `usage.cacheReuseRatio` is "summed across the
 * sessions currently held in KV". All three are about SESSIONS the window holds
 * and their own running totals — never about the events that fell inside it. A
 * session that began before the window and worked inside it is in every one of
 * these, carrying the calls and tokens it accrued before the window opened, and
 * counting in-window rows instead silently dropped both it and them.
 */
interface ResidentAcc {
  sessions: Set<string>;
  /** Non-ended, and its complement — together they partition `sessions`, which
   *  is what `outcomes.activeCount` + `endedCount` promise the reader. */
  active: number;
  ended: number;
  toolCalls: number;
  /** input + output, the billable definition, from the carrier when the session
   *  has one and from its own running totals otherwise. */
  tokensTotal: number;
  /** Cache-reuse legs, gated: a session whose tool cannot report a cache split
   *  contributes to NEITHER, because 0 in the numerator and real input in the
   *  denominator fabricates 0% reuse. */
  cacheRead: number;
  cacheInput: number;
}

function newResident(): ResidentAcc {
  return {
    sessions: new Set(),
    active: 0,
    ended: 0,
    toolCalls: 0,
    tokensTotal: 0,
    cacheRead: 0,
    cacheInput: 0,
  };
}

interface Aggregate {
  sessionsStarted: Set<string>;
  resident: ResidentAcc;
  inFlight: number;
  stuckSessionIds: string[];
  toolCalls: number;
  tokens: TokenAcc;
  costUsd: number;
  /** Every session the WINDOW measured money for. Backs `cost.delta`, whose two
   *  legs are both event-log windows. */
  sessionsWithCost: Set<string>;
  /** The subset of those the window also HOLDS. Backs the cost HEADLINE, which
   *  the contract ties to the per-repo and per-agent tiles beside it. */
  residentSessionsWithCost: Set<string>;
  residentCostUsd: number;
  unpricedTokens: Map<string, number>;
  /**
   * `usage.cost.costPartial` — TRUE ONLY when a session that COULD price its
   * work yielded no price at all and was therefore dropped from `totalUsd`.
   *
   * NOT "some model went unpriced", which is what this used to mean and is a
   * different fact with its own field. `CostPanel.tsx` reads the two as separate
   * disjuncts — `cost.costPartial === true || byModel.some(m => m.tokensTotal > 0
   * && m.costUsd == null)` — so folding the second into the first makes the
   * second dead and makes this flag say something the contract does not
   * ("a session ... was excluded from `totalUsd`"). `compilePeriodComparison.ts`
   * reads it alone, with no second disjunct to correct it.
   */
  costPartial: boolean;
  lastEventAt: string;
  errored: number;
  returned: number;
  linesAdded: number;
  linesRemoved: number;
  linesMeasured: boolean;
  editCalls: number;
  /** The `editCalls` subset a COST may divide: edit-family calls on sessions
   *  that price PER CALL. See `costPerEdit` for why the rate needs its own pair. */
  pricedEditCalls: number;
  /** Per-call priced dollars ONLY — `costUsd` above also carries the session
   *  carrier's money, which belongs to the headline and not to this ratio. */
  perCallCostUsd: number;
  /** Whether any per-call priced row was MEASURED. A measured $0 is a real
   *  answer; no measured row at all is honest-empty. */
  perCallCostMeasured: boolean;
  dirEditsTotal: number;
  byTool: Map<string, { calls: number; sessions: Set<string> }>;
  byModel: Map<string, ModelAcc>;
  byAgent: Map<string, AgentAcc>;
  agentModels: Map<string, ModelAcc & { agent: AgentId; model: string }>;
  agentDaily: Map<string, AgentDailyAcc>;
  agentHourly: Map<string, { agent: AgentId; hour: number; calls: number }>;
  hourly: Map<string, HourBucket>;
  endReasons: Map<SessionEndReason, number>;
  endReasonsByDay: Map<string, Map<SessionEndReason, number>>;
  endReasonsByHour: Map<number, Map<SessionEndReason, number>>;
  daily: Map<string, DailyAcc>;
  files: Map<string, FileAcc>;
  dirs: Map<string, DirAcc>;
  verification: Map<VerificationRollup["kind"], { runs: number; passed: number }>;
  survival: SurvivalAcc;
  shipped: number;
  shipDeterminable: number;
  commitsFromSessions: number | null;
  outcomeRows: Map<string, SessionOutcomeRow>;
  /** Survival fate per session, recorded as the rungs land and applied to the
   *  outcome rows in the RESIDENT pass — because the row set is decided there
   *  and not by which sessions happened to write a `session.end`. */
  outcomeFates: Map<string, LineSurvivalFate>;
}

function newAggregate(): Aggregate {
  return {
    sessionsStarted: new Set(),
    resident: newResident(),
    inFlight: 0,
    stuckSessionIds: [],
    toolCalls: 0,
    tokens: emptyTokens(),
    costUsd: 0,
    sessionsWithCost: new Set(),
    residentSessionsWithCost: new Set(),
    residentCostUsd: 0,
    unpricedTokens: new Map(),
    costPartial: false,
    lastEventAt: "",
    errored: 0,
    returned: 0,
    linesAdded: 0,
    linesRemoved: 0,
    linesMeasured: false,
    editCalls: 0,
    pricedEditCalls: 0,
    perCallCostUsd: 0,
    perCallCostMeasured: false,
    dirEditsTotal: 0,
    byTool: new Map(),
    byModel: new Map(),
    byAgent: new Map(),
    agentModels: new Map(),
    agentDaily: new Map(),
    agentHourly: new Map(),
    hourly: new Map(),
    endReasons: new Map(),
    endReasonsByDay: new Map(),
    endReasonsByHour: new Map(),
    daily: new Map(),
    files: new Map(),
    dirs: new Map(),
    verification: new Map(),
    survival: survivalAcc(),
    shipped: 0,
    shipDeterminable: 0,
    commitsFromSessions: null,
    outcomeRows: new Map(),
    outcomeFates: new Map(),
  };
}

interface PriorAcc {
  sessionsStarted: Set<string>;
  costUsd: number;
  costMeasured: boolean;
  linesAdded: number;
  linesMeasured: boolean;
}

function newPrior(): PriorAcc {
  return {
    sessionsStarted: new Set(),
    costUsd: 0,
    costMeasured: false,
    linesAdded: 0,
    linesMeasured: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Small derivations                                                           */
/* -------------------------------------------------------------------------- */

function dayOf(at: string): string {
  return at.slice(0, 10);
}

function hourOf(at: string): number {
  return Number(at.slice(11, 13));
}

function dowOf(at: string): number {
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) ? new Date(parsed).getUTCDay() : 0;
}

function bump<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function daily(aggregate: Aggregate, day: string): DailyAcc {
  let bucket = aggregate.daily.get(day);
  if (!bucket) {
    bucket = {
      sessions: new Set(),
      costUsd: 0,
      costMeasured: false,
      tokens: emptyTokens(),
    };
    aggregate.daily.set(day, bucket);
  }
  return bucket;
}

function agentBucket(
  aggregate: Aggregate,
  meta: SessionMeta,
  at: string,
): AgentAcc {
  let bucket = aggregate.byAgent.get(meta.agent);
  if (!bucket) {
    bucket = {
      resident: newResident(),
      tokens: emptyTokens(),
      costUsd: 0,
      costMeasured: false,
      linesAdded: 0,
      linesRemoved: 0,
      linesMeasured: false,
      lastEventAt: at,
      firstSeenAt: null,
      capabilities: meta.capabilities,
      erroredPresent: false,
      errored: 0,
      returned: 0,
      calls: 0,
    };
    aggregate.byAgent.set(meta.agent, bucket);
  }
  if (at > bucket.lastEventAt) bucket.lastEventAt = at;
  return bucket;
}

function agentDailyBucket(
  aggregate: Aggregate,
  agent: AgentId,
  day: string,
): AgentDailyAcc {
  const key = `${agent}${KEY_SEP}${day}`;
  let bucket = aggregate.agentDaily.get(key);
  if (!bucket) {
    bucket = {
      agent,
      day,
      sessions: new Set(),
      linesAdded: 0,
      linesRemoved: 0,
      linesMeasured: false,
      tokens: null,
    };
    aggregate.agentDaily.set(key, bucket);
  }
  return bucket;
}

/** The billable throughput figure, the same input + output definition
 *  `SessionSummary.tokens.total` carries. */
function billable(tokens: TokenAcc): number {
  return tokens.input + tokens.output;
}

/**
 * EVERY token leg, which is a different question from `billable` beside it and
 * has two readers that both need it.
 *
 * `UnpricedModel.tokensTotal` is "tokens this model burned in the window with no
 * price applied — THE SIZE OF THE HOLE", and a cache read is money a price row
 * would have charged for; reading it as billable under-reported the gap by every
 * cache token the model touched, which is the wrong direction for the one list
 * whose job is to make missing spend visible.
 *
 * The same sum decides whether a model was USED AT ALL. A model row that carried
 * zero of all four legs is a synthetic assistant turn, not work: naming it in a
 * per-model rollup or a pricing-gap list is noise, not honesty, and it trains the
 * reader to ignore the entries that are real.
 */
function measuredTokens(tokens: TokenAcc): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function periodDelta(current: number, previous: number | null): PeriodDelta {
  return { current, previous };
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export interface LocalOverviewOptions extends LocalReadOptions {
  rangeDays: number;
}

export function buildLocalOverview(
  options: LocalOverviewOptions,
): OverviewSnapshot {
  const database = openLocalHistory(options.directory);
  try {
    return buildLocalOverviewOn(database, options);
  } finally {
    database.close();
  }
}

export function buildLocalOverviewOn(
  database: DatabaseSync,
  options: LocalOverviewOptions,
): OverviewSnapshot {
  const nowMs = options.nowMs ?? Date.now();
  const rangeDays = options.rangeDays;
  const windowStart = new Date(nowMs - rangeDays * MS_PER_DAY).toISOString();
  const windowEnd = new Date(nowMs).toISOString();
  const priorStart = new Date(nowMs - 2 * rangeDays * MS_PER_DAY).toISOString();

  const meta = sessionMetaReader(database);
  const global = newAggregate();
  const repos = new Map<string, Aggregate>();
  const repoLabels = new Map<string, string>();
  const globalPrior = newPrior();
  const repoPrior = new Map<string, PriorAcc>();
  const momentum = new Map<string, RepoMomentum>();
  const momentumHistory = new Map<string, { at: string; active: boolean }[]>();
  const filesInPlay = new Map<string, FilesInPlayAcc>();
  /** In-window `session.tokens` deltas per session — see the resident pass. */
  const carrierTokens = new Map<string, TokenAcc>();

  // The live board first: `filesInPlay` and the active/stuck counts are about
  // sessions that have not ended, which the projected session rows already know.
  const live = liveSessionsOn(database, nowMs);

  /**
   * Which sessions the window HOLDS — read before the event loop because the
   * COST HEADLINE is scoped to them and the cost trend beside it is not.
   *
   * `usage.cost.totalUsd` is "Σ of the SAME per-session cost that
   * `projects[].costUsd` and `byAgent[].costUsd` sum, so the headline EQUALS the
   * per-repo / per-agent tiles beside it by construction (every WINDOWED session
   * belongs to exactly one repo + agent)" — overview.ts. `usage.cost.delta`
   * deliberately is not: both of ITS legs come from the event log "so the %
   * movement compares like with like". One accumulator cannot be both, and this
   * plane used one: a `session.tokens` carrier landing in the window put its
   * session's dollars in the headline even when the session's own work fell
   * outside it, so the total carried money belonging to no session
   * `usage.totals.sessions` counted, and `CostPanel.tsx` divides one by the other.
   */
  const residentSessionIds = new Set(
    (
      database
        .prepare(
          `SELECT session_id FROM local_session
            WHERE last_event_at >= ? AND last_event_at < ?
              AND ${DISPLAYABLE_SESSION_SQL}`,
        )
        .all(windowStart, windowEnd) as Array<Record<string, unknown>>
    ).map((raw) => String(raw.session_id)),
  );

  /** Cumulative `session.tokens` reconciliation state, per (window, session). */
  const snapshotApplied = new Map<string, Map<string, TokenAcc>>();
  const priorSnapshot = database.prepare(
    `SELECT payload_json FROM local_event
      WHERE session_id = ? AND kind = 'session.tokens' AND at < ?
      ORDER BY at DESC, local_seq DESC LIMIT 1`,
  );

  function appliedFor(
    sessionId: string,
    boundary: string,
  ): Map<string, TokenAcc> {
    const key = `${boundary}${KEY_SEP}${sessionId}`;
    const hit = snapshotApplied.get(key);
    if (hit) return hit;
    const seeded = new Map<string, TokenAcc>();
    // A session that straddles the window start already reported cumulative
    // totals we must not re-count. Seeding from its last snapshot BEFORE the
    // window makes the in-window delta exact rather than approximated.
    const row = priorSnapshot.get(sessionId, boundary) as
      | { payload_json?: unknown }
      | undefined;
    if (row !== undefined) {
      try {
        const event = parseSessionEvent(JSON.parse(String(row.payload_json)));
        if (event !== null && event.kind === "session.tokens") {
          for (const model of event.models) {
            seeded.set(model.model, {
              input: model.inputTokens,
              output: model.outputTokens,
              cacheRead: model.cacheReadTokens,
              cacheWrite: model.cacheWriteTokens,
            });
          }
        }
      } catch {
        // An unreadable prior snapshot leaves the seed empty; the in-window
        // delta then counts from zero, which over-reports rather than silently
        // dropping the session. It cannot happen for a row this database wrote.
      }
    }
    snapshotApplied.set(key, seeded);
    return seeded;
  }

  function aggregatesFor(repoId: string, project: string): Aggregate[] {
    if (repoId === "") return [global];
    let repo = repos.get(repoId);
    if (!repo) {
      repo = newAggregate();
      repos.set(repoId, repo);
    }
    if (project !== "") repoLabels.set(repoId, project);
    return [global, repo];
  }

  function priorsFor(repoId: string): PriorAcc[] {
    if (repoId === "") return [globalPrior];
    let prior = repoPrior.get(repoId);
    if (!prior) {
      prior = newPrior();
      repoPrior.set(repoId, prior);
    }
    return [globalPrior, prior];
  }

  // ── prior window: only the legs a delta pill needs ────────────────────────
  for (const event of streamEvents(database, WINDOW_SQL, priorStart, windowStart)) {
    const session = meta(event.sessionId);
    const targets = priorsFor(session.repoId);
    if (event.kind === "session.start") {
      for (const target of targets) target.sessionsStarted.add(event.sessionId);
      continue;
    }
    if (event.kind === "tool.call") {
      if (typeof event.linesAdded === "number") {
        for (const target of targets) {
          target.linesAdded += event.linesAdded;
          target.linesMeasured = true;
        }
      }
      if (session.capabilities.costScope === "call") {
        const priced = priceToolCall(event);
        if (priced.measured) {
          for (const target of targets) {
            target.costUsd += priced.costUsd;
            target.costMeasured = true;
          }
        }
      }
      continue;
    }
    if (event.kind === "session.tokens" && session.capabilities.costScope === "session") {
      // The prior window's own cumulative reconciliation. Its seed is the last
      // snapshot before the prior window, so the two windows never share cost.
      const applied = appliedFor(event.sessionId, priorStart);
      let cost = 0;
      let measured = false;
      for (const model of event.models) {
        const previous = applied.get(model.model) ?? emptyTokens();
        const delta: TokenAcc = {
          input: Math.max(0, model.inputTokens - previous.input),
          output: Math.max(0, model.outputTokens - previous.output),
          cacheRead: Math.max(0, model.cacheReadTokens - previous.cacheRead),
          cacheWrite: Math.max(0, model.cacheWriteTokens - previous.cacheWrite),
        };
        applied.set(model.model, {
          input: model.inputTokens,
          output: model.outputTokens,
          cacheRead: model.cacheReadTokens,
          cacheWrite: model.cacheWriteTokens,
        });
        const price = priceModelUsage(model.model, {
          inputTokens: delta.input,
          outputTokens: delta.output,
          cacheReadTokens: delta.cacheRead,
          cacheWriteTokens: delta.cacheWrite,
        });
        if (price.priced) {
          cost += price.costUsd;
          measured = true;
        }
      }
      if (measured) {
        for (const target of targets) {
          target.costUsd += cost;
          target.costMeasured = true;
        }
      }
    }
  }

  // ── current window ────────────────────────────────────────────────────────
  for (const event of streamEvents(database, WINDOW_SQL, windowStart, windowEnd)) {
    const session = meta(event.sessionId);
    const targets = aggregatesFor(session.repoId, session.project);
    const day = dayOf(event.at);
    for (const target of targets) {
      if (event.at > target.lastEventAt) target.lastEventAt = event.at;
    }

    switch (event.kind) {
      case "session.start": {
        for (const target of targets) {
          target.sessionsStarted.add(event.sessionId);
          daily(target, day).sessions.add(event.sessionId);
          const key = `${dowOf(event.at)}:${hourOf(event.at)}`;
          const bucket = target.hourly.get(key);
          if (bucket) bucket.sessions += 1;
          else {
            target.hourly.set(key, {
              dow: dowOf(event.at),
              hour: hourOf(event.at),
              sessions: 1,
            });
          }
          agentBucket(target, session, event.at);
          agentDailyBucket(target, session.agent, day).sessions.add(event.sessionId);
        }
        break;
      }

      case "session.end": {
        for (const target of targets) {
          bump(target.endReasons, event.reason);
          let byDay = target.endReasonsByDay.get(day);
          if (!byDay) {
            byDay = new Map();
            target.endReasonsByDay.set(day, byDay);
          }
          bump(byDay, event.reason);
          const hour = hourOf(event.at);
          let byHour = target.endReasonsByHour.get(hour);
          if (!byHour) {
            byHour = new Map();
            target.endReasonsByHour.set(hour, byHour);
          }
          bump(byHour, event.reason);
        }
        break;
      }

      case "tool.call": {
        const priced = priceToolCall(event);
        const perCall = session.capabilities.costScope === "call";
        /** The worker's `pricedRowsOf` gate, stated once here: a row may back a
         *  DOLLAR only when its tool prices per call. `perCall` above is the
         *  weaker token/model test and deliberately stays as it is. */
        const pricesCall = pricesPerCall(session.capabilities);
        for (const target of targets) {
          target.toolCalls += 1;
          const tool = target.byTool.get(event.toolName) ?? {
            calls: 0,
            sessions: new Set<string>(),
          };
          tool.calls += 1;
          tool.sessions.add(event.sessionId);
          target.byTool.set(event.toolName, tool);

          const agent = agentBucket(target, session, event.at);
          agent.calls += 1;
          const hourKey = `${session.agent}${KEY_SEP}${hourOf(event.at)}`;
          const hourBucket = target.agentHourly.get(hourKey) ?? {
            agent: session.agent,
            hour: hourOf(event.at),
            calls: 0,
          };
          hourBucket.calls += 1;
          target.agentHourly.set(hourKey, hourBucket);

          if (typeof event.errored === "boolean") {
            target.returned += 1;
            agent.returned += 1;
            agent.erroredPresent = true;
            if (event.errored) {
              target.errored += 1;
              agent.errored += 1;
            }
          }

          if (typeof event.linesAdded === "number" || typeof event.linesRemoved === "number") {
            target.linesAdded += event.linesAdded ?? 0;
            target.linesRemoved += event.linesRemoved ?? 0;
            target.linesMeasured = true;
            agent.linesAdded += event.linesAdded ?? 0;
            agent.linesRemoved += event.linesRemoved ?? 0;
            agent.linesMeasured = true;
            const agentDay = agentDailyBucket(target, session.agent, day);
            agentDay.linesAdded += event.linesAdded ?? 0;
            agentDay.linesRemoved += event.linesRemoved ?? 0;
            agentDay.linesMeasured = true;
          }

          if (event.fileId !== undefined || typeof event.linesAdded === "number") {
            // `editCalls` is a COUNT and reads every row; the cost-per-edit
            // denominator beside it is a RATE leg and reads only rows whose
            // dollars live on the call (multi-tool.md Appendix A).
            target.editCalls += 1;
            if (pricesCall) target.pricedEditCalls += 1;
          }

          if (event.fileId !== undefined) {
            const file = target.files.get(event.fileId) ?? {
              label: event.fileLabel ?? null,
              edits: 0,
              linesAdded: 0,
              linesRemoved: 0,
              sessions: new Set<string>(),
              projects: new Map(),
            };
            if (file.label === null && event.fileLabel !== undefined) {
              file.label = event.fileLabel;
            }
            file.edits += 1;
            file.linesAdded += event.linesAdded ?? 0;
            file.linesRemoved += event.linesRemoved ?? 0;
            file.sessions.add(event.sessionId);
            if (session.repoId !== "") {
              const split = file.projects.get(session.repoId) ?? {
                project: session.project,
                edits: 0,
                sessions: new Set<string>(),
              };
              split.edits += 1;
              split.sessions.add(event.sessionId);
              file.projects.set(session.repoId, split);
            }
            target.files.set(event.fileId, file);
          }

          if (event.dirId !== undefined) {
            target.dirEditsTotal += 1;
            const dir = target.dirs.get(event.dirId) ?? {
              label: event.dirLabel ?? null,
              edits: 0,
              projects: new Map(),
            };
            if (dir.label === null && event.dirLabel !== undefined) {
              dir.label = event.dirLabel;
            }
            dir.edits += 1;
            if (session.repoId !== "") {
              const split = dir.projects.get(session.repoId) ?? {
                project: session.project,
                edits: 0,
                sessions: new Set<string>(),
              };
              split.edits += 1;
              split.sessions.add(event.sessionId);
              dir.projects.set(session.repoId, split);
            }
            target.dirs.set(event.dirId, dir);
          }

          // A rate needs both legs. A tool that can observe only one is gated
          // out entirely rather than pinned at a fabricated 0% or 100%.
          if (
            event.verificationKind !== undefined &&
            session.capabilities.verification === "both"
          ) {
            const run = target.verification.get(event.verificationKind) ?? {
              runs: 0,
              passed: 0,
            };
            if (typeof event.verificationPassed === "boolean") {
              run.runs += 1;
              if (event.verificationPassed) run.passed += 1;
              target.verification.set(event.verificationKind, run);
            }
          }

          if (perCall && priced.measured) {
            target.costUsd += priced.costUsd;
            if (pricesCall) {
              target.perCallCostUsd += priced.costUsd;
              target.perCallCostMeasured = true;
            }
            target.sessionsWithCost.add(event.sessionId);
            // A `tool.call` inside the window makes its session resident by
            // construction, so this gate can only ever be true here. It is
            // written anyway so the headline's rule lives in one place rather
            // than being true on one leg by accident and enforced on the other.
            if (residentSessionIds.has(event.sessionId)) {
              target.residentCostUsd += priced.costUsd;
              target.residentSessionsWithCost.add(event.sessionId);
              agent.costUsd += priced.costUsd;
              agent.costMeasured = true;
            }
            const bucket = daily(target, day);
            bucket.costUsd += priced.costUsd;
            bucket.costMeasured = true;
          }
          if (perCall) {
            addTokens(target.tokens, priced.tokens);
            addTokens(agent.tokens, priced.tokens);
            addTokens(daily(target, day).tokens, priced.tokens);
            addAgentDailyTokens(
              agentDailyBucket(target, session.agent, day),
              billable(priced.tokens),
            );
            for (const [model, usage] of priced.byModel) {
              mergeModel(target.byModel, model, usage);
              mergeAgentModel(target.agentModels, session.agent, model, usage);
            }
            for (const [model, tokens] of priced.unpriced) {
              bump(target.unpricedTokens, model, tokens);
            }
          }
        }
        break;
      }

      case "session.tokens": {
        if (session.capabilities.costScope !== "session") break;
        const applied = appliedFor(event.sessionId, windowStart);
        const deltas: Array<{ model: string; tokens: TokenAcc }> = [];
        for (const model of event.models) {
          const previous = applied.get(model.model) ?? emptyTokens();
          const delta: TokenAcc = {
            input: Math.max(0, model.inputTokens - previous.input),
            output: Math.max(0, model.outputTokens - previous.output),
            cacheRead: Math.max(0, model.cacheReadTokens - previous.cacheRead),
            cacheWrite: Math.max(0, model.cacheWriteTokens - previous.cacheWrite),
          };
          applied.set(model.model, {
            input: model.inputTokens,
            output: model.outputTokens,
            cacheRead: model.cacheReadTokens,
            cacheWrite: model.cacheWriteTokens,
          });
          if (
            delta.input > 0 ||
            delta.output > 0 ||
            delta.cacheRead > 0 ||
            delta.cacheWrite > 0
          ) {
            deltas.push({ model: model.model, tokens: delta });
          }
        }
        if (deltas.length === 0) break;
        // THE CARRIER'S PRESENCE IS THE MEASUREMENT. A session-costed tool's own
        // rows carry schema zeros, so its real tokens are these deltas and its
        // running totals are the artifact — the resident pass below reads this
        // map first for exactly that reason, and treats a session that appears
        // in it as able to report a cache split whatever it declared.
        const carried = carrierTokens.get(event.sessionId) ?? emptyTokens();
        for (const { tokens } of deltas) addTokens(carried, tokens);
        carrierTokens.set(event.sessionId, carried);
        for (const target of targets) {
          const agent = agentBucket(target, session, event.at);
          const bucket = daily(target, day);
          const agentDay = agentDailyBucket(target, session.agent, day);
          for (const { model, tokens } of deltas) {
            const price = priceModelUsage(model, {
              inputTokens: tokens.input,
              outputTokens: tokens.output,
              cacheReadTokens: tokens.cacheRead,
              cacheWriteTokens: tokens.cacheWrite,
            });
            addTokens(target.tokens, tokens);
            addTokens(agent.tokens, tokens);
            addTokens(bucket.tokens, tokens);
            addAgentDailyTokens(agentDay, billable(tokens));
            // A carrier snapshot is NOT a call, so it contributes tokens and
            // never a count. `ModelRollup.calls` is a MODEL-ITEM count (a
            // tool.call spanning two models counts toward both), and a
            // session-costed tool's `tool.call` rows carry no `models[]` at
            // all, so a carrier-only model has zero model-items in the window.
            // Counting each snapshot delta as a call fabricated one: it read
            // `calls: 2` for a Codex model the hosted plane reports at a
            // measured `0`. Same rule as the worker's `byModelFromBuckets`.
            const usage: ModelAcc = {
              calls: 0,
              tokens,
              costUsd: price.priced ? price.costUsd : 0,
              priced: price.priced,
            };
            mergeModel(target.byModel, model, usage);
            mergeAgentModel(target.agentModels, session.agent, model, usage);
            if (price.priced) {
              target.costUsd += price.costUsd;
              target.sessionsWithCost.add(event.sessionId);
              // The carrier is the leg that CAN pay for a session the window
              // does not hold: a cumulative snapshot re-shipped days after the
              // session stopped is an in-window row for an out-of-window
              // session. Its dollars belong to the trend and not to the
              // headline. The daily bucket below is deliberately outside this
              // gate — `dailyTrends` is an event-log series like the delta.
              if (residentSessionIds.has(event.sessionId)) {
                target.residentCostUsd += price.costUsd;
                target.residentSessionsWithCost.add(event.sessionId);
                agent.costUsd += price.costUsd;
                agent.costMeasured = true;
              }
              bucket.costUsd += price.costUsd;
              bucket.costMeasured = true;
            } else {
              if (price.unpriced === "unknown-model") {
                const hole = measuredTokens(tokens);
                if (hole > 0) bump(target.unpricedTokens, model, hole);
              }
            }
          }
        }
        break;
      }

      case "git.momentum": {
        momentum.set(event.repoId, {
          repoId: event.repoId,
          repoLabel: event.repoLabel,
          gitContext: event.gitContext,
          windowDays: event.windowDays,
          commits: event.commits,
          filesTouched: event.filesTouched,
          linesAdded: event.linesAdded,
          linesDeleted: event.linesDeleted,
          netLines: event.linesAdded - event.linesDeleted,
          generatedLinesExcluded: event.generatedLinesExcluded,
        });
        const history = momentumHistory.get(event.repoId) ?? [];
        history.push({
          at: event.at,
          active: event.commits > 0 || event.filesTouched > 0,
        });
        momentumHistory.set(event.repoId, history);
        if (session.repoId === "" && event.repoId !== "") {
          repoLabels.set(event.repoId, event.repoLabel);
        }
        break;
      }

      case "session.delta": {
        for (const target of aggregatesFor(event.repoId, event.repoLabel)) {
          if (typeof event.commitsLanded === "number") {
            target.shipDeterminable += 1;
            if (event.commitsLanded > 0) target.shipped += 1;
            target.commitsFromSessions =
              (target.commitsFromSessions ?? 0) + event.commitsLanded;
          }
        }
        break;
      }

      case "session.linesurvival": {
        for (const target of aggregatesFor(event.repoId, session.project)) {
          recordSurvival(target.survival, event);
          target.outcomeFates.set(event.sessionId, event.fate);
        }
        break;
      }

      default:
        break;
    }
  }

  // Stuckness belongs to the sessions currently in flight — a property of the
  // live board and of nothing else. The active/ended split it used to be
  // computed beside now comes from the resident pass below, because a session
  // the board drops has not stopped existing: it is ENDED, and counting it in
  // neither column left `usage.totals.sessions` larger than
  // `activeCount + endedCount`, which is a partition the chat surface renders as
  // one sentence ("N sessions. X ended, Y still in flight").
  for (const session of live) {
    for (const target of aggregatesFor(session.repoId, session.project)) {
      target.inFlight += 1;
      if (session.status === "stuck") target.stuckSessionIds.push(session.sessionId);
    }
  }

  // ── the RESIDENT pass ─────────────────────────────────────────────────────
  //
  // Every scalar whose contract says "the sessions currently held in KV within
  // the window" is summed HERE, over the session rows the window holds and their
  // own running totals — never over the events that landed inside it. See
  // `ResidentAcc`. `DISPLAYABLE_SESSION_SQL` is the same refusal the worker
  // applies before a state ever reaches its reducer, so the two count the same
  // set of sessions.
  const residentRows = database
    .prepare(
      `SELECT * FROM local_session
        WHERE last_event_at >= ? AND last_event_at < ?
          AND ${DISPLAYABLE_SESSION_SQL}`,
    )
    .all(windowStart, windowEnd)
    .map((raw) => mapLocalSessionRow(raw as Record<string, unknown>));
  // `AgentRollup.firstSeenAt` — "the EARLIEST event the log holds for this
  // agent, across the WHOLE log and NOT the window", deliberately asymmetric
  // with the in-window `lastEventAt` beside it. Windowing it answered a
  // different question and answered it in the one direction that misleads: a
  // 30-day view would report both agents' records starting 30 days ago, which is
  // exactly the false symmetry the field exists to break. The local plane holds
  // the complete record, so it can say the true thing.
  const agentFirstSeen = new Map<string, string>();
  for (const raw of database
    .prepare(
      `SELECT agent, MIN(started_at) AS first_at FROM local_session
        WHERE ${DISPLAYABLE_SESSION_SQL}
        GROUP BY agent`,
    )
    .all() as Array<Record<string, unknown>>) {
    const agent = typeof raw.agent === "string" ? raw.agent : null;
    const firstAt = typeof raw.first_at === "string" ? raw.first_at : null;
    if (agent === null || firstAt === null) continue;
    const existing = agentFirstSeen.get(agent);
    if (existing === undefined || firstAt < existing) {
      agentFirstSeen.set(agent, firstAt);
    }
  }

  for (const row of residentRows) {
    const session = meta(row.sessionId);
    const carried = carrierTokens.get(row.sessionId);
    const ended =
      statusFromSilence(row.endedAt, row.lastEventAt, nowMs) === "ended";
    // A session the total DROPPED: it could price its work, and neither the
    // window nor its own running figure produced a dollar. `row.costUsd` is null
    // exactly when `local_session.cost_known` is 0, which is the local
    // counterpart of the KV cumulative fallback the worker reads before it gives
    // up on a session.
    const canPrice =
      carried !== undefined || session.capabilities.cost !== "none";
    // Tested against the RESIDENT set, because `costPartial` is scoped to "a
    // session that could price its work was excluded from `totalUsd`" and
    // `totalUsd` is the resident sum. The two sets agree on a resident row,
    // which every row in this loop is — naming the set the flag is about keeps
    // it that way rather than by coincidence.
    if (
      canPrice &&
      row.costUsd === null &&
      !global.residentSessionsWithCost.has(row.sessionId)
    ) {
      global.costPartial = true;
    }
    for (const target of aggregatesFor(row.repoId, row.repoLabel)) {
      // The outcome row set is EXACTLY the ended half of the resident partition,
      // which is what makes `bySession` a drill into `endedCount` rather than a
      // second, smaller answer beside it. Seeding it from `session.end` records
      // instead left out every session the abandoned horizon ended — Codex never
      // writes an end record at all — so a window could report four ended
      // sessions and list three, and `SessionEndReasonsWidget`'s own "ended
      // without a recorded reason" disclosure had no row to point at. The worker
      // includes them for the stated reason that they "can carry a real fate, so
      // dropping them would silently hide outcome data" (overview.ts), and
      // anchors on `endedAt ?? lastEventAt` because a session nobody ended has
      // no end time — its last activity IS when it stopped.
      if (ended) {
        target.outcomeRows.set(row.sessionId, {
          sessionId: row.sessionId,
          project: session.project,
          repoId: session.repoId,
          endedAt: row.endedAt ?? row.lastEventAt,
          // An ended session's outcome is unknowable at session end (ADR-OA7):
          // it reads `pending` until a line-survival rung lands for it.
          status: target.outcomeFates.get(row.sessionId) ?? "pending",
        });
      }
      const perAgent = agentBucket(target, session, row.lastEventAt);
      const seen = agentFirstSeen.get(session.agent);
      if (seen !== undefined) perAgent.firstSeenAt = seen;
      for (const acc of [target.resident, perAgent.resident]) {
        acc.sessions.add(row.sessionId);
        if (ended) acc.ended += 1;
        else acc.active += 1;
        acc.toolCalls += row.toolCallCount;
        acc.tokensTotal += carried
          ? carried.input + carried.output
          : row.inputTokens + row.outputTokens;
        // A tool that cannot report a cache split is dropped from BOTH legs. A
        // carrier in hand outranks a stale declaration that one was impossible.
        if (carried !== undefined || canMeasureCacheReuse(session.capabilities)) {
          acc.cacheRead += carried ? carried.cacheRead : row.cacheReadTokens;
          acc.cacheInput += carried ? carried.input : row.inputTokens;
        }
      }
    }
  }

  for (const session of live) {
    for (const file of filesInPlayFor(database, session, windowStart)) {
      const entry = filesInPlay.get(file.fileId) ?? {
        label: file.label,
        category: file.category,
        edits: 0,
        lastEditedAt: file.at,
        projects: new Map(),
      };
      entry.edits += file.edits;
      if (file.at > entry.lastEditedAt) entry.lastEditedAt = file.at;
      if (entry.label === null) entry.label = file.label;
      if (entry.category === null) entry.category = file.category;
      if (session.repoId !== "") {
        const split = entry.projects.get(session.repoId) ?? {
          project: session.project,
          edits: 0,
          sessions: new Set<string>(),
        };
        split.edits += file.edits;
        split.sessions.add(session.sessionId);
        entry.projects.set(session.repoId, split);
      }
      filesInPlay.set(file.fileId, entry);
    }
  }

  const projects: ProjectRollup[] = [...repos.entries()]
    .map(([repoId, aggregate]) =>
      projectRollup(
        repoId,
        repoLabels.get(repoId) ?? "",
        aggregate,
        repoPrior.get(repoId) ?? newPrior(),
      ),
    )
    .sort((a, b) => (a.lastEventAt < b.lastEventAt ? 1 : -1));

  const momentumRows = [...momentum.values()].sort((a, b) =>
    a.repoLabel < b.repoLabel ? -1 : 1,
  );

  const snapshot: OverviewSnapshot = {
    generatedAt: windowEnd,
    rangeDays,
    // A local plane holds the complete raw record, so no plan narrows its
    // windows. It advertises the widest window the read path supports.
    maxRangeDays: WIDEST_OVERVIEW_RANGE_DAYS,
    live,
    usage: {
      totals: {
        sessions: global.resident.sessions.size,
        toolCalls: global.resident.toolCalls,
        sessionsDelta: periodDelta(
          global.sessionsStarted.size,
          globalPrior.sessionsStarted.size > 0
            ? globalPrior.sessionsStarted.size
            : null,
        ),
      },
      cost: costSnapshot(global, globalPrior),
      lines: global.linesMeasured
        ? {
            added: global.linesAdded,
            removed: global.linesRemoved,
            delta: periodDelta(
              global.linesAdded,
              globalPrior.linesMeasured ? globalPrior.linesAdded : null,
            ),
          }
        : null,
      dailyTrends: dailyTrends(global),
      projects,
      momentum: momentumRows,
      portfolio: portfolio(momentumRows, momentumHistory, nowMs),
      cacheReuseRatio: ratio(
        global.resident.cacheRead,
        global.resident.cacheRead + global.resident.cacheInput,
      ),
      // BOTH legs gated to per-call-priced work. `costUsd` beside it carries the
      // session carrier's dollars too, and the denominator cannot see a
      // session-costed tool's edits at all — dividing one by the other blended
      // Claude+Codex money by Claude-only edits and read 3x the worker's answer
      // on the shared fixture. The worker states the same rule at its own
      // `leg.costPerEdit`: "a cross-tool blend wearing a ratio's face".
      costPerEdit:
        global.perCallCostMeasured && global.pricedEditCalls > 0
          ? global.perCallCostUsd / global.pricedEditCalls
          : null,
    },
    codebase: {
      files: fileHeat(global, FILE_HEAT_LIMIT, true),
      directories: dirHeat(global, DIR_HEAT_LIMIT, true),
      rework: fileRework(global, REWORK_LIMIT, true),
      commitStats:
        momentumRows.length === 0
          ? null
          : {
              // The WIDEST sweep window these summed counts reach across, not
              // whichever repo happened to sort first. `momentumRows` is ordered
              // by repo BASENAME, so reading `[0]` made this number a function
              // of what the directory is called: two repos sweeping 7 and 14 days
              // reported 7, and `GitPanel.tsx` renders it as the span the summed
              // commits and files cover ("N commits touched M files over ...").
              windowDays: Math.max(...momentumRows.map((row) => row.windowDays)),
              commits: momentumRows.reduce((sum, row) => sum + row.commits, 0),
              filesTouched: momentumRows.reduce(
                (sum, row) => sum + row.filesTouched,
                0,
              ),
              linesAdded: momentumRows.reduce((sum, row) => sum + row.linesAdded, 0),
              linesDeleted: momentumRows.reduce(
                (sum, row) => sum + row.linesDeleted,
                0,
              ),
              generatedLinesExcluded: momentumRows.reduce(
                (sum, row) => sum + row.generatedLinesExcluded,
                0,
              ),
              commitsFromSessions: global.commitsFromSessions,
            },
      filesInPlay:
        filesInPlay.size === 0
          ? null
          : {
              distinctFiles: filesInPlay.size,
              files: [...filesInPlay.entries()]
                .sort((a, b) => b[1].edits - a[1].edits)
                .slice(0, FILES_IN_PLAY_LIMIT)
                .map(([fileId, entry]) => ({
                  fileId,
                  label: entry.label,
                  category: entry.category as never,
                  edits: entry.edits,
                  lastEditedAt: entry.lastEditedAt,
                  projects: [...entry.projects.entries()].map(([repoId, split]) => ({
                    repoId,
                    project: split.project,
                    edits: split.edits,
                    sessions: split.sessions.size,
                  })),
                })),
            },
    },
    outcomes: {
      endReasons: endReasonCounts(global.endReasons),
      // These two PARTITION `usage.totals.sessions` — a session the window holds
      // is in exactly one of them. `endedCount` therefore counts every resident
      // session that has stopped, including one that went silent past the
      // abandoned horizon without a `session.end`; `endReasons` above still
      // omits it, which is what `SessionEndReasonsWidget` renders as "N ended
      // without a recorded reason" (`endedCount > Σ reasons`).
      activeCount: global.resident.active,
      endedCount: global.resident.ended,
      stuckness: {
        rate: ratio(global.stuckSessionIds.length, global.inFlight),
        stuckCount: global.stuckSessionIds.length,
        inFlight: global.inFlight,
        stuckSessionIds: [...global.stuckSessionIds],
      },
      endReasonsByDay: [...global.endReasonsByDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([day, reasons]) => ({ day, reasons: endReasonCounts(reasons) })),
      // The retry-shape classifier behind one-shot is a worker derivation. Null
      // is its documented honest-empty value; a 0 would read as "nothing ran
      // clean", which is a claim this plane cannot make.
      oneShotRate: null,
      shipRate: ratio(global.shipped, global.shipDeterminable),
      lineSurvival: lineSurvival(global.survival),
      bySession: outcomeRows(global),
    },
    activity: {
      hourlyDistribution: [...global.hourly.values()].sort(
        (a, b) => a.dow - b.dow || a.hour - b.hour,
      ),
      agentHourly: agentHourly(global),
      endReasonsByHour: endReasonsByHour(global),
    },
    tools: {
      byTool: toolRollups(global),
      callStats: {
        // The RESIDENT sum, not the in-window row count: "the only one of these
        // summed from the sessions currently held in KV (sum of `toolCallCount`
        // over resident sessions)". `byTool` beside it is a row count and stays
        // one — the contract splits them deliberately.
        totalCalls: global.resident.toolCalls,
        errorRate: ratio(global.errored, global.returned),
      },
      byModel: modelRollups(global),
      byAgent: agentRollups(global),
      agentDaily: agentDailyPoints(global),
      agentModels: agentModelRollups(global),
      // Per-agent git line attribution is a worker derivation, so the split is
      // honest-empty and every rated survival row is disclosed as one the split
      // could not use rather than silently dropped.
      agentOutcomes: [],
      agentOutcomesUnusable: ratedSurvivalEntries(global.survival).length,
      verification: verificationRollups(global),
    },
    // Config the surfaces render as "what is being watched for". The local
    // plane runs no intervention engine, which is why `interventions` is absent
    // from its declared surfaces; these are the published defaults, not a claim
    // that anything fired.
    thresholds: DEFAULT_THRESHOLDS,
    // Usage headroom rides `agent.quota`; no reading is derived locally yet, so
    // the contract's honest-empty array stands.
    usageAllowances: [],
  };
  // `notificationAvailability` is OPTIONAL and absent means unknown, which is
  // exactly true here: the local plane does not evaluate watch applicability.
  return snapshot;
}

/* -------------------------------------------------------------------------- */
/* Cost                                                                        */
/* -------------------------------------------------------------------------- */

interface PricedCall {
  costUsd: number;
  measured: boolean;
  someUnpriced: boolean;
  tokens: TokenAcc;
  byModel: Map<string, ModelAcc>;
  unpriced: Map<string, number>;
}

/**
 * Price one `tool.call`. When the row carries its per-model breakdown the price
 * is recomputed from tokens (the same authority move the worker makes, so a
 * price-table fix reprices history); otherwise the collector's own advisory
 * `costUsd` stands, and a row with tokens but no price is honestly unmeasured
 * rather than a silent $0.
 */
function priceToolCall(event: ToolCallEvent): PricedCall {
  const byModel = new Map<string, ModelAcc>();
  const unpriced = new Map<string, number>();
  const tokens: TokenAcc = {
    input: event.inputTokens,
    output: event.outputTokens,
    cacheRead: event.cacheReadTokens,
    cacheWrite: event.cacheWriteTokens,
  };
  if (event.models !== undefined && event.models.length > 0) {
    let costUsd = 0;
    let measured = false;
    let someUnpriced = false;
    for (const model of event.models) {
      const price = priceModelUsage(model.model, {
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        cacheReadTokens: model.cacheReadTokens,
        cacheWriteTokens: model.cacheWriteTokens,
      });
      const usage: ModelAcc = {
        calls: 1,
        tokens: {
          input: model.inputTokens,
          output: model.outputTokens,
          cacheRead: model.cacheReadTokens,
          cacheWrite: model.cacheWriteTokens,
        },
        costUsd: price.priced ? price.costUsd : 0,
        priced: price.priced,
      };
      mergeModel(byModel, model.model, usage);
      if (price.priced) {
        costUsd += price.costUsd;
        measured = true;
      } else {
        someUnpriced = true;
        // Only a STALE TABLE is an action. A family we know about and cannot
        // price is permanently honest-empty and is not named here.
        if (price.unpriced === "unknown-model") {
          const hole = measuredTokens(usage.tokens);
          // A model that burned nothing is not a pricing gap. Claude Code stamps
          // `"model":"<synthetic>"` on its synthetic assistant turns with every
          // count 0: it matches no price stem, but there is no spend to miss and
          // no row anyone should add for it. Naming it would be a false alarm in
          // the one list that must only ever raise true ones.
          if (hole > 0) {
            unpriced.set(model.model, (unpriced.get(model.model) ?? 0) + hole);
          }
        }
      }
    }
    return { costUsd, measured, someUnpriced, tokens, byModel, unpriced };
  }
  const totalTokens =
    event.inputTokens + event.outputTokens + event.cacheReadTokens + event.cacheWriteTokens;
  const measured = event.costUsd > 0 || totalTokens === 0;
  return {
    costUsd: event.costUsd,
    measured,
    someUnpriced: !measured,
    tokens,
    byModel,
    unpriced,
  };
}

function mergeModel(
  target: Map<string, ModelAcc>,
  model: string,
  usage: ModelAcc,
): void {
  const existing = target.get(model) ?? modelAcc();
  existing.calls += usage.calls;
  addTokens(existing.tokens, usage.tokens);
  existing.costUsd += usage.costUsd;
  existing.priced = existing.priced || usage.priced;
  target.set(model, existing);
}

function mergeAgentModel(
  target: Map<string, ModelAcc & { agent: AgentId; model: string }>,
  agent: AgentId,
  model: string,
  usage: ModelAcc,
): void {
  const key = `${agent}${KEY_SEP}${model}`;
  const existing = target.get(key) ?? { ...modelAcc(), agent, model };
  existing.calls += usage.calls;
  addTokens(existing.tokens, usage.tokens);
  existing.costUsd += usage.costUsd;
  existing.priced = existing.priced || usage.priced;
  target.set(key, existing);
}

function costSnapshot(
  aggregate: Aggregate,
  prior: PriorAcc,
): OverviewSnapshot["usage"]["cost"] {
  // Two windows, two null gates. The HEADLINE is honest-empty when no session
  // the window HOLDS measured money; the DELTA is honest-empty when the window's
  // rows measured none. A session whose only in-window row is a cumulative
  // carrier makes those different questions.
  const measured = aggregate.sessionsWithCost.size > 0;
  const residentMeasured = aggregate.residentSessionsWithCost.size > 0;
  const unpricedModels: UnpricedModel[] = [...aggregate.unpricedTokens.entries()]
    .map(([model, tokensTotal]) => ({ model, tokensTotal }))
    .sort((a, b) => b.tokensTotal - a.tokensTotal);
  return {
    totalUsd: residentMeasured ? aggregate.residentCostUsd : null,
    sessionsWithCost: aggregate.residentSessionsWithCost.size,
    ...(aggregate.costPartial ? { costPartial: true } : {}),
    ...(unpricedModels.length > 0 ? { unpricedModels } : {}),
    delta: measured
      ? periodDelta(aggregate.costUsd, prior.costMeasured ? prior.costUsd : null)
      : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Projections from an aggregate                                               */
/* -------------------------------------------------------------------------- */

function endReasonCounts(map: Map<SessionEndReason, number>): EndReasonCount[] {
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

function endReasonsByHour(aggregate: Aggregate): HourlyEndReasons[] {
  return [...aggregate.endReasonsByHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, reasons]) => ({ hour, reasons: endReasonCounts(reasons) }));
}

function dailyTrends(aggregate: Aggregate): DailyPoint[] {
  return [...aggregate.daily.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, bucket]) => ({
      day,
      sessions: bucket.sessions.size,
      costUsd: bucket.costMeasured ? bucket.costUsd : null,
      tokensTotal: billable(bucket.tokens),
    }));
}

function toolRollups(aggregate: Aggregate): ToolCallRollup[] {
  return [...aggregate.byTool.entries()]
    .map(([tool, value]) => ({
      tool,
      calls: value.calls,
      sessions: value.sessions.size,
    }))
    .sort((a, b) => b.calls - a.calls);
}

function modelRollups(aggregate: Aggregate): ModelRollup[] {
  return [...aggregate.byModel.entries()]
    // A model that carried zero of all four legs across the window was never
    // actually used — see `measuredTokens`. An unpriced REAL model still
    // surfaces, with the honest-null cost beside it.
    .filter(([, value]) => measuredTokens(value.tokens) > 0)
    .map(([model, value]) => ({
      model,
      calls: value.calls,
      tokensTotal: billable(value.tokens),
      costUsd: value.priced ? value.costUsd : null,
    }))
    .sort((a, b) => b.tokensTotal - a.tokensTotal);
}

function agentModelRollups(aggregate: Aggregate): AgentModelRollup[] {
  return [...aggregate.agentModels.values()]
    // Same zero-usage drop as `modelRollups`: this is that rollup one level finer,
    // so a model absent from the global split must be absent here too.
    .filter((value) => measuredTokens(value.tokens) > 0)
    .map((value) => ({
      agent: value.agent,
      model: value.model,
      calls: value.calls,
      tokensTotal: billable(value.tokens),
      costUsd: value.priced ? value.costUsd : null,
    }))
    .sort((a, b) => b.tokensTotal - a.tokensTotal);
}

function agentRollups(aggregate: Aggregate): AgentRollup[] {
  return [...aggregate.byAgent.entries()]
    .map(([agent, value]) => ({
      agent,
      // The resident legs, like the repo rollup and the headline: `Σ
      // byAgent.toolCalls` is `tools.callStats.totalCalls`, not a windowed
      // subset of it.
      sessions: value.resident.sessions.size,
      activeSessions: value.resident.active,
      toolCalls: value.resident.toolCalls,
      tokensTotal: value.resident.tokensTotal,
      costUsd: value.costMeasured ? value.costUsd : null,
      lines: value.linesMeasured
        ? { added: value.linesAdded, removed: value.linesRemoved }
        : null,
      lastEventAt: value.lastEventAt,
      ...(value.firstSeenAt !== null ? { firstSeenAt: value.firstSeenAt } : {}),
      capabilities: value.capabilities,
      erroredPresent: value.erroredPresent,
      ...(value.returned > 0 || value.calls > 0
        ? {
            errorRate: {
              rate: ratio(value.errored, value.returned),
              errored: value.errored,
              returned: value.returned,
              calls: value.calls,
            },
          }
        : {}),
    }))
    .sort((a, b) => b.toolCalls - a.toolCalls);
}

function agentDailyPoints(aggregate: Aggregate): AgentDailyPoint[] {
  return [...aggregate.agentDaily.values()]
    .map((value) => ({
      agent: value.agent,
      day: value.day,
      sessions: value.sessions.size,
      lines: value.linesMeasured
        ? { added: value.linesAdded, removed: value.linesRemoved }
        : null,
      tokensTotal: value.tokens,
    }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.agent < b.agent ? -1 : 1));
}

function addAgentDailyTokens(bucket: AgentDailyAcc, tokens: number): void {
  bucket.tokens = (bucket.tokens ?? 0) + tokens;
}

function agentHourly(aggregate: Aggregate): AgentHourPoint[] {
  return [...aggregate.agentHourly.values()]
    .map((value) => ({ agent: value.agent, hour: value.hour, calls: value.calls }))
    .sort((a, b) => a.hour - b.hour || (a.agent < b.agent ? -1 : 1));
}

function verificationRollups(aggregate: Aggregate): VerificationRollup[] {
  return [...aggregate.verification.entries()]
    .map(([kind, value]) => ({
      kind: kind as VerificationRollup["kind"],
      passRate: ratio(value.passed, value.runs),
      runs: value.runs,
      passed: value.passed,
    }))
    .sort((a, b) => b.runs - a.runs);
}

function fileHeat(
  aggregate: Aggregate,
  limit: number,
  withProjects: boolean,
): FileHeat[] {
  return [...aggregate.files.entries()]
    .sort((a, b) => b[1].edits - a[1].edits)
    .slice(0, limit)
    .map(([fileId, value]) => ({
      fileId,
      label: value.label,
      edits: value.edits,
      linesAdded: value.linesAdded,
      linesRemoved: value.linesRemoved,
      sessions: value.sessions.size,
      ...(withProjects && value.projects.size > 0
        ? {
            projects: [...value.projects.entries()].map(([repoId, split]) => ({
              repoId,
              project: split.project,
              edits: split.edits,
              sessions: split.sessions.size,
            })),
          }
        : {}),
    }));
}

function dirHeat(
  aggregate: Aggregate,
  limit: number,
  withProjects: boolean,
): DirHeat[] {
  const total = aggregate.dirEditsTotal;
  return [...aggregate.dirs.entries()]
    .sort((a, b) => b[1].edits - a[1].edits)
    .slice(0, limit)
    .map(([dirId, value]) => ({
      dirId,
      label: value.label,
      edits: value.edits,
      share: total > 0 ? value.edits / total : 0,
      ...(withProjects && value.projects.size > 0
        ? {
            projects: [...value.projects.entries()].map(([repoId, split]) => ({
              repoId,
              project: split.project,
              edits: split.edits,
              sessions: split.sessions.size,
            })),
          }
        : {}),
    }));
}

function fileRework(
  aggregate: Aggregate,
  limit: number,
  withProjects: boolean,
): FileRework[] {
  return [...aggregate.files.entries()]
    .filter(([, value]) => value.sessions.size >= 2)
    .sort((a, b) => b[1].sessions.size - a[1].sessions.size || b[1].edits - a[1].edits)
    .slice(0, limit)
    .map(([fileId, value]) => ({
      fileId,
      label: value.label,
      sessions: value.sessions.size,
      edits: value.edits,
      ...(withProjects && value.projects.size > 0
        ? {
            projects: [...value.projects.entries()].map(([repoId, split]) => ({
              repoId,
              project: split.project,
              edits: split.edits,
              sessions: split.sessions.size,
            })),
          }
        : {}),
    }));
}

/** The >=3-commit floor keeps n=1 from rendering a swingy 0%/100% headline. */
const SURVIVAL_COMMIT_FLOOR = 3;

/**
 * The fate split over the DEDUPED checks. Lines and commits are summed over the
 * RATED fates only; the rewrite family (`unreachable`/`unknown`) is carried as
 * counts and never enters the rate, because it is a fate the check could not
 * rate rather than a fate of zero surviving lines.
 */
function lineSurvival(acc: SurvivalAcc): LineSurvivalRollup {
  let linesAuthored = 0;
  let linesSurviving = 0;
  let commitsChecked = 0;
  const fates: Record<LineSurvivalFate, number> = {
    retained: 0,
    overwritten: 0,
    unreachable: 0,
    unknown: 0,
  };
  const ratedSessions = new Set<string>();
  for (const entry of acc.entries.values()) {
    fates[entry.fate] += 1;
    if (entry.fate !== "retained" && entry.fate !== "overwritten") continue;
    linesAuthored += entry.linesAuthored;
    linesSurviving += entry.linesSurviving;
    commitsChecked += entry.commitsChecked;
    ratedSessions.add(entry.sessionId);
  }
  return {
    rate:
      commitsChecked >= SURVIVAL_COMMIT_FLOOR && linesAuthored > 0
        ? linesSurviving / linesAuthored
        : null,
    linesAuthored,
    linesSurviving,
    commitsChecked,
    sessionsRated: ratedSessions.size,
    retained: fates.retained,
    overwritten: fates.overwritten,
    unreachable: fates.unreachable,
    unknown: fates.unknown,
  };
}

function outcomeRows(aggregate: Aggregate): SessionOutcomeRow[] {
  return [...aggregate.outcomeRows.values()]
    .sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1))
    .slice(0, OUTCOME_ROW_LIMIT);
}

function projectRollup(
  repoId: string,
  project: string,
  aggregate: Aggregate,
  prior: PriorAcc,
): ProjectRollup {
  const cost = costSnapshot(aggregate, prior);
  return {
    project,
    repoId,
    // The repo's slice of the same resident question the headline asks, so a
    // project card and the total above it cannot tell different stories.
    // `sessionsDelta` beside it stays START-counted, because both of ITS legs
    // are distinct `session.start` counts over adjacent windows.
    sessions: aggregate.resident.sessions.size,
    sessionsDelta: periodDelta(
      aggregate.sessionsStarted.size,
      prior.sessionsStarted.size > 0 ? prior.sessionsStarted.size : null,
    ),
    activeSessions: aggregate.resident.active,
    toolCalls: aggregate.resident.toolCalls,
    tokensTotal: aggregate.resident.tokensTotal,
    costUsd: cost.totalUsd,
    lastEventAt: aggregate.lastEventAt,
    errorRate: ratio(aggregate.errored, aggregate.returned),
    cacheReuseRatio: ratio(
      aggregate.resident.cacheRead,
      aggregate.resident.cacheRead + aggregate.resident.cacheInput,
    ),
    shipRate: ratio(aggregate.shipped, aggregate.shipDeterminable),
    oneShotRate: null,
    costDelta: cost.delta,
    endReasons: endReasonCounts(aggregate.endReasons),
    stuckness: {
      rate: ratio(aggregate.stuckSessionIds.length, aggregate.inFlight),
      stuckCount: aggregate.stuckSessionIds.length,
      inFlight: aggregate.inFlight,
      stuckSessionIds: [...aggregate.stuckSessionIds],
    },
    byTool: toolRollups(aggregate),
    byModel: modelRollups(aggregate),
    byAgent: agentRollups(aggregate),
    hourlyDistribution: [...aggregate.hourly.values()].sort(
      (a, b) => a.dow - b.dow || a.hour - b.hour,
    ),
    lineSurvival:
      aggregate.survival.entries.size > 0 ? lineSurvival(aggregate.survival) : null,
    endReasonsByHour: endReasonsByHour(aggregate),
    codebaseFiles: fileHeat(aggregate, FILE_HEAT_LIMIT, false),
    codebaseDirectories: dirHeat(aggregate, DIR_HEAT_LIMIT, false),
    codebaseRework: fileRework(aggregate, REWORK_LIMIT, false),
    verification: verificationRollups(aggregate),
    agentOutcomes: [],
    agentOutcomesUnusable: ratedSurvivalEntries(aggregate.survival).length,
    agentModels: agentModelRollups(aggregate),
    agentDaily: agentDailyPoints(aggregate),
    agentHourly: agentHourly(aggregate),
    dailyTrends: dailyTrends(aggregate),
    // The ratio's raw legs, from the same resident sum, so a subset merge
    // recomputes the ratio instead of averaging ratios that were never comparable.
    cacheReadTokens: aggregate.resident.cacheRead,
    cacheInputTokens: aggregate.resident.cacheInput,
    ...(aggregate.shipDeterminable > 0
      ? { shipped: aggregate.shipped, shipDeterminable: aggregate.shipDeterminable }
      : {}),
    ...(aggregate.returned > 0
      ? { toolErrors: aggregate.errored, toolCallsReturned: aggregate.returned }
      : {}),
    editCalls: aggregate.editCalls,
    dirEditsTotal: aggregate.dirEditsTotal,
    ...(aggregate.commitsFromSessions !== null
      ? { commitsFromSessions: aggregate.commitsFromSessions }
      : {}),
    ...(aggregate.linesMeasured
      ? {
          lines: {
            added: aggregate.linesAdded,
            removed: aggregate.linesRemoved,
            priorAdded: prior.linesMeasured ? prior.linesAdded : null,
          },
        }
      : {}),
  };
}

/**
 * Cross-repo breadth from the LATEST momentum snapshot per repo. `quiet` is the
 * one temperature a snapshot answers on its own; every other verdict needs the
 * repo's trailing baseline, which is a worker derivation, so it stays `null`
 * (the contract's "history too thin to judge" value) rather than a fabricated
 * "steady".
 */
function portfolio(
  rows: RepoMomentum[],
  history: Map<string, { at: string; active: boolean }[]>,
  nowMs: number,
): OverviewSnapshot["usage"]["portfolio"] {
  const repos: RepoTemperature[] = rows.map((row) => {
    const active = row.commits > 0 || row.filesTouched > 0;
    const snapshots = history.get(row.repoId) ?? [];
    const lastActive = [...snapshots].reverse().find((entry) => entry.active);
    return {
      repoId: row.repoId,
      repoLabel: row.repoLabel,
      gitContext: row.gitContext,
      temperature: active ? null : "quiet",
      quietDays:
        active || lastActive === undefined
          ? null
          : Math.floor((nowMs - Date.parse(lastActive.at)) / MS_PER_DAY),
      commits: row.commits,
      filesTouched: row.filesTouched,
      netLines: row.netLines,
      generatedLinesExcluded: row.generatedLinesExcluded,
      baseline: null,
    };
  });
  // Most files-touched first, so quiet repos sink. The ORDER is the contract
  // here, not a presentation detail: `MomentumWidgets.tsx` caps the table at the
  // first five rows and re-sorts nothing, on the stated grounds that "the server
  // sorts repos by files touched with quiet repos sinking, so the fold hides the
  // tail". Emitting the scan order instead put a repo with zero commits above a
  // repo with 21 files touched, which on a portfolio of more than five repos
  // hides the active ones inside the fold. Found by the parity gate against the
  // worker's `portfolioMomentumFromRows`.
  repos.sort((a, b) => b.filesTouched - a.filesTouched);
  const moved = repos.filter((repo) => repo.temperature !== "quiet").length;
  // The window of the GLOBALLY-LATEST snapshot, which is the same deterministic
  // rule `portfolioMomentumFromRows` states. `rows` is ordered by repo BASENAME,
  // so reading `[0]` made the breadth window a function of what a directory is
  // called: with repos sweeping 14 and 7 days it reported the alphabetically
  // first one. 0 when nothing qualifies — never a fabricated 7.
  let latestAt = "";
  let windowDays = 0;
  for (const row of rows) {
    const snapshots = history.get(row.repoId) ?? [];
    const latest = snapshots[snapshots.length - 1];
    if (latest === undefined || row.windowDays <= 0) continue;
    if (latest.at > latestAt) {
      latestAt = latest.at;
      windowDays = row.windowDays;
    }
  }
  return {
    windowDays,
    reposTotal: repos.length,
    reposMoved: moved,
    reposQuiet: repos.length - moved,
    repos,
  };
}

/* -------------------------------------------------------------------------- */
/* Live board and session pages                                                */
/* -------------------------------------------------------------------------- */

/**
 * Silence thresholds, not judgements. Past ABANDONED a session is not live at
 * all (session.ts) — the hosted cron reaps it to "ended", and reading a
 * months-old row as permanently "stuck" would leave it accusing an agent of
 * being wedged. Codex matters most here: it writes no end record, ever.
 */
function statusFromSilence(
  endedAt: string | null,
  lastEventAt: string,
  nowMs: number,
): SessionStatus {
  const silenceMs = nowMs - Date.parse(lastEventAt);
  if (endedAt !== null || silenceMs >= ABANDONED_THRESHOLD_MS) return "ended";
  if (silenceMs >= STUCK_THRESHOLD_MS) return "stuck";
  if (silenceMs >= IDLE_THRESHOLD_MS) return "idle";
  return "active";
}

/**
 * Project a local session row into the SHARED view-model.
 *
 * `sessionToSummary` is the publish-safe projection the worker already uses
 * (types/src/projections.ts). Reaching for it rather than hand-rolling the same
 * arithmetic is what keeps Free and Pro reporting the same elapsed span, the
 * same burn rate, and — the one that matters — the same honest-null cost: an
 * agent that cannot price its work reads null here, never a fabricated $0.
 *
 * `modelTokens` is deliberately not supplied. `local_session.cost_usd` already
 * carries the collector's own priced figure (including the Codex
 * `session.tokens` carrier), and re-deriving a per-model breakdown would mean
 * scanning every event of every listed session to change a number that is
 * already correct. The window aggregates in this module DO reprice from
 * `models[]`, which is where a price-table correction needs to land.
 */
export function localSessionRowToSummary(
  row: LocalSessionRow,
  nowMs: number,
  currentTool: string | null,
  capabilities?: SessionCapabilities,
): SessionSummary {
  const state: SessionState = {
    sessionId: row.sessionId,
    startedAt: row.startedAt,
    lastEventAt: row.lastEventAt,
    ...(row.endedAt !== null ? { endedAt: row.endedAt } : {}),
    repoId: row.repoId,
    repoLabel: row.repoLabel,
    agent: row.agent,
    ...(capabilities ? { capabilities } : {}),
    toolCallCount: row.toolCallCount,
    totalInputTokens: row.inputTokens,
    totalOutputTokens: row.outputTokens,
    totalCacheReadTokens: row.cacheReadTokens,
    totalCacheWriteTokens: row.cacheWriteTokens,
    totalCostUsd: row.costUsd ?? 0,
    ...(currentTool !== null ? { currentTool } : {}),
    ...(row.status === "needs-you" ? { awaitingInput: true } : {}),
    status: statusFromSilence(row.endedAt, row.lastEventAt, nowMs),
  };
  const summary = sessionToSummary(state);
  // `local_session.cost_known` is the local honest-null gate: a session whose
  // cost could not be derived reads null, never a fabricated $0. Burn goes with
  // it, because `null / minutes` silently coerces to 0 in JS.
  return row.costUsd !== null
    ? summary
    : { ...summary, costUsd: null, burnRateUsdPerMin: null };
}

function currentToolFor(
  database: DatabaseSync,
  sessionId: string,
): string | null {
  const row = database
    .prepare(
      `SELECT payload_json FROM local_event
        WHERE session_id = ? AND kind = 'tool.call'
        ORDER BY local_seq DESC LIMIT 1`,
    )
    .get(sessionId) as { payload_json?: unknown } | undefined;
  if (row === undefined) return null;
  try {
    const event = parseSessionEvent(JSON.parse(String(row.payload_json)));
    return event !== null && event.kind === "tool.call" ? event.toolName : null;
  } catch {
    return null;
  }
}

/**
 * Sessions that have not ended AND are still inside the live horizon. A session
 * silent past `ABANDONED_THRESHOLD_MS` is not live (session.ts), so leaving it
 * on the board would show a dead session as in flight forever.
 */
function liveSessionsOn(
  database: DatabaseSync,
  nowMs: number,
): SessionSummary[] {
  const horizon = new Date(nowMs - ABANDONED_THRESHOLD_MS).toISOString();
  const meta = sessionMetaReader(database);
  return database
    .prepare(
      `SELECT * FROM local_session
        WHERE ended_at IS NULL AND last_event_at >= ?
          AND ${DISPLAYABLE_SESSION_SQL}
        ORDER BY last_event_at DESC, session_id`,
    )
    .all(horizon)
    .map((raw) => {
      const row = mapLocalSessionRow(raw as Record<string, unknown>);
      return localSessionRowToSummary(
        row,
        nowMs,
        currentToolFor(database, row.sessionId),
        meta(row.sessionId).declaredCapabilities,
      );
    });
}

export function buildLocalLive(options: LocalReadOptions = {}): {
  generatedAt: string;
  live: SessionSummary[];
} {
  const nowMs = options.nowMs ?? Date.now();
  const database = openLocalHistory(options.directory);
  try {
    return {
      generatedAt: new Date(nowMs).toISOString(),
      live: liveSessionsOn(database, nowMs),
    };
  } finally {
    database.close();
  }
}

interface FileInPlay {
  fileId: string;
  label: string | null;
  category: string | null;
  edits: number;
  at: string;
}

/**
 * Files a still-running session has edited IN THE WINDOW, from its own tool.call
 * rows.
 *
 * The window bound is load-bearing and used not to be there. Every other member
 * of `CodebaseSnapshot` is scoped to the window — the type says so once for all
 * of them ("honest-empty until IN-WINDOW rows carry the signal") and again per
 * member ("files edited in 2+ distinct sessions IN THE WINDOW") — and the
 * worker reads this one off the same windowed file grain the others read. An
 * unbounded scan answered a different question in the one direction that
 * misleads: a session in flight since before the window listed a file it last
 * touched days ago under a widget that says "in play right now", and inflated
 * `distinctFiles` past what its siblings on the same panel could account for.
 */
function filesInPlayFor(
  database: DatabaseSync,
  session: SessionSummary,
  windowStart: string,
): FileInPlay[] {
  const files = new Map<string, FileInPlay>();
  for (const event of streamEvents(
    database,
    `SELECT payload_json FROM local_event
      WHERE session_id = ? AND kind = 'tool.call' AND at >= ?
      ORDER BY local_seq`,
    session.sessionId,
    windowStart,
  )) {
    if (event.kind !== "tool.call" || event.fileId === undefined) continue;
    const existing = files.get(event.fileId);
    if (existing) {
      existing.edits += 1;
      existing.at = event.at;
      if (existing.label === null && event.fileLabel !== undefined) {
        existing.label = event.fileLabel;
      }
      if (existing.category === null && event.fileCategory !== undefined) {
        existing.category = event.fileCategory;
      }
      continue;
    }
    files.set(event.fileId, {
      fileId: event.fileId,
      label: event.fileLabel ?? null,
      category: event.fileCategory ?? null,
      edits: 1,
      at: event.at,
    });
  }
  return [...files.values()];
}

export interface LocalSessionPageOptions extends LocalReadOptions {
  cursor?: string | null;
  limit?: number;
  repoId?: string | null;
}

/**
 * One bounded, deterministic keyset page over local session history, newest
 * activity first. The keyset itself lives in local-store.ts so the CLI
 * traversal and this route cannot page differently over the same table.
 */
export function buildLocalSessionPage(
  options: LocalSessionPageOptions = {},
): SessionPage {
  const nowMs = options.nowMs ?? Date.now();
  const page = listLocalSessionPage({
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    limit: Math.max(1, Math.min(SESSION_PAGE_MAX_LIMIT, options.limit ?? SESSION_PAGE_DEFAULT_LIMIT)),
    cursor: options.cursor ?? null,
    repoId: options.repoId ?? null,
  });
  const database = openLocalHistory(options.directory);
  try {
    const meta = sessionMetaReader(database);
    return {
      // `currentTool` is deliberately null on a page: it is a LIVE glance, and
      // reading the latest tool.call for every row of a 200-row page would be
      // 200 scans to decorate history that has already stopped moving.
      sessions: page.sessions.map((row) =>
        localSessionRowToSummary(row, nowMs, null, meta(row.sessionId).declaredCapabilities),
      ),
      nextCursor: page.nextCursor,
    };
  } finally {
    database.close();
  }
}

export function buildLocalSessionSummary(
  sessionId: string,
  options: LocalReadOptions = {},
): SessionSummary | null {
  const nowMs = options.nowMs ?? Date.now();
  const database = openLocalHistory(options.directory);
  try {
    const raw = database
      .prepare(
        `SELECT * FROM local_session
          WHERE session_id = ? AND ${DISPLAYABLE_SESSION_SQL}`,
      )
      .get(sessionId) as Record<string, unknown> | undefined;
    if (raw === undefined) return null;
    const row = mapLocalSessionRow(raw);
    return localSessionRowToSummary(
      row,
      nowMs,
      row.endedAt === null ? currentToolFor(database, sessionId) : null,
      sessionMetaReader(database)(sessionId).declaredCapabilities,
    );
  } finally {
    database.close();
  }
}

/* -------------------------------------------------------------------------- */
/* Session outcome                                                             */
/* -------------------------------------------------------------------------- */

/** The v1 maturation rung. The multi-horizon curve is not emitted, so a row at
 *  any other rung is not the one this contract reads. */
const LINE_SURVIVAL_RUNG = "3d";

const OUTCOME_KIND_PREDICATE =
  "kind IN ('session.delta', 'session.linesurvival', 'tool.call', 'session.end')";

const OUTCOME_EVENT_SQL = `
  SELECT payload_json FROM local_event
   WHERE session_id = ?
     AND ${OUTCOME_KIND_PREDICATE}
   ORDER BY at, local_seq
`;

/**
 * Refusal of an oversized per-session outcome, thrown rather than returned so it
 * cannot be confused with `null`, which already means "no such session here".
 *
 * It carries the two numbers the shared `SessionOutcomeRefusal` wire shape needs,
 * so the plane answers a routable caller exactly what the hosted plane answers
 * and no client learns a second refusal dialect.
 */
export class LocalSessionOutcomeTooLargeError extends Error {
  // Assigned in the body rather than declared as constructor PARAMETER
  // PROPERTIES. The collector is executed by `node --experimental-strip-types`,
  // which erases annotations without evaluating them and rejects the parameter
  // property form outright — and neither `tsc --noEmit` nor vitest would catch
  // it, because both transpile. `EventLogLockTimeoutError` is the same shape for
  // the same reason.
  readonly projectedRows: number;
  readonly rowBudget: number;

  constructor(projectedRows: number, rowBudget: number) {
    super(
      `session outcome projects ${projectedRows} event rows, over the ${rowBudget} row budget`,
    );
    this.name = "LocalSessionOutcomeTooLargeError";
    this.projectedRows = projectedRows;
    this.rowBudget = rowBudget;
  }
}

/**
 * The content-safe per-session outcome, derived from this machine's own rows.
 *
 * Every leg is locally captured: `session.delta` comes from the collector's own
 * hook, `session.linesurvival` from the daemon's maturation sweep, and the error
 * legs from the session's `tool.call` stream. So this is a real local answer,
 * not a worker derivation reimplemented on a guess — which is why the plane can
 * declare `sessionOutcome` rather than serving 501.
 *
 * Every honest-null gate the shared contract documents is kept:
 *   - `commitsLanded` null when no delta row could determine it, never a 0 that
 *     would read as "shipped nothing";
 *   - `uncommitted` null until a delta row accrues;
 *   - `lineSurvival` null until the maturation sweep has emitted a row (the
 *     "outcome pending" state), and its `rate` null below the commit floor, on
 *     an unrated fate, or with nothing authored;
 *   - `errorCount` null unless EVERY counted `tool.call` carries the boolean
 *     `errored` flag, because a measured false beside an unknown is not zero;
 *   - `endReason` null while the session is running or ended without a reason.
 *     Codex, which writes no end record at all, reads null here forever.
 *
 * THE ROW BUDGET IS PER CALLER, NOT PER PLANE, and `rowBudget` defaults to null
 * because the caller who does not pass one is the loopback plane.
 *
 * That default used to be the whole argument: this reads a local file the user
 * already owns, one row at a time, so there is nothing to protect and a refusal
 * would only withhold their own history. Every word of that depends on the
 * caller being the person at the keyboard, which loopback binding guarantees
 * positionally and a routable socket does not. On the self-hosted binding the
 * caller is whoever holds the credential, over a network, and the cost of an
 * unbounded per-session scan lands on the machine that owns every session while
 * the response stays a fixed handful of counts. That is work amplification, and
 * it is the shape the hosted route already refuses on purpose.
 *
 * So the budget exists exactly where the premise for skipping it does not hold.
 * The loopback path is unchanged and spends no extra query; a routable caller
 * gets the hosted refusal, in the hosted wire shape.
 *
 * Returns null for a session this plane will not show, which the route answers
 * as 404 — the same answer the worker's own displayability gate gives.
 */
export function buildLocalSessionOutcome(
  sessionId: string,
  options: LocalReadOptions & { rowBudget?: number | null } = {},
): SessionOutcome | null {
  const database = openLocalHistory(options.directory);
  try {
    return buildLocalSessionOutcomeOnDatabase(database, sessionId, options);
  } finally {
    database.close();
  }
}

export function buildLocalSessionOutcomeOnDatabase(
  database: DatabaseSync,
  sessionId: string,
  options: {
    nowMs?: number;
    rowBudget?: number | null;
    window?: { startedAt: string; lastEventAt: string };
  } = {},
): SessionOutcome | null {
  const nowMs = options.nowMs ?? Date.now();
  const rowBudget = options.rowBudget ?? null;
  const row = database
    .prepare(
      `SELECT session_id FROM local_session
        WHERE session_id = ? AND ${DISPLAYABLE_SESSION_SQL}`,
    )
    .get(sessionId) as Record<string, unknown> | undefined;
  if (row === undefined) return null;

  // Integration reads pin the globally AUTOINCREMENT local_seq once. The
  // bounded preflight and LIMIT + 1 payload read therefore see one append set,
  // even when this primitive is called without the outer query transaction.
  const highWater = rowBudget === null
    ? null
    : Number(
        (
          database
            .prepare(
              "SELECT COALESCE(MAX(local_seq), 0) AS high_water FROM local_event",
            )
            .get() as { high_water?: unknown } | undefined
        )?.high_water ?? 0,
      );
  const window = options.window;
  const boundedPredicate = window === undefined
    ? OUTCOME_KIND_PREDICATE
    : `(
         kind IN ('session.delta', 'session.linesurvival')
         OR (kind IN ('tool.call', 'session.end') AND at >= ? AND at <= ?)
       )`;
  const windowValues = window === undefined
    ? []
    : [window.startedAt, window.lastEventAt];
  if (rowBudget !== null) {
    const counted = database
      .prepare(
        `SELECT COUNT(*) AS outcome_rows FROM (
           SELECT 1 FROM local_event
            WHERE session_id = ?
              AND local_seq <= ?
              AND ${boundedPredicate}
            LIMIT ?
         )`,
      )
      .get(sessionId, highWater, ...windowValues, rowBudget + 1) as
      { outcome_rows?: unknown } | undefined;
    const projectedRows = Number(counted?.outcome_rows ?? 0);
    if (projectedRows > rowBudget) {
      throw new LocalSessionOutcomeTooLargeError(projectedRows, rowBudget);
    }
  }

  // The latest valid delta wins: it is emitted once at session end, and a
  // re-ship that duplicated it should read as the later answer.
  let delta: Extract<SessionEvent, { kind: "session.delta" }> | null = null;
  // One row per rung by construction, so the first valid one wins and a
  // re-emitted sweep cannot flip an already-answered rung.
  const survivalByRung = new Map<
    string,
    Extract<SessionEvent, { kind: "session.linesurvival" }>
  >();
  let sawToolCall = false;
  let errorComplete = true;
  let errorCount = 0;
  let firstErrorAt: string | null = null;
  let endReason: SessionOutcome["endReason"] = null;

  const boundedRows =
    rowBudget === null
      ? null
      : (database
          .prepare(
            `SELECT kind, at, payload_json FROM local_event
              WHERE session_id = ?
                AND local_seq <= ?
                AND ${boundedPredicate}
              ORDER BY at, local_seq
              LIMIT ?`,
          )
          .all(sessionId, highWater, ...windowValues, rowBudget + 1) as Array<{
          kind?: unknown;
          at?: unknown;
          payload_json?: unknown;
        }>);
  if (boundedRows !== null && boundedRows.length > rowBudget!) {
    throw new LocalSessionOutcomeTooLargeError(boundedRows.length, rowBudget!);
  }
  const inputs: Array<{
    storedKind: string;
    storedAt: string;
    event: SessionEvent | null;
  }> = boundedRows === null
    ? [...streamEvents(database, OUTCOME_EVENT_SQL, sessionId)].map((event) => ({
        storedKind: event.kind,
        storedAt: event.at,
        event,
      }))
    : boundedRows.map((raw) => {
        const storedKind = String(raw.kind);
        try {
          const event = parseSessionEvent(JSON.parse(String(raw.payload_json)));
          return {
            storedKind,
            storedAt: String(raw.at),
            event: event?.kind === storedKind ? event : null,
          };
        } catch {
          return { storedKind, storedAt: String(raw.at), event: null };
        }
      });

  for (const input of inputs) {
    const event = input.event;
    if (event === null) {
      if (input.storedKind === "tool.call") {
        sawToolCall = true;
        errorComplete = false;
      }
      continue;
    }
    switch (event.kind) {
      case "session.delta":
        delta = event;
        break;
      case "session.linesurvival":
        if (!survivalByRung.has(event.rung)) survivalByRung.set(event.rung, event);
        break;
      case "tool.call":
        sawToolCall = true;
        if (typeof event.errored !== "boolean") {
          errorComplete = false;
          break;
        }
        if (event.errored) {
          errorCount += 1;
          firstErrorAt ??= input.storedAt;
        }
        break;
      case "session.end":
        endReason = event.reason;
        break;
      default:
        break;
    }
  }

  const survival = survivalByRung.get(LINE_SURVIVAL_RUNG) ?? null;
  const rated =
    survival !== null &&
    (survival.fate === "retained" || survival.fate === "overwritten");

  return {
    sessionId,
    generatedAt: new Date(nowMs).toISOString(),
    commitsLanded:
      delta !== null && typeof delta.commitsLanded === "number"
        ? delta.commitsLanded
        : null,
    uncommitted:
      delta === null
        ? null
        : {
            filesTouched: delta.filesTouchedUncommitted,
            linesAdded: delta.linesAddedUncommitted,
            linesRemoved: delta.linesDeletedUncommitted,
            generatedLinesExcluded: delta.generatedLinesExcludedUncommitted,
          },
    lineSurvival:
      survival === null
        ? null
        : {
            rung: survival.rung,
            fate: survival.fate,
            // The same >=3-commit floor the aggregate applies, because it is
            // a property of the contract rather than of a plane.
            rate:
              rated &&
              survival.commitsChecked >= SURVIVAL_COMMIT_FLOOR &&
              survival.linesAuthored > 0
                ? survival.linesSurviving / survival.linesAuthored
                : null,
            linesAuthored: survival.linesAuthored,
            linesSurviving: survival.linesSurviving,
            commitsChecked: survival.commitsChecked,
          },
    errorCount: sawToolCall && errorComplete ? errorCount : null,
    firstErrorAt:
      sawToolCall && errorComplete && errorCount > 0 ? firstErrorAt : null,
    endReason,
  };
}

/* -------------------------------------------------------------------------- */
/* Developer model                                                             */
/* -------------------------------------------------------------------------- */

export interface LocalDeveloperModelOptions extends LocalReadOptions {
  rangeDays: number;
  /** null or absent merges every repo; a value slices to one. */
  repoId?: string | null;
}

/** The earliest `session.start` seen for a session, plus what it declared. */
interface StartRecord {
  at: string;
  repoId: string;
  project: string;
  workType: string | null;
}

const START_SQL = `
  SELECT payload_json FROM local_event
   WHERE kind = 'session.start' AND at >= ? AND at < ?
   ORDER BY at, local_seq
`;

const SURVIVAL_SQL = `
  SELECT payload_json FROM local_event
   WHERE kind = 'session.linesurvival' AND at >= ? AND at < ?
   ORDER BY at, local_seq
`;

const PORTRAIT_WINDOW_SQL = `
  SELECT payload_json FROM local_event
   WHERE kind IN ('tool.call', 'session.end', 'session.delta')
     AND at >= ? AND at < ?
   ORDER BY at, local_seq
`;

/** One session's ship legs, so the hourly cut and the headline divide the same rows. */
interface ShipAcc {
  shipped: number;
  determinable: number;
}

/**
 * buildLocalDeveloperModel — the period portrait, derived from local history.
 *
 * A deliberate second implementation of the worker's `buildDeveloperModel`, for
 * the same reason the overview above is one: the collector may not import the
 * worker. The rules that decide a NUMBER are mirrored exactly rather than
 * re-invented, because the two answers have to agree over the same log:
 *
 *   - session cadence counts the EARLIEST `session.start` per session. Claude
 *     Code's hook fires again on resume, clear and compact, so counting rows
 *     would count resumptions and let one session unlock a whole paragraph;
 *   - the conditional cut is anchored to the session's START hour, never the
 *     survival check's — the claim is about when the developer sat down, and the
 *     sweep runs days later on the daemon's own schedule;
 *   - it reads the WIDENED start rows for that anchor, so a check inside the
 *     window whose session started just before it is attributed rather than
 *     silently dropped;
 *   - rates over tool outcomes read only rows whose session can observe BOTH
 *     legs (`canRateToolOutcomes`), while counts read every row;
 *   - the survival split is on the CHECK's own `at`, which is what keeps this
 *     window's headline identical to the one the overview already shows.
 *
 * WHAT IS HONEST-EMPTY. `identity`, `conditional`, and `accrual` are OPTIONAL on
 * the contract and are omitted, never zero-filled, when the window measured
 * nothing to put in them. `accrual` in particular is absent whenever the prior
 * window holds no session start: a quiet fortnight and a window from before
 * capture existed are indistinguishable from the log, so there is no honest
 * baseline to compare against.
 *
 * NO ROW BUDGET AND NO ETAG, matching the rest of this plane. Both exist to
 * protect a hosted read budget that a local sqlite file does not have.
 *
 * PROJECT MERGES ARE NOT APPLIED, exactly as `buildLocalOverview` does not apply
 * them. The two local reads therefore agree with each other; a plane that merged
 * on one surface and not the other would be worse than one that merges on
 * neither.
 */
export function buildLocalDeveloperModel(
  options: LocalDeveloperModelOptions,
): DeveloperModelSnapshot {
  const database = openLocalHistory(options.directory);
  try {
    return buildLocalDeveloperModelOn(database, options);
  } finally {
    database.close();
  }
}

export function buildLocalDeveloperModelOn(
  database: DatabaseSync,
  options: LocalDeveloperModelOptions,
): DeveloperModelSnapshot {
  const nowMs = options.nowMs ?? Date.now();
  const rangeDays = isOverviewRangeDays(options.rangeDays)
    ? options.rangeDays
    : OVERVIEW_RANGE_DAYS[0];
  const windowStartMs = nowMs - rangeDays * MS_PER_DAY;
  const windowStart = new Date(windowStartMs).toISOString();
  const windowEnd = new Date(nowMs).toISOString();
  const priorStart = new Date(nowMs - 2 * rangeDays * MS_PER_DAY).toISOString();
  const scopeRepoId =
    options.repoId !== undefined && options.repoId !== null && options.repoId !== ""
      ? options.repoId
      : null;

  const meta = sessionMetaReader(database);

  // ── the widened start scan: one record per session, the earliest ──────────
  const starts = new Map<string, StartRecord>();
  for (const event of streamEvents(database, START_SQL, priorStart, windowEnd)) {
    if (event.kind !== "session.start") continue;
    const existing = starts.get(event.sessionId);
    if (existing !== undefined && existing.at <= event.at) continue;
    starts.set(event.sessionId, {
      at: event.at,
      repoId: event.repoId,
      project: event.repoLabel,
      workType: event.branchWorkType ?? null,
    });
  }

  /** A session's repo, from its start row and then from the projected row. The
   *  start row covers the prior window, which the session table's own labels do
   *  too, but a session whose start predates the widened scan still resolves. */
  function repoOf(sessionId: string): string {
    return starts.get(sessionId)?.repoId ?? meta(sessionId).repoId;
  }
  function inScope(sessionId: string): boolean {
    return scopeRepoId === null || repoOf(sessionId) === scopeRepoId;
  }

  const currentStarts = [...starts.entries()].filter(
    ([, record]) => record.at >= windowStart,
  );
  const priorStarts = [...starts.entries()].filter(
    ([, record]) => record.at < windowStart,
  );

  // ── the current window: tools, end reasons, ship ──────────────────────────
  const byTool = new Map<string, { calls: number; sessions: Set<string> }>();
  const byModel = new Map<string, ModelAcc>();
  const verification = new Map<
    VerificationRollup["kind"],
    { runs: number; passed: number }
  >();
  const endReasons = new Map<SessionEndReason, number>();
  const endReasonsByHour = new Map<number, Map<SessionEndReason, number>>();
  const shipBySession = new Map<string, ShipAcc>();
  const languageCalls = new Map<string, number>();
  let erroredCalls = 0;
  let callsWithResult = 0;

  for (const event of streamEvents(
    database,
    PORTRAIT_WINDOW_SQL,
    windowStart,
    windowEnd,
  )) {
    switch (event.kind) {
      case "tool.call": {
        if (!inScope(event.sessionId)) break;
        const tool = byTool.get(event.toolName) ?? {
          calls: 0,
          sessions: new Set<string>(),
        };
        tool.calls += 1;
        tool.sessions.add(event.sessionId);
        byTool.set(event.toolName, tool);

        const priced = priceToolCall(event);
        for (const [model, usage] of priced.byModel) {
          mergeModel(byModel, model, usage);
        }
        if (event.fileLanguage !== undefined) {
          bump(languageCalls, event.fileLanguage);
        }

        // COUNTS read every row above. The rate and the verification runs below
        // read only a session whose tool reports BOTH legs of a result: one that
        // reports only failures rates 100% and one that reports only successes
        // rates 0%, and both are fabrications wearing a measurement's face.
        if (!canRateToolOutcomes(meta(event.sessionId).capabilities)) break;
        if (typeof event.errored === "boolean") {
          callsWithResult += 1;
          if (event.errored) erroredCalls += 1;
        }
        if (
          event.verificationKind !== undefined &&
          typeof event.verificationPassed === "boolean"
        ) {
          const run = verification.get(event.verificationKind) ?? {
            runs: 0,
            passed: 0,
          };
          run.runs += 1;
          if (event.verificationPassed) run.passed += 1;
          verification.set(event.verificationKind, run);
        }
        break;
      }

      case "session.end": {
        if (!inScope(event.sessionId)) break;
        bump(endReasons, event.reason);
        const hour = hourOf(event.at);
        let byHour = endReasonsByHour.get(hour);
        if (!byHour) {
          byHour = new Map();
          endReasonsByHour.set(hour, byHour);
        }
        bump(byHour, event.reason);
        break;
      }

      case "session.delta": {
        // Scoped on the delta row's OWN repo, the way the ship rate is scoped
        // hosted-side. The conditional cut below scopes on the session's start
        // repo instead, which is the same value for every row this collector
        // writes; the two rules are kept distinct so a divergence would show up
        // as a difference from the hosted answer rather than be papered over.
        if (scopeRepoId !== null && event.repoId !== scopeRepoId) break;
        if (typeof event.commitsLanded !== "number") break;
        const ship = shipBySession.get(event.sessionId) ?? {
          shipped: 0,
          determinable: 0,
        };
        ship.determinable += 1;
        if (event.commitsLanded > 0) ship.shipped += 1;
        shipBySession.set(event.sessionId, ship);
        break;
      }

      default:
        break;
    }
  }

  // ── the widened survival scan, split on the CHECK's own instant ───────────
  //
  // Deduped ONCE over the WIDENED scan and split afterwards, not deduped per
  // window. A re-emitted check supersedes the version it grew from wherever that
  // version landed, so a re-emit inside the current window empties the prior
  // window's leg rather than leaving a superseded copy to be counted there.
  const widenedSurvival = survivalAcc();
  const survivalAt = new Map<string, string>();
  for (const event of streamEvents(database, SURVIVAL_SQL, priorStart, windowEnd)) {
    if (event.kind !== "session.linesurvival") continue;
    if (!inScope(event.sessionId)) continue;
    recordSurvival(widenedSurvival, event);
    survivalAt.set(`${event.sessionId}${KEY_SEP}${event.rung}`, event.at);
  }
  const currentSurvival = survivalAcc();
  const priorSurvival = survivalAcc();
  for (const [key, entry] of widenedSurvival.entries) {
    const current = (survivalAt.get(key) ?? "") >= windowStart;
    (current ? currentSurvival : priorSurvival).entries.set(key, entry);
  }

  // The conditional cut reads the CURRENT window's rated checks only, bucketed
  // by the hour the session started. An entry whose session has no known start
  // is DROPPED rather than pooled: filing work under an hour it may not have
  // happened in is the fabrication this facet exists to avoid.
  const survivalByHour = new Map<number, LineSurvivalStartHourBucket>();
  const ratedSessionsByHour = new Map<number, Set<string>>();
  for (const entry of ratedSurvivalEntries(currentSurvival)) {
    const start = starts.get(entry.sessionId);
    if (start === undefined) continue;
    const hour = hourOf(start.at);
    const bucket = survivalByHour.get(hour) ?? {
      hour,
      linesAuthored: 0,
      linesSurviving: 0,
      commitsChecked: 0,
      sessionsRated: 0,
    };
    bucket.linesAuthored += entry.linesAuthored;
    bucket.linesSurviving += entry.linesSurviving;
    bucket.commitsChecked += entry.commitsChecked;
    survivalByHour.set(hour, bucket);
    const seen = ratedSessionsByHour.get(hour) ?? new Set<string>();
    seen.add(entry.sessionId);
    ratedSessionsByHour.set(hour, seen);
  }
  for (const [hour, seen] of ratedSessionsByHour) {
    const bucket = survivalByHour.get(hour);
    if (bucket) bucket.sessionsRated = seen.size;
  }

  // ── live legs: stuckness belongs to sessions in flight, not to the window ──
  const live = liveSessionsOn(database, nowMs).filter((session) =>
    scopeRepoId === null ? true : session.repoId === scopeRepoId,
  );
  const stuckSessionIds = live
    .filter((session) => session.status === "stuck")
    .map((session) => session.sessionId);

  const shipped = [...shipBySession.values()].reduce(
    (sum, ship) => sum + ship.shipped,
    0,
  );
  const shipDeterminable = [...shipBySession.values()].reduce(
    (sum, ship) => sum + ship.determinable,
    0,
  );

  const shipByStartHour = new Map<number, ShipStartHourBucket>();
  for (const [sessionId, ship] of shipBySession) {
    if (ship.determinable === 0) continue;
    const start = starts.get(sessionId);
    if (start === undefined) continue;
    const hour = hourOf(start.at);
    const bucket = shipByStartHour.get(hour) ?? { hour, shipped: 0, determinable: 0 };
    bucket.shipped += ship.shipped;
    bucket.determinable += ship.determinable;
    shipByStartHour.set(hour, bucket);
  }

  const lineSurvivalByStartHour = [...survivalByHour.values()].sort(
    (a, b) => a.hour - b.hour,
  );
  const shipHours = [...shipByStartHour.values()].sort((a, b) => a.hour - b.hour);
  const conditional =
    lineSurvivalByStartHour.length > 0 || shipHours.length > 0
      ? {
          ...(lineSurvivalByStartHour.length > 0 ? { lineSurvivalByStartHour } : {}),
          ...(shipHours.length > 0 ? { shipByStartHour: shipHours } : {}),
        }
      : undefined;

  const fileLanguageMix = [...languageCalls.entries()]
    .map(([language, calls]) => ({ language, calls }))
    .sort((a, b) => b.calls - a.calls || (a.language < b.language ? -1 : 1));
  const branchWorkTypeMix = workTypeMix(currentStarts);
  const identity =
    fileLanguageMix.length > 0 || branchWorkTypeMix.length > 0
      ? {
          ...(fileLanguageMix.length > 0 ? { fileLanguageMix } : {}),
          ...(branchWorkTypeMix.length > 0 ? { branchWorkTypeMix } : {}),
        }
      : undefined;

  const scopedCurrentStarts = currentStarts.filter(([sessionId]) =>
    inScope(sessionId),
  );
  const scopedPriorStarts = priorStarts.filter(([sessionId]) => inScope(sessionId));

  // ── accrual: the same portrait one window earlier ─────────────────────────
  const priorBranchMix = workTypeMix(scopedPriorStarts);
  const accrual =
    scopedPriorStarts.length === 0
      ? undefined
      : {
          sessions: scopedPriorStarts.length,
          hourlyDistribution: hourBuckets(scopedPriorStarts),
          projectFocus: projectFocus(scopedPriorStarts),
          ...(priorBranchMix.length > 0 ? { branchWorkTypeMix: priorBranchMix } : {}),
          lineSurvival: lineSurvival(priorSurvival),
        };

  return {
    scope: {
      rangeDays,
      // A local plane holds the complete raw record, so no plan narrows it.
      maxRangeDays: WIDEST_OVERVIEW_RANGE_DAYS,
      repoId: scopeRepoId,
      generatedAt: windowEnd,
    },
    focus: { projectFocus: projectFocus(scopedCurrentStarts) },
    outcomes: {
      shipRate: ratio(shipped, shipDeterminable),
      lineSurvival: lineSurvival(currentSurvival),
      stuckness: {
        rate: ratio(stuckSessionIds.length, live.length),
        stuckCount: stuckSessionIds.length,
        inFlight: live.length,
        stuckSessionIds,
      },
      endReasons: endReasonCounts(endReasons),
      shipped,
      shipDeterminable,
    },
    activity: {
      hourlyDistribution: hourBuckets(scopedCurrentStarts),
      endReasonsByHour: [...endReasonsByHour.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([hour, reasons]) => ({ hour, reasons: endReasonCounts(reasons) })),
    },
    tools: {
      byTool: [...byTool.entries()]
        .map(([tool, value]) => ({
          tool,
          calls: value.calls,
          sessions: value.sessions.size,
        }))
        .sort((a, b) => b.calls - a.calls),
      byModel: [...byModel.entries()]
        .map(([model, value]) => ({
          model,
          calls: value.calls,
          tokensTotal: billable(value.tokens),
          costUsd: value.priced ? value.costUsd : null,
        }))
        .sort((a, b) => b.tokensTotal - a.tokensTotal),
      callStats: {
        errorRate: ratio(erroredCalls, callsWithResult),
        erroredCalls,
        callsWithResult,
      },
      // The pass RATE is stripped by the contract, and the runs still ride the
      // capability gate above: `3 of 3 passed` states the same thing a 100%
      // would, without ever printing a percentage.
      verification: [...verification.entries()]
        .map(([kind, value]) => ({ kind, runs: value.runs, passed: value.passed }))
        .sort((a, b) => b.runs - a.runs),
    },
    ...(identity ? { identity } : {}),
    ...(conditional ? { conditional } : {}),
    ...(accrual ? { accrual } : {}),
  };
}

/** UTC (day-of-week, hour) session-start buckets. The hour is kept rather than
 *  collapsed to a weekday precisely so a reader off UTC can shift it back. */
function hourBuckets(entries: Array<[string, StartRecord]>): HourBucket[] {
  const buckets = new Map<string, HourBucket>();
  for (const [, record] of entries) {
    const dow = dowOf(record.at);
    const hour = hourOf(record.at);
    const key = `${dow}:${hour}`;
    const existing = buckets.get(key);
    if (existing) existing.sessions += 1;
    else buckets.set(key, { dow, hour, sessions: 1 });
  }
  return [...buckets.values()].sort((a, b) => a.dow - b.dow || a.hour - b.hour);
}

/** Session share per repo. `share` is null only when nothing was counted at all,
 *  never a zero-filled slice of an empty window. */
function projectFocus(entries: Array<[string, StartRecord]>): ProjectFocusEntry[] {
  const byRepo = new Map<string, { project: string; sessions: number }>();
  for (const [, record] of entries) {
    if (record.repoId === "") continue;
    const bucket = byRepo.get(record.repoId) ?? { project: record.project, sessions: 0 };
    if (bucket.project === "" && record.project !== "") bucket.project = record.project;
    bucket.sessions += 1;
    byRepo.set(record.repoId, bucket);
  }
  const total = [...byRepo.values()].reduce((sum, value) => sum + value.sessions, 0);
  return [...byRepo.entries()]
    .map(([repoId, value]) => ({
      repoId,
      project: value.project,
      sessions: value.sessions,
      share: total === 0 ? null : value.sessions / total,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

/** Branch work-type mix. A session whose start declared none is not counted:
 *  git capture may be off or HEAD detached, which is unknown, not "other". */
function workTypeMix(
  entries: Array<[string, StartRecord]>,
): Array<{ workType: string; sessions: number }> {
  const counts = new Map<string, number>();
  for (const [, record] of entries) {
    if (record.workType === null) continue;
    bump(counts, record.workType);
  }
  return [...counts.entries()]
    .map(([workType, sessions]) => ({ workType, sessions }))
    .sort((a, b) => b.sessions - a.sessions || (a.workType < b.workType ? -1 : 1));
}

/* -------------------------------------------------------------------------- */
/* Replay                                                                      */
/* -------------------------------------------------------------------------- */

/** Bucket widths for the throughput chart, chosen from the session span so a
 *  short session is not one bar and a long one is not ten thousand. */
function replayBucketMs(spanMs: number): number {
  if (spanMs <= 2 * 60 * 60 * 1000) return 60_000;
  if (spanMs <= 12 * 60 * 60 * 1000) return 300_000;
  return 3_600_000;
}

const REPLAY_KIND_PREDICATE = `kind IN (
  'session.start',
  'tool.call',
  'session.notification',
  'session.prompt',
  'session.tokens',
  'session.delta',
  'session.end'
)`;

export function buildLocalReplay(
  sessionId: string,
  options: LocalReadOptions & { rowBudget?: number | null } = {},
): ReplaySession | null {
  const database = openLocalHistory(options.directory);
  try {
    return buildLocalReplayOnDatabase(database, sessionId, options);
  } finally {
    database.close();
  }
}

export function buildLocalReplayOnDatabase(
  database: DatabaseSync,
  sessionId: string,
  options: {
    nowMs?: number;
    rowBudget?: number | null;
    window?: { startedAt: string; lastEventAt: string };
    integrationMeasurements?: boolean;
  } = {},
): ReplaySession | null {
  const rowBudget = options.rowBudget ?? null;
  const windowClause = options.window === undefined
    ? ""
    : " AND at >= ? AND at <= ?";
  const windowValues = options.window === undefined
    ? []
    : [options.window.startedAt, options.window.lastEventAt];
  const highWater = rowBudget === null
    ? null
    : Number(
        (
          database
            .prepare(
              "SELECT COALESCE(MAX(local_seq), 0) AS high_water FROM local_event",
            )
            .get() as { high_water?: unknown } | undefined
        )?.high_water ?? 0,
      );
  if (rowBudget !== null) {
    const counted = database
      .prepare(
        `SELECT COUNT(*) AS replay_rows FROM (
           SELECT 1 FROM local_event
            WHERE session_id = ?
              AND local_seq <= ?
              AND ${REPLAY_KIND_PREDICATE}${windowClause}
            LIMIT ?
         )`,
      )
      .get(sessionId, highWater, ...windowValues, rowBudget + 1) as
      { replay_rows?: unknown } | undefined;
    const projectedRows = Number(counted?.replay_rows ?? 0);
    if (projectedRows > rowBudget) {
      throw new LocalReplayTooLargeError(projectedRows, rowBudget);
    }
  }
  const meta = sessionMetaReader(database);
  const session = meta(sessionId);
  const replayInputs: Array<{
    storedKind: string;
    storedAt: string;
    event: SessionEvent | null;
  }> = rowBudget === null
    ? [
        ...streamEvents(
          database,
          `SELECT payload_json FROM local_event
            WHERE session_id = ?
            ORDER BY at, local_seq`,
          sessionId,
        ),
      ].map((event) => ({
        storedKind: event.kind,
        storedAt: event.at,
        event,
      }))
    : (() => {
        const rows = database
          .prepare(
            `SELECT kind, at, payload_json FROM local_event
              WHERE session_id = ?
                AND local_seq <= ?
                AND ${REPLAY_KIND_PREDICATE}${windowClause}
              ORDER BY at, local_seq
              LIMIT ?`,
          )
          .all(sessionId, highWater, ...windowValues, rowBudget + 1) as Array<{
          kind?: unknown;
          at?: unknown;
          payload_json?: unknown;
        }>;
        if (rows.length > rowBudget) {
          throw new LocalReplayTooLargeError(rows.length, rowBudget);
        }
        return rows.map((raw) => {
          const storedKind = String(raw.kind);
          try {
            const event = parseSessionEvent(JSON.parse(String(raw.payload_json)));
            return {
              storedKind,
              storedAt: String(raw.at),
              event: event?.kind === storedKind ? event : null,
            };
          } catch {
            return { storedKind, storedAt: String(raw.at), event: null };
          }
        });
      })();
  if (replayInputs.length === 0) return null;

  const perCall = session.capabilities.costScope === "call";
  const integrationMeasurements = options.integrationMeasurements === true;
  const firstInput = replayInputs[0]!;
  const startedAt = session.startedAt ?? firstInput.event?.at ?? firstInput.storedAt;
  let endedAt: string | null = session.endedAt;
  const keyframes: Keyframe[] = [];
  const moments: ReplayMoment[] = [];
  let toolCallCount = 0;
  let promptCount = 0;
  let costUsd = 0;
  let tokensTotal = 0;
  let filesTouchedUncommitted: number | undefined;
  const peak: { at: string; seq: number; costUsd: number } = {
    at: "",
    seq: 0,
    costUsd: 0,
  };
  const costByInstant = new Map<
    string,
    { costUsd: number; calls: number; tokens: number }
  >();
  const snapshotApplied = new Map<string, TokenAcc>();
  let latestTokenSnapshot: Extract<SessionEvent, { kind: "session.tokens" }> | null = null;
  let sawTokenCarrier = false;
  let tokenCarriersComplete = true;
  let sawCostCarrier = false;
  let costCarriersComplete = true;
  let sawPromptCarrier = false;
  let sawToolCall = false;
  let errorCarriersComplete = true;

  for (const [index, input] of replayInputs.entries()) {
    const seq = index + 1;
    const event = input.event;
    if (event === null) {
      if (input.storedKind === "tool.call") {
        toolCallCount += 1;
        sawToolCall = true;
        errorCarriersComplete = false;
        if (integrationMeasurements && perCall) {
          sawCostCarrier = true;
          costCarriersComplete = false;
          sawTokenCarrier = true;
          tokenCarriersComplete = false;
        }
        const bucket = costByInstant.get(input.storedAt) ?? {
          costUsd: 0,
          calls: 0,
          tokens: 0,
        };
        bucket.calls += 1;
        costByInstant.set(input.storedAt, bucket);
        moments.push({
          at: input.storedAt,
          seq,
          kind: "tool.call",
          ...(integrationMeasurements ? { costMeasured: false } : {}),
        });
      }
      continue;
    }
    switch (event.kind) {
        case "session.start":
          keyframes.push({
            kind: "session-start",
            at: event.at,
            seq,
            label: "Session started",
            detail: event.agent,
          });
          break;
        case "session.end":
          endedAt = event.at;
          keyframes.push({
            kind: "session-end",
            at: event.at,
            seq,
            label: "Session ended",
            detail: event.reason,
          });
          break;
        case "tool.call": {
          toolCallCount += 1;
          sawToolCall = true;
          errorCarriersComplete &&= typeof event.errored === "boolean";
          const priced = priceToolCall(event);
          const models = event.models ?? [];
          const externallyPriced = models.map((model) =>
            priceModelUsage(model.model, {
              inputTokens: model.inputTokens,
              outputTokens: model.outputTokens,
              cacheReadTokens: model.cacheReadTokens,
              cacheWriteTokens: model.cacheWriteTokens,
            }),
          );
          const externalCostKnown =
            models.length > 0
              ? externallyPriced.every((value) => value.priced)
              : event.costUsd > 0;
          const externalCost = models.length > 0
            ? externallyPriced.reduce(
                (sum, value) => sum + (value.priced ? value.costUsd : 0),
                0,
              )
            : event.costUsd;
          const externalTokens = event.inputTokens + event.outputTokens;
          const externalTokenKnown = models.length > 0 || externalTokens > 0;
          const callCost = !perCall
            ? 0
            : integrationMeasurements
              ? externalCost
              : priced.measured
                ? priced.costUsd
                : 0;
          const callTokens = !perCall
            ? 0
            : integrationMeasurements
              ? externalTokens
              : billable(priced.tokens);
          if (integrationMeasurements && perCall) {
            sawCostCarrier = true;
            costCarriersComplete &&= externalCostKnown;
            sawTokenCarrier = true;
            tokenCarriersComplete &&= externalTokenKnown;
          }
          costUsd += callCost;
          tokensTotal += callTokens;
          const bucket = costByInstant.get(event.at) ?? {
            costUsd: 0,
            calls: 0,
            tokens: 0,
          };
          bucket.costUsd += callCost;
          bucket.calls += 1;
          bucket.tokens += callTokens;
          costByInstant.set(event.at, bucket);
          if (toolCallCount === 1) {
            keyframes.push({
              kind: "first-tool-call",
              at: event.at,
              seq,
              label: "First tool call",
              detail: event.toolName,
            });
          }
          if (
            event.errored === true &&
            !keyframes.some((frame) => frame.kind === "first-error")
          ) {
            keyframes.push({
              kind: "first-error",
              at: event.at,
              seq,
              label: "First error",
              detail: event.toolName,
            });
          }
          if (
            event.verificationPassed === false &&
            !keyframes.some((frame) => frame.kind === "verification-failed")
          ) {
            keyframes.push({
              kind: "verification-failed",
              at: event.at,
              seq,
              label: "Verification failed",
              ...(event.verificationKind !== undefined
                ? { detail: event.verificationKind }
                : {}),
            });
          }
          if (callCost > 0 && callCost > peak.costUsd) {
            peak.at = event.at;
            peak.seq = seq;
            peak.costUsd = callCost;
          }
          moments.push({
            at: event.at,
            seq,
            kind: "tool.call",
            toolName: event.toolName,
            costUsd:
              perCall &&
              (integrationMeasurements ? externalCost > 0 : priced.measured)
                ? callCost
                : undefined,
            ...(integrationMeasurements
              ? { costMeasured: perCall && externalCostKnown }
              : {}),
            errored: event.errored,
            verificationKind: event.verificationKind,
            verificationPassed: event.verificationPassed,
            fileCategory: event.fileCategory,
            fileLanguage: event.fileLanguage,
            undoKind: event.undoKind,
          });
          break;
        }
        case "session.tokens": {
          if (perCall) break;
          if (integrationMeasurements) {
            latestTokenSnapshot = event;
            break;
          }
          for (const model of event.models) {
            const previous = snapshotApplied.get(model.model) ?? emptyTokens();
            const delta: TokenAcc = {
              input: Math.max(0, model.inputTokens - previous.input),
              output: Math.max(0, model.outputTokens - previous.output),
              cacheRead: Math.max(0, model.cacheReadTokens - previous.cacheRead),
              cacheWrite: Math.max(0, model.cacheWriteTokens - previous.cacheWrite),
            };
            snapshotApplied.set(model.model, {
              input: model.inputTokens,
              output: model.outputTokens,
              cacheRead: model.cacheReadTokens,
              cacheWrite: model.cacheWriteTokens,
            });
            const price = priceModelUsage(model.model, {
              inputTokens: delta.input,
              outputTokens: delta.output,
              cacheReadTokens: delta.cacheRead,
              cacheWriteTokens: delta.cacheWrite,
            });
            tokensTotal += billable(delta);
            const bucket = costByInstant.get(event.at) ?? {
              costUsd: 0,
              calls: 0,
              tokens: 0,
            };
            bucket.tokens += billable(delta);
            if (price.priced) {
              costUsd += price.costUsd;
              bucket.costUsd += price.costUsd;
            }
            costByInstant.set(event.at, bucket);
          }
          break;
        }
        case "session.prompt":
          promptCount += 1;
          sawPromptCarrier = true;
          moments.push({ at: event.at, seq, kind: "session.prompt" });
          break;
        case "session.notification":
          moments.push({
            at: event.at,
            seq,
            kind: "session.notification",
            notificationType: event.notificationType,
          });
          break;
        case "session.delta":
          filesTouchedUncommitted = event.filesTouchedUncommitted;
          if (
            typeof event.commitsLanded === "number" &&
            event.commitsLanded > 0
          ) {
            keyframes.push({
              kind: "biggest-commit",
              at: event.at,
              seq,
              label: `Shipped ${event.commitsLanded} commit${event.commitsLanded === 1 ? "" : "s"}`,
              detail: `${event.filesTouchedUncommitted} file${event.filesTouchedUncommitted === 1 ? "" : "s"} still uncommitted`,
            });
          }
          break;
        default:
          break;
      }
  }

  if (integrationMeasurements && !perCall && latestTokenSnapshot !== null) {
    const models = latestTokenSnapshot.models;
    if (models.length > 0) {
      const priced = models.map((model) =>
        priceModelUsage(model.model, {
          inputTokens: model.inputTokens,
          outputTokens: model.outputTokens,
          cacheReadTokens: model.cacheReadTokens,
          cacheWriteTokens: model.cacheWriteTokens,
        }),
      );
      tokensTotal = models.reduce(
        (sum, model) => sum + model.inputTokens + model.outputTokens,
        0,
      );
      costUsd = priced.reduce(
        (sum, value) => sum + (value.priced ? value.costUsd : 0),
        0,
      );
      sawTokenCarrier = true;
      tokenCarriersComplete = true;
      sawCostCarrier = true;
      costCarriersComplete = priced.every((value) => value.priced);
    }
  }

  if (peak.seq > 0) {
    keyframes.push({
      kind: "peak-burn",
      at: peak.at,
      seq: peak.seq,
      label: "Peak burn",
      detail: `$${peak.costUsd.toFixed(4)}`,
    });
  }
  keyframes.sort((a, b) => a.seq - b.seq || (a.at < b.at ? -1 : 1));

  const lastInput = replayInputs.at(-1)!;
  const spanEnd = Date.parse(
    endedAt ?? lastInput.event?.at ?? lastInput.storedAt,
  );
  const spanStart = Date.parse(startedAt);
  const bucketMs = replayBucketMs(Math.max(0, spanEnd - spanStart));
  const activity: ReplayActivityBucket[] = [];
  if (Number.isFinite(spanStart) && Number.isFinite(spanEnd)) {
    const firstBucket = Math.floor(spanStart / bucketMs) * bucketMs;
    const lastBucket = Math.floor(spanEnd / bucketMs) * bucketMs;
    const totals = new Map<number, { costUsd: number; calls: number; tokens: number }>();
    for (const [at, value] of costByInstant) {
      const key = Math.floor(Date.parse(at) / bucketMs) * bucketMs;
      const bucket = totals.get(key) ?? { costUsd: 0, calls: 0, tokens: 0 };
      bucket.costUsd += value.costUsd;
      bucket.calls += value.calls;
      bucket.tokens += value.tokens;
      totals.set(key, bucket);
    }
    for (let at = firstBucket; at <= lastBucket; at += bucketMs) {
      const bucket = totals.get(at) ?? { costUsd: 0, calls: 0, tokens: 0 };
      activity.push({
        at: new Date(at).toISOString(),
        bucketMs,
        costUsd: bucket.costUsd,
        toolCallCount: bucket.calls,
        tokensTotal: bucket.tokens,
      });
    }
  }

  return {
    sessionId,
    agent: session.agent,
    startedAt,
    endedAt,
    keyframes,
    activity,
    moments,
    totals: {
      costUsd,
      tokensTotal,
      toolCallCount,
      promptCount,
      ...(integrationMeasurements
        ? {
            measured: {
              costUsd: sawCostCarrier && costCarriersComplete,
              tokensTotal: sawTokenCarrier && tokenCarriersComplete,
              promptCount: sawPromptCarrier,
              errors: sawToolCall && errorCarriersComplete,
            },
          }
        : {}),
      ...(filesTouchedUncommitted !== undefined ? { filesTouchedUncommitted } : {}),
    },
  };
}

export class LocalReplayTooLargeError extends Error {
  readonly projectedRows: number;
  readonly rowBudget: number;

  constructor(projectedRows: number, rowBudget: number) {
    super(`replay projects ${projectedRows} event rows, over the ${rowBudget} row budget`);
    this.name = "LocalReplayTooLargeError";
    this.projectedRows = projectedRows;
    this.rowBudget = rowBudget;
  }
}

/**
 * local-intervention.ts — the intervention engine, run on the machine that owns
 * the history.
 *
 * A deliberate second implementation of the worker's engine, for the same reason
 * `local-projection.ts` is a second implementation of its projections: the
 * collector may depend on `@seorak/types` and node builtins only (CLAUDE.md
 * boundary 1), and the worker's engine is closed source. `@seorak/types` ships
 * the CONTRACT pieces this needs — the signal catalog, `buildSignalBody` so the
 * voice lives in one place, and `agentCanFireSignal` — but nothing there
 * constructs an `Intervention`, and rule 2 keeps evaluation out of the
 * publish-safe package. So the constructor lives here.
 *
 * HONESTY CONTRACT, the same one the hosted engine holds:
 *
 *   - an `Intervention` is constructed ONLY when a real measured field crosses a
 *     real threshold. A null cost is unknown, never a spike; a null burn rate is
 *     unknown, never a high one;
 *   - a signal an agent cannot supply evidence for never fires for that agent
 *     (`agentCanFireSignal`), so a tool that cannot observe failures does not
 *     get a fabricated stuck loop;
 *   - `stuck_loop`'s cadence fallback stays agent-gated to claude-code. Every
 *     other agent needs a real failure leg, because Codex's three-name tool
 *     vocabulary makes runs of five identical calls near-certain and a cadence
 *     guess would page the user with a loop that is not there;
 *   - a fire held by quiet hours is still RECORDED. The history view and the
 *     delivery decision are different questions, and a held fire happened.
 *
 * WHAT THIS PLANE DOES NOT DO. It evaluates and records; it does not deliver.
 * Delivery is a separate concern with its own platform story, and recording a
 * fire that no one was told about is still the truth about what was measured.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_THRESHOLDS,
  agentCanFireSignal,
  buildSignalBody,
  coerceNotificationSettings,
  getSignalMeta,
  type Intervention,
  type InterventionThresholds,
  type NotificationSettings,
  type SessionSummary,
  type SettingsDocument,
  type SignalId,
} from "@seorak/types";
import { parseSessionEvent } from "@seorak/types/event-validation";
import {
  listLocalInterventionFires,
  recordLocalInterventionFire,
} from "./local-intervention-store.ts";
import { openLocalHistory } from "./local-store.ts";
import { buildLocalLive, localSessionCapabilities } from "./local-projection.ts";

/** One run of back-to-back identical tool calls. */
export interface LocalToolRun {
  tool: string;
  count: number;
}

/**
 * The three retry-shaped readings one pass over a session's ordered tool calls
 * can make, plus whether the stream carries an error signal at all.
 */
export interface LocalStuckLoopRuns {
  /** Longest run of back-to-back identical tool names. A weak proxy: it cannot
   *  tell a sixfold refactor from a sixfold retry of a failing step. */
  cadence: LocalToolRun | null;
  /** Longest run of identical tool names where EVERY call errored — the agent
   *  retrying a step that keeps failing. A success breaks the run. */
  errored: LocalToolRun | null;
  /** True when at least one call carried a boolean `errored`. False means the
   *  stream has no honest failure leg, not that nothing failed. */
  erroredPresent: boolean;
  /** The first call the collector flagged `errored: true`. */
  firstErrored: { tool: string } | null;
}

/** The effective configuration for one signal, after every override. */
export interface EffectiveSignalConfig {
  enabled: boolean;
  thresholds: InterventionThresholds;
  alwaysNotify: boolean;
}

export interface LocalInterventionOptions {
  directory?: string;
  nowMs?: number;
}

function wholeMinutes(seconds: number): number {
  return Math.floor(seconds / 60);
}

/**
 * Resolve one signal's effective configuration.
 *
 * Precedence, highest first: a per-project override, the global stored setting,
 * then the catalog default. A MUTED project suppresses every signal outright,
 * and the rest still resolves so a caller that ignores `enabled` reads coherent
 * numbers rather than a half-populated object.
 */
export function resolveLocalSignalConfig(
  settings: NotificationSettings,
  repoId: string,
  signalId: SignalId,
): EffectiveSignalConfig {
  const meta = getSignalMeta(signalId);
  const project = settings.perProject[repoId];
  const override = project?.overrides?.[signalId];
  const global = settings.signals[signalId];

  const baseEnabled =
    override?.enabled ?? global?.enabled ?? meta.defaultEnabled;
  const thresholds: InterventionThresholds = { ...DEFAULT_THRESHOLDS };
  for (const threshold of meta.thresholds) {
    const stored =
      override?.thresholds?.[threshold.key] ?? global?.thresholds?.[threshold.key];
    if (typeof stored === "number") thresholds[threshold.key] = stored;
  }

  return {
    enabled: project?.muted ? false : baseEnabled,
    thresholds,
    alwaysNotify:
      override?.alwaysNotify ?? global?.alwaysNotify ?? meta.defaultAlwaysNotify,
  };
}

function baseFields(
  summary: SessionSummary,
  kind: SignalId,
  triggeredAt: string,
): Omit<Intervention, "body"> {
  const meta = getSignalMeta(kind);
  return {
    kind,
    sessionId: summary.sessionId,
    project: summary.project,
    repoId: summary.repoId,
    triggeredAt,
    signalLabel: meta.label,
    deepLink: `seorak://session/${summary.sessionId}`,
    interruptionLevel: meta.interruptionLevel,
  };
}

/**
 * The scalar crossings, read straight off the live summary. Each is gated on the
 * value being MEASURED: a session whose tool cannot price its work has a null
 * cost, and null is unknown rather than under budget.
 */
export function evaluateLocalScalars(
  summary: SessionSummary,
  thresholds: InterventionThresholds,
  nowMs: number,
): Intervention[] {
  if (summary.status === "ended") return [];
  const triggeredAt = new Date(nowMs).toISOString();
  const elapsedMinutes = wholeMinutes(summary.elapsedSeconds);
  const fires: Intervention[] = [];

  if (summary.costUsd !== null && summary.costUsd >= thresholds.costSpikeUsd) {
    fires.push({
      ...baseFields(summary, "cost_spike", triggeredAt),
      body: buildSignalBody({
        signalId: "cost_spike",
        costUsd: summary.costUsd,
        capUsd: thresholds.costSpikeUsd,
      }),
    });
  }
  if (elapsedMinutes >= thresholds.longSessionMinutes) {
    fires.push({
      ...baseFields(summary, "long_session", triggeredAt),
      body: buildSignalBody({ signalId: "long_session", elapsedMinutes }),
    });
  }
  if (
    summary.burnRateUsdPerMin !== null &&
    summary.burnRateUsdPerMin >= thresholds.highBurnRateUsdPerMinute
  ) {
    fires.push({
      ...baseFields(summary, "high_burn_rate", triggeredAt),
      body: buildSignalBody({
        signalId: "high_burn_rate",
        burnRateUsdPerMin: summary.burnRateUsdPerMin,
        elapsedMinutes,
      }),
    });
  }
  return fires;
}

/** A still-live session that has gone silent past its threshold. */
export function evaluateLocalWentCold(
  summary: SessionSummary,
  wentColdMinutes: number,
  nowMs: number,
): Intervention | null {
  if (summary.status === "ended") return null;
  const silentMinutes = Math.floor(
    (nowMs - Date.parse(summary.lastEventAt)) / 60_000,
  );
  if (!Number.isFinite(silentMinutes) || silentMinutes < wentColdMinutes) {
    return null;
  }
  return {
    ...baseFields(summary, "went_cold", new Date(nowMs).toISOString()),
    body: buildSignalBody({ signalId: "went_cold", silentMinutes }),
  };
}

/**
 * The retry loop. When the stream carries real error flags, only a run of
 * consecutive FAILING calls fires — a long run of successful repeats is
 * productive work, not a wedge, so there is deliberately no fallback in that
 * case. When no error flag exists at all the cadence run stands in, with copy
 * that says "ran N times" rather than "failed N times", and only for
 * claude-code: every other agent reaching here has a stream with no failure leg,
 * and guessing from repetition would page the user about a loop that is not
 * there.
 */
export function evaluateLocalStuckLoop(
  summary: SessionSummary,
  runs: LocalStuckLoopRuns,
  thresholds: InterventionThresholds,
  nowMs: number,
): Intervention | null {
  if (summary.status === "ended") return null;
  const triggeredAt = new Date(nowMs).toISOString();

  if (runs.erroredPresent) {
    const run = runs.errored;
    if (run === null || run.count < thresholds.stuckLoopErroredToolCalls) return null;
    return {
      ...baseFields(summary, "stuck_loop", triggeredAt),
      body: buildSignalBody({
        signalId: "stuck_loop",
        tool: run.tool,
        count: run.count,
        failing: true,
      }),
    };
  }

  if (summary.agent !== "claude-code") return null;
  const run = runs.cadence;
  if (run === null || run.count < thresholds.stuckLoopRepeatedToolCalls) return null;
  return {
    ...baseFields(summary, "stuck_loop", triggeredAt),
    body: buildSignalBody({
      signalId: "stuck_loop",
      tool: run.tool,
      count: run.count,
      failing: false,
    }),
  };
}

/** The first tool failure in a session. The event itself is the trigger, so
 *  there is no threshold to cross. */
export function evaluateLocalFirstError(
  summary: SessionSummary,
  runs: LocalStuckLoopRuns,
  nowMs: number,
): Intervention | null {
  if (summary.status === "ended") return null;
  if (runs.firstErrored === null) return null;
  return {
    ...baseFields(summary, "first_error", new Date(nowMs).toISOString()),
    body: buildSignalBody({
      signalId: "first_error",
      tool: runs.firstErrored.tool,
    }),
  };
}

/** The cross-project spend alarm. Not scoped to a repo, so it carries the
 *  "All projects" title and an empty repo id. */
export function evaluateLocalDailyCostCap(
  totalUsd: number,
  dailyCostCapUsd: number,
  nowMs: number,
): Intervention | null {
  if (totalUsd < dailyCostCapUsd) return null;
  const meta = getSignalMeta("daily_cost_cap");
  return {
    kind: "daily_cost_cap",
    sessionId: "",
    project: "All projects",
    repoId: "",
    triggeredAt: new Date(nowMs).toISOString(),
    signalLabel: meta.label,
    body: buildSignalBody({
      signalId: "daily_cost_cap",
      totalUsd,
      capUsd: dailyCostCapUsd,
    }),
    deepLink: "seorak://home",
    interruptionLevel: meta.interruptionLevel,
  };
}

const SESSION_CALLS_SQL = `
  SELECT payload_json FROM local_event
   WHERE session_id = ? AND kind = 'tool.call'
   ORDER BY at, local_seq
`;

/**
 * One ordered pass over a session's tool calls, reading all three retry shapes
 * at once. The hosted engine takes one query for the same three because a second
 * read of the same rows is a second read either way.
 */
export function localStuckLoopRuns(
  database: DatabaseSync,
  sessionId: string,
): LocalStuckLoopRuns {
  let cadence: LocalToolRun | null = null;
  let errored: LocalToolRun | null = null;
  let erroredPresent = false;
  let firstErrored: { tool: string } | null = null;

  let cadenceTool: string | null = null;
  let cadenceCount = 0;
  let erroredTool: string | null = null;
  let erroredCount = 0;

  const statement = database.prepare(SESSION_CALLS_SQL) as unknown as {
    iterate(...values: string[]): Iterable<unknown>;
  };
  for (const row of statement.iterate(sessionId)) {
    let event = null;
    try {
      event = parseSessionEvent(
        JSON.parse(String((row as { payload_json?: unknown }).payload_json)),
      );
    } catch {
      event = null;
    }
    if (event === null || event.kind !== "tool.call") continue;

    cadenceCount = event.toolName === cadenceTool ? cadenceCount + 1 : 1;
    cadenceTool = event.toolName;
    if (cadence === null || cadenceCount > cadence.count) {
      cadence = { tool: event.toolName, count: cadenceCount };
    }

    if (typeof event.errored === "boolean") {
      erroredPresent = true;
      if (event.errored && firstErrored === null) {
        firstErrored = { tool: event.toolName };
      }
    }
    // A non-errored call breaks the failing run, which is the whole difference
    // between "retrying a failing step" and "using one tool a lot".
    if (event.errored === true) {
      erroredCount = event.toolName === erroredTool ? erroredCount + 1 : 1;
      erroredTool = event.toolName;
      if (errored === null || erroredCount > errored.count) {
        errored = { tool: event.toolName, count: erroredCount };
      }
    } else {
      erroredTool = null;
      erroredCount = 0;
    }
  }

  return { cadence, errored, erroredPresent, firstErrored };
}

/** Measured spend since the local day began, at both cost grains. Null when
 *  NEITHER grain measured anything, never a fabricated $0. */
export function localSpendToday(
  database: DatabaseSync,
  sinceIso: string,
  nowIso: string,
): number | null {
  const row = database
    .prepare(
      `SELECT SUM(cost_usd) AS total, COUNT(*) AS rows FROM local_session
        WHERE cost_known = 1 AND last_event_at >= ? AND last_event_at <= ?`,
    )
    .get(sinceIso, nowIso) as { total?: unknown; rows?: unknown } | undefined;
  if (row === undefined || Number(row.rows ?? 0) === 0) return null;
  const total = Number(row.total ?? 0);
  return Number.isFinite(total) ? total : null;
}

/** The start of the local calendar day, in the reader's own zone. */
function localDayStart(nowMs: number, timeZone: string): string {
  const stamp = localDateStamp(nowMs, timeZone);
  // The stamp is a local calendar date; the window bound has to be the instant
  // that date began, which is why this walks back rather than parsing the stamp
  // as UTC midnight.
  for (let back = 0; back <= 48; back += 1) {
    const candidate = nowMs - back * 60 * 60 * 1000;
    if (localDateStamp(candidate, timeZone) !== stamp) {
      return new Date(candidate + 60 * 60 * 1000).toISOString().slice(0, 13) + ":00:00.000Z";
    }
  }
  return new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
}

/** The reader's own calendar date, used for the once-per-day dedupe stamp. */
export function localDateStamp(nowMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(nowMs));
  } catch {
    // A stored zone this runtime does not know must not stop a tick. UTC is the
    // documented fallback the settings coercer already guards toward.
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

/** Whether the moment falls inside the configured quiet window. */
export function withinLocalQuietHours(
  quietHours: NotificationSettings["quietHours"],
  nowMs: number,
): boolean {
  if (!quietHours.enabled) return false;
  const minute = localMinuteOfDay(nowMs, quietHours.tz);
  const start = minuteOf(quietHours.start);
  const end = minuteOf(quietHours.end);
  if (start === null || end === null) return false;
  // A window that wraps midnight is two ranges, not one.
  return start <= end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

function minuteOf(clock: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function localMinuteOfDay(nowMs: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(nowMs));
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
    return hour * 60 + minute;
  } catch {
    const date = new Date(nowMs);
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

/**
 * Evaluate every live session and record what crossed.
 *
 * Returns the fires that were newly recorded AND not held, which is exactly the
 * set a delivery path would send. A caller with no delivery path can ignore the
 * return value: the recording is the part that makes the history true.
 */
export function sweepLocalInterventions(
  settings: SettingsDocument,
  options: LocalInterventionOptions = {},
): Intervention[] {
  const nowMs = options.nowMs ?? Date.now();
  // `SettingsDocument` is deliberately `Record<SettingsFamily, unknown>` on the
  // wire, so the family is coerced through the shared coercer rather than cast:
  // this reads a file the user can edit by hand.
  const notifications = coerceNotificationSettings(settings.notifications);
  const live = buildLocalLive({
    ...(options.directory === undefined ? {} : { directory: options.directory }),
    nowMs,
  }).live;

  const candidates: Array<{ fire: Intervention; alwaysNotify: boolean }> = [];
  const database = openLocalHistory(options.directory);
  try {
    for (const summary of live) {
      const evidence = {
        agent: summary.agent,
        capabilities: localSessionCapabilities(database, summary.sessionId),
      };
      const config = (signal: SignalId) =>
        resolveLocalSignalConfig(notifications, summary.repoId, signal);
      const gate = (
        fire: Intervention | null,
        signal: SignalId,
        resolved: EffectiveSignalConfig,
      ): void => {
        if (fire === null || !resolved.enabled) return;
        // The evidence gate is not a preference: a signal an agent cannot supply
        // the readings for would fire on a guess.
        if (!agentCanFireSignal(evidence, signal)) return;
        candidates.push({ fire, alwaysNotify: resolved.alwaysNotify });
      };

      // Each scalar is evaluated against its OWN resolved thresholds, so a
      // per-project override of cost_spike cannot move long_session's bound.
      for (const signal of ["cost_spike", "high_burn_rate", "long_session"] as const) {
        const resolved = config(signal);
        const fire =
          evaluateLocalScalars(summary, resolved.thresholds, nowMs).find(
            (candidate) => candidate.kind === signal,
          ) ?? null;
        gate(fire, signal, resolved);
      }

      const cold = config("went_cold");
      gate(
        evaluateLocalWentCold(summary, cold.thresholds.wentColdMinutes, nowMs),
        "went_cold",
        cold,
      );

      // One ordered read of the session's calls backs both log-derived signals,
      // and it is skipped entirely when neither can fire.
      const stuck = config("stuck_loop");
      const error = config("first_error");
      const stuckUsable = stuck.enabled && agentCanFireSignal(evidence, "stuck_loop");
      const errorUsable = error.enabled && agentCanFireSignal(evidence, "first_error");
      if (stuckUsable || errorUsable) {
        const runs = localStuckLoopRuns(database, summary.sessionId);
        gate(
          evaluateLocalStuckLoop(summary, runs, stuck.thresholds, nowMs),
          "stuck_loop",
          stuck,
        );
        gate(evaluateLocalFirstError(summary, runs, nowMs), "first_error", error);
      }
    }

    // daily_cost_cap is evaluated once per tick, never per session, and only
    // when it is switched on — so the spend read never runs for the default
    // configuration. It is cross-project, so no per-project override applies.
    const cap = resolveLocalSignalConfig(notifications, "", "daily_cost_cap");
    let capFire: { fire: Intervention; alwaysNotify: boolean; key: string } | null =
      null;
    if (cap.enabled) {
      const timeZone = notifications.quietHours.tz;
      const total = localSpendToday(
        database,
        localDayStart(nowMs, timeZone),
        new Date(nowMs).toISOString(),
      );
      const fire =
        total === null
          ? null
          : evaluateLocalDailyCostCap(total, cap.thresholds.dailyCostCapUsd, nowMs);
      if (fire !== null) {
        capFire = {
          fire,
          alwaysNotify: cap.alwaysNotify,
          // Once per LOCAL day, so the stamp is the reader's calendar date.
          key: `daily:${localDateStamp(nowMs, timeZone)}:daily_cost_cap`,
        };
      }
    }

    const quiet = withinLocalQuietHours(notifications.quietHours, nowMs);
    const delivered: Intervention[] = [];
    const record = (
      fire: Intervention,
      alwaysNotify: boolean,
      key: string,
    ): void => {
      const held = quiet && !alwaysNotify;
      const stored = held ? { ...fire, held: true } : fire;
      const inserted = recordLocalInterventionFire(
        stored,
        JSON.stringify(stored),
        key,
        held,
        { ...(options.directory === undefined ? {} : { directory: options.directory }), nowMs },
      );
      if (inserted && !held) delivered.push(stored);
    };
    for (const candidate of candidates) {
      record(
        candidate.fire,
        candidate.alwaysNotify,
        `session:${candidate.fire.kind}:${candidate.fire.sessionId}`,
      );
    }
    if (capFire !== null) record(capFire.fire, capFire.alwaysNotify, capFire.key);
    return delivered;
  } finally {
    database.close();
  }
}

/**
 * The rolling day of fires, newest first — what `GET /interventions` answers.
 *
 * A row that no longer decodes is DROPPED rather than partially rendered: a
 * history view that invents a field is worse than one that is short.
 */
export function listLocalInterventions(
  options: LocalInterventionOptions = {},
): Intervention[] {
  const fires: Intervention[] = [];
  for (const stored of listLocalInterventionFires(options)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      continue;
    }
    if (isIntervention(parsed)) fires.push(parsed);
  }
  return fires;
}

const INTERVENTION_KEYS = new Set([
  "kind",
  "sessionId",
  "project",
  "repoId",
  "triggeredAt",
  "signalLabel",
  "body",
  "deepLink",
  "interruptionLevel",
  "held",
]);

/** Strict enough that a row written by a future version cannot be half-read. */
function isIntervention(value: unknown): value is Intervention {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!INTERVENTION_KEYS.has(key)) return false;
  }
  return (
    typeof record.kind === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.project === "string" &&
    typeof record.repoId === "string" &&
    typeof record.triggeredAt === "string" &&
    typeof record.signalLabel === "string" &&
    typeof record.body === "string" &&
    typeof record.deepLink === "string" &&
    (record.interruptionLevel === "passive" ||
      record.interruptionLevel === "active" ||
      record.interruptionLevel === "timeSensitive") &&
    (record.held === undefined || typeof record.held === "boolean")
  );
}

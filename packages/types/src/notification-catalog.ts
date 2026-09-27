/**
 * notification-catalog.ts — the canonical intervention signal catalog.
 *
 * Today the intervention engine's kinds were hardcoded as inline `if` checks.
 * This catalog makes them a DATA registry so that adding a watch is "add one
 * catalog entry + one evaluator", not a re-architecture. It is the single source
 * for:
 *   - the per-signal LABEL ("Cost spike") shown in the settings UI + as the
 *     notification subtitle + the history row label,
 *   - the plain-English WHY rendered in the "what we're watching & why" panel,
 *   - the editable THRESHOLD keys + their defaults (keyed to InterventionThresholds
 *     so a stored override maps straight back onto the numeric bound),
 *   - the per-signal DEFAULTS the coerce + the worker resolve fall back to
 *     (`defaultEnabled`, `interruptionLevel`, `defaultAlwaysNotify`),
 *   - the BODY copy (`buildSignalBody`) — the warm, direct one sentence, voice in
 *     ONE place (CLAUDE.md: "Stuck retrying — failed Bash 3 times in a row" beats
 *     "Hmm, looks stuck!").
 *
 * Pure data + pure functions, no `@mobile-surfaces` / worker imports — publish-safe,
 * travels with `@seorak/types`.
 */
import {
  DEFAULT_THRESHOLDS,
  type InterruptionLevel,
  type InterventionThresholds,
  type SignalId,
} from "./intervention.ts";

/** One editable threshold of a signal. `key` indexes `InterventionThresholds`
 *  so a stored `SignalConfig.thresholds[key]` override maps onto the bound the
 *  evaluator reads, and the web number input is labeled + unit-suffixed. */
export interface SignalThresholdMeta {
  key: keyof InterventionThresholds;
  label: string;
  unit: string;
  default: number;
}

/** The minimum evidence path an installed agent must expose before a watch can
 *  fire honestly. Catalog entries list every requirement they need; the
 *  availability reducer applies AND semantics. */
export type SignalEvidenceRequirement =
  | "session-timing"
  | "session-end"
  | "per-call-cost"
  | "daily-cost"
  | "retry-evidence"
  | "tool-failure";

/** The catalog metadata for one signal — everything the UI, the coerce, and the
 *  worker resolve read; the body copy is `buildSignalBody`, kept separate so the
 *  meta stays a plain data record. */
export interface SignalMeta {
  id: SignalId;
  /** Human signal name — UI + notification subtitle + history row. */
  label: string;
  /** One-line plain-English explainer for the "what we watch" panel. */
  why: string;
  /** Editable thresholds; `[]` for the event-driven signals. */
  thresholds: SignalThresholdMeta[];
  /** Evidence an agent must be able to report for this watch to fire. */
  evidenceRequirements: readonly SignalEvidenceRequirement[];
  /** Default toggle state — the chatty signals default OFF (§8.4). */
  defaultEnabled: boolean;
  /** Per-signal push interruption level — read verbatim by the projection. */
  interruptionLevel: InterruptionLevel;
  /** Default "break through quiet hours" — true for the two cost alarms (§D). */
  defaultAlwaysNotify: boolean;
}

/**
 * The catalog. Order is the display order in the settings + "what we watch"
 * panels (default-on watches first, then the opt-in ones). Threshold defaults
 * are sourced from `DEFAULT_THRESHOLDS` so there is ONE numeric source of truth
 * (a default change is one edit there).
 */
export const SIGNAL_CATALOG: Record<SignalId, SignalMeta> = {
  cost_spike: {
    id: "cost_spike",
    label: "Cost spike",
    why: "A single session's spend crossed your cap.",
    thresholds: [
      { key: "costSpikeUsd", label: "Spend", unit: "$", default: DEFAULT_THRESHOLDS.costSpikeUsd },
    ],
    evidenceRequirements: ["per-call-cost"],
    defaultEnabled: true,
    interruptionLevel: "timeSensitive",
    defaultAlwaysNotify: true,
  },
  high_burn_rate: {
    id: "high_burn_rate",
    label: "High burn rate",
    why: "A session is spending unusually fast right now.",
    thresholds: [
      {
        key: "highBurnRateUsdPerMinute",
        label: "Burn rate",
        unit: "$/min",
        default: DEFAULT_THRESHOLDS.highBurnRateUsdPerMinute,
      },
    ],
    evidenceRequirements: ["per-call-cost"],
    defaultEnabled: true,
    interruptionLevel: "active",
    defaultAlwaysNotify: false,
  },
  long_session: {
    id: "long_session",
    label: "Long session",
    why: "A session has been running a long time.",
    thresholds: [
      {
        key: "longSessionMinutes",
        label: "Duration",
        unit: "min",
        default: DEFAULT_THRESHOLDS.longSessionMinutes,
      },
    ],
    evidenceRequirements: ["session-timing"],
    defaultEnabled: true,
    interruptionLevel: "active",
    defaultAlwaysNotify: false,
  },
  stuck_loop: {
    id: "stuck_loop",
    label: "Stuck loop",
    why: "The agent keeps retrying the same failing step.",
    thresholds: [
      {
        key: "stuckLoopErroredToolCalls",
        label: "Failed retries",
        unit: "calls",
        default: DEFAULT_THRESHOLDS.stuckLoopErroredToolCalls,
      },
      {
        key: "stuckLoopRepeatedToolCalls",
        label: "Repeats (no reported error)",
        unit: "calls",
        default: DEFAULT_THRESHOLDS.stuckLoopRepeatedToolCalls,
      },
    ],
    evidenceRequirements: ["retry-evidence"],
    defaultEnabled: true,
    interruptionLevel: "active",
    defaultAlwaysNotify: false,
  },
  went_cold: {
    id: "went_cold",
    label: "Went cold",
    why: "A live session went quiet, stalled or you stepped away.",
    thresholds: [
      {
        key: "wentColdMinutes",
        label: "Silence",
        unit: "min",
        default: DEFAULT_THRESHOLDS.wentColdMinutes,
      },
    ],
    evidenceRequirements: ["session-timing"],
    defaultEnabled: true,
    interruptionLevel: "active",
    defaultAlwaysNotify: false,
  },
  session_ended: {
    id: "session_ended",
    label: "Session ended",
    why: "A short summary when a session wraps up.",
    thresholds: [],
    evidenceRequirements: ["session-end"],
    defaultEnabled: false,
    interruptionLevel: "passive",
    defaultAlwaysNotify: false,
  },
  daily_cost_cap: {
    id: "daily_cost_cap",
    label: "Daily cost cap",
    why: "Your total spend across all projects today crossed a cap.",
    thresholds: [
      {
        key: "dailyCostCapUsd",
        label: "Daily spend",
        unit: "$",
        default: DEFAULT_THRESHOLDS.dailyCostCapUsd,
      },
    ],
    evidenceRequirements: ["daily-cost"],
    defaultEnabled: false,
    interruptionLevel: "timeSensitive",
    defaultAlwaysNotify: true,
  },
  first_error: {
    id: "first_error",
    label: "First error",
    why: "The first tool failure in a session, caught early.",
    thresholds: [],
    evidenceRequirements: ["tool-failure"],
    defaultEnabled: false,
    interruptionLevel: "active",
    defaultAlwaysNotify: false,
  },
};

/** Every signal id in catalog (display) order. The iteration order the settings
 *  UI, the coerce defaults, and the "what we watch" panel walk. */
export const SIGNAL_IDS = Object.keys(SIGNAL_CATALOG) as SignalId[];

/**
 * Signals the engine evaluates for the ACCOUNT, not for a repo.
 *
 * This is engine fact, not UI taste. `daily_cost_cap` sums spend across every
 * project and the sweep reads `settings.signals.daily_cost_cap.enabled`
 * directly rather than through the per-(repo, signal) resolution, so a
 * per-project override of it is accepted by the coerce and then never read by
 * anything. Offering one would be a control that does nothing.
 *
 * It lives here, beside the catalog it is a property of, because it was
 * previously a bare `id !== "daily_cost_cap"` inside a filter in one surface's
 * UI code — invisible to the other surface, and to anyone adding the next
 * account-scoped watch.
 *
 * The fuller form of this is a `scope` field on every `SignalMeta`. That is a
 * required field on eight entries and on every consumer's type, and this list
 * closes the drift it exists to close; the field is the better shape if a
 * second account-scoped signal ever arrives.
 */
export const ACCOUNT_SCOPED_SIGNAL_IDS: readonly SignalId[] = ["daily_cost_cap"];

/**
 * Signals worth offering a PER-PROJECT override for: repo-scoped, and carrying
 * at least one threshold to tune. `session_ended` and `first_error` carry none,
 * so a per-project row for them would hold a toggle and nothing else.
 */
export const PROJECT_TUNABLE_SIGNAL_IDS: readonly SignalId[] = SIGNAL_IDS.filter(
  (id) =>
    SIGNAL_CATALOG[id].thresholds.length > 0 &&
    !ACCOUNT_SCOPED_SIGNAL_IDS.includes(id),
);

/** Whether `id` is a known signal — guards a stored/stale key before it indexes
 *  the catalog (a removed signal in an old stored row must not crash a consumer). */
export function isSignalId(id: unknown): id is SignalId {
  return typeof id === "string" && id in SIGNAL_CATALOG;
}

/** The catalog entry for a signal (total over the known set). */
export function getSignalMeta(id: SignalId): SignalMeta {
  return SIGNAL_CATALOG[id];
}

// ---------------------------------------------------------------------------
// Body copy — the warm, direct one sentence per signal (CLAUDE.md voice). The
// evaluator measures the values and hands them in as a discriminated context;
// the copy lives HERE so voice is edited in one place and never drifts between
// the worker fire-path and any future surface.
// ---------------------------------------------------------------------------

/** Two-decimal USD, no rounding surprises in the copy (e.g. 0.62). */
const usd = (n: number): string => n.toFixed(2);
/** Pluralize a whole-count noun ("1 commit" / "2 commits"). */
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The PROMPT half of a body — the call to action a lock screen needs and a
 * narrative surface must not repeat. A push is read AT fire time, so "Stalled,
 * or did you step away?" is the right sentence there. Home reads the same frozen
 * fire minutes later, next to its own account of what needs you: spliced whole,
 * the push CTA argues with the surface around it.
 *
 * So the two halves are separate strings that `buildSignalBody` joins (the push
 * copy is byte-identical to before) and `stripSignalPrompt` splits back apart.
 * A prompt carries NO measured value, which is what makes the split reversible
 * from the frozen body alone, with no new field on the Intervention record.
 *
 * A signal with no entry here is claim-only; its body needs no stripping.
 */
export const SIGNAL_PROMPTS: Partial<Record<SignalId, string>> = {
  long_session: "Might be a moment to step in.",
  went_cold: "Stalled, or did you step away?",
  first_error: "Watching to see if it recovers.",
};

/** Join a measured claim to its signal's static prompt (the push body). */
const withPrompt = (id: SignalId, claim: string): string => {
  const prompt = SIGNAL_PROMPTS[id];
  return prompt ? `${claim} ${prompt}` : claim;
};

/**
 * The measured claim of a frozen body, with its push CTA removed — what a
 * narrative surface quotes. The claim itself is never altered, only unjoined:
 * an unrecognized or already-stripped body comes back trimmed and whole, so a
 * copy edit that lands before a stored fire drains degrades to today's text
 * rather than mangling it.
 */
export function stripSignalPrompt(body: string, id: SignalId): string {
  const claim = body.trim();
  const prompt = SIGNAL_PROMPTS[id];
  if (!prompt || !claim.endsWith(prompt)) return claim;
  return claim.slice(0, -prompt.length).trim();
}

/** The measured context each signal's body is built from — discriminated on the
 *  signal id so each variant carries exactly the values its sentence needs. */
export type SignalBodyContext =
  | { signalId: "cost_spike"; costUsd: number; capUsd: number }
  | { signalId: "high_burn_rate"; burnRateUsdPerMin: number; elapsedMinutes: number }
  | { signalId: "long_session"; elapsedMinutes: number }
  | { signalId: "stuck_loop"; tool: string; count: number; failing: boolean }
  | { signalId: "went_cold"; silentMinutes: number }
  | {
      signalId: "session_ended";
      durationMinutes: number;
      /** `null` when the host tool cannot price its work — the cost clause is then
       *  omitted, not fabricated as $0 (same rule as linesAdded/commits below). */
      costUsd: number | null;
      /** Best-effort (git momentum may lag) — omitted, not fabricated, when absent. */
      linesAdded?: number;
      commits?: number;
    }
  | { signalId: "daily_cost_cap"; totalUsd: number; capUsd: number }
  | { signalId: "first_error"; tool: string };

/**
 * Build the one-sentence notification body for a fired signal from its measured
 * values. Project is the notification title and `signalLabel` is the subtitle,
 * so this is purely the warm sentence — nothing fabricated, every number is a
 * real measured value the evaluator passed in.
 */
export function buildSignalBody(ctx: SignalBodyContext): string {
  switch (ctx.signalId) {
    // Cost is DERIVED (tokens x list price), never reported by the agent, so every
    // dollar here is an estimate. A lock screen has no tooltip: the hedge rides the
    // sentence or it does not reach the reader (pricing.ts COST_ESTIMATE_NOTE).
    case "cost_spike":
      return `Estimated cost is adding up. $${usd(ctx.costUsd)} so far, past the $${usd(ctx.capUsd)} mark.`;
    case "high_burn_rate":
      return ctx.elapsedMinutes > 0
        ? `Burning fast, an estimated $${usd(ctx.burnRateUsdPerMin)}/min for the last ${ctx.elapsedMinutes} minutes.`
        : `Burning fast, an estimated $${usd(ctx.burnRateUsdPerMin)}/min.`;
    case "long_session":
      return withPrompt(ctx.signalId, `Running long, ${ctx.elapsedMinutes} minutes in.`);
    case "stuck_loop":
      return ctx.failing
        ? `Stuck retrying, failed ${ctx.tool} ${ctx.count} times in a row.`
        : `Looks like a loop, ran ${ctx.tool} ${ctx.count} times in a row.`;
    case "went_cold":
      return withPrompt(ctx.signalId, `Went quiet, no activity for ${ctx.silentMinutes} minutes.`);
    case "session_ended": {
      // Duration + cost are always known at session.end; lines/commits ride git
      // momentum and may lag, so they are appended only when measured (§4 note 2).
      let body = `Wrapped: ${ctx.durationMinutes} min`;
      if (ctx.costUsd != null) body += `, about $${usd(ctx.costUsd)}`;
      if (typeof ctx.linesAdded === "number") body += `, +${ctx.linesAdded} lines`;
      if (typeof ctx.commits === "number") body += `, ${plural(ctx.commits, "commit")}`;
      return `${body}.`;
    }
    case "daily_cost_cap":
      return `Today's estimated spend hit $${usd(ctx.totalUsd)} across all projects, past your $${usd(ctx.capUsd)} cap.`;
    case "first_error":
      return withPrompt(ctx.signalId, `First snag: ${ctx.tool} just failed.`);
  }
}

// ---------------------------------------------------------------------------
// Narrative copy — the SAME measured facts, said the way a person says them
// ---------------------------------------------------------------------------

/**
 * A push body and a narrative sentence are not the same sentence.
 *
 * A push is read on a lock screen, at the moment it fires, in a glance. It is
 * rightly telegraphic: "Burning fast, an estimated $0.64/min for the last 24
 * minutes." Splice that into a paragraph and it does not read like English,
 * because it was never prose — it is a headline. That is what "A watch caught
 * seorak 8 minutes ago: burning fast, an estimated $0.64/min" was: two voices
 * jammed together, wrapped in our own internal noun for the machinery.
 *
 * So the catalog carries BOTH voices, off the same measured values. This one is
 * a past-tense clause with the SUBJECT left off, so a surface puts whatever it
 * is talking about in front: "seorak was burning about $0.64 a minute."
 *
 * Past tense on purpose. A narrative is read minutes after the fire, and the
 * claim was true THEN. The present tense a push can honestly use has expired by
 * the time anyone reads this.
 *
 * Nothing is fabricated: every number is the one the evaluator measured and the
 * push body already reported.
 */
export function buildSignalNarrative(ctx: SignalBodyContext): string {
  switch (ctx.signalId) {
    case "cost_spike":
      return `had run up about $${usd(ctx.costUsd)}, past the $${usd(ctx.capUsd)} cap you set`;
    case "high_burn_rate":
      return ctx.elapsedMinutes > 0
        ? `was burning about $${usd(ctx.burnRateUsdPerMin)} a minute, and had been for ${ctx.elapsedMinutes} minutes`
        : `was burning about $${usd(ctx.burnRateUsdPerMin)} a minute`;
    case "long_session":
      return `had been going for ${ctx.elapsedMinutes} minutes`;
    case "stuck_loop":
      return ctx.failing
        ? `looked stuck, with ${ctx.tool} failing ${ctx.count} times in a row`
        : `looked like it was looping, running ${ctx.tool} ${ctx.count} times in a row`;
    case "went_cold":
      return `went quiet, with nothing happening for ${ctx.silentMinutes} minutes`;
    case "session_ended": {
      let clause = `wrapped up after ${ctx.durationMinutes} minutes`;
      if (ctx.costUsd != null) clause += `, at about $${usd(ctx.costUsd)}`;
      if (typeof ctx.linesAdded === "number") clause += `, ${ctx.linesAdded} lines added`;
      if (typeof ctx.commits === "number") clause += `, and ${plural(ctx.commits, "commit")}`;
      return clause;
    }
    case "daily_cost_cap":
      return `crossed the $${usd(ctx.capUsd)} cap you set, at about $${usd(ctx.totalUsd)} so far`;
    case "first_error":
      return `hit its first snag, with ${ctx.tool} failing`;
  }
}

/**
 * Recover the measured values from a FROZEN body.
 *
 * The narrative voice needs the numbers, but a stored fire only kept the push
 * sentence. Re-running the evaluator is not an option: the session has moved on
 * since, so it would report a DIFFERENT claim than the one that actually fired.
 * The only honest source for what a fire claimed is the fire itself.
 *
 * So the numbers are read back out of the sentence that reported them. That is
 * safe only because build and parse sit side by side in this file and are pinned
 * by a round-trip test over every signal: parse(build(ctx)) deep-equals ctx.
 * Edit a body string and the round trip fails until you edit its pattern too.
 *
 * Null when a body does not match its signal's shape — an older fire stored
 * before a copy edit. The caller then quotes the body verbatim, which is honest.
 * Never a guessed number.
 */
export function parseSignalBody(body: string, id: SignalId): SignalBodyContext | null {
  const claim = stripSignalPrompt(body, id);
  const num = (raw: string | undefined): number => Number(String(raw).replace(/,/g, ""));

  switch (id) {
    case "cost_spike": {
      const m = claim.match(
        /^Estimated cost is adding up\. \$([\d.]+) so far, past the \$([\d.]+) mark\.$/,
      );
      return m ? { signalId: id, costUsd: num(m[1]), capUsd: num(m[2]) } : null;
    }
    case "high_burn_rate": {
      const withElapsed = claim.match(
        /^Burning fast, an estimated \$([\d.]+)\/min for the last (\d+) minutes\.$/,
      );
      if (withElapsed) {
        return {
          signalId: id,
          burnRateUsdPerMin: num(withElapsed[1]),
          elapsedMinutes: num(withElapsed[2]),
        };
      }
      const bare = claim.match(/^Burning fast, an estimated \$([\d.]+)\/min\.$/);
      return bare ? { signalId: id, burnRateUsdPerMin: num(bare[1]), elapsedMinutes: 0 } : null;
    }
    case "long_session": {
      const m = claim.match(/^Running long, (\d+) minutes in\.$/);
      return m ? { signalId: id, elapsedMinutes: num(m[1]) } : null;
    }
    case "stuck_loop": {
      const failing = claim.match(/^Stuck retrying, failed (.+) (\d+) times in a row\.$/);
      if (failing) {
        return { signalId: id, tool: failing[1]!, count: num(failing[2]), failing: true };
      }
      const looping = claim.match(/^Looks like a loop, ran (.+) (\d+) times in a row\.$/);
      return looping
        ? { signalId: id, tool: looping[1]!, count: num(looping[2]), failing: false }
        : null;
    }
    case "went_cold": {
      const m = claim.match(/^Went quiet, no activity for (\d+) minutes\.$/);
      return m ? { signalId: id, silentMinutes: num(m[1]) } : null;
    }
    case "session_ended": {
      const m = claim.match(
        /^Wrapped: (\d+) min(?:, about \$([\d.]+))?(?:, \+(\d+) lines)?(?:, (\d+) commits?)?\.$/,
      );
      if (!m) return null;
      const ctx: SignalBodyContext = {
        signalId: id,
        durationMinutes: num(m[1]),
        costUsd: m[2] === undefined ? null : num(m[2]),
      };
      if (m[3] !== undefined) ctx.linesAdded = num(m[3]);
      if (m[4] !== undefined) ctx.commits = num(m[4]);
      return ctx;
    }
    case "daily_cost_cap": {
      const m = claim.match(
        /^Today's estimated spend hit \$([\d.]+) across all projects, past your \$([\d.]+) cap\.$/,
      );
      return m ? { signalId: id, totalUsd: num(m[1]), capUsd: num(m[2]) } : null;
    }
    case "first_error": {
      const m = claim.match(/^First snag: (.+) just failed\.$/);
      return m ? { signalId: id, tool: m[1]! } : null;
    }
  }
}

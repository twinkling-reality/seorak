/**
 * narrative.ts — PURE. The terminal's whole product: what is true right now and
 * what the window holds, said as sentences, plus the door to the dashboard.
 *
 * Contract twin (web Overview lead, above the widget board):
 * packages/web/src/periodClarity/compilePeriodClarity.ts
 *
 * WHY PROSE AND NOT A GRID. The terminal used to render the web dashboard's
 * widget catalog in ANSI (same 12-column slots, same date picker, same stat
 * cells). That gave it no identity of its own and, worse, no room to qualify
 * anything: a cell can print `est. cost $4,339` but it cannot say that the total
 * excludes an unpriced model, and a cell reading `shipped 74%` cannot say the
 * rate covers only one of the two agents in the split. Both of those are true of
 * real data today. A sentence carries its own caveat; a cell cannot.
 *
 * THE SHAPE. One or two sentences for now, then the window:
 *   1. attention, or what is running, and always WHICH projects
 *   2. how much work happened, and who did it
 *   3. how deep each agent's record goes, when one is shallower than the window
 *   4. cost, and what the pricing cannot see
 *   5. whether the work held up, and which tool that actually covers
 *
 * SHORT SENTENCES, PLAIN WORDS. Each fact gets its own sentence rather than
 * being stacked into one with colons and subordinate clauses. Same facts, and
 * the honesty gates below are unchanged; it is just readable by someone who did
 * not build it. No "matured sessions", no "on the branch", no "Codex aside".
 *
 * THE BAR, applied to every sentence (docs/reference/voice-and-scope.md, and the
 * falsifiability test from MOBILE-EMPHASIS ADR-4): it must be able to be FALSE.
 * A sentence that would be true of any data is decoration and does not get
 * written. A leg with no measurement behind it is not spoken at all rather than
 * zero-filled, so the paragraph gets SHORTER on thin data instead of padding
 * itself with "--".
 */
import type { OverviewSnapshot, SessionSummary } from "@seorak/types";
import {
  agentName,
  count,
  countAtSentenceStart,
  durationPhrase,
  fmtCount,
  magnitude,
  modelName,
  monthDayPhrase,
  naturalList,
  pctPhrase,
  plural,
  projectName,
  usdPhrase,
  windowPhrase,
} from "./voice.ts";

export interface TerminalNarrative {
  /** One or two short sentences about right now. Never empty: there is always
   *  something true to say about the live board, including that it is empty. */
  now: string;
  /** Zero to five short sentences about the window. Empty when GET /overview has
   *  not answered, which the caller says in its own words rather than faking. */
  window: string[];
}

const MS_PER_DAY = 86_400_000;
/** How many project names a sentence lists before it starts counting instead.
 *  Four fits a line at every width we render at; past that the list stops being
 *  readable and the count is the more useful fact. */
const MAX_NAMED_PROJECTS = 4;

/** "seorak, orchescope, and chesstinker", or "seorak, orchescope, chesstinker,
 *  kinetic-notes, and 2 more" once the list stops being worth reading. WHERE the
 *  work is happening is the whole point of the sentence, so this counts only
 *  after it has named as many as fit, never instead of naming any. */
function projectList(sessions: readonly SessionSummary[]): string {
  const names = [...new Set(sessions.map((s) => projectName(s.project)))];
  if (names.length <= MAX_NAMED_PROJECTS) return naturalList(names);
  const shown = names.slice(0, MAX_NAMED_PROJECTS);
  return naturalList([...shown, `${names.length - MAX_NAMED_PROJECTS} more`]);
}

/**
 * nowSentence (PURE). Attention owns the opening sentence whenever anything is
 * blocked, mirroring mobile Home's precedence (blocked on you, then running,
 * then quiet). This is the terminal's whole reason to be on screen while you
 * work, so it is never omitted.
 *
 * Everything running gets NAMED. An earlier version said "and 6 other sessions
 * are still working", which told you a number you could not act on and hid the
 * one thing you could: which repos are busy.
 */
export function nowSentence(all: readonly SessionSummary[], nowMs: number): string {
  const live = all.filter((s) => s.status !== "ended");
  const blocked = live.filter((s) => s.awaitingInput);
  const working = live.filter((s) => !s.awaitingInput);

  if (blocked.length === 0) {
    if (live.length === 0) return "Nothing is running right now.";
    const verb = plural(live.length, "is", "are");
    return `${countAtSentenceStart(live.length, "session")} ${verb} running, in ${projectList(live)}. Nothing needs you.`;
  }

  const head =
    blocked.length === 1
      ? blockedClaim(blocked[0]!, nowMs)
      : `${countAtSentenceStart(blocked.length, "session")} need you, in ${projectList(blocked)}.`;
  if (working.length === 0) return head;
  const verb = plural(working.length, "is", "are");
  return `${head} ${countAtSentenceStart(working.length, "other session")} ${verb} running, in ${projectList(working)}.`;
}

/** "orchescope has been waiting on you for 2 minutes." The wait is measured from
 *  the last event, so it degrades to the plain claim when that is unreadable. */
function blockedClaim(s: SessionSummary, nowMs: number): string {
  const waitedMs = Math.max(0, nowMs - Date.parse(s.lastEventAt));
  const name = projectName(s.project);
  if (!Number.isFinite(waitedMs)) return `${name} is waiting on you.`;
  return `${name} has been waiting on you for ${durationPhrase(waitedMs / 1000)}.`;
}

/**
 * windowSentences (PURE). The window, as short plain sentences. A caveat gets
 * its own sentence when it needs one: cramming it into the claim it qualifies
 * (", Codex aside") saves a line and costs the reader more than the line is
 * worth.
 */
export function windowSentences(
  overview: OverviewSnapshot,
  nowMs: number,
  days: number,
): string[] {
  const agents = [...(overview.tools.byAgent ?? [])].sort((a, b) => b.tokensTotal - a.tokensTotal);
  return [
    ...volumeSentences(overview, agents, nowMs, days),
    ...costSentences(overview),
    ...outcomeSentences(overview, agents),
  ];
}

type AgentRow = OverviewSnapshot["tools"]["byAgent"][number];
type ProjectRow = OverviewSnapshot["usage"]["projects"][number];

/** A project the board can be focused on. */
export interface Scope {
  repoId: string;
  project: string;
}

/** How many projects ↑/↓ will cycle through before the list stops being a list
 *  and starts being a directory. The busiest ones are the ones worth reaching. */
const MAX_SCOPES = 10;

/**
 * scopeChoices (PURE). What ↑/↓ cycles through: every project with something
 * LIVE first (those are the rows on screen, and reaching them is the whole point
 * of the key), then the window's busiest projects that are not already there.
 *
 * One list rather than a different rule per view, so the key does the same thing
 * whichever form you are reading and whether or not anything is running.
 */
export function scopeChoices(
  live: readonly SessionSummary[],
  overview: OverviewSnapshot | null,
): Scope[] {
  const out: Scope[] = [];
  const seen = new Set<string>();
  const add = (repoId: string, project: string): void => {
    if (seen.has(repoId) || out.length >= MAX_SCOPES) return;
    seen.add(repoId);
    out.push({ repoId, project: projectName(project) });
  };
  for (const s of live.filter((s) => s.status !== "ended")) add(s.repoId, s.project);
  const byBusiest = [...(overview?.usage.projects ?? [])].sort((a, b) => b.sessions - a.sessions);
  for (const p of byBusiest) add(p.repoId, p.project);
  return out;
}

/** The rollup for a focused project, or null when the window holds none (a repo
 *  that is live right now but has no in-window history yet). */
export function projectRollup(overview: OverviewSnapshot, repoId: string): ProjectRow | null {
  return overview.usage.projects.find((p) => p.repoId === repoId) ?? null;
}

/** Models that ran ANYWHERE in the window with no list price. A project rollup
 *  carries no unpriced list of its own, so the global one is passed down and
 *  narrowed to what this project actually used. */
function unpricedHere(overview: OverviewSnapshot, rollup: ProjectRow): string[] {
  const unpriced = new Set((overview.usage.cost.unpricedModels ?? []).map((m) => m.model));
  return (rollup.byModel ?? []).filter((m) => unpriced.has(m.model)).map((m) => modelName(m.model));
}

/**
 * projectSentences (PURE). The same four claims, scoped to one project. Reads
 * the per-repo rollup, which the worker computes with the SAME definitions as
 * the global aggregates, so focusing changes the population and never the
 * meaning of a number.
 */
export function projectSentences(
  overview: OverviewSnapshot,
  rollup: ProjectRow,
  days: number,
): string[] {
  const out = [`In ${windowPhrase(days)} you ran ${count(rollup.sessions, "session")} in ${projectName(rollup.project)}.`];

  const agents = [...(rollup.byAgent ?? [])].sort((a, b) => b.tokensTotal - a.tokensTotal);
  const total = agents.reduce((n, a) => n + a.tokensTotal, 0);
  if (total > 0) {
    out.push(
      agents.length >= 2
        ? `That used ${magnitude(total)} tokens: ${naturalList(agents.map((a) => `${magnitude(a.tokensTotal)} from ${agentName(a.agent)}`))}.`
        : `That used ${magnitude(total)} tokens, all from ${agentName(agents[0]!.agent)}.`,
    );
  }

  if (rollup.costUsd !== null) {
    const unpriced = unpricedHere(overview, rollup);
    if (unpriced.length === 0) {
      out.push(`It cost about ${usdPhrase(rollup.costUsd)}.`);
    } else {
      out.push(`It cost at least ${usdPhrase(rollup.costUsd)}.`);
      out.push(`${naturalList(unpriced)} ${plural(unpriced.length, "has", "have")} no public price yet, so the real number is higher.`);
    }
  }

  const legs: string[] = [];
  if (rollup.shipRate !== null) legs.push(`${pctPhrase(rollup.shipRate)} of those sessions ended in a commit`);
  const ls = rollup.lineSurvival;
  if (ls && ls.rate !== null && ls.sessionsRated > 0) {
    legs.push(
      `${pctPhrase(ls.rate)} of the lines you wrote are still in your code, ` +
        `checked across ${count(ls.sessionsRated, "session")} old enough to tell`,
    );
  }
  if (legs.length > 0) out.push(`${capitalize(naturalList(legs))}.`);
  return out;
}

/** One project's row in the all-projects table. Rates stay NULLABLE all the way
 *  to the renderer: a table has a cell whether or not there is a measurement, so
 *  the honest-empty decision belongs to the thing that draws the cell. */
export interface ProjectTableRow {
  repoId: string;
  project: string;
  sessions: number;
  tokens: number;
  costUsd: number | null;
  /** True when this project used a model with no public price, so its cost is a
   *  floor. The table marks it rather than quietly under-reporting. */
  costIsFloor: boolean;
  shipRate: number | null;
  survival: number | null;
}

/**
 * projectTable (PURE). Every project in the window, busiest first, capped.
 *
 * Returns the cap alongside the rows so the renderer can SAY what it dropped.
 * A silently truncated list reads as "this is all of them", which is the same
 * class of lie as a zero-filled rate.
 */
export function projectTable(
  overview: OverviewSnapshot,
  limit: number,
): { rows: ProjectTableRow[]; total: number } {
  const unpriced = new Set((overview.usage.cost.unpricedModels ?? []).map((m) => m.model));
  const all = [...(overview.usage.projects ?? [])].sort((a, b) => b.sessions - a.sessions);
  return {
    total: all.length,
    rows: all.slice(0, limit).map((p) => ({
      repoId: p.repoId,
      project: projectName(p.project),
      sessions: p.sessions,
      tokens: p.tokensTotal,
      costUsd: p.costUsd,
      costIsFloor: (p.byModel ?? []).some((m) => unpriced.has(m.model)),
      shipRate: p.shipRate,
      survival: p.lineSurvival && p.lineSurvival.sessionsRated > 0 ? p.lineSurvival.rate : null,
    })),
  };
}

/** projectRows (PURE). The focused project as rows, mirroring projectSentences. */
export function projectRows(overview: OverviewSnapshot, rollup: ProjectRow): StatRow[] {
  const rows: StatRow[] = [{ label: "sessions", value: fmtCount(rollup.sessions) }];

  const agents = [...(rollup.byAgent ?? [])].sort((a, b) => b.tokensTotal - a.tokensTotal);
  const total = agents.reduce((n, a) => n + a.tokensTotal, 0);
  if (total > 0) {
    rows.push({
      label: "tokens",
      value: magnitude(total),
      note: agents.length >= 2
        ? agents.map((a) => `${agentName(a.agent)} ${magnitude(a.tokensTotal)}`).join(", ")
        : `all from ${agentName(agents[0]!.agent)}`,
    });
  }
  if (rollup.costUsd !== null) {
    const unpriced = unpricedHere(overview, rollup);
    rows.push(
      unpriced.length === 0
        ? { label: "cost", value: `about ${usdPhrase(rollup.costUsd)}` }
        : { label: "cost", value: `at least ${usdPhrase(rollup.costUsd)}`, note: `${naturalList(unpriced)} has no public price yet` },
    );
  }
  if (rollup.shipRate !== null) {
    rows.push({ label: "ended in a commit", value: pctPhrase(rollup.shipRate), rate: rollup.shipRate });
  }
  const ls = rollup.lineSurvival;
  if (ls && ls.rate !== null && ls.sessionsRated > 0) {
    rows.push({
      label: "lines still in your code",
      value: pctPhrase(ls.rate),
      rate: ls.rate,
      note: `across ${count(ls.sessionsRated, "session")} old enough to tell`,
    });
  }
  return rows;
}

/**
 * One measured fact, for the LIST view (`/view list`). The prose and the list
 * are two renderings of the same window, so they are built here side by side
 * rather than in separate modules: a gate that changed in one and not the other
 * would let the same board make two different claims depending on a preference.
 *
 * The honesty rule survives the change of form. A row with no measurement is not
 * emitted, exactly as its sentence would not be written, so the list gets
 * SHORTER on thin data instead of filling with "--".
 */
export interface StatRow {
  label: string;
  value: string;
  /** The caveat that would ride the sentence, kept beside the number here. */
  note?: string;
  /** The 0..1 rate behind a percent value, for the bar. Absent on non-rates. */
  rate?: number;
}

/**
 * windowRows (PURE). The same facts `windowSentences` speaks, as rows. Reads the
 * same fields through the same gates; `narrative.test.ts` pins that the two
 * agree on what is present.
 */
export function windowRows(overview: OverviewSnapshot, nowMs: number, days: number): StatRow[] {
  const agents = [...(overview.tools.byAgent ?? [])].sort((a, b) => b.tokensTotal - a.tokensTotal);
  const rows: StatRow[] = [];

  // The label already says "sessions", so the value is the bare count: a row
  // reading "sessions   81 sessions" spends a column agreeing with itself.
  rows.push({
    label: "sessions",
    value: fmtCount(overview.usage.totals.sessions),
    note: `across ${count(overview.usage.projects.length, "project")}`,
  });

  const totalTokens = agents.reduce((n, a) => n + a.tokensTotal, 0);
  if (totalTokens > 0) {
    const split = agents.map((a) => `${agentName(a.agent)} ${magnitude(a.tokensTotal)}`).join(", ");
    rows.push({ label: "tokens", value: magnitude(totalTokens), note: agents.length >= 2 ? split : `all from ${agentName(agents[0]!.agent)}` });
    const shallow = shallowRecords(agents, nowMs, days);
    const since = shallow[0]?.firstSeenAt ? monthDayPhrase(shallow[0].firstSeenAt) : null;
    if (since && shallow.length < agents.length) {
      rows.push({ label: "watched since", value: since, note: `${naturalList(shallow.map((a) => agentName(a.agent)))} only` });
    }
  }

  const c = overview.usage.cost;
  if (c.totalUsd !== null && c.sessionsWithCost > 0) {
    const unpriced = (c.unpricedModels ?? []).map((m) => modelName(m.model));
    rows.push(
      unpriced.length === 0
        ? { label: "cost", value: `about ${usdPhrase(c.totalUsd)}` }
        : { label: "cost", value: `at least ${usdPhrase(c.totalUsd)}`, note: `${naturalList(unpriced)} has no public price yet` },
    );
  }

  const blind = agents.filter((a) => !a.capabilities.endReason).map((a) => agentName(a.agent));
  const scope = blind.length > 0 && blind.length < agents.length ? "Claude Code only" : undefined;
  const { shipRate, lineSurvival } = overview.outcomes;
  if (shipRate !== null) {
    rows.push({ label: "ended in a commit", value: pctPhrase(shipRate), rate: shipRate, ...(scope ? { note: scope } : {}) });
  }
  if (lineSurvival.rate !== null && lineSurvival.sessionsRated > 0) {
    const checked = `across ${count(lineSurvival.sessionsRated, "session")} old enough to tell`;
    rows.push({
      label: "lines still in your code",
      value: pctPhrase(lineSurvival.rate),
      rate: lineSurvival.rate,
      note: scope ? `${checked}, ${scope}` : checked,
    });
  }
  return rows;
}

/** One live session, for the list view: which project, what state, how long. */
export interface LiveRow {
  project: string;
  state: string;
  /** True for a blocked session, so the renderer can mark the row. */
  needsYou: boolean;
}

/** liveRows (PURE). The live board as rows, blocked first (the same precedence
 *  `nowSentence` speaks), then longest-running. */
export function liveRows(all: readonly SessionSummary[], nowMs: number): LiveRow[] {
  return all
    .filter((s) => s.status !== "ended")
    .map((s) => {
      const sinceMs = Math.max(0, nowMs - Date.parse(s.lastEventAt));
      const waited = Number.isFinite(sinceMs) ? durationPhrase(sinceMs / 1000) : null;
      return {
        project: projectName(s.project),
        state: s.awaitingInput ? (waited ? `waiting on you for ${waited}` : "waiting on you") : "running",
        needsYou: s.awaitingInput === true,
      };
    })
    .sort((a, b) => Number(b.needsYou) - Number(a.needsYou));
}

/** How much work happened, then who did it, then how far back each agent's
 *  record actually reaches. Three short sentences rather than one stacked with
 *  clauses: the facts are unchanged, the reading is not.
 *
 *  The record-depth sentence is the one that stops "I barely use Codex" being
 *  read off a window Codex was only watched for part of, the same fact the web's
 *  Agents record rail draws. */
function volumeSentences(
  overview: OverviewSnapshot,
  agents: readonly AgentRow[],
  nowMs: number,
  days: number,
): string[] {
  const sessions = count(overview.usage.totals.sessions, "session");
  const projects = count(overview.usage.projects.length, "project");
  const out = [`In ${windowPhrase(days)} you ran ${sessions} across ${projects}.`];

  const totalTokens = agents.reduce((n, a) => n + a.tokensTotal, 0);
  if (totalTokens === 0) return out;

  if (agents.length >= 2) {
    const split = naturalList(agents.map((a) => `${magnitude(a.tokensTotal)} from ${agentName(a.agent)}`));
    out.push(`That used ${magnitude(totalTokens)} tokens: ${split}.`);
    const shallow = shallowRecords(agents, nowMs, days);
    const since = shallow[0]?.firstSeenAt ? monthDayPhrase(shallow[0].firstSeenAt) : null;
    if (since && shallow.length < agents.length) {
      const who = naturalList(shallow.map((a) => agentName(a.agent)));
      out.push(
        `Seorak only started watching ${who} on ${since}, so ${plural(shallow.length, "that share is", "those shares are")} smaller than ${plural(shallow.length, "it", "they")} really would be.`,
      );
    }
  } else {
    out.push(`That used ${magnitude(totalTokens)} tokens, all from ${agentName(agents[0]!.agent)}.`);
  }
  return out;
}

/** Agents whose record demonstrably STARTS inside the window. An agent with no
 *  `firstSeenAt` (a pre-field worker) is left out: unknown depth is not shallow
 *  depth, and claiming it would invent the caveat rather than report it. */
function shallowRecords(agents: readonly AgentRow[], nowMs: number, days: number): AgentRow[] {
  const windowStart = nowMs - days * MS_PER_DAY;
  return agents.filter((a) => {
    if (!a.firstSeenAt) return false;
    const t = Date.parse(a.firstSeenAt);
    return Number.isFinite(t) && t > windowStart;
  });
}

/** Cost, and never a bare total when the pricing is partial. `costPartial` with
 *  a populated `unpricedModels` means real tokens ran through a model with no
 *  list price, so the number in hand is a FLOOR. A stat cell had no way to say
 *  that and printed the floor as if it were the figure.
 *
 *  Leads with the number and the word "at least", rather than opening on what
 *  Seorak can or cannot do: the reader wants the spend, not our plumbing. */
function costSentences(overview: OverviewSnapshot): string[] {
  const c = overview.usage.cost;
  if (c.totalUsd === null || c.sessionsWithCost === 0) return [];
  const unpriced = (c.unpricedModels ?? []).map((m) => modelName(m.model));
  if (unpriced.length === 0) return [`That cost about ${usdPhrase(c.totalUsd)}.`];
  return [
    `It cost at least ${usdPhrase(c.totalUsd)}.`,
    `${naturalList(unpriced)} ${plural(unpriced.length, "has", "have")} no public price yet, so the real number is higher.`,
  ];
}

/** Did the work hold up. Only legs with real measurements are named, and the
 *  scope is said out loud when an agent in the split cannot back them: Codex
 *  writes no session-end record, so ship rate and line survival are Claude Code
 *  only, and a blended-looking percent would quietly overclaim its coverage.
 *
 *  The scope used to ride the same sentence as ", Codex aside", which is four
 *  words the reader has to decode mid-claim. It is now its own plain sentence
 *  saying which tool the numbers cover and why. */
function outcomeSentences(overview: OverviewSnapshot, agents: readonly AgentRow[]): string[] {
  const legs: string[] = [];
  const { shipRate, lineSurvival } = overview.outcomes;
  if (shipRate !== null) legs.push(`${pctPhrase(shipRate)} of those sessions ended in a commit`);
  if (lineSurvival.rate !== null && lineSurvival.sessionsRated > 0) {
    legs.push(
      `${pctPhrase(lineSurvival.rate)} of the lines you wrote are still in your code, ` +
        `checked across ${count(lineSurvival.sessionsRated, "session")} old enough to tell`,
    );
  }
  if (legs.length === 0) return [];

  const out = [`${capitalize(naturalList(legs))}.`];
  const blind = agents.filter((a) => !a.capabilities.endReason).map((a) => agentName(a.agent));
  if (blind.length > 0 && blind.length < agents.length) {
    const who = naturalList(blind);
    out.push(
      `Both numbers cover Claude Code only, because ${who} never ${plural(blind.length, "reports", "report")} when a session ends.`,
    );
  }
  return out;
}

/** Sentence case for a clause that was built to sit mid-sentence. */
function capitalize(s: string): string {
  return s.length === 0 ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}

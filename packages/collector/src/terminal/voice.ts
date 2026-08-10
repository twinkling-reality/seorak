/**
 * voice.ts — PURE phrase primitives for the terminal's narrative surface. A port
 * of the same small vocabulary the phone carries (`apps/mobile/src/lib/voice.ts`),
 * which is itself a port of the web's answer voice (`packages/web/src/lib/voice/`).
 *
 * PORTED, not shared, and deliberately so: the collector depends on
 * `@seorak/types` plus npm and nothing else, so it cannot import from web or
 * mobile. Mobile already set this precedent. The rules these encode are the
 * cross-surface ones (docs/reference/voice-and-scope.md), so the three copies
 * should agree in behaviour even though they cannot share code.
 *
 * The rules, in one place:
 *   - full sentences in second person, warm and plain
 *   - no middot, and no em dash: commas, "and", or a new sentence
 *   - the window is spelled ("the last 7 days"), never "7d", in prose
 *   - a sentence that OPENS with a count spells it ("Two sessions"), because a
 *     leading numeral reads like a log line
 *   - digits are welcome mid-sentence: a number is what makes a claim
 *     falsifiable, which is the bar every sentence here has to clear
 */

/** Thousands-grouped integer: "17,576". Pinned to en-US rather than the host
 *  locale so a rendered sentence is identical on every machine (and in tests). */
export function fmtCount(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Pluralize a noun by count. Pass an irregular plural when "+s" is wrong. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** "1 session" / "17,576 tool calls" — a count with an agreeing noun. */
export function count(n: number, one: string, many?: string): string {
  return `${fmtCount(n)} ${plural(n, one, many)}`;
}

const SPELLED = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** A count that OPENS a sentence: "Two sessions", not "2 sessions". Ten and up
 *  stay as digits, where spelling them out would read worse than the numeral. */
export function countAtSentenceStart(n: number, one: string, many?: string): string {
  const word = n >= 0 && n < SPELLED.length ? SPELLED[n]! : fmtCount(n);
  return `${word.charAt(0).toUpperCase()}${word.slice(1)} ${plural(n, one, many)}`;
}

/** A spoken list: "a", "a and b", "a, b, and c". Never middot-joined. */
export function naturalList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** The one spelled window phrase: "the last 7 days". */
export function windowPhrase(days: number): string {
  return `the last ${days} days`;
}

/** A magnitude for a quantity whose exact digits carry nothing: "42.5M", "29k".
 *  Used for token counts, where the reader wants the size and not the number. */
export function magnitude(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return fmtCount(n);
}

/** Money for prose. Under $100 keeps cents, because that is a number a person
 *  reads exactly; at and above it, cents are false precision on an ESTIMATE. */
export function usdPhrase(n: number): string {
  return n >= 100 ? `$${fmtCount(n)}` : `$${n.toFixed(2)}`;
}

/** A measured rate as a whole percent. Callers gate null upstream: a sentence
 *  about a missing rate is never written, so this takes a number. */
export function pctPhrase(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** A duration spelled for prose: "under a minute", "42 minutes", "1 hour 12
 *  minutes". Never "42m", which is a row value, not something a person says. */
export function durationPhrase(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "an unknown time";
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return "under a minute";
  if (mins < 60) return count(mins, "minute");
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? count(hours, "hour") : `${count(hours, "hour")} ${count(rest, "minute")}`;
}

/** "July 12" for a record's start date. UTC so the sentence does not shift under
 *  the reader's timezone, and en-US so it is stable across machines. */
export function monthDayPhrase(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/** "" repo labels read as "an unlabeled project" mid-sentence, never blank. */
export function projectName(project: string): string {
  return project.trim() ? project : "an unlabeled project";
}

const AGENT_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

/** The agent's spoken name. An unknown id passes through rather than being
 *  guessed at or hidden, so a new adapter reads as itself until it is named. */
export function agentName(id: string): string {
  return AGENT_NAMES[id] ?? id;
}

const MODEL_ID = /^claude-([a-z]+)-(\d+(?:-\d+)?)(?:-\d{8})?$/;

/** "claude-opus-5" becomes "Claude Opus 5". A port of the web's
 *  `formatModelLong` (packages/web/src/lib/modelMeta.ts): prose keeps the vendor,
 *  which starts mattering the moment a second tool puts a non-Claude model in the
 *  same sentence. An id we do not recognise passes through unchanged rather than
 *  being mangled into something that looks like a name but is not one. */
export function modelName(id: string): string {
  const m = MODEL_ID.exec(id);
  if (!m) return id;
  const family = `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)}`;
  return `Claude ${family} ${m[2]!.replace("-", ".")}`;
}

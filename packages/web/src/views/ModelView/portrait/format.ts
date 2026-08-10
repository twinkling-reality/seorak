/** Shared phrasing helpers for the portrait producers. Copy rules live in
 *  docs/reference/voice-and-scope.md: no middot separators, and no measured rate
 *  in the hero prose — a percentage belongs in a card citation, never the read. */

/** Card evidence is the only place a measured rate appears (never the prose). */
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Plain-language list with commas and "and" — no middot separators. */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** "a" or "an" for a word the caller does not control. The daypart lead used to
 *  hardcode "an", which was right for evening and afternoon and wrong the moment
 *  the read could say morning or night. */
export function article(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word.trim()) ? 'an' : 'a';
}

/**
 * Whether the leading share is an actual MAJORITY, which is the only thing the
 * word "mostly" is allowed to mean.
 *
 * Producers gate their copy on this rather than on the threshold that decides
 * whether to speak at all. The two are different questions: a language at 34% of
 * edit calls is worth naming and is not "most" of anything, and a portrait that
 * calls it "mostly TypeScript" has overclaimed in the one sentence a reader is
 * most likely to check against their own memory. Strict, so an exact 50/50 split
 * is a plurality and not a majority.
 */
export function isMajority(share: number | null): boolean {
  return share !== null && share > 0.5;
}

/**
 * The prior adjacent window, said the way a person says it.
 *
 * `lib/voice.priorWindowPhrase` renders "the 30 days before", which is exact and
 * carries a DIGIT — and no measured number may appear in the hero prose (the
 * compiler warns on it in dev). These are the same three windows named in words.
 * The card still cites the exact comparison, so the rounding costs a reader
 * nothing they cannot check.
 */
export function priorWindowWord(rangeDays: 7 | 30 | 90): string {
  if (rangeDays === 7) return 'the week before';
  if (rangeDays === 90) return 'the quarter before';
  return 'the month before';
}

/** The same window as a bare noun, for a card that says "compared against the
 *  month immediately before this one". Lifted out of `daypartShift`, which built
 *  it by stripping the phrase above with two regexes — the trend card needed the
 *  identical string and would otherwise have carried a third copy of the strip. */
export function priorWindowNoun(rangeDays: 7 | 30 | 90): string {
  if (rangeDays === 7) return 'week';
  if (rangeDays === 90) return 'quarter';
  return 'month';
}

const LANGUAGE_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  tsx: 'TypeScript',
  javascript: 'JavaScript',
  jsx: 'JavaScript',
  rust: 'Rust',
  python: 'Python',
  go: 'Go',
  css: 'CSS',
  html: 'HTML',
  json: 'JSON',
  markdown: 'Markdown',
  shell: 'Shell',
  sql: 'SQL',
  swift: 'Swift',
  ruby: 'Ruby',
  java: 'Java',
};

export function languageDisplayName(language: string): string {
  const key = language.toLowerCase();
  return LANGUAGE_NAMES[key] ?? language.charAt(0).toUpperCase() + language.slice(1);
}

/**
 * How far a leading share sits above the unremarkable case, on 0–1.
 *
 * "Unremarkable" is an even split across however many things could have won, so
 * a language leading 50% of thirteen languages is far more concentrated than a
 * daypart leading 50% of four. Without normalising by the field size, every
 * facet's raw share would be compared against every other's and the widest
 * partition would always look most interesting.
 */
export function concentration(share: number | null, categories: number): number {
  if (share === null || categories <= 1) return 0.5;
  // Clamped, because past a handful of categories the even-split baseline goes to
  // nothing and EVERY leader starts to look concentrated. Unclamped, a developer
  // with a thirteen-language tail scored "you worked most often in TypeScript" —
  // the single most obvious sentence on the page — above "you've been an
  // afternoon developer", purely because thirteen is a bigger number than four.
  // A long tail of things you barely touched is not evidence that the thing you
  // did touch is interesting.
  const even = 1 / Math.min(categories, 6);
  if (share <= even) return 0;
  return Math.min(1, (share - even) / (1 - even));
}


/**
 * The most concentrated of a sentence's half-measurements, ignoring the halves
 * this window could not measure at all.
 *
 * `concentration` returns 0.5 for a null share, which is the right default for a
 * producer that has no opinion and the WRONG term inside a `Math.max` over two
 * halves. The craft sentence took exactly that max, and on the owner's live
 * window its work-type half was silent — `other` led the branch names, which is
 * never spoken — so the absent half scored 0.5, beat the tool half's measured
 * 0.35, and pushed "you spent more of it running commands and reading" past the
 * rhythm sentence into the read. A facet ranked HIGHER for having less to say,
 * and it took the opening claim of the whole page with it.
 *
 * The two cases are also not the same case, and the old default collapsed them:
 *
 *  - **unmeasurable** (`share === null`) contributes nothing and is skipped;
 *  - **trivially concentrated** (one category) scores ZERO, because a leader that
 *    beat nothing is the least interesting thing a window can contain. Every
 *    producer that comments on this says so — "neither is one repo at 100%,
 *    because there was nothing to choose between" — and every one of them was
 *    getting 0.5 back instead.
 *
 * With nothing measured at all it falls through to the same 0.5 a producer with
 * no opinion gets.
 */
export function bestConcentration(
  parts: ReadonlyArray<{ share: number | null; categories: number }>,
): number {
  const measured = parts
    .filter((p) => p.share !== null)
    .map((p) => (p.categories <= 1 ? 0 : concentration(p.share, p.categories)));
  return measured.length > 0 ? Math.max(...measured) : 0.5;
}

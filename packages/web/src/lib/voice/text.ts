/**
 * Voice primitives — pure strings. No React, no web dependency, so this layer
 * can lift toward shared code if mobile/terminal ever want the same voice.
 */
import { fmtCount } from '../../widgets/utils.js';
import { WARM, type VoiceConfig } from './tone.js';

/** Pluralize a noun by count. Pass an irregular plural when "+s" is wrong
 *  (`plural(n, 'kind', 'kinds')` is fine; `plural(n, 'is', 'are')` handles verbs). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** "1 session" / "3 sessions" — a locale-grouped count with an agreeing noun.
 *  The one sanctioned way to render "N <unit>" in copy, so a hand-written
 *  "across 1 sessions" cannot recur. */
export function count(n: number, one: string, many?: string): string {
  return `${fmtCount(n)} ${plural(n, one, many)}`;
}

/** A spoken list: "a", "a and b", "a, b, and c". Never middot-joined. */
export function naturalList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** The one spelled window phrase: "the last 30 days" (rule 3). */
export function windowPhrase(days: number, cfg: VoiceConfig = WARM): string {
  return cfg.windowPhrase(days);
}

/** The prior comparison window: "the 30 days before". */
export function priorWindowPhrase(days: number, cfg: VoiceConfig = WARM): string {
  return cfg.priorWindowPhrase(days);
}

/** Rate as a percent string, e.g. "84%". Consolidates the per-view `fmtPct`. */
export function fmtPct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

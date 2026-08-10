// Pure display logic for the WS3 on-branch line-survival render (the `line-survival`
// rollup tile + the `session-outcomes` "outcome pending → fate" card). Render-free
// and router-free on purpose, so the honesty-critical rules — never fabricate a 0,
// neutral fate vocabulary, an honest maturity countdown — are unit-testable without
// a DOM. The React bodies in OutcomeWidgets.tsx import from here.
import type { SessionOutcomeRow } from '@seorak/types';
import { formatRelativeTime } from '../../lib/relativeTime.js';

/** The fixed maturation rung the collector re-checks authored lines at (the closed
 *  enum "3d"; the wall-clock default is 3 days, env-tunable on the machine). Phrases
 *  the per-session "matures in N days" countdown honestly. */
export const LINE_SURVIVAL_HORIZON_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** rate (0..1) → display %, or the honest "--" when the rate is null (below the
 *  3-commit floor / before any check lands). NEVER fabricates a 0 — a returned
 *  "0%" only happens for a GENUINE measured zero (everything rated changed back). */
export function formatLineSurvivalRate(rate: number | null): string {
  return rate == null ? '--' : `${Math.round(rate * 100)}%`;
}

/** Per-session outcome status → a NEUTRAL label + two tones. Anti-grade (R6):
 *  survival is PERSISTENCE, not quality. `overwritten` ("changed back") is NEUTRAL
 *  (--muted), NEVER danger/red — a low rate is "more changed back", never "bad
 *  work". `unreachable`/`unknown` are the rewrite-family fates the rate excludes,
 *  DE-EMPHASIZED.
 *
 *  `color` is the DOT / bar tone: `retained` carries the one gentle --success dot
 *  (a subtle persistence affordance), the excluded fates a faint --ghost. The LABEL
 *  (`textColor`) is NEVER graded by hue, though — a green fate WORD reads as a
 *  pass/fail status (color-as-status), which the Ambient Instrument forbids. So the
 *  resolved fates render in legible --ink and the de-emphasized ones in --soft; the
 *  fate word carries its meaning in text, never in color. */
export const OUTCOME_STATUS_META: Record<
  SessionOutcomeRow['status'],
  { label: string; color: string; textColor: string }
> = {
  pending: { label: 'pending', color: 'var(--soft)', textColor: 'var(--soft)' },
  retained: { label: 'still in code', color: 'var(--success)', textColor: 'var(--ink)' },
  overwritten: { label: 'changed back', color: 'var(--muted)', textColor: 'var(--muted)' },
  unreachable: { label: 'rewritten', color: 'var(--ghost)', textColor: 'var(--soft)' },
  unknown: { label: 'unknown', color: 'var(--ghost)', textColor: 'var(--soft)' },
};

/** The secondary timing line for one outcome row. PENDING reads as a countdown to
 *  the 3d check ("matures in N days"), or "awaiting check" once the horizon has
 *  passed with no rung yet (honest — the fate is genuinely not in yet, NEVER a
 *  fabricated outcome). A resolved fate reads "ended N ago". `now` is injectable
 *  for tests (the pending branch only). */
export function outcomeTimingCopy(
  endedAt: string,
  status: SessionOutcomeRow['status'],
  now: number = Date.now(),
): string {
  if (status === 'pending') {
    const endedMs = Date.parse(endedAt);
    if (Number.isNaN(endedMs)) return 'pending';
    const dueMs = endedMs + LINE_SURVIVAL_HORIZON_DAYS * DAY_MS - now;
    if (dueMs <= 0) return 'awaiting check';
    const days = Math.ceil(dueMs / DAY_MS);
    return `matures in ${days}d`;
  }
  const rel = formatRelativeTime(endedAt);
  return rel ? `ended ${rel}` : '';
}

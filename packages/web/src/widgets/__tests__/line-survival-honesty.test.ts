import { describe, expect, it } from 'vitest';
import { WIDGET_CATALOG, getWidget, FULL_WIDGET_IDS } from '../catalog/index.js';
import {
  LINE_SURVIVAL_HORIZON_DAYS,
  OUTCOME_STATUS_META,
  outcomeTimingCopy,
  formatLineSurvivalRate,
} from '../bodies/lineSurvival.js';

// Honesty guard for the WS3 on-branch line-survival render (OUTCOME-ATTRIBUTION):
// the rollup tile + the per-session "outcome pending → fate" card. These cover the
// honesty-critical logic the generic catalog-copy-honesty guard does NOT:
//   - the rate NEVER fabricates a 0 / flat line ("--" empties only);
//   - the per-session fate vocabulary is NEUTRAL (persistence, not a grade) — a
//     "changed back" outcome is never tinted danger/red;
//   - the "matures in N days" countdown / "awaiting check" overdue copy is honest,
//     never a fabricated outcome before the check lands.

const DAY_MS = 24 * 60 * 60 * 1000;

describe('formatLineSurvivalRate — "--" empties only, never a fabricated 0', () => {
  it('null rate (below the floor / before any check) renders "--", NOT 0%', () => {
    expect(formatLineSurvivalRate(null)).toBe('--');
    expect(formatLineSurvivalRate(null)).not.toBe('0%');
  });

  it('a GENUINE measured zero renders an honest "0%" (everything rated changed back)', () => {
    // 0 is honest here — it is a measured rate over >=3 rated commits, not a
    // stand-in for missing data (which is null → "--").
    expect(formatLineSurvivalRate(0)).toBe('0%');
  });

  it('rounds a real rate to a whole percent', () => {
    expect(formatLineSurvivalRate(0.82)).toBe('82%');
    expect(formatLineSurvivalRate(1)).toBe('100%');
    expect(formatLineSurvivalRate(0.005)).toBe('1%');
  });
});

describe('OUTCOME_STATUS_META — neutral fate vocabulary (anti-grade)', () => {
  it('carries every status the contract can emit', () => {
    expect(Object.keys(OUTCOME_STATUS_META).sort()).toEqual(
      ['overwritten', 'pending', 'retained', 'unknown', 'unreachable'].sort(),
    );
  });

  it('"changed back" (overwritten) is NEUTRAL — never danger/red, never warn', () => {
    // Persistence, not quality: a low survival outcome is "more changed back", never
    // "bad work". So overwritten must not borrow a failure/alarm tone.
    expect(OUTCOME_STATUS_META.overwritten.color).not.toBe('var(--danger)');
    expect(OUTCOME_STATUS_META.overwritten.color).not.toBe('var(--warn)');
  });

  it('only "still in code" (retained) carries the success tone', () => {
    expect(OUTCOME_STATUS_META.retained.color).toBe('var(--success)');
    // The rewrite-family fates the rate excludes get a faint DOT (honest-empty
    // de-emphasis), not graded.
    expect(OUTCOME_STATUS_META.unreachable.color).toBe('var(--ghost)');
    expect(OUTCOME_STATUS_META.unknown.color).toBe('var(--ghost)');
  });

  it('every status LABEL stays legible — a fate word is never rendered invisible', () => {
    // De-emphasis lives on the dot, never on the label text: --ghost (~3.5% opacity)
    // as a text foreground would HIDE the fate, not honestly surface it. So the
    // rewrite family keeps a faint dot but a readable label tone.
    for (const meta of Object.values(OUTCOME_STATUS_META)) {
      expect(meta.textColor).not.toBe('var(--ghost)');
    }
    expect(OUTCOME_STATUS_META.unreachable.textColor).toBe('var(--soft)');
    expect(OUTCOME_STATUS_META.unknown.textColor).toBe('var(--soft)');
  });

  it('no fate LABEL is tinted by a graded hue — color-as-status forbidden', () => {
    // The success/danger/warn hue may live on the DOT (a subtle affordance) but
    // never on the fate WORD: a green "still in code" or red word reads as a
    // pass/fail grade. Labels carry meaning in text; hue stays neutral ink/soft.
    const gradedHues = ['var(--success)', 'var(--danger)', 'var(--warn)'];
    for (const meta of Object.values(OUTCOME_STATUS_META)) {
      expect(gradedHues, `graded label hue on "${meta.label}"`).not.toContain(meta.textColor);
    }
    // retained is the prominent, resolved fate — legible ink, not a green grade.
    expect(OUTCOME_STATUS_META.retained.textColor).toBe('var(--ink)');
  });

  it('no label uses HR/grade vocabulary (persistence, not quality)', () => {
    const banned = /\b(bad|fail(ed|ure)?|wrong|loss|lost|poor|good|great|win|success|quality)\b/i;
    for (const meta of Object.values(OUTCOME_STATUS_META)) {
      expect(meta.label.trim().length).toBeGreaterThan(0);
      expect(meta.label).toBe(meta.label.toLowerCase());
      expect(banned.test(meta.label), `graded label "${meta.label}"`).toBe(false);
    }
  });
});

describe('outcomeTimingCopy — honest maturity countdown, never a premature verdict', () => {
  const now = Date.parse('2026-06-16T12:00:00.000Z');
  const endedAgo = (days: number) => new Date(now - days * DAY_MS).toISOString();

  it('the horizon matches the collector rung', () => {
    expect(LINE_SURVIVAL_HORIZON_DAYS).toBe(3);
  });

  it('pending counts DOWN to the 3d check', () => {
    expect(outcomeTimingCopy(endedAgo(0.5), 'pending', now)).toBe('matures in 3d');
    expect(outcomeTimingCopy(endedAgo(2.9), 'pending', now)).toBe('matures in 1d');
  });

  it('pending past the horizon reads "awaiting check" — NOT a fabricated fate', () => {
    expect(outcomeTimingCopy(endedAgo(3), 'pending', now)).toBe('awaiting check');
    expect(outcomeTimingCopy(endedAgo(5), 'pending', now)).toBe('awaiting check');
  });

  it('an unparseable endedAt degrades to a bare "pending", never a crash or a fate', () => {
    expect(outcomeTimingCopy('not-a-date', 'pending', now)).toBe('pending');
  });

  it('a resolved fate reads "ended N ago" (relative to real now)', () => {
    const endedAt = new Date(Date.now() - 4 * DAY_MS).toISOString();
    expect(outcomeTimingCopy(endedAt, 'retained')).toBe('ended 4d ago');
    expect(outcomeTimingCopy(endedAt, 'overwritten')).toBe('ended 4d ago');
  });
});

describe('catalog wiring — coexist, line-survival leads', () => {
  it('line-survival is a fed outcomes stat (not locked / not-available)', () => {
    const def = getWidget('line-survival');
    expect(def, 'line-survival missing from catalog').toBeDefined();
    expect(def?.category).toBe('outcomes');
    expect(def?.viz).toBe('stat');
    expect(def?.availability ?? 'available').toBe('available');
  });

  it('the full cockpit promotes line-survival', () => {
    expect(FULL_WIDGET_IDS).toContain('line-survival');
  });

  it('line-survival is the ONE durability headline, beside ship-rate', () => {
    expect(FULL_WIDGET_IDS).toContain('ship-rate');
    // The retired commit-reachability tile is gone from the catalog entirely.
    expect(getWidget('survival')).toBeUndefined();
  });

  it('line-survival copy is persistence-framed (anti-grade), never a quality verdict', () => {
    const def = getWidget('line-survival');
    const text = `${def?.name} ${def?.description}`;
    expect(/changed back/i.test(text)).toBe(true);
    expect(/never bad/i.test(text)).toBe(true);
    expect(/quality|grade\b/i.test(text)).toBe(false);
  });

  it('line-survival carries non-empty honest copy (belt-and-suspenders vs the generic guard)', () => {
    const def = WIDGET_CATALOG.find((d) => d.id === 'line-survival');
    expect(def?.name.trim().length).toBeGreaterThan(0);
    expect(def?.description.trim().length).toBeGreaterThan(0);
  });
});

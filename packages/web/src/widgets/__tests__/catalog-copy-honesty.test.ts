import { describe, expect, it } from 'vitest';
import { WIDGET_CATALOG } from '../catalog/index.js';

/**
 * Regression guard for the copy classes a 2026-06-15 naming/content audit found
 * across the widget catalog (9 stale-retention hits + a dev-history leak). The
 * D1 event log IS retained in production, so user-facing catalog copy must never:
 *   - tell a buyer a tile is blocked on "the event log retaining / persisting"
 *     (honest framing is "fills in as <rows> accrue in this window");
 *   - call a live tile "locked";
 *   - leak internal dev-history into buyer copy;
 *   - use banned HR/marketing voice (CLAUDE.md §Voice).
 *
 * Scope is the canonical user-facing strings only — `name` + `description`. Code
 * comments may honestly describe the source ("from the retained event log"), so
 * they are deliberately NOT in scope here.
 */
const BANNED_USER_FACING: { pattern: RegExp; why: string }[] = [
  { pattern: /event log\s+(retain|persist|land)/i, why: 'stale: the event log is retained in production' },
  { pattern: /retains session history/i, why: 'stale retention framing' },
  { pattern: /session capture retains/i, why: 'stale retention framing' },
  { pattern: /retained event log/i, why: 'stale: implies retention is pending; frame as accrual' },
  { pattern: /until the worker persists/i, why: 'stale: the worker persists the log' },
  { pattern: /needs a retained event log/i, why: 'stale retention framing' },
  { pattern: /locked (tile|because)/i, why: 'a live tile is not "locked"' },
  { pattern: /deliberate reversal|earlier refusal|the founder\b|item-\d/i, why: 'internal dev-history leaked into buyer copy' },
  { pattern: /performance management|supercharge|reimagine|unleash|future of/i, why: 'banned voice (HR/marketing)' },
  // CLAUDE.md hard rule 5 + agent-standards §5: the user-facing noun is "stat",
  // never "signal", and no middot (·) joins facts in dashboard copy.
  { pattern: /\bsignal(s|led|ling|ed|ing)?\b/i, why: 'user-facing noun is "stat", not "signal" (CLAUDE.md hard rule 5)' },
  { pattern: /·/, why: 'no middot separators in user-facing copy (agent-standards §5)' },
];

describe('catalog copy honesty (regression guard)', () => {
  it.each(WIDGET_CATALOG.map((d) => [d.id, d.name, d.description] as const))(
    '%s name + description carry no stale-retention / dev-leak / banned-voice copy',
    (id, name, description) => {
      const text = `${name} ${description}`;
      for (const { pattern, why } of BANNED_USER_FACING) {
        expect(pattern.test(text), `${id}: ${why} - "${text}"`).toBe(false);
      }
    },
  );

  it.each(WIDGET_CATALOG.map((d) => [d.id, d.name, d.description] as const))(
    '%s name + description use concise dashboard punctuation',
    (id, name, description) => {
      const text = `${name} ${description}`;
      expect(text, `${id}: use periods or commas instead of dash-heavy phrasing`).not.toMatch(
        /[—–]/,
      );
      expect(text, `${id}: avoid formula glyphs in catalog copy`).not.toMatch(/[÷]/);
    },
  );

  it('every catalog entry has a non-empty name and description', () => {
    for (const def of WIDGET_CATALOG) {
      expect(def.name.trim().length, `${def.id} has empty name`).toBeGreaterThan(0);
      expect(def.description.trim().length, `${def.id} has empty description`).toBeGreaterThan(0);
    }
  });
});

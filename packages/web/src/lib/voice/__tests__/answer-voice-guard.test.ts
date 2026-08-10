import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guard for the detail-view answer voice (docs/reference/voice-and-scope.md).
 * These bug classes were killed structurally by the voice primitives; this test
 * fails if an answer file reintroduces them by hand instead of composing from
 * `lib/voice`. Vitest runs from packages/web, so paths are repo-relative.
 */
const PANEL_ROOT = 'src/views/OverviewView';
const SHARED_ANSWERS = [
  'src/lib/detail/periodDeltaAnswer.tsx',
  'src/lib/detail/modelSpend.tsx',
];

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkTsx(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Drop block and line comments so we test only rendered copy, not code notes
 *  (comments legitimately say "this period surface"). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

const FILES = [...walkTsx(PANEL_ROOT), ...SHARED_ANSWERS];

describe('answer voice guard', () => {
  it('covers every detail-view answer file', () => {
    // Sanity: if the tree moves, fail loud rather than guarding nothing.
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('no rendered copy uses the house-jargon deictic "this window" / "this period"', () => {
    const offenders = FILES.filter((f) => /this window|this period/i.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders, `use windowPhrase(rangeDays) instead in: ${offenders.join(', ')}`).toEqual([]);
  });

  it("no answer hand-rolls noun pluralization (=== 1 ? 'x' : 'xs')", () => {
    // JSX branches like `=== 1 ? <>...` are semantic, not noun plurals, so we
    // only flag the string-literal form the primitives replace.
    const offenders = FILES.filter((f) =>
      /=== 1 \?\s*'[^']*'\s*:\s*'[^']*'/.test(stripComments(readFileSync(f, 'utf8'))),
    );
    expect(offenders, `use count/countMetric instead in: ${offenders.join(', ')}`).toEqual([]);
  });
});

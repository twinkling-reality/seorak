import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * DA-01 guard: the verification surfaces must not render passRate as a pass rate
 * YET. The reason changed on 2026-07-09; the ban did not.
 *
 * OLD reason (now false): "a pass is unmeasurable on Claude Code." It is
 * measurable. Which-hook-fired IS the result signal — PostToolUse fires only on
 * exit 0, a non-zero exit routes to PostToolUseFailure (anthropics/claude-code#6371,
 * closed "not planned") — and the collector now records both legs.
 *
 * CURRENT reason the ban stands, both of which must clear before it lifts:
 *   1. TRANSITION. Rows logged before 2026-07-09 recorded only the failure leg, so
 *      passRate is a LOWER BOUND until the retention window rolls past that date.
 *      Rendering it now understates the user's checks.
 *   2. NO CAPABILITY GATE. A tool that observes only ONE leg must not populate this
 *      surface. Codex is the mirror hazard: its PostToolUse fires only on success
 *      and it has no failure hook, so a naive port pins the rate at a fabricated
 *      100%. The `toolResult: 'both' | 'failures-only' | 'passes-only' | 'none'`
 *      capability must gate the render (see docs/specs/multi-tool.md).
 *
 * Until then both the widget body and the ErrorsPanel detail frame verification as
 * FAILURES BY KIND. Delete this guard only alongside the gate, never before it.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const VERIFICATION_SURFACES = [
  'views/OverviewView/ToolsDetailView/panels/ErrorsPanel.tsx',
  'widgets/bodies/ToolWidgets.tsx',
];

const BANNED: { re: RegExp; why: string }[] = [
  { re: /Did verification pass/i, why: 'a pass-rate question the pre-2026-07-09 window understates' },
  { re: /fully green/i, why: 'a pass-count framing not yet gated on the toolResult capability' },
  // The error-rate surface honestly uses `errorRate * 100`; only passRate-as-percent
  // is banned (both legs are recorded now, but the window has not rolled and no
  // capability gate exists, so a rendered percent is a lower bound or, on a
  // one-leg tool, a fabricated 100%).
  { re: /passRate\s*\*\s*100/, why: 'renders passRate directly as a percent' },
];

describe('verification honesty (DA-01)', () => {
  it.each(VERIFICATION_SURFACES)('%s never renders verification as a pass rate', (rel) => {
    const src = readFileSync(join(SRC, rel), 'utf8');
    for (const { re, why } of BANNED) {
      expect(re.test(src), `${rel}: ${why}`).toBe(false);
    }
  });

  it('the banned patterns are live (a typo cannot silently pass)', () => {
    expect(/Did verification pass/i.test('Did verification pass?')).toBe(true);
    expect(/fully green/i.test('(3 fully green)')).toBe(true);
    expect(/passRate\s*\*\s*100/.test('v.passRate * 100')).toBe(true);
  });
});

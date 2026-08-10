import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for capability-drift in RENDERED copy (the sibling of
 * catalog-copy-honesty.test.ts, which only covers WIDGET_CATALOG name/description).
 *
 * The 2026-06-19 capability audit found rendered empty-state / CoverageNote strings
 * claiming a tile was blocked on a capability that has since shipped: the D1 event
 * log is retained; session.delta ships git ground-truth; the collector emits
 * per-model models[] and an ordered tool-call stream; the salted fileId axis is
 * live. User-facing copy must frame an empty tile as data ACCRUAL ("fills in as
 * <rows> accrue"), never as a capability that has not landed.
 *
 * Scope is rendered strings only — `title=` / `hint=` / `<CoverageNote text=>` /
 * `<SectionEmpty>` children. Code comments may still honestly describe the source
 * ("from the retained event log"), so they are deliberately NOT scanned. The
 * patterns are tight: legitimate PERMANENT statements ("never collects file paths",
 * "no effectiveness grade", work-mix "isn't available yet") must not trip them.
 */
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN_DIRS = ['widgets/bodies', 'views'];

const BANNED: { re: RegExp; why: string; sample: string }[] = [
  {
    re: /retained event log/i,
    why: 'stale: the event log is retained in production — frame as accrual',
    sample: 'Fills in once Seorak has a retained event log.',
  },
  {
    re: /event log\s+(?:retain|persist|land)/i,
    why: 'stale: the event log is already retained',
    sample: 'Empty until the event log lands.',
  },
  {
    re: /(?:retain|persist)s?\s+(?:its|the|an)\s+event log/i,
    why: 'stale: the worker already retains the event log',
    sample: 'keyframes fill in as the worker retains its event log',
  },
  {
    re: /until the (?:worker|collector) (?:persist|retain|attribut)/i,
    why: 'stale: the worker/collector already does this',
    sample: 'Per-model spend fills in until the collector attributes tokens.',
  },
  {
    re: /capture lands/i,
    why: 'stale: the capture has already landed — frame as accrual',
    sample: 'This stays off until file capture lands.',
  },
  {
    re: /git-delta capture/i,
    why: 'stale: session.delta git capture has landed',
    sample: 'Ship detection fills in once session git-delta capture lands.',
  },
  {
    re: /attributes tokens by model/i,
    why: 'stale: the collector emits per-model models[]',
    sample: 'Per-model spend fills in once the collector attributes tokens by model.',
  },
  {
    re: /once the collector (?:attributes|emits|persists)/i,
    why: 'stale: the collector already emits this',
    sample: 'Fills in once the collector emits per-tool counts.',
  },
  {
    re: /can judge retry shape/i,
    why: 'stale: oneShotRate is derived from the ordered tool-call stream',
    sample: 'Fills in once the ordered tool-call log can judge retry shape.',
  },
  {
    re: /first try|first attempt|landed (?:on )?the first/i,
    why: 'overclaim: one-shot is a cadence proxy, not first-time correctness — say "ran without a retry loop" (DA-03)',
    sample: '72% of sessions landed on the first try',
  },
];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsxFiles(full));
    } else if (entry.endsWith('.tsx') && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

/** Pull the user-facing string literals out of a source file: the values of
 *  title= / hint= / text= JSX attributes plus <SectionEmpty> text children. */
function renderedStrings(src: string): string[] {
  const out: string[] = [];
  const attr = /(?:title|hint|text)="([^"]*)"/g;
  for (let m = attr.exec(src); m; m = attr.exec(src)) out.push(m[1]);
  const sectionEmpty = /<SectionEmpty>([^<{]*)<\/SectionEmpty>/g;
  for (let m = sectionEmpty.exec(src); m; m = sectionEmpty.exec(src)) out.push(m[1].trim());
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => tsxFiles(join(SRC_ROOT, d)));

describe('rendered copy honesty (capability-drift guard)', () => {
  it('finds source files to scan', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it.each(FILES.map((f) => [f.slice(SRC_ROOT.length + 1), f] as const))(
    '%s carries no stale-capability rendered copy',
    (rel, full) => {
      const strings = renderedStrings(readFileSync(full, 'utf8'));
      for (const s of strings) {
        for (const { re, why } of BANNED) {
          expect(re.test(s), `${rel}: ${why} — "${s}"`).toBe(false);
        }
      }
    },
  );

  // Self-check: every banned pattern must actually match its sample, so a typo'd
  // regex can't silently pass forever.
  it.each(BANNED.map((b) => [b.why, b] as const))('pattern is live: %s', (_why, b) => {
    expect(b.re.test(b.sample)).toBe(true);
  });
});

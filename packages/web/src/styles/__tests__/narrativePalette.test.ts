import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Agents and Model draw their section / facet colours from one shared hue ramp.
 * Before it was shared, the two files held ten byte-identical declarations (four
 * hues plus --note-inset, each in a light and a dark block) and had already
 * drifted once. These tests hold the split:
 *
 *   - the ramp stays the ONLY definition of a shared hue,
 *   - a view keeps only hues the other view does not have,
 *   - every hue the ramp exports has a dark value, because a hue that only
 *     brightens on one field stops reading as a category on the other,
 *   - nothing a view references is left without a definition.
 */

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

const RAMP = read('../narrativePalette.module.css');
const AGENTS = read('../../views/AgentsView/AgentsView.module.css');
const MODEL = read('../../views/ModelView/ModelView.module.css');

/** The literal `color-mix(...)` / `rgba(...)` value assigned to each property. */
function declarations(css: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    const list = out.get(m[1]) ?? [];
    list.push(m[2].trim());
    out.set(m[1], list);
  }
  return out;
}

const SHARED_HUES = ['--narrative-amber', '--narrative-blue', '--narrative-violet', '--narrative-green'];

describe('narrative palette', () => {
  it('exports a light and a dark value for every shared hue', () => {
    const decls = declarations(RAMP);
    for (const hue of [...SHARED_HUES, '--note-inset']) {
      expect(decls.get(hue), `${hue} must be defined in the ramp`).toHaveLength(2);
    }
  });

  it.each([
    ['AgentsView', AGENTS],
    ['ModelView', MODEL],
  ])('%s composes the ramp rather than restating it', (_name, css) => {
    expect(css).toContain("composes: narrativeHues from '../../styles/narrativePalette.module.css'");

    // A view may alias a shared hue but must never re-declare its literal value.
    const rampValues = new Set(
      SHARED_HUES.flatMap((h) => declarations(RAMP).get(h) ?? []).concat(
        declarations(RAMP).get('--note-inset') ?? [],
      ),
    );
    const restated = [...declarations(css)].flatMap(([prop, values]) =>
      values.filter((v) => rampValues.has(v)).map((v) => `${prop}: ${v}`),
    );
    expect(restated).toEqual([]);
  });

  it.each([
    ['AgentsView', AGENTS, '--sect-'],
    ['ModelView', MODEL, '--facet-'],
  ])('%s defines every categorical variable it uses', (_name, css, prefix) => {
    const defined = new Set(declarations(css).keys());
    const used = new Set(
      [...css.matchAll(/var\((--[a-z0-9-]+)/g)]
        .map((m) => m[1])
        .filter((v) => v.startsWith(prefix)),
    );
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
  });

  it.each([
    ['AgentsView', AGENTS],
    ['ModelView', MODEL],
  ])('%s reads --note-inset from the ramp and never defines it', (_name, css) => {
    expect(css).toContain('var(--note-inset)');
    expect(declarations(css).has('--note-inset')).toBe(false);
  });

  it('resolves the shared hues through aliases, so no view needs a dark override for them', () => {
    const darkPageRule = /:global\(\[data-theme='dark'\]\) \.page\b/;
    // Agents keeps two of its own hues, which DO need a dark block.
    expect(AGENTS).toMatch(darkPageRule);
    for (const alias of ['--sect-matrix', '--sect-where', '--sect-when', '--sect-models']) {
      expect(declarations(AGENTS).get(alias)).toHaveLength(1);
    }
    // Model has no view-specific hue that changes with the field, so it needs no
    // dark block at all.
    expect(MODEL).not.toMatch(darkPageRule);
    for (const alias of ['--facet-rhythm', '--facet-stack', '--facet-shape', '--facet-payoff']) {
      expect(declarations(MODEL).get(alias)).toHaveLength(1);
    }
  });
});

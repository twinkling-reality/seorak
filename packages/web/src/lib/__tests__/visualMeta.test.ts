import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getVisualMeta, type VisualKind } from '../visualMeta.js';

const PUBLIC_ROOT = join(import.meta.dirname, '../../../public');

const REGISTRY_SAMPLES: Array<{ kind: VisualKind; id: string }> = [
  { kind: 'language', id: 'typescript' },
  { kind: 'language', id: 'csharp' },
  { kind: 'framework', id: 'react' },
  { kind: 'framework', id: 'expo' },
  { kind: 'framework', id: 'sveltekit' },
  { kind: 'packageManager', id: 'pnpm' },
  { kind: 'packageManager', id: 'uv' },
  { kind: 'fileCategory', id: 'source' },
  { kind: 'fileCategory', id: 'test' },
  { kind: 'branchWork', id: 'feature' },
  { kind: 'branchWork', id: 'fix' },
];

describe('visualMeta', () => {
  it('resolves known languages with display labels, colors, and icons', () => {
    const ts = getVisualMeta('language', 'typescript');
    expect(ts.label).toBe('TypeScript');
    expect(ts.abbrev).toBe('TS');
    expect(ts.color).toBe('#3178c6');
    expect(ts.icon).toBe('/assets/stack/languages/typescript.svg');
  });

  it('resolves frameworks and package managers with icons', () => {
    expect(getVisualMeta('framework', 'react').icon).toBe('/assets/stack/frameworks/react.svg');
    expect(getVisualMeta('framework', 'expo').label).toBe('Expo');
    expect(getVisualMeta('packageManager', 'pnpm').icon).toBe('/assets/stack/package-managers/pnpm.svg');
  });

  it('every registered enum entry has an on-disk SVG', () => {
    for (const { kind, id } of REGISTRY_SAMPLES) {
      const meta = getVisualMeta(kind, id);
      expect(meta.icon, `${kind}/${id}`).toBeTruthy();
      const diskPath = join(PUBLIC_ROOT, meta.icon!.replace(/^\//, ''));
      expect(existsSync(diskPath), `missing ${meta.icon}`).toBe(true);
    }
  });

  it('falls back to monogram for unknown ids only', () => {
    const meta = getVisualMeta('language', 'cobol');
    expect(meta.label).toBe('Cobol');
    expect(meta.abbrev.length).toBeGreaterThan(0);
    expect(meta.icon).toBeNull();
    expect(meta.color).toMatch(/^hsl\(/);
  });
});

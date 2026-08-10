import { describe, expect, it } from 'vitest';
import { fileExtension } from '../fileType.js';
import { fileTypeIconPath } from '../fileTypeIcon.js';

describe('fileExtension', () => {
  it('reads the extension off a plain filename', () => {
    expect(fileExtension('overview.ts')).toBe('ts');
    expect(fileExtension('tokens.css')).toBe('css');
    expect(fileExtension('wrangler.toml')).toBe('toml');
    expect(fileExtension('README.md')).toBe('md');
  });

  it('keeps only the final segment of a compound name', () => {
    expect(fileExtension('overview.test.ts')).toBe('ts');
    expect(fileExtension('app.module.css')).toBe('css');
  });

  it('strips any path before parsing', () => {
    expect(fileExtension('src/lib/utils.ts')).toBe('ts');
    expect(fileExtension('a\\b\\c.json')).toBe('json');
  });

  it('lowercases the extension', () => {
    expect(fileExtension('Data.JSON')).toBe('json');
  });

  it('returns "" when there is no usable type extension', () => {
    expect(fileExtension('Makefile')).toBe('');
    expect(fileExtension('.gitignore')).toBe('');
    expect(fileExtension(null)).toBe('');
    expect(fileExtension(undefined)).toBe('');
    expect(fileExtension('')).toBe('');
  });
});

describe('fileTypeIconPath', () => {
  it('returns a real 24x24 path for known types', () => {
    for (const name of ['overview.ts', 'component.tsx', 'tokens.css', 'wrangler.toml', 'README.md', 'seed.sql']) {
      const path = fileTypeIconPath(name);
      expect(path, name).toBeTruthy();
      expect(typeof path).toBe('string');
    }
  });

  it('maps extension aliases to the same mark', () => {
    // .ts / .mts / .cts all read as TypeScript; .jsx / .tsx as React.
    expect(fileTypeIconPath('a.mts')).toBe(fileTypeIconPath('a.ts'));
    expect(fileTypeIconPath('a.jsx')).toBe(fileTypeIconPath('a.tsx'));
    expect(fileTypeIconPath('a.yml')).toBe(fileTypeIconPath('a.yaml'));
  });

  it('returns null for unknown or missing extensions (mark uses the glyph)', () => {
    expect(fileTypeIconPath('data.xyz')).toBeNull();
    expect(fileTypeIconPath('Makefile')).toBeNull();
    expect(fileTypeIconPath('.gitignore')).toBeNull();
    expect(fileTypeIconPath(null)).toBeNull();
  });
});

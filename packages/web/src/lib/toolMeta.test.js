import { describe, expect, it } from 'vitest';
import { TOOL_ALIASES, TOOL_PARTIAL_MATCHES } from '@seorak/types';
import { getToolMeta, normalizeToolId, TOOL_META } from './toolMeta.js';

// ---- structural integrity ----

describe('TOOL_ALIASES integrity', () => {
  it('every alias target exists in TOOL_META', () => {
    for (const [alias, target] of Object.entries(TOOL_ALIASES)) {
      expect(TOOL_META, `ALIAS "${alias}" → "${target}" missing from TOOL_META`).toHaveProperty(
        target,
      );
    }
  });
});

describe('TOOL_PARTIAL_MATCHES integrity', () => {
  it('every partial-match key exists in TOOL_META', () => {
    for (const { substring, key } of TOOL_PARTIAL_MATCHES) {
      expect(
        TOOL_META,
        `PARTIAL_MATCHES key "${key}" (substring: "${substring}") missing from TOOL_META`,
      ).toHaveProperty(key);
    }
  });
});

// ---- normalizeToolId ----

describe('normalizeToolId', () => {
  it('lowercases and strips separators', () => {
    expect(normalizeToolId('Claude-Code')).toBe('claudecode');
    expect(normalizeToolId('VS_Code')).toBe('vscode');
    expect(normalizeToolId('JetBrains.AI')).toBe('jetbrainsai');
  });

  it('handles null/undefined/empty', () => {
    expect(normalizeToolId(null)).toBe('');
    expect(normalizeToolId(undefined)).toBe('');
    expect(normalizeToolId('')).toBe('');
  });
});

// ---- getToolMeta: direct match ----

describe('getToolMeta - direct match', () => {
  it('returns exact match for known tool', () => {
    const meta = getToolMeta('cursor');
    expect(meta).toMatchObject({ id: 'cursor', label: 'Cursor' });
  });

  it('handles case and separator normalization', () => {
    const meta = getToolMeta('CURSOR');
    expect(meta).toMatchObject({ id: 'cursor', label: 'Cursor' });
  });
});

// ---- getToolMeta: alias match ----

describe('getToolMeta - alias match', () => {
  it('resolves known alias', () => {
    const meta = getToolMeta('Claude Code');
    expect(meta).toMatchObject({ id: 'claude', label: 'Claude Code' });
  });

  it('resolves Visual Studio Code alias', () => {
    const meta = getToolMeta('visual-studio-code');
    expect(meta).toMatchObject({ id: 'vscode', label: 'VS Code' });
  });

  it('resolves Windsurf Editor alias', () => {
    const meta = getToolMeta('windsurf-editor');
    expect(meta).toMatchObject({ id: 'windsurf', label: 'Windsurf' });
  });
});

// ---- getToolMeta: partial match ----

describe('getToolMeta - partial match', () => {
  it('matches JetBrains AI Assistant via partial', () => {
    const meta = getToolMeta('jetbrains-ai-assistant');
    expect(meta).toMatchObject({ id: 'jetbrains', label: 'JetBrains' });
  });

  it('matches continuedev via partial', () => {
    const meta = getToolMeta('continuedev');
    expect(meta).toMatchObject({ id: 'continue', label: 'Continue' });
  });

  it('matches codexsomething via partial', () => {
    const meta = getToolMeta('codex-pro');
    expect(meta).toMatchObject({ id: 'codex', label: 'Codex' });
  });
});

// ---- substring collision safety ----

describe('getToolMeta - substring collision safety', () => {
  it('does NOT match short TOOL_META keys as false positives', () => {
    // "v0" is in TOOL_META but NOT in PARTIAL_MATCHES,
    // so "v0developer" should fall through to fallback, not match "v0"
    const meta = getToolMeta('v0developer');
    // v0 is a direct match only - "v0developer" normalized is "v0developer", no direct/alias match
    // and "v0" is not in PARTIAL_MATCHES, so this should be a fallback
    expect(meta.id).not.toBe('v0');
  });

  it('does NOT match "amp" inside "ampbysourcegraph" via partial (alias handles it)', () => {
    // "ampbysourcegraph" is an explicit alias → "amp"
    const meta = getToolMeta('amp-by-sourcegraph');
    expect(meta).toMatchObject({ id: 'amp', label: 'Amp' });
  });

  it('does NOT match "zed" inside random tool names', () => {
    const meta = getToolMeta('amazed-editor');
    // "zed" is not in PARTIAL_MATCHES, so this should fall through to fallback
    expect(meta.id).not.toBe('zed');
  });

  it('prefers alias over partial match', () => {
    // "amazonqdeveloper" is an explicit alias to "amazonq"
    const meta = getToolMeta('Amazon Q Developer');
    expect(meta).toMatchObject({ id: 'amazonq', label: 'Amazon Q' });
  });
});

// ---- getToolMeta: fallback ----

describe('getToolMeta - fallback', () => {
  it('returns formatted fallback for unknown tools', () => {
    const meta = getToolMeta('totally-unknown-tool');
    expect(meta).toMatchObject({
      id: 'totallyunknowntool',
      label: 'Totally Unknown Tool',
      icon: null,
    });
    // Fallback derives a deterministic HSL hue per tool id; assert the
    // shape, not a specific hue, so the test does not break when the
    // hash function or saturation/lightness defaults shift.
    expect(meta.color).toMatch(/^hsl\(\d+,\s*\d+%,\s*\d+%\)$/);
  });

  it('derives a stable color for the same unknown tool', () => {
    const a = getToolMeta('totally-unknown-tool');
    const b = getToolMeta('totally-unknown-tool');
    expect(a.color).toBe(b.color);
  });

  it('returns default for null/undefined/empty', () => {
    const meta = getToolMeta(null);
    expect(meta).toMatchObject({ id: 'tool', label: 'Tool', icon: null });
  });

  it('fallback includes all expected fields', () => {
    const meta = getToolMeta('mystery');
    expect(meta).toHaveProperty('id');
    expect(meta).toHaveProperty('label');
    expect(meta).toHaveProperty('icon');
    expect(meta).toHaveProperty('color');
  });
});

// ---- getToolMeta: return shape ----

describe('getToolMeta - return shape', () => {
  it('always returns id, label, icon, color for known tools', () => {
    for (const key of Object.keys(TOOL_META)) {
      const meta = getToolMeta(key);
      expect(meta, `missing fields for "${key}"`).toHaveProperty('id');
      expect(meta, `missing fields for "${key}"`).toHaveProperty('label');
      expect(meta, `missing fields for "${key}"`).toHaveProperty('color');
      expect(meta).toHaveProperty('icon');
    }
  });
});

// ---- no vendored vendor marks ----

// ADR 005 section 6 flagged the thirteen vendored AI-tool SVGs for qualified
// legal review, and its `packages/web` section gave B7 one condition for keeping
// them: re-sync all thirteen from a pinned simple-icons version, or fall back to
// a text glyph and ship no vendored marks. B7 measured the re-sync as
// unachievable (see THIRD_PARTY_NOTICES.md), so the fallback is what shipped.
//
// This pins that outcome. Re-adding an icon path here is a legal decision as
// well as a product one, and it should have to delete a failing test to happen
// rather than slipping in beside a widget change.
describe('vendored marks', () => {
  it('resolves every known tool to the letter fallback, with no /assets path', () => {
    for (const [key, entry] of Object.entries(TOOL_META)) {
      expect(entry.icon, `"${key}" carries a vendored mark`).toBeNull();
      expect(getToolMeta(key).icon, `"${key}" carries a vendored mark`).toBeNull();
    }
  });

  it('keeps the brand color, which rides the fallback mark instead', () => {
    for (const [key, entry] of Object.entries(TOOL_META)) {
      expect(entry.color, `"${key}" has no brand color to fall back on`).toBeTruthy();
    }
  });
});

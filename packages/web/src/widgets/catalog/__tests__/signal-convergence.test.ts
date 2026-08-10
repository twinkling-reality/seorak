/**
 * signal-convergence.test.ts — the guard that keeps the web widget catalog and
 * the shared stat catalog (`@seorak/types` SEORAK_SIGNALS) from drifting. Web
 * chat resolves citations through this catalog while the widget layer keeps its
 * richer `WidgetDef` here. This test asserts the web catalog is a strict subset
 * with matching id/name/category/dataKeys, so widgets and cited stats cannot
 * silently diverge.
 */
import { describe, expect, it } from 'vitest';
import { SEORAK_SIGNALS, type WidgetSignalMeta } from '@seorak/types';
import { WIDGET_CATALOG } from '../index.js';

const SHARED = new Map<string, WidgetSignalMeta>(SEORAK_SIGNALS.map((s) => [s.id, s]));

describe('web and shared stat catalog convergence', () => {
  it('every web widget id exists in the shared SEORAK_SIGNALS catalog', () => {
    const missing = WIDGET_CATALOG.filter((w) => !SHARED.has(w.id)).map((w) => w.id);
    expect(missing).toEqual([]);
  });

  it('shared name/category/dataKeys match the web catalog for every widget', () => {
    for (const w of WIDGET_CATALOG) {
      const shared = SHARED.get(w.id);
      expect(shared, `missing shared signal for "${w.id}"`).toBeDefined();
      if (!shared) continue;
      expect(shared.name, `name mismatch for "${w.id}"`).toBe(w.name);
      expect(shared.category, `category mismatch for "${w.id}"`).toBe(w.category);
      expect([...shared.dataKeys].sort(), `dataKeys mismatch for "${w.id}"`).toEqual(
        [...w.dataKeys].sort(),
      );
    }
  });

  it('the shared catalog carries no signal the web catalog does not define', () => {
    const webIds = new Set(WIDGET_CATALOG.map((w) => w.id));
    const orphans = SEORAK_SIGNALS.filter((s) => !webIds.has(s.id)).map((s) => s.id);
    expect(orphans).toEqual([]);
  });
});

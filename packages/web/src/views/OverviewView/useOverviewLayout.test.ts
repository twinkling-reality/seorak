import { describe, it, expect } from 'vitest';

import { normalizeCurrentLayout } from './useOverviewLayout.js';
import {
  DEFAULT_LAYOUT,
  FULL_DEFAULT_LAYOUT,
  getWidget,
  type WidgetSlot,
} from '../../widgets/catalog/index.js';

describe('STARTER_DEFAULT_LAYOUT — week-one cockpit', () => {
  const ids = DEFAULT_LAYOUT.map((s) => s.id);

  it('leads with live sessions and session/tool stats', () => {
    expect(ids[0]).toBe('live-sessions');
    expect(ids).toContain('sessions');
    expect(ids).toContain('cost');
    expect(ids).toContain('tool-mix');
    expect(ids).not.toContain('momentum');
    expect(ids).not.toContain('ship-rate');
    expect(ids).not.toContain('line-survival');
  });

  it('promotes the trend widget into the starter cockpit', () => {
    expect(ids).toContain('trend');
  });

  it('every starter slot is a real catalog id that survives normalization', () => {
    for (const slot of DEFAULT_LAYOUT) {
      expect(getWidget(slot.id), `missing catalog def for ${slot.id}`).toBeDefined();
    }
    const normalized = normalizeCurrentLayout(DEFAULT_LAYOUT);
    expect(normalized.map((s) => s.id)).toEqual(ids);
  });
});

describe('FULL_DEFAULT_LAYOUT — MODEL-REVIEW rec #12 promotions', () => {
  const ids = FULL_DEFAULT_LAYOUT.map((s) => s.id);

  it('promotes the durability + git stat tiles into the full default', () => {
    expect(ids).toContain('line-survival');
    expect(ids).toContain('edits');
    expect(ids).toContain('stuckness');
  });

  it('keeps the mature cockpit ordered outcome-first: momentum hero, then live, then the KPI strip', () => {
    expect(ids[0]).toBe('momentum');
    expect(ids).toContain('ship-rate');
    expect(ids.indexOf('line-survival')).toBeGreaterThan(ids.indexOf('ship-rate'));
  });

  it('layout audit: demoted tiles stay picker-only; live-sessions owns the NOW band', () => {
    for (const demoted of ['files-in-play', 'files-touched', 'projects', 'heatmap'] as const) {
      expect(ids, `${demoted} should not be in full default`).not.toContain(demoted);
    }
    const live = FULL_DEFAULT_LAYOUT.find((s) => s.id === 'live-sessions');
    expect(live?.colSpan).toBe(12);
    expect(ids.indexOf('trend')).toBeLessThan(ids.indexOf('tool-mix'));
  });
});

describe('normalizeCurrentLayout', () => {
  it('clamps a current slot past its catalog max', () => {
    // `cost` is viz: 'stat' which has maxW 4. A 12-col cost slot from a
    // manual storage edit should clamp to the current catalog constraint.
    const out = normalizeCurrentLayout([{ id: 'cost', colSpan: 12, rowSpan: 2 }]);
    expect(out[0]?.colSpan).toBe(4);
  });

  it('drops unknown ids', () => {
    const slots: WidgetSlot[] = [{ id: 'unknown-id', colSpan: 12, rowSpan: 4 }];
    expect(normalizeCurrentLayout(slots)).toEqual([]);
  });

  it('deduplicates current ids while preserving first occurrence', () => {
    const out = normalizeCurrentLayout([
      { id: 'projects', colSpan: 6, rowSpan: 3 },
      { id: 'projects', colSpan: 6, rowSpan: 3 },
    ]);
    expect(out).toEqual([{ id: 'projects', colSpan: 6, rowSpan: 3 }]);
  });
});

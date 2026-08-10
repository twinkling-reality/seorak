import { describe, expect, it } from 'vitest';

import { WIDGET_CATALOG, type WidgetDef } from '../../catalog/index.js';
import {
  availabilityLabel,
  dataKeyLabel,
  readinessBadge,
  sizeLabel,
  timeScopeNote,
  VIZ_LABELS,
} from '../catalogMeta.js';

const widget = (over: Partial<WidgetDef> = {}): WidgetDef => ({
  id: 'test-widget',
  name: 'Test widget',
  description: 'A widget for tests.',
  category: 'usage',
  scope: 'both',
  viz: 'stat',
  w: 3,
  h: 2,
  dataKeys: ['token_usage'],
  ...over,
});

describe('sizeLabel', () => {
  it('names every canonical column span', () => {
    expect(sizeLabel(3)).toBe('quarter width');
    expect(sizeLabel(4)).toBe('third width');
    expect(sizeLabel(6)).toBe('half width');
    expect(sizeLabel(8)).toBe('two-thirds width');
    expect(sizeLabel(12)).toBe('full width');
  });

  it('falls back to the raw count for an unnamed span', () => {
    expect(sizeLabel(5)).toBe('5 columns');
  });

  it('has a name for every span the catalog actually ships', () => {
    for (const w of WIDGET_CATALOG) {
      expect(sizeLabel(w.w)).not.toMatch(/columns$/);
    }
  });
});

describe('dataKeyLabel', () => {
  it('speaks the first data key in plain words', () => {
    expect(dataKeyLabel(widget({ dataKeys: ['hourly_effectiveness'] }))).toBe(
      'how sessions ended, by hour',
    );
  });

  it('says nothing for the generic dashboard payload', () => {
    expect(dataKeyLabel(widget({ dataKeys: ['dashboard'] }))).toBeNull();
  });

  it('says nothing when the widget declares no data key', () => {
    expect(dataKeyLabel(widget({ dataKeys: [] }))).toBeNull();
  });

  it('falls back to the raw key rather than dropping the fact', () => {
    expect(dataKeyLabel(widget({ dataKeys: ['unmapped_key'] }))).toBe('unmapped_key');
  });
});

describe('timeScopeNote', () => {
  it('says the picker does not apply to live and lifetime widgets', () => {
    expect(timeScopeNote(widget({ timeScope: 'live' }))).toBe(
      "Real-time. The date picker doesn't apply.",
    );
    expect(timeScopeNote(widget({ timeScope: 'all-time' }))).toBe(
      "Lifetime totals. The date picker doesn't apply.",
    );
  });

  it('stays quiet for period widgets, where the range pills already say it', () => {
    expect(timeScopeNote(widget({ timeScope: 'period' }))).toBeNull();
    expect(timeScopeNote(widget({ timeScope: undefined }))).toBeNull();
  });
});

describe('availabilityLabel', () => {
  it('flags only the tiles a user cannot feed', () => {
    expect(availabilityLabel(widget({ availability: 'not-available' }))).toBe('Not available');
    expect(availabilityLabel(widget({ availability: 'coming-soon' }))).toBe('Coming soon');
    expect(availabilityLabel(widget({ availability: 'available' }))).toBeNull();
    expect(availabilityLabel(widget())).toBeNull();
  });
});

describe('readinessBadge', () => {
  it('says nothing before a snapshot arrives — an unmeasured widget is not an empty one', () => {
    expect(readinessBadge(widget(), null, null)).toBeNull();
    expect(readinessBadge(widget(), undefined, undefined)).toBeNull();
  });

  it('never stacks a readiness badge on a widget already flagged unavailable', () => {
    const overview = {} as never;
    expect(readinessBadge(widget({ availability: 'not-available' }), overview, null)).toBeNull();
  });
});

describe('VIZ_LABELS', () => {
  it('names every viz the catalog uses, so no row falls back to a raw enum', () => {
    for (const w of WIDGET_CATALOG) {
      expect(VIZ_LABELS[w.viz]).toBeTruthy();
    }
  });
});

import { describe, it, expect } from 'vitest';

import { assignBandRows, type BandEntry } from './WidgetGrid.js';
import { DEFAULT_LAYOUT, FULL_DEFAULT_LAYOUT, type WidgetSlot } from '../../widgets/catalog/index.js';

const widget = (colSpan: WidgetSlot['colSpan'], rowSpan: WidgetSlot['rowSpan'] = 2): BandEntry => ({
  kind: 'widget',
  slot: { id: `w${colSpan}-${Math.random().toString(36).slice(2, 6)}`, colSpan, rowSpan },
});

describe('assignBandRows — band partitioning that makes stagger impossible', () => {
  it('groups entries into 12-column rows in source order', () => {
    // 3+6+3 fills row 1; 6+6 fills row 2; trailing 3 starts row 3.
    const rows = assignBandRows([
      widget(3),
      widget(6),
      widget(3),
      widget(6),
      widget(6),
      widget(3),
    ]);
    expect(rows).toEqual([1, 1, 1, 2, 2, 3]);
  });

  it('wraps without backfilling: an oversized next widget starts a new band, leaving the gap', () => {
    // 8 + 6 overflows, so the 6 wraps; the later 4 must NOT jump back into
    // row 1's gap (that reordering is exactly the dense-flow behavior the
    // band layout removes).
    const rows = assignBandRows([widget(8), widget(6), widget(4)]);
    expect(rows).toEqual([1, 2, 2]);
  });

  it('a full-width widget always gets its own band', () => {
    const rows = assignBandRows([widget(3), widget(12), widget(3)]);
    expect(rows).toEqual([1, 2, 3]);
  });

  it('ghost entries occupy their real footprint in the flow', () => {
    // A 6-wide ghost at h:3 (tier 3) between two 6-wide rowSpan-2 widgets
    // starts a new band on tier mismatch — the second widget lands alone.
    const rows = assignBandRows([widget(6), { kind: 'ghost', w: 6, h: 3 }, widget(6)]);
    expect(rows).toEqual([1, 2, 3]);
  });

  it('starts a new band when rowSpan tier changes, even if columns still fit', () => {
    const rows = assignBandRows([widget(6, 3), widget(3, 2), widget(3, 2)]);
    expect(rows).toEqual([1, 2, 2]);
  });

  it('clamps absurd spans to the grid instead of producing empty bands', () => {
    const rows = assignBandRows([
      { kind: 'ghost', w: 40, h: 2 },
      { kind: 'ghost', w: 0, h: 2 },
    ]);
    expect(rows).toEqual([1, 2]);
  });

  it('partitions the starter layout into curated rows', () => {
    const rows = assignBandRows(DEFAULT_LAYOUT.map((slot) => ({ kind: 'widget', slot })));
    // live-sessions(12) | KPI row (sessions/cost/edits/one-shot-rate, 4×3) | trend+tool-mix (6+6)
    expect(rows).toEqual([1, 2, 2, 2, 2, 3, 3]);
  });

  it('partitions the full default layout into the curated rows', () => {
    const rows = assignBandRows(FULL_DEFAULT_LAYOUT.map((slot) => ({ kind: 'widget', slot })));
    // momentum(12) | NOW band (live-sessions, 12) |
    // KPI stat row (sessions/cost/ship-rate/line-survival, 4×3) |
    // git stat row (commits/net-lines/edits/stuckness, 4×3) |
    // trend+tool-mix (6+6) | agent-edit-share (12) | files+file-rework (6+6)
    expect(rows).toEqual([1, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 6, 7, 7]);
  });
});

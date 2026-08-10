import { describe, expect, it } from 'vitest';
import { WIDGET_CATALOG, getWidget, DEFAULT_WIDGET_IDS, FULL_WIDGET_IDS } from '../catalog/index.js';

// The founder's A2 decision: every structurally-unfeedable tile stays in the
// catalog (so the picker shows the honest boundary) but is framed correctly —
// availability:'not-available', NOT 'coming-soon' — and never sits in the
// default layout. 'coming-soon' is reserved for tiles that genuinely fill in.

// NOTE (fileId reclassification, 2026-06-09): files-in-play / directories /
// files / file-rework are NO LONGER unfeedable. The collector's salted fileId
// signal (sha256(salt+path), the repoId move one level down) feeds them with ids
// + counts while paths still never leave the machine. files-in-play also carries
// live project/session context so the tile is not an anonymous aggregate.
// cost-per-edit's refusal was deliberately reversed the same day (founder call).
//
// Currently EMPTY: `survival` was the last not-available tile and it is gone from
// the catalog entirely (the commit-reachability contract was deleted; line-survival
// is the honest durability headline). The list and its guards stay so the A2
// discipline re-arms the moment a tile is classified unfeedable again.
const STRUCTURALLY_UNFEEDABLE: string[] = [];

// Reclassified from 'not-available' to fed (fileId signal, 2026-06-09).
const FEEDABLE_FILE_AXIS = [
  'cost-per-edit',
  'directories',
  'files',
  'file-rework',
];

// Reclassified from 'not-available' to fed (availability omitted === 'available'):
// the git-count + edit-count tiles now backed by usage.momentum / commitStats /
// tools.byTool. `commits` + `net-lines` were split out of the former bundled
// commit-stats tile (2026-06-15) and read codebase.commitStats.
const FEEDABLE_GIT_COUNTS = [
  'files-touched',
  'lines-added',
  'lines-removed',
  'edits',
  'commits',
  'net-lines',
];

// Reclassified from 'not-available' to fed (FOLLOW-UP #5): the per-day + per-hour
// session-end reason series now aggregated by the worker from the retained event
// log (outcomes.endReasonsByDay / activity.endReasonsByHour).
const FEEDABLE_OUTCOME_SERIES = ['outcome-trend', 'hourly-effectiveness'];

describe('catalog availability discipline (A2)', () => {
  it('keeps every unfeedable tile in the catalog (the picker shows the boundary)', () => {
    for (const id of STRUCTURALLY_UNFEEDABLE) {
      expect(getWidget(id), `${id} dropped from catalog`).toBeDefined();
    }
  });

  it('keeps NO unfeedable tile in the default layout', () => {
    for (const id of STRUCTURALLY_UNFEEDABLE) {
      expect(DEFAULT_WIDGET_IDS).not.toContain(id);
    }
  });

  it("a 'never' tile never claims 'coming-soon'", () => {
    for (const id of STRUCTURALLY_UNFEEDABLE) {
      expect(getWidget(id)?.availability).not.toBe('coming-soon');
    }
  });

  it('every not-available tile carries a non-empty reason in its description', () => {
    for (const def of WIDGET_CATALOG) {
      if (def.availability === 'not-available') {
        expect(def.description.trim().length, `${def.id} reason empty`).toBeGreaterThan(0);
      }
    }
  });
});

describe('file-axis tiles reclassified to fed (fileId signal, 2026-06-09)', () => {
  it.each(FEEDABLE_FILE_AXIS)(
    '%s is available (fed from the salted fileId signal / momentum counts), not locked',
    (id) => {
      const def = getWidget(id);
      expect(def, `${id} missing from catalog`).toBeDefined();
      expect(def?.availability ?? 'available').toBe('available');
    },
  );

  it('keeps files-in-play available but out of the default layout (file targets belong in session drill)', () => {
    expect(getWidget('files-in-play')).toBeDefined();
    expect(getWidget('files-in-play')?.availability ?? 'available').toBe('available');
    expect(DEFAULT_WIDGET_IDS).not.toContain('files-in-play');
  });
});

describe('layout audit demotions (2026-07-03)', () => {
  const DEMOTED = ['files-in-play', 'files-touched', 'projects', 'heatmap'] as const;

  it.each(DEMOTED)('%s stays picker-only', (id) => {
    expect(getWidget(id)).toBeDefined();
    expect(DEFAULT_WIDGET_IDS).not.toContain(id);
    expect(FULL_WIDGET_IDS).not.toContain(id);
  });

  it('promotes stuckness into the full layout git stat row beside commits, net-lines, and edit calls', () => {
    expect(FULL_WIDGET_IDS).toContain('stuckness');
    const gitRow = ['commits', 'net-lines', 'edits', 'stuckness'];
    for (const id of gitRow) {
      expect(FULL_WIDGET_IDS).toContain(id);
    }
  });

  it('starter default leads with session/tool stats, not git-heavy tiles', () => {
    expect(DEFAULT_WIDGET_IDS).toContain('live-sessions');
    expect(DEFAULT_WIDGET_IDS).toContain('sessions');
    expect(DEFAULT_WIDGET_IDS).toContain('tool-mix');
    expect(DEFAULT_WIDGET_IDS).not.toContain('momentum');
    expect(DEFAULT_WIDGET_IDS).not.toContain('ship-rate');
    expect(DEFAULT_WIDGET_IDS).not.toContain('line-survival');
  });
});

describe('git-count tiles reclassified to fed (item-5)', () => {
  it.each(FEEDABLE_GIT_COUNTS)(
    '%s is available (fed from git.momentum / byTool counts), not locked',
    (id) => {
      const def = getWidget(id);
      expect(def, `${id} missing from catalog`).toBeDefined();
      // availability omitted === 'available'; it must NOT be flagged unfeedable.
      expect(def?.availability ?? 'available').toBe('available');
    },
  );
});

describe('outcome-series tiles reclassified to fed (FOLLOW-UP #5)', () => {
  it.each(FEEDABLE_OUTCOME_SERIES)(
    '%s is available (fed from the worker end-reason day/hour series), not locked',
    (id) => {
      const def = getWidget(id);
      expect(def, `${id} missing from catalog`).toBeDefined();
      // availability omitted === 'available'; it must NOT be flagged unfeedable.
      expect(def?.availability ?? 'available').toBe('available');
    },
  );

  it('keeps them OUT of the default layout (founder promotes fed tiles later)', () => {
    for (const id of FEEDABLE_OUTCOME_SERIES) {
      expect(DEFAULT_WIDGET_IDS).not.toContain(id);
    }
  });
});

describe('cache-reuse widget (A6)', () => {
  it('is in the catalog as a fed (available) usage stat bound to token usage', () => {
    const def = getWidget('cache-reuse');
    expect(def).toBeDefined();
    expect(def?.category).toBe('usage');
    expect(def?.viz).toBe('stat');
    // availability omitted === 'available'; it must NOT be flagged locked.
    expect(def?.availability ?? 'available').toBe('available');
    expect(def?.requiresCapture).toBe('tokenUsage');
  });

  it('is NOT auto-promoted into the default layout (founder promotes later)', () => {
    expect(DEFAULT_WIDGET_IDS).not.toContain('cache-reuse');
  });
});

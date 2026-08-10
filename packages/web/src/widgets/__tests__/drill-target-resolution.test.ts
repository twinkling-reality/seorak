import { describe, expect, it } from 'vitest';

import { WIDGET_CATALOG } from '../catalog/index.js';

/**
 * Drill-resolution guard (DA-09 + the drill-drift pass). Every catalog tile that
 * deep-links a drill must land on a real, non-locked detail tab — or on the
 * Agents route at a canonical section hash.
 */

const VALID_VIEWS = ['live', 'usage', 'outcomes', 'activity', 'tools', 'codebase'];

const TABS_BY_VIEW: Record<string, readonly string[]> = {
  live: ['sessions', 'files'],
  usage: ['sessions', 'edits', 'lines', 'cost', 'projects'],
  outcomes: ['sessions', 'watch'],
  activity: ['rhythm'],
  tools: ['tools', 'errors'],
  codebase: ['files', 'directories', 'git'],
};

const AGENTS_SECTIONS = [
  'verdict',
  'outcomes',
  'matrix',
  'where',
  'when',
  'models',
  'coverage',
] as const;

const LOCKED_TABS: Record<string, readonly string[]> = {};

const QUESTIONS_BY_TAB: Record<string, Record<string, readonly string[]>> = {
  live: {
    sessions: ['active-sessions', 'needs-you'],
    files: ['files-in-play'],
  },
  usage: {
    sessions: ['volume', 'active-now', 'volume-vs-prior', 'tool-density'],
    edits: ['mix', 'share'],
    lines: ['volume', 'lines-vs-prior'],
    cost: ['spend', 'spend-vs-prior', 'context-reuse', 'cost-by-model'],
    projects: ['overview', 'health', 'cost-trend'],
  },
  outcomes: {
    sessions: ['how-ended', 'shipped', 'line-survival', 'survived', 'one-shot', 'ended-by-day', 'stuck', 'recent-outcomes'],
    watch: ['what-fired', 'by-kind', 'watch-limits'],
  },
  activity: {
    rhythm: ['when', 'busiest-days', 'hours-of-day'],
  },
  tools: {
    tools: ['volume'],
    errors: ['top', 'verification'],
  },
  codebase: {
    files: ['hot-files', 'files-by-lines', 'rework', 'file-categories', 'file-languages'],
    directories: ['hot-directories', 'cross-repo-spread'],
    git: ['git-ground-truth', 'generated-churn'],
  },
};

const OWNS_CLICK_CAPABLE_VIZ = new Set(['stat', 'data-list', 'project-list', 'live-list']);

const DRILLS = WIDGET_CATALOG.flatMap((w) =>
  w.drillTarget ? [{ id: w.id, ...w.drillTarget }] : [],
);

describe('catalog drill targets resolve (DA-09 + drift)', () => {
  it('there are drill targets to check', () => {
    expect(DRILLS.length).toBeGreaterThan(0);
  });

  it('every drill view is a real detail view or Agents route', () => {
    for (const d of DRILLS) {
      if ('route' in d && d.route === 'agents') {
        expect(
          (AGENTS_SECTIONS as readonly string[]).includes(d.section),
          `${d.id}: canonical Agents section`,
        ).toBe(true);
        continue;
      }
      expect(
        'view' in d && VALID_VIEWS.includes(d.view as string),
        `${d.id}: drill view is not a detail view`,
      ).toBe(true);
    }
  });

  it('every drill tab exists in its view', () => {
    for (const d of DRILLS) {
      if ('route' in d && d.route === 'agents') {
        expect(
          (AGENTS_SECTIONS as readonly string[]).includes(d.section),
          `${d.id}: Agents section "${d.section}" does not exist`,
        ).toBe(true);
        continue;
      }
      if (!('view' in d) || !d.view) continue;
      const tabs = TABS_BY_VIEW[d.view] ?? [];
      expect(
        tabs.includes(d.tab),
        `${d.id}: drill {${d.view}/${d.tab}} targets a tab that does not exist`,
      ).toBe(true);
    }
  });

  it('no drill lands on a locked tab', () => {
    for (const d of DRILLS) {
      if ('route' in d) continue;
      if (!('view' in d) || !d.view) continue;
      const locked = LOCKED_TABS[d.view] ?? [];
      expect(
        locked.includes(d.tab),
        `${d.id}: drill {${d.view}/${d.tab}} lands on a LOCKED tab`,
      ).toBe(false);
    }
  });

  it('trend uses the standard chart drill into usage sessions detail', () => {
    const trend = WIDGET_CATALOG.find((w) => w.id === 'trend');
    expect(trend?.name).toBe('sessions per day');
    expect(trend?.drillTarget).toEqual({ view: 'usage', tab: 'sessions', q: 'volume' });
  });

  it('model-mix and agent-edit-share open the Agents route', () => {
    expect(WIDGET_CATALOG.find((w) => w.id === 'model-mix')?.drillTarget).toEqual({
      route: 'agents',
      section: 'models',
    });
    expect(WIDGET_CATALOG.find((w) => w.id === 'agent-edit-share')?.drillTarget).toEqual({
      route: 'agents',
      section: 'matrix',
    });
  });

  it('every drill q resolves to a real question in its target panel', () => {
    for (const d of DRILLS) {
      if ('route' in d && d.route === 'agents') continue;
      if (!('q' in d) || !d.q) continue;
      if (!('view' in d) || !d.view) continue;
      const questions = QUESTIONS_BY_TAB[d.view]?.[d.tab] ?? [];
      expect(
        questions.includes(d.q),
        `${d.id}: drill {${d.view}/${d.tab}} q "${d.q}" is not a question in that panel`,
      ).toBe(true);
    }
  });

  it('ownsClick only on widgets whose body can self-wire a click', () => {
    for (const w of WIDGET_CATALOG) {
      if (!w.ownsClick) continue;
      expect(w.drillTarget, `${w.id}: ownsClick with no drillTarget`).toBeDefined();
      expect(
        OWNS_CLICK_CAPABLE_VIZ.has(w.viz),
        `${w.id}: ownsClick on viz "${w.viz}" — strip/chart vizzes render inert marks and cannot self-wire a click; drop ownsClick so the wrapper carries the drill`,
      ).toBe(true);
    }
  });
});
